import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { OAuthProviderConfig } from "../config.js";
import type { ProviderProfile } from "./service.js";

export type ProviderName = "google" | "github";
export const PROVIDER_NAMES: readonly ProviderName[] = ["google", "github"];

type FetchFn = typeof fetch;

interface ProviderDef {
  authorizeUrl: string;
  scope: string;
  fetchProfile(
    cfg: OAuthProviderConfig,
    code: string,
    verifier: string,
    redirectUri: string,
    f: FetchFn,
  ): Promise<ProviderProfile>;
}

const form = (data: Record<string, string>) => new URLSearchParams(data).toString();

const jsonOrThrow = async (res: Response, what: string): Promise<Record<string, unknown>> => {
  if (!res.ok) throw new Error(`${what} failed (${res.status})`);
  return (await res.json()) as Record<string, unknown>;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

const PROVIDERS: Record<ProviderName, ProviderDef> = {
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    scope: "openid email profile",
    async fetchProfile(cfg, code, verifier, redirectUri, f) {
      const tok = await jsonOrThrow(
        await f("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: form({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            client_id: cfg.clientId,
            client_secret: cfg.clientSecret,
            code_verifier: verifier,
          }),
        }),
        "Google token exchange",
      );
      const access = str(tok["access_token"]);
      if (!access) throw new Error("Google returned no access token");
      const info = await jsonOrThrow(
        await f("https://openidconnect.googleapis.com/v1/userinfo", {
          headers: { authorization: `Bearer ${access}` },
        }),
        "Google userinfo",
      );
      const subject = str(info["sub"]);
      if (!subject) throw new Error("Google returned no account id");
      return {
        subject,
        email: str(info["email"]),
        emailVerified: info["email_verified"] === true,
        name: str(info["name"]),
      };
    },
  },
  github: {
    authorizeUrl: "https://github.com/login/oauth/authorize",
    scope: "read:user user:email",
    async fetchProfile(cfg, code, verifier, redirectUri, f) {
      const tok = await jsonOrThrow(
        await f("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json",
          },
          body: form({
            code,
            redirect_uri: redirectUri,
            client_id: cfg.clientId,
            client_secret: cfg.clientSecret,
            code_verifier: verifier,
          }),
        }),
        "GitHub token exchange",
      );
      const access = str(tok["access_token"]);
      if (!access) throw new Error("GitHub returned no access token");
      const headers = {
        authorization: `Bearer ${access}`,
        accept: "application/vnd.github+json",
        "user-agent": "sdap",
      };
      const user = await jsonOrThrow(
        await f("https://api.github.com/user", { headers }),
        "GitHub user",
      );
      const id = user["id"];
      if (typeof id !== "number" && typeof id !== "string")
        throw new Error("GitHub returned no account id");
      const emailsRes = await f("https://api.github.com/user/emails", { headers });
      const emails = emailsRes.ok
        ? ((await emailsRes.json()) as Array<Record<string, unknown>>)
        : [];
      // Only the primary address GitHub itself verified counts.
      const primary = emails.find((e) => e["primary"] === true && e["verified"] === true);
      return {
        subject: String(id),
        email: str(primary?.["email"]),
        emailVerified: primary !== undefined,
        name: str(user["name"]) ?? str(user["login"]),
      };
    },
  },
};

const challenge = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url");

/** Authorization-code flow with PKCE. State is a signed, short-lived JWT bound to a browser cookie. */
export class OAuthFlow {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly configs: Partial<Record<ProviderName, OAuthProviderConfig>>,
    private readonly apiPublicUrl: string,
    private readonly fetchImpl: FetchFn = fetch,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  enabled(): ProviderName[] {
    return PROVIDER_NAMES.filter((p) => this.configs[p]);
  }

  redirectUri(provider: ProviderName): string {
    return `${this.apiPublicUrl}/api/v1/auth/oauth/${provider}/callback`;
  }

  async start(provider: ProviderName): Promise<{ url: string; nonce: string }> {
    const cfg = this.configs[provider];
    if (!cfg) throw new Error("provider not configured");
    const verifier = randomBytes(48).toString("base64url");
    const nonce = randomBytes(24).toString("base64url");
    const state = await new SignJWT({ v: verifier, n: nonce, p: provider })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("10m")
      .sign(this.key);
    const def = PROVIDERS[provider];
    const url = new URL(def.authorizeUrl);
    url.search = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: this.redirectUri(provider),
      response_type: "code",
      scope: def.scope,
      state,
      code_challenge: challenge(verifier),
      code_challenge_method: "S256",
    }).toString();
    return { url: url.toString(), nonce };
  }

  /** Validates state and the browser cookie, then trades the code for the provider profile. */
  async complete(
    provider: ProviderName,
    code: string,
    state: string,
    cookieNonce: string | undefined,
  ): Promise<ProviderProfile> {
    const cfg = this.configs[provider];
    if (!cfg) throw new Error("provider not configured");
    const { payload } = await jwtVerify(state, this.key, { algorithms: ["HS256"] });
    if (payload["p"] !== provider || typeof payload["v"] !== "string") throw new Error("bad state");
    if (!cookieNonce || payload["n"] !== cookieNonce)
      throw new Error("state does not match this browser");
    return PROVIDERS[provider].fetchProfile(
      cfg,
      code,
      payload["v"],
      this.redirectUri(provider),
      this.fetchImpl,
    );
  }
}
