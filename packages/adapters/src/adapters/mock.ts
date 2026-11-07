import {
  JevDecision,
  ModelAdapterError,
  type CallOptions,
  type GenerateRequest,
  type GenerateResult,
  type HealthStatus,
  type JevDecision as JevDecisionType,
  type JevQuestion,
  type ModelAdapter,
  type ModelCapabilities,
  type ModelErrorCode,
} from "@sdap/core";
import { MockAdapterConfig } from "../types.js";

export interface ScriptedFailure {
  code: ModelErrorCode;
  message?: string;
  retryAfterMs?: number | null;
}

/**
 * Deterministic mock adapter for tests in other packages.
 * Supports configurable canned outputs, scripted failures, and both generate() and decide().
 */
export class MockAdapter implements ModelAdapter {
  readonly id: string;
  readonly kind = "mock" as const;
  private readonly config: MockAdapterConfig;
  private readonly failureQueue: ScriptedFailure[] = [];
  private cannedGenerateResult?: Partial<GenerateResult>;
  private cannedDecisionResult?: Partial<JevDecisionType>;
  private healthOk = true;

  constructor(config?: Partial<MockAdapterConfig>) {
    this.config = MockAdapterConfig.parse(config ?? {});
    this.id = this.config.id;
  }

  capabilities(_model?: string): ModelCapabilities {
    return {
      generate: true,
      decide: true,
      toolUse: true,
      parallelSubAgents: true,
      maxContextTokens: 32_768,
      selfHosted: true,
    };
  }

  /**
   * Enqueue a scripted failure for the next call (generate or decide).
   */
  failNext(
    code: ModelErrorCode,
    opts: { message?: string; retryAfterMs?: number | null } = {},
  ): this {
    this.failureQueue.push({
      code,
      message: opts.message ?? `Mock scripted failure: ${code}`,
      retryAfterMs: opts.retryAfterMs ?? null,
    });
    return this;
  }

  /**
   * Configure canned generate output.
   */
  setCannedGenerate(result: Partial<GenerateResult>): this {
    this.cannedGenerateResult = result;
    return this;
  }

  /**
   * Configure canned decide output.
   */
  setCannedDecision(decision: Partial<JevDecisionType>): this {
    this.cannedDecisionResult = decision;
    return this;
  }

  /**
   * Configure mock health status.
   */
  setHealthOk(ok: boolean): this {
    this.healthOk = ok;
    return this;
  }

  private checkScriptedFailure(): void {
    const nextFailure = this.failureQueue.shift();
    if (nextFailure) {
      throw new ModelAdapterError(
        nextFailure.code,
        this.id,
        nextFailure.message ?? nextFailure.code,
        {
          retryAfterMs: nextFailure.retryAfterMs,
        },
      );
    }
  }

  async generate(req: GenerateRequest, _opts?: CallOptions): Promise<GenerateResult> {
    this.checkScriptedFailure();

    if (this.cannedGenerateResult) {
      return {
        text: this.cannedGenerateResult.text ?? `Mock output for ${req.model}`,
        adapter: this.id,
        model: req.model,
        finishReason: this.cannedGenerateResult.finishReason ?? "stop",
        usage: this.cannedGenerateResult.usage ?? {
          inputTokens: 10,
          outputTokens: 20,
          costUsd: 0,
        },
      };
    }

    const defaultText = this.config.cannedText ?? `Mock generation for ${req.model} (${req.task})`;

    return {
      text: defaultText,
      adapter: this.id,
      model: req.model,
      finishReason: "stop",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        costUsd: 0,
      },
    };
  }

  async decide(question: JevQuestion, _opts?: CallOptions): Promise<JevDecisionType> {
    this.checkScriptedFailure();

    const baseDecision = {
      model: "mock-decision",
      modelVersion: "1.0.0",
      latencyMs: 1,
      decidedAt: new Date().toISOString(),
      ...this.cannedDecisionResult,
      // Invariant:
      questionId: question.id,
      key: question.key,
      source: "mock" as const,
    };

    if (question.kind === "binary") {
      const cannedProb =
        this.cannedDecisionResult && "probability" in this.cannedDecisionResult
          ? (this.cannedDecisionResult as { probability?: number }).probability
          : undefined;
      const probability = cannedProb ?? this.config.cannedProbability ?? 0.5;
      return JevDecision.parse({
        ...baseDecision,
        kind: "binary",
        probability,
      });
    }

    if (question.kind === "choice") {
      const cannedDist =
        this.cannedDecisionResult && "distribution" in this.cannedDecisionResult
          ? (this.cannedDecisionResult as { distribution?: Record<string, number> }).distribution
          : undefined;
      if (cannedDist) {
        return JevDecision.parse({
          ...baseDecision,
          kind: "choice",
          distribution: cannedDist,
        });
      }
      const options = question.options;
      const uniformProb = Math.round((1.0 / options.length) * 1000) / 1000;
      const distribution: Record<string, number> = {};
      for (const opt of options) {
        distribution[opt] = uniformProb;
      }
      return JevDecision.parse({
        ...baseDecision,
        kind: "choice",
        distribution,
      });
    }

    const cannedVal =
      this.cannedDecisionResult && "value" in this.cannedDecisionResult
        ? (this.cannedDecisionResult as { value?: number }).value
        : undefined;
    const value = cannedVal ?? Math.round((question.min + question.max) / 2);
    return JevDecision.parse({
      ...baseDecision,
      kind: "rating",
      value,
    });
  }

  async health(_opts?: CallOptions): Promise<HealthStatus> {
    const checkedAt = new Date().toISOString();
    if (!this.healthOk) {
      return {
        ok: false,
        adapter: this.id,
        latencyMs: null,
        message: "Mock adapter forced unhealthy",
        checkedAt,
      };
    }

    return {
      ok: true,
      adapter: this.id,
      latencyMs: 1,
      models: ["mock-1", "mock-2"],
      message: null,
      checkedAt,
    };
  }
}
