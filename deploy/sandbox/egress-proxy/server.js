#!/usr/bin/env node
/**
 * Standalone Egress Proxy Server for SDAP Sandboxes.
 * Enforces strict destination allowlisting on all HTTP and CONNECT requests.
 */

const http = require("node:http");
const net = require("node:net");
const { URL } = require("node:url");

const PORT = parseInt(process.env.PORT || "8080", 10);
const HOST = process.env.HOST || "0.0.0.0";
const RAW_ALLOWLIST = process.env.ALLOWLIST || "";

const allowlist = RAW_ALLOWLIST.split(/[\s,]+/)
  .map((h) => h.toLowerCase().trim())
  .filter((h) => h.length > 0);

console.log(`[sdap-egress-proxy] Starting on ${HOST}:${PORT}`);
console.log(`[sdap-egress-proxy] Allowlist entries (${allowlist.length}):`, allowlist);

function isAllowed(targetHost, targetPort) {
  if (allowlist.length === 0) {
    return false;
  }

  let hostname = targetHost.toLowerCase().trim();
  let portStr = targetPort !== undefined ? String(targetPort) : undefined;

  if (hostname.includes("://")) {
    try {
      const u = new URL(hostname);
      hostname = u.hostname.toLowerCase();
      portStr = u.port || (u.protocol === "https:" ? "443" : "80");
    } catch {
      // Fallback to simple parse
    }
  }

  if (hostname.includes(":") && !hostname.startsWith("[")) {
    const lastColon = hostname.lastIndexOf(":");
    portStr = hostname.slice(lastColon + 1);
    hostname = hostname.slice(0, lastColon);
  }

  for (const rule of allowlist) {
    let ruleHost = rule;
    let rulePort;

    if (rule.includes(":") && !rule.startsWith("[")) {
      const lastColon = rule.lastIndexOf(":");
      rulePort = rule.slice(lastColon + 1);
      ruleHost = rule.slice(0, lastColon);
    }

    if (rulePort !== undefined && portStr !== undefined && rulePort !== portStr) {
      continue;
    }

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

const server = http.createServer((req, res) => {
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
      res.end("Invalid URL\n");
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

  if (!isAllowed(targetHost, targetPort)) {
    console.warn(`[sdap-egress-proxy] BLOCKED HTTP request to ${targetHost}:${targetPort}`);
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end(`Blocked by SDAP Egress Policy: ${targetHost}:${targetPort} not allowed\n`);
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
});

server.on("connect", (req, clientSocket, head) => {
  const url = req.url || "";
  let hostname = url;
  let port = 443;

  if (url.includes(":")) {
    const lastColon = url.lastIndexOf(":");
    hostname = url.slice(0, lastColon);
    const parsedPort = parseInt(url.slice(lastColon + 1), 10);
    if (!isNaN(parsedPort)) {
      port = parsedPort;
    }
  }

  if (!isAllowed(hostname, port)) {
    console.warn(`[sdap-egress-proxy] BLOCKED CONNECT request to ${hostname}:${port}`);
    clientSocket.write(
      "HTTP/1.1 403 Forbidden\r\n" +
        "Content-Type: text/plain\r\n" +
        "Connection: close\r\n\r\n" +
        `Blocked by SDAP Egress Policy: ${hostname}:${port} not allowed\r\n`,
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

  targetSocket.on("error", () => clientSocket.destroy());
  clientSocket.on("error", () => targetSocket.destroy());
});

server.listen(PORT, HOST, () => {
  console.log(`[sdap-egress-proxy] Listening on ${HOST}:${PORT}`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
