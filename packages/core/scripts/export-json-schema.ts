/**
 * Exports the core Zod contracts as JSON Schema into packages/core/schema/.
 * Run: pnpm --filter @sdap/core schema
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import * as core from "../src/index.js";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "schema");

export const EXPORTED: Record<string, z.ZodType> = {
  Finding: core.Finding,
  TriageEvent: core.TriageEvent,
  Run: core.Run,
  RunJob: core.RunJob,
  RunPhase: core.RunPhase,
  Slice: core.Slice,
  Project: core.Project,
  Policy: core.Policy,
  Exception: core.Exception,
  GateResult: core.GateResult,
  ModelRoute: core.ModelRoute,
  JevQuestion: core.JevQuestion,
  JevDecision: core.JevDecision,
  PlatformEvent: core.PlatformEvent,
  CreateRunRequest: core.CreateRunRequest,
  FindingQuery: core.FindingQuery,
  TriageRequest: core.TriageRequest,
  SandboxPolicy: core.SandboxPolicy,
};

export const toJsonSchemas = (): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(EXPORTED).map(([name, schema]) => [
      name,
      z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }),
    ]),
  );

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(outDir, { recursive: true });
  for (const [name, schema] of Object.entries(toJsonSchemas())) {
    writeFileSync(join(outDir, `${name}.schema.json`), JSON.stringify(schema, null, 2) + "\n");
  }
  console.log(`wrote ${Object.keys(EXPORTED).length} schemas to ${outDir}`);
}
