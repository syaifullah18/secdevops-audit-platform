import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { canTransition, type Finding, type Project } from "@sdap/core";
import { AdvisoryBadge, StatusBadge } from "../components/Badges.js";
import { ExploitTerminalModal } from "../components/ExploitTerminalModal.js";
import { Icon } from "../components/Icon.js";
import { ErrorBanner, Loading, Meter, PageHeader, Pill, btn } from "../components/stitch.js";

type ColumnId = "unassigned" | "investigating" | "approval";

/**
 * Column rules (all candidates here are `needs_validation`, so none can fail a gate):
 *  - Awaiting Approval: an AI suggestion exists and a human owns the lead, so it needs signoff.
 *  - In Investigation: an owner is assigned or the status is in_progress.
 *  - Unassigned Triage: everything else.
 */
export const columnOf = (f: Finding): ColumnId => {
  if (f.triageSuggestion && f.owner) return "approval";
  if (f.owner || f.status === "in_progress") return "investigating";
  return "unassigned";
};

const COLUMNS: Array<{ id: ColumnId; title: string; icon: string; hint: string }> = [
  { id: "unassigned", title: "Unassigned Triage", icon: "inbox", hint: "No owner yet" },
  {
    id: "investigating",
    title: "In Investigation",
    icon: "manage_search",
    hint: "Owner working the lead",
  },
  {
    id: "approval",
    title: "Awaiting Approval",
    icon: "fact_check",
    hint: "Advisory suggestion needs signoff",
  },
];

const CONFIDENCE: Record<string, { pct: number; label: string }> = {
  low: { pct: 33, label: "Low" },
  medium: { pct: 66, label: "Medium" },
  high: { pct: 92, label: "High" },
};

