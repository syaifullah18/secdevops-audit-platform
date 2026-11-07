import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  type AdapterRegistry,
  type Id,
  type ModelRef,
  type ModelRoute,
  type PhaseName,
  type Run,
  type RunPhase,
  type SandboxRunner,
  type Slice,
  type Store,
  type Usage,
} from "@sdap/core";
import type { WorkerConfig } from "./config.js";
import { EventSequencer } from "./events.js";
import { createDefaultImportFindings } from "./normalizer-hook.js";
import { executeSliceWithFallback } from "./router.js";
import type { ImportFindingsFn, PipelineExecutionOptions } from "./types.js";
import { ValidationService } from "./validator.js";

export interface AuditPipelineDependencies {
  store: Store;
  sandboxRunner: SandboxRunner;
  adapterRegistry: AdapterRegistry;
  validationService?: ValidationService;
  importFindings?: ImportFindingsFn;
  config: WorkerConfig;
  routes?: ModelRoute[];
}

export class AuditPipeline {
  private readonly store: Store;
  private readonly sandboxRunner: SandboxRunner;
  private readonly adapterRegistry: AdapterRegistry;
  private readonly validationService: ValidationService;
  private readonly importFindings: ImportFindingsFn;
  private readonly config: WorkerConfig;
  private readonly routes: ModelRoute[];

  constructor(deps: AuditPipelineDependencies) {
    this.store = deps.store;
    this.sandboxRunner = deps.sandboxRunner;
    this.adapterRegistry = deps.adapterRegistry;
    this.config = deps.config;
    this.validationService = deps.validationService ?? new ValidationService(deps.config.skillPath);
    this.importFindings = deps.importFindings ?? createDefaultImportFindings(deps.store);
    this.routes = deps.routes ?? this.getDefaultRoutes();
  }

  getDefaultRoutes(): ModelRoute[] {
    return [
      {
        task: "recon",
        primary: { adapter: "agent-cli:claude", model: "claude-opus-5-5" },
        fallbacks: [{ adapter: "agent-cli:agy", model: "gemini-4-argon" }],
      },
      {
        task: "hunt",
        primary: { adapter: "agent-cli:claude", model: "claude-opus-5-5" },
        fallbacks: [{ adapter: "agent-cli:agy", model: "gemini-4-argon" }],
      },
      {
        task: "validate",
        primary: { adapter: "agent-cli:claude", model: "claude-sonnet-5-5" },
        fallbacks: [{ adapter: "agent-cli:agy", model: "gemini-4-argon" }],
        requireDifferentFamilyFrom: "hunt",
      },
      {
        task: "record_verify",
        primary: { adapter: "agent-cli:claude", model: "claude-opus-5-5" },
        fallbacks: [{ adapter: "agent-cli:agy", model: "gemini-4-argon" }],
      },
      {
        task: "report",
        primary: { adapter: "agent-cli:claude", model: "claude-opus-5-5" },
        fallbacks: [{ adapter: "agent-cli:agy", model: "gemini-4-argon" }],
      },
    ];
  }

  getRouteForTask(task: string): ModelRoute {
    const route = this.routes.find((r) => r.task === task);
    if (route) return route;

    return {
      task: task as ModelRoute["task"],
      primary: { adapter: "agent-cli:claude", model: "claude-opus-5-5" },
      fallbacks: [{ adapter: "agent-cli:agy", model: "gemini-4-argon" }],
    };
  }

