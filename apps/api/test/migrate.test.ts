import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { applyMigrations, MIGRATIONS_DIR } from "../src/db/migrate.js";

// Like pg: without parameters the whole string runs as a simple query (several statements allowed).
const db = (c: PGlite) => ({
  query: async (sql: string, params?: unknown[]) => {
    if (!params) {
      const res = await c.exec(sql);
      return { rows: (res.at(-1)?.rows ?? []) as Record<string, unknown>[] };
    }
    return { rows: (await c.query(sql, params)).rows as Record<string, unknown>[] };
  },
});

describe("applyMigrations", () => {
  let c: PGlite;
  afterEach(async () => c.close());

  it("builds the schema on an empty database and is a no-op the second time", async () => {
    c = new PGlite();
    const first = await applyMigrations(db(c), MIGRATIONS_DIR);
    expect(first.length).toBeGreaterThanOrEqual(2);
    for (const t of ["projects", "account_identities", "account_users"]) {
      expect((await c.query("select to_regclass($1) as t", [`public.${t}`])).rows[0]).toMatchObject(
        {
          t,
        },
      );
    }
    expect(await applyMigrations(db(c), MIGRATIONS_DIR)).toEqual([]);
  });

  it("adds only the missing migration to a database created before accounts existed", async () => {
    c = new PGlite();
    // Reproduce the hosted case: migration 0000 applied by hand, no ledger table.
    const { readFileSync, readdirSync } = await import("node:fs");
    const first = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort()[0]!;
    await c.exec(
      readFileSync(`${MIGRATIONS_DIR}/${first}`, "utf8").replaceAll("--> statement-breakpoint", ""),
    );

    const applied = await applyMigrations(db(c), MIGRATIONS_DIR);
    expect(applied).toContain(first); // recorded; its tables already existed and were left alone
    expect(applied.some((f) => f.includes("native_accounts"))).toBe(true);
    expect(
      (await c.query("select to_regclass('public.account_identities') as t")).rows[0],
    ).toMatchObject({
      t: "account_identities",
    });
  });

  it("finishes a database that is partly migrated (columns or tables already present)", async () => {
    c = new PGlite();
    const { readFileSync, readdirSync } = await import("node:fs");
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const f of files) {
      await c.exec(
        readFileSync(`${MIGRATIONS_DIR}/${f}`, "utf8").replaceAll("--> statement-breakpoint", ""),
      );
    }
    // Everything already exists, as after a run that applied the SQL but never recorded it.
    const applied = await applyMigrations(db(c), MIGRATIONS_DIR);
    expect(applied.length).toBe(files.length);
    expect(await applyMigrations(db(c), MIGRATIONS_DIR)).toEqual([]);
  });

  it("stops on a real error and does not record the migration", async () => {
    c = new PGlite();
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "mig-"));
    writeFileSync(
      join(dir, "0000_bad.sql"),
      'CREATE TABLE "a" (id int);\n--> statement-breakpoint\nSELECT nope();',
    );
    await expect(applyMigrations(db(c), dir)).rejects.toThrow(/0000_bad.sql failed/);
    expect(
      (await c.query("select count(*)::int as n from sdap_schema_migrations")).rows[0],
    ).toMatchObject({ n: 0 });
    // Re-running after fixing the file resumes: the table made before the failure is tolerated.
    writeFileSync(
      join(dir, "0000_bad.sql"),
      'CREATE TABLE "a" (id int);\n--> statement-breakpoint\nCREATE TABLE "b" (id int);',
    );
    expect(await applyMigrations(db(c), dir)).toEqual(["0000_bad.sql"]);
  });
});
