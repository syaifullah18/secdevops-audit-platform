import net from "node:net";

/**
 * Egress allowlist grammar and destination checks shared by the in-process
 * `EgressProxy`. `deploy/sandbox/egress-proxy/server.cjs` (the sidecar the Docker
 * runner actually uses) implements the same rules in plain JS; the conformance
 * tests in `test/proxy-conformance.test.ts` run against both to keep them in sync.
 *
 * Grammar (case-insensitive):
 *   host        = DNS name (LDH labels) | IPv4 literal | "[" IPv6 literal "]"
 *   entry       = host [":" port] | "*." DNS-name-with-at-least-2-labels [":" port]
 * A bare "*" and single-label wildcards such as "*.com" are rejected. An entry without
 * a port allows ports 80 and 443 only.
 */
export interface AllowlistRule {
  /** Lowercased hostname, IP literal (IPv6 without brackets) or wildcard suffix. */
  host: string;
  kind: "exact-name" | "wildcard" | "ip";
  /** null => 80 and 443 only. */
  port: number | null;
}

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

function isDnsName(name: string): boolean {
  if (name.length === 0 || name.length > 253) return false;
  return name.split(".").every((l) => LABEL.test(l));
}

function parsePort(raw: string): number {
  if (!/^[0-9]{1,5}$/.test(raw)) throw new Error(`invalid port "${raw}"`);
  const port = Number(raw);
  if (port < 1 || port > 65535) throw new Error(`port out of range "${raw}"`);
  return port;
}

