import { describe, expect, it } from "vitest";
import { Finding, Project, Run, Slice } from "@sdap/core";

// The dataset is generated locally from real audit runs and is git-ignored, so this only
// runs where it exists. It guarantees the importer output is valid for the dashboard.
const files = import.meta.glob("../src/api/audit-data.generated.json", {
  eager: true,
  import: "default",
});
const data = Object.values(files)[0] as
  { projects: unknown[]; runs: unknown[]; slices: unknown[]; findings: unknown[] } | undefined;

describe.skipIf(!data)("imported audit dataset", () => {
  it("matches the core schemas", () => {
    for (const [schema, rows] of [
      [Project, data!.projects],
      [Run, data!.runs],
      [Slice, data!.slices],
      [Finding, data!.findings],
    ] as const) {
      for (const row of rows) {
        const r = schema.safeParse(row);
        expect(r.success, r.success ? "" : JSON.stringify(r.error.issues[0])).toBe(true);
      }
    }
  });
});
