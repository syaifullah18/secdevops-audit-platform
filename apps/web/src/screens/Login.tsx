import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { authApi, type AuthConfig } from "../api/auth.js";
import { IS_MOCK } from "../api/mode.js";
import { AuthShell } from "../components/AuthShell.js";
import { Field, FormError, errMsg } from "../components/Field.js";
import { Icon } from "../components/Icon.js";
import { OrDivider, ProviderButtons } from "../components/ProviderButtons.js";
import { btn } from "../components/stitch.js";
import { useApp } from "../context/AppContext.js";

/** Sign-in: Google or GitHub first, then email and password; demo mode under the mock API. */
export function LoginScreen() {
  const { user, signInDemo, startSession } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
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
      {cfg && <ProviderButtons providers={cfg.providers} verb="Continue" />}
      {cfg && cfg.providers.length > 0 && showPassword && <OrDivider />}
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

      {IS_MOCK && (
        <div className="flex flex-col gap-2">
          {(showPassword || (cfg?.providers.length ?? 0) > 0) && <OrDivider label="or" />}
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

      {cfg && !showPassword && cfg.providers.length === 0 && !IS_MOCK && (
        <p className="text-sm text-on-surface-variant" data-testid="no-sign-in">
          No sign-in method is enabled on this instance. An administrator can turn on accounts with
          AUTH_NATIVE=true.
        </p>
      )}
    </AuthShell>
  );
}
