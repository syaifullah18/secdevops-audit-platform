import {
  JevDecision,
  ModelAdapterError,
  type CallOptions,
  type GenerateRequest,
  type GenerateResult,
  type HealthStatus,
  type JevQuestion,
  type ModelAdapter,
  type ModelCapabilities,
} from "@sdap/core";
import { executeHttpRequest } from "../http.js";
import { JevAdapterConfig } from "../types.js";

/**
 * Jev decision model adapter (System 1).
 * Answers typed questions with calibrated probabilities; never generates free text.
 * Sends minimal data (prompt + context only) to respect privacy/data egress boundaries.
 */
export class JevAdapter implements ModelAdapter {
  readonly id: string;
  readonly kind = "jev" as const;
  private readonly config: JevAdapterConfig;

  constructor(config: JevAdapterConfig | { apiUrl: string; [key: string]: unknown }) {
    this.config = JevAdapterConfig.parse(config);
    this.id = this.config.id;
  }

  capabilities(_model?: string): ModelCapabilities {
    return {
      generate: false,
      decide: true,
      toolUse: false,
      parallelSubAgents: false,
      maxContextTokens: null,
      selfHosted: false,
    };
  }

  async generate(_req: GenerateRequest, _opts?: CallOptions): Promise<GenerateResult> {
    throw new ModelAdapterError(
      "unsupported",
      this.id,
      "Jev is a decision-only model; generate() is not supported",
    );
  }

  async decide(question: JevQuestion, opts?: CallOptions): Promise<JevDecision> {
    // PRD 1b requirement: send only question.prompt and question.subject.context (no extra fields)
    const payload = {
      prompt: question.prompt,
      context: question.subject.context ?? [],
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }

    const response = await executeHttpRequest({
      adapterId: this.id,
      url: this.config.apiUrl,
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      callOptions: opts,
      retryConfig: this.config.retry,
      defaultTimeoutMs: this.config.timeoutMs,
    });

    const resJson = await response.json();

    // Construct decision with pinned model and modelVersion, then validate with JevDecision schema
    const rawDecision = {
      latencyMs: response.latencyMs,
      decidedAt: new Date().toISOString(),
      kind: question.kind,
      ...resJson,
      // Enforce invariants:
      questionId: question.id,
      key: question.key,
      source: "jev" as const,
      model: this.config.model,
      modelVersion: this.config.modelVersion,
    };

    try {
      return JevDecision.parse(rawDecision);
    } catch (parseError: unknown) {
      throw new ModelAdapterError(
        "invalid_output",
        this.id,
        `Jev response failed validation: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        { cause: parseError },
      );
    }
  }

  async health(opts?: CallOptions): Promise<HealthStatus> {
    const checkedAt = new Date().toISOString();
    try {
      const headers: Record<string, string> = {};
      if (this.config.apiKey) {
        headers["Authorization"] = `Bearer ${this.config.apiKey}`;
      }

      // Check health endpoint or base URL
      const healthUrl = this.config.apiUrl.endsWith("/health")
        ? this.config.apiUrl
        : `${this.config.apiUrl.replace(/\/+$/, "")}/health`;

      const response = await executeHttpRequest({
        adapterId: this.id,
        url: healthUrl,
        method: "GET",
        headers,
        callOptions: opts,
        retryConfig: { maxRetries: 0, initialDelayMs: 0, maxDelayMs: 0, backoffFactor: 1 },
        defaultTimeoutMs: Math.min(this.config.timeoutMs, 5000),
      });

      return {
        ok: true,
        adapter: this.id,
        latencyMs: response.latencyMs,
        message: null,
        checkedAt,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Health check failed";
      return {
        ok: false,
        adapter: this.id,
        latencyMs: null,
        message,
        checkedAt,
      };
    }
  }
}
