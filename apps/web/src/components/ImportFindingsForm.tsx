import { useState, type FormEvent } from "react";
import type { Project } from "@sdap/core";
import { api, type ImportResult } from "../api/client.js";
import { FormError, Notice, errMsg } from "./Field.js";
import { btn } from "./stitch.js";

const readJson = async (file: File, label: string): Promise<unknown> => {
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
};

/** Loads the security-audit-skill output (findings.json, coverage-ledger.json) into a project. */
export function ImportFindingsForm({
  project,
  onDone,
  onCancel,
}: {
  project: Project;
  onDone: (r: ImportResult) => void;
  onCancel: () => void;
}) {
  const [findings, setFindings] = useState<File | null>(null);
  const [ledger, setLedger] = useState<File | null>(null);
  const [ref, setRef] = useState(project.defaultBranch);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!findings) return;
    setError(null);
    setBusy(true);
    try {
      const body = {
        findings: await readJson(findings, "findings.json"),
        ...(ledger ? { coverageLedger: await readJson(ledger, "coverage-ledger.json") } : {}),
        ref: ref.trim() || project.defaultBranch,
      };
      const r = await api.importFindings(project.id, body);
      setResult(r);
      onDone(r);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const fileCls =
    "text-xs file:mr-3 file:rounded-md file:border file:border-outline-variant/60 file:bg-surface-container-lowest file:px-3 file:py-1.5 file:text-xs file:font-medium";

  return (
    <form
      onSubmit={submit}
      aria-label="Import findings"
      data-testid="import-findings-form"
      className="rounded-lg border border-outline-variant/60 bg-surface-container-lowest shadow-sm p-5 flex flex-col gap-4"
    >
      <p className="text-xs text-on-surface-variant">
        Load the output of an audit that ran elsewhere. Importing the same file again updates
        findings by fingerprint and keeps their triage status.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="import-findings" className="text-xs font-medium text-on-surface-variant">
            findings.json
          </label>
          <input
            id="import-findings"
            type="file"
            accept="application/json,.json"
            className={fileCls}
            onChange={(e) => setFindings(e.target.files?.[0] ?? null)}
            data-testid="import-findings-file"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="import-ledger" className="text-xs font-medium text-on-surface-variant">
            coverage-ledger.json <span className="font-normal">(optional)</span>
          </label>
          <input
            id="import-ledger"
            type="file"
            accept="application/json,.json"
            className={fileCls}
            onChange={(e) => setLedger(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="import-ref" className="text-xs font-medium text-on-surface-variant">
            Git ref that was audited
          </label>
          <input
            id="import-ref"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            className="w-full rounded-md border border-outline-variant/60 bg-surface-container-lowest px-3 py-2 text-sm"
          />
        </div>
      </div>
      <FormError message={error} />
      {result && (
        <Notice>
          Imported {result.imported} findings ({result.created} new, {result.updated} updated).
        </Notice>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          className={btn.primary}
          disabled={busy || !findings}
          data-testid="import-findings-submit"
        >
          {busy ? "Importing…" : "Import"}
        </button>
        <button type="button" className={btn.secondary} onClick={onCancel}>
          {result ? "Close" : "Cancel"}
        </button>
      </div>
    </form>
  );
}
