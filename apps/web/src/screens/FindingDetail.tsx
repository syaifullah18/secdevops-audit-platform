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
import { ExploitTerminalModal } from "../components/ExploitTerminalModal.js";
import { Icon } from "../components/Icon.js";
import { ErrorBanner, Loading, Panel, Pill, btn } from "../components/stitch.js";

export function FindingDetailScreen() {
  const { id } = useParams<{ id: string }>();

  const [finding, setFinding] = useState<Finding | null>(null);
  const [history, setHistory] = useState<TriageEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);

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

  if (loading) return <Loading>Loading finding inspection record...</Loading>;
  if (error || !finding) {
    return <ErrorBanner>Error loading finding: {error || "Finding not found"}</ErrorBanner>;
  }

  return (
    <div className="flex flex-col gap-6" data-testid="finding-detail-screen">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <VerdictBadge verdict={finding.verdict} />
              <StatusBadge status={finding.status} />
              <Pill>{finding.attackClass}</Pill>
              {finding.cwe && <Pill>{finding.cwe}</Pill>}
              <AttributionLabel model={finding.model} phase={finding.phase} />
            </div>
            <h2 className="text-xl font-bold font-headline tracking-tight">{finding.title}</h2>
            <div className="text-xs text-on-surface-variant flex flex-wrap gap-x-3 gap-y-1">
              <span>
                Location:{" "}
                <code className="font-mono text-on-surface">
                  {finding.location.file}:{finding.location.line}
                </code>
                {finding.location.symbol && ` (${finding.location.symbol})`}
              </span>
              <span>
                Fingerprint: <code className="font-mono">{finding.fingerprint}</code>
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={btn.primary}
              onClick={() => setTerminalOpen(true)}
              data-testid="launch-sandbox-proof"
            >
              <Icon name="terminal" className="text-[16px]" />
              Launch Sandbox Exploit Proof
            </button>
            <Link to={`/projects/${finding.projectId}`} className={btn.secondary}>
              View Project
            </Link>
          </div>
        </div>

        <div className="mt-5">
          <SideBySideSeverity
            originalSeverity={finding.originalSeverity}
            verifiedSeverity={finding.verifiedSeverity}
          />
        </div>

        <div className="mt-5">
          <h4 className="text-xs font-semibold mb-1">Description</h4>
          <p className="text-sm leading-relaxed">{finding.description}</p>
        </div>
        {finding.rootCause && (
          <div className="mt-4 rounded-md bg-surface-container-low border border-outline-variant/40 px-4 py-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
              Underlying Root Cause:
            </span>
            <p className="text-sm mt-0.5">{finding.rootCause}</p>
          </div>
        )}
      </Panel>

      {finding.triageSuggestion && <System1AdvisoryView suggestion={finding.triageSuggestion} />}

      <Panel
        testId="verifier-result-card"
        title="Verifier Proof & Confidence Assessment"
        subtitle="Independent verification results produced during the audit pipeline"
      >
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs">
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
            data-testid="blockers-container"
            className="mt-4 rounded-md border border-advisory-border bg-advisory-bg px-4 py-3"
          >
            <h4 className="text-xs font-bold text-advisory-ink mb-2">
              Unresolved Verification Blockers (Security Review Required):
            </h4>
            <ul className="list-disc pl-5 text-sm space-y-1">
              {finding.blockers.map((b, idx) => (
                <li key={idx}>{b}</li>
              ))}
            </ul>
          </div>
        )}
        {finding.verdict === "rejected" && finding.rejectionReason && (
          <div
            data-testid="rejection-reason-container"
            className="mt-4 rounded-md border border-outline-variant/60 bg-surface-container-low px-4 py-3"
          >
            <h4 className="text-xs font-bold text-on-surface-variant mb-1.5">
              Refutation Proof & Rejection Rationale:
            </h4>
            <p className="text-sm leading-relaxed">{finding.rejectionReason}</p>
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel
          testId="source-trace-card"
          title="Vulnerability Source Trace"
          subtitle="Entrypoint → Propagation → Sink data-flow graph"
        >
          <SourceTraceViewer trace={finding.trace} />
        </Panel>
        <Panel
          testId="evidence-items-card"
          title="Supporting Evidence Records"
          subtitle="Observed artifacts and runtime proofs"
        >
          <div className="flex flex-col gap-2.5">
            {finding.evidence.map((item, idx) => (
              <div
                key={idx}
                className="rounded-md bg-surface-container-low border border-outline-variant/40 px-3 py-2.5"
              >
                <code className="text-[11px] font-mono text-on-surface">
                  {item.file}:{item.line}
                </code>
                <p className="text-xs text-on-surface-variant mt-1">{item.description}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <FixDraftViewer remediation={finding.remediation} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <TriageActionForm
          currentStatus={finding.status}
          currentOwner={finding.owner}
          onTriage={handleTriage}
        />
        <Panel
          testId="triage-history-card"
          title="Triage Audit Log"
          subtitle="Immutable record of every state change"
        >
          {history.length === 0 ? (
            <div className="text-sm text-on-surface-variant">
              No previous triage events recorded.
            </div>
          ) : (
            <ol className="flex flex-col gap-3">
              {history.map((evt) => (
                <li
                  key={evt.id}
                  data-testid={`triage-event-${evt.id}`}
                  className="rounded-md bg-surface-container-low border border-outline-variant/40 px-3 py-2.5 flex flex-col gap-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs">
                      <Pill>{evt.from}</Pill>
                      <Icon
                        name="arrow_right_alt"
                        className="text-[16px] text-on-surface-variant"
                      />
                      <StatusBadge status={evt.to} />
                    </div>
                    <span className="text-[11px] text-on-surface-variant">
                      {new Date(evt.at).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-[11px] text-on-surface-variant">
                    Actor: <strong className="text-on-surface">{evt.actor.subject}</strong> (
                    {evt.actor.role})
                  </div>
                  {evt.reason && <div className="text-xs italic">"{evt.reason}"</div>}
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      <ExploitTerminalModal
        finding={finding}
        open={terminalOpen}
        onClose={() => setTerminalOpen(false)}
      />
    </div>
  );
}
