import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PgAccountRepo } from "../src/accounts/pg-repo.js";
import * as schema from "../src/db/schema.js";

/** A throw-away PostgreSQL (in-process) with the real migrations applied. */
export const createPglitePgRepo = async (): Promise<{
  repo: PgAccountRepo;
  close: () => Promise<void>;
}> => {
  const client = new PGlite();
  const dir = join(import.meta.dirname, "../drizzle");
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    for (const stmt of readFileSync(join(dir, file), "utf8").split("--> statement-breakpoint")) {
      if (stmt.trim()) await client.exec(stmt);
    }
  }
  const db = drizzle(client, { schema }) as unknown as NodePgDatabase<typeof schema>;
  return { repo: new PgAccountRepo(db), close: () => client.close() };
};