  async execute(run: Run, options: PipelineExecutionOptions = {}): Promise<Run> {
    const isCancelled = options.isCancelled;
    const isResume = options.resume ?? false;

    const sequencer = new EventSequencer({
      runId: run.id,
      projectId: run.projectId,
      sink: {
        emit: async (event) => {
          await this.store.events.append(event);
        },
      },
    });

    const targetDir = options.targetDir || process.cwd();
    const outputDir = options.outputDir || path.resolve(this.config.outputBaseDir, run.id);
    await fs.mkdir(outputDir, { recursive: true });

    if (await isCancelled?.()) {
      await this.cancelRun(run, sequencer);
      return run;
    }

    run.status = "running";
    run.startedAt = run.startedAt ?? new Date().toISOString();
    await this.store.runs.update(run.id, {
      status: "running",
      startedAt: run.startedAt,
    });

    await sequencer.emitRunStarted({
      commitSha: run.commitSha,
      skillVersion: run.skillVersion,
    });

    const totalUsage: Usage = {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };

    const addUsage = (u: Usage) => {
      totalUsage.inputTokens += u.inputTokens;
      totalUsage.outputTokens += u.outputTokens;
      totalUsage.costUsd += u.costUsd;
      run.usage = { ...totalUsage };
    };

    const checkBudgets = (_currentPhase: PhaseName): string | null => {
      const totalTokens = totalUsage.inputTokens + totalUsage.outputTokens;
      if (run.scope.tokenBudget !== null && totalTokens >= run.scope.tokenBudget) {
        return `Token budget exceeded: used ${totalTokens} tokens, budget is ${run.scope.tokenBudget}`;
      }

      const elapsedSec = (Date.now() - new Date(run.startedAt!).getTime()) / 1000;
      if (elapsedSec >= run.scope.maxRuntimeSec) {
        return `Max runtime exceeded: elapsed ${Math.round(elapsedSec)}s, limit is ${run.scope.maxRuntimeSec}s`;
      }

      return null;
    };

    const existingSlices = await this.store.runs.listSlices(run.id);

    // ==========================================
    // 1. Phase: PREFLIGHT
    // ==========================================
    if (await isCancelled?.()) {
      await this.cancelRun(run, sequencer);
      return run;
    }

    await this.startPhase(run, "preflight", 1, sequencer);

    const uniqueModelRefs = this.getUniqueModelRefs();
    for (const ref of uniqueModelRefs) {
      try {
        const adapter = this.adapterRegistry.resolve(ref);
        const health = await adapter.health();
        if (!health.ok) {
          const failMsg = `Health check failed for model ${ref.adapter}:${ref.model}: ${health.message ?? "unhealthy"}`;
          return await this.failRun(run, "preflight", failMsg, sequencer);
        }
      } catch (err) {
        const failMsg = `Health check failed for model ${ref.adapter}:${ref.model}: ${err instanceof Error ? err.message : String(err)}`;
        return await this.failRun(run, "preflight", failMsg, sequencer);
      }
    }

    try {
      await fs.access(targetDir, fs.constants.R_OK);
    } catch {
      return await this.failRun(
        run,
        "preflight",
        `Harness permission check failed: target directory '${targetDir}' is not readable`,
        sequencer,
      );
    }

    try {
      await fs.access(outputDir, fs.constants.W_OK);
    } catch {
      return await this.failRun(
        run,
        "preflight",
        `Harness permission check failed: output directory '${outputDir}' is not writable`,
        sequencer,
      );
    }

    await this.finishPhase(run, "preflight", "succeeded", sequencer);

    // ==========================================
    // 2. Phase: RECON
    // ==========================================
    if (await isCancelled?.()) {
      await this.cancelRun(run, sequencer);
      return run;
    }

    await this.startPhase(run, "recon", 1, sequencer);

    const reconSlice =
      existingSlices.find((s) => s.phase === "recon") ??
      this.createSlice(run.id, "recon", "recon/architecture");

    if (!isResume || reconSlice.status !== "succeeded") {
      const reconRoute = this.getRouteForTask("recon");
      const res = await executeSliceWithFallback({
        slice: reconSlice,
        route: reconRoute,
        adapterRegistry: this.adapterRegistry,
        sequencer,
        store: this.store,
        prompt: `Run security-audit reconnaissance phase on target ${targetDir} with output in ${outputDir}.`,
        metadata: { targetDir, outputDir },
      });

      if (!res.success) {
        return await this.failRun(run, "recon", `Recon slice failed: ${res.error}`, sequencer);
      }
      if (res.result) addUsage(res.result.usage);
    }

    await this.finishPhase(run, "recon", "succeeded", sequencer);

    const reconBudgetErr = checkBudgets("recon");
    if (reconBudgetErr) {
      return await this.failRun(run, "recon", reconBudgetErr, sequencer);
    }

    // ==========================================
    // 3. Phase: HUNT (parallel slices)
    // ==========================================
    if (await isCancelled?.()) {
      await this.cancelRun(run, sequencer);
      return run;
    }

    const huntSlices = this.planHuntSlices(run, existingSlices);
    await this.startPhase(run, "hunt", huntSlices.length, sequencer);

    const huntRoute = this.getRouteForTask("hunt");
    let lastHunterModel: ModelRef | undefined;

    for (const slice of huntSlices) {
      if (await isCancelled?.()) {
        await this.cancelRun(run, sequencer);
        return run;
      }

      const budgetErr = checkBudgets("hunt");
      if (budgetErr) {
        return await this.failRun(run, "hunt", budgetErr, sequencer);
      }

      if (isResume && slice.status === "succeeded") {
        const lastAttempt = slice.attempts.find((a) => a.status === "succeeded");
        if (lastAttempt) lastHunterModel = lastAttempt.model;
        continue;
      }

      const res = await executeSliceWithFallback({
        slice,
        route: huntRoute,
        adapterRegistry: this.adapterRegistry,
        sequencer,
        store: this.store,
        prompt: `Run security-audit hunting phase for ${slice.label} on target ${targetDir} with output in ${outputDir}.`,
        metadata: { targetDir, outputDir },
      });

      if (!res.success) {
        return await this.failRun(
          run,
          "hunt",
          `Hunt slice '${slice.label}' failed: ${res.error}`,
          sequencer,
        );
      }

      if (res.usedModel) {
        lastHunterModel = res.usedModel;
      }
      if (res.result) addUsage(res.result.usage);
    }

    await this.finishPhase(run, "hunt", "succeeded", sequencer);

    // ==========================================
    // 4. Phase: TRIAGE (optional Jev)
    // ==========================================
    if (await isCancelled?.()) {
      await this.cancelRun(run, sequencer);
      return run;
    }

    await this.startPhase(run, "triage", 1, sequencer);
    await this.finishPhase(run, "triage", "succeeded", sequencer);

    // ==========================================
    // 5. Phase: VALIDATE (parallel, cross-family)
    // ==========================================
    if (await isCancelled?.()) {
      await this.cancelRun(run, sequencer);
      return run;
    }

    const validateSlices = this.planValidateSlices(run, existingSlices);
    await this.startPhase(run, "validate", validateSlices.length, sequencer);

    const validateRoute = this.getRouteForTask("validate");

    for (const slice of validateSlices) {
      if (await isCancelled?.()) {
        await this.cancelRun(run, sequencer);
        return run;
      }

      const budgetErr = checkBudgets("validate");
      if (budgetErr) {
        return await this.failRun(run, "validate", budgetErr, sequencer);
      }

      if (isResume && slice.status === "succeeded") {
        continue;
      }

      const res = await executeSliceWithFallback({
        slice,
        route: validateRoute,
        hunterModel: lastHunterModel,
        adapterRegistry: this.adapterRegistry,
        sequencer,
        store: this.store,
        prompt: `Run security-audit validation phase for ${slice.label} on target ${targetDir} with output in ${outputDir}.`,
        metadata: { targetDir, outputDir },
      });

      if (!res.success) {
        return await this.failRun(
          run,
          "validate",
          `Validation slice '${slice.label}' failed: ${res.error}`,
          sequencer,
        );
      }

      if (res.result) addUsage(res.result.usage);
    }

    await this.finishPhase(run, "validate", "succeeded", sequencer);

    // ==========================================
    // 6. Phase: OUTPUT & VALIDATION
    // ==========================================
    if (await isCancelled?.()) {
      await this.cancelRun(run, sequencer);
      return run;
    }

    await this.startPhase(run, "output", 1, sequencer);

    const findingsFile = path.join(outputDir, "findings.json");
    const ledgerFile = path.join(outputDir, "coverage-ledger.json");

    let validationRetries = 0;
    let validated = false;

    while (validationRetries <= this.config.maxValidationRetries) {
      const fCheck = await this.validationService.validateFindings(findingsFile);
      if (!fCheck.ok) {
        await this.validationService.quarantineFile(findingsFile, outputDir, "findings");
        await sequencer.emitValidatorDone({
          validator: "findings",
          status: "failed",
          errors: fCheck.errors,
        });

        if (validationRetries < this.config.maxValidationRetries) {
          validationRetries++;
          continue;
        } else {
          run.validators.findings = "failed";
          return await this.failRun(
            run,
            "output",
            `Findings validation failed after retries: ${fCheck.errors.join("; ")}`,
            sequencer,
          );
        }
      }

      const cCheck = await this.validationService.validateCoverageLedger(ledgerFile);
      if (!cCheck.ok) {
        await this.validationService.quarantineFile(ledgerFile, outputDir, "coverage_ledger");
        await sequencer.emitValidatorDone({
          validator: "coverage_ledger",
          status: "failed",
          errors: cCheck.errors,
        });

        if (validationRetries < this.config.maxValidationRetries) {
          validationRetries++;
          continue;
        } else {
          run.validators.coverageLedger = "failed";
          return await this.failRun(
            run,
            "output",
            `Coverage ledger validation failed after retries: ${cCheck.errors.join("; ")}`,
            sequencer,
          );
        }
      }

      validated = true;
      run.validators.findings = "passed";
      run.validators.coverageLedger = "passed";
      await sequencer.emitValidatorDone({
        validator: "findings",
        status: "passed",
        errors: [],
      });
      await sequencer.emitValidatorDone({
        validator: "coverage_ledger",
        status: "passed",
        errors: [],
      });
      break;
    }

    if (!validated) {
      return await this.failRun(run, "output", "Artefact validation failed", sequencer);
    }

    const importedResults = await this.importFindings(run, outputDir);
    for (const item of importedResults) {
      await sequencer.emitFindingUpserted({
        findingId: item.finding.id,
        fingerprint: item.finding.fingerprint,
        verdict: item.finding.verdict,
        verifiedSeverity: item.finding.verifiedSeverity,
        status: item.finding.status,
        isNew: item.isNew,
      });
    }

    await this.finishPhase(run, "output", "succeeded", sequencer);

    // ==========================================
    // 7. Phase: RECORD_VERIFY
    // ==========================================
    if (await isCancelled?.()) {
      await this.cancelRun(run, sequencer);
      return run;
    }

    await this.startPhase(run, "record_verify", 1, sequencer);
    await this.finishPhase(run, "record_verify", "succeeded", sequencer);

    // ==========================================
    // 8. Phase: REPORT
    // ==========================================
    if (await isCancelled?.()) {
      await this.cancelRun(run, sequencer);
      return run;
    }

    await this.startPhase(run, "report", 1, sequencer);

    run.artifacts.architectureMd = path.join(outputDir, "architecture.md");
    run.artifacts.findingsJson = findingsFile;
    run.artifacts.coverageLedgerJson = ledgerFile;
    run.artifacts.reportMd = path.join(outputDir, "REPORT.md");
    run.artifacts.findingsDetailMd = path.join(outputDir, "FINDINGS-DETAIL.md");
    run.artifacts.needsValidationMd = path.join(outputDir, "NEEDS-VALIDATION.md");

    const confirmedCount = importedResults.filter((r) => r.finding.verdict === "confirmed").length;
    const needsValidationCount = importedResults.filter(
      (r) => r.finding.verdict === "needs_validation",
    ).length;
    const rejectedCount = importedResults.filter((r) => r.finding.verdict === "rejected").length;

    await this.finishPhase(run, "report", "succeeded", sequencer);

    run.status = "succeeded";
    run.endedAt = new Date().toISOString();
    run.usage = totalUsage;

    await this.store.runs.update(run.id, {
      status: "succeeded",
      endedAt: run.endedAt,
      usage: totalUsage,
      validators: run.validators,
      artifacts: run.artifacts,
    });

    await sequencer.emitRunCompleted({
      usage: totalUsage,
      counts: {
        confirmed: confirmedCount,
        needsValidation: needsValidationCount,
        rejected: rejectedCount,
      },
    });

    return run;
  }

