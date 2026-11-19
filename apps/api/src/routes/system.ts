import type { FastifyPluginAsync } from "fastify";
import { QUEUE_NAMES, type Store } from "@sdap/core";
import type { Queue } from "../queue.js";
import { type SdapMetrics, metricsHandler, sanitizeLabelValue } from "../metrics.js";
import { getOpenApiSpec } from "../openapi.js";

export interface SystemRouteOptions {
  store: Store;
  metrics?: SdapMetrics;
  queue?: Queue;
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
    const metrics = opts.metrics;
    // Gauges are computed from the store and queue when Prometheus scrapes.
    const refresh = async (): Promise<void> => {
      const counts = new Map<string, number>();
      const scope = { clientIds: "*" } as const;
      for (const project of await opts.store.projects.list(scope)) {
        let cursor: string | undefined;
        do {
          const page = await opts.store.findings.query(
            {
              projectId: project.id,
              includeRejected: true,
              limit: 500,
              ...(cursor ? { cursor } : {}),
            },
            scope,
          );
          for (const f of page.items) {
            const key = [
              f.verifiedSeverity ?? "none",
              f.verdict,
              f.status,
              sanitizeLabelValue(project.id),
            ].join("\u0000");
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
      }
      metrics.findings.reset();
      for (const [key, n] of counts) {
        const [severity, verdict, status, project] = key.split("\u0000") as [
          string,
          string,
          string,
          string,
        ];
        metrics.findings.set({ severity, verdict, status, project }, n);
      }
      if (opts.queue?.counts) {
        for (const [state, n] of Object.entries(await opts.queue.counts())) {
          metrics.queueDepth.set({ queue: QUEUE_NAMES.runs, state }, n);
        }
      }
    };
    app.get(
      "/metrics",
      metricsHandler(metrics.registry, {
        bearerToken: opts.metricsBearerToken,
        beforeScrape: refresh,
      }),
    );
  }

  app.get("/openapi.json", async () => getOpenApiSpec());
};
