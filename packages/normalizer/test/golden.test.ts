import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Finding } from "@sdap/core";
import { describe, expect, it } from "vitest";
import { salvageFindingsJson } from "../src/index.js";
import { GOLDEN_DIR, normalizeCase, readGolden } from "./helpers.js";

const check = (name: string, findingsFile?: string) => {
  const actual = normalizeCase(name, {}, findingsFile);
  const expectedPath = join(GOLDEN_DIR, name, "expected.json");
  if (process.env["UPDATE_GOLDEN"] === "1") {
    writeFileSync(expectedPath, JSON.stringify(actual, null, 2) + "\n");
  }
  const expected: unknown = JSON.parse(readFileSync(expectedPath, "utf8"));
  expect(actual).toEqual(expected);
  for (const f of actual) expect(() => Finding.parse(f)).not.toThrow();
  return actual;
};

describe("golden files", () => {
  it("mixed verdicts: confirmed, needs_validation, rejected", () => {
    const out = check("mixed");
    expect(out.map((f) => f.verdict)).toEqual(["confirmed", "needs_validation", "rejected"]);
    expect(out.map((f) => f.attackClass)).toEqual(["authz", "authn", "other"]);
    expect(out[0]?.location).toEqual({ file: "src/orders/service.ts", line: 42 });
    expect(out[0]?.verifiedSeverity).toBe("high");
    expect(out[1]?.verifiedSeverity).toBeNull();
    expect(out[1]?.blockers).toHaveLength(1);
    expect(out[2]?.rejectionReason).toMatch(/constant/);
  });

  it("legacy verdict words map to canonical verdicts", () => {
    const out = check("legacy-verdicts");
    expect(out.map((f) => f.verdict)).toEqual([
      "confirmed",
      "needs_validation",
      "needs_validation",
      "rejected",
      "rejected",
    ]);
    expect(out.map((f) => f.attackClass)).toEqual(["authz", "config", "crypto", "other", "other"]);
  });

  it("concatenated JSON with provider notices is salvaged and equals the clean case", () => {
    const salvage = salvageFindingsJson(readGolden("concatenated/findings.raw.txt"));
    expect(salvage.salvaged).toBe(true);
    expect(salvage.warnings.length).toBeGreaterThan(0);
    const out = check("concatenated", "findings.raw.txt");
    const clean = normalizeCase("mixed").slice(0, 2);
    expect(out).toEqual(clean);
  });
});
