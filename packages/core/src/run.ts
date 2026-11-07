import { z } from "zod";
import { Id, IsoDateTime, RepoPath, Usage } from "./common.js";
import { AttackClass, AuditMode, PhaseName, RunStatus, TriggerKind, WorkStatus } from "./enums.js";
import { ModelRef } from "./model.js";

export const Trigger = z.object({
  kind: TriggerKind,
  /** OIDC subject or CI identity that started the run. */
  actor: z.string().nullable(),
  /** Free-form source reference, e.g. a PR URL or schedule id. */
  ref: z.string().nullable(),
});
export type Trigger = z.infer<typeof Trigger>;

/** Scope controls (PRD 5.1). */
export const RunScope = z.object({
  /** Target paths; empty means the whole repository. */
  paths: z.array(RepoPath).default([]),
  /** Attack classes to include; empty means all applicable. */
  attackClasses: z.array(AttackClass).default([]),
  maxRuntimeSec: z
    .number()
    .int()
    .positive()
    .default(4 * 60 * 60),
  /** Token budget across all phases; null means the project/team default. */
  tokenBudget: z.number().int().positive().nullable().default(null),
});
export type RunScope = z.infer<typeof RunScope>;

/** One attempt of a slice on a specific model (fallback chain, per-attempt log). */
export const SliceAttempt = z.object({
  attempt: z.number().int().positive(),
  model: ModelRef,
  status: WorkStatus,
  startedAt: IsoDateTime,
  endedAt: IsoDateTime.nullable(),
  /** Machine-readable failure, e.g. a ModelErrorCode or "invalid_output". */
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  usage: Usage,
  /** Object-store key of the raw attempt log. */
  logKey: z.string().nullable(),
});
export type SliceAttempt = z.infer<typeof SliceAttempt>;

/** A unit of parallel work inside a phase (a hunter, a verifier, ...). Resumable. */
export const Slice = z.object({
  id: Id,
  runId: Id,
  phase: PhaseName,
  /** Human label, e.g. "authz/api-module". */
  label: z.string().min(1),
  attackClass: AttackClass.nullable(),
  /** Coverage-ledger unit ids this slice owns. */
  coverageIds: z.array(z.string()).default([]),
  paths: z.array(RepoPath).default([]),
  status: WorkStatus,
  attempts: z.array(SliceAttempt).default([]),
  startedAt: IsoDateTime.nullable(),
  endedAt: IsoDateTime.nullable(),
});
export type Slice = z.infer<typeof Slice>;

export const RunPhase = z.object({
  runId: Id,
  name: PhaseName,
  status: WorkStatus,
  startedAt: IsoDateTime.nullable(),
  endedAt: IsoDateTime.nullable(),
  sliceCount: z.number().int().nonnegative().default(0),
  slicesDone: z.number().int().nonnegative().default(0),
  usage: Usage,
});
export type RunPhase = z.infer<typeof RunPhase>;

export const ValidatorStatus = z.enum(["pending", "passed", "failed"]);
export type ValidatorStatus = z.infer<typeof ValidatorStatus>;

/** Object-store keys of the skill's artefacts. */
export const RunArtifacts = z.object({
  findingsJson: z.string().nullable(),
  coverageLedgerJson: z.string().nullable(),
  architectureMd: z.string().nullable(),
  reportMd: z.string().nullable(),
  findingsDetailMd: z.string().nullable(),
  needsValidationMd: z.string().nullable(),
});
export type RunArtifacts = z.infer<typeof RunArtifacts>;

export const Run = z.object({
  id: Id,
  projectId: Id,
  mode: AuditMode,
  /** repeat-N: number of independent runs merged (full mode only; 1 otherwise). */
  repeat: z.number().int().min(1).max(10).default(1),
  trigger: Trigger,
  /** Git ref requested and the resolved commit. */
  ref: z.string().min(1),
  commitSha: z
    .string()
    .regex(/^[0-9a-f]{7,64}$/)
    .nullable(),
  /** focused: commit of the previous run used as the diff base. */
  baseCommitSha: z
    .string()
    .regex(/^[0-9a-f]{7,64}$/)
    .nullable(),
  previousRunId: Id.nullable(),
  scope: RunScope,
  status: RunStatus,
  phases: z.array(RunPhase).default([]),
  validators: z.object({ findings: ValidatorStatus, coverageLedger: ValidatorStatus }),
  /** Pinned security-audit-skill commit used for this run. */
  skillVersion: z.string().min(7),
  usage: Usage,
  artifacts: RunArtifacts,
  /**
   * Why a run failed. A failed or invalid run is never reported as clean (PRD 7).
   */
  failureReason: z.string().nullable(),
  /** Number of automatic retries already used for the run as a whole. */
  retries: z.number().int().nonnegative().default(0),
  createdAt: IsoDateTime,
  startedAt: IsoDateTime.nullable(),
  endedAt: IsoDateTime.nullable(),
});
export type Run = z.infer<typeof Run>;

/** Job payload placed on the BullMQ queue by the API and consumed by the worker. */
export const RunJob = z.object({
  runId: Id,
  projectId: Id,
  /** Resume from the persisted slice state instead of starting over. */
  resume: z.boolean().default(false),
});
export type RunJob = z.infer<typeof RunJob>;

export const QUEUE_NAMES = {
  runs: "sdap-runs",
} as const;
