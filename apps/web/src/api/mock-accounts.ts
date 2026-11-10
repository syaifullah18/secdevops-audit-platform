import type { Role } from "@sdap/core";
import type { AccountView } from "../auth/session.js";
import type { AuditEvent, Invitation } from "./auth.js";

/**
 * In-memory stand-in for the account endpoints, so the dashboard runs standalone and the account
 * screens can be exercised without a server. Passwords are plain text here because nothing is real.
 */
export const DEMO_EMAIL = "demo.user@example.test";
export const DEMO_PASSWORD = "demo-password-123";

interface MockUser extends AccountView {
  password: string | null;
}
interface MockSession {
  id: string;
  token: string;
  userId: string;
  createdAt: string;
}
interface MockToken {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  roles: Role[] | null;
  createdAt: string;
  expiresAt: string | null;
}

const nowIso = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const rand = () => Math.random().toString(36).slice(2, 12);

let users: MockUser[] = [];
let sessions: MockSession[] = [];
let tokens: MockToken[] = [];
let invitations: Invitation[] = [];
let audit: AuditEvent[] = [];

export const resetMockAccounts = (): void => {
  const t = nowIso();
  const mk = (name: string, email: string, roles: Role[], clientIds: string[] | "*"): MockUser => ({
    id: uid(),
    email,
    name,
    roles,
    clientIds,
    team: null,
    emailVerified: true,
    hasPassword: true,
    disabled: false,
    createdAt: t,
    lastLoginAt: null,
    password: DEMO_PASSWORD,
  });
  users = [
    { ...mk("Alex Vance", DEMO_EMAIL, ["admin"], "*"), team: "secops" },
    mk("Priya Raman", "priya@example.test", ["security"], ["civd"]),
    mk("Sam Okoye", "sam@example.test", ["developer"], ["civd"]),
  ];
  sessions = [];
  tokens = [];
  invitations = [];
  audit = [
    {
      id: uid(),
      at: t,
      actor: DEMO_EMAIL,
      action: "account.login",
      target: users[0]!.id,
      ip: "127.0.0.1",
      details: null,
    },
  ];
};
resetMockAccounts();

