/**
 * The same egress cases run against the in-process EgressProxy (src/proxy.ts) and the
 * sidecar the Docker runner actually deploys (deploy/sandbox/egress-proxy/server.cjs),
 * so the two implementations cannot silently drift apart.
 */
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EgressProxy } from "../src/proxy.js";

const SIDECAR = path.resolve(__dirname, "../../../deploy/sandbox/egress-proxy/server.cjs");

interface Running {
  port: number;
  stop: () => Promise<void>;
}
type Impl = (allowlist: string[]) => Promise<Running>;

const inProcess: Impl = async (allowlist) => {
  const proxy = new EgressProxy({ allowlist, host: "127.0.0.1" });
  const { port } = await proxy.start();
  return { port, stop: () => proxy.stop() };
};

const sidecar: Impl = (allowlist) =>
  new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(process.execPath, [SIDECAR], {
      env: { ALLOWLIST: allowlist.join(","), PORT: "0", HOST: "127.0.0.1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout?.on("data", (c: Buffer) => {
      out += c.toString();
      const m = /Listening on 127\.0\.0\.1:(\d+)/.exec(out);
      if (m) {
        resolve({
          port: Number(m[1]),
          stop: () =>
            new Promise<void>((r) => {
              child.once("exit", () => r());
              child.kill("SIGKILL");
            }),
        });
      }
    });
    child.stderr?.on("data", (c: Buffer) => (out += c.toString()));
    child.once("exit", (code) => reject(new Error(`sidecar exited ${code}: ${out}`)));
  });

