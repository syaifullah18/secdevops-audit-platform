import { useEffect, useState, type FormEvent } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client.js";
import type { Project, Run, Finding, GateResult, AuditMode } from "@sdap/core";
import type { CoverageSummary } from "../api/types.js";
import { SeverityBadge, StatusBadge, VerdictBadge } from "../components/Badges.js";
import { useApp } from "../context/AppContext.js";

export function ProjectViewScreen() {
  const { id } = useParams<{ id: string }>();
  const { showRejected } = useApp();

  const [project, setProject] = useState<Project | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [gate, setGate] = useState<GateResult | null>(null);
  const [coverage, setCoverage] = useState<CoverageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Trigger Run state
  const [showTriggerModal, setShowTriggerModal] = useState(false);
  const [newRunMode, setNewRunMode] = useState<AuditMode>("focused");
  const [newRunRef, setNewRunRef] = useState("main");
  const [triggering, setTriggering] = useState(false);

  useEffect(() => {
    if (!id) return;
    let mounted = true;

    async function load() {
      try {
        setLoading(true);
        const [proj, runPage, fPage, gateRes, cov] = await Promise.all([
          api.getProject(id!),
          api.getRuns(id!),
          api.getFindings({ projectId: id!, includeRejected: showRejected, limit: 100 }),
          api.getGate(id!),
          api.getCoverage(id!),
        ]);

        if (mounted) {
          setProject(proj);
          setRuns(runPage.items);
          setFindings(fPage.items);
          setGate(gateRes);
          setCoverage(cov);
        }
      } catch (err: unknown) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to load project details");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [id, showRejected]);

  const handleTriggerRun = async (e: FormEvent) => {
    e.preventDefault();
    if (!project) return;
    setTriggering(true);
    try {
      const created = await api.createRun({
        projectId: project.id,
        mode: newRunMode,
        ref: newRunRef,
      });
      setRuns((prev) => [created, ...prev]);
      setShowTriggerModal(false);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to trigger run");
    } finally {
      setTriggering(false);
    }
  };

  if (loading) {
    return <div data-testid="loading-indicator">Loading project details...</div>;
  }

  if (error || !project) {
    return (
      <div role="alert" style={{ color: "var(--critical)" }}>
        Error loading project: {error || "Project not found"}
      </div>
    );
  }

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: "24px" }}
      data-testid="project-view-screen"
    >
      {/* Project Header */}
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
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
              <h2 style={{ fontSize: "1.4rem", fontWeight: 700 }}>{project.name}</h2>
              <span className="badge badge-info">{project.slug}</span>
            </div>
            <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginTop: "4px" }}>
              Repository: <code style={{ fontFamily: "var(--font-mono)" }}>{project.repoUrl}</code>
            </p>
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowTriggerModal(true)}
            data-testid="trigger-run-button"
          >
            ⚡ Trigger Audit Run
          </button>
        </div>

        <div
          style={{
            display: "flex",
            gap: "24px",
            flexWrap: "wrap",
            fontSize: "0.85rem",
            color: "var(--text-muted)",
            paddingTop: "8px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <span>
            Owning Team: <strong>{project.team}</strong>
          </span>
          <span>
            Client: <strong>{project.clientId}</strong>
          </span>
          <span>
            Default Branch: <strong>{project.defaultBranch}</strong>
          </span>
          <span>
            Token Budget:{" "}
            <strong>{project.monthlyTokenBudget?.toLocaleString() ?? "Default"} / mo</strong>
          </span>
        </div>
      </div>

      {/* Trigger Run Modal */}
      {showTriggerModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
        >
          <div className="card" style={{ width: "100%", maxWidth: "480px", margin: "16px" }}>
            <h3 className="card-title" style={{ marginBottom: "16px" }}>
              Trigger Security Audit
            </h3>
            <form
              onSubmit={handleTriggerRun}
              style={{ display: "flex", flexDirection: "column", gap: "14px" }}
            >
              <div className="form-group">
                <label htmlFor="run-mode" className="form-label">
                  Audit Mode
                </label>
                <select
                  id="run-mode"
                  className="form-select"
                  value={newRunMode}
                  onChange={(e) => setNewRunMode(e.target.value as AuditMode)}
                >
                  <option value="focused">Focused (Changed paths since last run)</option>
                  <option value="incremental">Incremental (Target coverage gaps)</option>
                  <option value="full">Full (Comprehensive scan with repeat-N)</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="run-ref" className="form-label">
                  Git Ref / Branch / Commit
                </label>
                <input
                  id="run-ref"
                  type="text"
                  className="form-input"
                  value={newRunRef}
                  onChange={(e) => setNewRunRef(e.target.value)}
                  required
                />
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "10px",
                  marginTop: "10px",
                }}
              >
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowTriggerModal(false)}
                  disabled={triggering}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={triggering}
                  data-testid="submit-trigger-run"
                >
                  {triggering ? "Queuing..." : "Queue Run"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Gate Status & Coverage Ledger */}
      <div className="side-by-side">
        {/* Gate Status Card */}
        <div className="card" data-testid="gate-status-card">
          <div className="card-header">
            <h3 className="card-title">Release Gate Status</h3>
            {gate?.pass ? (
              <span
                className="badge badge-success"
                style={{ fontSize: "0.85rem", padding: "4px 10px" }}
              >
                PASSED
              </span>
            ) : (
              <span
                className="badge badge-critical"
                style={{ fontSize: "0.85rem", padding: "4px 10px" }}
              >
                BLOCKED
              </span>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
              <span style={{ color: "var(--text-muted)" }}>Policy Mode:</span>
              <strong>{gate?.mode === "enforce" ? "Strict Enforce" : "Report Only"}</strong>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
              <span style={{ color: "var(--text-muted)" }}>Blocking Violations:</span>
              <strong
                style={{
                  color: (gate?.violations.length || 0) > 0 ? "var(--critical)" : "inherit",
                }}
              >
                {gate?.violations.length || 0} confirmed findings
              </strong>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
              <span style={{ color: "var(--text-muted)" }}>Excepted Findings:</span>
              <span>{gate?.excepted.length || 0} active exceptions</span>
            </div>

            {gate && gate.violations.length > 0 && (
              <div
                style={{
                  marginTop: "8px",
                  paddingTop: "8px",
                  borderTop: "1px solid var(--border)",
                }}
              >
                <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--critical)" }}>
                  Gate Blocking Findings:
                </span>
                <ul style={{ paddingLeft: "18px", marginTop: "4px", fontSize: "0.85rem" }}>
                  {gate.violations.map((v) => (
                    <li key={v.findingId}>
                      <Link to={`/findings/${v.findingId}`}>
                        {v.severity.toUpperCase()} ({v.fingerprint})
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Coverage Ledger Summary */}
        <div className="card" data-testid="coverage-ledger-card">
          <div className="card-header">
            <h3 className="card-title">Coverage Ledger Summary</h3>
            <span className="badge badge-info" style={{ fontSize: "0.85rem" }}>
              {coverage?.coveragePct.toFixed(1)}% Audited
            </span>
          </div>

          {coverage && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div
                style={{
                  height: "8px",
                  backgroundColor: "var(--surface-raised)",
                  borderRadius: "4px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${coverage.coveragePct}%`,
                    height: "100%",
                    backgroundColor: "var(--primary)",
                  }}
                />
              </div>

              <div
                style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}
              >
                <span style={{ color: "var(--text-muted)" }}>Audited Units:</span>
                <strong>
                  {coverage.auditedUnits} / {coverage.totalUnits}
                </strong>
              </div>

              <div
                style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}
              >
                <span style={{ color: "var(--text-muted)" }}>Last Audited:</span>
                <span>
                  {coverage.lastAuditedAt
                    ? new Date(coverage.lastAuditedAt).toLocaleString()
                    : "Never"}
                </span>
              </div>

              {coverage.uncoveredPaths.length > 0 && (
                <div style={{ marginTop: "6px" }}>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                    }}
                  >
                    Coverage Gaps (Unaudited Target Units):
                  </span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" }}>
                    {coverage.uncoveredPaths.map((p) => (
                      <code
                        key={p}
                        style={{
                          fontSize: "0.75rem",
                          padding: "2px 6px",
                          backgroundColor: "var(--surface-raised)",
                          borderRadius: "4px",
                        }}
                      >
                        {p}
                      </code>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Run History Table */}
      <div className="card" data-testid="run-history-card">
        <h3 className="card-title">Run History</h3>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "16px" }}>
          Execution pipeline history, phases, token usage and validator results
        </p>

        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Mode</th>
                <th>Git Ref</th>
                <th>Commit</th>
                <th>Phases</th>
                <th>Validators</th>
                <th>Token Cost</th>
                <th>Date</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>
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
                    >
                      {run.status}
                    </span>
                  </td>
                  <td>
                    <span className="badge badge-info">{run.mode}</span>
                  </td>
                  <td>
                    <code>{run.ref}</code>
                  </td>
                  <td>
                    <code style={{ fontSize: "0.8rem" }}>
                      {run.commitSha ? run.commitSha.slice(0, 7) : "-"}
                    </code>
                  </td>
                  <td>
                    {run.phases.map((ph) => (
                      <span
                        key={ph.name}
                        title={`${ph.name}: ${ph.status}`}
                        style={{
                          display: "inline-block",
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          marginRight: "4px",
                          backgroundColor:
                            ph.status === "succeeded"
                              ? "var(--success)"
                              : ph.status === "running"
                                ? "var(--low)"
                                : ph.status === "failed"
                                  ? "var(--critical)"
                                  : "var(--border-strong)",
                        }}
                      />
                    ))}
                  </td>
                  <td>
                    <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                      F: {run.validators.findings} · C: {run.validators.coverageLedger}
                    </span>
                  </td>
                  <td>${run.usage.costUsd.toFixed(3)}</td>
                  <td>{new Date(run.createdAt).toLocaleDateString()}</td>
                  <td>
                    <Link
                      to={`/runs/${run.id}`}
                      className="btn btn-secondary btn-sm"
                      data-testid={`view-run-${run.id}`}
                    >
                      Timeline
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Open Findings in this Project */}
      <div className="card" data-testid="project-findings-card">
        <h3 className="card-title">Project Findings ({findings.length})</h3>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "16px" }}>
          Active vulnerabilities and candidate issues identified in {project.name}
        </p>

        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Verdict</th>
                <th>Title</th>
                <th>Attack Class</th>
                <th>Status</th>
                <th>Owner</th>
                <th>SLA Due</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((f) => (
                <tr key={f.id}>
                  <td>
                    <SeverityBadge severity={f.verifiedSeverity} />
                  </td>
                  <td>
                    <VerdictBadge verdict={f.verdict} />
                  </td>
                  <td>
                    <Link to={`/findings/${f.id}`} style={{ fontWeight: 600 }}>
                      {f.title}
                    </Link>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      {f.location.file}:{f.location.line}
                    </div>
                  </td>
                  <td>{f.attackClass}</td>
                  <td>
                    <StatusBadge status={f.status} />
                  </td>
                  <td>{f.owner || "Unassigned"}</td>
                  <td>
                    {f.slaDue ? (
                      <span
                        style={{
                          color:
                            new Date(f.slaDue).getTime() < Date.now()
                              ? "var(--critical)"
                              : "inherit",
                        }}
                      >
                        {new Date(f.slaDue).toLocaleDateString()}
                      </span>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td>
                    <Link to={`/findings/${f.id}`} className="btn btn-secondary btn-sm">
                      Inspect
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