/** Splits "host[:port]" / "[v6][:port]". Returns null port when absent. */
export function splitHostPort(input: string): { host: string; port: number | null } {
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

/** Lowercases and strips one trailing dot from a DNS name. */
export function normalizeHostname(host: string): string {
  const h = host.toLowerCase();
  return h.endsWith(".") ? h.slice(0, -1) : h;
}

export function parseAllowlistEntry(entry: string): AllowlistRule {
  if (typeof entry !== "string" || entry.trim() !== entry || entry.length === 0) {
    throw new Error("entry must be a non-empty string without surrounding whitespace");
  }
  const hasControl = [...entry].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);
  if (hasControl || /[\s/@?#]/.test(entry) || entry.includes("://")) {
    throw new Error(`entry must be host[:port] (no scheme, path, userinfo or whitespace)`);
  }
  const { host: rawHost, port } = splitHostPort(entry.toLowerCase());
  if (rawHost.startsWith("*.")) {
    const suffix = normalizeHostname(rawHost.slice(2));
    if (!isDnsName(suffix) || !suffix.includes(".")) {
      throw new Error(`wildcard must cover a domain with at least two labels: "${entry}"`);
    }
    return { host: suffix, kind: "wildcard", port };
  }
  if (rawHost.includes("*")) {
    throw new Error(`only leading "*." wildcards are supported: "${entry}"`);
  }
  if (net.isIP(rawHost) !== 0) {
    return { host: canonicalIp(rawHost), kind: "ip", port };
  }
  if (entry.startsWith("[")) throw new Error(`invalid IPv6 literal: "${entry}"`);
  const name = normalizeHostname(rawHost);
  if (!isDnsName(name)) throw new Error(`invalid hostname: "${entry}"`);
  // All-numeric names like "2130706433" would be parsed as IPv4 by some clients.
  if (/^[0-9.]+$/.test(name)) throw new Error(`ambiguous numeric hostname: "${entry}"`);
  return { host: name, kind: "exact-name", port };
}

function portMatches(rule: AllowlistRule, port: number): boolean {
  return rule.port === null ? port === 80 || port === 443 : rule.port === port;
}

/**
 * Name-level match of a requested destination against the rules. Returns the first
 * matching rule or null. `host` is the raw host from the request (IPv6 unbracketed).
 */
export function matchAllowlist(
  rules: readonly AllowlistRule[],
  host: string,
  port: number,
): AllowlistRule | null {
  const isIp = net.isIP(host) !== 0;
  const h = isIp ? canonicalIp(host) : normalizeHostname(host);
  for (const rule of rules) {
    if (!portMatches(rule, port)) continue;
    if (rule.kind === "ip") {
      if (isIp && rule.host === h) return rule;
    } else if (isIp) {
      continue; // IP literals only match explicit IP rules.
    } else if (rule.kind === "exact-name") {
      if (rule.host === h) return rule;
    } else if (h === rule.host || h.endsWith(`.${rule.host}`)) {
      return rule;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// IP classification
// ---------------------------------------------------------------------------

/** Never reachable through a hostname rule: loopback, link-local (cloud metadata), etc. */
const ALWAYS_BLOCKED = new net.BlockList();
ALWAYS_BLOCKED.addSubnet("0.0.0.0", 8, "ipv4");
ALWAYS_BLOCKED.addSubnet("127.0.0.0", 8, "ipv4");
ALWAYS_BLOCKED.addSubnet("169.254.0.0", 16, "ipv4"); // incl. 169.254.169.254 metadata
ALWAYS_BLOCKED.addSubnet("192.0.0.0", 24, "ipv4");
ALWAYS_BLOCKED.addSubnet("224.0.0.0", 4, "ipv4");
ALWAYS_BLOCKED.addSubnet("240.0.0.0", 4, "ipv4");
ALWAYS_BLOCKED.addAddress("100.100.100.200", "ipv4"); // Alibaba metadata
ALWAYS_BLOCKED.addAddress("::", "ipv6");
ALWAYS_BLOCKED.addAddress("::1", "ipv6");
ALWAYS_BLOCKED.addSubnet("fe80::", 10, "ipv6");
ALWAYS_BLOCKED.addSubnet("ff00::", 8, "ipv6");
ALWAYS_BLOCKED.addAddress("fd00:ec2::254", "ipv6"); // AWS IMDS over IPv6
ALWAYS_BLOCKED.addSubnet("64:ff9b::", 96, "ipv6"); // NAT64 can embed any IPv4
ALWAYS_BLOCKED.addSubnet("2002::", 16, "ipv6"); // 6to4 can embed any IPv4

/** Internal ranges: reachable only through an exact-hostname (or exact IP) rule. */
const PRIVATE = new net.BlockList();
PRIVATE.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE.addSubnet("100.64.0.0", 10, "ipv4");
PRIVATE.addSubnet("198.18.0.0", 15, "ipv4");
PRIVATE.addSubnet("fc00::", 7, "ipv6");

/** Canonical textual form; IPv4-mapped IPv6 (::ffff:a.b.c.d) collapses to IPv4. */
export function canonicalIp(ip: string): string {
  const lower = ip.toLowerCase();
  if (net.isIPv6(lower)) {
    const mapped = /^(?:0{0,4}:){0,5}:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped?.[1] && net.isIPv4(mapped[1])) return mapped[1];
    const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
    if (hexMapped?.[1] && hexMapped[2]) {
      const hi = parseInt(hexMapped[1], 16);
      const lo = parseInt(hexMapped[2], 16);
      return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    }
    // Round-trip through URL to get the compressed canonical form.
    return new URL(`http://[${lower}]/`).hostname.slice(1, -1);
  }
  return lower;
}

export type AddressClass = "public" | "private" | "blocked";

export function classifyAddress(ip: string): AddressClass {
  const c = canonicalIp(ip);
  const family = net.isIPv4(c) ? "ipv4" : "ipv6";
  if (ALWAYS_BLOCKED.check(c, family)) return "blocked";
  if (PRIVATE.check(c, family)) return "private";
  return "public";
}

/**
 * Decides whether a resolved address may be dialled under the rule that matched.
 * - IP rules: only the literal address itself (explicit operator intent).
 * - Exact-name rules: public or private addresses (e.g. a local model gateway),
 *   never loopback/link-local/metadata.
 * - Wildcard rules: public addresses only, so a wildcard cannot be turned into an
 *   internal-network scanner via DNS rebinding.
 */
export function addressPermitted(rule: AllowlistRule, ip: string): boolean {
  const cls = classifyAddress(ip);
  if (rule.kind === "ip") return canonicalIp(ip) === rule.host;
  if (cls === "blocked") return false;
  if (rule.kind === "wildcard") return cls === "public";
  return true;
}
