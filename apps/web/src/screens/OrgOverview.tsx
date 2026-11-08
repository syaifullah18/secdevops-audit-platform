import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import type { Finding, Project, Severity } from "@sdap/core";
import type { OrgOverviewMetrics } from "../api/types.js";
import { SeverityBadge, VerdictBadge } from "../components/Badges.js";
import { Icon } from "../components/Icon.js";
import {
  ErrorBanner,
  Loading,
  Meter,
  PageHeader,
  Panel,
  Pill,
  Stat,
  btn,
  severityTone,
  tableCls,
} from "../components/stitch.js";

const SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low", "informational"];
const SEV_BAR: Record<Severity, string> = {
  critical: "bg-sev-critical-ink",
  high: "bg-sev-high-ink",
  medium: "bg-sev-medium-ink",
  low: "bg-sev-low-ink",
  informational: "bg-outline",
};

/** Heat cell colour for the attack-class matrix, by count. */
const heat = (n: number): string => {
  if (n <= 0) return "text-outline";
  if (n === 1) return "bg-surface-container-high text-on-surface";
  if (n === 2) return "bg-sev-medium-bg text-sev-medium-ink border border-sev-medium-border";
  return "bg-sev-critical-bg text-sev-critical-ink border border-sev-critical-border font-bold";
};

