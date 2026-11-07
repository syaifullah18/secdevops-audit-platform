import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Run, RunJob } from "@sdap/core";
import { describe, expect, it } from "vitest";
import { AgentCliAdapter, InMemoryAdapterRegistry } from "../src/agent-adapter.js";
import { parseWorkerConfig } from "../src/config.js";
import { FakeSandboxRunner, FakeStore } from "./fakes.js";
import { createAuditWorker } from "../src/worker.js";

const fakeAgentScript = path.resolve(__dirname, "fixtures/fake-agent.cjs");
const skillPath = path.resolve(
  __dirname,
  "../../../vendor/security-audit-skill/skills/security-audit",
);

function makeTestRun(overrides: Partial<Run> = {}): Run {
  const id = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const now = new Date().toISOString();

  return {
    id,
    projectId,
    mode: "full",
    repeat: 1,
    trigger: { kind: "api", actor: null, ref: null },
    ref: "HEAD",
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    baseCommitSha: null,
    previousRunId: null,
    scope: {
      paths: [],
      attackClasses: ["authz"],
      maxRuntimeSec: 3600,
      tokenBudget: null,
    },
    status: "queued",
    phases: [],
    validators: { findings: "pending", coverageLedger: "pending" },
    skillVersion: "pinned-commit-abc1234",
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    artifacts: {
      findingsJson: null,
      coverageLedgerJson: null,
      architectureMd: null,
      reportMd: null,
      findingsDetailMd: null,
      needsValidationMd: null,
    },
    failureReason: null,
    retries: 0,
    createdAt: now,
    startedAt: null,
    endedAt: null,
    ...overrides,
  };
}

describe("Audit Worker", () => {
  it("parses valid RunJob payload and executes pipeline", async () => {
    const store = new FakeStore();
    const sandboxRunner = new FakeSandboxRunner();
    const adapterRegistry = new InMemoryAdapterRegistry();

    const claudeAdapter = new AgentCliAdapter({
      id: "agent-cli:claude",
      command: process.execPath,
      argvPrefix: [process.execPath, fakeAgentScript],
      sandboxRunner,
    });
    const agyAdapter = new AgentCliAdapter({
      id: "agent-cli:agy",
      command: process.execPath,
      argvPrefix: [process.execPath, fakeAgentScript],
      sandboxRunner,
    });
    adapterRegistry.register(claudeAdapter);
    adapterRegistry.register(agyAdapter);

    const config = parseWorkerConfig({
      SDAP_SKILL_PATH: skillPath,
    });

    const run = makeTestRun();
    await store.runs.create(run);

    const workerInstance = createAuditWorker({
      store,
      sandboxRunner,
      adapterRegistry,
      config,
    });

    const tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "sdap-worker-test-"));

    const jobData: RunJob = {
      runId: run.id,
      projectId: run.projectId,
      resume: false,
    };

    const completed = await workerInstance.processJob(jobData, {
      outputDir: tmpOut,
    });

    expect(completed.status).toBe("succeeded");
    await workerInstance.close();
    await fs.rm(tmpOut, { recursive: true, force: true });
  });

  it("handles cancellation requested between slices", async () => {
    const store = new FakeStore();
    const sandboxRunner = new FakeSandboxRunner();
    const adapterRegistry = new InMemoryAdapterRegistry();

    const claudeAdapter = new AgentCliAdapter({
      id: "agent-cli:claude",
      command: process.execPath,
      argvPrefix: [process.execPath, fakeAgentScript],
      sandboxRunner,
    });
    const agyAdapter = new AgentCliAdapter({
      id: "agent-cli:agy",
      command: process.execPath,
      argvPrefix: [process.execPath, fakeAgentScript],
      sandboxRunner,
    });
    adapterRegistry.register(claudeAdapter);
    adapterRegistry.register(agyAdapter);

    const config = parseWorkerConfig({
      SDAP_SKILL_PATH: skillPath,
    });

    const run = makeTestRun();
    await store.runs.create(run);

    const workerInstance = createAuditWorker({
      store,
      sandboxRunner,
      adapterRegistry,
      config,
    });

    const tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "sdap-cancel-test-"));

    const jobData: RunJob = {
      runId: run.id,
      projectId: run.projectId,
      resume: false,
    };

    let cancelFlag = false;

    // Simulate cancelling after preflight
    const completed = await workerInstance.processJob(jobData, {
      outputDir: tmpOut,
      isCancelled: () => {
        if (!cancelFlag) {
          cancelFlag = true;
          return false;
        }
        return true;
      },
    });

    expect(completed.status).toBe("cancelled");
    await workerInstance.close();
    await fs.rm(tmpOut, { recursive: true, force: true });
  });
});
