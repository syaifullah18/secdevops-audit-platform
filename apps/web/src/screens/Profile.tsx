import { Link, useNavigate } from "react-router-dom";
import { ThemeToggle } from "../components/ui/ThemeToggle.js";
import { Icon } from "../components/Icon.js";
import { PageHeader, Panel, Pill, btn } from "../components/stitch.js";
import { useApp } from "../context/AppContext.js";
import { topRole } from "../auth/session.js";

const ROLE_HELP: Record<string, string> = {
  admin: "Manage platform settings and every client.",
  security: "Triage findings, approve exceptions and edit policy.",
  devops: "Trigger and cancel audit runs.",
  developer: "View and triage findings for the own team.",
  viewer: "Read-only access.",
};

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-wrap items-start justify-between gap-2 py-2.5 border-b border-outline-variant/30 last:border-0 text-sm">
    <dt className="text-on-surface-variant">{label}</dt>
    <dd className="text-right font-medium min-w-0 break-all">{children}</dd>
  </div>
);

/** Who is signed in and what that grants. Identity is managed by the identity provider. */
export function ProfileScreen() {
  const { user, signOut, showRejected, toggleShowRejected } = useApp();
  const navigate = useNavigate();
  if (!user) return null;

  const expires =
    user.expiresAt === null ? "No expiry in token" : new Date(user.expiresAt).toLocaleString();

  return (
    <div className="flex flex-col gap-6" data-testid="profile-screen">
      <PageHeader
        title="Profile & Access"
        subtitle="Your identity and permissions come from the identity provider and cannot be edited here."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Panel className="lg:col-span-2" title="Identity" testId="identity-card">
          <div className="flex items-center gap-4 mb-4">
            <div className="h-14 w-14 rounded-full bg-surface-container-high border border-outline-variant/60 flex items-center justify-center text-lg font-semibold">
              {user.initials}
            </div>
            <div className="min-w-0">
              <div className="text-base font-semibold truncate">{user.name}</div>
              <div className="text-xs text-on-surface-variant truncate">{user.subject}</div>
              {user.demo && (
                <Pill tone="advisory" icon="science" className="mt-1.5">
                  Demo mode: sample data, no real backend
                </Pill>
              )}
            </div>
          </div>
          <dl>
            <Row label="Primary role">{topRole(user.roles) ?? "None granted"}</Row>
            <Row label="Team">{user.team ?? "Not set"}</Row>
            <Row label="Client access">
              {user.clientIds === "*" ? (
                "All clients"
              ) : user.clientIds.length === 0 ? (
                <span className="text-sev-critical-ink">None: no client data is visible</span>
              ) : (
                <span className="flex flex-wrap justify-end gap-1.5">
                  {user.clientIds.map((c) => (
                    <Pill key={c}>{c}</Pill>
                  ))}
                </span>
              )}
            </Row>
            <Row label="Session ends">{expires}</Row>
          </dl>
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel title="Roles">
            {user.roles.length === 0 ? (
              <p className="text-sm text-on-surface-variant">No recognised roles on this token.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {user.roles.map((r) => (
                  <li key={r}>
                    <Pill tone="neutral">{r}</Pill>
                    <p className="text-xs text-on-surface-variant mt-1">{ROLE_HELP[r]}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Preferences">
            <div className="flex flex-col gap-4">
              <ThemeToggle testId="profile-theme-toggle" />
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-on-surface-variant">
                  Show rejected findings
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showRejected}
                  aria-label="Show rejected findings"
                  onClick={toggleShowRejected}
                  className={`relative h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors ${
                    showRejected ? "bg-on-surface" : "bg-surface-container-highest"
                  }`}
                >
                  <span
                    className={`block h-4 w-4 rounded-full bg-surface-container-lowest shadow-sm transition-transform ${
                      showRejected ? "translate-x-4" : ""
                    }`}
                  />
                </button>
              </div>
            </div>
          </Panel>

          <div className="flex gap-2">
            <button
              type="button"
              className={btn.secondary}
              data-testid="profile-sign-out"
              onClick={() => {
                signOut();
                navigate("/login", { replace: true });
              }}
            >
              <Icon name="logout" className="text-[16px]" />
              Sign out
            </button>
            <Link to="/" className={btn.secondary}>
              Back to overview
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
