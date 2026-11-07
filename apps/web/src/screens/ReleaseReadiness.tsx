import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import type { Project, GateResult, Finding } from "@sdap/core";
import { SeverityBadge } from "../components/Badges.js";

interface ProjectGateStatus {
  project: Project;
  gate: GateResult;
  findings: Finding[];
}

export function ReleaseReadinessScreen() {
  const [statuses, setStatuses] = useState<ProjectGateStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        setLoading(true);
        const projects = await api.getProjects();
        const results = await Promise.all(
          projects.map(async (project) => {
            const [gate, fPage] = await Promise.all([
              api.getGate(project.id),
              api.getFindings({ projectId: project.id, includeRejected: false, limit: 100 }),
            ]);
            return { project, gate, findings: fPage.items };
          }),
        );

        if (mounted) {
          setStatuses(results);
        }
      } catch (err: unknown) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to load release readiness");
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
      <div data-testid="loading-indicator">Evaluating release readiness across projects...</div>
    );
  }

  if (error) {
    return (
      <div role="alert" style={{ color: "var(--critical)" }}>
        Error evaluating release gates: {error}
      </div>
    );
  }

  const passedCount = statuses.filter((s) => s.gate.pass).length;
  const blockedCount = statuses.length - passedCount;

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: "24px" }}
      data-testid="release-readiness-screen"
    >
      {/* Policy Gate Banner */}
      <div
        className="card"
        style={{
          backgroundColor: blockedCount > 0 ? "var(--high-bg)" : "var(--success-bg)",
          border: `1px solid ${blockedCount > 0 ? "var(--high-border)" : "var(--success-border)"}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
          <span style={{ fontSize: "1.4rem" }}>{blockedCount > 0 ? "🚦" : "✅"}</span>
          <h2 style={{ fontSize: "1.15rem", fontWeight: 700 }}>
            {blockedCount === 0
              ? "All Projects Ready for Release"
              : `${blockedCount} Project(s) Blocked by Security Policy Gate`}
          </h2>
        </div>
        <p style={{ fontSize: "0.9rem", lineHeight: "1.5" }}>
          Release readiness is evaluated deterministically by <code>evaluateGate()</code> against
          active policy rules.
          <strong>
            {" "}
            Core Principle: Only open confirmed findings can fail a release gate.
          </strong>{" "}
          System 1 suggestions and unverified candidate leads (needs_validation) are strictly
          advisory and never block deployment.
        </p>
      </div>

      {/* Summary Scorecard */}
      <div className="metrics-grid">
        <div className="metric-card">
          <span className="metric-label">Ready For Release</span>
          <span className="metric-value" style={{ color: "var(--success)" }}>
            {passedCount}
          </span>
          <span className="metric-sub">Passing all enforcement gates</span>
        </div>

        <div className="metric-card">
          <span className="metric-label">Blocked By Policy</span>
          <span
            className="metric-value"
            style={{ color: blockedCount > 0 ? "var(--critical)" : "inherit" }}
          >
            {blockedCount}
          </span>
          <span className="metric-sub">Open confirmed high/critical findings</span>
        </div>

        <div className="metric-card">
          <span className="metric-label">Active Exceptions</span>
          <span className="metric-value">
            {statuses.reduce((acc, s) => acc + s.gate.excepted.length, 0)}
          </span>
          <span className="metric-sub">Approved risk acceptances</span>
        </div>
      </div>

      {/* Per-Project Gate Readiness Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
        {statuses.map(({ project, gate, findings }) => {
          const findingMap = new Map(findings.map((f) => [f.id, f]));

          return (
            <div
              key={project.id}
              className="card"
              style={{
                borderLeft: `4px solid ${gate.pass ? "var(--success)" : "var(--critical)"}`,
              }}
              data-testid={`project-gate-card-${project.id}`}
            >
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
                    <h3 style={{ fontSize: "1.15rem", fontWeight: 700 }}>{project.name}</h3>
                    <span className="badge badge-info">{project.slug}</span>
                    <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                      Mode: {gate.mode === "enforce" ? "Enforce" : "Report Only"}
                    </span>
                  </div>
                  <div
                    style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "4px" }}
                  >
                    Branch: <code>{project.defaultBranch}</code> · Evaluated:{" "}
                    {new Date(gate.evaluatedAt).toLocaleTimeString()}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span
                    className={`badge ${gate.pass ? "badge-success" : "badge-critical"}`}
                    style={{ fontSize: "0.9rem", padding: "6px 12px" }}
                    data-testid={`gate-badge-${project.id}`}
                  >
                    {gate.pass ? "GATE PASSED" : "GATE BLOCKED"}
                  </span>
                  <Link to={`/projects/${project.id}`} className="btn btn-secondary btn-sm">
                    Project Details
                  </Link>
                </div>
              </div>

              {/* Blocking Violations List (Only confirmed findings!) */}
              <div style={{ marginTop: "16px" }}>
                {gate.violations.length === 0 ? (
                  <div style={{ fontSize: "0.85rem", color: "var(--success)", fontWeight: 500 }}>
                    ✓ No policy-violating open findings detected.
                  </div>
                ) : (
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: "8px" }}
                    data-testid={`violations-list-${project.id}`}
                  >
                    <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--critical)" }}>
                      Gate Blocking Confirmed Findings ({gate.violations.length}):
                    </div>
                    {gate.violations.map((violation) => {
                      const finding = findingMap.get(violation.findingId);
                      return (
                        <div
                          key={violation.findingId}
                          style={{
                            padding: "8px 12px",
                            backgroundColor: "var(--critical-bg)",
                            border: "1px solid var(--critical-border)",
                            borderRadius: "var(--radius)",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            fontSize: "0.85rem",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <SeverityBadge severity={violation.severity} />
                            <Link
                              to={`/findings/${violation.findingId}`}
                              style={{ fontWeight: 600 }}
                            >
                              {finding?.title || violation.fingerprint}
                            </Link>
                          </div>
                          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                            Fingerprint: <code>{violation.fingerprint}</code>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Excepted Findings */}
              {gate.excepted.length > 0 && (
                <div style={{ marginTop: "12px", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                  ℹ️ {gate.excepted.length} finding(s) exempted by active security exceptions.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
