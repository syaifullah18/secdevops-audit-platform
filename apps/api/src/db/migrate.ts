import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** What the migrator needs from a database handle (a `pg.Pool` satisfies it). */
export interface Db {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle", import.meta.url));
const LOCK_ID = 727301;

/**
 * Applies the SQL files in `drizzle/` that this database has not seen, in order, each in one
 * transaction, and records them in `sdap_schema_migrations`.
 *
 * A database created before this table existed (by the compose init script, or by hand) already
 * contains the tables of its migrations. A file whose first table is already present is recorded
 * without running, so upgrading never re-creates anything. An advisory lock keeps two API
 * replicas from migrating at once.
 */
export async function applyMigrations(
  db: Db,
  dir: string = MIGRATIONS_DIR,
  log: (m: string) => void = () => undefined,
): Promise<string[]> {
  const applied: string[] = [];
  await db.query("select pg_advisory_lock($1)", [LOCK_ID]);
  try {
    await db.query(
      `create table if not exists sdap_schema_migrations (
         name text primary key, applied_at timestamptz not null default now())`,
    );
    const done = new Set(
      (await db.query("select name from sdap_schema_migrations")).rows.map((r) =>
        String(r["name"]),
      ),
    );
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      if (done.has(file)) continue;
      const sql = readFileSync(join(dir, file), "utf8");
      const probe = /CREATE TABLE "([^"]+)"/.exec(sql)?.[1];
      const exists = probe
        ? (await db.query("select to_regclass($1) as t", [`public."${probe}"`])).rows[0]?.["t"] !=
          null
        : false;
      if (exists) {
        log(`migration ${file}: tables already present, recorded`);
      } else {
        log(`migration ${file}: applying`);
        await db.query("begin");
        try {
          await db.query(sql.replaceAll("--> statement-breakpoint", ""));
          await db.query("insert into sdap_schema_migrations (name) values ($1)", [file]);
          await db.query("commit");
        } catch (err) {
          await db.query("rollback");
          throw new Error(
            `migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        applied.push(file);
        continue;
      }
      await db.query("insert into sdap_schema_migrations (name) values ($1)", [file]);
    }
  } finally {
    await db.query("select pg_advisory_unlock($1)", [LOCK_ID]);
  }
  return applied;
}
