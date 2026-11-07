import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client.js";
import type { Finding, TriageEvent, TriageRequest } from "@sdap/core";
import { VerdictBadge, StatusBadge } from "../components/Badges.js";
import { SideBySideSeverity } from "../components/SideBySideSeverity.js";
import { AttributionLabel } from "../components/Attribution.js";
import { System1AdvisoryView } from "../components/System1Advisory.js";
import { FixDraftViewer } from "../components/FixDraftViewer.js";
import { SourceTraceViewer } from "../components/SourceTraceViewer.js";
import { TriageActionForm } from "../components/TriageActionForm.js";

export function FindingDetailScreen() {
  const { id } = useParams<{ id: string }>();

  const [finding, setFinding] = useState<Finding | null>(null);
  const [history, setHistory] = useState<TriageEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let mounted = true;

    async function load() {
      try {
        setLoading(true);
        const [f, h] = await Promise.all([api.getFinding(id!), api.getFindingHistory(id!)]);

        if (mounted) {
          setFinding(f);
          setHistory(h);
        }
      } catch (err: unknown) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to load finding");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [id]);

  const handleTriage = async (req: TriageRequest) => {
    if (!id) return;
    const updated = await api.triageFinding(id, req);
    setFinding(updated);
    const updatedHistory = await api.getFindingHistory(id);
    setHistory(updatedHistory);
  };

  if (loading) {
    return <div data-testid="loading-indicator">Loading finding inspection record...</div>;
  }

  if (error || !finding) {
    return (
      <div role="alert" style={{ color: "var(--critical)" }}>
        Error loading finding: {error || "Finding not found"}
      </div>
    );
  }

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: "24px" }}
      data-testid="finding-detail-screen"
    >
      {/* Header & Identifiers */}
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
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <VerdictBadge verdict={finding.verdict} />
              <StatusBadge status={finding.status} />
              <span className="badge badge-info">{finding.attackClass}</span>
              {finding.cwe && <span className="badge badge-info">{finding.cwe}</span>}
              <AttributionLabel model={finding.model} phase={finding.phase} />
            </div>

            <h2 style={{ fontSize: "1.35rem", fontWeight: 700, marginTop: "6px" }}>
              {finding.title}
            </h2>

            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
              Location:{" "}
              <code>
                {finding.location.file}:{finding.location.line}
              </code>
              {finding.location.symbol && ` (${finding.location.symbol})`}
              {" · "}Fingerprint: <code style={{ fontSize: "0.8rem" }}>{finding.fingerprint}</code>
            </div>
          </div>

          <Link to={`/projects/${finding.projectId}`} className="btn btn-secondary btn-sm">
            View Project
          </Link>
        </div>

        {/* Side-by-Side Severity: Original Hunter vs Verified Severity */}
        <SideBySideSeverity
          originalSeverity={finding.originalSeverity}
          verifiedSeverity={finding.verifiedSeverity}
        />

        {/* Description & Root Cause */}
        <div>
          <h4 style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "4px" }}>Description</h4>
          <p style={{ fontSize: "0.95rem", lineHeight: "1.6", color: "var(--text)" }}>
            {finding.description}
          </p>
        </div>

        {finding.rootCause && (
          <div
            style={{
              padding: "10px 14px",
              backgroundColor: "var(--surface-raised)",
              borderRadius: "var(--radius)",
            }}
          >
            <span
              style={{
                fontSize: "0.8rem",
                fontWeight: 600,
                color: "var(--text-muted)",
                textTransform: "uppercase",
              }}
            >
              Underlying Root Cause:
            </span>
            <p style={{ fontSize: "0.9rem", color: "var(--text)", marginTop: "2px" }}>
              {finding.rootCause}
            </p>
          </div>
        )}
      </div>

      {/* System 1 (Jev) Advisory Suggestion View */}
      {finding.triageSuggestion && <System1AdvisoryView suggestion={finding.triageSuggestion} />}

      {/* Verifier Result / Blockers / Rejection Reason */}
      <div className="card" data-testid="verifier-result-card">
        <h3 className="card-title">Verifier Proof & Confidence Assessment</h3>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "16px" }}>
          Independent verification results produced during the audit pipeline
        </p>

        <div
          style={{
            display: "flex",
            gap: "24px",
            flexWrap: "wrap",
            marginBottom: "12px",
            fontSize: "0.85rem",
          }}
        >
          <span>
            Verdict: <strong>{finding.verdict}</strong>
          </span>
          <span>
            Confidence: <strong>{finding.confidence || "N/A"}</strong>
          </span>
          <span>
            Verified Phase: <strong>{finding.phase}</strong>
          </span>
        </div>

        {finding.verdict === "needs_validation" && finding.blockers.length > 0 && (
          <div
            style={{
              backgroundColor: "var(--purple-bg)",
              border: "1px solid var(--purple-border)",
              padding: "14px",
              borderRadius: "var(--radius)",
              marginTop: "10px",
            }}
            data-testid="blockers-container"
          >
            <h4
              style={{
                fontSize: "0.9rem",
                color: "var(--purple)",
                fontWeight: 700,
                marginBottom: "8px",
              }}
            >
              Unresolved Verification Blockers (Security Review Required):
            </h4>
            <ul style={{ paddingLeft: "20px", fontSize: "0.9rem", color: "var(--text)" }}>
              {finding.blockers.map((b, idx) => (
                <li key={idx} style={{ marginBottom: "4px" }}>
                  {b}
                </li>
              ))}
            </ul>
          </div>
        )}

        {finding.verdict === "rejected" && finding.rejectionReason && (
          <div
            style={{
              backgroundColor: "var(--surface-raised)",
              border: "1px solid var(--border)",
              padding: "14px",
              borderRadius: "var(--radius)",
              marginTop: "10px",
            }}
            data-testid="rejection-reason-container"
          >
            <h4
              style={{
                fontSize: "0.9rem",
                color: "var(--text-muted)",
                fontWeight: 700,
                marginBottom: "6px",
              }}
            >
              Refutation Proof & Rejection Rationale:
            </h4>
            <p style={{ fontSize: "0.9rem", color: "var(--text)", lineHeight: "1.5" }}>
              {finding.rejectionReason}
            </p>
          </div>
        )}
      </div>

      {/* Source Trace & Evidence */}
      <div className="side-by-side">
        {/* Source Trace */}
        <div className="card" data-testid="source-trace-card">
          <h3 className="card-title">Vulnerability Source Trace</h3>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "16px" }}>
            Entrypoint → Propagation → Sink data-flow graph
          </p>
          <SourceTraceViewer trace={finding.trace} />
        </div>

        {/* Evidence Items */}
        <div className="card" data-testid="evidence-items-card">
          <h3 className="card-title">Supporting Evidence Records</h3>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "16px" }}>
            Observed artifacts and runtime proofs
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {finding.evidence.map((item, idx) => (
              <div
                key={idx}
                style={{
                  padding: "10px 12px",
                  backgroundColor: "var(--surface-raised)",
                  borderRadius: "var(--radius)",
                  border: "1px solid var(--border)",
                }}
              >
                <code style={{ fontSize: "0.8rem", color: "var(--primary)" }}>
                  {item.file}:{item.line}
                </code>
                <p style={{ fontSize: "0.85rem", marginTop: "4px" }}>{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Automated Fix Draft (Draft Labelled) */}
      <FixDraftViewer remediation={finding.remediation} />

      {/* Triage Decision Form & Triage History */}
      <div className="side-by-side">
        {/* Triage Form */}
        <TriageActionForm
          currentStatus={finding.status}
          currentOwner={finding.owner}
          onTriage={handleTriage}
        />

        {/* Triage Audit History */}
        <div className="card" data-testid="triage-history-card">
          <h3 className="card-title">Triage Audit Log</h3>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "16px" }}>
            Tamper-evident audit trail of state transitions and reviews
          </p>

          {history.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
              No previous triage events recorded.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {history.map((evt) => (
                <div
                  key={evt.id}
                  style={{
                    padding: "10px 12px",
                    backgroundColor: "var(--surface-raised)",
                    borderRadius: "var(--radius)",
                    fontSize: "0.85rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                  data-testid={`triage-event-${evt.id}`}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span className="badge badge-info">{evt.from}</span>
                      <span>→</span>
                      <StatusBadge status={evt.to} />
                    </div>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      {new Date(evt.at).toLocaleString()}
                    </span>
                  </div>

                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                    Actor: <strong>{evt.actor.subject}</strong> ({evt.actor.role})
                  </div>

                  {evt.reason && (
                    <div style={{ fontSize: "0.85rem", marginTop: "2px", fontStyle: "italic" }}>
                      "{evt.reason}"
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
