import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import type { Project, GateResult, Finding, Exception } from "@sdap/core";
import { SeverityBadge } from "../components/Badges.js";
import { Icon } from "../components/Icon.js";
import {
  ErrorBanner,
  Loading,
  PageHeader,
  Panel,
  Pill,
  btn,
  cx,
  tableCls,
} from "../components/stitch.js";

interface ProjectGateStatus {
  project: Project;
  gate: GateResult;
  findings: Finding[];
}

type Check = { id: string; title: string; detail: string; state: "pass" | "fail" | "info" };

/** "3d 4h left", "expired 2d ago". */
export const countdown = (iso: string | null, now = Date.now()): string => {
  if (!iso) return "No expiry";
  const ms = new Date(iso).getTime() - now;
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86_400_000);
  const h = Math.floor((abs % 86_400_000) / 3_600_000);
  const span = d > 0 ? `${d}d ${h}h` : `${h}h`;
  return ms >= 0 ? `${span} left` : `expired ${span} ago`;
};

export function ReleaseReadinessScreen() {
  const [statuses, setStatuses] = useState<ProjectGateStatus[]>([]);
  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        const [projects, excs] = await Promise.all([api.getProjects(), api.getExceptions()]);
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
          setExceptions(excs);
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

  if (loading) return <Loading>Evaluating release readiness across projects...</Loading>;
  if (error) return <ErrorBanner>Error evaluating release gates: {error}</ErrorBanner>;

  const allFindings = statuses.flatMap((s) => s.findings);
  const blockedCount = statuses.filter((s) => !s.gate.pass).length;
  const totalViolations = statuses.reduce((n, s) => n + s.gate.violations.length, 0);
  const totalExcepted = statuses.reduce((n, s) => n + s.gate.excepted.length, 0);
  const confirmed = allFindings.filter((f) => f.verdict === "confirmed");
  const unproven = confirmed.filter((f) => !f.trace.some((s) => s.kind === "sink"));
  const leads = allFindings.filter((f) => f.verdict === "needs_validation");

  // Every check is computed from live data; none is a hard-coded pass.
  const checks: Check[] = [
    {
      id: "blocking",
      title: "No blocking confirmed findings",
      detail:
        totalViolations === 0
          ? "No confirmed finding violates a gate rule."
          : `${totalViolations} confirmed finding(s) violate a gate rule.`,
      state: totalViolations === 0 ? "pass" : "fail",
    },
    {
      id: "taint",
      title: "Confirmed findings have validated taint reachability",
      detail:
        unproven.length === 0
          ? `${confirmed.length} confirmed finding(s) all trace to a sink.`
          : `${unproven.length} confirmed finding(s) lack a recorded sink.`,
      state: unproven.length === 0 ? "pass" : "fail",
    },
    {
      id: "signoff",
      title: "Advisory leads require human sign-off",
      detail: `${leads.length} lead(s) await review. They never fail the gate on their own.`,
      state: "info",
    },
  ];

  const findingMap = new Map(allFindings.map((f) => [f.id, f]));
  const projectName = (id: string) => statuses.find((s) => s.project.id === id)?.project.slug ?? id;

  return (
    <div className="flex flex-col gap-6" data-testid="release-readiness-screen">
      <PageHeader
        title="Release Readiness"
        subtitle="Deterministic gatekeeper: only open confirmed findings can fail a release."
      />

      <div
        className={cx(
          "rounded-lg border px-5 py-4 flex flex-wrap items-center justify-between gap-4",
          blockedCount > 0
            ? "bg-sev-high-bg border-sev-high-border text-sev-high-ink"
            : "bg-verified-bg border-verified-border text-verified-ink",
        )}
      >
        <div className="flex items-center gap-3">
          <Icon name={blockedCount > 0 ? "block" : "check_circle"} filled className="text-3xl" />
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide">
              Deterministic Gatekeeper
            </div>
            <h3 className="text-lg font-bold font-headline">
              {blockedCount === 0
                ? "All Projects Ready for Release"
                : `${blockedCount} Project(s) Blocked by Security Policy Gate`}
            </h3>
            <p className="text-xs mt-0.5">
              Core Principle: Only open confirmed findings can fail a release gate. Advisory leads
              (AI suggestions) and rejected candidates never block.
            </p>
          </div>
        </div>
        <span className="text-xl font-bold font-mono tracking-wide" data-testid="gatekeeper-status">
          {blockedCount > 0 ? "BLOCKED" : "PASSED"}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Panel title="Invariant Evaluation" className="lg:col-span-1" testId="invariants-card">
          <ul className="flex flex-col gap-3">
            {checks.map((c) => (
              <li key={c.id} className="flex items-start gap-3" data-testid={`check-${c.id}`}>
                <Icon
                  name={
                    c.state === "pass" ? "check_circle" : c.state === "fail" ? "cancel" : "info"
                  }
                  filled
                  className={cx(
                    "text-xl mt-0.5",
                    c.state === "pass" && "text-verified-ink",
                    c.state === "fail" && "text-sev-critical-ink",
                    c.state === "info" && "text-advisory-ink",
                  )}
                />
                <div>
                  <div className="text-sm font-semibold text-on-surface">{c.title}</div>
                  <div className="text-xs text-on-surface-variant">{c.detail}</div>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 pt-3 border-t border-outline-variant/40 flex justify-between text-xs">
            <span className="text-on-surface-variant">Exempted by active exceptions</span>
            <strong className="font-mono">{totalExcepted}</strong>
          </div>
        </Panel>

        <Panel
          title="Active Exceptions Ledger"
          subtitle="Waivers expire automatically; an expired accepted risk counts as open again."
          className="lg:col-span-2"
          testId="exceptions-ledger-card"
        >
          {exceptions.length === 0 ? (
            <p className="text-sm text-on-surface-variant">No active exceptions.</p>
          ) : (
            <div className={tableCls.wrap}>
              <table className={tableCls.table}>
                <thead>
                  <tr className={tableCls.headRow}>
                    {["Finding", "Project", "Kind", "Approver", "Expires"].map((h) => (
                      <th key={h} className={tableCls.th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {exceptions.map((e) => {
                    const expired =
                      e.expiresAt !== null && new Date(e.expiresAt).getTime() < Date.now();
                    return (
                      <tr key={e.id} className={tableCls.row}>
                        <td className={`${tableCls.td} font-mono`}>{e.fingerprint}</td>
                        <td className={tableCls.td}>{projectName(e.projectId)}</td>
                        <td className={tableCls.td}>
                          <Pill tone={e.kind === "accepted_risk" ? "medium" : "neutral"}>
                            {e.kind.replace("_", " ")}
                          </Pill>
                        </td>
                        <td className={tableCls.td}>{e.approver}</td>
                        <td className={tableCls.td}>
                          <Pill tone={expired ? "critical" : "low"} icon="schedule">
                            {countdown(e.expiresAt)}
                          </Pill>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <div className="flex flex-col gap-4">
        <h3 className="text-base font-semibold font-headline">Project Gates</h3>
        {statuses.map(({ project, gate }) => (
          <div
            key={project.id}
            data-testid={`project-gate-card-${project.id}`}
            className={cx(
              "rounded-lg bg-surface-container-lowest border border-outline-variant/60 shadow-sm p-5 border-l-4",
              gate.pass ? "border-l-verified-ink" : "border-l-sev-critical-ink",
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold">{project.name}</h4>
                <div className="text-[11px] text-on-surface-variant mt-0.5">
                  Mode: {gate.mode === "enforce" ? "Enforce" : "Report Only"} · Evaluated{" "}
                  {new Date(gate.evaluatedAt).toLocaleTimeString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span data-testid={`gate-badge-${project.id}`}>
                  <Pill tone={gate.pass ? "verified" : "critical"} className="text-xs">
                    {gate.pass ? "GATE PASSED" : "GATE BLOCKED"}
                  </Pill>
                </span>
                <Link to={`/projects/${project.id}`} className={btn.secondary}>
                  View Project
                </Link>
              </div>
            </div>

            {gate.violations.length > 0 && (
              <div
                className="mt-4 pt-3 border-t border-outline-variant/40"
                data-testid={`violations-list-${project.id}`}
              >
                <div className="text-[11px] font-semibold text-sev-critical-ink mb-2">
                  Gate Blocking Confirmed Findings ({gate.violations.length}):
                </div>
                <ul className="flex flex-col gap-2">
                  {gate.violations.map((v) => {
                    const f = findingMap.get(v.findingId);
                    return (
                      <li
                        key={v.findingId}
                        className="flex flex-wrap items-center gap-2 rounded-md bg-surface-container-low border border-outline-variant/40 px-3 py-2"
                      >
                        <SeverityBadge severity={v.severity} />
                        <Link
                          to={`/findings/${v.findingId}`}
                          className="text-xs font-semibold hover:underline"
                        >
                          {f?.title || v.fingerprint}
                        </Link>
                        <span className="ml-auto text-[11px] font-mono text-on-surface-variant">
                          Fingerprint: <code>{v.fingerprint}</code>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {gate.excepted.length > 0 && (
              <div className="mt-3 text-xs text-on-surface-variant">
                {gate.excepted.length} finding(s) exempted by active security exceptions.
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
