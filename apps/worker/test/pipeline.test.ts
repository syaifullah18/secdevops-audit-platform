import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type ModelRoute, type Run, modelFamily } from "@sdap/core";
import { describe, expect, it } from "vitest";
import { AgentCliAdapter, InMemoryAdapterRegistry } from "../src/agent-adapter.js";
import { parseWorkerConfig } from "../src/config.js";
import { FakeSandboxRunner, FakeStore } from "./fakes.js";
import { AuditPipeline } from "../src/pipeline.js";

const fakeAgentScript = path.resolve(__dirname, "fixtures/fake-agent.cjs");
const skillPath = path.resolve(
  __dirname,
  "../../../vendor/security-audit-skill/skills/security-audit",
);

function createTestSetup(
  opts: {
    simulateInvalid?: boolean;
    simulateInvalidAlways?: boolean;
  } = {},
) {
  const store = new FakeStore();
  const sandboxRunner = new FakeSandboxRunner();
  const adapterRegistry = new InMemoryAdapterRegistry();

  const envOverrides: Record<string, string> = {};
  if (opts.simulateInvalidAlways) {
    envOverrides.SDAP_SIMULATE_INVALID_ALWAYS = "true";
  } else if (opts.simulateInvalid) {
    envOverrides.SDAP_SIMULATE_INVALID = "true";
  }

  const claudeAdapter = new AgentCliAdapter({
    id: "agent-cli:claude",
    command: process.execPath,
    argvPrefix: [process.execPath, fakeAgentScript],
    sandboxRunner,
    defaultPolicy: { env: envOverrides },
  });

  const agyAdapter = new AgentCliAdapter({
    id: "agent-cli:agy",
    command: process.execPath,
    argvPrefix: [process.execPath, fakeAgentScript],
    sandboxRunner,
    defaultPolicy: { env: envOverrides },
  });

  adapterRegistry.register(claudeAdapter);
  adapterRegistry.register(agyAdapter);

  const config = parseWorkerConfig({
    SDAP_SKILL_PATH: skillPath,
    WORKER_CONCURRENCY: "2",
    MAX_VALIDATION_RETRIES: "2",
  });

  return { store, sandboxRunner, adapterRegistry, config };
}

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

