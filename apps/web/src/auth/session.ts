import type { Role } from "@sdap/core";

/**
 * Client-side session. The credential itself is an HttpOnly cookie that the API sets and the
 * browser sends on its own, so no script (including injected ones) can read it; see D-019.
 * All that is kept here is the signed-in profile, so the shell can render before /account answers.
 * The API decides on every request whether the session is still valid.
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
  /** Signed in with an account managed by this instance. */
  native?: boolean;
  email?: string;
}

const SIGNED_OUT_KEY = "sdap_signed_out";
export const UNAUTHORIZED_EVENT = "sdap:unauthorized";

const store = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
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
export const setStoredUser = (u: SessionUser): void => {
  store()?.setItem(USER_KEY, JSON.stringify(u));
  store()?.removeItem(SIGNED_OUT_KEY);
};

export const clearSession = (): void => {
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
