import { useEffect, useState, type FormEvent } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client.js";
import type { Project, Run, Finding, GateResult, AuditMode } from "@sdap/core";
import type { CoverageSummary } from "../api/types.js";
import { SeverityBadge, StatusBadge, VerdictBadge } from "../components/Badges.js";
import { Icon } from "../components/Icon.js";
import {
  ErrorBanner,
  Loading,
  Meter,
  Panel,
  Pill,
  btn,
  tableCls,
  type Tone,
} from "../components/stitch.js";

export function ProjectViewScreen() {
  const { id } = useParams<{ id: string }>();

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
          api.getFindings({ projectId: id!, limit: 100 }),
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
  }, [id]);

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

  if (loading) return <Loading>Loading project details...</Loading>;
  if (error || !project) {
    return <ErrorBanner>Error loading project: {error || "Project not found"}</ErrorBanner>;
  }

  const runTone = (status: string): Tone =>
    status === "succeeded"
      ? "verified"
      : status === "running"
        ? "low"
        : status === "failed"
          ? "critical"
          : "neutral";
  const phaseDot = (status: string): string =>
    status === "succeeded"
      ? "bg-verified-ink"
      : status === "running"
        ? "bg-sev-low-ink animate-pulse"
        : status === "failed"
          ? "bg-sev-critical-ink"
          : "bg-outline-variant";

  const tokensUsed = runs.reduce((n, r) => n + r.usage.inputTokens + r.usage.outputTokens, 0);
  const costUsed = runs.reduce((n, r) => n + r.usage.costUsd, 0);
  const budget = project.monthlyTokenBudget;
  const budgetPct = budget ? (tokensUsed / budget) * 100 : 0;
  const latest = runs[0];

  return (
    <div className="flex flex-col gap-6" data-testid="project-view-screen">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-xl font-bold font-headline text-on-surface tracking-tight">
                {project.name}
              </h2>
              <Pill>{project.slug}</Pill>
              <Pill
                tone={gate?.pass ? "verified" : "critical"}
                icon={gate?.pass ? "check_circle" : "block"}
              >
                {gate?.pass ? "Gate passing" : "Gate blocked"}
              </Pill>
            </div>
            <p className="mt-1 text-xs text-on-surface-variant">
              Repository: <code className="font-mono text-on-surface">{project.repoUrl}</code>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-outline-variant/60 text-xs font-mono">
              <Icon name="call_split" className="text-[16px] text-on-surface-variant" />
              {project.defaultBranch}
              {latest?.commitSha && (
                <span className="text-outline">@ {latest.commitSha.slice(0, 7)}</span>
              )}
            </span>
            <button
              type="button"
              className={btn.primary}
              onClick={() => setShowTriggerModal(true)}
              data-testid="trigger-run-button"
            >
              <Icon name="bolt" className="text-[16px]" />
              Trigger Audit Run
              <Icon name="expand_more" className="text-[16px]" />
            </button>
          </div>
        </div>
        <dl className="mt-4 pt-4 border-t border-outline-variant/40 flex flex-wrap gap-x-8 gap-y-2 text-xs text-on-surface-variant">
          <div>
            Owning Team: <strong className="text-on-surface">{project.team}</strong>
          </div>
          <div>
            Client: <strong className="text-on-surface">{project.clientId}</strong>
          </div>
          <div>
            Default Branch: <strong className="text-on-surface">{project.defaultBranch}</strong>
          </div>
        </dl>
      </Panel>

      {showTriggerModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onMouseDown={(e) =>
            e.target === e.currentTarget && !triggering && setShowTriggerModal(false)
          }
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="trigger-title"
            className="w-full max-w-md rounded-xl border border-outline-variant bg-surface-container-lowest shadow-2xl p-6"
          >
            <h3 id="trigger-title" className="text-base font-semibold font-headline mb-4">
              Trigger Security Audit
            </h3>
            <form onSubmit={handleTriggerRun} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="run-mode" className="text-xs font-medium text-on-surface-variant">
                  Audit Mode
                </label>
                <select
                  id="run-mode"
                  className="rounded-md border border-outline-variant/60 bg-surface-container-lowest px-3 py-2 text-sm"
                  value={newRunMode}
                  onChange={(e) => setNewRunMode(e.target.value as AuditMode)}
                >
                  <option value="focused">Focused (Changed paths since last run)</option>
                  <option value="incremental">Incremental (Target coverage gaps)</option>
                  <option value="full">Full (Comprehensive scan with repeat-N)</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="run-ref" className="text-xs font-medium text-on-surface-variant">
                  Git Ref / Branch / Commit
                </label>
                <input
                  id="run-ref"
                  type="text"
                  className="rounded-md border border-outline-variant/60 bg-surface-container-lowest px-3 py-2 text-sm font-mono"
                  value={newRunRef}
                  onChange={(e) => setNewRunRef(e.target.value)}
                  required
                />
              </div>
              <div className="flex justify-end gap-2 mt-2">
                <button
                  type="button"
                  className={btn.secondary}
                  onClick={() => setShowTriggerModal(false)}
                  disabled={triggering}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={btn.primary}
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Panel
          testId="gate-status-card"
          title="Release Gate Status"
          actions={
            <Pill tone={gate?.pass ? "verified" : "critical"} className="text-xs">
              {gate?.pass ? "PASSED" : "BLOCKED"}
            </Pill>
          }
        >
          <div className="flex flex-col gap-2.5 text-xs">
            <div className="flex justify-between">
              <span className="text-on-surface-variant">Policy Mode:</span>
              <strong>{gate?.mode === "enforce" ? "Strict Enforce" : "Report Only"}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-on-surface-variant">Blocking Violations:</span>
              <strong className={(gate?.violations.length || 0) > 0 ? "text-sev-critical-ink" : ""}>
                {gate?.violations.length || 0} confirmed findings
              </strong>
            </div>
            <div className="flex justify-between">
              <span className="text-on-surface-variant">Excepted Findings:</span>
              <span>{gate?.excepted.length || 0} active exceptions</span>
            </div>
            {gate && gate.violations.length > 0 && (
              <div className="pt-2.5 mt-1 border-t border-outline-variant/40">
                <span className="text-[11px] font-semibold text-sev-critical-ink">
                  Gate Blocking Findings:
                </span>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {gate.violations.map((v) => (
                    <li key={v.findingId}>
                      <Link className="hover:underline font-mono" to={`/findings/${v.findingId}`}>
                        {v.severity.toUpperCase()} ({v.fingerprint})
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Panel>

        <Panel
          testId="coverage-ledger-card"
          title="Coverage Ledger Summary"
          actions={<Pill>{coverage?.coveragePct.toFixed(1)}% Audited</Pill>}
        >
          {coverage && (
            <div className="flex flex-col gap-2.5 text-xs">
              <Meter pct={coverage.coveragePct} label="Audited coverage" />
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Audited Units:</span>
                <strong>
                  {coverage.auditedUnits} / {coverage.totalUnits}
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Last Audited:</span>
                <span>
                  {coverage.lastAuditedAt
                    ? new Date(coverage.lastAuditedAt).toLocaleString()
                    : "Never"}
                </span>
              </div>
              {coverage.uncoveredPaths.length > 0 && (
                <div className="mt-1">
                  <span className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wide">
                    Coverage Gaps (Unaudited Target Units):
                  </span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {coverage.uncoveredPaths.map((path) => (
                      <code
                        key={path}
                        className="text-[11px] px-1.5 py-0.5 rounded bg-surface-container-high font-mono"
                      >
                        {path}
                      </code>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Panel>

        <Panel testId="token-usage-card" title="Monthly Token Usage">
          <div className="flex flex-col gap-2.5 text-xs">
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold font-headline">${costUsed.toFixed(2)}</span>
              <span className="font-mono text-on-surface-variant">
                {tokensUsed.toLocaleString()} {budget ? `/ ${budget.toLocaleString()}` : ""} tokens
              </span>
            </div>
            {budget ? (
              <Meter
                pct={budgetPct}
                label="Token budget used"
                barClassName={
                  budgetPct >= 90
                    ? "bg-sev-critical-ink"
                    : budgetPct >= 70
                      ? "bg-sev-medium-ink"
                      : "bg-on-surface"
                }
              />
            ) : (
              <p className="text-on-surface-variant">
                No project budget; inherits team or client budget.
              </p>
            )}
          </div>
        </Panel>
      </div>

      <Panel
        testId="run-history-card"
        title="Run History Ledger"
        subtitle="Execution pipeline history, phases, token usage and validator results"
      >
        <div className={tableCls.wrap}>
          <table className={tableCls.table}>
            <thead>
              <tr className={tableCls.headRow}>
                {[
                  "Status",
                  "Mode",
                  "Git Ref",
                  "Commit",
                  "Phases",
                  "Validators",
                  "Token Cost",
                  "Date",
                  "Action",
                ].map((h) => (
                  <th key={h} className={tableCls.th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className={tableCls.row}>
                  <td className={tableCls.td}>
                    <Pill tone={runTone(run.status)}>{run.status}</Pill>
                  </td>
                  <td className={tableCls.td}>
                    <Pill>{run.mode}</Pill>
                  </td>
                  <td className={`${tableCls.td} font-mono`}>{run.ref}</td>
                  <td className={`${tableCls.td} font-mono`}>
                    {run.commitSha ? run.commitSha.slice(0, 7) : "-"}
                  </td>
                  <td className={tableCls.td}>
                    <span className="inline-flex gap-1">
                      {run.phases.map((ph) => (
                        <span
                          key={ph.name}
                          title={`${ph.name}: ${ph.status}`}
                          className={`inline-block h-2 w-2 rounded-full ${phaseDot(ph.status)}`}
                        />
                      ))}
                    </span>
                  </td>
                  <td className={`${tableCls.td} font-mono text-on-surface-variant`}>
                    F: {run.validators.findings} · C: {run.validators.coverageLedger}
                  </td>
                  <td className={`${tableCls.td} font-mono`}>${run.usage.costUsd.toFixed(3)}</td>
                  <td className={tableCls.td}>{new Date(run.createdAt).toLocaleDateString()}</td>
                  <td className={tableCls.td}>
                    <Link
                      to={`/runs/${run.id}`}
                      className={btn.secondary}
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
      </Panel>

      <Panel
        testId="project-findings-card"
        title={`Project Findings (${findings.length})`}
        subtitle={`Active vulnerabilities and candidate issues identified in ${project.name}`}
      >
        <div className={tableCls.wrap}>
          <table className={tableCls.table}>
            <thead>
              <tr className={tableCls.headRow}>
                {[
                  "Severity",
                  "Verdict",
                  "Title",
                  "Attack Class",
                  "Status",
                  "Owner",
                  "SLA Due",
                  "Action",
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
                    <VerdictBadge verdict={f.verdict} />
                  </td>
                  <td className={tableCls.td}>
                    <Link to={`/findings/${f.id}`} className="font-semibold hover:underline">
                      {f.title}
                    </Link>
                    <div className="text-[11px] font-mono text-on-surface-variant">
                      {f.location.file}:{f.location.line}
                    </div>
                  </td>
                  <td className={tableCls.td}>{f.attackClass}</td>
                  <td className={tableCls.td}>
                    <StatusBadge status={f.status} />
                  </td>
                  <td className={tableCls.td}>{f.owner || "Unassigned"}</td>
                  <td className={tableCls.td}>
                    {f.slaDue ? new Date(f.slaDue).toLocaleDateString() : "-"}
                  </td>
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
    </div>
  );
}
