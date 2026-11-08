import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { IS_MOCK } from "../api/mode.js";
import { Icon } from "../components/Icon.js";
import { ThemeToggle } from "../components/ui/ThemeToggle.js";
import { btn } from "../components/stitch.js";
import { useApp } from "../context/AppContext.js";

/** Sign-in: a bearer token for a real API, or demo mode when the mock API is active. */
export function LoginScreen() {
  const { user, signIn, signInDemo } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to={from} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const err = signIn(token);
    setError(err);
    if (!err) {
      setToken("");
      navigate(from, { replace: true });
    }
  };

  return (
    <div
      className="sdap-shell min-h-screen flex items-center justify-center p-4"
      data-testid="login-screen"
    >
      <div className="w-full max-w-md flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-zinc-900 text-white flex items-center justify-center shadow-sm">
            <Icon name="security" filled className="text-xl" />
          </div>
          <div>
            <h1 className="text-lg font-bold font-headline tracking-tight leading-tight">
              SecDevOps Audit
            </h1>
            <p className="text-xs text-on-surface-variant">Sign in to continue</p>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="rounded-lg border border-outline-variant/60 bg-surface-container-lowest shadow-sm p-5 flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="access-token" className="text-xs font-medium text-on-surface-variant">
              Access token
            </label>
            <input
              id="access-token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="eyJhbGciOi..."
              data-testid="token-input"
              className="w-full rounded-md border border-outline-variant/60 bg-surface-container-lowest px-3 py-2 text-sm font-mono"
            />
            <p className="text-[11px] text-on-surface-variant">
              Paste an OIDC access token issued for this API. It is kept for this browser tab only
              and sent as a bearer token; the server verifies it on every request.
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-sev-critical-border bg-sev-critical-bg text-sev-critical-ink px-3.5 py-2.5 text-xs"
            >
              <Icon name="error" className="text-[16px]" />
              {error}
            </div>
          )}

          <button
            type="submit"
            className={btn.primary}
            disabled={token.trim() === ""}
            data-testid="sign-in-button"
          >
            <Icon name="login" className="text-[16px]" />
            Sign in
          </button>

          {IS_MOCK && (
            <>
              <div className="flex items-center gap-3 text-[11px] text-on-surface-variant">
                <span className="h-px flex-1 bg-outline-variant/50" />
                or
                <span className="h-px flex-1 bg-outline-variant/50" />
              </div>
              <button
                type="button"
                className={btn.secondary}
                data-testid="demo-sign-in"
                onClick={() => {
                  if (signInDemo()) navigate(from, { replace: true });
                }}
              >
                <Icon name="science" className="text-[16px]" />
                Continue in demo mode
              </button>
              <p className="text-[11px] text-on-surface-variant -mt-2">
                Demo mode uses the built-in mock API with sample data. No real backend is contacted.
              </p>
            </>
          )}
        </form>

        <div className="rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-4 py-3">
          <ThemeToggle testId="login-theme-toggle" />
        </div>
      </div>
    </div>
  );
}
