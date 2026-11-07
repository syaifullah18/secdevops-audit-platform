import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Finding } from "@sdap/core";
import {
  CoverageLedger,
  normalizeRun,
  parseRawFindings,
  salvageFindingsJson,
  type NormalizeRunInput,
} from "../src/index.js";

export const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), "golden");

export const PROJECT_ID = "00000000-0000-4000-8000-0000000000aa";
export const RUN_1 = "00000000-0000-4000-8000-0000000000b1";
export const RUN_2 = "00000000-0000-4000-8000-0000000000b2";
export const NOW_1 = "2026-11-01T00:00:00.000Z";
export const NOW_2 = "2026-11-08T00:00:00.000Z";

export const readGolden = (path: string): string => readFileSync(join(GOLDEN_DIR, path), "utf8");

export const loadCase = (name: string, findingsFile = "findings.json") => {
  const findings = parseRawFindings(
    salvageFindingsJson(readGolden(`${name}/${findingsFile}`)).value,
  );
  const ledger = CoverageLedger.parse(JSON.parse(readGolden(`${name}/coverage-ledger.json`)));
  return { findings, ledger };
};

export const normalizeCase = (
  name: string,
  overrides: Partial<NormalizeRunInput> = {},
  findingsFile = "findings.json",
): Finding[] => {
  const { findings, ledger } = loadCase(name, findingsFile);
  return normalizeRun({
    findings,
    ledger,
    run: { id: RUN_1 },
    project: { id: PROJECT_ID },
    model: { adapter: "mock", model: "mock-1" },
    now: NOW_1,
    ...overrides,
  });
};
