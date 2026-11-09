import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { authApi } from "../../api/auth.js";
import { AuthShell } from "../../components/AuthShell.js";
import { Field, FormError, Notice, errMsg } from "../../components/Field.js";
import { Loading, btn } from "../../components/stitch.js";
import { useApp } from "../../context/AppContext.js";

const backToLogin = (
  <Link to="/login" className="font-semibold text-on-surface hover:underline">
    Back to sign in
  </Link>
);

export function ForgotScreen() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await authApi.forgot(email);
      setSent(true);
    } catch (err) {
      setError(errMsg(err));
    }
  };
  return (
    <AuthShell title="Reset your password" testId="forgot-screen" footer={backToLogin}>
      {sent ? (
        <Notice>
          If an account exists for that address, a reset link is on its way. It works for one hour.
        </Notice>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Request a reset link">
          <Field
            id="email"
            label="Email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="email-input"
          />
          <FormError message={error} />
          <button type="submit" className={btn.primary} data-testid="send-reset-button">
            Send reset link
          </button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetScreen() {
  const { token = "" } = useParams();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setError("The two passwords do not match.");
    try {
      await authApi.reset(token, password);
      setDone(true);
    } catch (err) {
      setError(errMsg(err));
    }
  };
  return (
    <AuthShell title="Choose a new password" testId="reset-screen" footer={backToLogin}>
      {done ? (
        <Notice>
          Your password was changed and other sessions were signed out. You can sign in now.
        </Notice>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Choose a new password">
          <Field
            id="password"
            label="New password"
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
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            data-testid="confirm-input"
          />
          <FormError message={error} />
          <button type="submit" className={btn.primary} data-testid="reset-button">
            Change password
          </button>
        </form>
      )}
    </AuthShell>
  );
}

export function VerifyScreen() {
  const { token = "" } = useParams();
  const [state, setState] = useState<"working" | "ok" | string>("working");
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    authApi
      .verify(token)
      .then(() => setState("ok"))
      .catch((e) => setState(errMsg(e)));
  }, [token]);
  return (
    <AuthShell title="Confirm your email" testId="verify-screen" footer={backToLogin}>
      {state === "working" ? (
        <Loading>Confirming…</Loading>
      ) : state === "ok" ? (
        <Notice>Your email address is confirmed. You can sign in now.</Notice>
      ) : (
        <FormError message={state} />
      )}
    </AuthShell>
  );
}

/** Where a provider sends the browser back: exchanges the one-time code for a session. */
export function LoginCallbackScreen() {
  const { startSession } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(params.get("error"));
  const ran = useRef(false);
  useEffect(() => {
    const code = params.get("code");
    // The code works once; React may run this effect twice in development.
    if (ran.current || !code) return;
    ran.current = true;
    authApi
      .exchange(code)
      .then((s) => {
        startSession(s);
        navigate("/", { replace: true });
      })
      .catch((e) => setError(errMsg(e)));
  }, [params, startSession, navigate]);
  return (
    <AuthShell title="Signing you in" testId="callback-screen" footer={backToLogin}>
      {error ? <FormError message={error} /> : <Loading>Finishing sign-in…</Loading>}
    </AuthShell>
  );
}
