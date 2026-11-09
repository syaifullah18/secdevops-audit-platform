import { useCallback, useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { api } from "../api/client.js";
import { useApp } from "../context/AppContext.js";
import { CommandPaletteModal } from "./CommandPaletteModal.js";
import { Icon } from "./Icon.js";
import { ThemeToggle } from "./ui/ThemeToggle.js";
import { UserMenu } from "./UserMenu.js";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher.js";
import type { Project } from "@sdap/core";

const WORKSPACE = "Audit Workspace";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  testId: string;
  /** Match only the exact path (the overview), not its descendants. */
  end?: boolean;
  /** Extra path prefixes that keep this item highlighted (a run or finding belongs to a parent). */
  also?: string[];
  badge?: number;
}

export function pageTitleFor(path: string): string {
  if (path === "/" || path === "/overview") return "Organization Overview";
  if (path === "/projects") return "Projects";
  if (path === "/account" || path === "/profile") return "Account";
  if (path === "/admin") return "Administration";
  if (path.startsWith("/projects/")) return "Project Details";
  if (path.startsWith("/runs/")) return "Run Timeline & Diagnostics";
  if (path.startsWith("/findings/")) return "Finding Inspection & Triage";
  if (path === "/review-queue") return "Security Review Queue";
  if (path === "/policy") return "Policy & Exception Controls";
  if (path === "/release-readiness") return "Release Readiness & Gate Status";
  if (path === "/export") return "Compliance Audit Export";
  if (path === "/styleguide") return "Design System";
  return "SecDevOps Audit Platform";
}

const navLinkClass = (active: boolean): string =>
  [
    "flex items-center justify-between gap-3 px-3 py-2 rounded-lg transition-all duration-150",
    active
      ? "bg-surface-container-high text-on-surface font-semibold"
      : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container",
  ].join(" ");

