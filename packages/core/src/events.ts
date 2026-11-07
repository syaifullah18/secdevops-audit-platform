import { z } from "zod";
import { Id, IsoDateTime, Usage } from "./common.js";
import { PhaseName, Verdict, Severity, FindingStatus } from "./enums.js";
import { Fingerprint } from "./finding.js";
import { ModelRef } from "./model.js";
import { GateResult } from "./policy.js";
import { ValidatorStatus } from "./run.js";

/**
 * Events emitted by the worker (and the API for gate/triage events), published on
 * Redis pub/sub channel EVENT_CHANNEL and persisted for replay. Consumers must
 * ignore unknown event types.
 */
export const EVENT_CHANNEL = "sdap:events";

const Envelope = z.object({
  /** Unique event id (idempotency). */
  id: Id,
  runId: Id,
  projectId: Id,
  /** Monotonic per run, for ordering and replay. */
  seq: z.number().int().nonnegative(),
  at: IsoDateTime,
});

const ev = <T extends string, P extends z.ZodRawShape>(type: T, payload: P) =>
  Envelope.extend({ type: z.literal(type), payload: z.object(payload) });

export const RunQueued = ev("run.queued", {});
export const RunStarted = ev("run.started", {
  commitSha: z.string().nullable(),
  skillVersion: z.string(),
});
export const PhaseStarted = ev("phase.started", { phase: PhaseName, sliceCount: z.number().int() });
export const PhaseDone = ev("phase.done", {
  phase: PhaseName,
  status: z.enum(["succeeded", "failed", "skipped"]),
  usage: Usage,
});
export const SliceStarted = ev("slice.started", {
  sliceId: Id,
  phase: PhaseName,
  label: z.string(),
  attempt: z.number().int().positive(),
  model: ModelRef,
});
/** An attempt failed; `nextModel` is the fallback the worker will try, if any. */
export const SliceAttemptFailed = ev("slice.attempt_failed", {
  sliceId: Id,
  attempt: z.number().int().positive(),
  model: ModelRef,
  errorCode: z.string(),
  nextModel: ModelRef.nullable(),
});
export const SliceDone = ev("slice.done", {
  sliceId: Id,
  phase: PhaseName,
  status: z.enum(["succeeded", "failed", "skipped"]),
  model: ModelRef.nullable(),
  usage: Usage,
});
export const ValidatorDone = ev("validator.done", {
  validator: z.enum(["findings", "coverage_ledger"]),
  status: ValidatorStatus,
  errors: z.array(z.string()).max(100).default([]),
});
export const FindingUpserted = ev("finding.upserted", {
  findingId: Id,
  fingerprint: Fingerprint,
  verdict: Verdict,
  verifiedSeverity: Severity.nullable(),
  status: FindingStatus,
  isNew: z.boolean(),
});
export const RunCompleted = ev("run.completed", {
  usage: Usage,
  counts: z.object({
    confirmed: z.number().int().nonnegative(),
    needsValidation: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
  }),
});
export const RunFailed = ev("run.failed", {
  reason: z.string(),
  phase: PhaseName.nullable(),
  willRetry: z.boolean(),
});
export const RunCancelled = ev("run.cancelled", { by: z.string().nullable() });
export const GateEvaluated = ev("gate.evaluated", { result: GateResult });

export const PlatformEvent = z.discriminatedUnion("type", [
  RunQueued,
  RunStarted,
  PhaseStarted,
  PhaseDone,
  SliceStarted,
  SliceAttemptFailed,
  SliceDone,
  ValidatorDone,
  FindingUpserted,
  RunCompleted,
  RunFailed,
  RunCancelled,
  GateEvaluated,
]);
export type PlatformEvent = z.infer<typeof PlatformEvent>;
export type PlatformEventType = PlatformEvent["type"];
export type EventOf<T extends PlatformEventType> = Extract<PlatformEvent, { type: T }>;

/** Sink the worker emits through; implementations publish to Redis and/or persist. */
export interface EventSink {
  emit(event: PlatformEvent): Promise<void>;
}