  private async startPhase(
    run: Run,
    phase: PhaseName,
    sliceCount: number,
    sequencer: EventSequencer,
  ): Promise<void> {
    const runPhase: RunPhase = {
      runId: run.id,
      name: phase,
      status: "running",
      startedAt: new Date().toISOString(),
      endedAt: null,
      sliceCount,
      slicesDone: 0,
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    };

    const phaseIndex = run.phases.findIndex((p) => p.name === phase);
    if (phaseIndex !== -1) {
      run.phases[phaseIndex] = runPhase;
    } else {
      run.phases.push(runPhase);
    }

    await this.store.runs.upsertPhase(runPhase);
    await sequencer.emitPhaseStarted({ phase, sliceCount });
  }

  private async finishPhase(
    run: Run,
    phase: PhaseName,
    status: "succeeded" | "failed" | "skipped",
    sequencer: EventSequencer,
  ): Promise<void> {
    const phaseItem = run.phases.find((p) => p.name === phase);
    if (phaseItem) {
      phaseItem.status = status;
      phaseItem.endedAt = new Date().toISOString();
      await this.store.runs.upsertPhase(phaseItem);
    }

    await sequencer.emitPhaseDone({
      phase,
      status,
      usage: phaseItem?.usage ?? {
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      },
    });
  }