const respond = (status: number, body?: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const fail = (status: number, message: string) => respond(status, { error: "Error", message });

const strip = ({ password: _p, ...rest }: MockUser): AccountView => rest;

const bearer = (init?: RequestInit): string | null => {
  const h = new Headers(init?.headers).get("authorization");
  return h?.replace(/^Bearer\s+/i, "") ?? null;
};

const open = (user: MockUser): { token: string; expiresAt: string; user: AccountView } => {
  const token = `sdap_s_mock_${rand()}${rand()}`;
  sessions.push({ id: uid(), token, userId: user.id, createdAt: nowIso() });
  user.lastLoginAt = nowIso();
  audit.unshift({
    id: uid(),
    at: nowIso(),
    actor: user.email,
    action: "account.login",
    target: user.id,
    ip: "127.0.0.1",
    details: null,
  });
  return { token, expiresAt: new Date(Date.now() + 14 * 864e5).toISOString(), user: strip(user) };
};

/** Returns a Response for account endpoints, or null when the path is not one of them. */
export function handleMockAccounts(
  pathname: string,
  method: string,
  init?: RequestInit,
): Response | null {
  const isAccount = /^\/(auth|account|admin)(\/|$)/.test(pathname);
  if (!isAccount) return null;
  const body = (): Record<string, unknown> => (init?.body ? JSON.parse(init.body as string) : {});

  // ----- public
  if (pathname === "/auth/config" && method === "GET") {
    return respond(200, {
      native: true,
      passwordLogin: true,
      signupMode: "open",
      requireEmailVerification: false,
      providers: ["google", "github"],
    });
  }
  if (pathname === "/auth/signup" && method === "POST") {
    const b = body() as { email: string; name: string; password: string };
    const email = b.email.trim().toLowerCase();
    if (b.password.length < 10) return fail(400, "Password must be at least 10 characters");
    if (users.some((u) => u.email === email))
      return fail(409, "An account with this email already exists");
    const u: MockUser = {
      id: uid(),
      email,
      name: b.name,
      roles: ["viewer"],
      clientIds: [],
      team: null,
      emailVerified: true,
      hasPassword: true,
      disabled: false,
      createdAt: nowIso(),
      lastLoginAt: null,
      password: b.password,
    };
    users.push(u);
    return respond(201, { requiresVerification: false, session: open(u) });
  }
  if (pathname === "/auth/login" && method === "POST") {
    const b = body() as { email: string; password: string };
    const u = users.find((x) => x.email === b.email.trim().toLowerCase());
    if (!u || u.password !== b.password) return fail(401, "Incorrect email or password");
    if (u.disabled) return fail(403, "This account is disabled");
    return respond(200, open(u));
  }
  if (pathname === "/auth/forgot" && method === "POST") return respond(202, { ok: true });
  if (pathname === "/auth/reset" && method === "POST")
    return fail(400, "This link is invalid or has expired");
  if (pathname === "/auth/verify" && method === "POST") return respond(204);
  if (pathname === "/auth/invitations/preview" && method === "POST") {
    return respond(200, { email: "invited@example.test" });
  }
  if (pathname === "/auth/oauth/exchange" && method === "POST") {
    // Mock providers hand back this fixed code and sign in as the demo account.
    if ((body() as { code?: string }).code === "mock-provider-code")
      return respond(200, open(users[0]!));
    return fail(400, "This sign-in link has expired. Try again.");
  }

  // ----- authenticated: tokenless calls are the demo user (mock mode signs it in without a token)
  const tok = bearer(init);
  const session = tok ? sessions.find((s) => s.token === tok) : undefined;
  const me = session ? users.find((u) => u.id === session.userId) : tok ? undefined : users[0];
  if (!me) return fail(401, "Invalid or expired token");
  const mine = session?.id ?? "demo-session";

  if (pathname === "/auth/logout" && method === "POST") {
    sessions = sessions.filter((s) => s.id !== session?.id);
    return respond(204);
  }
  if (pathname === "/account" && method === "GET") {
    return respond(200, { ...strip(me), identities: [], tokenKind: "session" });
  }
  if (pathname === "/account" && method === "PATCH") {
    me.name = String((body() as { name: string }).name).trim() || me.name;
    return respond(200, strip(me));
  }
  if (pathname === "/account/password" && method === "POST") {
    const b = body() as { currentPassword?: string; newPassword: string };
    if (me.password && b.currentPassword !== me.password)
      return fail(400, "Current password is incorrect");
    if (b.newPassword.length < 10) return fail(400, "Password must be at least 10 characters");
    me.password = b.newPassword;
    return respond(204);
  }
  if (pathname === "/account/sessions" && method === "GET") {
    const list = sessions.filter((s) => s.userId === me.id);
    const rows = (list.length ? list : [{ id: "demo-session", createdAt: nowIso() }]).map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      lastUsedAt: nowIso(),
      expiresAt: null,
      ip: "127.0.0.1",
      userAgent: "Browser",
      current: s.id === mine,
    }));
    return respond(200, rows);
  }
  const sessionDel = pathname.match(/^\/account\/sessions\/([^/]+)$/);
  if (sessionDel && method === "DELETE") {
    sessions = sessions.filter((s) => s.id !== sessionDel[1]);
    return respond(204);
  }
  if (pathname === "/account/sessions/revoke-others" && method === "POST") {
    const before = sessions.length;
    sessions = sessions.filter((s) => s.userId !== me.id || s.id === mine);
    return respond(200, { revoked: before - sessions.length });
  }
  if (pathname === "/account/tokens" && method === "GET") {
    return respond(
      200,
      tokens
        .filter((t) => t.userId === me.id)
        .map((t) => ({ ...t, userId: undefined, lastUsedAt: null })),
    );
  }
  if (pathname === "/account/tokens" && method === "POST") {
    const b = body() as { name: string; roles?: Role[]; expiresInDays?: number };
    const secret = `sdap_pat_${rand()}${rand()}${rand()}`;
    const t: MockToken = {
      id: uid(),
      userId: me.id,
      name: b.name,
      prefix: secret.slice(0, 13),
      roles: b.roles?.length ? b.roles : null,
      createdAt: nowIso(),
      expiresAt: b.expiresInDays
        ? new Date(Date.now() + b.expiresInDays * 864e5).toISOString()
        : null,
    };
    tokens.push(t);
    return respond(201, {
      token: secret,
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      roles: t.roles,
      createdAt: t.createdAt,
      lastUsedAt: null,
      expiresAt: t.expiresAt,
    });
  }
  const tokenDel = pathname.match(/^\/account\/tokens\/([^/]+)$/);
  if (tokenDel && method === "DELETE") {
    tokens = tokens.filter((t) => t.id !== tokenDel[1]);
    return respond(204);
  }
  if (pathname.startsWith("/account/identities/") && method === "DELETE")
    return fail(404, "Not found");
  if (pathname === "/account/export" && method === "GET")
    return respond(200, { exportedAt: nowIso(), account: strip(me) });
  if (pathname === "/account/delete" && method === "POST") {
    const b = body() as { email: string; password?: string };
    if (b.email.trim().toLowerCase() !== me.email)
      return fail(400, "Type your email address to confirm");
    if (me.password && b.password !== me.password) return fail(400, "Password is incorrect");
    if (me.roles.includes("admin") && users.filter((u) => u.roles.includes("admin")).length === 1) {
      return fail(
        409,
        "You are the only administrator; make someone else admin before you delete this account",
      );
    }
    users = users.filter((u) => u.id !== me.id);
    return respond(204);
  }

  // ----- admin
  if (pathname.startsWith("/admin/")) {
    if (!me.roles.includes("admin")) return fail(403, "Requires one of: admin");
    if (pathname === "/admin/users" && method === "GET") return respond(200, users.map(strip));
    const u = pathname.match(/^\/admin\/users\/([^/]+)$/);
    if (u && method === "PATCH") {
      const target = users.find((x) => x.id === u[1]);
      if (!target) return fail(404, "Not found");
      const b = body() as Partial<AccountView> & { disabled?: boolean };
      const admins = users.filter((x) => x.roles.includes("admin") && !x.disabled);
      const losesAdmin =
        target.roles.includes("admin") &&
        ((b.roles && !b.roles.includes("admin")) || b.disabled === true);
      if (losesAdmin && admins.length === 1)
        return fail(
          409,
          "You are the only administrator; make someone else admin before you change this account",
        );
      if (b.name !== undefined) target.name = b.name;
      if (b.roles) target.roles = b.roles;
      if (b.clientIds) target.clientIds = b.clientIds;
      if (b.team !== undefined) target.team = b.team;
      if (b.disabled !== undefined) target.disabled = b.disabled;
      audit.unshift({
        id: uid(),
        at: nowIso(),
        actor: me.email,
        action: "admin.update_user",
        target: target.id,
        ip: null,
        details: { fields: Object.keys(b) },
      });
      return respond(200, strip(target));
    }
    if (u && method === "DELETE") {
      users = users.filter((x) => x.id !== u[1]);
      return respond(204);
    }
    if (pathname === "/admin/invitations" && method === "GET") return respond(200, invitations);
    if (pathname === "/admin/invitations" && method === "POST") {
      const b = body() as {
        email: string;
        roles: Role[];
        clientIds: string[] | "*";
        team?: string | null;
      };
      const inv: Invitation = {
        id: uid(),
        email: b.email,
        roles: b.roles,
        clientIds: b.clientIds,
        team: b.team ?? null,
        invitedBy: me.email,
        createdAt: nowIso(),
        expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
        acceptedAt: null,
        revokedAt: null,
      };
      invitations.unshift(inv);
      return respond(201, { ...inv, link: `${location.origin}/signup?invite=i_mock${rand()}` });
    }
    const iv = pathname.match(/^\/admin\/invitations\/([^/]+)$/);
    if (iv && method === "DELETE") {
      const inv = invitations.find((x) => x.id === iv[1]);
      if (inv) inv.revokedAt = nowIso();
      return respond(204);
    }
    if (pathname === "/admin/audit" && method === "GET") return respond(200, audit);
  }
  return fail(404, "Route not found");
}
