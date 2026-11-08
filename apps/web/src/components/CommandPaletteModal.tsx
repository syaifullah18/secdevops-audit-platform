import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { useApp } from "../context/AppContext.js";
import { Icon } from "./Icon.js";
import type { Finding } from "@sdap/core";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: string;
  group: "Quick Actions" | "Findings";
  severity?: string | null;
  run: () => void;
}

const sevClass = (s: string | null | undefined): string => {
  switch (s) {
    case "critical":
      return "bg-sev-critical-bg border-sev-critical-border text-sev-critical-ink";
    case "high":
      return "bg-sev-high-bg border-sev-high-border text-sev-high-ink";
    case "medium":
      return "bg-sev-medium-bg border-sev-medium-border text-sev-medium-ink";
    default:
      return "bg-sev-low-bg border-sev-low-border text-sev-low-ink";
  }
};

/** ⌘K command palette: quick actions plus recent findings. Fully keyboard operable. */
export function CommandPaletteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { toggleTheme } = useApp();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [findings, setFindings] = useState<Finding[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
    let mounted = true;
    api
      .getFindings({ limit: 25 })
      .then((p) => mounted && setFindings(p.items))
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => {
      navigate(to);
      onClose();
    };
    const actions: Command[] = [
      {
        id: "audit",
        label: "Run Deterministic Audit",
        hint: "⌘R",
        icon: "play_arrow",
        group: "Quick Actions",
        run: go("/projects/10000000-0000-4000-8000-000000000001"),
      },
      {
        id: "exception",
        label: "Create Security Exception",
        hint: "⌘E",
        icon: "gpp_maybe",
        group: "Quick Actions",
        run: go("/policy"),
      },
      {
        id: "export",
        label: "Export Compliance Report",
        hint: "⌘P",
        icon: "download",
        group: "Quick Actions",
        run: go("/export"),
      },
      {
        id: "theme",
        label: "Toggle Theme",
        hint: "⌘D",
        icon: "contrast",
        group: "Quick Actions",
        run: () => {
          toggleTheme();
          onClose();
        },
      },
    ];
    const recent: Command[] = findings
      .filter((f) => f.verdict === "confirmed" || f.verdict === "needs_validation")
      .slice(0, 6)
      .map((f) => ({
        id: f.id,
        label: f.title,
        icon: "bug_report",
        group: "Findings" as const,
        severity: f.verifiedSeverity ?? f.originalSeverity,
        run: go(`/findings/${f.id}`),
      }));
    return [...actions, ...recent];
  }, [findings, navigate, onClose, toggleTheme]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands;
  }, [commands, query]);

  // Keep the highlighted row valid as the list shrinks.
  useEffect(() => setActive((a) => Math.min(a, Math.max(visible.length - 1, 0))), [visible.length]);

  // ⌘R / ⌘E / ⌘P / ⌘D run their action while the palette is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (visible.length ? (a + 1) % visible.length : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (visible.length ? (a - 1 + visible.length) % visible.length : 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        visible[active]?.run();
      } else if (e.metaKey || e.ctrlKey) {
        const hit = commands.find((c) => c.hint === `⌘${e.key.toUpperCase()}`);
        if (hit) {
          e.preventDefault();
          hit.run();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, visible, active, commands, onClose]);

  if (!open) return null;

  const groups = (["Quick Actions", "Findings"] as const)
    .map((g) => ({ g, items: visible.filter((c) => c.group === g) }))
    .filter((x) => x.items.length > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[14vh] bg-black/40 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      data-testid="command-palette"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-[640px] rounded-xl border border-outline-variant bg-surface-container-lowest shadow-2xl p-5 flex flex-col gap-4"
      >
        <div className="relative flex items-center border-b border-outline-variant pb-3">
          <Icon name="search" className="text-on-surface-variant mr-3 text-xl" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-label="Search commands and findings"
            placeholder="Type a command, search findings, CVEs, or jump to repo..."
            className="w-full bg-transparent border-none outline-none text-on-surface placeholder:text-on-surface-variant text-base font-medium pr-28"
          />
          <span className="absolute right-0 text-[11px] font-mono px-2 py-1 rounded bg-surface-container-high text-on-surface-variant border border-outline-variant">
            ESC to cancel
          </span>
        </div>

        <div
          id="palette-list"
          role="listbox"
          className="flex flex-col gap-3 max-h-[50vh] overflow-y-auto"
        >
          {groups.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-on-surface-variant">No results</p>
          )}
          {groups.map(({ g, items }) => (
            <div key={g} className="space-y-1">
              <div className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider px-1">
                {g === "Findings" ? "Recent Searches & Findings" : g}
              </div>
              {items.map((c) => {
                const idx = visible.indexOf(c);
                const isActive = idx === active;
                return (
                  <div
                    key={c.id}
                    role="option"
                    aria-selected={isActive}
                    onMouseEnter={() => setActive(idx)}
                    onClick={c.run}
                    className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg cursor-pointer text-sm font-medium transition-colors ${
                      isActive ? "bg-surface-container-high text-on-surface" : "text-on-surface"
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Icon name={c.icon} className="text-base text-on-surface-variant" />
                      <span className="truncate">{c.label}</span>
                    </span>
                    {c.hint && (
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant border border-outline-variant">
                        {c.hint}
                      </span>
                    )}
                    {c.severity && (
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border capitalize ${sevClass(c.severity)}`}
                      >
                        {c.severity}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-4 pt-3 border-t border-outline-variant text-[11px] text-on-surface-variant">
          <span>
            <kbd className="font-mono">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="font-mono">↵</kbd> select
          </span>
          <span>
            <kbd className="font-mono">esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
