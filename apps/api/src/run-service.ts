import { type CreateRunRequest, type PlatformEvent, Run, type Store } from "@sdap/core";
import { ServiceUnavailableError } from "./errors.js";
import type { Queue } from "./queue.js";

export interface QueueRunInput {
  projectId: string;
  mode: Run["mode"];
  repeat: number;
  ref: string;
  commitSha: string | null;
  scope: Partial<NonNullable<CreateRunRequest["scope"]>>;
  trigger: { kind: Run["trigger"]["kind"]; actor: string | null; ref: string | null };
}

export interface RunServiceDeps {
  store: Store;
  queue: Queue;
  skillVersion: string;
}

/**
 * Creates a `queued` run, records its `run.queued` event and enqueues the job.
 * If the queue is unreachable the run is marked failed (never left "queued" forever) and
 * the caller gets a 503.
 */
export const queueRun = async (deps: RunServiceDeps, input: QueueRunInput): Promise<Run> => {
  const { store, queue, skillVersion } = deps;
  const latest =
    input.mode === "focused" ? await store.runs.latestSucceeded(input.projectId) : null;
  const now = new Date().toISOString();

  const run = Run.parse({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    mode: input.mode,
    repeat: input.repeat,
    trigger: input.trigger,
    ref: input.ref,
    commitSha: input.commitSha,
    baseCommitSha: latest?.commitSha ?? null,
    previousRunId: latest?.id ?? null,
    scope: input.scope,
    status: "queued",
    validators: { findings: "pending", coverageLedger: "pending" },
    skillVersion,
    usage: {},
    artifacts: {
      findingsJson: null,
      coverageLedgerJson: null,
      architectureMd: null,
      reportMd: null,
      findingsDetailMd: null,
      needsValidationMd: null,
    },
    failureReason: null,
    createdAt: now,
    startedAt: null,
    endedAt: null,
  });

  const queued: PlatformEvent = {
    id: crypto.randomUUID(),
    runId: run.id,
    projectId: run.projectId,
    seq: 0,
    at: now,
    type: "run.queued",
    payload: {},
  };
  await store.tx(async (tx) => {
    await tx.runs.create(run);
    await tx.events.append(queued);
  });

  try {
    await queue.enqueue({ runId: run.id, projectId: run.projectId, resume: false });
  } catch {
    await store.runs.update(run.id, {
      status: "failed",
      failureReason: "enqueue_failed",
      endedAt: new Date().toISOString(),
    });
    throw new ServiceUnavailableError("Run queue is unavailable; the run was not started");
  }
  return run;
};
