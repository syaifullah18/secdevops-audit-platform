import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { Finding, Project } from "@sdap/core";
import { SeverityBadge, VerdictBadge, StatusBadge } from "../components/Badges.js";
import { useApp } from "../context/AppContext.js";

export function AuditExportScreen() {
  const { showRejected } = useApp();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("all");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        const [projs, fPage] = await Promise.all([
          api.getProjects(),
          api.getFindings({
            projectId: selectedProjectId === "all" ? undefined : selectedProjectId,
            includeRejected: showRejected,
            limit: 500,
          }),
        ]);
        if (mounted) {
          setProjects(projs);
          setFindings(fPage.items);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [selectedProjectId, showRejected]);

  // Client-side CSV generator
  const downloadCsv = () => {
    const headers = [
      "ID",
      "Fingerprint",
      "Title",
      "Attack Class",
      "CWE",
      "Verdict",
      "Original Severity",
      "Verified Severity",
      "Status",
      "Owner",
      "Location File",
      "Location Line",
      "First Seen",
      "SLA Due",
    ];

    const escapeCsv = (val: string | number | null | undefined): string => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = findings.map((f) => [
      escapeCsv(f.id),
      escapeCsv(f.fingerprint),
      escapeCsv(f.title),
      escapeCsv(f.attackClass),
      escapeCsv(f.cwe),
      escapeCsv(f.verdict),
      escapeCsv(f.originalSeverity),
      escapeCsv(f.verifiedSeverity),
      escapeCsv(f.status),
      escapeCsv(f.owner),
      escapeCsv(f.location.file),
      escapeCsv(f.location.line),
      escapeCsv(f.firstSeen),
      escapeCsv(f.slaDue),
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `secdevops-audit-export-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Client-side Markdown generator
  const downloadMarkdown = () => {
    const dateStr = new Date().toISOString().split("T")[0];
    let md = `# SecDevOps Security Audit Report\n\n`;
    md += `Generated: ${new Date().toISOString()}\n`;
    md += `Scope: ${selectedProjectId === "all" ? "All Projects" : selectedProjectId}\n`;
    md += `Total Findings: ${findings.length}\n\n`;

    md += `## Executive Summary\n\n`;
    const confirmedCount = findings.filter((f) => f.verdict === "confirmed").length;
    const needsValCount = findings.filter((f) => f.verdict === "needs_validation").length;
    const criticalCount = findings.filter((f) => f.verifiedSeverity === "critical").length;
    const highCount = findings.filter((f) => f.verifiedSeverity === "high").length;

    md += `- **Confirmed Vulnerabilities**: ${confirmedCount}\n`;
    md += `- **Critical Severity**: ${criticalCount}\n`;
    md += `- **High Severity**: ${highCount}\n`;
    md += `- **Needs Validation (Advisory)**: ${needsValCount}\n\n`;

    md += `## Findings Registry\n\n`;
    md += `| Verified Severity | Title | Verdict | Status | File | Fingerprint |\n`;
    md += `| --- | --- | --- | --- | --- | --- |\n`;

    for (const f of findings) {
      md += `| ${f.verifiedSeverity || "None"} | ${f.title.replace(/\|/g, "-")} | ${f.verdict} | ${f.status} | \`${f.location.file}:${f.location.line}\` | \`${f.fingerprint}\` |\n`;
    }

    md += `\n## Vulnerability Details\n\n`;
    for (const f of findings) {
      md += `### ${f.title} (${f.fingerprint})\n\n`;
      md += `- **Verdict**: ${f.verdict}\n`;
      md += `- **Verified Severity**: ${f.verifiedSeverity || "None"} (Hunter: ${f.originalSeverity || "None"})\n`;
      md += `- **Attack Class**: ${f.attackClass} (${f.cwe || "N/A"})\n`;
      md += `- **Location**: \`${f.location.file}:${f.location.line}\`\n`;
      md += `- **Description**: ${f.description}\n\n`;

      if (f.trace.length > 0) {
        md += `#### Trace Steps:\n`;
        for (const step of f.trace) {
          md += `- **${step.kind.toUpperCase()}**: \`${step.file}:${step.line}\` (${step.scope}) - ${step.description}\n`;
        }
        md += `\n`;
      }

      if (f.remediation) {
        md += `#### Remediation (Draft for Human Review):\n`;
        md += `${f.remediation.strategy}\n\n`;
      }
    }

    const blob = new Blob([md], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `secdevops-audit-report-${dateStr}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Trigger PDF print stylesheet
  const printPdf = () => {
    window.print();
  };

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: "24px" }}
      data-testid="audit-export-screen"
    >
      {/* Controls Card */}
      <div className="card no-print">
        <div className="card-header">
          <div>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 700 }}>
              Export Compliance Audit Reports
            </h2>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "2px" }}>
              Export findings in client compliance formats (Markdown, CSV, or PDF via print
              stylesheet)
            </p>
          </div>

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={downloadCsv}
              data-testid="export-csv-button"
            >
              📊 Export CSV
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={downloadMarkdown}
              data-testid="export-md-button"
            >
              📝 Export Markdown
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={printPdf}
              data-testid="export-pdf-button"
            >
              🖨️ Print / Save as PDF
            </button>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: "16px",
            alignItems: "center",
            flexWrap: "wrap",
            marginTop: "8px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <label
              htmlFor="export-project-select"
              className="form-label"
              style={{ marginBottom: 0 }}
            >
              Filter Project:
            </label>
            <select
              id="export-project-select"
              className="form-select"
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              data-testid="export-project-select"
            >
              <option value="all">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.slug})
                </option>
              ))}
            </select>
          </div>
          <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
            Selected scope includes <strong>{findings.length}</strong> findings.
          </span>
        </div>
      </div>

      {/* Printable Report View (Visible in print and on screen) */}
      <div className="card" data-testid="printable-report-card">
        <div
          style={{
            borderBottom: "2px solid var(--border)",
            paddingBottom: "16px",
            marginBottom: "20px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h1 style={{ fontSize: "1.5rem", fontWeight: 800 }}>
                SecDevOps Security Audit Report
              </h1>
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                Autonomous Verification Engine · Cloudflare security-audit-skill
              </p>
            </div>
            <div style={{ textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)" }}>
              <div>Date: {new Date().toLocaleDateString()}</div>
              <div>Report ID: RPT-{new Date().getTime().toString().slice(-6)}</div>
            </div>
          </div>
        </div>

        {loading ? (
          <div>Loading export dataset...</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {/* Table of Findings */}
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Verified Severity</th>
                    <th>Hunter Severity</th>
                    <th>Verdict</th>
                    <th>Title</th>
                    <th>Status</th>
                    <th>Location</th>
                  </tr>
                </thead>
                <tbody>
                  {findings.map((f) => (
                    <tr key={f.id}>
                      <td>
                        <SeverityBadge severity={f.verifiedSeverity} />
                      </td>
                      <td>
                        <SeverityBadge severity={f.originalSeverity} />
                      </td>
                      <td>
                        <VerdictBadge verdict={f.verdict} />
                      </td>
                      <td style={{ fontWeight: 600 }}>{f.title}</td>
                      <td>
                        <StatusBadge status={f.status} />
                      </td>
                      <td>
                        <code>
                          {f.location.file}:{f.location.line}
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Detailed print listing */}
            <div
              style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "16px" }}
            >
              <h3 style={{ fontSize: "1.1rem", fontWeight: 700 }}>Finding Evidence Traces</h3>
              {findings.map((f) => (
                <div
                  key={f.id}
                  style={{
                    padding: "12px",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    breakInside: "avoid",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: "6px",
                    }}
                  >
                    <strong>{f.title}</strong>
                    <span>
                      <code>{f.fingerprint}</code>
                    </span>
                  </div>
                  <p style={{ fontSize: "0.85rem", marginBottom: "8px" }}>{f.description}</p>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                    Trace steps: {f.trace.map((t) => `${t.kind} (${t.file}:${t.line})`).join(" → ")}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
