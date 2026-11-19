import {
  type AdapterRegistry,
  type ModelRoute,
  QUEUE_NAMES,
  type Run,
  RunJob,
  type SandboxRunner,
  type Store,
} from "@sdap/core";
import { type ConnectionOptions, type Job, Worker } from "bullmq";
import { parseWorkerConfig, type WorkerConfig } from "./config.js";
import type { ImportFindingsFn } from "./types.js";
import { AuditPipeline } from "./pipeline.js";
import type { SdapMetrics } from "./metrics.js";
import { recordRunMetrics } from "./record.js";

export interface AuditWorkerOptions {
  config?: WorkerConfig;
  store: Store;
  sandboxRunner: SandboxRunner;
  adapterRegistry: AdapterRegistry;
  importFindings?: ImportFindingsFn;
  routes?: ModelRoute[];
  connection?: ConnectionOptions;
  /** When set, every finished run is recorded here (served at the worker's /metrics). */
  metrics?: SdapMetrics;
}

export interface AuditWorkerInstance {
  worker: Worker | null;
  pipeline: AuditPipeline;
  processJob: (
    data: unknown,
    opts?: {
      targetDir?: string;
      outputDir?: string;
      isCancelled?: () => Promise<boolean> | boolean;
    },
  ) => Promise<Run>;
  close: () => Promise<void>;
}

export function createAuditWorker(options: AuditWorkerOptions): AuditWorkerInstance {
  const config = options.config ?? parseWorkerConfig();
  const pipeline = new AuditPipeline({
    store: options.store,
    sandboxRunner: options.sandboxRunner,
    adapterRegistry: options.adapterRegistry,
    importFindings: options.importFindings,
    routes: options.routes,
    config,
  });

  const processJob = async (
    data: unknown,
    opts: {
      targetDir?: string;
      outputDir?: string;
      isCancelled?: () => Promise<boolean> | boolean;
    } = {},
  ): Promise<Run> => {
    const runJob = RunJob.parse(data);
    const run = await options.store.runs.get(runJob.runId, { clientIds: "*" });
    if (!run) {
      throw new Error(`Run not found: ${runJob.runId}`);
    }

    const isCancelledCombined = async () => {
      if (opts.isCancelled && (await opts.isCancelled())) {
        return true;
      }
      const latest = await options.store.runs.get(runJob.runId, { clientIds: "*" });
      return latest?.status === "cancelled";
    };

    const finished = await pipeline.execute(run, {
      resume: runJob.resume,
      isCancelled: isCancelledCombined,
      targetDir: opts.targetDir,
      outputDir: opts.outputDir,
    });
    if (options.metrics) {
      // Metrics are informational: a failure here must never fail the run.
      await recordRunMetrics(options.metrics, options.store, finished).catch(() => undefined);
    }
    return finished;
  };

  let worker: Worker | null = null;

  if (options.connection) {
    worker = new Worker(
      QUEUE_NAMES.runs,
      async (job: Job) => {
        return await processJob(job.data);
      },
      {
        connection: options.connection,
        concurrency: config.workerConcurrency,
      },
    );
  }

  const close = async () => {
    if (worker) {
      await worker.close();
    }
  };

  return {
    worker,
    pipeline,
    processJob,
    close,
  };
}
