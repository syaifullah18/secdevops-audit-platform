import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Run } from "@sdap/core";
import { AgentCliAdapter, InMemoryAdapterRegistry } from "../src/agent-adapter.js";
import { parseWorkerConfig } from "../src/config.js";
import { createAuditWorker } from "../src/worker.js";
import { FakeSandboxRunner, FakeStore } from "./fakes.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const golden = path.join(root, "packages/normalizer/test/golden/mixed");
const skillPath = path.join(root, "vendor/security-audit-skill/skills/security-audit");

describe("a run audits a real checkout end to end", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sdap-e2e-"));
    process.env["SDAP_ALLOW_LOCAL_REPOS"] = "true";
    process.env["TEST_GOLDEN_DIR"] = golden;
  });
  afterEach(async () => {
    delete process.env["SDAP_ALLOW_LOCAL_REPOS"];
    delete process.env["TEST_GOLDEN_DIR"];
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("clones the project, runs the agent on it, validates and imports the findings", async () => {
    const repo = path.join(tmp, "repo");
    await fs.mkdir(repo);
    const g = (...a: string[]) =>
      execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a]);
    g("init", "-q", "-b", "main");
    await fs.writeFile(path.join(repo, "app.ts"), "export const secret = 1;\n");
    g("add", ".");
    g("commit", "-q", "-m", "init");
    const head = g("rev-parse", "HEAD").toString().trim();

    const store = new FakeStore();
    const now = new Date().toISOString();
    const projectId = crypto.randomUUID();
    await store.projects.create({
      id: projectId,
      slug: "demo",
      name: "Demo",
      repoUrl: repo,
      defaultBranch: "main",
      team: "t",
      clientId: "c",
      policyId: null,
      webhookSecretRef: null,
      // The project's own routing is used instead of the platform default model.
      modelRouting: ["recon", "hunt", "validate"].map((task) => ({
        task: task as "recon" | "hunt" | "validate",
        primary: { adapter: "agent-cli:claude", model: "project-model" },
        fallbacks: [],
      })),
      escalation: null,
      criticalPaths: [],
      monthlyTokenBudget: null,
      createdAt: now,
      updatedAt: now,
    });
    const run: Run = {
      id: crypto.randomUUID(),
      projectId,
      mode: "full",
      repeat: 1,
      trigger: { kind: "api", actor: null, ref: null },
      ref: "main",
      commitSha: null,
      baseCommitSha: null,
      previousRunId: null,
      scope: { paths: [], attackClasses: ["authz"], maxRuntimeSec: 3600, tokenBudget: null },
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
    };
    await store.runs.create(run);

    const sandboxRunner = new FakeSandboxRunner();
    const adapterRegistry = new InMemoryAdapterRegistry();
    adapterRegistry.register(
      new AgentCliAdapter({
        id: "agent-cli:claude",
        command: path.join(here, "fixtures/fake-claude-audit.cjs"),
        sandboxRunner,
      }),
    );
    const outBase = path.join(tmp, "runs");
    const worker = createAuditWorker({
      store,
      sandboxRunner,
      adapterRegistry,
      config: parseWorkerConfig({ SDAP_SKILL_PATH: skillPath, SDAP_OUTPUT_BASE_DIR: outBase }),
    });

    const done = await worker.processJob({ runId: run.id, projectId, resume: false });

    expect(done.failureReason).toBeNull();
    expect(done.status).toBe("succeeded");
    expect(done.commitSha).toBe(head);
    // Real usage from the agent's report, summed over every call.
    expect(done.usage.costUsd).toBeGreaterThan(0);
    expect(done.usage.inputTokens).toBeGreaterThanOrEqual(1000);
    // The agent worked on the checkout, with the project's model.
    const slices = await store.runs.listSlices(run.id);
    expect(slices.length).toBeGreaterThan(0);
    for (const s of slices) {
      expect(s.attempts.every((a) => a.model.model === "project-model")).toBe(true);
    }
    // Findings were imported by the real normaliser, and the checkout was removed afterwards.
    expect(store.findingsMap.size).toBeGreaterThan(0);
    await expect(fs.access(path.join(outBase, "targets", run.id))).rejects.toThrow();
    // triage and record_verify are reported as skipped, not as work that happened.
    const phases = Object.fromEntries(done.phases.map((p) => [p.name, p.status]));
    expect(phases["triage"]).toBe("skipped");
    expect(phases["record_verify"]).toBe("skipped");
  });

  it("fails the run with a clear reason when the repository cannot be fetched", async () => {
    const store = new FakeStore();
    const now = new Date().toISOString();
    const projectId = crypto.randomUUID();
    await store.projects.create({
      id: projectId,
      slug: "gone",
      name: "Gone",
      repoUrl: path.join(tmp, "does-not-exist"),
      defaultBranch: "main",
      team: "t",
      clientId: "c",
      policyId: null,
      webhookSecretRef: null,
      modelRouting: [],
      escalation: null,
      criticalPaths: [],
      monthlyTokenBudget: null,
      createdAt: now,
      updatedAt: now,
    });
    const run = {
      id: crypto.randomUUID(),
      projectId,
      mode: "full",
      repeat: 1,
      trigger: { kind: "api", actor: null, ref: null },
      ref: "main",
      commitSha: null,
      baseCommitSha: null,
      previousRunId: null,
      scope: { paths: [], attackClasses: [], maxRuntimeSec: 3600, tokenBudget: null },
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
    } as Run;
    await store.runs.create(run);
    const sandboxRunner = new FakeSandboxRunner();
    const worker = createAuditWorker({
      store,
      sandboxRunner,
      adapterRegistry: new InMemoryAdapterRegistry(),
      config: parseWorkerConfig({
        SDAP_SKILL_PATH: skillPath,
        SDAP_OUTPUT_BASE_DIR: path.join(tmp, "runs"),
      }),
    });
    const done = await worker.processJob({ runId: run.id, projectId, resume: false });
    expect(done.status).toBe("failed");
    expect(done.failureReason).toMatch(/^clone_failed:/);
  });
});
