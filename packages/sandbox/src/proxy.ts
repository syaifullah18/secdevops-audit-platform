import dns from "node:dns";
import http from "node:http";
import net from "node:net";
import {
  addressPermitted,
  canonicalIp,
  matchAllowlist,
  splitHostPort,
  type AllowlistRule,
} from "./egress-rules.js";
import { parseEgressAllowlist } from "./validation.js";

export type LookupFn = (hostname: string) => Promise<{ address: string; family: number }[]>;

export interface EgressProxyOptions {
  allowlist: readonly string[];
  /** Bind address. Defaults to 127.0.0.1; never bind 0.0.0.0 on a shared host. */
  host?: string;
  port?: number;
  /** DNS resolver (injectable for tests). Defaults to dns.promises.lookup(all). */
  lookup?: LookupFn;
  /** Optional sink for allow/deny decisions. */
  onDecision?: (d: { allowed: boolean; host: string; port: number; reason: string }) => void;
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const defaultLookup: LookupFn = (hostname) =>
  dns.promises.lookup(hostname, { all: true, verbatim: true });

interface Vetted {
  ok: true;
  address: string;
}
interface Denied {
  ok: false;
  status: number;
  reason: string;
}

/**
 * In-process forward HTTP + CONNECT proxy enforcing the egress allowlist.
 *
 * Security properties (mirrored by deploy/sandbox/egress-proxy/server.cjs):
 * - Allowlist is parsed strictly (see egress-rules.ts); invalid entries throw.
 * - Only absolute-form `http://` requests and `CONNECT host:port` are accepted.
 * - The destination is resolved once, every resolved address is classified, and the
 *   connection is pinned to the vetted address (no second lookup => no DNS rebinding
 *   between check and connect).
 * - Loopback / link-local / metadata addresses are never reachable via a hostname.
 * - Hop-by-hop and Proxy-* headers are stripped before forwarding.
 */
export class EgressProxy {
  private readonly rules: AllowlistRule[];
  private readonly host: string;
  private readonly preferredPort: number;
  private readonly lookup: LookupFn;
  private readonly onDecision?: EgressProxyOptions["onDecision"];
  private server: http.Server | null = null;
  private listeningPort: number | null = null;
  private readonly openSockets = new Set<net.Socket>();

  constructor(options: EgressProxyOptions) {
    this.rules = parseEgressAllowlist(options.allowlist ?? []);
    this.host = options.host ?? "127.0.0.1";
    this.preferredPort = options.port ?? 0;
    this.lookup = options.lookup ?? defaultLookup;
    this.onDecision = options.onDecision;
  }

  get port(): number {
    if (this.listeningPort === null) {
      throw new Error("EgressProxy is not running");
    }
    return this.listeningPort;
  }

  /**
   * Name-level allowlist check (no DNS). `targetHost` may be "host", "host:port" or
   * "[v6]:port". Without a port, 443 is assumed.
   */
  isAllowed(targetHost: string, targetPort?: number | string): boolean {
    try {
      const { host, port } = splitHostPort(targetHost.trim());
      const p = targetPort !== undefined ? Number(targetPort) : (port ?? 443);
      if (!Number.isInteger(p)) return false;
      return matchAllowlist(this.rules, host, p) !== null;
    } catch {
      return false;
    }
  }

  /** Full check: allowlist match, then resolve and classify; returns the pinned address. */
  async vet(host: string, port: number): Promise<Vetted | Denied> {
    const rule = matchAllowlist(this.rules, host, port);
    if (!rule) {
      return { ok: false, status: 403, reason: "destination not in allowlist" };
    }
    let addresses: string[];
    if (net.isIP(host) !== 0) {
      addresses = [canonicalIp(host)];
    } else {
      try {
        addresses = (await this.lookup(host)).map((a) => a.address);
      } catch {
        return { ok: false, status: 502, reason: "DNS resolution failed" };
      }
    }
    if (addresses.length === 0) {
      return { ok: false, status: 502, reason: "DNS resolution returned no addresses" };
    }
    // Every address must be permitted; otherwise an attacker-influenced record set could
    // mix a public and an internal address.
    for (const a of addresses) {
      if (!addressPermitted(rule, a)) {
        return { ok: false, status: 403, reason: `resolved address ${a} is not permitted` };
      }
    }
    return { ok: true, address: addresses[0] as string };
  }

