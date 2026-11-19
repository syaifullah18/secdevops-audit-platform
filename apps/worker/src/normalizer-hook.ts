import fs from "node:fs/promises";
import path from "node:path";
import type { Finding, ModelAttribution, Project, Run, Store } from "@sdap/core";
import { CoverageLedger, normalizeRun, parseRawFindings } from "@sdap/normalizer";
import type { ImportFindingsFn } from "./types.js";

const readJson = async (file: string): Promise<unknown | undefined> => {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return undefined;
  }
};

/** The model that produced the final records: the last successful validation attempt. */
async function validatorModel(store: Store, runId: string): Promise<ModelAttribution> {
  const slices = await store.runs.listSlices(runId);
  for (const s of slices.filter((x) => x.phase === "validate").reverse()) {
    const ok = [...s.attempts].reverse().find((a) => a.status === "succeeded");
    if (ok) return { adapter: ok.model.adapter, model: ok.model.model };
  }
  return { adapter: "unknown", model: "unknown" };
}

/**
 * Loads the artefacts the agent wrote (findings.json, coverage-ledger.json) with the same
 * normaliser the API import route uses: attack class, CWE, severity, SLA and fingerprints come
 * from the skill's records, not from defaults. A file that does not parse imports nothing and
 * throws, so the run fails instead of reporting a clean result.
 */
export function createDefaultImportFindings(store: Store): ImportFindingsFn {
  return async (run: Run, artefactDir: string) => {
    const rawFindings = await readJson(path.join(artefactDir, "findings.json"));
    if (rawFindings === undefined) throw new Error("findings.json is missing or not valid JSON");
    const raw = parseRawFindings(rawFindings);

    const ledgerJson = await readJson(path.join(artefactDir, "coverage-ledger.json"));
    const ledgerParsed = ledgerJson === undefined ? null : CoverageLedger.safeParse(ledgerJson);
    const ledger = ledgerParsed?.success ? ledgerParsed.data : [];

    const project = await store.projects.get(run.projectId, { clientIds: "*" });
    if (!project) throw new Error(`Project not found: ${run.projectId}`);

    const findings: Finding[] = normalizeRun({
      findings: raw,
      ledger,
      run,
      project: project as Pick<Project, "id">,
      model: await validatorModel(store, run.id),
      now: new Date(),
    });
    const results: Array<{ finding: Finding; isNew: boolean }> = [];
    for (const f of findings) results.push(await store.findings.upsert(f));
    return results;
  };
}
