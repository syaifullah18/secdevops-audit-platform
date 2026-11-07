import { QUEUE_NAMES, type RunJob } from "@sdap/core";
import { Queue as BullQueue, type QueueOptions } from "bullmq";

export interface Queue {
  enqueue(job: RunJob): Promise<void>;
  cancel(runId: string): Promise<void>;
  close?(): Promise<void>;
}

export class MemoryQueue implements Queue {
  readonly jobs: RunJob[] = [];
  readonly cancelledRunIds: Set<string> = new Set();

  async enqueue(job: RunJob): Promise<void> {
    this.jobs.push(job);
  }

  async cancel(runId: string): Promise<void> {
    this.cancelledRunIds.add(runId);
  }

  async close(): Promise<void> {}

  clear(): void {
    this.jobs.length = 0;
    this.cancelledRunIds.clear();
  }
}

export class BullMqQueue implements Queue {
  private readonly bullQueue: BullQueue;

  constructor(redisUrlOrOptions: string | QueueOptions, queueName = QUEUE_NAMES.runs) {
    if (typeof redisUrlOrOptions === "string") {
      const url = new URL(redisUrlOrOptions);
      this.bullQueue = new BullQueue(queueName, {
        connection: {
          host: url.hostname || "127.0.0.1",
          port: Number(url.port || 6379),
          password: url.password ? decodeURIComponent(url.password) : undefined,
          username: url.username ? decodeURIComponent(url.username) : undefined,
          ...(url.protocol === "rediss:" ? { tls: {} } : {}),
        },
      });
    } else {
      this.bullQueue = new BullQueue(queueName, redisUrlOrOptions);
    }
  }

  async enqueue(job: RunJob): Promise<void> {
    await this.bullQueue.add("run", job, { jobId: job.runId });
  }

  async cancel(runId: string): Promise<void> {
    const job = await this.bullQueue.getJob(runId);
    if (!job) return;
    try {
      await job.remove();
    } catch {
      // An active job is locked by its worker and cannot be removed. The API marks the run
      // `cancelled` and the worker stops when it next sees that status.
    }
  }

  async close(): Promise<void> {
    await this.bullQueue.close();
  }
}
