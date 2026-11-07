import { Fingerprint, Severity } from "@sdap/core";
import { z } from "zod";
import { mapVerdict } from "./verdict.js";

/**
 * Zod mirror of the skill's report-schema.json (findings.json) and of the unit
 * fields in validate-coverage-ledger.cjs. Unknown extra fields are stripped, not
 * rejected: strict structure checking is the skill validator's job.
 */

const Text = z.string().min(1);

export const RawTraceStep = z.object({
  kind: z.enum(["entrypoint", "propagation", "sink"]),
  file: Text,
  line: z.number().int().positive(),
  scope: Text,
  description: Text,
});
export type RawTraceStep = z.infer<typeof RawTraceStep>;

export const RawEvidence = z.object({
  file: Text,
  line: z.number().int().positive(),
  description: Text,
});
export type RawEvidence = z.infer<typeof RawEvidence>;

export const RawCondition = z.object({
  kind: z.enum([
    "authentication_level",
    "authorization_role",
    "user_interaction",
    "system_configuration",
    "network_routing",
    "environmental_dependency",
    "data_state",
    "timing_dependency",
    "third_party_dependency",
  ]),
  description: Text,
});

const Scored = z.object({ score: Severity, reason: Text });

export const RawSeverity = z.object({
  likelihood: Scored,
  impact: Scored,
  overall_severity: Severity,
});
export type RawSeverity = z.infer<typeof RawSeverity>;

export const RawRemediation = z.object({
  strategy: Text,
  code_changes: z.array(z.object({ file_name: Text, fixed_code: z.string() })).default([]),
});

const RawExecution = z.object({
  attacker_perspective: Text,
  payloads: z.array(z.string()).min(1),
  instructions: z.array(Text).min(1),
  observed_result: Text,
});

const common = {
  fingerprint: Fingerprint,
  title: Text,
  description: Text,
  trace: z.array(RawTraceStep).min(1),
  evidence: z.array(RawEvidence).min(1),
};

export const RawConfirmed = z.object({
  ...common,
  verdict: z.literal("confirmed"),
  root_cause: Text,
  intended_behavior: Text,
  conditions: z.array(RawCondition).default([]),
  execution: RawExecution,
  remediation: RawRemediation,
  severity: RawSeverity,
  confidence: z.object({ score: z.enum(["low", "medium", "high"]), reason: Text }),
});
export type RawConfirmed = z.infer<typeof RawConfirmed>;

export const RawNeedsValidation = z.object({
  ...common,
  verdict: z.literal("needs_validation"),
  claimed_root_cause: Text,
  blockers: z.array(Text).min(1),
  validation_plan: z.object({ local: Text.optional(), deployment: Text.optional() }),
});
export type RawNeedsValidation = z.infer<typeof RawNeedsValidation>;

export const RawRejected = z.object({
  ...common,
  verdict: z.literal("rejected"),
  claimed_root_cause: Text,
  reason: Text,
});
export type RawRejected = z.infer<typeof RawRejected>;

/** One entry of findings.json, with the verdict already canonical. */
export const RawFinding = z.discriminatedUnion("verdict", [
  RawConfirmed,
  RawNeedsValidation,
  RawRejected,
]);
export type RawFinding = z.infer<typeof RawFinding>;

export class RawFindingsError extends Error {
  constructor(
    message: string,
    readonly issues: readonly { index: number; message: string }[],
  ) {
    super(message);
    this.name = "RawFindingsError";
  }
}

/**
 * Parse a findings.json array. Legacy verdict words (PLAUSIBLE, REFUTED, ...) are
 * mapped to canonical verdicts first. Any invalid entry fails the whole file with
 * an indexed issue list: a partly-read run must never look complete.
 */
export const parseRawFindings = (input: unknown): RawFinding[] => {
  if (!Array.isArray(input)) {
    throw new RawFindingsError("findings.json must be a JSON array", []);
  }
  const out: RawFinding[] = [];
  const issues: { index: number; message: string }[] = [];
  input.forEach((entry: unknown, index) => {
    try {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        throw new Error("expected an object");
      }
      const verdict = mapVerdict((entry as { verdict?: unknown }).verdict);
      const parsed = RawFinding.safeParse({ ...entry, verdict });
      if (!parsed.success) {
        throw new Error(
          parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; "),
        );
      }
      out.push(parsed.data);
    } catch (e) {
      issues.push({ index, message: e instanceof Error ? e.message : String(e) });
    }
  });
  if (issues.length > 0) {
    throw new RawFindingsError(
      `findings.json has ${issues.length} invalid entr${issues.length === 1 ? "y" : "ies"}: ` +
        issues
          .slice(0, 5)
          .map((i) => `[${i.index}] ${i.message}`)
          .join(" | "),
      issues,
    );
  }
  return out;
};

// ---- coverage ledger ----------------------------------------------------

export const LedgerStatus = z.enum([
  "planned",
  "not_applicable",
  "out_of_scope",
  "in_progress",
  "covered",
  "candidate",
  "blocked",
  "deferred",
]);

export const LedgerPriorStatus = z.enum([
  "new",
  "prior_confirmed_same_source",
  "prior_confirmed_changed_source",
  "prior_needs_validation",
  "prior_deferred",
  "prior_blocked",
  "prior_out_of_scope",
  "prior_covered_same_source",
  "prior_covered_changed_source",
  "prior_rejected_claim_changed",
  "none",
]);

const LocalCheck = z.object({
  agent_id: Text,
  reviewed_paths: z.array(Text),
  invariant: Text,
  method: z.enum(["source", "local"]),
  result: Text,
  artifact: z.string().nullable(),
});

export const LedgerUnit = z.object({
  coverage_id: Text,
  canonical_refs: z.object({
    surface: Text,
    boundary: Text,
    subsystem: Text,
    attack_class: Text,
    lifecycle: Text.optional(),
  }),
  surface: Text,
  boundary: Text,
  subsystem: Text,
  attack_class: Text,
  lifecycle: Text.optional(),
  starting_paths: z.array(Text),
  ordinary_attack_class_block: z.string().nullable(),
  selected_companion_blocks: z.array(Text),
  excluded_blocks: z.array(z.object({ block: Text, reason: Text })),
  prior_status: LedgerPriorStatus,
  /** Archived earlier attempts; opaque to the platform. */
  attempts: z.array(z.record(z.string(), z.unknown())),
  wave: z.number().int().positive(),
  status: LedgerStatus,
  agent_id: z.string().nullable(),
  reviewed_paths: z.array(Text),
  local_checks: z.array(LocalCheck),
  result_fingerprints: z.array(Fingerprint),
  unresolved: z.array(Text),
});
export type LedgerUnit = z.infer<typeof LedgerUnit>;

export const CoverageLedger = z.array(LedgerUnit);
export type CoverageLedger = z.infer<typeof CoverageLedger>;
