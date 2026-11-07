import type { FastifyPluginAsync } from "fastify";
import type { Store } from "@sdap/core";
import { getOpenApiSpec } from "../openapi.js";

export interface SystemRouteOptions {
  store: Store;
}

/**
 * Unauthenticated operational endpoints. `/metrics` is intentionally absent: WS7 owns the
 * metrics module and wires it in Phase 2.
 */
export const systemRoutes: FastifyPluginAsync<SystemRouteOptions> = async (app, opts) => {
  app.get("/healthz", async () => ({ status: "ok" }));

  app.get("/readyz", async (req, reply) => {
    try {
      // An empty scope matches no client: a cheap round trip to the store, no data returned.
      await opts.store.projects.list({ clientIds: [] });
      return { status: "ready" };
    } catch (err) {
      req.log.error({ err }, "readiness check failed");
      return reply.status(503).send({ status: "unavailable" });
    }
  });

  app.get("/openapi.json", async () => getOpenApiSpec());
};
