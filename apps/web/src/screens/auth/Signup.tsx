import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { authApi, type AuthConfig } from "../../api/auth.js";
import { AuthShell } from "../../components/AuthShell.js";
import { Field, FormError, Notice, errMsg } from "../../components/Field.js";
import { OrDivider, ProviderButtons } from "../../components/ProviderButtons.js";
import { btn } from "../../components/stitch.js";
import { useApp } from "../../context/AppContext.js";

export function SignupScreen() {
  const { user, startSession } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const invite = params.get("invite") ?? undefined;
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    authApi
      .config()
      .then(setCfg)
      .catch(() => setError("This instance does not accept sign-ups."));
  }, []);
  useEffect(() => {
    if (!invite) return;
    authApi
      .invitePreview(invite)
      .then((p) => setEmail(p.email))
      .catch((e) => setError(errMsg(e)));
  }, [invite]);

  if (user) return <Navigate to="/" replace />;

  const closed = cfg !== null && !invite && cfg.signupMode !== "open";
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setError("The two passwords do not match.");
    setBusy(true);
    try {
      const res = await authApi.signup({
        email,
        name,
        password,
        ...(invite ? { inviteToken: invite } : {}),
      });
      if (res.session) {
        startSession(res.session);
        navigate("/", { replace: true });
      } else setSent(true);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      testId="signup-screen"
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-on-surface hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {sent ? (
        <Notice>
          Check your inbox. We sent a link to <strong>{email}</strong> to confirm your address.
        </Notice>
      ) : closed ? (
        <Notice tone="info">
          {cfg?.signupMode === "invite"
            ? "Sign-up is by invitation only. Ask an administrator for an invitation link."
            : "Sign-up is closed on this instance."}
        </Notice>
      ) : (
        <div className="flex flex-col gap-4">
          {cfg && !invite && <ProviderButtons providers={cfg.providers} verb="Sign up" />}
          {cfg && !invite && cfg.providers.length > 0 && <OrDivider />}
          <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Create an account">
            <Field
              id="name"
              label="Name"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="name-input"
            />
            <Field
              id="email"
              label="Email"
              type="email"
              autoComplete="email"
              required
              readOnly={Boolean(invite)}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="email-input"
            />
            <Field
              id="password"
              label="Password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              hint="At least 10 characters."
              data-testid="password-input"
            />
            <Field
              id="confirm"
              label="Confirm password"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              data-testid="confirm-input"
            />
            <FormError message={error} />
            <button
              type="submit"
              className={btn.primary}
              disabled={busy}
              data-testid="sign-up-button"
            >
              {busy ? "Creating…" : "Create account"}
            </button>
          </form>
        </div>
      )}
      {!sent && closed && <FormError message={error} />}
    </AuthShell>
  );
}
