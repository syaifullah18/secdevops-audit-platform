import type { Role } from "@sdap/core";
import { IS_MOCK } from "./mode.js";
import { request } from "./client.js";
import type { AccountView } from "../auth/session.js";

/** Client for the native-account endpoints (`/auth/*`, `/account/*`, `/admin/*`). */

export interface AuthConfig {
  native: boolean;
  passwordLogin: boolean;
  signupMode: "open" | "invite" | "closed";
  requireEmailVerification: boolean;
  providers: Array<"google" | "github">;
}

export interface SessionIssue {
  token: string;
  expiresAt: string;
  user: AccountView;
}

export interface Account extends AccountView {
  identities: Array<{ provider: string; email: string | null; linkedAt: string }>;
  tokenKind: string;
}

export interface SessionInfo {
  id: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

export interface ApiTokenInfo {
  id: string;
  name: string | null;
  prefix: string;
  roles: Role[] | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export interface Invitation {
  id: string;
  email: string;
  roles: Role[];
  clientIds: string[] | "*";
  team: string | null;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string | null;
  ip: string | null;
  details: Record<string, unknown> | null;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

/** Where the browser is sent to start a provider sign-in (a plain GET, so the API can redirect). */
export const providerStartUrl = (provider: string): string =>
  IS_MOCK
    ? "/login/callback?code=mock-provider-code"
    : `${(import.meta.env?.VITE_API_BASE_URL as string) || "/api/v1"}/auth/oauth/${provider}/start`;

export const authApi = {
  config: () => request<AuthConfig>("/auth/config", json("GET")),
  signup: (b: { email: string; name: string; password: string; inviteToken?: string }) =>
    request<{ requiresVerification: boolean; session?: SessionIssue }>(
      "/auth/signup",
      json("POST", b),
    ),
  login: (b: { email: string; password: string }) =>
    request<SessionIssue>("/auth/login", json("POST", b)),
  logout: () => request<void>("/auth/logout", json("POST", {})),
  verify: (token: string) => request<void>("/auth/verify", json("POST", { token })),
  forgot: (email: string) => request<{ ok: boolean }>("/auth/forgot", json("POST", { email })),
  reset: (token: string, password: string) =>
    request<void>("/auth/reset", json("POST", { token, password })),
  invitePreview: (token: string) =>
    request<{ email: string }>("/auth/invitations/preview", json("POST", { token })),
  exchange: (code: string) => request<SessionIssue>("/auth/oauth/exchange", json("POST", { code })),
};

export const accountApi = {
  me: () => request<Account>("/account", json("GET")),
  rename: (name: string) => request<AccountView>("/account", json("PATCH", { name })),
  changePassword: (b: { currentPassword?: string; newPassword: string }) =>
    request<void>("/account/password", json("POST", b)),
  sessions: () => request<SessionInfo[]>("/account/sessions", json("GET")),
  revokeSession: (id: string) => request<void>(`/account/sessions/${id}`, json("DELETE")),
  revokeOthers: () =>
    request<{ revoked: number }>("/account/sessions/revoke-others", json("POST", {})),
  tokens: () => request<ApiTokenInfo[]>("/account/tokens", json("GET")),
  createToken: (b: { name: string; roles?: Role[]; expiresInDays?: number }) =>
    request<ApiTokenInfo & { token: string }>("/account/tokens", json("POST", b)),
  revokeToken: (id: string) => request<void>(`/account/tokens/${id}`, json("DELETE")),
  unlink: (provider: string) => request<void>(`/account/identities/${provider}`, json("DELETE")),
  export: () => request<Record<string, unknown>>("/account/export", json("GET")),
  remove: (b: { email: string; password?: string }) =>
    request<void>("/account/delete", json("POST", b)),
};

export const adminApi = {
  users: () => request<AccountView[]>("/admin/users", json("GET")),
  updateUser: (
    id: string,
    patch: {
      name?: string;
      roles?: Role[];
      clientIds?: string[] | "*";
      team?: string | null;
      disabled?: boolean;
    },
  ) => request<AccountView>(`/admin/users/${id}`, json("PATCH", patch)),
  deleteUser: (id: string) => request<void>(`/admin/users/${id}`, json("DELETE")),
  invitations: () => request<Invitation[]>("/admin/invitations", json("GET")),
  invite: (b: { email: string; roles: Role[]; clientIds: string[] | "*"; team?: string | null }) =>
    request<Invitation & { link: string }>("/admin/invitations", json("POST", b)),
  revokeInvitation: (id: string) => request<void>(`/admin/invitations/${id}`, json("DELETE")),
  audit: (limit = 100) => request<AuditEvent[]>(`/admin/audit?limit=${limit}`, json("GET")),
};
