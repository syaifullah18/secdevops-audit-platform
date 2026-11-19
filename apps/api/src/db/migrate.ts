import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** What the migrator needs from a database handle (a `pg.Pool` satisfies it). */
export interface Db {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle", import.meta.url));
const LOCK_ID = 727301;
// duplicate_table / duplicate_column / duplicate_object (constraints, types) / duplicate_schema
const ALREADY_EXISTS = new Set(["42P07", "42701", "42710", "42P06"]);

/**
 * Applies the SQL files in `drizzle/` that this database has not seen, in order, and records them
 * in `sdap_schema_migrations`. Statements run one at a time and an "already exists" error is
 * skipped, so a database built earlier by the init script, by hand, or by a run that stopped
 * halfway is brought up to date without re-creating anything. Any other error stops the start.
 * An advisory lock keeps two API replicas from migrating at once.
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
      const statements = readFileSync(join(dir, file), "utf8")
        .split("--> statement-breakpoint")
        .map((x) => x.trim())
        .filter(Boolean);
      log(`migration ${file}: applying ${statements.length} statements`);
      let skipped = 0;
      for (const stmt of statements) {
        try {
          await db.query(stmt);
        } catch (err) {
          // The object is already there (created by hand or by the init script): carry on.
          if (ALREADY_EXISTS.has(String((err as { code?: unknown }).code))) {
            skipped++;
            continue;
          }
          throw new Error(
            `migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      if (skipped) log(`migration ${file}: ${skipped} objects already existed`);
      await db.query("insert into sdap_schema_migrations (name) values ($1)", [file]);
      applied.push(file);
    }
  } finally {
    await db.query("select pg_advisory_unlock($1)", [LOCK_ID]);
  }
  return applied;
}
