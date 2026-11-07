import http from "node:http";
import net from "node:net";
import { URL } from "node:url";

export interface EgressProxyOptions {
  allowlist: readonly string[];
  host?: string;
  port?: number;
}

/**
 * Forward HTTP and HTTPS (CONNECT) proxy that strictly restricts outbound
 * egress to hosts specified in the allowlist.
 */
export class EgressProxy {
  private readonly allowlist: string[];
  private readonly host: string;
  private readonly preferredPort: number;
  private server: http.Server | null = null;
  private listeningPort: number | null = null;
  private readonly openSockets = new Set<net.Socket>();

  constructor(options: EgressProxyOptions) {
    this.allowlist = (options.allowlist || []).map((h) => h.toLowerCase().trim());
    this.host = options.host || "0.0.0.0";
    this.preferredPort = options.port ?? 0;
  }

  get port(): number {
    if (this.listeningPort === null) {
      throw new Error("EgressProxy is not running");
    }
    return this.listeningPort;
  }

  /**
   * Checks whether a target host and port are permitted by the allowlist.
   */
  isAllowed(targetHost: string, targetPort?: number | string): boolean {
    if (this.allowlist.length === 0) {
      return false;
    }

    // Parse host and optional port
    let hostname = targetHost.toLowerCase().trim();
    let portStr: string | undefined = targetPort !== undefined ? String(targetPort) : undefined;

    if (hostname.includes("://")) {
      try {
        const u = new URL(hostname);
        hostname = u.hostname.toLowerCase();
        if (u.port) {
          portStr = u.port;
        } else {
          portStr = u.protocol === "https:" ? "443" : "80";
        }
      } catch {
        // If parsing fails, fall back to simple string splitting
      }
    }

    if (hostname.includes(":") && !hostname.startsWith("[")) {
      const lastColon = hostname.lastIndexOf(":");
      portStr = hostname.slice(lastColon + 1);
      hostname = hostname.slice(0, lastColon);
    }

    for (const rule of this.allowlist) {
      let ruleHost = rule;
      let rulePort: string | undefined;

      if (rule.includes(":") && !rule.startsWith("[")) {
        const lastColon = rule.lastIndexOf(":");
        rulePort = rule.slice(lastColon + 1);
        ruleHost = rule.slice(0, lastColon);
      }

      // Check port match if rule specifies a port
      if (rulePort !== undefined && portStr !== undefined && rulePort !== portStr) {
        continue;
      }

      // Check wildcard hostname: *.domain.com
      if (ruleHost.startsWith("*.")) {
        const domainSuffix = ruleHost.slice(2);
        if (hostname.endsWith(`.${domainSuffix}`) || hostname === domainSuffix) {
          return true;
        }
      } else if (ruleHost === "*" || ruleHost === hostname) {
        return true;
      }
    }

    return false;
  }

  /**
   * Starts the forward proxy server.
   */
  async start(): Promise<{ host: string; port: number }> {
    if (this.server) {
      return { host: this.host, port: this.port };
    }

    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handleHttpRequest(req, res);
      });

      server.on("connect", (req, clientSocket, head) => {
        this.handleConnect(req, clientSocket as net.Socket, head);
      });

      server.on("connection", (socket) => {
        this.openSockets.add(socket);
        socket.on("close", () => {
          this.openSockets.delete(socket);
        });
      });

      server.on("error", (err) => {
        reject(err);
      });

      server.listen(this.preferredPort, this.host, () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          this.listeningPort = addr.port;
          this.server = server;
          resolve({ host: this.host, port: addr.port });
        } else {
          reject(new Error("Unable to obtain proxy server address"));
        }
      });
    });
  }

  /**
   * Handles plain HTTP forwarding.
   */
  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const rawUrl = req.url || "";
    const hostHeader = req.headers.host || "";

    let targetHost = hostHeader;
    let targetPort = 80;
    let targetPath = rawUrl;

    if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
      try {
        const parsed = new URL(rawUrl);
        targetHost = parsed.hostname;
        targetPort = parsed.port
          ? parseInt(parsed.port, 10)
          : parsed.protocol === "https:"
            ? 443
            : 80;
        targetPath = parsed.pathname + parsed.search;
      } catch {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Invalid URL in request\n");
        return;
      }
    } else if (hostHeader) {
      if (hostHeader.includes(":")) {
        const lastColon = hostHeader.lastIndexOf(":");
        targetHost = hostHeader.slice(0, lastColon);
        const parsedPort = parseInt(hostHeader.slice(lastColon + 1), 10);
        if (!isNaN(parsedPort)) {
          targetPort = parsedPort;
        }
      } else {
        targetHost = hostHeader;
      }
    }

    if (!this.isAllowed(targetHost, targetPort)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end(
        `Blocked by SDAP Egress Policy: host ${targetHost}:${targetPort} is not in allowlist\n`,
      );
      return;
    }

    const forwardHost =
      targetHost.toLowerCase() === "host.docker.internal" ||
      targetHost.toLowerCase() === "host.containers.internal"
        ? "127.0.0.1"
        : targetHost;

    const proxyReq = http.request(
      {
        host: forwardHost,
        port: targetPort,
        method: req.method,
        path: targetPath,
        headers: req.headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );

    proxyReq.on("error", (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "text/plain" });
      }
      res.end(`Proxy error: ${err.message}\n`);
    });

    req.pipe(proxyReq);
  }

  /**
   * Handles HTTPS CONNECT tunneling.
   */
  private handleConnect(req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer): void {
    const url = req.url || "";
    let hostname: string;
    let port = 443;

    if (url.includes(":")) {
      const lastColon = url.lastIndexOf(":");
      hostname = url.slice(0, lastColon);
      const parsedPort = parseInt(url.slice(lastColon + 1), 10);
      if (!isNaN(parsedPort)) {
        port = parsedPort;
      }
    } else {
      hostname = url;
    }

    if (!this.isAllowed(hostname, port)) {
      clientSocket.write(
        "HTTP/1.1 403 Forbidden\r\n" +
          "Content-Type: text/plain\r\n" +
          "Connection: close\r\n\r\n" +
          `Blocked by SDAP Egress Policy: ${hostname}:${port} is not in allowlist\r\n`,
      );
      clientSocket.destroy();
      return;
    }

    const forwardHost =
      hostname.toLowerCase() === "host.docker.internal" ||
      hostname.toLowerCase() === "host.containers.internal"
        ? "127.0.0.1"
        : hostname;

    const targetSocket = net.connect(port, forwardHost, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head && head.length > 0) {
        targetSocket.write(head);
      }
      clientSocket.pipe(targetSocket);
      targetSocket.pipe(clientSocket);
    });

    this.openSockets.add(targetSocket);

    targetSocket.on("close", () => {
      this.openSockets.delete(targetSocket);
      clientSocket.destroy();
    });

    clientSocket.on("close", () => {
      targetSocket.destroy();
    });

    targetSocket.on("error", () => {
      clientSocket.destroy();
    });

    clientSocket.on("error", () => {
      targetSocket.destroy();
    });
  }

  /**
   * Stops the proxy server and terminates active connections.
   */
  async stop(): Promise<void> {
    for (const socket of this.openSockets) {
      socket.destroy();
    }
    this.openSockets.clear();

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => resolve());
      });
      this.server = null;
      this.listeningPort = null;
    }
  }
}
