import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
  type CounterConfiguration,
} from "prom-client";

/**
 * Prometheus metrics for the API process (WS7).
 *
 * The metric names and label sets are a contract shared with the worker (`apps/worker/src/metrics.ts`),
 * the Grafana dashboards and the alert rules in `deploy/`. Labels carry only bounded enums or ids:
 * never finding titles, file paths or code. Use `sanitizeLabelValue` for any free-form value
 * (model names, adapter names, failure reasons).
 *
 * The handles are not wired into routes yet (Phase 2); only `metricsHandler` is ready to mount.
 */

export const METRIC_PREFIX = "sdap_";

/** Duration buckets (seconds): runs take from seconds (fake adapter) to hours (full audits). */
export const RUN_DURATION_BUCKETS = [
  1, 5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200, 14400,
] as const;

export type TokenDirection = "input" | "output";
export type SliceOutcome = "success" | "failure" | "fallback" | "timeout";
export type QueueState = "waiting" | "active" | "delayed" | "failed" | "completed";

/** A string label that is restricted to a bounded charset and length (no titles, no code). */
export const sanitizeLabelValue = (value: string, maxLength = 64): string => {
  const cleaned = value.replace(/[^A-Za-z0-9._:/@-]/g, "_").slice(0, maxLength);
  return cleaned.length > 0 ? cleaned : "unknown";
};

export interface SdapMetrics {
  registry: Registry;
  findings: Gauge<"severity" | "verdict" | "status" | "project">;
  runsTotal: Counter<"status" | "mode" | "project">;
  runDurationSeconds: Histogram<"mode" | "status">;
  runFailuresTotal: Counter<"phase" | "reason">;
  queueDepth: Gauge<"queue" | "state">;
  tokensTotal: Counter<"phase" | "adapter" | "model" | "direction">;
  costUsdTotal: Counter<"phase" | "adapter" | "model" | "direction">;
  sliceAttemptsTotal: Counter<"phase" | "adapter" | "model" | "outcome">;
  jevDecisionsTotal: Counter<"key" | "outcome">;
  jevPrecision: Gauge<"key">;
}

/**
 * Registers all SDAP metrics plus default process metrics on `registry` (a fresh one by default,
 * so tests and multiple instances never collide on the global registry).
 */
export const createMetrics = (registry: Registry = new Registry()): SdapMetrics => {
  collectDefaultMetrics({ register: registry });
  const counter = <K extends string>(config: CounterConfiguration<K>) =>
    new Counter<K>({ ...config, registers: [registry] });

  return {
    registry,
    findings: new Gauge({
      name: "sdap_findings",
      help: "Findings currently stored, by severity, verdict, triage status and project.",
      labelNames: ["severity", "verdict", "status", "project"] as const,
      registers: [registry],
    }),
    runsTotal: counter({
      name: "sdap_runs_total",
      help: "Audit runs that reached a status, by status, mode and project.",
      labelNames: ["status", "mode", "project"] as const,
    }),
    runDurationSeconds: new Histogram({
      name: "sdap_run_duration_seconds",
      help: "Wall-clock duration of finished audit runs.",
      labelNames: ["mode", "status"] as const,
      buckets: [...RUN_DURATION_BUCKETS],
      registers: [registry],
    }),
    runFailuresTotal: counter({
      name: "sdap_run_failures_total",
      help: "Run failures by pipeline phase and reason code.",
      labelNames: ["phase", "reason"] as const,
    }),
    queueDepth: new Gauge({
      name: "sdap_queue_depth",
      help: "Jobs in a queue, by queue name and BullMQ state.",
      labelNames: ["queue", "state"] as const,
      registers: [registry],
    }),
    tokensTotal: counter({
      name: "sdap_tokens_total",
      help: "Model tokens consumed, by phase, adapter, model and direction (input/output).",
      labelNames: ["phase", "adapter", "model", "direction"] as const,
    }),
    costUsdTotal: counter({
      name: "sdap_cost_usd_total",
      help: "Model cost in USD, by phase, adapter, model and direction (input/output).",
      labelNames: ["phase", "adapter", "model", "direction"] as const,
    }),
    sliceAttemptsTotal: counter({
      name: "sdap_slice_attempts_total",
      help: "Hunt/validate slice attempts per model; fallbacks show as outcome=fallback.",
      labelNames: ["phase", "adapter", "model", "outcome"] as const,
    }),
    jevDecisionsTotal: counter({
      name: "sdap_jev_decisions_total",
      help: "System 1 (Jev) decisions by question key and outcome. Advisory only.",
      labelNames: ["key", "outcome"] as const,
    }),
    jevPrecision: new Gauge({
      name: "sdap_jev_precision",
      help: "System 1 (Jev) precision against System 2 verdicts, by question key (0..1).",
      labelNames: ["key"] as const,
      registers: [registry],
    }),
  };
};

export interface MetricsHandlerOptions {
  /**
   * When set, requests must carry `Authorization: Bearer <token>`. Leave unset only when the
   * endpoint is reachable from the monitoring network alone.
   */
  bearerToken?: string;
}

const tokenMatches = (header: string | undefined, expected: string): boolean => {
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix)) return false;
  const given = Buffer.from(header.slice(prefix.length));
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
};

/**
 * Fastify handler serving the Prometheus text exposition. Mount with
 * `app.get("/metrics", metricsHandler(metrics.registry, { bearerToken }))` in Phase 2.
 */
export const metricsHandler =
  (registry: Registry, options: MetricsHandlerOptions = {}) =>
  async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    if (options.bearerToken && !tokenMatches(req.headers.authorization, options.bearerToken)) {
      return reply.status(401).header("www-authenticate", "Bearer").send({ error: "unauthorized" });
    }
    return reply
      .header("content-type", registry.contentType)
      .header("cache-control", "no-store")
      .send(await registry.metrics());
  };