export function Layout() {
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [queueCount, setQueueCount] = useState<number | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);

  // The badge is informational; a failed fetch just hides it.
  useEffect(() => {
    let mounted = true;
    api
      .getReviewQueue()
      .then((q) => {
        if (mounted) setQueueCount(q.length);
      })
      .catch(() => undefined);
    api
      .getProjects()
      .then((ps) => {
        if (mounted) setProjects(ps);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [location.pathname]);

  // ⌘K / Ctrl+K toggles the command palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const closePalette = useCallback(() => setPaletteOpen(false), []);

  const { user } = useApp();
  const nav: NavItem[] = [
    { to: "/", label: "Org Overview", icon: "dashboard", testId: "nav-overview", end: true },
    {
      to: "/projects",
      label: "Projects",
      icon: "folder",
      testId: "nav-projects",
      also: ["/projects/", "/runs/"],
    },
    {
      to: "/review-queue",
      label: "Review Queue",
      icon: "pending_actions",
      testId: "nav-review-queue",
      also: ["/findings/"],
      badge: queueCount ?? undefined,
    },
    {
      to: "/release-readiness",
      label: "Release Readiness",
      icon: "traffic",
      testId: "nav-release-readiness",
    },
    { to: "/policy", label: "Policy & Exceptions", icon: "policy", testId: "nav-policy" },
    { to: "/export", label: "Audit Export", icon: "download", testId: "nav-export" },
    ...(user?.roles.includes("admin")
      ? [
          {
            to: "/admin",
            label: "Administration",
            icon: "admin_panel_settings",
            testId: "nav-admin",
          },
        ]
      : []),
  ];

  const isActive = (item: NavItem): boolean => {
    if (item.end) return location.pathname === item.to || location.pathname === "/overview";
    if (location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)) return true;
    return (item.also ?? []).some((p) => location.pathname.startsWith(p));
  };

  return (
    <div className="sdap-shell min-h-screen flex">
      {/* Fixed docked sidebar */}
      <aside
        aria-label="Main Navigation"
        className="print:hidden fixed top-0 left-0 h-screen w-64 z-40 flex flex-col justify-between p-4 bg-surface-container-lowest border-r border-outline-variant"
      >
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3 px-1 pt-1">
            <div className="h-9 w-9 rounded-lg bg-zinc-900 text-white flex items-center justify-center shadow-sm">
              <Icon name="security" filled className="text-lg" />
            </div>
            <div className="flex flex-col">
              <span className="font-headline text-base font-bold text-on-surface tracking-tight leading-tight">
                SecDevOps Audit
              </span>
              <span className="text-xs text-on-surface-variant font-medium">Open Source</span>
            </div>
          </div>

          <WorkspaceSwitcher name={WORKSPACE} projects={projects} />

          <nav className="flex flex-col gap-1 text-sm font-medium" aria-label="Primary">
            {nav.map((item) => {
              const active = isActive(item);
              return (
                <Link
                  key={item.testId}
                  to={item.to}
                  data-testid={item.testId}
                  aria-current={active ? "page" : undefined}
                  className={navLinkClass(active)}
                >
                  <span className="flex items-center gap-3">
                    <Icon name={item.icon} filled={active} className="text-[19px]" />
                    <span>{item.label}</span>
                  </span>
                  {item.badge !== undefined && (
                    <span
                      data-testid="nav-review-queue-count"
                      className="bg-surface-container-high text-on-surface-variant text-[11px] font-semibold px-2 py-0.5 rounded-full"
                    >
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex flex-col gap-3 pt-3 border-t border-outline-variant/40">
          <Link
            to="/export"
            className="w-full bg-on-surface text-surface-container-lowest hover:opacity-90 font-medium text-xs py-2 px-3 rounded-lg shadow-sm flex items-center justify-center gap-2 transition-all"
            data-testid="generate-report-button"
          >
            <Icon name="auto_awesome" className="text-sm" />
            <span>Generate Report</span>
          </Link>

          <div className="flex flex-col gap-0.5 text-xs text-on-surface-variant font-medium">
            <a
              href="#docs"
              onClick={(e) => e.preventDefault()}
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-surface-container transition-colors"
            >
              <Icon name="menu_book" className="text-base" />
              <span>Documentation</span>
            </a>
            <a
              href="#support"
              onClick={(e) => e.preventDefault()}
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-surface-container transition-colors"
            >
              <Icon name="headset_mic" className="text-base" />
              <span>Support</span>
            </a>
          </div>

          <div className="pt-2 border-t border-outline-variant/40 flex flex-col gap-3 px-1">
            <ThemeToggle testId="theme-toggle-button" />
          </div>
        </div>
      </aside>

      {/* Canvas, offset by the sidebar */}
      <div className="flex-1 ml-64 print:ml-0 flex flex-col min-h-screen min-w-0">
        <header className="print:hidden sticky top-0 z-30 w-full px-6 py-2.5 bg-surface-container-lowest/90 backdrop-blur-md border-b border-outline-variant/50 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6 min-w-0">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              data-testid="open-command-palette"
              aria-label="Open command palette"
              className="relative w-80 shrink-0 text-left bg-surface-container-lowest border border-outline-variant/60 rounded-md pl-9 pr-14 py-1.5 text-xs text-on-surface-variant hover:border-outline transition-colors"
            >
              <Icon
                name="search"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant"
              />
              <span>Search findings, CVEs, services...</span>
              <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-mono font-medium text-on-surface-variant bg-surface-container-high border border-outline-variant/70 rounded">
                ⌘K
              </kbd>
            </button>

            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs min-w-0">
              <span className="hidden xl:inline font-medium text-on-surface-variant">
                {WORKSPACE}
              </span>
              <span className="hidden xl:inline text-outline-variant">/</span>
              <h1 className="font-semibold text-on-surface truncate" data-testid="page-title">
                {pageTitleFor(location.pathname)}
              </h1>
            </nav>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              aria-label="Notifications (1 unread)"
              className="relative h-8 w-8 rounded-lg border border-outline-variant/60 flex items-center justify-center text-on-surface-variant hover:bg-surface-container transition-colors"
            >
              <Icon name="notifications" className="text-[18px]" />
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-error" />
            </button>

            <UserMenu />
          </div>
        </header>

        <main id="main-content" className="flex-grow max-w-7xl w-full mx-auto px-6 py-8 space-y-8">
          <Outlet />
        </main>
      </div>

      <CommandPaletteModal open={paletteOpen} onClose={closePalette} />
    </div>
  );
}