function httpViaProxy(
  proxyPort: number,
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: proxyPort, method: "GET", path: url, headers },
      (res) => {
        let body = "";
        res.on("data", (c: Buffer) => (body += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** Raw CONNECT; returns the status line and, if established, the tunnelled response. */
function connectViaProxy(
  proxyPort: number,
  authority: string,
): Promise<{ statusLine: string; tunnelled: string }> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(proxyPort, "127.0.0.1", () => {
      sock.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
    });
    let buf = "";
    let sentInner = false;
    sock.on("data", (c: Buffer) => {
      buf += c.toString();
      if (!sentInner && buf.startsWith("HTTP/1.1 200") && buf.includes("\r\n\r\n")) {
        sentInner = true;
        sock.write("GET /tunnel HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
      }
    });
    sock.on("error", reject);
    sock.on("close", () => {
      const statusLine = buf.split("\r\n")[0] ?? "";
      const idx = buf.indexOf("\r\n\r\n");
      resolve({ statusLine, tunnelled: idx >= 0 ? buf.slice(idx + 4) : "" });
    });
  });
}

describe.each([
  ["EgressProxy (in-process)", inProcess],
  ["egress-proxy sidecar (server.cjs)", sidecar],
] as const)("egress proxy conformance: %s", (_name, impl) => {
  let target: http.Server;
  let tp: number;

  beforeAll(async () => {
    target = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ url: req.url, headers: req.headers }));
    });
    await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
    tp = (target.address() as net.AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise<void>((r) => target.close(() => r()));
  });

  async function withProxy(allowlist: string[], fn: (port: number) => Promise<void>) {
    const p = await impl(allowlist);
    try {
      await fn(p.port);
    } finally {
      await p.stop();
    }
  }

  it("forwards HTTP to an allowlisted IP:port and strips Proxy-* headers", async () => {
    await withProxy([`127.0.0.1:${tp}`], async (port) => {
      const r = await httpViaProxy(port, `http://127.0.0.1:${tp}/ok?q=1`, {
        "Proxy-Authorization": "Basic c2VjcmV0",
        "X-Keep": "yes",
      });
      expect(r.status).toBe(200);
      const echoed = JSON.parse(r.body) as { url: string; headers: Record<string, string> };
      expect(echoed.url).toBe("/ok?q=1");
      expect(echoed.headers["proxy-authorization"]).toBeUndefined();
      expect(echoed.headers["x-keep"]).toBe("yes");
    });
  });

  it("refuses HTTP to a non-allowlisted host with 403", async () => {
    await withProxy(["allowed.example.com"], async (port) => {
      const r = await httpViaProxy(port, `http://127.0.0.1:${tp}/`);
      expect(r.status).toBe(403);
      expect(r.body).toContain("Blocked by SDAP egress policy");
    });
  });

  it("refuses everything when the allowlist is empty", async () => {
    await withProxy([], async (port) => {
      expect((await httpViaProxy(port, `http://127.0.0.1:${tp}/`)).status).toBe(403);
      expect((await connectViaProxy(port, `127.0.0.1:${tp}`)).statusLine).toContain("403");
    });
  });

  it("refuses origin-form requests (proxy is not an origin server)", async () => {
    await withProxy([`127.0.0.1:${tp}`], async (port) => {
      const r = await httpViaProxy(port, "/ok", { Host: `127.0.0.1:${tp}` });
      expect(r.status).toBe(400);
    });
  });

  it("tunnels CONNECT to an allowlisted IP:port", async () => {
    await withProxy([`127.0.0.1:${tp}`], async (port) => {
      const r = await connectViaProxy(port, `127.0.0.1:${tp}`);
      expect(r.statusLine).toBe("HTTP/1.1 200 Connection Established");
      expect(r.tunnelled).toContain('"url":"/tunnel"');
    });
  });

  it("refuses CONNECT to a non-allowlisted host and CONNECT without a port", async () => {
    await withProxy(["safe.example.com"], async (port) => {
      expect((await connectViaProxy(port, `127.0.0.1:${tp}`)).statusLine).toContain("403");
      expect((await connectViaProxy(port, "safe.example.com")).statusLine).toContain("400");
    });
  });

  it("does not let a port-less rule reach arbitrary ports (80/443 only)", async () => {
    await withProxy(["127.0.0.1"], async (port) => {
      expect((await connectViaProxy(port, `127.0.0.1:${tp}`)).statusLine).toContain("403");
    });
  });

  it("never reaches loopback through a hostname rule (localhost -> 127.0.0.1)", async () => {
    await withProxy([`localhost:${tp}`], async (port) => {
      const r = await httpViaProxy(port, `http://localhost:${tp}/`);
      expect(r.status).toBe(403);
      expect(r.body).toContain("not permitted");
      expect((await connectViaProxy(port, `localhost:${tp}`)).statusLine).toContain("403");
    });
  });

  it("refuses cloud metadata endpoints, including IPv4-mapped IPv6 and integer forms", async () => {
    await withProxy(["*.amazonaws.com", "metadata.google.internal"], async (port) => {
      for (const authority of [
        "169.254.169.254:80",
        "[::ffff:169.254.169.254]:80",
        "[::ffff:a9fe:a9fe]:80",
        "[fd00:ec2::254]:80",
        "2852039166:80",
        "0xa9fea9fe:80",
      ]) {
        const r = await connectViaProxy(port, authority);
        expect(r.statusLine, authority).toMatch(/40[03]/);
      }
      expect((await httpViaProxy(port, "http://169.254.169.254/latest/meta-data/")).status).toBe(
        403,
      );
    });
  });

  it("does not let IP-literal aliases of an allowlisted IP slip through other rules", async () => {
    // 2130706433 == 127.0.0.1; as a CONNECT authority it is a (numeric) hostname, which
    // only exact-name rules could match, and none do.
    await withProxy([`127.0.0.1:${tp}`], async (port) => {
      expect((await connectViaProxy(port, `2130706433:${tp}`)).statusLine).toContain("403");
      expect((await connectViaProxy(port, `[::1]:${tp}`)).statusLine).toContain("403");
    });
  });
});

describe("egress proxy startup validation", () => {
  it("in-process proxy throws on an invalid allowlist", () => {
    expect(() => new EgressProxy({ allowlist: ["*"] })).toThrow(/egressAllowlist\[0\]/);
  });

  it("sidecar exits non-zero on an invalid allowlist", async () => {
    await expect(sidecar(["http://evil.example.com"])).rejects.toThrow(/exited 2/);
  });
});
