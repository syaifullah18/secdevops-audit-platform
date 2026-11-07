import { describe, expect, it } from "vitest";
import {
  addressPermitted,
  canonicalIp,
  classifyAddress,
  matchAllowlist,
  parseAllowlistEntry,
} from "../src/egress-rules.js";
import { EgressProxy, type LookupFn } from "../src/proxy.js";

describe("egress rules", () => {
  it("parses entries into typed rules", () => {
    expect(parseAllowlistEntry("API.Anthropic.com")).toEqual({
      host: "api.anthropic.com",
      kind: "exact-name",
      port: null,
    });
    expect(parseAllowlistEntry("*.example.org:8443")).toEqual({
      host: "example.org",
      kind: "wildcard",
      port: 8443,
    });
    expect(parseAllowlistEntry("[::1]:80")).toEqual({ host: "::1", kind: "ip", port: 80 });
    expect(parseAllowlistEntry("10.0.0.1")).toEqual({ host: "10.0.0.1", kind: "ip", port: null });
  });

  it("matches exact, wildcard and port rules", () => {
    const rules = ["api.anthropic.com", "*.internal.corp", "localhost:8080", "127.0.0.1:3000"].map(
      parseAllowlistEntry,
    );
    expect(matchAllowlist(rules, "api.anthropic.com", 443)).not.toBeNull();
    expect(matchAllowlist(rules, "API.ANTHROPIC.COM.", 443)).not.toBeNull();
    expect(matchAllowlist(rules, "api.anthropic.com", 22)).toBeNull();
    expect(matchAllowlist(rules, "anthropic.com", 443)).toBeNull();
    expect(matchAllowlist(rules, "api.anthropic.com.evil.com", 443)).toBeNull();
    expect(matchAllowlist(rules, "git.internal.corp", 443)).not.toBeNull();
    expect(matchAllowlist(rules, "internal.corp", 80)).not.toBeNull();
    expect(matchAllowlist(rules, "evilinternal.corp", 443)).toBeNull();
    expect(matchAllowlist(rules, "localhost", 8080)).not.toBeNull();
    expect(matchAllowlist(rules, "localhost", 9090)).toBeNull();
    expect(matchAllowlist(rules, "127.0.0.1", 3000)).not.toBeNull();
    expect(matchAllowlist(rules, "::ffff:127.0.0.1", 3000)).not.toBeNull();
    expect(matchAllowlist(rules, "127.0.0.1", 4000)).toBeNull();
  });

  it("IP literals only match explicit IP rules, never wildcard/name rules", () => {
    const rules = ["*.example.com"].map(parseAllowlistEntry);
    expect(matchAllowlist(rules, "93.184.216.34", 443)).toBeNull();
  });

  it("classifies addresses", () => {
    expect(classifyAddress("169.254.169.254")).toBe("blocked");
    expect(classifyAddress("::ffff:169.254.169.254")).toBe("blocked");
    expect(classifyAddress("::ffff:a9fe:a9fe")).toBe("blocked");
    expect(classifyAddress("fd00:ec2::254")).toBe("blocked");
    expect(classifyAddress("127.0.0.53")).toBe("blocked");
    expect(classifyAddress("::1")).toBe("blocked");
    expect(classifyAddress("0.0.0.0")).toBe("blocked");
    expect(classifyAddress("fe80::1")).toBe("blocked");
    expect(classifyAddress("64:ff9b::a9fe:a9fe")).toBe("blocked");
    expect(classifyAddress("10.1.2.3")).toBe("private");
    expect(classifyAddress("192.168.127.254")).toBe("private");
    expect(classifyAddress("fd12::1")).toBe("private");
    expect(classifyAddress("1.1.1.1")).toBe("public");
    expect(classifyAddress("2606:4700::1111")).toBe("public");
    expect(canonicalIp("0:0:0:0:0:ffff:1.2.3.4")).toBe("1.2.3.4");
  });

  it("permits addresses per rule kind", () => {
    const exact = parseAllowlistEntry("gw.local.test");
    const wild = parseAllowlistEntry("*.example.com");
    const ip = parseAllowlistEntry("127.0.0.1:9");
    expect(addressPermitted(exact, "10.0.0.8")).toBe(true);
    expect(addressPermitted(exact, "127.0.0.1")).toBe(false);
    expect(addressPermitted(exact, "169.254.169.254")).toBe(false);
    expect(addressPermitted(wild, "10.0.0.8")).toBe(false);
    expect(addressPermitted(wild, "1.1.1.1")).toBe(true);
    expect(addressPermitted(ip, "127.0.0.1")).toBe(true);
    expect(addressPermitted(ip, "127.0.0.2")).toBe(false);
  });
});

describe("EgressProxy (in-process)", () => {
  it("isAllowed performs name-level checks", () => {
    const proxy = new EgressProxy({ allowlist: ["localhost:8080", "*.aws.com"] });
    expect(proxy.isAllowed("localhost", 8080)).toBe(true);
    expect(proxy.isAllowed("localhost:8080")).toBe(true);
    expect(proxy.isAllowed("localhost", 9090)).toBe(false);
    expect(proxy.isAllowed("s3.aws.com")).toBe(true);
    expect(proxy.isAllowed("s3.aws.com", 22)).toBe(false);
    expect(proxy.isAllowed("garbage::")).toBe(false);
  });

  it("binds to loopback by default", async () => {
    const proxy = new EgressProxy({ allowlist: [] });
    const { host } = await proxy.start();
    await proxy.stop();
    expect(host).toBe("127.0.0.1");
  });

  it("refuses a hostname whose record set mixes public and internal addresses", async () => {
    const lookup: LookupFn = async () => [
      { address: "1.1.1.1", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ];
    const proxy = new EgressProxy({ allowlist: ["api.example.com"], lookup });
    const v = await proxy.vet("api.example.com", 443);
    expect(v.ok).toBe(false);
  });

  it("refuses wildcard matches that resolve to private addresses (DNS rebinding)", async () => {
    const lookup: LookupFn = async () => [{ address: "10.0.0.5", family: 4 }];
    const proxy = new EgressProxy({ allowlist: ["*.example.com"], lookup });
    expect((await proxy.vet("rebind.example.com", 443)).ok).toBe(false);
    const exact = new EgressProxy({ allowlist: ["gw.example.com"], lookup });
    expect(await exact.vet("gw.example.com", 443)).toEqual({ ok: true, address: "10.0.0.5" });
  });

  it("resolves exactly once per request and pins the vetted address", async () => {
    let calls = 0;
    const lookup: LookupFn = async () => {
      calls++;
      return [{ address: calls === 1 ? "1.1.1.1" : "127.0.0.1", family: 4 }];
    };
    const proxy = new EgressProxy({ allowlist: ["api.example.com"], lookup });
    const v = await proxy.vet("api.example.com", 443);
    expect(v).toEqual({ ok: true, address: "1.1.1.1" });
    expect(calls).toBe(1);
  });

  it("reports DNS failures as 502 rather than allowing", async () => {
    const lookup: LookupFn = async () => {
      throw new Error("ENOTFOUND");
    };
    const proxy = new EgressProxy({ allowlist: ["api.example.com"], lookup });
    expect(await proxy.vet("api.example.com", 443)).toMatchObject({ ok: false, status: 502 });
  });
});
