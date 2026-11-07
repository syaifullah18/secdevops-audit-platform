import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { Policy, Exception, Project } from "@sdap/core";
import { SeverityBadge } from "../components/Badges.js";
import { FIXTURE_POLICY_1_ID } from "../api/fixtures.js";

export function PolicyViewScreen() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        setLoading(true);
        const [pol, excs, projs] = await Promise.all([
          api.getPolicy(FIXTURE_POLICY_1_ID),
          api.getExceptions(),
          api.getProjects(),
        ]);

        if (mounted) {
          setPolicy(pol);
          setExceptions(excs);
          setProjects(projs);
        }
      } catch (err: unknown) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to load policy & exceptions");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div data-testid="loading-indicator">
        Loading security policies & governance exceptions...
      </div>
    );
  }

  if (error || !policy) {
    return (
      <div role="alert" style={{ color: "var(--critical)" }}>
        Error loading policy: {error || "Policy not found"}
      </div>
    );
  }

  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const now = Date.now();

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: "24px" }}
      data-testid="policy-view-screen"
    >
      {/* Policy Governance Card */}
      <div className="card" data-testid="policy-rules-card">
        <div className="card-header">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 700 }}>{policy.name}</h2>
              <span
                className={`badge ${policy.mode === "enforce" ? "badge-critical" : "badge-info"}`}
                style={{ fontSize: "0.8rem", padding: "3px 8px" }}
              >
                {policy.mode === "enforce" ? "STRICT ENFORCE" : "REPORT ONLY"}
              </span>
            </div>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "4px" }}>
              Policy as Code (PRD 5.5): Evaluated by CI CLI and API to gate production releases.
            </p>
          </div>
        </div>

        <div className="side-by-side" style={{ marginTop: "10px" }}>
          {/* Gate Rules */}
          <div
            style={{
              backgroundColor: "var(--surface-raised)",
              padding: "14px",
              borderRadius: "var(--radius)",
            }}
          >
            <h4
              style={{
                fontSize: "0.85rem",
                fontWeight: 700,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                marginBottom: "8px",
              }}
            >
              Active Gate Blocking Rules ({policy.rules.length})
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {policy.rules.map((rule, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 12px",
                    backgroundColor: "var(--surface)",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                    fontSize: "0.85rem",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span>Block on</span>
                    <span className="badge badge-critical">{rule.verdict}</span>
                    <span>≥</span>
                    <SeverityBadge severity={rule.minSeverity} />
                  </div>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    {rule.attackClasses.length > 0
                      ? `Classes: ${rule.attackClasses.join(", ")}`
                      : "All Attack Classes"}
                  </span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "10px" }}>
              * Contract invariant: Gate rules evaluate ONLY verified confirmed findings;
              needs_validation and advisory findings never trigger a rule.
            </p>
          </div>

          {/* SLA Days Configuration */}
          <div
            style={{
              backgroundColor: "var(--surface-raised)",
              padding: "14px",
              borderRadius: "var(--radius)",
            }}
          >
            <h4
              style={{
                fontSize: "0.85rem",
                fontWeight: 700,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                marginBottom: "8px",
              }}
            >
              Remediation SLA Targets
            </h4>
            <div
              style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "0.85rem" }}
            >
              {Object.entries(policy.slaDays).map(([sev, days]) => (
                <div
                  key={sev}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "6px 10px",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <span style={{ textTransform: "capitalize", fontWeight: 500 }}>{sev}</span>
                  <strong>{days !== null ? `${days} Days` : "No Target"}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Exceptions Ledger Card */}
      <div className="card" data-testid="exceptions-table-card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Approved Security Exceptions ({exceptions.length})</h3>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "2px" }}>
              Formal accepted risks and verified false positives that bypass gate failure (PRD 5.4)
            </p>
          </div>
        </div>

        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Fingerprint</th>
                <th>Project</th>
                <th>Approver</th>
                <th>Expiration</th>
                <th>Status</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {exceptions.map((exc) => {
                const isExpired = exc.expiresAt && new Date(exc.expiresAt).getTime() < now;
                return (
                  <tr key={exc.id}>
                    <td>
                      <span
                        className={`badge ${exc.kind === "accepted_risk" ? "badge-low" : "badge-info"}`}
                      >
                        {exc.kind.replace("_", " ")}
                      </span>
                    </td>
                    <td>
                      <code style={{ fontSize: "0.8rem", fontFamily: "var(--font-mono)" }}>
                        {exc.fingerprint}
                      </code>
                    </td>
                    <td>{projectMap.get(exc.projectId)?.slug || exc.projectId}</td>
                    <td>{exc.approver}</td>
                    <td>
                      {exc.expiresAt ? (
                        <span style={{ color: isExpired ? "var(--critical)" : "inherit" }}>
                          {new Date(exc.expiresAt).toLocaleDateString()}
                        </span>
                      ) : (
                        "Permanent"
                      )}
                    </td>
                    <td>
                      {isExpired ? (
                        <span className="badge badge-critical">EXPIRED</span>
                      ) : (
                        <span className="badge badge-success">ACTIVE</span>
                      )}
                    </td>
                    <td style={{ maxWidth: "300px" }}>{exc.reason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
