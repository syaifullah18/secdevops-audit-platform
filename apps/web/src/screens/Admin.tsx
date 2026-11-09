import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Role } from "@sdap/core";
import { adminApi, type AuditEvent, type Invitation } from "../api/auth.js";
import { ALL_ROLES, parseScope, scopeLabel } from "../auth/roles.js";
import type { AccountView } from "../auth/session.js";
import { Field, FormError, Notice, errMsg, inputCls } from "../components/Field.js";
import { Icon } from "../components/Icon.js";
import { Loading, PageHeader, Panel, Pill, btn, cx, tableCls } from "../components/stitch.js";
import { useApp } from "../context/AppContext.js";

type Tab = "users" | "invitations" | "audit";
const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : "Never");

/** Administration: who has access, invitations, and the account audit trail. Admin only. */
export function AdminScreen() {
  const { user } = useApp();
  const [tab, setTab] = useState<Tab>("users");
  if (!user?.roles.includes("admin")) {
    return <FormError message="Administration needs the admin role." />;
  }
  const tabs: Array<[Tab, string]> = [
    ["users", "Users"],
    ["invitations", "Invitations"],
    ["audit", "Audit log"],
  ];
  return (
    <div className="flex flex-col gap-6" data-testid="admin-screen">
      <PageHeader
        title="Administration"
        subtitle="People, access and an audit trail of account events."
      />
      <div
        role="tablist"
        aria-label="Administration"
        className="flex gap-1 border-b border-outline-variant/50"
      >
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            data-testid={`admin-tab-${id}`}
            onClick={() => setTab(id)}
            className={cx(
              "px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors",
              tab === id
                ? "border-on-surface text-on-surface"
                : "border-transparent text-on-surface-variant hover:text-on-surface",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "users" && <Users selfEmail={user.email ?? user.subject} />}
      {tab === "invitations" && <Invitations />}
      {tab === "audit" && <Audit />}
    </div>
  );
}

function RolePicker({ value, onChange }: { value: Role[]; onChange: (r: Role[]) => void }) {
  return (
    <fieldset className="flex flex-wrap gap-3 text-xs">
      <legend className="sr-only">Roles</legend>
      {ALL_ROLES.map((r) => (
        <label key={r} className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={value.includes(r)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))
            }
          />
          {r}
        </label>
      ))}
    </fieldset>
  );
}

