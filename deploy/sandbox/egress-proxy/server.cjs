#!/usr/bin/env node
/**
 * SDAP egress proxy sidecar.
 *
 * DockerSandboxRunner starts this on two networks: an `--internal` network shared only
 * with the sandbox container, and an egress-capable network. It is the sandbox's only
 * route out. Rules mirror packages/sandbox/src/egress-rules.ts and are kept in sync by
 * packages/sandbox/test/proxy-conformance.test.ts, which runs the same cases against both.
 *
 * Env:
 *   ALLOWLIST  comma-separated entries: host[:port] | *.domain.tld[:port] | IPv4[:port] |
 *              [IPv6][:port]. No port => 80 and 443 only. Invalid entries abort startup.
 *   PORT       listen port (default 3128; 0 = ephemeral, printed on stdout)
 *   HOST       bind address (default 0.0.0.0, inside the sidecar's own netns)
 *   DNS_SERVERS optional comma-separated resolvers; default = nameservers in
 *              /etc/resolv.conf *at startup*. The runner attaches the internal network
 *              only after startup, because that attach rewrites resolv.conf to the
 *              internal network's resolver, which cannot resolve external names.
 */
"use strict";

const dns = require("node:dns");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");

// ---------------------------------------------------------------------------
// Allowlist grammar (keep in sync with egress-rules.ts)
// ---------------------------------------------------------------------------

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

function isDnsName(name) {
  if (name.length === 0 || name.length > 253) return false;
  return name.split(".").every((l) => LABEL.test(l));
}

function parsePort(raw) {
  if (!/^[0-9]{1,5}$/.test(raw)) throw new Error(`invalid port "${raw}"`);
  const port = Number(raw);
  if (port < 1 || port > 65535) throw new Error(`port out of range "${raw}"`);
  return port;
}

function splitHostPort(input) {
  if (input.startsWith("[")) {
    const close = input.indexOf("]");
    if (close < 0) throw new Error(`unterminated IPv6 literal "${input}"`);
    const host = input.slice(1, close);
    const rest = input.slice(close + 1);
    if (rest === "") return { host, port: null };
    if (!rest.startsWith(":")) throw new Error(`invalid authority "${input}"`);
    return { host, port: parsePort(rest.slice(1)) };
  }
  const colons = input.split(":").length - 1;
  if (colons === 0) return { host: input, port: null };
  if (colons > 1) throw new Error(`IPv6 literals must be bracketed: "${input}"`);
  const idx = input.indexOf(":");
  return { host: input.slice(0, idx), port: parsePort(input.slice(idx + 1)) };
}

function normalizeHostname(host) {
  const h = host.toLowerCase();
  return h.endsWith(".") ? h.slice(0, -1) : h;
}

function canonicalIp(ip) {
  const lower = ip.toLowerCase();
  if (net.isIPv6(lower)) {
    const mapped = /^(?:0{0,4}:){0,5}:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped && net.isIPv4(mapped[1])) return mapped[1];
    const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1], 16);
      const lo = parseInt(hexMapped[2], 16);
      return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    }
    return new URL(`http://[${lower}]/`).hostname.slice(1, -1);
  }
  return lower;
}

