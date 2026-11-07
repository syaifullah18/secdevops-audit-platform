import http from "node:http";
import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EgressProxy } from "../src/proxy.js";

describe("EgressProxy", () => {
  describe("isAllowed helper", () => {
    it("handles exact host matches", () => {
      const proxy = new EgressProxy({
        allowlist: ["api.anthropic.com", "openai.com"],
      });
      expect(proxy.isAllowed("api.anthropic.com")).toBe(true);
      expect(proxy.isAllowed("API.ANTHROPIC.COM")).toBe(true);
      expect(proxy.isAllowed("openai.com")).toBe(true);
      expect(proxy.isAllowed("evil.com")).toBe(false);
      expect(proxy.isAllowed("anthropic.com")).toBe(false);
    });

    it("handles host:port specific rules", () => {
      const proxy = new EgressProxy({
        allowlist: ["localhost:8080", "127.0.0.1:3000"],
      });
      expect(proxy.isAllowed("localhost", 8080)).toBe(true);
      expect(proxy.isAllowed("localhost:8080")).toBe(true);
      expect(proxy.isAllowed("localhost", 9090)).toBe(false);
      expect(proxy.isAllowed("127.0.0.1", 3000)).toBe(true);
      expect(proxy.isAllowed("127.0.0.1", 4000)).toBe(false);
    });

    it("handles wildcard subdomain rules", () => {
      const proxy = new EgressProxy({
        allowlist: ["*.internal.corp", "*.aws.com"],
      });
      expect(proxy.isAllowed("git.internal.corp")).toBe(true);
      expect(proxy.isAllowed("sub.git.internal.corp")).toBe(true);
      expect(proxy.isAllowed("internal.corp")).toBe(true);
      expect(proxy.isAllowed("othercorp.com")).toBe(false);
      expect(proxy.isAllowed("s3.aws.com")).toBe(true);
    });

    it("blocks everything when allowlist is empty", () => {
      const proxy = new EgressProxy({ allowlist: [] });
      expect(proxy.isAllowed("localhost")).toBe(false);
      expect(proxy.isAllowed("google.com")).toBe(false);
      expect(proxy.isAllowed("127.0.0.1")).toBe(false);
    });
  });

  describe("Live proxy server", () => {
    let targetServer: http.Server;
    let targetPort: number;

    beforeAll(async () => {
      targetServer = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("target response: " + req.url);
      });
      await new Promise<void>((resolve) => {
        targetServer.listen(0, "127.0.0.1", () => {
          const addr = targetServer.address();
          if (addr && typeof addr === "object") {
            targetPort = addr.port;
          }
          resolve();
        });
      });
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => targetServer.close(() => resolve()));
    });

    it("allows HTTP requests to allowlisted hosts", async () => {
      const proxy = new EgressProxy({
        allowlist: [`127.0.0.1:${targetPort}`],
      });
      const { port: proxyPort } = await proxy.start();

      try {
        const responseText = await new Promise<string>((resolve, reject) => {
          const req = http.request(
            {
              host: "127.0.0.1",
              port: proxyPort,
              method: "GET",
              path: `http://127.0.0.1:${targetPort}/test`,
              headers: { Host: `127.0.0.1:${targetPort}` },
            },
            (res) => {
              expect(res.statusCode).toBe(200);
              let data = "";
              res.on("data", (chunk: Buffer) => (data += chunk.toString()));
              res.on("end", () => resolve(data));
            },
          );
          req.on("error", reject);
          req.end();
        });

        expect(responseText).toBe("target response: /test");
      } finally {
        await proxy.stop();
      }
    });

    it("blocks HTTP requests to non-allowlisted hosts with 403 Forbidden", async () => {
      const proxy = new EgressProxy({
        allowlist: ["allowed.example.com"],
      });
      const { port: proxyPort } = await proxy.start();

      try {
        const statusCode = await new Promise<number>((resolve, reject) => {
          const req = http.request(
            {
              host: "127.0.0.1",
              port: proxyPort,
              method: "GET",
              path: `http://127.0.0.1:${targetPort}/forbidden`,
              headers: { Host: `127.0.0.1:${targetPort}` },
            },
            (res) => {
              resolve(res.statusCode || 0);
            },
          );
          req.on("error", reject);
          req.end();
        });

        expect(statusCode).toBe(403);
      } finally {
        await proxy.stop();
      }
    });

    it("allows CONNECT tunneling to allowlisted hosts", async () => {
      const proxy = new EgressProxy({
        allowlist: [`127.0.0.1:${targetPort}`],
      });
      const { port: proxyPort } = await proxy.start();

      try {
        const responseData = await new Promise<string>((resolve, reject) => {
          const req = http.request({
            host: "127.0.0.1",
            port: proxyPort,
            method: "CONNECT",
            path: `127.0.0.1:${targetPort}`,
          });

          req.on("connect", (res, socket) => {
            expect(res.statusCode).toBe(200);

            socket.write(
              "GET /tunnel-test HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
            );

            let data = "";
            socket.on("data", (chunk: Buffer) => (data += chunk.toString()));
            socket.on("end", () => resolve(data));
          });

          req.on("error", reject);
          req.end();
        });

        expect(responseData).toContain("HTTP/1.1 200 OK");
        expect(responseData).toContain("target response: /tunnel-test");
      } finally {
        await proxy.stop();
      }
    });

    it("blocks CONNECT tunneling to non-allowlisted hosts", async () => {
      const proxy = new EgressProxy({
        allowlist: ["safe.domain.com"],
      });
      const { port: proxyPort } = await proxy.start();

      try {
        const socket = net.connect(proxyPort, "127.0.0.1", () => {
          socket.write(
            `CONNECT 127.0.0.1:${targetPort} HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\n\r\n`,
          );
        });

        const data = await new Promise<string>((resolve) => {
          let buffer = "";
          socket.on("data", (chunk) => (buffer += chunk.toString()));
          socket.on("close", () => resolve(buffer));
        });

        expect(data).toContain("HTTP/1.1 403 Forbidden");
        expect(data).toContain("Blocked by SDAP Egress Policy");
      } finally {
        await proxy.stop();
      }
    });
  });
});
