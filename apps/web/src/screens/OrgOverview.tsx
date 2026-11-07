import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import type { Finding, Project } from "@sdap/core";
import type { OrgOverviewMetrics } from "../api/types.js";
import { SeverityBadge, VerdictBadge } from "../components/Badges.js";
import { useApp } from "../context/AppContext.js";

export function OrgOverviewScreen() {
  const { showRejected } = useApp();
  const [metrics, setMetrics] = useState<OrgOverviewMetrics | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        const [overviewData, projs, fPage] = await Promise.all([
          api.getOverview(),
          api.getProjects(),
          api.getFindings({ includeRejected: showRejected, limit: 100 }),
        ]);
        if (mounted) {
          setMetrics(overviewData);
          setProjects(projs);
          setFindings(fPage.items);
        }
      } catch (err: unknown) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to load overview");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [showRejected]);

  if (loading) {
    return <div data-testid="loading-indicator">Loading organization security posture...</div>;
  }

  if (error || !metrics) {
    return (
      <div role="alert" style={{ color: "var(--critical)" }}>
        Error loading overview: {error}
      </div>
    );
  }

  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const slaBreaches = findings.filter((f) => f.slaDue && new Date(f.slaDue).getTime() < Date.now());

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: "24px" }}
      data-testid="org-overview-screen"
    >
      {/* Top Metrics Cards */}
      <div className="metrics-grid">
        <div className="metric-card" data-testid="metric-open-findings">
          <span className="metric-label">Open Findings</span>
          <span className="metric-value">{metrics.totalOpenFindings}</span>
          <span className="metric-sub">Across all audited active projects</span>
        </div>

        <div className="metric-card" data-testid="metric-sla-breaches">
          <span className="metric-label">SLA Breaches</span>
          <span
            className="metric-value"
            style={{ color: metrics.slaBreachesCount > 0 ? "var(--critical)" : "inherit" }}
          >
            {metrics.slaBreachesCount}
          </span>
          <span className="metric-sub">Findings past SLA due date</span>
        </div>

        <div className="metric-card" data-testid="metric-mttr">
          <span className="metric-label">Mean Time to Remediate</span>
          <span className="metric-value">{metrics.meanTimeToRemediateDays}d</span>
          <span className="metric-sub">Average turnaround to verified fixed</span>
        </div>

        <div className="metric-card" data-testid="metric-active-projects">
          <span className="metric-label">Audited Projects</span>
          <span className="metric-value">{projects.length}</span>
          <span className="metric-sub">Monitored repositories</span>
        </div>
      </div>

      {/* Breakdowns by Severity and Verdict */}
      <div className="side-by-side">
        <div className="card">
          <h3 className="card-title">Open Findings by Verified Severity</h3>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "16px" }}>
            Authoritative severity determined post-validation (System 2)
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {(["critical", "high", "medium", "low", "informational"] as const).map((sev) => {
              const count = metrics.openBySeverity[sev] || 0;
              const pct =
                metrics.totalOpenFindings > 0 ? (count / metrics.totalOpenFindings) * 100 : 0;
              return (
                <div key={sev} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "0.85rem",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <SeverityBadge severity={sev} />
                    </span>
                    <strong>{count}</strong>
                  </div>
                  <div
                    style={{
                      height: "6px",
                      backgroundColor: "var(--surface-raised)",
                      borderRadius: "3px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{ width: `${pct}%`, height: "100%", backgroundColor: `var(--${sev})` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">Findings by Verification Verdict</h3>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "16px" }}>
            System 2 consensus status (
            {showRejected ? "including rejected" : "rejected candidates hidden"})
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {(["confirmed", "needs_validation", "rejected"] as const).map((verdict) => {
              const count = metrics.openByVerdict[verdict] || 0;
              return (
                <div
                  key={verdict}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 14px",
                    backgroundColor: "var(--surface-raised)",
                    borderRadius: "var(--radius)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <VerdictBadge verdict={verdict} />
                    <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                      {verdict === "confirmed" && "Proved vulnerabilities"}
                      {verdict === "needs_validation" && "Pending sandbox/verifier proof"}
                      {verdict === "rejected" && "Refuted candidate leads"}
                    </span>
                  </div>
                  <strong style={{ fontSize: "1.1rem" }}>{count}</strong>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Trend Over Time */}
      <div className="card" data-testid="trend-chart-card">
        <h3 className="card-title">Findings Trend Over Time</h3>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "16px" }}>
          Weekly rolling volume of open vs remediated vulnerabilities
        </p>
        <div
          style={{
            height: "160px",
            display: "flex",
            alignItems: "flex-end",
            gap: "24px",
            paddingTop: "20px",
          }}
        >
          {metrics.trend.map((point) => (
            <div
              key={point.date}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <div style={{ display: "flex", gap: "4px", alignItems: "flex-end", height: "100px" }}>
                <div
                  title={`Open: ${point.openFindings}`}
                  style={{
                    width: "20px",
                    height: `${Math.min(100, point.openFindings * 10)}%`,
                    backgroundColor: "var(--critical)",
                    borderRadius: "3px 3px 0 0",
                  }}
                />
                <div
                  title={`Resolved: ${point.resolvedFindings}`}
                  style={{
                    width: "20px",
                    height: `${Math.min(100, point.resolvedFindings * 10)}%`,
                    backgroundColor: "var(--success)",
                    borderRadius: "3px 3px 0 0",
                  }}
                />
              </div>
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                {point.date.slice(5)}
              </span>
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "20px",
            marginTop: "14px",
            fontSize: "0.8rem",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              style={{
                width: "12px",
                height: "12px",
                backgroundColor: "var(--critical)",
                borderRadius: "2px",
              }}
            />
            Open Findings
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              style={{
                width: "12px",
                height: "12px",
                backgroundColor: "var(--success)",
                borderRadius: "2px",
              }}
            />
            Resolved Findings
          </span>
        </div>
      </div>

      {/* Cross-Project Attack Class View */}
      <div className="card" data-testid="cross-project-attack-class">
        <h3 className="card-title">Cross-Project Attack Class Distribution</h3>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "16px" }}>
          Heatmap view of vulnerability classes across all audited services
        </p>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Attack Class</th>
                <th>Total Issues</th>
                {projects.map((p) => (
                  <th key={p.id}>
                    <Link to={`/projects/${p.id}`}>{p.slug}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.crossProjectAttackClasses.map((ac) => (
                <tr key={ac.attackClass}>
                  <td>
                    <strong>{ac.attackClass}</strong>
                  </td>
                  <td>
                    <span className="badge badge-info">{ac.count}</span>
                  </td>
                  {projects.map((p) => {
                    const count = ac.byProject[p.id] || 0;
                    return (
                      <td key={p.id}>
                        {count > 0 ? (
                          <span className="badge badge-critical" style={{ fontSize: "0.75rem" }}>
                            {count}
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>-</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* SLA Breaches Table */}
      {slaBreaches.length > 0 && (
        <div
          className="card"
          style={{ borderColor: "var(--critical-border)" }}
          data-testid="sla-breaches-card"
        >
          <div className="card-header">
            <h3 className="card-title" style={{ color: "var(--critical)" }}>
              ⚠️ Active SLA Breaches ({slaBreaches.length})
            </h3>
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Title</th>
                  <th>Project</th>
                  <th>SLA Due</th>
                  <th>Owner</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {slaBreaches.map((finding) => (
                  <tr key={finding.id}>
                    <td>
                      <SeverityBadge severity={finding.verifiedSeverity} />
                    </td>
                    <td>
                      <Link to={`/findings/${finding.id}`} style={{ fontWeight: 600 }}>
                        {finding.title}
                      </Link>
                    </td>
                    <td>{projectMap.get(finding.projectId)?.slug || finding.projectId}</td>
                    <td style={{ color: "var(--critical)", fontWeight: 600 }}>
                      {finding.slaDue ? new Date(finding.slaDue).toLocaleDateString() : "-"}
                    </td>
                    <td>{finding.owner || "Unassigned"}</td>
                    <td>
                      <Link to={`/findings/${finding.id}`} className="btn btn-secondary btn-sm">
                        Inspect
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Projects Quick Jump */}
      <div className="card">
        <h3 className="card-title">Audited Projects</h3>
        <div className="table-container" style={{ marginTop: "12px" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Project Name</th>
                <th>Repository</th>
                <th>Team</th>
                <th>Default Branch</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((proj) => (
                <tr key={proj.id}>
                  <td>
                    <Link to={`/projects/${proj.id}`} style={{ fontWeight: 600 }}>
                      {proj.name}
                    </Link>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      {proj.slug}
                    </div>
                  </td>
                  <td>
                    <code style={{ fontSize: "0.8rem", fontFamily: "var(--font-mono)" }}>
                      {proj.repoUrl}
                    </code>
                  </td>
                  <td>{proj.team}</td>
                  <td>
                    <span className="badge badge-info">{proj.defaultBranch}</span>
                  </td>
                  <td>
                    <Link to={`/projects/${proj.id}`} className="btn btn-secondary btn-sm">
                      View Project
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
