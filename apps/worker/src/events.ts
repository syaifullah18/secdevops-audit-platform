import crypto from "node:crypto";
import {
  EVENT_CHANNEL,
  type EventOf,
  type EventSink,
  type FindingStatus,
  type Id,
  type ModelRef,
  type PhaseName,
  PlatformEvent,
  type PlatformEventType,
  type Severity,
  type Store,
  type Usage,
  type ValidatorStatus,
  type Verdict,
} from "@sdap/core";
import type { Redis } from "ioredis";

export class RedisEventSink implements EventSink {
  constructor(
    private readonly redis: Redis,
    private readonly channel: string = EVENT_CHANNEL,
  ) {}

  async emit(event: PlatformEvent): Promise<void> {
    await this.redis.publish(this.channel, JSON.stringify(event));
  }
}

export class StoreEventSink implements EventSink {
  constructor(private readonly store: Store) {}

  async emit(event: PlatformEvent): Promise<void> {
    await this.store.events.append(event);
  }
}

export class CompositeEventSink implements EventSink {
  private readonly sinks: readonly EventSink[];

  constructor(sinks: readonly EventSink[]) {
    this.sinks = sinks;
  }

  async emit(event: PlatformEvent): Promise<void> {
    for (const sink of this.sinks) {
      await sink.emit(event);
    }
  }
}

export class MemoryEventSink implements EventSink {
  readonly events: PlatformEvent[] = [];

  async emit(event: PlatformEvent): Promise<void> {
    this.events.push(event);
  }

  getEvents(): readonly PlatformEvent[] {
    return [...this.events];
  }

  getEventsByType<T extends PlatformEventType>(type: T): Array<EventOf<T>> {
    return this.events.filter((e): e is EventOf<T> => e.type === type);
  }

  clear(): void {
    this.events.length = 0;
  }
}

export interface EventSequencerOptions {
  runId: Id;
  projectId: Id;
  sink: EventSink;
  initialSeq?: number;
}

export class EventSequencer {
  readonly runId: Id;
  readonly projectId: Id;
  private readonly sink: EventSink;
  private seq: number;

  constructor(options: EventSequencerOptions) {
    this.runId = options.runId;
    this.projectId = options.projectId;
    this.sink = options.sink;
    this.seq = options.initialSeq ?? 0;
  }

  currentSeq(): number {
    return this.seq;
  }

  private async emitRaw<T extends PlatformEventType>(
    type: T,
    payload: EventOf<T>["payload"],
  ): Promise<EventOf<T>> {
    const rawEnvelope = {
      id: crypto.randomUUID(),
      runId: this.runId,
      projectId: this.projectId,
      seq: this.seq++,
      at: new Date().toISOString(),
      type,
      payload,
    };

    const parsed = PlatformEvent.parse(rawEnvelope) as EventOf<T>;
    await this.sink.emit(parsed);
    return parsed;
  }

  async emitRunStarted(params: { commitSha: string | null; skillVersion: string }): Promise<void> {
    await this.emitRaw("run.started", params);
  }

  async emitPhaseStarted(params: { phase: PhaseName; sliceCount: number }): Promise<void> {
    await this.emitRaw("phase.started", params);
  }

  async emitPhaseDone(params: {
    phase: PhaseName;
    status: "succeeded" | "failed" | "skipped";
    usage: Usage;
  }): Promise<void> {
    await this.emitRaw("phase.done", params);
  }

  async emitSliceStarted(params: {
    sliceId: Id;
    phase: PhaseName;
    label: string;
    attempt: number;
    model: ModelRef;
  }): Promise<void> {
    await this.emitRaw("slice.started", params);
  }

  async emitSliceAttemptFailed(params: {
    sliceId: Id;
    attempt: number;
    model: ModelRef;
    errorCode: string;
    nextModel: ModelRef | null;
  }): Promise<void> {
    await this.emitRaw("slice.attempt_failed", params);
  }

  async emitSliceDone(params: {
    sliceId: Id;
    phase: PhaseName;
    status: "succeeded" | "failed" | "skipped";
    model: ModelRef | null;
    usage: Usage;
  }): Promise<void> {
    await this.emitRaw("slice.done", params);
  }

  async emitValidatorDone(params: {
    validator: "findings" | "coverage_ledger";
    status: ValidatorStatus;
    errors?: string[];
  }): Promise<void> {
    await this.emitRaw("validator.done", {
      validator: params.validator,
      status: params.status,
      errors: params.errors ?? [],
    });
  }

  async emitFindingUpserted(params: {
    findingId: Id;
    fingerprint: string;
    verdict: Verdict;
    verifiedSeverity: Severity | null;
    status: FindingStatus;
    isNew: boolean;
  }): Promise<void> {
    await this.emitRaw("finding.upserted", params);
  }

  async emitRunCompleted(params: {
    usage: Usage;
    counts: {
      confirmed: number;
      needsValidation: number;
      rejected: number;
    };
  }): Promise<void> {
    await this.emitRaw("run.completed", params);
  }

  async emitRunFailed(params: {
    reason: string;
    phase: PhaseName | null;
    willRetry: boolean;
  }): Promise<void> {
    await this.emitRaw("run.failed", params);
  }

  async emitRunCancelled(params: { by: string | null }): Promise<void> {
    await this.emitRaw("run.cancelled", params);
  }
}