export function OrgOverviewScreen() {
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
          api.getFindings({ limit: 100 }),
        ]);
        if (mounted) {
          setMetrics(overviewData);
          setProjects(projs);
          setFindings(fPage.items);
        }
      } catch (err: unknown) {
        if (mounted) setError(err instanceof Error ? err.message : "Failed to load overview");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) return <Loading>Loading organization security posture...</Loading>;
  if (error || !metrics) return <ErrorBanner>Error loading overview: {error}</ErrorBanner>;

  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const slaBreaches = findings.filter((f) => f.slaDue && new Date(f.slaDue).getTime() < Date.now());
  const confirmed = metrics.openByVerdict["confirmed"] ?? 0;
  const advisory = metrics.openByVerdict["needs_validation"] ?? 0;
  const rejected = metrics.openByVerdict["rejected"] ?? 0;
  const maxTrend = Math.max(
    1,
    ...metrics.trend.flatMap((p) => [p.openFindings, p.resolvedFindings]),
  );

  const perProject = projects.map((p) => {
    const own = findings.filter((f) => f.projectId === p.id && f.verdict === "confirmed");
    const bySev = (s: Severity) => own.filter((f) => f.verifiedSeverity === s).length;
    const crit = bySev("critical");
    const high = bySev("high");
    // Posture is derived from confirmed findings only; advisory leads never lower it.
    const score = Math.max(0, 100 - crit * 30 - high * 15 - (own.length - crit - high) * 5);
    return { p, open: own.length, crit, high, score };
  });
  const grade = (n: number) =>
    n >= 90 ? "A" : n >= 75 ? "B" : n >= 60 ? "C" : n >= 40 ? "D" : "F";

  return (
    <div className="flex flex-col gap-6" data-testid="org-overview-screen">
      <PageHeader
        title="Organization Security Posture"
        subtitle="Deterministic findings gate releases; advisory suggestions never do."
        actions={
          <Pill tone="verified" icon="sync">
            {projects.length} repositories synced
          </Pill>
        }
      />

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat
          testId="metric-open-findings"
          label="Open Findings"
          value={metrics.totalOpenFindings}
          sub={
            <span className="flex flex-wrap gap-1.5 mt-1.5">
              <Pill tone="verified" icon="verified">
                {confirmed} deterministic
              </Pill>
              <Pill tone="advisory" icon="auto_awesome">
                {advisory} advisory
              </Pill>
            </span>
          }
        />
        <Stat
          testId="metric-sla-breaches"
          label="SLA Breaches"
          value={metrics.slaBreachesCount}
          valueClassName={metrics.slaBreachesCount > 0 ? "!text-sev-critical-ink" : ""}
          sub="Findings past SLA due date"
          right={
            metrics.slaBreachesCount > 0 ? (
              <Icon name="warning" className="text-sev-critical-ink text-[18px]" />
            ) : undefined
          }
        />
        <Stat
          testId="metric-mttr"
          label="Mean Time to Remediate"
          value={`${metrics.meanTimeToRemediateDays}d`}
          sub="Average turnaround to verified fixed"
        />
        <Stat
          testId="metric-active-projects"
          label="Audited Projects"
          value={projects.length}
          sub="Monitored repositories"
        />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 flex flex-col gap-6">
          <Panel
            testId="cross-project-attack-class"
            title="Cross-Project Attack Class Distribution"
            subtitle="Heatmap view of vulnerability classes across all audited services"
          >
            <div className={tableCls.wrap}>
              <table className={tableCls.table}>
                <thead>
                  <tr className={tableCls.headRow}>
                    <th className={tableCls.th}>Attack Class</th>
                    <th className={tableCls.th}>Total Issues</th>
                    {projects.map((p) => (
                      <th key={p.id} className={tableCls.th}>
                        <Link className="hover:underline" to={`/projects/${p.id}`}>
                          {p.slug}
                        </Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {metrics.crossProjectAttackClasses.map((ac) => (
                    <tr key={ac.attackClass} className={tableCls.row}>
                      <td className={`${tableCls.td} font-semibold text-on-surface`}>
                        {ac.attackClass}
                      </td>
                      <td className={`${tableCls.td} font-mono`}>{ac.count}</td>
                      {projects.map((p) => {
                        const n = ac.byProject[p.id] || 0;
                        return (
                          <td key={p.id} className={tableCls.td}>
                            <span
                              className={`inline-flex min-w-7 justify-center rounded px-1.5 py-0.5 font-mono text-[11px] ${heat(n)}`}
                            >
                              {n > 0 ? n : "-"}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel
            testId="trend-chart-card"
            title="Findings Trend Over Time"
            subtitle="Weekly rolling volume of open vs remediated vulnerabilities"
            actions={
              <div className="flex items-center gap-3 text-[11px] text-on-surface-variant">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-sev-critical-ink" /> Open Findings
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-verified-ink" /> Resolved Findings
                </span>
              </div>
            }
          >
            <div className="flex items-end gap-6 h-40">
              {metrics.trend.map((point) => (
                <div key={point.date} className="flex-1 flex flex-col items-center gap-2 h-full">
                  <div className="flex items-end gap-1 flex-1 w-full justify-center">
                    <div
                      title={`Open: ${point.openFindings}`}
                      className="w-5 rounded-t bg-sev-critical-ink"
                      style={{ height: `${(point.openFindings / maxTrend) * 100}%` }}
                    />
                    <div
                      title={`Resolved: ${point.resolvedFindings}`}
                      className="w-5 rounded-t bg-verified-ink"
                      style={{ height: `${(point.resolvedFindings / maxTrend) * 100}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-mono text-on-surface-variant">
                    {point.date.slice(5)}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="lg:col-span-4 flex flex-col gap-6">
          <Panel
            title="Open Findings by Verified Severity"
            subtitle="Authoritative severity determined post-validation"
          >
            <div className="flex flex-col gap-3">
              {SEVERITIES.map((sev) => {
                const count = metrics.openBySeverity[sev] || 0;
                const pct =
                  metrics.totalOpenFindings > 0 ? (count / metrics.totalOpenFindings) * 100 : 0;
                return (
                  <div key={sev} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <SeverityBadge severity={sev} />
                      <span className="font-mono text-xs font-bold text-on-surface">{count}</span>
                    </div>
                    <Meter pct={pct} barClassName={SEV_BAR[sev]} label={`${sev} share`} />
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel
            title="Findings by Verification Verdict"
            subtitle={"Verification status (rejected candidates hidden)"}
          >
            <div className="flex flex-col gap-2">
              {(
                [
                  ["confirmed", confirmed, "Proved vulnerabilities", "Deterministic"],
                  ["needs_validation", advisory, "Pending sandbox/verifier proof", "Advisory"],
                  ["rejected", rejected, "Refuted candidate leads", "Ignored"],
                ] as const
              ).map(([verdict, count, text]) => (
                <div
                  key={verdict}
                  className="flex items-center justify-between rounded-md bg-surface-container-low border border-outline-variant/40 px-3 py-2.5"
                >
                  <div className="flex flex-col gap-1">
                    <VerdictBadge verdict={verdict} />
                    <span className="text-[11px] text-on-surface-variant">{text}</span>
                  </div>
                  <span className="text-lg font-bold font-mono text-on-surface">{count}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {slaBreaches.length > 0 && (
        <Panel
          testId="sla-breaches-card"
          tone="danger"
          title={
            <span className="flex items-center gap-2 text-sev-critical-ink">
              <Icon name="warning" className="text-lg" />
              Active SLA Breaches ({slaBreaches.length})
            </span>
          }
        >
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead>
                <tr className={tableCls.headRow}>
                  {["Severity", "Title", "Project", "SLA Due", "Owner", "Action"].map((h) => (
                    <th key={h} className={tableCls.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slaBreaches.map((f) => (
                  <tr key={f.id} className={tableCls.row}>
                    <td className={tableCls.td}>
                      <SeverityBadge severity={f.verifiedSeverity} />
                    </td>
                    <td className={`${tableCls.td} font-semibold`}>
                      <Link className="hover:underline" to={`/findings/${f.id}`}>
                        {f.title}
                      </Link>
                    </td>
                    <td className={`${tableCls.td} font-mono`}>
                      {projectMap.get(f.projectId)?.slug || f.projectId}
                    </td>
                    <td className={`${tableCls.td} font-semibold text-sev-critical-ink`}>
                      {f.slaDue ? new Date(f.slaDue).toLocaleDateString() : "-"}
                    </td>
                    <td className={tableCls.td}>{f.owner || "Unassigned"}</td>
                    <td className={tableCls.td}>
                      <Link to={`/findings/${f.id}`} className={btn.secondary}>
                        Inspect
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel
        title="Repository Security Posture"
        subtitle="Grade is computed from confirmed findings only"
      >
        <div className={tableCls.wrap}>
          <table className={tableCls.table}>
            <thead>
              <tr className={tableCls.headRow}>
                {[
                  "Repository / Service",
                  "Team",
                  "Branch",
                  "Confirmed Open",
                  "Health",
                  "Action",
                ].map((h) => (
                  <th key={h} className={tableCls.th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perProject.map(({ p, open, crit, high, score }) => (
                <tr key={p.id} className={tableCls.row}>
                  <td className={tableCls.td}>
                    <Link to={`/projects/${p.id}`} className="font-semibold hover:underline">
                      {p.name}
                    </Link>
                    <code className="block text-[11px] text-on-surface-variant font-mono">
                      {p.repoUrl}
                    </code>
                  </td>
                  <td className={tableCls.td}>{p.team}</td>
                  <td className={`${tableCls.td} font-mono`}>{p.defaultBranch}</td>
                  <td className={tableCls.td}>
                    <span className="font-mono font-bold">{open}</span>
                    {crit + high > 0 && (
                      <Pill tone={severityTone(crit > 0 ? "critical" : "high")} className="ml-2">
                        {crit} crit · {high} high
                      </Pill>
                    )}
                  </td>
                  <td className={`${tableCls.td} w-40`}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold w-5">{grade(score)}</span>
                      <Meter
                        pct={score}
                        label={`${p.name} health`}
                        barClassName={
                          score >= 75
                            ? "bg-verified-ink"
                            : score >= 40
                              ? "bg-sev-medium-ink"
                              : "bg-sev-critical-ink"
                        }
                      />
                    </div>
                  </td>
                  <td className={tableCls.td}>
                    <Link to={`/projects/${p.id}`} className={btn.secondary}>
                      View Project
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
