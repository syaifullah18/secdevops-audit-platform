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
import fs from "node:fs/promises";
import { EventSequencer } from "./events.js";
import { AuditPipeline } from "./pipeline.js";
import { prepareTarget, targetDirFor } from "./target.js";
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

    const project = await options.store.projects.get(run.projectId, { clientIds: "*" });
    if (!project) throw new Error(`Project not found: ${run.projectId}`);

    // Without an explicit target (tests), audit a fresh checkout of the project's repository.
    let targetDir = opts.targetDir;
    let cleanup: (() => Promise<void>) | null = null;
    if (!targetDir) {
      const dir = targetDirFor(config.outputBaseDir, run.id);
      try {
        const { commitSha } = await prepareTarget({
          repoUrl: project.repoUrl,
          ref: run.ref || project.defaultBranch,
          commitSha: run.commitSha,
          dir,
          token: process.env["GIT_AUTH_TOKEN"],
          tokenHost: process.env["GIT_AUTH_HOST"],
          // Local repositories are for tests and development only, never a production setting.
          allowLocal:
            config.nodeEnv !== "production" && process.env["SDAP_ALLOW_LOCAL_REPOS"] === "true",
        });
        run.commitSha = commitSha;
        await options.store.runs.update(run.id, { commitSha });
      } catch (err) {
        await fs.rm(dir, { recursive: true, force: true });
        const reason = `clone_failed: ${err instanceof Error ? err.message : String(err)}`;
        const endedAt = new Date().toISOString();
        await options.store.runs.update(run.id, {
          status: "failed",
          failureReason: reason,
          endedAt,
        });
        await new EventSequencer({
          runId: run.id,
          projectId: run.projectId,
          sink: { emit: (event) => options.store.events.append(event) },
        }).emitRunFailed({ reason, phase: "preflight", willRetry: false });
        const failed = (await options.store.runs.get(run.id, { clientIds: "*" })) ?? run;
        if (options.metrics) {
          await recordRunMetrics(options.metrics, options.store, failed).catch(() => undefined);
        }
        return failed;
      }
      targetDir = dir;
      cleanup = () => fs.rm(dir, { recursive: true, force: true });
    }

    let finished: Run;
    try {
      finished = await pipeline.execute(run, {
        resume: runJob.resume,
        isCancelled: isCancelledCombined,
        targetDir,
        outputDir: opts.outputDir,
        routes: project.modelRouting,
      });
    } finally {
      await cleanup?.().catch(() => undefined);
    }
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
