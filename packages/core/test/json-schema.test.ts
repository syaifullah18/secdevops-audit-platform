import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { toJsonSchemas } from "../scripts/export-json-schema.js";

describe("JSON Schema export", () => {
  const schemas = toJsonSchemas();

  it("exports every contract", () => {
    expect(Object.keys(schemas)).toContain("Finding");
    expect(Object.keys(schemas)).toContain("PlatformEvent");
  });

  it("committed schema files are up to date (run `pnpm --filter @sdap/core schema`)", () => {
    for (const [name, schema] of Object.entries(schemas)) {
      const file = fileURLToPath(new URL(`../schema/${name}.schema.json`, import.meta.url));
      const committed = JSON.parse(readFileSync(file, "utf8")) as unknown;
      expect(committed, name).toEqual(JSON.parse(JSON.stringify(schema)));
    }
  });
});
