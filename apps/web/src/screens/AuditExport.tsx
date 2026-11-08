import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import type { Finding, Project } from "@sdap/core";
import type { CoverageSummary } from "../api/types.js";
import { SeverityBadge, VerdictBadge, StatusBadge } from "../components/Badges.js";
import { Icon } from "../components/Icon.js";
import {
  Loading,
  Meter,
  PageHeader,
  Panel,
  Pill,
  btn,
  cx,
  tableCls,
} from "../components/stitch.js";

type FrameworkId = "soc2" | "iso27001" | "pci";
type RangeId = "all" | "30" | "90";
type LevelId = "summary" | "detailed";

const FRAMEWORKS: Array<{ id: FrameworkId; name: string; control: string; signal: string }> = [
  {
    id: "soc2",
    name: "SOC 2 Type II",
    control: "CC7.1 Vulnerability management",
    signal: "Open confirmed findings still within SLA",
  },
  {
    id: "iso27001",
    name: "ISO 27001",
    control: "A.8.8 Technical vulnerability management",
    signal: "Audit coverage of code units",
  },
  {
    id: "pci",
    name: "PCI-DSS v4.0",
    control: "Req 6.3 Vulnerabilities addressed",
    signal: "Confirmed high or critical findings fixed",
  },
];

export function AuditExportScreen() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("all");
  const [allFindings, setAllFindings] = useState<Finding[]>([]);
  const [coverages, setCoverages] = useState<CoverageSummary[]>([]);
  const [framework, setFramework] = useState<FrameworkId>("soc2");
  const [range, setRange] = useState<RangeId>("all");
  const [level, setLevel] = useState<LevelId>("detailed");
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
            limit: 500,
          }),
        ]);
        const covs = await Promise.all(projs.map((pr) => api.getCoverage(pr.id).catch(() => null)));
        if (mounted) {
          setProjects(projs);
          setAllFindings(fPage.items);
          setCoverages(covs.filter((c): c is CoverageSummary => c !== null));
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [selectedProjectId]);

  // Date range filters on first-seen; exports and preview all use the scoped list.
  const findings = useMemo(() => {
    if (range === "all") return allFindings;
    const cutoff = Date.now() - Number(range) * 86_400_000;
    return allFindings.filter((f) => new Date(f.firstSeen).getTime() >= cutoff);
  }, [allFindings, range]);

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
    md += `Framing: ${FRAMEWORKS.find((f) => f.id === framework)?.name} (indicative evidence, not a compliance determination)\n`;
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

  const fw = FRAMEWORKS.find((f) => f.id === framework) ?? FRAMEWORKS[0]!;
  const confirmed = findings.filter((f) => f.verdict === "confirmed");
  const openConfirmed = confirmed.filter(
    (f) => f.status !== "fixed" && f.status !== "false_positive",
  );
  const withinSla = openConfirmed.filter(
    (f) => !f.slaDue || new Date(f.slaDue).getTime() >= Date.now(),
  );
  const serious = confirmed.filter(
    (f) => f.verifiedSeverity === "critical" || f.verifiedSeverity === "high",
  );
  const seriousFixed = serious.filter((f) => f.status === "fixed");
  const pct = (n: number, d: number) => (d === 0 ? 100 : Math.round((n / d) * 100));
  const coveragePct = coverages.length
    ? Math.round(coverages.reduce((n, c) => n + c.coveragePct, 0) / coverages.length)
    : 0;
  const signal: Record<FrameworkId, number> = {
    soc2: pct(withinSla.length, openConfirmed.length),
    iso27001: coveragePct,
    pci: pct(seriousFixed.length, serious.length),
  };
  const scopeName =
    selectedProjectId === "all"
      ? "All Projects"
      : (projects.find((pr) => pr.id === selectedProjectId)?.name ?? selectedProjectId);

  return (
    <div className="flex flex-col gap-6" data-testid="audit-export-screen">
      <div className="print:hidden flex flex-col gap-6">
        <PageHeader
          title="Export Compliance Audit Reports"
          subtitle="Export findings as Markdown, CSV, or PDF through the print stylesheet."
          actions={
            <>
              <button
                type="button"
                className={btn.secondary}
                onClick={downloadCsv}
                data-testid="export-csv-button"
              >
                <Icon name="table_chart" className="text-[16px]" />
                Export CSV
              </button>
              <button
                type="button"
                className={btn.secondary}
                onClick={downloadMarkdown}
                data-testid="export-md-button"
              >
                <Icon name="description" className="text-[16px]" />
                Export Markdown
              </button>
              <button
                type="button"
                className={btn.primary}
                onClick={printPdf}
                data-testid="export-pdf-button"
              >
                <Icon name="picture_as_pdf" className="text-[16px]" />
                Export PDF
              </button>
            </>
          }
        />

        <div
          className="grid grid-cols-1 md:grid-cols-3 gap-4"
          role="radiogroup"
          aria-label="Compliance framework"
        >
          {FRAMEWORKS.map((f) => {
            const on = f.id === framework;
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setFramework(f.id)}
                data-testid={`framework-${f.id}`}
                className={cx(
                  "text-left rounded-lg border p-4 shadow-sm transition-colors bg-surface-container-lowest",
                  on
                    ? "border-on-surface ring-1 ring-on-surface"
                    : "border-outline-variant/60 hover:border-outline",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{f.name}</span>
                  {on && <Icon name="check_circle" filled className="text-lg" />}
                </div>
                <div className="text-[11px] text-on-surface-variant mt-0.5">{f.control}</div>
                <div className="mt-3 flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-headline">{signal[f.id]}%</span>
                  <span className="text-[11px] text-on-surface-variant text-right max-w-[60%]">
                    {f.signal}
                  </span>
                </div>
                <div className="mt-2">
                  <Meter pct={signal[f.id]} label={`${f.name} signal`} />
                </div>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-on-surface-variant -mt-3">
          Indicative evidence signals computed from this scope. They are not a compliance
          determination or an auditor's opinion.
        </p>

        <Panel title="Scope Configuration" testId="scope-card">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <label className="flex flex-col gap-1.5" htmlFor="export-project-select">
              <span className="font-medium text-on-surface-variant">Repository</span>
              <select
                id="export-project-select"
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                data-testid="export-project-select"
                className="rounded-md border border-outline-variant/60 bg-surface-container-lowest px-2 py-1.5"
              >
                <option value="all">All Projects</option>
                {projects.map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5" htmlFor="export-range-select">
              <span className="font-medium text-on-surface-variant">Date range (first seen)</span>
              <select
                id="export-range-select"
                value={range}
                onChange={(e) => setRange(e.target.value as RangeId)}
                data-testid="export-range-select"
                className="rounded-md border border-outline-variant/60 bg-surface-container-lowest px-2 py-1.5"
              >
                <option value="all">All time</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5" htmlFor="export-level-select">
              <span className="font-medium text-on-surface-variant">Report level</span>
              <select
                id="export-level-select"
                value={level}
                onChange={(e) => setLevel(e.target.value as LevelId)}
                data-testid="export-level-select"
                className="rounded-md border border-outline-variant/60 bg-surface-container-lowest px-2 py-1.5"
              >
                <option value="summary">Summary (registry only)</option>
                <option value="detailed">Detailed (with evidence traces)</option>
              </select>
            </label>
          </div>
          <p className="mt-3 text-xs text-on-surface-variant">
            Selected scope includes <strong className="text-on-surface">{findings.length}</strong>{" "}
            findings.
          </p>
        </Panel>
      </div>

      {loading ? (
        <Loading>Compiling audit ledger...</Loading>
      ) : (
        <Panel testId="printable-report-card" title="Live Document Preview">
          <article className="flex flex-col gap-6">
            <header className="border-b border-outline-variant/40 pb-4">
              <h1 className="text-2xl font-extrabold font-headline">
                SecDevOps Security Audit Report
              </h1>
              <div className="mt-1 text-xs text-on-surface-variant flex flex-wrap gap-x-4 gap-y-1">
                <span>Generated: {new Date().toLocaleString()}</span>
                <span>Scope: {scopeName}</span>
                <span>Framing: {fw.name}</span>
              </div>
            </header>

            <section>
              <h2 className="text-base font-semibold mb-2">Executive Summary</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                {[
                  ["Confirmed", confirmed.length, "verified"],
                  [
                    "Critical",
                    findings.filter((f) => f.verifiedSeverity === "critical").length,
                    "critical",
                  ],
                  ["High", findings.filter((f) => f.verifiedSeverity === "high").length, "high"],
                  [
                    "Needs validation (advisory)",
                    findings.filter((f) => f.verdict === "needs_validation").length,
                    "advisory",
                  ],
                ].map(([label, n, tone]) => (
                  <div
                    key={String(label)}
                    className="rounded-md border border-outline-variant/50 bg-surface-container-low p-3"
                  >
                    <div className="text-on-surface-variant">{label}</div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-xl font-bold font-mono">{n}</span>
                      <Pill tone={tone as "verified" | "critical" | "high" | "advisory"}>
                        {String(label).split(" ")[0]}
                      </Pill>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="text-base font-semibold mb-2">Findings Registry</h2>
              <div className={tableCls.wrap}>
                <table className={tableCls.table}>
                  <thead>
                    <tr className={tableCls.headRow}>
                      {[
                        "Verified Severity",
                        "Hunter Severity",
                        "Verdict",
                        "Title",
                        "Status",
                        "Location",
                      ].map((h) => (
                        <th key={h} className={tableCls.th}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {findings.map((f) => (
                      <tr key={f.id} className={tableCls.row}>
                        <td className={tableCls.td}>
                          <SeverityBadge severity={f.verifiedSeverity} />
                        </td>
                        <td className={tableCls.td}>
                          <SeverityBadge severity={f.originalSeverity} />
                        </td>
                        <td className={tableCls.td}>
                          <VerdictBadge verdict={f.verdict} />
                        </td>
                        <td className={`${tableCls.td} font-semibold`}>{f.title}</td>
                        <td className={tableCls.td}>
                          <StatusBadge status={f.status} />
                        </td>
                        <td className={`${tableCls.td} font-mono`}>
                          {f.location.file}:{f.location.line}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {level === "detailed" && (
              <section>
                <h3 className="text-base font-semibold mb-2">Finding Evidence Traces</h3>
                <div className="flex flex-col gap-4">
                  {findings.map((f) => (
                    <div key={f.id} className="rounded-md border border-outline-variant/50 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-semibold">{f.title}</h4>
                        <code className="text-[11px] font-mono text-on-surface-variant">
                          {f.fingerprint}
                        </code>
                      </div>
                      <p className="mt-1 text-xs text-on-surface-variant">{f.description}</p>
                      <ol className="mt-2 flex flex-col gap-1 text-xs font-mono">
                        {f.trace.map((step, i) => (
                          <li key={i}>
                            <span className="uppercase text-on-surface-variant">{step.kind}</span>{" "}
                            {step.file}:{step.line}{" "}
                            <span className="text-on-surface-variant">({step.scope})</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </article>
        </Panel>
      )}
    </div>
  );
}
