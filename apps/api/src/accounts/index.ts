import type { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import type { AppConfig } from "../config.js";
import { LogMailer, type Mailer, SmtpMailer } from "./mailer.js";
import { OAuthFlow } from "./oauth.js";
import { PgAccountRepo } from "./pg-repo.js";
import { AccountService } from "./service.js";

export { AccountService } from "./service.js";
export { MemoryAccountRepo } from "./memory-repo.js";
export { MemoryMailer } from "./mailer.js";

export interface AccountsRuntime {
  service: AccountService;
  oauth: OAuthFlow | null;
}

/** Wires native accounts on the main pool. Refuses to start with an unsafe configuration. */
export const createAccounts = (config: AppConfig, pool: Pool): AccountsRuntime => {
  const a = config.accounts;
  const providers = {
    ...(a.google ? { google: a.google } : {}),
    ...(a.github ? { github: a.github } : {}),
  };
  const hasProvider = Object.keys(providers).length > 0;
  if (!a.passwordLogin && !hasProvider) {
    throw new Error("PASSWORD_LOGIN=false needs at least one provider (GOOGLE_* or GITHUB_*)");
  }
  if (hasProvider && (!a.secret || a.secret.length < 32)) {
    throw new Error(
      "AUTH_SECRET (at least 32 characters) is required when a sign-in provider is configured",
    );
  }
  if (config.nodeEnv === "production" && !a.webBaseUrl.startsWith("https://")) {
    console.warn("WEB_BASE_URL is not https: session tokens and email links travel unprotected");
  }
  if (a.requireEmailVerification && !a.smtpUrl) {
    throw new Error("REQUIRE_EMAIL_VERIFICATION=true needs SMTP_URL");
  }
  const mailer: Mailer = a.smtpUrl ? new SmtpMailer(a.smtpUrl, a.mailFrom) : new LogMailer();
  const repo = new PgAccountRepo(drizzle(pool, { schema }));
  return {
    service: new AccountService(repo, mailer, a),
    oauth: hasProvider ? new OAuthFlow(a.secret!, providers, a.apiPublicUrl) : null,
  };
};
