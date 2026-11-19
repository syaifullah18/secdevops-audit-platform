import type { Run, Slice } from "@sdap/core";
import { describe, expect, it } from "vitest";
import { createMetrics } from "../src/metrics.js";
import { recordRunMetrics } from "../src/record.js";

const usage = (i: number, o: number, c: number) => ({
  inputTokens: i,
  outputTokens: o,
  costUsd: c,
});

const run = {
  id: "run-1",
  projectId: "proj-1",
  mode: "full",
  status: "failed",
  failureReason: "timeout: hunt exceeded budget",
  startedAt: "2026-01-01T00:00:00.000Z",
  endedAt: "2026-01-01T00:01:00.000Z",
  phases: [{ name: "hunt", status: "failed" }],
} as unknown as Run;

const slice = {
  phase: "hunt",
  attempts: [
    {
      model: { adapter: "mock", model: "m1" },
      status: "failed",
      errorCode: "timeout",
      usage: usage(10, 1, 0.1),
    },
    {
      model: { adapter: "mock", model: "m2" },
      status: "succeeded",
      errorCode: null,
      usage: usage(20, 2, 0.2),
    },
  ],
} as unknown as Slice;

describe("recordRunMetrics", () => {
  it("records run status, duration, failure, slice outcomes, tokens and cost", async () => {
    const m = createMetrics();
    await recordRunMetrics(m, { runs: { listSlices: async () => [slice] } } as never, run);
    const text = await m.registry.metrics();
    expect(text).toContain('sdap_runs_total{status="failed",mode="full",project="proj-1"} 1');
    expect(text).toContain('sdap_run_duration_seconds_count{mode="full",status="failed"} 1');
    expect(text).toContain('sdap_run_failures_total{phase="hunt",reason="timeout"} 1');
    expect(text).toContain('outcome="timeout"');
    expect(text).toContain('outcome="fallback"');
    expect(text).toMatch(/sdap_tokens_total\{[^}]*model="m2"[^}]*direction="input"\} 20/);
    expect(text).toMatch(/sdap_cost_usd_total\{[^}]*model="m2"[^}]*\} 0\.2/);
  });
});
