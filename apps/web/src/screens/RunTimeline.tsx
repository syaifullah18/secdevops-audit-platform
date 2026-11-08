import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client.js";
import type { Run, Slice, PlatformEvent } from "@sdap/core";
import { Icon } from "../components/Icon.js";
import {
  ErrorBanner,
  Loading,
  Panel,
  Pill,
  Stat,
  btn,
  cx,
  tableCls,
  type Tone,
} from "../components/stitch.js";

const statusTone = (s: string): Tone =>
  s === "succeeded" || s === "passed"
    ? "verified"
    : s === "running"
      ? "low"
      : s === "failed"
        ? "critical"
        : "neutral";

export function RunTimelineScreen() {
  const { id } = useParams<{ id: string }>();

  const [run, setRun] = useState<Run | null>(null);
  const [slices, setSlices] = useState<Slice[]>([]);
  const [events, setEvents] = useState<PlatformEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [liveConnected] = useState(true);

  useEffect(() => {
    if (!id) return;
    let mounted = true;

    async function load() {
      try {
        setLoading(true);
        const [r, s, evs] = await Promise.all([
          api.getRun(id!),
          api.getRunSlices(id!),
          api.getRunEvents(id!),
        ]);

        if (mounted) {
          setRun(r);
          setSlices(s);
          setEvents(evs);
        }
      } catch (err: unknown) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to load run");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();

    // Subscribe to live SSE updates
    const unsubscribe = api.subscribeToRunEvents(id, (ev) => {
      if (!mounted) return;
      setEvents((prev) => [...prev, ev]);

      // Apply real-time event updates to run and slices
      if (ev.type === "run.completed" || ev.type === "run.failed" || ev.type === "run.cancelled") {
        setRun((prev) =>
          prev ? { ...prev, status: ev.type.replace("run.", "") as Run["status"] } : null,
        );
      }
      if (ev.type === "validator.done") {
        setRun((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            validators: {
              ...prev.validators,
              [ev.payload.validator === "coverage_ledger" ? "coverageLedger" : "findings"]:
                ev.payload.status,
            },
          };
        });
      }
      if (ev.type === "slice.done" || ev.type === "slice.attempt_failed") {
        // Refresh slices on slice events
        api.getRunSlices(id).then((freshSlices) => {
          if (mounted) setSlices(freshSlices);
        });
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [id]);

  const handleCancelRun = async () => {
    if (!id || !run) return;
    setCancelling(true);
    try {
      await api.cancelRun(id);
      setRun((prev) => (prev ? { ...prev, status: "cancelled" } : null));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to cancel run");
    } finally {
      setCancelling(false);
    }
  };

  if (loading) return <Loading>Loading audit run timeline...</Loading>;
  if (error || !run)
    return <ErrorBanner>Error loading run: {error || "Run not found"}</ErrorBanner>;

  const durationSec =
    run.startedAt && run.endedAt
      ? Math.round((new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
      : null;
  const live = run.status === "running" || run.status === "queued";

  return (
    <div className="flex flex-col gap-6" data-testid="run-timeline-screen">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-xl font-bold font-headline tracking-tight">
                Run #{run.id.slice(0, 8)}
              </h2>
              <span data-testid="run-status-badge">
                <Pill tone={statusTone(run.status)} className="text-xs">
                  {run.status.toUpperCase()}
                </Pill>
              </span>
              <Pill>{run.mode}</Pill>
              <Pill icon="bolt">Triggered by {run.trigger.kind.replace("_", " ")}</Pill>
            </div>
            <div className="mt-2 text-xs text-on-surface-variant">
              Git Ref: <code className="font-mono text-on-surface">{run.ref}</code>{" "}
              {run.commitSha ? `(${run.commitSha.slice(0, 7)})` : ""} · Skill:{" "}
              <code className="font-mono text-on-surface">{run.skillVersion}</code>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span
              title={live ? "SSE live updates stream active" : "Run is not streaming"}
              data-testid="live-sse-indicator"
              className="inline-flex items-center gap-1.5 text-xs text-on-surface-variant"
            >
              <span
                className={cx(
                  "h-2 w-2 rounded-full",
                  liveConnected && live ? "bg-verified-ink animate-pulse" : "bg-outline-variant",
                )}
              />
              <span>Live SSE</span>
            </span>
            {live && (
              <button
                type="button"
                className={btn.danger}
                onClick={handleCancelRun}
                disabled={cancelling}
                data-testid="cancel-run-button"
              >
                {cancelling ? "Cancelling..." : "Cancel Run"}
              </button>
            )}
            <Link to={`/projects/${run.projectId}`} className={btn.secondary}>
              Back to Project
            </Link>
          </div>
        </div>
        {run.failureReason && (
          <div
            role="alert"
            data-testid="failure-reason"
            className="mt-4 rounded-md border border-sev-critical-border bg-sev-critical-bg text-sev-critical-ink px-4 py-3 text-xs"
          >
            <strong>Run failed, so this is not a clean result:</strong> {run.failureReason}
          </div>
        )}
        <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat
            label="Execution Time"
            value={durationSec !== null ? `${durationSec}s` : "In progress"}
            sub={`Started: ${run.startedAt ? new Date(run.startedAt).toLocaleTimeString() : "Queued"}`}
          />
          <Stat
            label="Token Cost"
            value={`$${run.usage.costUsd.toFixed(3)}`}
            sub="USD estimated expenditure"
          />
          <Stat
            label="Input Tokens"
            value={run.usage.inputTokens.toLocaleString()}
            sub="Prompt & context ingestion"
          />
          <Stat
            label="Output Tokens"
            value={run.usage.outputTokens.toLocaleString()}
            sub="Generation & reasoning"
          />
        </div>
      </Panel>

      <Panel
        testId="phases-card"
        title="Pipeline Execution Phases"
        subtitle="Sequential execution flow through the security-audit-skill lifecycle"
      >
        <ol className="flex flex-wrap gap-y-4 mb-5" aria-label="Pipeline stepper">
          {run.phases.map((phase, i) => (
            <li key={phase.name} className="flex items-center">
              <div className="flex flex-col items-center gap-1.5 w-24">
                <span
                  className={cx(
                    "h-8 w-8 rounded-full border-2 flex items-center justify-center text-xs font-bold",
                    phase.status === "succeeded" &&
                      "bg-verified-bg border-verified-ink text-verified-ink",
                    phase.status === "running" &&
                      "bg-sev-low-bg border-sev-low-ink text-sev-low-ink animate-pulse",
                    phase.status === "failed" &&
                      "bg-sev-critical-bg border-sev-critical-ink text-sev-critical-ink",
                    phase.status !== "succeeded" &&
                      phase.status !== "running" &&
                      phase.status !== "failed" &&
                      "border-outline-variant text-on-surface-variant",
                  )}
                >
                  {phase.status === "succeeded" ? (
                    <Icon name="check" className="text-[16px]" />
                  ) : phase.status === "failed" ? (
                    <Icon name="close" className="text-[16px]" />
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="text-[11px] font-medium capitalize text-center">{phase.name}</span>
              </div>
              {i < run.phases.length - 1 && (
                <span className="h-px w-6 bg-outline-variant -mt-5" aria-hidden="true" />
              )}
            </li>
          ))}
        </ol>
        <div className={tableCls.wrap}>
          <table className={tableCls.table}>
            <thead>
              <tr className={tableCls.headRow}>
                {["Phase", "Status", "Slices", "Tokens", "Cost"].map((h) => (
                  <th key={h} className={tableCls.th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {run.phases.map((phase) => (
                <tr key={phase.name} className={tableCls.row}>
                  <td className={`${tableCls.td} font-semibold capitalize`}>{phase.name}</td>
                  <td className={tableCls.td}>
                    <Pill tone={statusTone(phase.status)}>{phase.status}</Pill>
                  </td>
                  <td className={`${tableCls.td} font-mono`}>
                    {phase.slicesDone} / {phase.sliceCount}
                  </td>
                  <td className={`${tableCls.td} font-mono`}>
                    {(phase.usage.inputTokens + phase.usage.outputTokens).toLocaleString()}
                  </td>
                  <td className={`${tableCls.td} font-mono`}>${phase.usage.costUsd.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel
          testId="validators-card"
          title="Automated Skill Validators"
          subtitle="Node.js validation checks enforcing skill schema integrity"
        >
          <div className="flex flex-col gap-3">
            {[
              [
                "Findings Schema Validator",
                "validate-findings.cjs",
                run.validators.findings,
                "validator-findings-status",
              ],
              [
                "Coverage Ledger Validator",
                "validate-coverage-ledger.cjs",
                run.validators.coverageLedger,
                "validator-coverage-status",
              ],
            ].map(([name, file, status, testId]) => (
              <div
                key={testId}
                className="flex items-center justify-between rounded-md bg-surface-container-low border border-outline-variant/40 px-3 py-2.5"
              >
                <div>
                  <div className="text-sm font-semibold">{name}</div>
                  <div className="text-[11px] font-mono text-on-surface-variant">{file}</div>
                </div>
                <span data-testid={testId}>
                  <Pill tone={statusTone(String(status))}>{status}</Pill>
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          testId="artifacts-card"
          title="Generated Report Artifacts"
          subtitle="Audit records and skill deliverables persisted to storage"
        >
          <div className="flex flex-col gap-2 text-xs">
            {Object.entries(run.artifacts).map(([key, path]) => (
              <div
                key={key}
                className="flex items-center justify-between rounded-md border border-outline-variant/40 px-3 py-2"
              >
                <span className="font-medium">{key}</span>
                {path ? (
                  <span
                    title={path}
                    className="inline-flex items-center gap-1 font-mono text-on-surface-variant"
                  >
                    <Icon name="description" className="text-[14px]" />
                    {path.split("/").pop()}
                  </span>
                ) : (
                  <span className="text-on-surface-variant">Pending</span>
                )}
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel
        testId="slices-card"
        title="Parallel Work Slices & Model Fallback Chains"
        subtitle="Per-slice attempt log showing primary model routing and fallback attempts"
      >
        <div className="flex flex-col gap-4">
          {slices.map((slice) => (
            <div
              key={slice.id}
              data-testid={`slice-item-${slice.id}`}
              className="rounded-md border border-outline-variant/50 p-4 flex flex-col gap-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Pill tone={statusTone(slice.status)}>{slice.status}</Pill>
                  <strong className="text-sm">{slice.label}</strong>
                  {slice.attackClass && <Pill>{slice.attackClass}</Pill>}
                </div>
                <span className="text-[11px] text-on-surface-variant">
                  Phase: {slice.phase} · {slice.attempts.length} Attempt(s)
                </span>
              </div>
              <ol className="flex flex-col gap-2">
                {slice.attempts.map((att) => (
                  <li
                    key={att.attempt}
                    data-testid={`slice-attempt-${slice.id}-${att.attempt}`}
                    className={cx(
                      "rounded-md border px-3 py-2.5 text-xs flex flex-col gap-1",
                      att.status === "failed"
                        ? "bg-sev-critical-bg/50 border-sev-critical-border"
                        : "bg-surface-container-low border-outline-variant/40",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">Attempt #{att.attempt}:</span>
                      <code className="font-mono">
                        {att.model.adapter}/{att.model.model}
                      </code>
                      <Pill tone={statusTone(att.status)}>{att.status}</Pill>
                    </div>
                    {att.status === "failed" && att.errorCode && (
                      <div className="text-sev-critical-ink">
                        Failure: <strong>{att.errorCode}</strong> -{" "}
                        {att.errorMessage || "Triggered secondary model fallback"}
                      </div>
                    )}
                    <div className="text-on-surface-variant font-mono">
                      Usage: {(att.usage.inputTokens + att.usage.outputTokens).toLocaleString()}{" "}
                      tokens (${att.usage.costUsd.toFixed(3)})
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        testId="events-stream-card"
        title="Live Event Stream Log"
        subtitle="Real-time event ledger dispatched over SSE (sdap:events)"
      >
        <div
          role="log"
          aria-live="polite"
          className="max-h-56 overflow-y-auto rounded-lg bg-[#0B0F19] border border-zinc-800 p-3 font-mono text-xs flex flex-col gap-1"
        >
          {events.map((ev) => (
            <div key={ev.id} className="flex gap-2 text-zinc-300">
              <span className="text-zinc-500">[{ev.seq}]</span>
              <span className="text-zinc-500">{ev.at.slice(11, 19)}</span>
              <strong className="text-emerald-400">{ev.type}</strong>
              <span className="break-all text-zinc-400">{JSON.stringify(ev.payload)}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
