import Fastify from "fastify";
import { Registry } from "prom-client";
import { describe, expect, it } from "vitest";
import { createMetrics, metricsHandler, sanitizeLabelValue } from "../src/metrics.js";

// Metric name -> agreed label names (documented in docs/workstreams/WS7.md).
const EXPECTED: Record<string, readonly string[]> = {
  sdap_findings: ["severity", "verdict", "status", "project"],
  sdap_runs_total: ["status", "mode", "project"],
  sdap_run_duration_seconds: ["mode", "status"],
  sdap_run_failures_total: ["phase", "reason"],
  sdap_queue_depth: ["queue", "state"],
  sdap_tokens_total: ["phase", "adapter", "model", "direction"],
  sdap_cost_usd_total: ["phase", "adapter", "model", "direction"],
  sdap_slice_attempts_total: ["phase", "adapter", "model", "outcome"],
  sdap_jev_decisions_total: ["key", "outcome"],
  sdap_jev_precision: ["key"],
};

describe("api createMetrics", () => {
  it("registers every sdap_ metric with the agreed label set", async () => {
    const { registry } = createMetrics();
    for (const [name, labels] of Object.entries(EXPECTED)) {
      const metric = registry.getSingleMetric(name);
      expect(metric, name).toBeDefined();
      // prom-client keeps labelNames as a runtime property but does not type it publicly.
      expect((metric as unknown as { labelNames: string[] }).labelNames, name).toEqual(labels);
    }
  });

  it("records values with exactly the expected labels and exposes them as text", async () => {
    const m = createMetrics();
    m.findings.set({ severity: "high", verdict: "confirmed", status: "new", project: "demo" }, 3);
    m.runsTotal.inc({ status: "succeeded", mode: "full", project: "demo" });
    m.runDurationSeconds.observe({ mode: "full", status: "succeeded" }, 42);
    m.runFailuresTotal.inc({ phase: "hunt", reason: "timeout" });
    m.queueDepth.set({ queue: "sdap-runs", state: "waiting" }, 5);
    const model = { phase: "hunt", adapter: "mock", model: "mock-1", direction: "input" };
    m.tokensTotal.inc(model, 1000);
    m.costUsdTotal.inc(model, 0.02);
    m.sliceAttemptsTotal.inc({
      phase: "hunt",
      adapter: "mock",
      model: "mock-1",
      outcome: "fallback",
    });
    m.jevDecisionsTotal.inc({ key: "change.touches_authz", outcome: "escalate" });
    m.jevPrecision.set({ key: "change.touches_authz" }, 0.8);

    const text = await m.registry.metrics();
    for (const name of Object.keys(EXPECTED)) expect(text).toContain(name);
    expect(text).toContain(
      'sdap_findings{severity="high",verdict="confirmed",status="new",project="demo"} 3',
    );
    expect(text).toContain("sdap_run_duration_seconds_bucket");
    expect(text).toContain("process_cpu_user_seconds_total");
  });

  it("rejects labels outside the agreed set", () => {
    const m = createMetrics();
    expect(() =>
      // @ts-expect-error title is not a label of sdap_findings
      m.findings.set({ severity: "high", verdict: "confirmed", status: "new", title: "x" }, 1),
    ).toThrow();
  });

  it("keeps registries independent", async () => {
    const a = createMetrics();
    const b = createMetrics(new Registry());
    a.runsTotal.inc({ status: "failed", mode: "focused", project: "p" });
    expect(await b.registry.metrics()).not.toContain('status="failed"');
  });
});

describe("sanitizeLabelValue", () => {
  it("strips whitespace, quotes and code characters and bounds the length", () => {
    expect(sanitizeLabelValue('SQL injection in `login()` {"x":1}')).toBe(
      "SQL_injection_in__login______x_:1_",
    );
    expect(sanitizeLabelValue("a".repeat(500))).toHaveLength(64);
    expect(sanitizeLabelValue("")).toBe("unknown");
    expect(sanitizeLabelValue("gemini-3.8-flash")).toBe("gemini-3.8-flash");
  });
});

describe("metricsHandler", () => {
  const build = async (bearerToken?: string) => {
    const metrics = createMetrics();
    metrics.runsTotal.inc({ status: "succeeded", mode: "full", project: "demo" });
    const app = Fastify();
    app.get("/metrics", metricsHandler(metrics.registry, { bearerToken }));
    await app.ready();
    return app;
  };

  it("serves Prometheus text containing sdap_ names", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toContain("sdap_runs_total");
    await app.close();
  });

  it("requires the bearer token when one is configured", async () => {
    const app = await build("s3cret-token");
    expect((await app.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(401);
    const bad = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: "Bearer s3cret-token" },
    });
    expect(ok.statusCode).toBe(200);
    await app.close();
  });
});
