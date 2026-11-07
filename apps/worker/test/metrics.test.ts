import type { AddressInfo } from "node:net";
import { Registry } from "prom-client";
import { describe, expect, it } from "vitest";
import { createMetrics, sanitizeLabelValue, startMetricsServer } from "../src/metrics.js";

const NAMES = [
  "sdap_findings",
  "sdap_runs_total",
  "sdap_run_duration_seconds",
  "sdap_run_failures_total",
  "sdap_queue_depth",
  "sdap_tokens_total",
  "sdap_cost_usd_total",
  "sdap_slice_attempts_total",
  "sdap_jev_decisions_total",
  "sdap_jev_precision",
];

describe("worker createMetrics", () => {
  it("registers every sdap_ metric and the default process metrics", async () => {
    const m = createMetrics();
    for (const name of NAMES) expect(m.registry.getSingleMetric(name), name).toBeDefined();
    expect(await m.registry.metrics()).toContain("process_cpu_user_seconds_total");
  });

  it("records the agreed label sets", async () => {
    const m = createMetrics();
    m.findings.set({ severity: "critical", verdict: "confirmed", status: "new", project: "p" }, 1);
    m.runsTotal.inc({ status: "running", mode: "incremental", project: "p" });
    m.runDurationSeconds.observe({ mode: "full", status: "failed" }, 3);
    m.runFailuresTotal.inc({ phase: "validate", reason: "model_unavailable" });
    m.queueDepth.set({ queue: "sdap-runs", state: "active" }, 2);
    const labels = { phase: "validate", adapter: "mock", model: "m", direction: "output" };
    m.tokensTotal.inc(labels, 10);
    m.costUsdTotal.inc(labels, 0.01);
    m.sliceAttemptsTotal.inc({ phase: "hunt", adapter: "mock", model: "m", outcome: "success" });
    m.jevDecisionsTotal.inc({ key: "candidate.likely_fp", outcome: "keep" });
    m.jevPrecision.set({ key: "candidate.likely_fp" }, 0.5);
    const text = await m.registry.metrics();
    for (const name of NAMES) expect(text).toContain(name);
    expect(text).toContain(
      'sdap_slice_attempts_total{phase="hunt",adapter="mock",model="m",outcome="success"} 1',
    );
  });

  it("rejects labels outside the agreed set", () => {
    const m = createMetrics(new Registry());
    expect(() =>
      // @ts-expect-error code is not a label of sdap_run_failures_total
      m.runFailuresTotal.inc({ phase: "hunt", reason: "x", code: "select *" }),
    ).toThrow();
  });

  it("sanitizes free-form label values", () => {
    expect(sanitizeLabelValue("a title with spaces")).toBe("a_title_with_spaces");
  });
});

describe("startMetricsServer", () => {
  const withServer = async (
    bearerToken: string | undefined,
    fn: (base: string) => Promise<void>,
  ) => {
    const m = createMetrics();
    m.runsTotal.inc({ status: "succeeded", mode: "full", project: "demo" });
    const server = await startMetricsServer(m.registry, {
      port: 0,
      host: "127.0.0.1",
      bearerToken,
    });
    try {
      await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  };

  it("serves /metrics text with sdap_ names and /healthz", async () => {
    await withServer(undefined, async (base) => {
      const res = await fetch(`${base}/metrics`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("sdap_runs_total");
      expect((await fetch(`${base}/healthz`)).status).toBe(200);
      expect((await fetch(`${base}/nope`)).status).toBe(404);
    });
  });

  it("enforces the bearer token", async () => {
    await withServer("tok-123", async (base) => {
      expect((await fetch(`${base}/metrics`)).status).toBe(401);
      const ok = await fetch(`${base}/metrics`, { headers: { authorization: "Bearer tok-123" } });
      expect(ok.status).toBe(200);
    });
  });
});
