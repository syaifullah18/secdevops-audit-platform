import { Role } from "@sdap/core";
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  type JSONWebKeySet,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import { z } from "zod";
import type { AppConfig } from "./config.js";

export interface AuthUser {
  subject: string;
  roles: Role[];
  clientIds: string[] | "*";
  /** Team slug, used to limit what a developer may triage. */
  team?: string;
  /** Set for native accounts: the account id, and the session or API token that authenticated. */
  accountId?: string;
  tokenId?: string;
  tokenKind?: "session" | "api_token";
}

export interface AuthVerifier {
  /** Resolves the caller from a bearer token or rejects. */
  verify(token: string): Promise<AuthUser>;
}

/** Keeps only recognised roles; unknown role strings are dropped, never mapped up. */
export const parseRoles = (raw: unknown): Role[] => {
  const items = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
  const roles = new Set<Role>();
  for (const item of items) {
    const parsed = Role.safeParse(item);
    if (parsed.success) roles.add(parsed.data);
  }
  return [...roles];
};

/**
 * Fails closed: a missing or malformed claim yields no client access, never `"*"`.
 * Only an explicit `"*"` (string, or inside the array) grants every client.
 */
export const parseClientIds = (raw: unknown): string[] | "*" => {
  if (raw === "*") return "*";
  const items = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
  const ids = items.filter((id): id is string => typeof id === "string" && id.length > 0);
  return ids.includes("*") ? "*" : ids;
};

const claimsToUser = (payload: Record<string, unknown>): AuthUser => {
  const subject = payload["sub"];
  if (typeof subject !== "string" || subject.length === 0) {
    throw new Error("token has no subject");
  }
  // `roles` (generic), Keycloak `realm_access.roles`, or a single `role` claim.
  const realmAccess = payload["realm_access"] as { roles?: unknown } | undefined;
  const roles = parseRoles(payload["roles"] ?? realmAccess?.roles ?? payload["role"]);
  const clientIds = parseClientIds(payload["clientIds"] ?? payload["client_ids"]);
  const team = typeof payload["team"] === "string" ? payload["team"] : undefined;
  return { subject, roles, clientIds, ...(team !== undefined ? { team } : {}) };
};

/** Resolves `jwks_uri` from the issuer's OIDC discovery document on first use. */
const discoveredJwks = (issuer: string): JWTVerifyGetKey => {
  let inner: JWTVerifyGetKey | undefined;
  return async (header, token) => {
    if (!inner) {
      const url = `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`OIDC discovery failed (${res.status})`);
      const meta = z.object({ jwks_uri: z.url() }).parse(await res.json());
      inner = createRemoteJWKSet(new URL(meta.jwks_uri));
    }
    return inner(header, token);
  };
};

export interface OidcOptions {
  /** Inline key set (tests, air-gapped setups). */
  jwks?: JSONWebKeySet;
  jwksUri?: string;
  /** Issuer used for discovery when neither `jwks` nor `jwksUri` is given. */
  issuer?: string;
  audience?: string;
  devMode?: boolean;
}

const DEV_TOKENS: Readonly<Record<string, AuthUser>> = {
  "dev-admin": { subject: "dev-admin", roles: ["admin"], clientIds: "*" },
  "dev-security": { subject: "dev-security", roles: ["security"], clientIds: "*" },
  "dev-devops": { subject: "dev-devops", roles: ["devops"], clientIds: "*" },
  "dev-developer": {
    subject: "dev-developer",
    roles: ["developer"],
    clientIds: "*",
    team: "team-alpha",
  },
  "dev-viewer": { subject: "dev-viewer", roles: ["viewer"], clientIds: "*" },
};

const DevClaims = z.object({
  subject: z.string().min(1).default("dev-user"),
  roles: z.unknown().optional(),
  clientIds: z.unknown().optional(),
  team: z.string().optional(),
});

/** Static dev tokens: the fixed `dev-*` names, or `dev:<base64 JSON {subject,roles,clientIds,team}>`. */
const verifyDevToken = (token: string): AuthUser | null => {
  const fixed = DEV_TOKENS[token];
  if (fixed) return { ...fixed };
  if (!token.startsWith("dev:")) return null;
  try {
    const raw: unknown = JSON.parse(Buffer.from(token.slice(4), "base64").toString("utf-8"));
    const parsed = DevClaims.safeParse(raw);
    if (!parsed.success) return null;
    return {
      subject: parsed.data.subject,
      roles: parseRoles(parsed.data.roles),
      clientIds: parseClientIds(parsed.data.clientIds),
      ...(parsed.data.team !== undefined ? { team: parsed.data.team } : {}),
    };
  } catch {
    return null;
  }
};

/**
 * Verifies OIDC bearer JWTs (signature via JWKS, issuer, audience, expiry). With `devMode`
 * the static dev tokens are accepted as well; callers must only enable that outside production
 * (see `loadConfig`).
 */
export class OidcAuthVerifier implements AuthVerifier {
  private readonly getKey: JWTVerifyGetKey | null;
  private readonly issuer: string | undefined;
  private readonly audience: string | undefined;
  private readonly devMode: boolean;

  constructor(options: OidcOptions) {
    this.issuer = options.issuer;
    this.audience = options.audience;
    this.devMode = options.devMode ?? false;

    if (options.jwks) {
      this.getKey = createLocalJWKSet(options.jwks);
    } else if (options.jwksUri) {
      this.getKey = createRemoteJWKSet(new URL(options.jwksUri));
    } else if (options.issuer) {
      this.getKey = discoveredJwks(options.issuer);
    } else if (this.devMode) {
      this.getKey = null;
    } else {
      throw new Error("OidcAuthVerifier requires jwks, jwksUri or an issuer");
    }
    if (!this.devMode && !this.audience) {
      throw new Error("OidcAuthVerifier requires an audience outside dev mode");
    }
  }

  async verify(token: string): Promise<AuthUser> {
    if (this.devMode) {
      const dev = verifyDevToken(token);
      if (dev) return dev;
    }
    if (!this.getKey) throw new Error("invalid token");
    const { payload } = await jwtVerify(token, this.getKey, {
      ...(this.issuer !== undefined ? { issuer: this.issuer } : {}),
      ...(this.audience !== undefined ? { audience: this.audience } : {}),
    });
    return claimsToUser(payload);
  }
}

export const hasExternalAuth = (config: AppConfig): boolean =>
  Boolean(config.oidcIssuerUrl || config.oidcJwksUrl || config.authDevMode);

/** Throws when neither OIDC nor dev mode is configured: the API never starts open. */
export const createAuthVerifier = (config: AppConfig): AuthVerifier => {
  if (!config.oidcIssuerUrl && !config.oidcJwksUrl && !config.authDevMode) {
    throw new Error(
      "Authentication is not configured: set OIDC_ISSUER_URL (or AUTH_DEV_MODE=true outside production)",
    );
  }
  return new OidcAuthVerifier({
    ...(config.oidcJwksUrl !== undefined ? { jwksUri: config.oidcJwksUrl } : {}),
    ...(config.oidcIssuerUrl !== undefined ? { issuer: config.oidcIssuerUrl } : {}),
    ...(config.oidcAudience !== undefined ? { audience: config.oidcAudience } : {}),
    devMode: config.authDevMode,
  });
};
