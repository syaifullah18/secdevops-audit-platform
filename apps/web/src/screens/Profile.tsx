import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { Role } from "@sdap/core";
import { accountApi, type Account, type ApiTokenInfo, type SessionInfo } from "../api/auth.js";
import { ALL_ROLES, ROLE_HELP } from "../auth/roles.js";
import { topRole } from "../auth/session.js";
import { Field, FormError, Notice, errMsg, inputCls } from "../components/Field.js";
import { Icon } from "../components/Icon.js";
import { Loading, PageHeader, Panel, Pill, btn, tableCls } from "../components/stitch.js";
import { ThemeToggle } from "../components/ui/ThemeToggle.js";
import { useApp } from "../context/AppContext.js";

const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : "Never");

/** The signed-in person's account: profile, password, sessions, API tokens and their data. */
export function ProfileScreen() {
  const { user, signOut, updateUser } = useApp();
  const navigate = useNavigate();
  const [account, setAccount] = useState<Account | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const managed = Boolean(user?.native || user?.demo);

  const reload = useCallback(() => {
    accountApi
      .me()
      .then(setAccount)
      .catch((e) => setLoadError(errMsg(e)));
  }, []);
  useEffect(() => {
    if (managed) reload();
  }, [managed, reload]);

  if (!user) return null;

  const leave = () => {
    signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex flex-col gap-6" data-testid="profile-screen">
      <PageHeader
        title="Account"
        subtitle="Your identity, access and security settings."
        actions={
          <button
            type="button"
            className={btn.secondary}
            onClick={leave}
            data-testid="profile-sign-out"
          >
            <Icon name="logout" className="text-[16px]" />
            Sign out
          </button>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-6">
          <Panel title="Identity" testId="identity-card">
            <div className="flex items-center gap-4 mb-4">
              <div className="h-14 w-14 rounded-full bg-surface-container-high border border-outline-variant/60 flex items-center justify-center text-lg font-semibold">
                {user.initials}
              </div>
              <div className="min-w-0">
                <div className="text-base font-semibold truncate">{user.name}</div>
                <div className="text-xs text-on-surface-variant truncate">
                  {user.email ?? user.subject}
                </div>
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  {user.demo && (
                    <Pill tone="advisory" icon="science">
                      Demo mode: sample data, no real backend
                    </Pill>
                  )}
                  {account && !account.emailVerified && (
                    <Pill tone="medium">Email not confirmed</Pill>
                  )}
                </div>
              </div>
            </div>
            <dl>
              <Row label="Primary role">{topRole(user.roles) ?? "None granted"}</Row>
              <Row label="Team">{user.team ?? "Not set"}</Row>
              <Row label="Client access">
                {user.clientIds === "*" ? (
                  "All clients"
                ) : user.clientIds.length === 0 ? (
                  <span className="text-sev-critical-ink">
                    None: no client data is visible. Ask an administrator.
                  </span>
                ) : (
                  <span className="flex flex-wrap justify-end gap-1.5">
                    {user.clientIds.map((c) => (
                      <Pill key={c}>{c}</Pill>
                    ))}
                  </span>
                )}
              </Row>
              <Row label="Session ends">
                {user.expiresAt === null
                  ? "No expiry in token"
                  : new Date(user.expiresAt).toLocaleString()}
              </Row>
            </dl>
            {!managed && (
              <div className="mt-4">
                <Notice tone="info">
                  You signed in with an access token from your identity provider. Manage your name,
                  password and sessions there.
                </Notice>
              </div>
            )}
          </Panel>

          {managed && loadError && <FormError message={loadError} />}
          {managed && !account && !loadError && <Loading>Loading your account…</Loading>}
          {managed && account && (
            <>
              <ProfileForm
                account={account}
                onSaved={(a) => {
                  updateUser(a);
                  reload();
                }}
              />
              <PasswordForm account={account} onChanged={reload} />
              <LinkedAccounts account={account} onChanged={reload} />
              <Sessions />
              <Tokens roles={user.roles} />
              <DataAndDeletion account={account} onDeleted={leave} />
            </>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <Panel title="Roles">
            {user.roles.length === 0 ? (
              <p className="text-sm text-on-surface-variant">
                No recognised roles on this account.
              </p>
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
            <p className="text-[11px] text-on-surface-variant mt-3">
              An administrator sets roles and client access. The server enforces them on every
              request.
            </p>
          </Panel>
          <Panel title="Preferences">
            <ThemeToggle testId="profile-theme-toggle" />
          </Panel>
        </div>
      </div>
    </div>
  );
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex flex-wrap items-start justify-between gap-2 py-2.5 border-b border-outline-variant/30 last:border-0 text-sm">
    <dt className="text-on-surface-variant">{label}</dt>
    <dd className="text-right font-medium min-w-0 break-all">{children}</dd>
  </div>
);

function ProfileForm({ account, onSaved }: { account: Account; onSaved: (a: Account) => void }) {
  const [name, setName] = useState(account.name);
  const [state, setState] = useState<{ ok?: boolean; error?: string }>({});
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const a = await accountApi.rename(name);
      setState({ ok: true });
      onSaved({ ...account, ...a });
    } catch (err) {
      setState({ error: errMsg(err) });
    }
  };
  return (
    <Panel title="Profile" testId="profile-form-card">
      <form onSubmit={save} className="flex flex-col gap-4 max-w-md" aria-label="Edit profile">
        <Field id="acc-email" label="Email" value={account.email} disabled readOnly />
        <Field
          id="acc-name"
          label="Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="account-name-input"
        />
        <FormError message={state.error ?? null} />
        {state.ok && <Notice>Saved.</Notice>}
        <button
          type="submit"
          className={`${btn.primary} self-start`}
          data-testid="save-profile-button"
        >
          Save
        </button>
      </form>
    </Panel>
  );
}

function PasswordForm({ account, onChanged }: { account: Account; onChanged: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<{ ok?: boolean; error?: string }>({});
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setState({ error: "The two passwords do not match." });
    try {
      await accountApi.changePassword({
        ...(account.hasPassword ? { currentPassword: current } : {}),
        newPassword: next,
      });
      setCurrent("");
      setNext("");
      setConfirm("");
      setState({ ok: true });
      onChanged();
    } catch (err) {
      setState({ error: errMsg(err) });
    }
  };
  return (
    <Panel
      title={account.hasPassword ? "Change password" : "Set a password"}
      subtitle="Changing it signs out your other sessions."
      testId="password-card"
    >
      <form onSubmit={submit} className="flex flex-col gap-4 max-w-md" aria-label="Change password">
        {account.hasPassword && (
          <Field
            id="cur"
            label="Current password"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            data-testid="current-password-input"
          />
        )}
        <Field
          id="new"
          label="New password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
          value={next}
          onChange={(e) => setNext(e.target.value)}
          hint="At least 10 characters."
          data-testid="new-password-input"
        />
        <Field
          id="conf"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <FormError message={state.error ?? null} />
        {state.ok && <Notice>Password changed.</Notice>}
        <button
          type="submit"
          className={`${btn.primary} self-start`}
          data-testid="change-password-button"
        >
          {account.hasPassword ? "Change password" : "Set password"}
        </button>
      </form>
    </Panel>
  );
}

function LinkedAccounts({ account, onChanged }: { account: Account; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  if (account.identities.length === 0) return null;
  return (
    <Panel title="Linked accounts" testId="identities-card">
      <ul className="flex flex-col gap-2">
        {account.identities.map((i) => (
          <li key={i.provider} className="flex items-center justify-between gap-3 text-sm">
            <span>
              <strong className="capitalize">{i.provider}</strong>{" "}
              <span className="text-on-surface-variant">{i.email}</span>
            </span>
            <button
              type="button"
              className={btn.secondary}
              onClick={async () => {
                try {
                  await accountApi.unlink(i.provider);
                  onChanged();
                } catch (e) {
                  setError(errMsg(e));
                }
              }}
            >
              Unlink
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3">
        <FormError message={error} />
      </div>
    </Panel>
  );
}

function Sessions() {
  const [rows, setRows] = useState<SessionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    accountApi
      .sessions()
      .then(setRows)
      .catch((e) => setError(errMsg(e)));
  }, []);
  useEffect(load, [load]);
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      load();
    } catch (e) {
      setError(errMsg(e));
    }
  };
  return (
    <Panel
      title="Active sessions"
      testId="sessions-card"
      actions={
        <button
          type="button"
          className={btn.secondary}
          onClick={() => act(accountApi.revokeOthers)}
          data-testid="revoke-others-button"
        >
          Sign out other sessions
        </button>
      }
    >
      <FormError message={error} />
      {!rows ? (
        <Loading>Loading sessions…</Loading>
      ) : (
        <div className={tableCls.wrap}>
          <table className={tableCls.table}>
            <thead>
              <tr className={tableCls.headRow}>
                {["Started", "Last used", "From", ""].map((h) => (
                  <th key={h} className={tableCls.th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className={tableCls.row}>
                  <td className={tableCls.td}>{when(s.createdAt)}</td>
                  <td className={tableCls.td}>{when(s.lastUsedAt)}</td>
                  <td className={tableCls.td}>{s.ip ?? "unknown"}</td>
                  <td className={`${tableCls.td} text-right`}>
                    {s.current ? (
                      <Pill tone="verified">This session</Pill>
                    ) : (
                      <button
                        type="button"
                        className={btn.secondary}
                        onClick={() => act(() => accountApi.revokeSession(s.id))}
                      >
                        Sign out
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Tokens({ roles }: { roles: Role[] }) {
  const [rows, setRows] = useState<ApiTokenInfo[] | null>(null);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Role[]>([]);
  const [days, setDays] = useState("90");
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    accountApi
      .tokens()
      .then(setRows)
      .catch((e) => setError(errMsg(e)));
  }, []);
  useEffect(load, [load]);
  const allowed = roles.includes("admin") ? ALL_ROLES : roles;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const t = await accountApi.createToken({
        name,
        ...(picked.length ? { roles: picked } : {}),
        ...(days ? { expiresInDays: Number(days) } : {}),
      });
      setCreated(t.token);
      setName("");
      setPicked([]);
      load();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  return (
    <Panel
      title="API tokens"
      subtitle="For scripts, the CLI and CI. A token can never do more than you can."
      testId="tokens-card"
    >
      {created && (
        <div className="mb-4" data-testid="new-token">
          <Notice>
            Copy this token now; it is shown only once.
            <code className="block mt-2 break-all font-mono text-[11px] select-all">{created}</code>
            <button
              type="button"
              className={`${btn.secondary} mt-2`}
              onClick={() => void navigator.clipboard?.writeText(created)}
            >
              Copy
            </button>
          </Notice>
        </div>
      )}
      <form
        onSubmit={create}
        className="flex flex-col gap-3 max-w-md mb-5"
        aria-label="Create an API token"
      >
        <Field
          id="tok-name"
          label="Name"
          placeholder="ci-pipeline"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="token-name-input"
        />
        <fieldset className="flex flex-wrap gap-3 text-xs">
          <legend className="text-xs font-medium text-on-surface-variant mb-1">
            Limit to roles (none ticked = all of yours)
          </legend>
          {allowed.map((r) => (
            <label key={r} className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={picked.includes(r)}
                onChange={(e) =>
                  setPicked(e.target.checked ? [...picked, r] : picked.filter((x) => x !== r))
                }
              />
              {r}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tok-days" className="text-xs font-medium text-on-surface-variant">
            Expires
          </label>
          <select
            id="tok-days"
            className={inputCls}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          >
            <option value="30">in 30 days</option>
            <option value="90">in 90 days</option>
            <option value="365">in 1 year</option>
          </select>
        </div>
        <FormError message={error} />
        <button
          type="submit"
          className={`${btn.primary} self-start`}
          data-testid="create-token-button"
        >
          Create token
        </button>
      </form>
      {rows && rows.length > 0 && (
        <div className={tableCls.wrap}>
          <table className={tableCls.table}>
            <thead>
              <tr className={tableCls.headRow}>
                {["Name", "Token", "Roles", "Last used", "Expires", ""].map((h) => (
                  <th key={h} className={tableCls.th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className={tableCls.row}>
                  <td className={tableCls.td}>{t.name}</td>
                  <td className={`${tableCls.td} font-mono`}>{t.prefix}…</td>
                  <td className={tableCls.td}>{t.roles?.join(", ") ?? "all"}</td>
                  <td className={tableCls.td}>{when(t.lastUsedAt)}</td>
                  <td className={tableCls.td}>{t.expiresAt ? when(t.expiresAt) : "Never"}</td>
                  <td className={`${tableCls.td} text-right`}>
                    <button
                      type="button"
                      className={btn.danger}
                      onClick={async () => {
                        await accountApi.revokeToken(t.id).catch((e) => setError(errMsg(e)));
                        load();
                      }}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function DataAndDeletion({ account, onDeleted }: { account: Account; onDeleted: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    const data = await accountApi.export();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "account-export.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const remove = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await accountApi.remove({ email, ...(account.hasPassword ? { password } : {}) });
      onDeleted();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  return (
    <>
      <Panel title="Your data" testId="export-card">
        <p className="text-xs text-on-surface-variant mb-3">
          Download what this instance stores about your account.
        </p>
        <button
          type="button"
          className={btn.secondary}
          onClick={() => void download()}
          data-testid="export-account-button"
        >
          <Icon name="download" className="text-[16px]" />
          Download as JSON
        </button>
      </Panel>
      <Panel title="Delete account" tone="danger" testId="delete-card">
        <form
          onSubmit={remove}
          className="flex flex-col gap-3 max-w-md"
          aria-label="Delete account"
        >
          <p className="text-xs text-on-surface-variant">
            This removes your account, sessions and tokens. It cannot be undone. Type your email
            address{account.hasPassword ? " and password" : ""} to confirm.
          </p>
          <Field
            id="del-email"
            label="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="delete-email-input"
          />
          {account.hasPassword && (
            <Field
              id="del-pw"
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
          <FormError message={error} />
          <button
            type="submit"
            className={`${btn.danger} self-start`}
            disabled={!email}
            data-testid="delete-account-button"
          >
            Delete my account
          </button>
        </form>
      </Panel>
    </>
  );
}
