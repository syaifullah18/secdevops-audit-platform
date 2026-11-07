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

/** Reads configuration from the environment; `overrides` win (used by tests). */
export const loadConfig = (
  overrides: Partial<AppConfig> = {},
  env: Env = process.env,
): AppConfig => {
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
  };
};
