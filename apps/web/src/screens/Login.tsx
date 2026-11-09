import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { authApi, providerStartUrl, type AuthConfig } from "../api/auth.js";
import { IS_MOCK } from "../api/mode.js";
import { AuthShell } from "../components/AuthShell.js";
import { Field, FormError, errMsg, inputCls } from "../components/Field.js";
import { Icon } from "../components/Icon.js";
import { btn } from "../components/stitch.js";
import { useApp } from "../context/AppContext.js";

const PROVIDER_LABEL: Record<string, string> = { google: "Google", github: "GitHub" };

/** Sign-in: email and password, a provider, a pasted OIDC token, or demo mode under the mock API. */
export function LoginScreen() {
  const { user, signIn, signInDemo, startSession } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setTokenText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    authApi
      .config()
      .then((c) => live && setCfg(c))
      // An API without native accounts has no /auth/config: only OIDC tokens work there.
      .catch(
        () =>
          live &&
          setCfg({
            native: false,
            passwordLogin: false,
            signupMode: "closed",
            requireEmailVerification: false,
            providers: [],
          }),
      );
    return () => {
      live = false;
    };
  }, []);

  if (user) return <Navigate to={from} replace />;

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      startSession(await authApi.login({ email, password }));
      navigate(from, { replace: true });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const submitToken = (e: FormEvent) => {
    e.preventDefault();
    const err = signIn(token);
    setTokenError(err);
    if (!err) navigate(from, { replace: true });
  };

  const showPassword = cfg?.native && cfg.passwordLogin;
  return (
    <AuthShell
      title="Sign in"
      testId="login-screen"
      footer={
        cfg?.native && cfg.signupMode !== "closed" ? (
          <>
            New here?{" "}
            <Link
              to="/signup"
              className="font-semibold text-on-surface hover:underline"
              data-testid="to-signup"
            >
              Create an account
            </Link>
          </>
        ) : undefined
      }
    >
      {showPassword && (
        <form
          onSubmit={submitPassword}
          className="flex flex-col gap-4"
          aria-label="Sign in with email"
        >
          <Field
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="email-input"
          />
          <Field
            id="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="password-input"
          />
          <FormError message={error} />
          <button
            type="submit"
            className={btn.primary}
            disabled={busy || !email || !password}
            data-testid="sign-in-button"
          >
            <Icon name="login" className="text-[16px]" />
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <Link
            to="/forgot"
            className="text-xs text-on-surface-variant hover:underline self-center"
            data-testid="to-forgot"
          >
            Forgot your password?
          </Link>
        </form>
      )}

      {cfg && cfg.providers.length > 0 && (
        <div className="flex flex-col gap-2">
          {showPassword && <Divider />}
          {cfg.providers.map((p) => (
            <a
              key={p}
              href={providerStartUrl(p)}
              className={btn.secondary}
              data-testid={`provider-${p}`}
            >
              Continue with {PROVIDER_LABEL[p] ?? p}
            </a>
          ))}
        </div>
      )}

      {IS_MOCK && (
        <div className="flex flex-col gap-2">
          {(showPassword || (cfg?.providers.length ?? 0) > 0) && <Divider />}
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
          <p className="text-[11px] text-on-surface-variant">
            Demo mode uses sample data and no server. Or sign in as demo.user@example.test with the
            password demo-password-123.
          </p>
        </div>
      )}

      <details className="group" open={cfg !== null && !cfg.native}>
        <summary className="text-xs text-on-surface-variant cursor-pointer select-none">
          Use an OIDC access token
        </summary>
        <form onSubmit={submitToken} className="flex flex-col gap-2 mt-3">
          <label htmlFor="access-token" className="text-xs font-medium text-on-surface-variant">
            Access token
          </label>
          <input
            id="access-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            className={`${inputCls} font-mono`}
            placeholder="eyJhbGciOi..."
            value={token}
            onChange={(e) => setTokenText(e.target.value)}
            data-testid="token-input"
          />
          <p className="text-[11px] text-on-surface-variant">
            For instances that sign in through your own identity provider. The token is kept in this
            browser and sent as a bearer token; the server verifies it on every request.
          </p>
          <FormError message={tokenError} />
          <button
            type="submit"
            className={btn.secondary}
            disabled={token.trim() === ""}
            data-testid="token-sign-in-button"
          >
            Sign in with token
          </button>
        </form>
      </details>
    </AuthShell>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-3 text-[11px] text-on-surface-variant">
      <span className="h-px flex-1 bg-outline-variant/50" />
      or
      <span className="h-px flex-1 bg-outline-variant/50" />
    </div>
  );
}
