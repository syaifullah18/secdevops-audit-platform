import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import {
  SEVERITY_RANK,
  type Policy,
  type Exception,
  type Project,
  type Severity,
} from "@sdap/core";
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
import { FIXTURE_POLICY_1_ID } from "../api/fixtures.js";
import { countdown } from "./ReleaseReadiness.js";

const SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low", "informational"];

const INTEGRATIONS = [
  { name: "Slack", icon: "forum", note: "Run and gate notifications" },
  { name: "PagerDuty", icon: "notifications_active", note: "Page on SLA breach" },
  { name: "Jira", icon: "confirmation_number", note: "Create issue from a confirmed finding" },
] as const;

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

  if (loading) return <Loading>Loading security policies & governance exceptions...</Loading>;
  if (error || !policy)
    return <ErrorBanner>Error loading policy: {error || "Policy not found"}</ErrorBanner>;

  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const enforce = policy.mode === "enforce";

  return (
    <div className="flex flex-col gap-6" data-testid="policy-view-screen">
      <PageHeader
        title="Policy & Exceptions"
        subtitle="Policy as code decides which confirmed findings block a release."
        actions={
          <Link to="/review-queue" className={btn.primary} data-testid="create-waiver-cta">
            <Icon name="add" className="text-[16px]" />
            Create Waiver
          </Link>
        }
      />

      <Panel
        testId="policy-rules-card"
        title="Policy-as-Code Configuration"
        subtitle={policy.name}
        actions={
          <div
            role="radiogroup"
            aria-label="Enforcement mode (set in the policy file)"
            className="flex items-center p-0.5 bg-surface-container-low border border-outline-variant/50 rounded-lg text-xs"
          >
            {[
              { id: "enforce", label: "STRICT ENFORCE" },
              { id: "report_only", label: "REPORT ONLY" },
            ].map((m) => {
              const on = (m.id === "enforce") === enforce;
              return (
                <span
                  key={m.id}
                  role="radio"
                  aria-checked={on}
                  className={cx(
                    "px-2.5 py-1 rounded-md font-semibold",
                    on
                      ? "bg-surface-container-lowest text-on-surface shadow-sm border border-outline-variant/40"
                      : "text-on-surface-variant",
                  )}
                >
                  {on ? m.label : m.label.toLowerCase().replace(/^./, (c) => c.toUpperCase())}
                </span>
              );
            })}
          </div>
        }
      >
        <p className="text-[11px] text-on-surface-variant mb-4 flex items-center gap-1.5">
          <Icon name="lock" className="text-[14px]" />
          The mode is read from the policy file and changes through a reviewed commit, not from this
          screen.
        </p>

        <h4 className="text-xs font-semibold text-on-surface mb-2">Automated Release Gate Rules</h4>
        <div className={tableCls.wrap}>
          <table className={tableCls.table}>
            <thead>
              <tr className={tableCls.headRow}>
                {["Verdict", "Blocks at or above", "Attack classes"].map((h) => (
                  <th key={h} className={tableCls.th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {policy.rules.map((r, i) => (
                <tr key={i} className={tableCls.row}>
                  <td className={tableCls.td}>
                    <Pill tone="verified" icon="verified">
                      {r.verdict}
                    </Pill>
                  </td>
                  <td className={tableCls.td}>
                    <SeverityBadge severity={r.minSeverity} />
                  </td>
                  <td className={tableCls.td}>
                    {r.attackClasses.length === 0 ? (
                      <span className="text-on-surface-variant">All classes</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {r.attackClasses.map((c) => (
                          <Pill key={c}>{c}</Pill>
                        ))}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h4 className="text-xs font-semibold text-on-surface mt-5 mb-2">
          SLA Thresholds by Severity
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {SEVERITIES.slice()
            .sort((a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a])
            .map((s) => (
              <div
                key={s}
                className="rounded-md bg-surface-container-low border border-outline-variant/40 px-3 py-2"
              >
                <SeverityBadge severity={s} />
                <div className="mt-1.5 font-mono text-sm font-bold text-on-surface">
                  {policy.slaDays[s] === null || policy.slaDays[s] === undefined
                    ? "No SLA"
                    : `${policy.slaDays[s]} days`}
                </div>
              </div>
            ))}
        </div>
      </Panel>

      <Panel
        testId="exceptions-table-card"
        title="Security Waivers & Exceptions"
        subtitle="Accepted risks need an approver and an expiry; false positives need a reason."
      >
        {exceptions.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No exceptions on record.</p>
        ) : (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead>
                <tr className={tableCls.headRow}>
                  {["Fingerprint", "Project", "Kind", "Reason", "Approver", "Expires"].map((h) => (
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
                      <td className={tableCls.td}>
                        {projectMap.get(e.projectId)?.slug ?? e.projectId}
                      </td>
                      <td className={tableCls.td}>
                        <Pill tone={e.kind === "accepted_risk" ? "medium" : "neutral"}>
                          {e.kind.replace("_", " ")}
                        </Pill>
                      </td>
                      <td className={`${tableCls.td} max-w-xs`}>{e.reason}</td>
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

      <Panel
        testId="integrations-card"
        title="Webhook & Alert Integrations"
        subtitle="Inbound CI webhooks are signed per project. Outbound notifications are not part of v0.1."
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {INTEGRATIONS.map((i) => (
            <div
              key={i.name}
              className="rounded-md border border-outline-variant/50 bg-surface-container-low px-4 py-3 flex items-center gap-3"
            >
              <Icon name={i.icon} className="text-xl text-on-surface-variant" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{i.name}</div>
                <div className="text-[11px] text-on-surface-variant">{i.note}</div>
              </div>
              <Pill>Not connected</Pill>
            </div>
          ))}
        </div>
        <h4 className="text-xs font-semibold text-on-surface mt-5 mb-2">Inbound webhook secrets</h4>
        <ul className="flex flex-col gap-1.5">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center justify-between text-xs">
              <span className="font-mono">{p.slug}</span>
              <Pill
                tone={p.webhookSecretRef ? "verified" : "neutral"}
                icon={p.webhookSecretRef ? "key" : "key_off"}
              >
                {p.webhookSecretRef ? "Secret reference set" : "No webhook secret"}
              </Pill>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
