import pg from "pg";
import { createAccounts } from "./accounts/index.js";
import { buildApp } from "./app.js";
import { createAuthVerifier, hasExternalAuth } from "./auth.js";
import { loadConfig } from "./config.js";
import { createPgStore } from "./db/index.js";
import { BullMqQueue } from "./queue.js";

const start = async () => {
  const config = loadConfig();

  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required to start the API");
  }

  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  const store = createPgStore(pool);
  const queue = new BullMqQueue(config.redisUrl ?? "redis://localhost:6379");
  const accounts = config.accounts.enabled ? createAccounts(config, pool) : null;
  // With native accounts, OIDC is optional; without them, the API refuses to start unauthenticated.
  const auth = !accounts || hasExternalAuth(config) ? createAuthVerifier(config) : undefined;
  if (config.authDevMode) console.warn("AUTH_DEV_MODE is on: static dev tokens are accepted");

  const app = await buildApp({
    store,
    queue,
    ...(auth ? { auth } : {}),
    ...(accounts ? { accounts: accounts.service, oauth: accounts.oauth } : {}),
    config,
  });

  const address = await app.listen({
    port: config.port,
    host: config.host,
  });
  console.warn(`SecDevOps Audit Platform API listening at ${address}`);

  const shutdown = async (signal: string) => {
    console.warn(`Received ${signal}, shutting down gracefully...`);
    try {
      await app.close();
      await queue.close();
      await store.close();
      await pool.end();
      process.exit(0);
    } catch (err) {
      console.error("Error during graceful shutdown:", err);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
};

if (process.env["NODE_ENV"] !== "test") {
  start().catch((err) => {
    console.error("Failed to start API service:", err);
    process.exit(1);
  });
}
