import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { Project } from "@sdap/core";
import { Icon } from "./Icon.js";
import { cx } from "./stitch.js";

/** Sidebar workspace control: jump to the overview or to one repository. */
export function WorkspaceSwitcher({
  name,
  projects,
}: {
  name: string;
  projects: Project[] | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);

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

  const count = projects?.length ?? null;
  const item =
    "flex items-center gap-2.5 px-3 py-2 text-xs rounded-md hover:bg-surface-container transition-colors";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Switch workspace"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="workspace-switcher"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-surface-container-low border border-outline-variant/50 rounded-lg text-left hover:bg-surface-container transition-colors"
      >
        <span className="flex items-center gap-2.5 overflow-hidden">
          <Icon name="domain" className="text-on-surface-variant text-lg" />
          <span className="truncate">
            <span className="block text-xs font-semibold text-on-surface truncate">{name}</span>
            <span className="block text-[11px] text-on-surface-variant">
              {count === null
                ? "Loading repositories…"
                : `${count} ${count === 1 ? "Repository" : "Repositories"} Active`}
            </span>
          </span>
        </span>
        <Icon name="unfold_more" className="text-on-surface-variant text-base" />
      </button>

      {open && (
        <div
          role="menu"
          data-testid="workspace-menu"
          className="absolute left-0 right-0 top-full mt-1 z-50 max-h-72 overflow-auto rounded-lg border border-outline-variant bg-surface-container-lowest shadow-lg p-1"
        >
          <Link to="/projects" role="menuitem" className={cx(item, "font-semibold")}>
            <Icon name="dashboard" className="text-base text-on-surface-variant" />
            All repositories
          </Link>
          {(projects ?? []).map((p) => (
            <Link
              key={p.id}
              to={`/projects/${p.id}`}
              role="menuitem"
              data-testid={`workspace-project-${p.slug}`}
              className={item}
            >
              <Icon name="folder" className="text-base text-on-surface-variant" />
              <span className="truncate">{p.name}</span>
            </Link>
          ))}
          {projects?.length === 0 && (
            <div className="px-3 py-2 text-xs text-on-surface-variant">No repositories yet.</div>
          )}
        </div>
      )}
    </div>
  );
}
