import fastify, { type FastifyInstance } from "fastify";
import type { Store } from "@sdap/core";
import { ZodError } from "zod";
import { writeAuditLog } from "./audit.js";
import { type AuthVerifier, createAuthVerifier, hasExternalAuth } from "./auth.js";
import { accountRoutes, authPublicRoutes } from "./accounts/routes.js";
import type { OAuthFlow } from "./accounts/oauth.js";
import type { AccountService } from "./accounts/service.js";
import { CompositeAuthVerifier, NativeAuthVerifier } from "./accounts/verifier.js";
import { type ConfigOverrides, loadConfig } from "./config.js";
import { formatZodError, HttpError, NotFoundError } from "./errors.js";
import type { Queue } from "./queue.js";
import { createAuthPreHandler } from "./rbac.js";
import { findingRoutes } from "./routes/findings.js";
import { policyRoutes } from "./routes/policies.js";
import { projectRoutes } from "./routes/projects.js";
import { runRoutes } from "./routes/runs.js";
import { systemRoutes } from "./routes/system.js";
import { type WebhookSecretResolver, webhookRoutes } from "./routes/webhooks.js";
import { type SdapMetrics, createMetrics } from "./metrics.js";

export interface BuildAppOptions {
  store: Store;
  queue: Queue;
  /** Native accounts (sign-up, sessions, API tokens). Enabled by `AUTH_NATIVE=true`. */
  accounts?: AccountService;
  oauth?: OAuthFlow | null;
  /** Defaults to the verifier described by `config` (OIDC, or dev tokens outside production). */
  auth?: AuthVerifier;
  config?: ConfigOverrides;
  /** Metrics registry and handles; created by default if not passed. */
  metrics?: SdapMetrics;
  /** Optional bearer token for `/metrics`. */
  metricsBearerToken?: string;
  /** Per-project webhook secret lookup; defaults to `config.webhookSecrets`. */
  webhookSecretResolver?: WebhookSecretResolver;
  /** Sink for the structured log (including audit lines); tests capture it. */
  logStream?: { write(line: string): void };
  /** SSE poll interval in ms. */
  ssePollMs?: number;
}

/** Dependency-injected app factory: no globals, nothing is read from the environment but `config`. */
export const buildApp = async (options: BuildAppOptions): Promise<FastifyInstance> => {
  const config = loadConfig(options.config);
  if (config.accounts.enabled && !options.accounts) {
    throw new Error("AUTH_NATIVE is on but no account store was provided");
  }
  const external = options.auth ?? (hasExternalAuth(config) ? createAuthVerifier(config) : null);
  const auth: AuthVerifier | null = options.accounts
    ? new CompositeAuthVerifier(new NativeAuthVerifier(options.accounts), external)
    : external;
  if (!auth) {
    // Same message as before: the API never starts open.
    createAuthVerifier(config);
    throw new Error("Authentication is not configured");
  }

  const app = fastify({
    trustProxy: config.trustProxy,
    logger:
      config.logLevel === "silent" && !options.logStream
        ? false
        : {
            level: config.logLevel,
            ...(options.logStream ? { stream: options.logStream } : {}),
          },
  });

  // JSON bodies are parsed from the raw bytes, which are kept for webhook HMAC verification.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    req.rawBody = body as Buffer;
    if (body.length === 0) return done(null, {});
    try {
      done(null, JSON.parse(body.toString("utf-8")));
    } catch {
      done(new HttpError(400, "Bad Request", "Request body is not valid JSON"), undefined);
    }
  });

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof HttpError) return reply.status(error.statusCode).send(error.toApiError());
    if (error instanceof ZodError) return reply.status(400).send(formatZodError(error));

    const e = error as { statusCode?: number; message?: string; name?: string };
    const status =
      e.statusCode !== undefined && e.statusCode >= 400 && e.statusCode < 500 ? e.statusCode : 500;
    if (status === 500) {
      // Internal details stay in the log; the caller gets a generic message.
      req.log.error({ err: error }, "unhandled error");
      return reply
        .status(500)
        .send({ error: "Internal Server Error", message: "Unexpected error" });
    }
    return reply
      .status(status)
      .send({ error: e.name ?? "Bad Request", message: e.message ?? "Bad Request" });
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send(new NotFoundError("Route not found").toApiError()),
  );

  app.addHook("onResponse", async (req, reply) => writeAuditLog(req, reply.statusCode));

  const metrics = options.metrics ?? createMetrics();

  await app.register(systemRoutes, {
    store: options.store,
    metrics,
    metricsBearerToken: options.metricsBearerToken,
  });

  await app.register(
    async (api) => {
      // Webhooks authenticate by signature, so they sit outside the OIDC hook.
      await api.register(webhookRoutes, {
        store: options.store,
        queue: options.queue,
        skillVersion: config.skillVersion,
        secretResolver: options.webhookSecretResolver,
        secrets: config.webhookSecrets,
      });
      if (options.accounts) {
        await api.register(authPublicRoutes, {
          accounts: options.accounts,
          oauth: options.oauth ?? null,
        });
      }
      await api.register(async (secured) => {
        secured.addHook("preHandler", createAuthPreHandler(auth));
        if (options.accounts) await secured.register(accountRoutes, { accounts: options.accounts });
        await secured.register(projectRoutes, { store: options.store });
        await secured.register(runRoutes, {
          store: options.store,
          queue: options.queue,
          skillVersion: config.skillVersion,
          ssePollMs: options.ssePollMs ?? 1000,
        });
        await secured.register(findingRoutes, { store: options.store });
        await secured.register(policyRoutes, { store: options.store });
      });
    },
    { prefix: "/api/v1" },
  );

  return app;
};