function parseAllowlistEntry(entry) {
  if (entry.length === 0 || entry.trim() !== entry) throw new Error("empty entry");
  if (/[\s\x00-\x1f\x7f/@?#]/.test(entry) || entry.includes("://")) {
    throw new Error(`entry must be host[:port]: "${entry}"`);
  }
  const { host: rawHost, port } = splitHostPort(entry.toLowerCase());
  if (rawHost.startsWith("*.")) {
    const suffix = normalizeHostname(rawHost.slice(2));
    if (!isDnsName(suffix) || !suffix.includes(".")) {
      throw new Error(`wildcard must cover a domain with at least two labels: "${entry}"`);
    }
    return { host: suffix, kind: "wildcard", port };
  }
  if (rawHost.includes("*")) throw new Error(`only leading "*." wildcards: "${entry}"`);
  if (net.isIP(rawHost) !== 0) return { host: canonicalIp(rawHost), kind: "ip", port };
  if (entry.startsWith("[")) throw new Error(`invalid IPv6 literal: "${entry}"`);
  const name = normalizeHostname(rawHost);
  if (!isDnsName(name)) throw new Error(`invalid hostname: "${entry}"`);
  if (/^[0-9.]+$/.test(name)) throw new Error(`ambiguous numeric hostname: "${entry}"`);
  return { host: name, kind: "exact-name", port };
}

function matchAllowlist(rules, host, port) {
  const isIp = net.isIP(host) !== 0;
  const h = isIp ? canonicalIp(host) : normalizeHostname(host);
  for (const rule of rules) {
    const portOk = rule.port === null ? port === 80 || port === 443 : rule.port === port;
    if (!portOk) continue;
    if (rule.kind === "ip") {
      if (isIp && rule.host === h) return rule;
    } else if (isIp) {
      continue;
    } else if (rule.kind === "exact-name") {
      if (rule.host === h) return rule;
    } else if (h === rule.host || h.endsWith(`.${rule.host}`)) {
      return rule;
    }
  }
  return null;
}

const ALWAYS_BLOCKED = new net.BlockList();
ALWAYS_BLOCKED.addSubnet("0.0.0.0", 8, "ipv4");
ALWAYS_BLOCKED.addSubnet("127.0.0.0", 8, "ipv4");
ALWAYS_BLOCKED.addSubnet("169.254.0.0", 16, "ipv4");
ALWAYS_BLOCKED.addSubnet("192.0.0.0", 24, "ipv4");
ALWAYS_BLOCKED.addSubnet("224.0.0.0", 4, "ipv4");
ALWAYS_BLOCKED.addSubnet("240.0.0.0", 4, "ipv4");
ALWAYS_BLOCKED.addAddress("100.100.100.200", "ipv4");
ALWAYS_BLOCKED.addAddress("::", "ipv6");
ALWAYS_BLOCKED.addAddress("::1", "ipv6");
ALWAYS_BLOCKED.addSubnet("fe80::", 10, "ipv6");
ALWAYS_BLOCKED.addSubnet("ff00::", 8, "ipv6");
ALWAYS_BLOCKED.addAddress("fd00:ec2::254", "ipv6");
ALWAYS_BLOCKED.addSubnet("64:ff9b::", 96, "ipv6");
ALWAYS_BLOCKED.addSubnet("2002::", 16, "ipv6");

const PRIVATE = new net.BlockList();
PRIVATE.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE.addSubnet("100.64.0.0", 10, "ipv4");
PRIVATE.addSubnet("198.18.0.0", 15, "ipv4");
PRIVATE.addSubnet("fc00::", 7, "ipv6");

function classifyAddress(ip) {
  const c = canonicalIp(ip);
  const family = net.isIPv4(c) ? "ipv4" : "ipv6";
  if (ALWAYS_BLOCKED.check(c, family)) return "blocked";
  if (PRIVATE.check(c, family)) return "private";
  return "public";
}

function addressPermitted(rule, ip) {
  const cls = classifyAddress(ip);
  if (rule.kind === "ip") return canonicalIp(ip) === rule.host;
  if (cls === "blocked") return false;
  if (rule.kind === "wildcard") return cls === "public";
  return true;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const PORT = Number.parseInt(process.env.PORT ?? "3128", 10);
const HOST = process.env.HOST || "0.0.0.0";

let rules;
try {
  rules = (process.env.ALLOWLIST || "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0)
    .map(parseAllowlistEntry);
} catch (err) {
  console.error(`[sdap-egress-proxy] invalid ALLOWLIST: ${err.message}`);
  process.exit(2);
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

function log(allowed, host, port, reason) {
  const line = JSON.stringify({ allowed, host, port, reason });
  if (allowed) console.log(`[sdap-egress-proxy] ${line}`);
  else console.warn(`[sdap-egress-proxy] ${line}`);
}

// Snapshot resolvers and /etc/hosts now, before the internal network is attached.
function readNameservers() {
  try {
    return fs
      .readFileSync("/etc/resolv.conf", "utf8")
      .split("\n")
      .map((l) => l.trim().split(/\s+/))
      .filter((p) => p[0] === "nameserver" && p[1] && net.isIP(p[1].split("%")[0]) !== 0)
      .map((p) => p[1]);
  } catch {
    return [];
  }
}

function readHosts() {
  const map = new Map();
  try {
    for (const line of fs.readFileSync("/etc/hosts", "utf8").split("\n")) {
      const [ip, ...names] = line.replace(/#.*/, "").trim().split(/\s+/);
      if (!ip || net.isIP(ip) === 0) continue;
      for (const n of names) {
        const key = normalizeHostname(n);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(ip);
      }
    }
  } catch {
    // no hosts file
  }
  return map;
}

const DNS_SERVERS = process.env.DNS_SERVERS
  ? process.env.DNS_SERVERS.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : readNameservers();
const HOSTS = readHosts();
const resolver = new dns.promises.Resolver({ timeout: 3000, tries: 2 });
if (DNS_SERVERS.length > 0) resolver.setServers(DNS_SERVERS);

/** IPv4 first: the sidecar may have no IPv6 route. */
async function resolveHost(host) {
  const fromHosts = HOSTS.get(normalizeHostname(host));
  if (fromHosts) return fromHosts;
  const [v4, v6] = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)]);
  const out = [
    ...(v4.status === "fulfilled" ? v4.value : []),
    ...(v6.status === "fulfilled" ? v6.value : []),
  ];
  if (out.length === 0) throw new Error("ENOTFOUND");
  return out;
}

async function vet(host, port) {
  const rule = matchAllowlist(rules, host, port);
  if (!rule) return { ok: false, status: 403, reason: "destination not in allowlist" };
  let addresses;
  if (net.isIP(host) !== 0) {
    addresses = [canonicalIp(host)];
  } else {
    try {
      addresses = await resolveHost(host);
    } catch {
      return { ok: false, status: 502, reason: "DNS resolution failed" };
    }
  }
  if (addresses.length === 0) return { ok: false, status: 502, reason: "no addresses" };
  for (const a of addresses) {
    if (!addressPermitted(rule, a)) {
      return { ok: false, status: 403, reason: `resolved address ${a} is not permitted` };
    }
  }
  return { ok: true, address: addresses[0] };
}

function filterHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase()) && v !== undefined) out[k] = v;
  }
  return out;
}