  private async failRun(
    run: Run,
    phase: PhaseName | null,
    reason: string,
    sequencer: EventSequencer,
  ): Promise<Run> {
    run.status = "failed";
    run.failureReason = reason;
    run.endedAt = new Date().toISOString();

    if (phase) {
      const phaseItem = run.phases.find((p) => p.name === phase);
      if (phaseItem) {
        phaseItem.status = "failed";
        phaseItem.endedAt = run.endedAt;
        await this.store.runs.upsertPhase(phaseItem);
        await sequencer.emitPhaseDone({
          phase,
          status: "failed",
          usage: phaseItem.usage,
        });
      }
    }

    await this.store.runs.update(run.id, {
      status: "failed",
      failureReason: reason,
      endedAt: run.endedAt,
    });

    await sequencer.emitRunFailed({
      reason,
      phase,
      willRetry: false,
    });

    return run;
  }

  private async cancelRun(run: Run, sequencer: EventSequencer): Promise<void> {
    run.status = "cancelled";
    run.endedAt = new Date().toISOString();

    await this.store.runs.update(run.id, {
      status: "cancelled",
      endedAt: run.endedAt,
    });

    await sequencer.emitRunCancelled({ by: "worker" });
  }

  private createSlice(runId: Id, phase: PhaseName, label: string): Slice {
    return {
      id: crypto.randomUUID(),
      runId,
      phase,
      label,
      attackClass: null,
      coverageIds: [],
      paths: [],
      status: "pending",
      attempts: [],
      startedAt: null,
      endedAt: null,
    };
  }

