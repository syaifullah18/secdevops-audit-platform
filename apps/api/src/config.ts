export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: "development" | "production" | "test";
  logLevel: string;
  /** Static dev tokens. Forced off when `nodeEnv === "production"`, whatever the input. */
  authDevMode: boolean;
  oidcIssuerUrl?: string;
  /** Explicit JWKS URL; when absent it is discovered from the issuer's OIDC metadata. */
  oidcJwksUrl?: string;
  oidcAudience?: string;
  databaseUrl?: string;
  redisUrl: string;
  /**
   * Per-project webhook secrets keyed by project id or slug.
   * TODO(contract): move into the store once Project carries a secret reference
   * (see docs/workstreams/WS2-contract-request.md).
   */
  webhookSecrets: Record<string, string>;
  /** Skill commit recorded on queued runs; the worker overwrites it with the real pin. */
  skillVersion: string;
  /** Honour X-Forwarded-For (set when a reverse proxy terminates TLS in front of the API). */
  trustProxy: boolean;
  accounts: AccountsConfig;
}

export interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
}

/** Native accounts: sign-up, password login, sessions, API tokens, invitations. Off by default. */
export interface AccountsConfig {
  enabled: boolean;
  signupMode: "open" | "invite" | "closed";
  /** Email + password sign-in. Off leaves provider sign-in only. */
  passwordLogin: boolean;
  requireEmailVerification: boolean;
  defaultRole: "viewer" | "developer" | "devops" | "security";
  /** Public URL of the web app, used in email links and OAuth redirects back. */
  webBaseUrl: string;
  /** Public URL of the API as browsers reach it (OAuth redirect URI base). */
  apiPublicUrl: string;
  /** When set, only this address can become the first admin; otherwise the first sign-up does. */
  bootstrapAdminEmail?: string;
  sessionTtlDays: number;
  /** Signs OAuth state. Required when a provider is configured (`openssl rand -hex 32`). */
  secret?: string;
  smtpUrl?: string;
  mailFrom: string;
  google?: OAuthProviderConfig;
  github?: OAuthProviderConfig;
}

type Env = Readonly<Record<string, string | undefined>>;

const parseNodeEnv = (raw: string | undefined): AppConfig["nodeEnv"] =>
  raw === "production" || raw === "test" ? raw : "development";

const parseSecrets = (raw: string | undefined): Record<string, string> => {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("WEBHOOK_SECRETS must be a JSON object of { projectIdOrSlug: secret }");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("WEBHOOK_SECRETS must be a JSON object of { projectIdOrSlug: secret }");
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string" && value.length > 0) out[key] = value;
  }
  return out;
};

const oauthFrom = (id: string | undefined, secret: string | undefined) =>
  id && secret ? { clientId: id, clientSecret: secret } : undefined;

const oneOf = <T extends string>(raw: string | undefined, allowed: readonly T[], fallback: T): T =>
  allowed.includes(raw as T) ? (raw as T) : fallback;

const loadAccountsConfig = (env: Env): AccountsConfig => {
  const smtpUrl = env["SMTP_URL"] || undefined;
  const google = oauthFrom(env["GOOGLE_CLIENT_ID"], env["GOOGLE_CLIENT_SECRET"]);
  const github = oauthFrom(env["GITHUB_CLIENT_ID"], env["GITHUB_CLIENT_SECRET"]);
  return {
    enabled: env["AUTH_NATIVE"] === "true",
    signupMode: oneOf(env["SIGNUP_MODE"], ["open", "invite", "closed"] as const, "invite"),
    passwordLogin: env["PASSWORD_LOGIN"] !== "false",
    // Verification needs a mailbox: default on only when mail can be delivered.
    requireEmailVerification:
      env["REQUIRE_EMAIL_VERIFICATION"] !== undefined
        ? env["REQUIRE_EMAIL_VERIFICATION"] === "true"
        : smtpUrl !== undefined,
    defaultRole: oneOf(
      env["SIGNUP_DEFAULT_ROLE"],
      ["viewer", "developer", "devops", "security"] as const,
      "viewer",
    ),
    webBaseUrl: (env["WEB_BASE_URL"] || "http://localhost:5173").replace(/\/+$/, ""),
    apiPublicUrl: (env["API_PUBLIC_URL"] || "http://localhost:8080").replace(/\/+$/, ""),
    ...(env["BOOTSTRAP_ADMIN_EMAIL"]
      ? { bootstrapAdminEmail: env["BOOTSTRAP_ADMIN_EMAIL"].trim().toLowerCase() }
      : {}),
    sessionTtlDays: Number(env["SESSION_TTL_DAYS"] ?? 14) || 14,
    ...(smtpUrl ? { smtpUrl } : {}),
    ...(env["AUTH_SECRET"] ? { secret: env["AUTH_SECRET"] } : {}),
    mailFrom: env["MAIL_FROM"] || "SecDevOps Audit <no-reply@localhost>",
    ...(google ? { google } : {}),
    ...(github ? { github } : {}),
  };
};

/** Reads configuration from the environment; `overrides` win (used by tests). */
export type ConfigOverrides = Omit<Partial<AppConfig>, "accounts"> & {
  accounts?: Partial<AccountsConfig>;
};

export const loadConfig = (overrides: ConfigOverrides = {}, env: Env = process.env): AppConfig => {
  const nodeEnv = overrides.nodeEnv ?? parseNodeEnv(env["NODE_ENV"]);
  const devRequested = overrides.authDevMode ?? env["AUTH_DEV_MODE"] === "true";
  return {
    port: overrides.port ?? Number(env["API_PORT"] ?? env["PORT"] ?? 8080),
    host: overrides.host ?? env["HOST"] ?? "0.0.0.0",
    nodeEnv,
    logLevel: overrides.logLevel ?? env["LOG_LEVEL"] ?? "info",
    authDevMode: devRequested && nodeEnv !== "production",
    oidcIssuerUrl: overrides.oidcIssuerUrl ?? (env["OIDC_ISSUER_URL"] || undefined),
    oidcJwksUrl: overrides.oidcJwksUrl ?? (env["OIDC_JWKS_URL"] || undefined),
    oidcAudience:
      overrides.oidcAudience ?? (env["OIDC_AUDIENCE"] || env["OIDC_CLIENT_ID"] || "sdap-api"),
    databaseUrl: overrides.databaseUrl ?? (env["DATABASE_URL"] || undefined),
    redisUrl: overrides.redisUrl ?? (env["REDIS_URL"] || "redis://localhost:6379"),
    webhookSecrets: overrides.webhookSecrets ?? parseSecrets(env["WEBHOOK_SECRETS"]),
    skillVersion: overrides.skillVersion ?? (env["SKILL_VERSION"] || "unpinned"),
    trustProxy: overrides.trustProxy ?? env["TRUST_PROXY"] === "true",
    accounts: { ...loadAccountsConfig(env), ...overrides.accounts },
  };
};
