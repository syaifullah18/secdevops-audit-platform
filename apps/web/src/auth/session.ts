import { Role } from "@sdap/core";

/**
 * Client-side session. The browser never verifies a token: it decodes claims only to show who is
 * signed in. The API verifies the signature, issuer, audience and expiry on every request.
 *
 * The token lives in localStorage so a session survives tabs and restarts (native sessions last
 * days and can be revoked from the account page). It is never put in a URL. A script injected into
 * the page could read it, which is why the web server sends a strict Content-Security-Policy; see docs/decisions.md D-019.
 */
export interface SessionUser {
  subject: string;
  /** Display name: `name` or `preferred_username` claim, else the subject. */
  name: string;
  initials: string;
  roles: Role[];
  team: string | null;
  clientIds: string[] | "*";
  /** Epoch ms, or null when the token has no `exp`. */
  expiresAt: number | null;
  demo: boolean;
  /** Signed in with an account managed by this instance (not a pasted OIDC token). */
  native?: boolean;
  email?: string;
}

const TOKEN_KEY = "sdap_token";
const SIGNED_OUT_KEY = "sdap_signed_out";
export const UNAUTHORIZED_EVENT = "sdap:unauthorized";

const store = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

export const getToken = (): string | null => store()?.getItem(TOKEN_KEY) ?? null;

export const setToken = (token: string): void => {
  store()?.setItem(TOKEN_KEY, token);
  store()?.removeItem(SIGNED_OUT_KEY);
};

const USER_KEY = "sdap_user";

/** Last known profile of the signed-in account, so the shell can render before /account answers. */
export const getStoredUser = (): SessionUser | null => {
  try {
    const raw = store()?.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
};
export const setStoredUser = (u: SessionUser): void =>
  store()?.setItem(USER_KEY, JSON.stringify(u));

export const clearSession = (): void => {
  store()?.removeItem(TOKEN_KEY);
  store()?.removeItem(USER_KEY);
  store()?.setItem(SIGNED_OUT_KEY, "1");
};

export const clearSignedOutFlag = (): void => store()?.removeItem(SIGNED_OUT_KEY);

export const wasSignedOut = (): boolean => store()?.getItem(SIGNED_OUT_KEY) === "1";

export const initialsOf = (name: string): string => {
  const parts = name
    .replace(/@.*$/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters = (parts.length > 1 ? [parts[0], parts[parts.length - 1]] : [parts[0] ?? "?"])
    .map((p) => p?.[0] ?? "")
    .join("");
  return (letters || "?").slice(0, 2).toUpperCase();
};

const base64UrlDecode = (s: string): string => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

const asRoles = (raw: unknown): Role[] => {
  const items = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
  return items.flatMap((i) => {
    const r = Role.safeParse(i);
    return r.success ? [r.data] : [];
  });
};

/** Reads display claims from a JWT. Returns null for anything that is not a three-part JWT. */
export function decodeToken(token: string): SessionUser | null {
  const parts = token.trim().split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const p = JSON.parse(base64UrlDecode(parts[1])) as Record<string, unknown>;
    const subject = p["sub"];
    if (typeof subject !== "string" || !subject) return null;
    const realm = p["realm_access"] as { roles?: unknown } | undefined;
    const rawClients = p["clientIds"] ?? p["client_ids"];
    const clientIds: string[] | "*" =
      rawClients === "*" || (Array.isArray(rawClients) && rawClients.includes("*"))
        ? "*"
        : Array.isArray(rawClients)
          ? rawClients.filter((c): c is string => typeof c === "string")
          : [];
    const display =
      [p["name"], p["preferred_username"]].find((v): v is string => typeof v === "string" && !!v) ??
      subject;
    return {
      subject,
      name: display,
      initials: initialsOf(display),
      roles: asRoles(p["roles"] ?? realm?.roles ?? p["role"]),
      team: typeof p["team"] === "string" ? p["team"] : null,
      clientIds,
      expiresAt: typeof p["exp"] === "number" ? p["exp"] * 1000 : null,
      demo: false,
    };
  } catch {
    return null;
  }
}

/** Native credentials are opaque (`sdap_s_…`); only the API can say who they belong to. */
export const isNativeToken = (t: string): boolean => t.startsWith("sdap_");

export interface AccountView {
  id: string;
  email: string;
  name: string;
  roles: Role[];
  clientIds: string[] | "*";
  team: string | null;
  emailVerified: boolean;
  hasPassword: boolean;
  disabled?: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export const userFromAccount = (a: AccountView, expiresAt: number | null): SessionUser => ({
  subject: a.email,
  email: a.email,
  name: a.name,
  initials: initialsOf(a.name || a.email),
  roles: a.roles,
  team: a.team,
  clientIds: a.clientIds,
  expiresAt,
  demo: false,
  native: true,
});

export const isExpired = (u: SessionUser, now = Date.now()): boolean =>
  u.expiresAt !== null && u.expiresAt <= now;

/** Mock-API identity. Never used against a real backend. */
export const DEMO_USER: SessionUser = {
  subject: "demo.user@example.test",
  name: "Alex Vance",
  initials: "AV",
  roles: ["admin"],
  team: "secops",
  clientIds: "*",
  expiresAt: null,
  demo: true,
};

/** Highest role first, for the one-line label. */
const ORDER: Role[] = ["admin", "security", "devops", "developer", "viewer"];
export const topRole = (roles: Role[]): Role | null => ORDER.find((r) => roles.includes(r)) ?? null;