  async start(): Promise<{ host: string; port: number }> {
    if (this.server) {
      return { host: this.host, port: this.port };
    }

    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        void this.handleHttpRequest(req, res);
      });
      server.on("connect", (req, clientSocket, head) => {
        void this.handleConnect(req, clientSocket as net.Socket, head);
      });
      server.on("connection", (socket: net.Socket) => {
        this.openSockets.add(socket);
        socket.on("close", () => this.openSockets.delete(socket));
      });
      server.on("clientError", (_err, socket) => {
        socket.destroy();
      });
      server.once("error", reject);
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

  private decide(allowed: boolean, host: string, port: number, reason: string): void {
    this.onDecision?.({ allowed, host, port, reason });
  }

  private async handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const rawUrl = req.url ?? "";
    let target: URL;
    try {
      // Absolute-form only; origin-form requests mean someone is talking to the proxy
      // as if it were an origin server, which we refuse.
      if (!rawUrl.startsWith("http://")) throw new Error("not absolute http");
      target = new URL(rawUrl);
      if (target.username || target.password) throw new Error("userinfo");
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Bad request: only absolute-form http:// URLs or CONNECT are accepted\n");
      return;
    }

    const host = target.hostname.startsWith("[") ? target.hostname.slice(1, -1) : target.hostname;
    const port = target.port ? Number(target.port) : 80;
    const verdict = await this.vet(host, port);
    if (!verdict.ok) {
      this.decide(false, host, port, verdict.reason);
      res.writeHead(verdict.status, { "Content-Type": "text/plain" });
      res.end(`Blocked by SDAP egress policy: ${host}:${port} (${verdict.reason})\n`);
      return;
    }
    this.decide(true, host, port, "allowed");

    const headers: http.OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(k.toLowerCase()) && v !== undefined) headers[k] = v;
    }
    headers.host = target.host;

    const proxyReq = http.request(
      {
        host: verdict.address,
        port,
        method: req.method,
        path: target.pathname + target.search,
        // host is the pinned IP literal, so no second DNS lookup happens.
        headers,
      },
      (proxyRes) => {
        const outHeaders: http.OutgoingHttpHeaders = {};
        for (const [k, v] of Object.entries(proxyRes.headers)) {
          if (!HOP_BY_HOP.has(k.toLowerCase()) && v !== undefined) outHeaders[k] = v;
        }
        res.writeHead(proxyRes.statusCode ?? 502, outHeaders);
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

  private async handleConnect(
    req: http.IncomingMessage,
    clientSocket: net.Socket,
    head: Buffer,
  ): Promise<void> {
    const deny = (status: number, text: string, msg: string) => {
      clientSocket.end(
        `HTTP/1.1 ${status} ${text}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n` +
          `Blocked by SDAP egress policy: ${msg}\r\n`,
      );
    };
    clientSocket.on("error", () => clientSocket.destroy());

    let host: string;
    let port: number;
    try {
      const parsed = splitHostPort(req.url ?? "");
      if (parsed.port === null || parsed.host === "") throw new Error("missing port");
      host = parsed.host;
      port = parsed.port;
    } catch {
      deny(400, "Bad Request", "CONNECT target must be host:port");
      return;
    }

    const verdict = await this.vet(host, port);
    if (!verdict.ok) {
      this.decide(false, host, port, verdict.reason);
      deny(verdict.status, verdict.status === 403 ? "Forbidden" : "Bad Gateway", verdict.reason);
      return;
    }
    this.decide(true, host, port, "allowed");

    let connected = false;
    const targetSocket = net.connect(port, verdict.address, () => {
      connected = true;
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
    clientSocket.on("close", () => targetSocket.destroy());
    targetSocket.on("error", () => {
      if (!connected && !clientSocket.destroyed && clientSocket.writable) {
        deny(502, "Bad Gateway", "upstream connection failed");
      } else {
        clientSocket.destroy();
      }
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
      const server = this.server;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      this.server = null;
      this.listeningPort = null;
    }
  }
}