  private planHuntSlices(run: Run, existingSlices: Slice[]): Slice[] {
    const existingHunt = existingSlices.filter((s) => s.phase === "hunt");
    if (existingHunt.length > 0) {
      return existingHunt;
    }

    if (run.mode === "focused") {
      const paths = run.scope.paths.length > 0 ? run.scope.paths : ["src/index.ts"];
      return paths.map((p) => this.createSlice(run.id, "hunt", `hunt/focused/${p}`));
    }

    const attackClasses =
      run.scope.attackClasses.length > 0
        ? run.scope.attackClasses
        : ["authz", "injection", "config", "data_isolation"];

    const slices: Slice[] = [];
    const repeatCount = run.mode === "full" ? run.repeat : 1;

    for (let pass = 1; pass <= repeatCount; pass++) {
      for (const ac of attackClasses) {
        const label = repeatCount > 1 ? `hunt/pass-${pass}/${ac}` : `hunt/${ac}`;
        const slice = this.createSlice(run.id, "hunt", label);
        slice.attackClass = ac;
        slices.push(slice);
      }
    }

    return slices;
  }

  private planValidateSlices(run: Run, existingSlices: Slice[]): Slice[] {
    const existingVal = existingSlices.filter((s) => s.phase === "validate");
    if (existingVal.length > 0) {
      return existingVal;
    }

    return [this.createSlice(run.id, "validate", "validate/cross-family-001")];
  }

  private getUniqueModelRefs(): ModelRef[] {
    const refs: ModelRef[] = [];
    const seen = new Set<string>();

    for (const route of this.routes) {
      const all = [route.primary, ...route.fallbacks];
      for (const ref of all) {
        const key = `${ref.adapter}:${ref.model}`;
        if (!seen.has(key)) {
          seen.add(key);
          refs.push(ref);
        }
      }
    }

    return refs;
  }
}