const server = http.createServer(async (req, res) => {
  const rawUrl = req.url || "";
  let target;
  try {
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
  const verdict = await vet(host, port);
  if (!verdict.ok) {
    log(false, host, port, verdict.reason);
    res.writeHead(verdict.status, { "Content-Type": "text/plain" });
    res.end(`Blocked by SDAP egress policy: ${host}:${port} (${verdict.reason})\n`);
    return;
  }
  log(true, host, port, "allowed");
  const headers = filterHeaders(req.headers);
  headers.host = target.host;
  const proxyReq = http.request(
    {
      host: verdict.address,
      port,
      method: req.method,
      path: target.pathname + target.search,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, filterHeaders(proxyRes.headers));
      proxyRes.pipe(res);
    },
  );
  proxyReq.on("error", (err) => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
    res.end(`Proxy error: ${err.message}\n`);
  });
  req.pipe(proxyReq);
});

server.on("connect", async (req, clientSocket, head) => {
  const deny = (status, text, msg) => {
    clientSocket.end(
      `HTTP/1.1 ${status} ${text}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n` +
        `Blocked by SDAP egress policy: ${msg}\r\n`,
    );
  };
  clientSocket.on("error", () => clientSocket.destroy());
  let host;
  let port;
  try {
    const parsed = splitHostPort(req.url || "");
    if (parsed.port === null || parsed.host === "") throw new Error("missing port");
    host = parsed.host;
    port = parsed.port;
  } catch {
    deny(400, "Bad Request", "CONNECT target must be host:port");
    return;
  }
  const verdict = await vet(host, port);
  if (!verdict.ok) {
    log(false, host, port, verdict.reason);
    deny(verdict.status, verdict.status === 403 ? "Forbidden" : "Bad Gateway", verdict.reason);
    return;
  }
  log(true, host, port, "allowed");
  let connected = false;
  const targetSocket = net.connect(port, verdict.address, () => {
    connected = true;
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head && head.length > 0) targetSocket.write(head);
    clientSocket.pipe(targetSocket);
    targetSocket.pipe(clientSocket);
  });
  targetSocket.on("close", () => clientSocket.destroy());
  clientSocket.on("close", () => targetSocket.destroy());
  targetSocket.on("error", () => {
    if (!connected && !clientSocket.destroyed && clientSocket.writable) {
      deny(502, "Bad Gateway", "upstream connection failed");
    } else {
      clientSocket.destroy();
    }
  });
});

server.on("clientError", (_err, socket) => socket.destroy());

server.listen(PORT, HOST, () => {
  const addr = server.address();
  console.log(
    `[sdap-egress-proxy] Listening on ${HOST}:${addr.port} rules=${rules.length} ` +
      `dns=${DNS_SERVERS.join(",") || "system"}`,
  );
});

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
