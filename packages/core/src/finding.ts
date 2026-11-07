import { z } from "zod";
import { Id, IsoDateTime, RepoPath } from "./common.js";
import { AttackClass, FindingStatus, PhaseName, Role, Severity, Verdict } from "./enums.js";

/** One step of a source trace (skill: trace[].kind entrypoint|propagation|sink). */
export const TraceStep = z.object({
  kind: z.enum(["entrypoint", "propagation", "sink"]),
  file: RepoPath,
  line: z.number().int().positive(),
  scope: z.string().min(1),
  description: z.string().min(1),
});
export type TraceStep = z.infer<typeof TraceStep>;

export const EvidenceItem = z.object({
  file: RepoPath,
  line: z.number().int().positive(),
  description: z.string().min(1),
});
export type EvidenceItem = z.infer<typeof EvidenceItem>;

/** Primary location of a finding: the sink, or the first trace step if there is no sink. */
export const Location = z.object({
  file: RepoPath,
  line: z.number().int().positive(),
  endLine: z.number().int().positive().optional(),
  symbol: z.string().optional(),
});
export type Location = z.infer<typeof Location>;

/** Which model produced a piece of AI output (PRD guardrail: label model and phase). */
export const ModelAttribution = z.object({
  adapter: z.string().min(1),
  model: z.string().min(1),
  version: z.string().optional(),
});
export type ModelAttribution = z.infer<typeof ModelAttribution>;

/** Skill fingerprint format (report-schema.json `fingerprint.pattern`). */
export const Fingerprint = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/);
export type Fingerprint = z.infer<typeof Fingerprint>;

export const Cwe = z.string().regex(/^CWE-\d{1,5}$/);

/** Advisory System 1 (Jev) triage labels shown in the UI. Never used by gates. */
export const TriageSuggestion = z.object({
  severityBand: z.record(Severity, z.number().min(0).max(1)).optional(),
  ownerCandidates: z
    .array(z.object({ owner: z.string(), probability: z.number().min(0).max(1) }))
    .optional(),
  duplicateOf: z
    .array(z.object({ fingerprint: Fingerprint, probability: z.number().min(0).max(1) }))
    .optional(),
  falsePositiveProbability: z.number().min(0).max(1).optional(),
  model: ModelAttribution,
});
export type TriageSuggestion = z.infer<typeof TriageSuggestion>;

const FindingBase = z.object({
  /** Platform id, stable across runs for the same fingerprint within a project. */
  id: Id,
  projectId: Id,
  /** Source-derived identity used for dedup across runs. */
  fingerprint: Fingerprint,
  /** Run that last produced or re-verified this finding. */
  sourceRun: Id,
  /** Run that first produced this finding. */
  firstRun: Id,
  attackClass: AttackClass,
  cwe: Cwe.nullable(),
  title: z.string().min(1),
  description: z.string().min(1),
  rootCause: z.string().min(1).nullable(),
  location: Location,
  trace: z.array(TraceStep).min(1),
  evidence: z.array(EvidenceItem).min(1),
  verdict: Verdict,
  /** Hunter (pre-verification) severity, kept for audit. */
  originalSeverity: Severity.nullable(),
  /** Verified severity. The only severity gates and the UI headline use. */
  verifiedSeverity: Severity.nullable(),
  confidence: z.enum(["low", "medium", "high"]).nullable(),
  status: FindingStatus,
  owner: z.string().nullable(),
  firstSeen: IsoDateTime,
  lastSeen: IsoDateTime,
  slaDue: IsoDateTime.nullable(),
  /** Model that produced the final record. */
  model: ModelAttribution,
  /** Pipeline phase that produced the final record. */
  phase: PhaseName,
  /** needs_validation: the exact unresolved facts blocking a decision. */
  blockers: z.array(z.string().min(1)).default([]),
  /** rejected: why the candidate was disproved. */
  rejectionReason: z.string().nullable(),
  remediation: z
    .object({
      strategy: z.string().min(1),
      /** Draft only, for human review (PRD guardrail). */
      codeChanges: z.array(z.object({ file: RepoPath, fixedCode: z.string() })).default([]),
    })
    .nullable(),
  triageSuggestion: TriageSuggestion.nullable(),
  /** Root-cause cluster key, when grouping has run. */
  rootCauseGroup: z.string().nullable(),
});

/**
 * A finding in the unified store. Verdict-specific invariants:
 * - confirmed: has a verifiedSeverity.
 * - needs_validation: has no verifiedSeverity and at least one blocker.
 * - rejected: has a rejectionReason and no verifiedSeverity.
 */
export const Finding = FindingBase.superRefine((f, ctx) => {
  if (f.verdict === "confirmed" && f.verifiedSeverity === null) {
    ctx.addIssue({
      code: "custom",
      path: ["verifiedSeverity"],
      message: "confirmed requires verifiedSeverity",
    });
  }
  if (f.verdict === "needs_validation") {
    if (f.verifiedSeverity !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["verifiedSeverity"],
        message: "needs_validation has no severity",
      });
    }
    if (f.blockers.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["blockers"],
        message: "needs_validation requires blockers",
      });
    }
  }
  if (f.verdict === "rejected") {
    if (f.rejectionReason === null) {
      ctx.addIssue({
        code: "custom",
        path: ["rejectionReason"],
        message: "rejected requires a reason",
      });
    }
    if (f.verifiedSeverity !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["verifiedSeverity"],
        message: "rejected has no severity",
      });
    }
  }
});
export type Finding = z.infer<typeof Finding>;
export const FindingShape = FindingBase;

/** One entry of a finding's triage history (audit log). */
export const TriageEvent = z.object({
  id: Id,
  findingId: Id,
  from: FindingStatus,
  to: FindingStatus,
  actor: z.object({ subject: z.string().min(1), role: Role }),
  reason: z.string().nullable(),
  at: IsoDateTime,
});
export type TriageEvent = z.infer<typeof TriageEvent>;

/**
 * Allowed manual triage transitions. `fixed` is set by fix verification (System 2),
 * not by hand, so it is not reachable here except from `in_progress` by Security/Admin.
 */
export const TRIAGE_TRANSITIONS: Readonly<Record<FindingStatus, readonly FindingStatus[]>> = {
  new: ["confirmed", "in_progress", "accepted_risk", "false_positive"],
  confirmed: ["in_progress", "accepted_risk", "false_positive"],
  in_progress: ["confirmed", "fixed", "accepted_risk", "false_positive"],
  fixed: ["confirmed"],
  accepted_risk: ["confirmed"],
  false_positive: ["confirmed"],
};

export const canTransition = (from: FindingStatus, to: FindingStatus): boolean =>
  TRIAGE_TRANSITIONS[from].includes(to);
