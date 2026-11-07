import {
  computeSlaDue,
  DEFAULT_SLA_DAYS,
  Finding,
  type ModelAttribution,
  type PhaseName,
  type Project,
  type Run,
  type Severity,
  type SlaDays,
} from "@sdap/core";
import { attackClassFor } from "./attack-class.js";
import { deterministicFindingId } from "./fingerprint.js";
import type { LedgerUnit, RawFinding } from "./schemas.js";

export interface NormalizeRunInput {
  /** Parsed findings.json (see parseRawFindings). */
  findings: readonly RawFinding[];
  /** Parsed coverage-ledger.json units; may be empty. */
  ledger: readonly LedgerUnit[];
  run: Pick<Run, "id">;
  project: Pick<Project, "id">;
  /** Model that produced the final records. */
  model: ModelAttribution;
  now: Date | string;
  slaDays?: SlaDays;
  /** Hunter (pre-verification) severity by fingerprint, when the hunt output is available. */
  hunterSeverities?: Readonly<Record<string, Severity>>;
  /** Phase that produced the records; defaults to `record_verify`. */
  phase?: PhaseName;
  /** Id factory; defaults to a deterministic id from (project, fingerprint). */
  newId?: (projectId: string, fingerprint: string) => string;
}

const iso = (d: Date | string): string => (typeof d === "string" ? new Date(d) : d).toISOString();

/**
 * Convert validated skill output into core `Finding`s. All findings start with
 * status `new`; triage is a separate, human step. Every result is checked with
 * `Finding.parse`, so an invariant violation throws instead of being stored.
 */
export const normalizeRun = (input: NormalizeRunInput): Finding[] => {
  const now = iso(input.now);
  const slaDays = input.slaDays ?? DEFAULT_SLA_DAYS;
  const newId = input.newId ?? deterministicFindingId;
  const seen = new Set<string>();

  return input.findings.map((raw) => {
    if (seen.has(raw.fingerprint)) {
      throw new Error(`duplicate fingerprint in one findings.json: ${raw.fingerprint}`);
    }
    seen.add(raw.fingerprint);

    const sink = raw.trace.find((s) => s.kind === "sink") ?? raw.trace[0];
    if (!sink) throw new Error(`finding ${raw.fingerprint} has an empty trace`);

    const verifiedSeverity = raw.verdict === "confirmed" ? raw.severity.overall_severity : null;
    const base = {
      id: newId(input.project.id, raw.fingerprint),
      projectId: input.project.id,
      fingerprint: raw.fingerprint,
      sourceRun: input.run.id,
      firstRun: input.run.id,
      attackClass: attackClassFor(raw.fingerprint, input.ledger),
      cwe: null,
      title: raw.title,
      description: raw.description,
      location: { file: sink.file, line: sink.line },
      trace: raw.trace.map((s) => ({ ...s })),
      evidence: raw.evidence.map((e) => ({ ...e })),
      verdict: raw.verdict,
      originalSeverity: input.hunterSeverities?.[raw.fingerprint] ?? null,
      verifiedSeverity,
      status: "new" as const,
      owner: null,
      firstSeen: now,
      lastSeen: now,
      slaDue: computeSlaDue(verifiedSeverity, now, slaDays),
      model: input.model,
      phase: input.phase ?? ("record_verify" as const),
      triageSuggestion: null,
      rootCauseGroup: null,
    };

    switch (raw.verdict) {
      case "confirmed":
        return Finding.parse({
          ...base,
          rootCause: raw.root_cause,
          confidence: raw.confidence.score,
          blockers: [],
          rejectionReason: null,
          remediation: {
            strategy: raw.remediation.strategy,
            codeChanges: raw.remediation.code_changes.map((c) => ({
              file: c.file_name,
              fixedCode: c.fixed_code,
            })),
          },
        });
      case "needs_validation":
        return Finding.parse({
          ...base,
          rootCause: raw.claimed_root_cause,
          confidence: null,
          blockers: raw.blockers,
          rejectionReason: null,
          remediation: null,
        });
      case "rejected":
        return Finding.parse({
          ...base,
          rootCause: raw.claimed_root_cause,
          confidence: null,
          blockers: [],
          rejectionReason: raw.reason,
          remediation: null,
        });
    }
  });
};