describe("AuditPipeline Acceptance Criteria", () => {
  it("primary model returns quota_exceeded -> fallback model is used, both attempts recorded", async () => {
    const { store, sandboxRunner, adapterRegistry, config } = createTestSetup();
    const run = makeTestRun();
    await store.runs.create(run);

    const routesWithQuotaFailure: ModelRoute[] = [
      {
        task: "recon",
        primary: { adapter: "agent-cli:claude", model: "claude-opus-5-5" },
        fallbacks: [{ adapter: "agent-cli:agy", model: "gemini-4-argon" }],
      },
      {
        task: "hunt",
        primary: {
          adapter: "agent-cli:claude",
          model: "claude-opus-quota-exceeded",
        },
        fallbacks: [{ adapter: "agent-cli:agy", model: "gemini-4-argon" }],
      },
      {
        task: "validate",
        primary: { adapter: "agent-cli:agy", model: "gemini-4-argon" },
        fallbacks: [],
      },
      {
        task: "record_verify",
        primary: { adapter: "agent-cli:claude", model: "claude-opus-5-5" },
        fallbacks: [],
      },
      {
        task: "report",
        primary: { adapter: "agent-cli:claude", model: "claude-opus-5-5" },
        fallbacks: [],
      },
    ];

    const tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "sdap-out-"));
    const pipeline = new AuditPipeline({
      store,
      sandboxRunner,
      adapterRegistry,
      config,
      routes: routesWithQuotaFailure,
    });

    const completedRun = await pipeline.execute(run, { outputDir: tmpOut });
    expect(completedRun.status).toBe("succeeded");

    const slices = await store.runs.listSlices(run.id);
    const huntSlice = slices.find((s) => s.phase === "hunt");
    expect(huntSlice).toBeDefined();

    // Verify both attempts recorded
    expect(huntSlice!.attempts).toHaveLength(2);

    const [attempt1, attempt2] = huntSlice!.attempts;
    expect(attempt1?.status).toBe("failed");
    expect(attempt1?.errorCode).toBe("quota_exceeded");
    expect(attempt1?.model.model).toBe("claude-opus-quota-exceeded");

    expect(attempt2?.status).toBe("succeeded");
    expect(attempt2?.model.model).toBe("gemini-4-argon");

    // Verify slice.attempt_failed event was emitted
    const attemptFailedEvents = store.eventsList.filter((e) => e.type === "slice.attempt_failed");
    expect(attemptFailedEvents.length).toBeGreaterThan(0);
    const quotaFailedEvent = attemptFailedEvents.find(
      (e) => e.type === "slice.attempt_failed" && e.payload.errorCode === "quota_exceeded",
    );
    expect(quotaFailedEvent).toBeDefined();

    await fs.rm(tmpOut, { recursive: true, force: true });
  });

  it("invalid findings.json -> quarantined, retried, then run failed (never succeeded)", async () => {
    const { store, sandboxRunner, adapterRegistry, config } = createTestSetup({
      simulateInvalidAlways: true,
    });
    const run = makeTestRun();
    await store.runs.create(run);

    const tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "sdap-invalid-"));
    const pipeline = new AuditPipeline({
      store,
      sandboxRunner,
      adapterRegistry,
      config,
    });

    const failedRun = await pipeline.execute(run, { outputDir: tmpOut });

    // Run must be failed, NEVER succeeded
    expect(failedRun.status).toBe("failed");
    expect(failedRun.failureReason).toContain("Findings validation failed");
    expect(failedRun.validators.findings).toBe("failed");

    // Quarantined file must exist
    const quarantineDir = path.join(tmpOut, "quarantine");
    const quarantinedFiles = await fs.readdir(quarantineDir);
    expect(quarantinedFiles.length).toBeGreaterThan(0);

    // Validator done failure event emitted
    const validatorFailedEvents = store.eventsList.filter(
      (e) => e.type === "validator.done" && e.payload.status === "failed",
    );
    expect(validatorFailedEvents.length).toBeGreaterThan(0);

    await fs.rm(tmpOut, { recursive: true, force: true });
  });

  it("resumes a killed run: kill after 2 of 4 hunt slices, resume, only 2 slices re-run", async () => {
    const { store, sandboxRunner, adapterRegistry, config } = createTestSetup();
    const run = makeTestRun({
      scope: {
        paths: [],
        attackClasses: ["authz", "injection", "config", "data_isolation"],
        maxRuntimeSec: 3600,
        tokenBudget: null,
      },
    });
    await store.runs.create(run);

    const tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "sdap-resume-"));

    // Pre-populate 4 hunt slices
    const slice1 = {
      id: crypto.randomUUID(),
      runId: run.id,
      phase: "hunt" as const,
      label: "hunt/authz",
      attackClass: "authz",
      coverageIds: [],
      paths: [],
      status: "succeeded" as const,
      attempts: [
        {
          attempt: 1,
          model: { adapter: "agent-cli:claude", model: "claude-opus-5-5" },
          status: "succeeded" as const,
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          errorCode: null,
          errorMessage: null,
          usage: { inputTokens: 50, outputTokens: 25, costUsd: 0 },
          logKey: null,
        },
      ],
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    };

    const slice2 = {
      id: crypto.randomUUID(),
      runId: run.id,
      phase: "hunt" as const,
      label: "hunt/injection",
      attackClass: "injection",
      coverageIds: [],
      paths: [],
      status: "succeeded" as const,
      attempts: [
        {
          attempt: 1,
          model: { adapter: "agent-cli:claude", model: "claude-opus-5-5" },
          status: "succeeded" as const,
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          errorCode: null,
          errorMessage: null,
          usage: { inputTokens: 50, outputTokens: 25, costUsd: 0 },
          logKey: null,
        },
      ],
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    };

    const slice3 = {
      id: crypto.randomUUID(),
      runId: run.id,
      phase: "hunt" as const,
      label: "hunt/config",
      attackClass: "config",
      coverageIds: [],
      paths: [],
      status: "pending" as const,
      attempts: [],
      startedAt: null,
      endedAt: null,
    };

    const slice4 = {
      id: crypto.randomUUID(),
      runId: run.id,
      phase: "hunt" as const,
      label: "hunt/data_isolation",
      attackClass: "data_isolation",
      coverageIds: [],
      paths: [],
      status: "pending" as const,
      attempts: [],
      startedAt: null,
      endedAt: null,
    };

    await store.runs.upsertSlice(slice1);
    await store.runs.upsertSlice(slice2);
    await store.runs.upsertSlice(slice3);
    await store.runs.upsertSlice(slice4);

    const pipeline = new AuditPipeline({
      store,
      sandboxRunner,
      adapterRegistry,
      config,
    });

    // Execute with resume = true
    const resumedRun = await pipeline.execute(run, {
      resume: true,
      outputDir: tmpOut,
    });

    expect(resumedRun.status).toBe("succeeded");

    const updatedSlices = await store.runs.listSlices(run.id);
    const uSlice1 = updatedSlices.find((s) => s.id === slice1.id);
    const uSlice2 = updatedSlices.find((s) => s.id === slice2.id);
    const uSlice3 = updatedSlices.find((s) => s.id === slice3.id);
    const uSlice4 = updatedSlices.find((s) => s.id === slice4.id);

    // Slice 1 and 2 had 1 attempt originally and still have 1 attempt (were not re-executed!)
    expect(uSlice1!.attempts).toHaveLength(1);
    expect(uSlice2!.attempts).toHaveLength(1);

    // Slice 3 and 4 were executed and now succeeded
    expect(uSlice3!.status).toBe("succeeded");
    expect(uSlice3!.attempts).toHaveLength(1);
    expect(uSlice4!.status).toBe("succeeded");
    expect(uSlice4!.attempts).toHaveLength(1);

    await fs.rm(tmpOut, { recursive: true, force: true });
  });

  it("verifier family differs from hunter family when the route allows it", async () => {
    const { store, sandboxRunner, adapterRegistry, config } = createTestSetup();
    const run = makeTestRun();
    await store.runs.create(run);

    const routes: ModelRoute[] = [
      {
        task: "recon",
        primary: { adapter: "agent-cli:claude", model: "claude-opus-5-5" },
        fallbacks: [],
      },
      {
        task: "hunt",
        primary: { adapter: "agent-cli:claude", model: "claude-opus-5-5" }, // Anthropic family
        fallbacks: [],
      },
      {
        task: "validate",
        primary: { adapter: "agent-cli:claude", model: "claude-sonnet-5-5" }, // Anthropic family
        fallbacks: [{ adapter: "agent-cli:agy", model: "gemini-4-argon" }], // Google family
        requireDifferentFamilyFrom: "hunt",
      },
      {
        task: "record_verify",
        primary: { adapter: "agent-cli:claude", model: "claude-opus-5-5" },
        fallbacks: [],
      },
      {
        task: "report",
        primary: { adapter: "agent-cli:claude", model: "claude-opus-5-5" },
        fallbacks: [],
      },
    ];

    const tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "sdap-verifier-"));
    const pipeline = new AuditPipeline({
      store,
      sandboxRunner,
      adapterRegistry,
      config,
      routes,
    });

    await pipeline.execute(run, { outputDir: tmpOut });

    const slices = await store.runs.listSlices(run.id);
    const validateSlice = slices.find((s) => s.phase === "validate");
    expect(validateSlice).toBeDefined();

    // Verify validate slice selected a model from a different family (Google vs Anthropic)
    const validateAttempt = validateSlice!.attempts[0];
    expect(validateAttempt).toBeDefined();
    expect(validateAttempt!.model.model).toBe("gemini-4-argon");
    expect(modelFamily(validateAttempt!.model)).toBe("google");
    expect(modelFamily({ adapter: "agent-cli:claude", model: "claude-opus-5-5" })).toBe(
      "anthropic",
    );

    await fs.rm(tmpOut, { recursive: true, force: true });
  });

  it("events are emitted in order with strictly increasing seq", async () => {
    const { store, sandboxRunner, adapterRegistry, config } = createTestSetup();
    const run = makeTestRun();
    await store.runs.create(run);

    const tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "sdap-seq-"));
    const pipeline = new AuditPipeline({
      store,
      sandboxRunner,
      adapterRegistry,
      config,
    });

    await pipeline.execute(run, { outputDir: tmpOut });

    const events = store.eventsList.filter((e) => e.runId === run.id);
    expect(events.length).toBeGreaterThan(5);

    // Verify strictly monotonic sequence: 0, 1, 2, 3...
    for (let i = 0; i < events.length; i++) {
      expect(events[i]!.seq).toBe(i);
    }

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes[0]).toBe("run.started");
    expect(eventTypes).toContain("phase.started");
    expect(eventTypes).toContain("slice.started");
    expect(eventTypes).toContain("slice.done");
    expect(eventTypes).toContain("validator.done");
    expect(eventTypes).toContain("finding.upserted");
    expect(eventTypes[eventTypes.length - 1]).toBe("run.completed");

    await fs.rm(tmpOut, { recursive: true, force: true });
  });

  it("enforces token budget and stops scheduling new slices when exceeded", async () => {
    const { store, sandboxRunner, adapterRegistry, config } = createTestSetup();
    const run = makeTestRun({
      scope: {
        paths: [],
        attackClasses: ["authz", "injection", "config"],
        maxRuntimeSec: 3600,
        tokenBudget: 150, // Low budget to trigger limit
      },
    });
    await store.runs.create(run);

    const tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "sdap-budget-"));
    const pipeline = new AuditPipeline({
      store,
      sandboxRunner,
      adapterRegistry,
      config,
    });

    const resultRun = await pipeline.execute(run, { outputDir: tmpOut });
    expect(resultRun.status).toBe("failed");
    expect(resultRun.failureReason).toContain("Token budget exceeded");

    await fs.rm(tmpOut, { recursive: true, force: true });
  });

  it("fails fast in preflight when a model health check fails", async () => {
    const { store, sandboxRunner, adapterRegistry, config } = createTestSetup();
    const run = makeTestRun();
    await store.runs.create(run);

    sandboxRunner.setPreflightStatus(false, "Sandbox runtime unreachable");

    const tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "sdap-preflight-"));
    const pipeline = new AuditPipeline({
      store,
      sandboxRunner,
      adapterRegistry,
      config,
    });

    const resultRun = await pipeline.execute(run, { outputDir: tmpOut });
    expect(resultRun.status).toBe("failed");
    expect(resultRun.failureReason).toContain("Health check failed");

    await fs.rm(tmpOut, { recursive: true, force: true });
  });
});
