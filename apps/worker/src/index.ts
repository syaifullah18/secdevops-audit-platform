/**
 * @sdap/worker: BullMQ audit worker: runs the security-audit-skill phases with model fallback.
 * Owned by workstream WS1.
 */

export const PACKAGE_NAME = "@sdap/worker";

export { WorkerConfig, parseWorkerConfig } from "./config.js";
export {
  AgentCliAdapter,
  InMemoryAdapterRegistry,
  mapCliFailureToErrorCode,
  type AgentCliAdapterOptions,
} from "./agent-adapter.js";
export {
  RedisEventSink,
  StoreEventSink,
  CompositeEventSink,
  MemoryEventSink,
  EventSequencer,
  type EventSequencerOptions,
} from "./events.js";
export { ValidationService, type ValidationResult } from "./validator.js";
export {
  resolveRouteCandidates,
  executeSliceWithFallback,
  type ExecuteSliceOptions,
  type ExecuteSliceResult,
} from "./router.js";
export { createDefaultImportFindings } from "./normalizer-hook.js";
export { AuditPipeline, type AuditPipelineDependencies } from "./pipeline.js";
export { createAuditWorker, type AuditWorkerOptions, type AuditWorkerInstance } from "./worker.js";
export type {
  CancellationToken,
  ImportFindingsFn,
  IsCancelledFn,
  PhaseExecutionResult,
  PipelineExecutionOptions,
} from "./types.js";
