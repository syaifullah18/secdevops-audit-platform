import * as http from "node:http";
import type { AddressInfo } from "node:net";

export interface MockRouteHandler {
  (req: http.IncomingMessage, res: http.ServerResponse, body: string): void | Promise<void>;
}

export class MockHttpServer {
  private server: http.Server | null = null;
  private routes: Array<{
    method: string;
    pattern: RegExp;
    handler: MockRouteHandler;
  }> = [];

  on(method: string, pathRegex: RegExp | string, handler: MockRouteHandler): this {
    const pattern = typeof pathRegex === "string" ? new RegExp(`^${pathRegex}$`) : pathRegex;
    this.routes.push({ method: method.toUpperCase(), pattern, handler });
    return this;
  }

  async start(): Promise<string> {
    return new Promise((resolve) => {
      this.server = http.createServer(async (req, res) => {
        const method = (req.method ?? "GET").toUpperCase();
        const url = req.url ?? "/";
        const pathname = url.split("?")[0] || "/";

        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", async () => {
          const body = Buffer.concat(chunks).toString("utf-8");

          // Strip optional /api/v1 prefix for uniform route matching
          const normalizedPath = pathname.replace(/^\/api\/v1/, "");

          const match = this.routes.find(
            (r) =>
              (r.method === method || r.method === "ALL") &&
              (r.pattern.test(pathname) || r.pattern.test(normalizedPath)),
          );

          if (match) {
            try {
              await match.handler(req, res, body);
            } catch (err) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "handler_error", message: String(err) }));
            }
          } else {
            res.statusCode = 404;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({ error: "not_found", message: `No route for ${method} ${pathname}` }),
            );
          }
        });
      });

      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server?.address() as AddressInfo;
        resolve(`http://127.0.0.1:${addr.port}`);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
