import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client.js";
import type { Run, Slice, PlatformEvent } from "@sdap/core";

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

  if (loading) {
    return <div data-testid="loading-indicator">Loading audit run timeline...</div>;
  }

  if (error || !run) {
    return (
      <div role="alert" style={{ color: "var(--critical)" }}>
        Error loading run: {error || "Run not found"}
      </div>
    );
  }

  const durationSec =
    run.startedAt && run.endedAt
      ? Math.round((new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
      : null;

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: "24px" }}
      data-testid="run-timeline-screen"
    >
      {/* Run Overview Card */}
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span
                className={`badge ${
                  run.status === "succeeded"
                    ? "badge-success"
                    : run.status === "running"
                      ? "badge-low"
                      : run.status === "failed"
                        ? "badge-critical"
                        : "badge-info"
                }`}
                style={{ fontSize: "0.85rem", padding: "4px 10px" }}
                data-testid="run-status-badge"
              >
                {run.status.toUpperCase()}
              </span>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 700 }}>Run {run.id.slice(0, 8)}</h2>
              <span className="badge badge-info">{run.mode} mode</span>
            </div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "6px" }}>
              Git Ref: <code>{run.ref}</code>{" "}
              {run.commitSha ? `(${run.commitSha.slice(0, 7)})` : ""} · Skill:{" "}
              <code>{run.skillVersion}</code>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "0.8rem",
                color: liveConnected ? "var(--success)" : "var(--text-muted)",
              }}
              title="SSE live updates stream active"
              data-testid="live-sse-indicator"
            >
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: liveConnected ? "var(--success)" : "var(--text-muted)",
                }}
              />
              <span>Live SSE</span>
            </div>

            {(run.status === "running" || run.status === "queued") && (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={handleCancelRun}
                disabled={cancelling}
                data-testid="cancel-run-button"
              >
                {cancelling ? "Cancelling..." : "Cancel Run"}
              </button>
            )}

            <Link to={`/projects/${run.projectId}`} className="btn btn-secondary btn-sm">
              Back to Project
            </Link>
          </div>
        </div>

        {/* Accounting & Resource Usage */}
        <div className="metrics-grid">
          <div className="metric-card">
            <span className="metric-label">Execution Time</span>
            <span className="metric-value">
              {durationSec !== null ? `${durationSec}s` : "In progress"}
            </span>
            <span className="metric-sub">
              Started: {run.startedAt ? new Date(run.startedAt).toLocaleTimeString() : "Queued"}
            </span>
          </div>

          <div className="metric-card">
            <span className="metric-label">Token Cost</span>
            <span className="metric-value">${run.usage.costUsd.toFixed(3)}</span>
            <span className="metric-sub">USD estimated expenditure</span>
          </div>

          <div className="metric-card">
            <span className="metric-label">Input Tokens</span>
            <span className="metric-value">{run.usage.inputTokens.toLocaleString()}</span>
            <span className="metric-sub">Prompt & context ingestion</span>
          </div>

          <div className="metric-card">
            <span className="metric-label">Output Tokens</span>
            <span className="metric-value">{run.usage.outputTokens.toLocaleString()}</span>
            <span className="metric-sub">Generation & reasoning</span>
          </div>
        </div>
      </div>

      {/* Validator Status & Report Artifacts */}
      <div className="side-by-side">
        {/* Validator Status Card */}
        <div className="card" data-testid="validators-card">
          <h3 className="card-title">Automated Skill Validators</h3>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "16px" }}>
            Node.js validation checks enforcing skill schema integrity
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 14px",
                backgroundColor: "var(--surface-raised)",
                borderRadius: "var(--radius)",
              }}
            >
              <div>
                <strong>Findings Schema Validator</strong>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  validate-findings.cjs
                </div>
              </div>
              <span
                className={`badge ${
                  run.validators.findings === "passed"
                    ? "badge-success"
                    : run.validators.findings === "failed"
                      ? "badge-critical"
                      : "badge-info"
                }`}
                data-testid="validator-findings-status"
              >
                {run.validators.findings}
              </span>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 14px",
                backgroundColor: "var(--surface-raised)",
                borderRadius: "var(--radius)",
              }}
            >
              <div>
                <strong>Coverage Ledger Validator</strong>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  validate-coverage-ledger.cjs
                </div>
              </div>
              <span
                className={`badge ${
                  run.validators.coverageLedger === "passed"
                    ? "badge-success"
                    : run.validators.coverageLedger === "failed"
                      ? "badge-critical"
                      : "badge-info"
                }`}
                data-testid="validator-coverage-status"
              >
                {run.validators.coverageLedger}
              </span>
            </div>
          </div>
        </div>

        {/* Report Artifacts Card */}
        <div className="card" data-testid="artifacts-card">
          <h3 className="card-title">Generated Report Artifacts</h3>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "16px" }}>
            Audit records and skill deliverables persisted to storage
          </p>

          <div
            style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "0.85rem" }}
          >
            {Object.entries(run.artifacts).map(([key, path]) => (
              <div
                key={key}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "6px 10px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <span style={{ fontWeight: 500 }}>{key}</span>
                {path ? (
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.8rem",
                      color: "var(--primary)",
                      cursor: "pointer",
                    }}
                    title={path}
                  >
                    📄 {path.split("/").pop()}
                  </span>
                ) : (
                  <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Pending</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pipeline Phases */}
      <div className="card" data-testid="phases-card">
        <h3 className="card-title">Pipeline Execution Phases</h3>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "16px" }}>
          Sequential execution flow through the security-audit-skill lifecycle
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {run.phases.map((phase) => (
            <div
              key={phase.name}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 16px",
                backgroundColor: "var(--surface-raised)",
                borderRadius: "var(--radius)",
                flexWrap: "wrap",
                gap: "8px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span
                  className={`badge ${
                    phase.status === "succeeded"
                      ? "badge-success"
                      : phase.status === "running"
                        ? "badge-low"
                        : phase.status === "failed"
                          ? "badge-critical"
                          : "badge-info"
                  }`}
                >
                  {phase.status}
                </span>
                <strong style={{ textTransform: "capitalize", fontSize: "0.95rem" }}>
                  {phase.name}
                </strong>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "20px",
                  fontSize: "0.85rem",
                  color: "var(--text-muted)",
                }}
              >
                <span>
                  Slices:{" "}
                  <strong>
                    {phase.slicesDone} / {phase.sliceCount}
                  </strong>
                </span>
                <span>
                  Tokens:{" "}
                  <strong>
                    {(phase.usage.inputTokens + phase.usage.outputTokens).toLocaleString()}
                  </strong>
                </span>
                <span>
                  Cost: <strong>${phase.usage.costUsd.toFixed(3)}</strong>
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Slices & Multi-Attempt Model Fallbacks */}
      <div className="card" data-testid="slices-card">
        <h3 className="card-title">Parallel Work Slices & Model Fallback Chains</h3>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "16px" }}>
          Per-slice attempt log showing primary model routing and fallback attempts
        </p>

        {slices.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
            No slices registered for this run.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {slices.map((slice) => (
              <div
                key={slice.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  overflow: "hidden",
                }}
                data-testid={`slice-item-${slice.id}`}
              >
                <div
                  style={{
                    backgroundColor: "var(--surface-raised)",
                    padding: "10px 14px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "8px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      className={`badge ${
                        slice.status === "succeeded"
                          ? "badge-success"
                          : slice.status === "failed"
                            ? "badge-critical"
                            : "badge-info"
                      }`}
                    >
                      {slice.status}
                    </span>
                    <strong style={{ fontSize: "0.9rem" }}>{slice.label}</strong>
                    {slice.attackClass && (
                      <span className="badge badge-info">{slice.attackClass}</span>
                    )}
                  </div>
                  <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                    Phase: {slice.phase} · {slice.attempts.length} Attempt(s)
                  </span>
                </div>

                {/* Per-attempt details showing fallback chain */}
                <div
                  style={{
                    padding: "12px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  {slice.attempts.map((att) => (
                    <div
                      key={att.attempt}
                      style={{
                        padding: "8px 12px",
                        backgroundColor:
                          att.status === "failed" ? "var(--critical-bg)" : "var(--surface)",
                        border: `1px solid ${att.status === "failed" ? "var(--critical-border)" : "var(--border)"}`,
                        borderRadius: "6px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "8px",
                        fontSize: "0.85rem",
                      }}
                      data-testid={`slice-attempt-${slice.id}-${att.attempt}`}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontWeight: 700 }}>Attempt #{att.attempt}:</span>
                        <code style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                          {att.model.adapter}/{att.model.model}
                        </code>
                        <span
                          className={`badge ${
                            att.status === "succeeded"
                              ? "badge-success"
                              : att.status === "failed"
                                ? "badge-critical"
                                : "badge-info"
                          }`}
                        >
                          {att.status}
                        </span>
                      </div>

                      {att.status === "failed" && att.errorCode && (
                        <div style={{ color: "var(--critical)", fontSize: "0.8rem" }}>
                          Failure: <strong>{att.errorCode}</strong> -{" "}
                          {att.errorMessage || "Triggered secondary model fallback"}
                        </div>
                      )}

                      <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
                        Usage: {(att.usage.inputTokens + att.usage.outputTokens).toLocaleString()}{" "}
                        tokens (${att.usage.costUsd.toFixed(3)})
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SSE Real-Time Event Log */}
      <div className="card" data-testid="events-stream-card">
        <h3 className="card-title">Live Event Stream Log</h3>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "16px" }}>
          Real-time event ledger dispatched over SSE (sdap:events)
        </p>

        <div
          style={{
            maxHeight: "220px",
            overflowY: "auto",
            backgroundColor: "var(--surface-raised)",
            borderRadius: "var(--radius)",
            padding: "10px",
            fontSize: "0.8rem",
            fontFamily: "var(--font-mono)",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
        >
          {events.map((ev) => (
            <div key={ev.id} style={{ display: "flex", gap: "8px" }}>
              <span style={{ color: "var(--text-muted)" }}>[{ev.seq}]</span>
              <span style={{ color: "var(--text-muted)" }}>{ev.at.slice(11, 19)}</span>
              <strong style={{ color: "var(--primary)" }}>{ev.type}</strong>
              <span>{JSON.stringify(ev.payload)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