function Users({ selfEmail }: { selfEmail: string }) {
  const [rows, setRows] = useState<AccountView[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    adminApi
      .users()
      .then(setRows)
      .catch((e) => setError(errMsg(e)));
  }, []);
  useEffect(load, [load]);
  if (!rows) return error ? <FormError message={error} /> : <Loading>Loading users…</Loading>;
  return (
    <Panel title={`${rows.length} ${rows.length === 1 ? "user" : "users"}`} testId="users-card">
      <FormError message={error} />
      <div className={tableCls.wrap}>
        <table className={tableCls.table}>
          <thead>
            <tr className={tableCls.headRow}>
              {["Name", "Roles", "Clients", "Team", "Last sign-in", ""].map((h) => (
                <th key={h} className={tableCls.th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((u) =>
              editing === u.id ? (
                <UserEditor
                  key={u.id}
                  user={u}
                  onDone={(changed) => {
                    setEditing(null);
                    if (changed) load();
                  }}
                  onError={setError}
                />
              ) : (
                <tr key={u.id} className={tableCls.row} data-testid={`user-row-${u.email}`}>
                  <td className={tableCls.td}>
                    <div className="font-semibold">{u.name}</div>
                    <div className="text-on-surface-variant">{u.email}</div>
                    {u.disabled && <Pill tone="critical">Disabled</Pill>}
                    {!u.emailVerified && (
                      <Pill tone="medium" className="ml-1">
                        Unverified
                      </Pill>
                    )}
                  </td>
                  <td className={tableCls.td}>{u.roles.join(", ") || "none"}</td>
                  <td className={tableCls.td}>{scopeLabel(u.clientIds)}</td>
                  <td className={tableCls.td}>{u.team ?? "—"}</td>
                  <td className={tableCls.td}>{when(u.lastLoginAt)}</td>
                  <td className={`${tableCls.td} text-right`}>
                    <button
                      type="button"
                      className={btn.secondary}
                      onClick={() => setEditing(u.id)}
                      data-testid={`edit-${u.email}`}
                    >
                      Edit
                    </button>
                    {u.email !== selfEmail && (
                      <button
                        type="button"
                        className={`${btn.danger} ml-2`}
                        onClick={async () => {
                          if (!window.confirm(`Delete ${u.email}? This cannot be undone.`)) return;
                          await adminApi.deleteUser(u.id).catch((e) => setError(errMsg(e)));
                          load();
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function UserEditor({
  user,
  onDone,
  onError,
}: {
  user: AccountView;
  onDone: (changed: boolean) => void;
  onError: (m: string | null) => void;
}) {
  const [roles, setRoles] = useState<Role[]>(user.roles);
  const [clients, setClients] = useState(user.clientIds === "*" ? "*" : user.clientIds.join(", "));
  const [team, setTeam] = useState(user.team ?? "");
  const [disabled, setDisabled] = useState(Boolean(user.disabled));
  const save = async () => {
    try {
      await adminApi.updateUser(user.id, {
        roles,
        clientIds: parseScope(clients),
        team: team.trim() || null,
        disabled,
      });
      onError(null);
      onDone(true);
    } catch (e) {
      onError(errMsg(e));
    }
  };
  return (
    <tr className="bg-surface-container-low" data-testid={`user-editor-${user.email}`}>
      <td className={tableCls.td}>
        <div className="font-semibold">{user.name}</div>
        <div className="text-on-surface-variant">{user.email}</div>
      </td>
      <td className={tableCls.td}>
        <RolePicker value={roles} onChange={setRoles} />
      </td>
      <td className={tableCls.td}>
        <input
          aria-label="Client ids"
          className={inputCls}
          value={clients}
          onChange={(e) => setClients(e.target.value)}
          placeholder="client-a, client-b or *"
          data-testid="clients-input"
        />
      </td>
      <td className={tableCls.td}>
        <input
          aria-label="Team"
          className={inputCls}
          value={team}
          onChange={(e) => setTeam(e.target.value)}
        />
      </td>
      <td className={tableCls.td}>
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={disabled}
            onChange={(e) => setDisabled(e.target.checked)}
          />
          Disabled
        </label>
      </td>
      <td className={`${tableCls.td} text-right whitespace-nowrap`}>
        <button
          type="button"
          className={btn.primary}
          onClick={() => void save()}
          data-testid="save-user-button"
        >
          Save
        </button>
        <button type="button" className={`${btn.secondary} ml-2`} onClick={() => onDone(false)}>
          Cancel
        </button>
      </td>
    </tr>
  );
}

function Invitations() {
  const [rows, setRows] = useState<Invitation[] | null>(null);
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<Role[]>(["viewer"]);
  const [clients, setClients] = useState("");
  const [team, setTeam] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    adminApi
      .invitations()
      .then(setRows)
      .catch((e) => setError(errMsg(e)));
  }, []);
  useEffect(load, [load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const inv = await adminApi.invite({
        email,
        roles,
        clientIds: parseScope(clients),
        team: team.trim() || null,
      });
      setLink(inv.link);
      setEmail("");
      load();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  const status = (i: Invitation) =>
    i.acceptedAt
      ? "Accepted"
      : i.revokedAt
        ? "Revoked"
        : Date.parse(i.expiresAt) < Date.now()
          ? "Expired"
          : "Pending";

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="Invite someone"
        subtitle="They get an account with exactly these roles and clients."
        testId="invite-card"
      >
        {link && (
          <div className="mb-4" data-testid="invite-link">
            <Notice>
              Share this link with them. It is shown only once (and was emailed if the server can
              send mail).
              <code className="block mt-2 break-all font-mono text-[11px] select-all">{link}</code>
            </Notice>
          </div>
        )}
        <form
          onSubmit={submit}
          className="flex flex-col gap-3 max-w-lg"
          aria-label="Invite someone"
        >
          <Field
            id="inv-email"
            label="Email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="invite-email-input"
          />
          <RolePicker value={roles} onChange={setRoles} />
          <Field
            id="inv-clients"
            label="Client access"
            value={clients}
            onChange={(e) => setClients(e.target.value)}
            placeholder="client-a, client-b or *"
            hint="Leave empty for no client data."
          />
          <Field
            id="inv-team"
            label="Team (optional)"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
          />
          <FormError message={error} />
          <button
            type="submit"
            className={`${btn.primary} self-start`}
            disabled={roles.length === 0}
            data-testid="send-invite-button"
          >
            <Icon name="mail" className="text-[16px]" />
            Create invitation
          </button>
        </form>
      </Panel>
      <Panel title="Invitations">
        {!rows ? (
          <Loading>Loading…</Loading>
        ) : rows.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No invitations yet.</p>
        ) : (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead>
                <tr className={tableCls.headRow}>
                  {["Email", "Roles", "Clients", "By", "Sent", "Status", ""].map((h) => (
                    <th key={h} className={tableCls.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} className={tableCls.row}>
                    <td className={tableCls.td}>{i.email}</td>
                    <td className={tableCls.td}>{i.roles.join(", ")}</td>
                    <td className={tableCls.td}>{scopeLabel(i.clientIds)}</td>
                    <td className={tableCls.td}>{i.invitedBy}</td>
                    <td className={tableCls.td}>{when(i.createdAt)}</td>
                    <td className={tableCls.td}>{status(i)}</td>
                    <td className={`${tableCls.td} text-right`}>
                      {status(i) === "Pending" && (
                        <button
                          type="button"
                          className={btn.danger}
                          onClick={async () => {
                            await adminApi.revokeInvitation(i.id).catch((e) => setError(errMsg(e)));
                            load();
                          }}
                        >
                          Revoke
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
    </div>
  );
}

function Audit() {
  const [rows, setRows] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    adminApi
      .audit(200)
      .then(setRows)
      .catch((e) => setError(errMsg(e)));
  }, []);
  if (!rows) return error ? <FormError message={error} /> : <Loading>Loading audit log…</Loading>;
  return (
    <Panel
      title="Audit log"
      subtitle="Newest first. Sign-ins, failed attempts, account and admin changes."
      testId="audit-card"
    >
      <div className={tableCls.wrap}>
        <table className={tableCls.table}>
          <thead>
            <tr className={tableCls.headRow}>
              {["When", "Actor", "Action", "Target", "From"].map((h) => (
                <th key={h} className={tableCls.th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className={tableCls.row}>
                <td className={`${tableCls.td} whitespace-nowrap`}>{when(e.at)}</td>
                <td className={tableCls.td}>{e.actor}</td>
                <td className={`${tableCls.td} font-mono`}>{e.action}</td>
                <td className={`${tableCls.td} font-mono max-w-[14rem] truncate`}>
                  {e.target ?? "—"}
                </td>
                <td className={tableCls.td}>{e.ip ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
