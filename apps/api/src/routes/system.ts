import type { FastifyPluginAsync } from "fastify";
import type { Store } from "@sdap/core";
import { type SdapMetrics, metricsHandler } from "../metrics.js";
import { getOpenApiSpec } from "../openapi.js";

export interface SystemRouteOptions {
  store: Store;
  metrics?: SdapMetrics;
  metricsBearerToken?: string;
}

/**
 * Unauthenticated operational endpoints. `/metrics` is served when metrics are provided.
 */
export const systemRoutes: FastifyPluginAsync<SystemRouteOptions> = async (app, opts) => {
  app.get("/healthz", async () => ({ status: "ok" }));

  app.get("/readyz", async (req, reply) => {
    try {
      await opts.store.ping();
      return { status: "ready" };
    } catch (err) {
      req.log.error({ err }, "readiness check failed");
      return reply.status(503).send({ status: "unavailable" });
    }
  });

  if (opts.metrics) {
    app.get(
      "/metrics",
      metricsHandler(opts.metrics.registry, { bearerToken: opts.metricsBearerToken }),
    );
  }

  app.get("/openapi.json", async () => getOpenApiSpec());
};