export function ReviewQueueScreen() {
  const [items, setItems] = useState<Finding[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterClass, setFilterClass] = useState<string>("all");
  const [filterProject, setFilterProject] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [terminalFor, setTerminalFor] = useState<Finding | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        const [queue, projs] = await Promise.all([api.getReviewQueue(), api.getProjects()]);
        if (mounted) {
          setItems(queue);
          setProjects(projs);
        }
      } catch (err: unknown) {
        if (mounted) setError(err instanceof Error ? err.message : "Failed to load review queue");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const attackClasses = useMemo(
    () => Array.from(new Set(items.map((i) => i.attackClass))),
    [items],
  );
  const projectName = (id: string) => projects.find((p) => p.id === id)?.slug ?? id;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(
      (i) =>
        (filterClass === "all" || i.attackClass === filterClass) &&
        (filterProject === "all" || i.projectId === filterProject) &&
        (!q ||
          i.title.toLowerCase().includes(q) ||
          i.location.file.toLowerCase().includes(q) ||
          i.attackClass.toLowerCase().includes(q)),
    );
  }, [items, filterClass, filterProject, search]);

  const triage = async (f: Finding, to: "in_progress" | "false_positive", why: string) => {
    setBusy(f.id);
    setActionError(null);
    try {
      const updated = await api.triageFinding(f.id, { to, reason: why });
      // A rejected lead leaves the queue; an accepted one moves to In Investigation.
      setItems((prev) =>
        to === "false_positive"
          ? prev.filter((i) => i.id !== f.id)
          : prev.map((i) => (i.id === f.id ? updated : i)),
      );
      setRejecting(null);
      setReason("");
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Triage failed");
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <Loading>Loading security review queue...</Loading>;
  if (error) return <ErrorBanner>Error loading review queue: {error}</ErrorBanner>;

  return (
    <div className="flex flex-col gap-6" data-testid="review-queue-screen">
      <PageHeader
        title="Security Review Queue (Needs Validation)"
        subtitle="Candidate leads from hunter agents where automatic proof could not be established."
      />

      <div className="flex items-start gap-3 rounded-lg border border-advisory-border bg-advisory-bg text-advisory-ink px-4 py-3">
        <Icon name="policy" className="text-xl mt-0.5" />
        <p className="text-xs leading-relaxed">
          <strong>Policy invariant (PRD 5.4):</strong> candidate leads never block a merge or fail a
          gate on their own. Only <em>confirmed</em> findings can. A human signs off every lead
          before it changes state, and AI suggestions stay advisory.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-on-surface-variant">
          Showing <strong className="text-on-surface">{filtered.length}</strong> items awaiting
          verification
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Icon
              name="search"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-on-surface-variant"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search leads..."
              aria-label="Search leads"
              data-testid="queue-search"
              className="w-48 rounded-md border border-outline-variant/60 bg-surface-container-lowest pl-8 pr-2 py-1.5 text-xs"
            />
          </div>
          <select
            aria-label="Filter by repository"
            value={filterProject}
            onChange={(e) => setFilterProject(e.target.value)}
            data-testid="filter-project-select"
            className="rounded-md border border-outline-variant/60 bg-surface-container-lowest px-2 py-1.5 text-xs"
          >
            <option value="all">All repositories</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.slug}
              </option>
            ))}
          </select>
          {attackClasses.length > 0 && (
            <>
              <label htmlFor="filter-class" className="sr-only">
                Filter by Attack Class
              </label>
              <select
                id="filter-class"
                value={filterClass}
                onChange={(e) => setFilterClass(e.target.value)}
                data-testid="filter-class-select"
                className="rounded-md border border-outline-variant/60 bg-surface-container-lowest px-2 py-1.5 text-xs"
              >
                <option value="all">All Classes ({items.length})</option>
                {attackClasses.map((ac) => (
                  <option key={ac} value={ac}>
                    {ac} ({items.filter((i) => i.attackClass === ac).length})
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>

      {actionError && <ErrorBanner>{actionError}</ErrorBanner>}

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-outline-variant/60 bg-surface-container-lowest text-center py-12 px-5">
          <Icon name="task_alt" className="text-3xl text-verified-ink" />
          <h3 className="mt-2 text-base font-semibold text-verified-ink">Queue is Clean</h3>
          <p className="mt-1 text-sm text-on-surface-variant">
            No unvalidated candidate findings are currently pending security review.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          {COLUMNS.map((col) => {
            const colItems = filtered.filter((i) => columnOf(i) === col.id);
            return (
              <section
                key={col.id}
                aria-label={col.title}
                data-testid={`column-${col.id}`}
                className="rounded-lg bg-surface-container-low border border-outline-variant/50 p-3 flex flex-col gap-3 min-h-40"
              >
                <header className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <Icon name={col.icon} className="text-[18px] text-on-surface-variant" />
                    <h3 className="text-sm font-semibold text-on-surface">{col.title}</h3>
                  </div>
                  <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant">
                    {colItems.length}
                  </span>
                </header>
                {colItems.length === 0 && (
                  <p className="px-1 py-4 text-center text-xs text-on-surface-variant">
                    {col.hint}
                  </p>
                )}
                {colItems.map((item) => {
                  const conf = item.confidence ? CONFIDENCE[item.confidence] : undefined;
                  const entry = item.trace.find((s) => s.kind === "entrypoint") ?? item.trace[0];
                  const sink =
                    item.trace.find((s) => s.kind === "sink") ?? item.trace[item.trace.length - 1];
                  const isBusy = busy === item.id;
                  return (
                    <article
                      key={item.id}
                      data-testid={`queue-item-${item.id}`}
                      className="rounded-lg bg-surface-container-lowest border border-outline-variant/60 shadow-sm p-4 flex flex-col gap-3"
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={item.status} />
                        <Pill>{item.attackClass}</Pill>
                        {item.triageSuggestion && <AdvisoryBadge />}
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-on-surface leading-snug">
                          <Link className="hover:underline" to={`/findings/${item.id}`}>
                            {item.title}
                          </Link>
                        </h4>
                        <div className="mt-1 text-[11px] text-on-surface-variant font-mono">
                          {projectName(item.projectId)} · {item.location.file}:{item.location.line}
                        </div>
                      </div>
                      <p className="text-xs text-on-surface-variant line-clamp-3">
                        {item.description}
                      </p>

                      {conf && (
                        <div className="flex flex-col gap-1">
                          <div className="flex justify-between text-[11px] text-on-surface-variant">
                            <span>Hunter confidence</span>
                            <span className="font-semibold text-on-surface">{conf.label}</span>
                          </div>
                          <Meter
                            pct={conf.pct}
                            label="Hunter confidence"
                            barClassName="bg-advisory-ink"
                          />
                        </div>
                      )}

                      {entry && sink && (
                        <div className="text-[11px] font-mono text-on-surface-variant flex items-center gap-1.5 flex-wrap">
                          <span title={entry.description}>
                            {entry.file.split("/").pop()}:{entry.line}
                          </span>
                          <Icon name="arrow_right_alt" className="text-[14px]" />
                          <span className="text-sev-high-ink" title={sink.description}>
                            {sink.file.split("/").pop()}:{sink.line}
                          </span>
                          <span>({item.trace.length} steps)</span>
                        </div>
                      )}

                      <div
                        data-testid={`blockers-${item.id}`}
                        className="rounded-md bg-advisory-bg border border-advisory-border px-3 py-2.5"
                      >
                        <div className="text-[10px] font-bold uppercase tracking-wide text-advisory-ink mb-1">
                          Resolution Blockers ({item.blockers.length}):
                        </div>
                        <ul className="list-disc pl-4 text-xs text-on-surface space-y-0.5">
                          {item.blockers.map((b, i) => (
                            <li key={i}>{b}</li>
                          ))}
                        </ul>
                      </div>

                      {rejecting === item.id ? (
                        <form
                          className="flex flex-col gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void triage(item, "false_positive", reason.trim());
                          }}
                        >
                          <label
                            className="text-[11px] font-medium text-on-surface-variant"
                            htmlFor={`reason-${item.id}`}
                          >
                            Why is this a false positive? (required)
                          </label>
                          <textarea
                            id={`reason-${item.id}`}
                            required
                            rows={2}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            className="rounded-md border border-outline-variant/60 bg-surface-container-lowest px-2 py-1.5 text-xs"
                          />
                          <div className="flex gap-2 justify-end">
                            <button
                              type="button"
                              className={btn.secondary}
                              onClick={() => setRejecting(null)}
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              className={btn.danger}
                              disabled={isBusy || reason.trim() === ""}
                              data-testid={`confirm-reject-${item.id}`}
                            >
                              Confirm Reject
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={btn.primary}
                            disabled={isBusy || !canTransition(item.status, "in_progress")}
                            onClick={() =>
                              void triage(
                                item,
                                "in_progress",
                                "Accepted for investigation from the review queue",
                              )
                            }
                            data-testid={`accept-${item.id}`}
                          >
                            <Icon name="check" className="text-[16px]" />
                            Accept
                          </button>
                          <button
                            type="button"
                            className={btn.secondary}
                            disabled={isBusy || !canTransition(item.status, "false_positive")}
                            onClick={() => {
                              setRejecting(item.id);
                              setReason("");
                            }}
                            data-testid={`reject-${item.id}`}
                          >
                            <Icon name="close" className="text-[16px]" />
                            Reject
                          </button>
                          <button
                            type="button"
                            className={btn.secondary}
                            onClick={() => setTerminalFor(item)}
                            data-testid={`sandbox-${item.id}`}
                          >
                            <Icon name="terminal" className="text-[16px]" />
                            Sandbox Exploit
                          </button>
                          <Link
                            to={`/findings/${item.id}`}
                            className={`${btn.secondary} ml-auto`}
                            data-testid={`review-finding-${item.id}`}
                          >
                            Inspect & Triage
                          </Link>
                        </div>
                      )}
                    </article>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}

      <ExploitTerminalModal
        finding={terminalFor}
        open={terminalFor !== null}
        onClose={() => setTerminalFor(null)}
      />
    </div>
  );
}
