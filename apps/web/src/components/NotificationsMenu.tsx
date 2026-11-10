import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api/client.js";
import { Icon } from "./Icon.js";

interface Note {
  id: string;
  icon: string;
  title: string;
  detail: string;
  to: string;
  at: number;
}

const SEEN_KEY = "sdap_notifications_seen";
const SOON_MS = 14 * 24 * 3600 * 1000;

const readSeen = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
};
const writeSeen = (s: Set<string>): void => {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-200)));
  } catch {
    // storage unavailable: read state lasts for this session only
  }
};

const ago = (at: number): string => {
  const m = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
};

/**
 * Bell with a panel built from live data: findings waiting for review, failed runs and
 * exceptions that are about to expire. There is no separate notifications service; read state
 * is kept in this browser.
 */
export function NotificationsMenu() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(readSeen);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const out: Note[] = [];
    const [queue, runs, exceptions] = await Promise.all([
      api.getReviewQueue().catch(() => []),
      api.getRuns().catch(() => null),
      api.getExceptions().catch(() => []),
    ]);
    for (const f of queue.slice(0, 5)) {
      out.push({
        id: `review:${f.id}`,
        icon: "pending_actions",
        title: "Finding needs review",
        detail: f.title,
        to: `/findings/${f.id}`,
        at: Date.parse(f.lastSeen) || Date.now(),
      });
    }
    for (const r of runs?.items ?? []) {
      if (r.status !== "failed") continue;
      out.push({
        id: `run:${r.id}`,
        icon: "error",
        title: "Audit run failed",
        detail: r.failureReason ?? `Run ${r.id.slice(0, 8)} did not finish`,
        to: `/runs/${r.id}`,
        at: Date.parse(r.endedAt ?? r.createdAt) || Date.now(),
      });
    }
    const now = Date.now();
    for (const e of exceptions) {
      if (!e.expiresAt) continue;
      const left = Date.parse(e.expiresAt) - now;
      if (left > SOON_MS) continue;
      out.push({
        id: `exception:${e.id}:${e.expiresAt}`,
        icon: "event_busy",
        title: left < 0 ? "Exception expired" : "Exception expires soon",
        detail: e.reason,
        to: "/policy",
        at: Date.parse(e.expiresAt),
      });
    }
    out.sort((a, b) => b.at - a.at);
    setNotes(out.slice(0, 15));
    setLoaded(true);
  }, []);

  // Refresh on navigation and whenever the panel opens; the bell is informational.
  useEffect(() => {
    void load();
  }, [load, location.pathname, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unread = useMemo(() => notes.filter((n) => !seen.has(n.id)).length, [notes, seen]);

  const markSeen = (ids: string[]) => {
    const next = new Set(seen);
    ids.forEach((i) => next.add(i));
    setSeen(next);
    writeSeen(next);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        onClick={() => setOpen((o) => !o)}
        data-testid="notifications-button"
        className="relative h-8 w-8 rounded-lg border border-outline-variant/60 flex items-center justify-center text-on-surface-variant hover:bg-surface-container transition-colors"
      >
        <Icon name="notifications" className="text-[18px]" />
        {unread > 0 && (
          <span
            data-testid="notifications-badge"
            className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-error"
          />
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          data-testid="notifications-panel"
          className="absolute right-0 mt-2 w-96 max-w-[calc(100vw-2rem)] rounded-lg border border-outline-variant bg-surface-container-lowest shadow-xl z-50"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/50">
            <span className="text-sm font-semibold">Notifications</span>
            <button
              type="button"
              className="text-xs text-on-surface-variant hover:underline disabled:opacity-50 disabled:no-underline"
              disabled={unread === 0}
              onClick={() => markSeen(notes.map((n) => n.id))}
              data-testid="notifications-mark-read"
            >
              Mark all as read
            </button>
          </div>
          <ul className="max-h-96 overflow-y-auto py-1">
            {!loaded && <li className="px-4 py-6 text-sm text-on-surface-variant">Loading…</li>}
            {loaded && notes.length === 0 && (
              <li className="px-4 py-6 text-sm text-on-surface-variant text-center">
                You are all caught up.
              </li>
            )}
            {notes.map((n) => {
              const isNew = !seen.has(n.id);
              return (
                <li key={n.id}>
                  <Link
                    to={n.to}
                    onClick={() => {
                      markSeen([n.id]);
                      setOpen(false);
                    }}
                    className="flex gap-3 px-4 py-2.5 hover:bg-surface-container transition-colors"
                  >
                    <Icon name={n.icon} className="text-[18px] text-on-surface-variant mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${isNew ? "font-semibold" : ""}`}>
                        {n.title}
                      </span>
                      <span className="block text-xs text-on-surface-variant truncate">
                        {n.detail}
                      </span>
                      <span className="block text-[11px] text-on-surface-variant mt-0.5">
                        {ago(n.at)}
                      </span>
                    </span>
                    {isNew && <span className="h-2 w-2 rounded-full bg-error mt-1.5 shrink-0" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
