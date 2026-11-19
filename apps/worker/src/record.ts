import type { Run, Slice, Store } from "@sdap/core";
import { sanitizeLabelValue, type SdapMetrics } from "./metrics.js";

/** First word of a free-form failure reason, as a bounded label ("timeout: ..." -> "timeout"). */
const reasonCode = (reason: string | null): string =>
  sanitizeLabelValue((reason ?? "unknown").split(/[\s:]/)[0] ?? "unknown", 40);

const outcomeOf = (a: Slice["attempts"][number], index: number): string => {
  if (a.status === "succeeded") return index > 0 ? "fallback" : "success";
  if (/timeout/i.test(a.errorCode ?? "")) return "timeout";
  return "failure";
};

/**
 * Records what a finished run cost and how it went. Called once per run from the worker, after
 * the pipeline returns. Labels are bounded: ids, enums, adapter and model names.
 */
export async function recordRunMetrics(
  metrics: SdapMetrics,
  store: Store,
  run: Run,
): Promise<void> {
  const project = sanitizeLabelValue(run.projectId);
  metrics.runsTotal.inc({ status: run.status, mode: run.mode, project });

  if (run.startedAt && run.endedAt) {
    const seconds = (Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000;
    if (Number.isFinite(seconds) && seconds >= 0) {
      metrics.runDurationSeconds.observe({ mode: run.mode, status: run.status }, seconds);
    }
  }

  if (run.status === "failed") {
    const failed = run.phases.find((p) => p.status === "failed");
    metrics.runFailuresTotal.inc({
      phase: failed?.name ?? "unknown",
      reason: reasonCode(run.failureReason),
    });
  }

  const slices = await store.runs.listSlices(run.id);
  for (const slice of slices) {
    slice.attempts.forEach((a, i) => {
      const labels = {
        phase: slice.phase,
        adapter: sanitizeLabelValue(a.model.adapter),
        model: sanitizeLabelValue(a.model.model),
      };
      metrics.sliceAttemptsTotal.inc({ ...labels, outcome: outcomeOf(a, i) });
      metrics.tokensTotal.inc({ ...labels, direction: "input" }, a.usage.inputTokens);
      metrics.tokensTotal.inc({ ...labels, direction: "output" }, a.usage.outputTokens);
      // Cost is recorded per attempt, not split by direction.
      metrics.costUsdTotal.inc({ ...labels, direction: "total" }, a.usage.costUsd);
    });
  }
}
