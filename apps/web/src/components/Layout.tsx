import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useApp } from "../context/AppContext.js";

export function Layout() {
  const { theme, toggleTheme, showRejected, toggleShowRejected } = useApp();
  const location = useLocation();

  const getPageTitle = (path: string) => {
    if (path === "/" || path === "/overview") return "Organization Overview";
    if (path.startsWith("/projects/")) return "Project Details";
    if (path.startsWith("/runs/")) return "Run Timeline & Diagnostics";
    if (path.startsWith("/findings/")) return "Finding Inspection & Triage";
    if (path === "/review-queue") return "Security Review Queue";
    if (path === "/policy") return "Policy & Exception Controls";
    if (path === "/release-readiness") return "Release Readiness & Gate Status";
    if (path === "/export") return "Compliance Audit Export";
    return "SecDevOps Audit Platform";
  };

  return (
    <div className="app-layout">
      {/* Sidebar Navigation */}
      <aside className="sidebar" aria-label="Main Navigation">
        <div className="sidebar-header">
          <div className="sidebar-title">
            <span role="img" aria-label="Shield">
              🛡️
            </span>
            <span>SecDevOps Audit</span>
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "4px" }}>
            v0.1.0 · Autonomous Audit Platform
          </div>
        </div>

        <nav className="sidebar-nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            data-testid="nav-overview"
          >
            📊 Org Overview
          </NavLink>
          <NavLink
            to="/projects/10000000-0000-4000-8000-000000000001"
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            data-testid="nav-projects"
          >
            📁 Projects
          </NavLink>
          <NavLink
            to="/review-queue"
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            data-testid="nav-review-queue"
          >
            🔍 Review Queue
          </NavLink>
          <NavLink
            to="/release-readiness"
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            data-testid="nav-release-readiness"
          >
            🚦 Release Readiness
          </NavLink>
          <NavLink
            to="/policy"
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            data-testid="nav-policy"
          >
            📜 Policy & Exceptions
          </NavLink>
          <NavLink
            to="/export"
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            data-testid="nav-export"
          >
            📥 Audit Export
          </NavLink>
        </nav>

        <div className="sidebar-footer">
          <button
            type="button"
            onClick={toggleTheme}
            className="theme-toggle-btn"
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            data-testid="theme-toggle-button"
          >
            {theme === "light" ? "🌙 Dark Mode" : "☀️ Light Mode"}
          </button>
        </div>
      </aside>

      {/* Main Area */}
      <div className="main-area">
        <header className="top-bar">
          <h1 className="top-bar-title" data-testid="page-title">
            {getPageTitle(location.pathname)}
          </h1>

          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "0.85rem",
                color: "var(--text)",
                cursor: "pointer",
                userSelect: "none",
              }}
              title="Show or hide findings marked as rejected by verification"
            >
              <input
                type="checkbox"
                checked={showRejected}
                onChange={toggleShowRejected}
                data-testid="toggle-show-rejected"
              />
              <span>Show rejected findings</span>
            </label>
          </div>
        </header>

        <main className="page-content" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
