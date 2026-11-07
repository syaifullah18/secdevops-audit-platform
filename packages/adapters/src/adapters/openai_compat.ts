import {
  ModelAdapterError,
  type CallOptions,
  type GenerateRequest,
  type GenerateResult,
  type HealthStatus,
  type JevDecision,
  type JevQuestion,
  type ModelAdapter,
  type ModelCapabilities,
} from "@sdap/core";
import { executeHttpRequest } from "../http.js";
import { calculateCost } from "../pricing.js";
import { OpenAICompatAdapterConfig } from "../types.js";

/**
 * OpenAI-compatible adapter for chat completions (OpenAI, vLLM, DeepSeek, etc.).
 */
export class OpenAICompatAdapter implements ModelAdapter {
  readonly id: string;
  readonly kind = "openai_compat" as const;
  private readonly config: OpenAICompatAdapterConfig;

  constructor(config?: Partial<OpenAICompatAdapterConfig>) {
    this.config = OpenAICompatAdapterConfig.parse(config ?? {});
    this.id = this.config.id;
  }

  capabilities(_model?: string): ModelCapabilities {
    return {
      generate: true,
      decide: false,
      toolUse: true,
      parallelSubAgents: true,
      maxContextTokens: 128_000,
      selfHosted: this.config.selfHosted,
    };
  }

  async decide(_question: JevQuestion, _opts?: CallOptions): Promise<JevDecision> {
    throw new ModelAdapterError(
      "unsupported",
      this.id,
      "OpenAI-compatible adapter is a generative model adapter; decide() is not supported",
    );
  }

  async generate(req: GenerateRequest, opts?: CallOptions): Promise<GenerateResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenAI payload requires flexible JSON structure
    const payload: Record<string, any> = {
      model: req.model,
      messages: req.messages,
      max_tokens: req.maxOutputTokens,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    };

    if (req.responseJsonSchema) {
      payload.response_format = {
        type: "json_schema",
        json_schema: {
          name: "response",
          schema: req.responseJsonSchema,
        },
      };
    }

    const cleanBaseUrl = this.config.baseUrl.replace(/\/+$/, "");
    const url = cleanBaseUrl.endsWith("/v1")
      ? `${cleanBaseUrl}/chat/completions`
      : `${cleanBaseUrl}/v1/chat/completions`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }

    const response = await executeHttpRequest({
      adapterId: this.id,
      url,
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      callOptions: opts,
      retryConfig: this.config.retry,
      defaultTimeoutMs: this.config.timeoutMs,
    });

    const resJson = await response.json();

    const choice = resJson.choices?.[0];
    if (!choice) {
      throw new ModelAdapterError(
        "invalid_output",
        this.id,
        "OpenAI-compatible endpoint returned no choices",
      );
    }

    if (choice.finish_reason === "content_filter") {
      throw new ModelAdapterError(
        "safety_blocked",
        this.id,
        "Response was blocked by content filter",
      );
    }

    let finishReason: GenerateResult["finishReason"] = "stop";
    if (choice.finish_reason === "length") {
      finishReason = "length";
    } else if (choice.finish_reason === "tool_calls") {
      finishReason = "tool_use";
    } else if (choice.finish_reason === "content_filter") {
      finishReason = "safety";
    }

    const text = choice.message?.content ?? "";
    const inputTokens = resJson.usage?.prompt_tokens ?? 0;
    const outputTokens = resJson.usage?.completion_tokens ?? 0;
    const costUsd = calculateCost({ inputTokens, outputTokens }, req.model, this.config.prices);

    return {
      text,
      adapter: this.id,
      model: req.model,
      finishReason,
      usage: {
        inputTokens,
        outputTokens,
        costUsd,
      },
    };
  }

  async health(opts?: CallOptions): Promise<HealthStatus> {
    const checkedAt = new Date().toISOString();
    try {
      const cleanBaseUrl = this.config.baseUrl.replace(/\/+$/, "");
      const url = cleanBaseUrl.endsWith("/v1")
        ? `${cleanBaseUrl}/models`
        : `${cleanBaseUrl}/v1/models`;

      const headers: Record<string, string> = {};
      if (this.config.apiKey) {
        headers["Authorization"] = `Bearer ${this.config.apiKey}`;
      }

      const response = await executeHttpRequest({
        adapterId: this.id,
        url,
        method: "GET",
        headers,
        callOptions: opts,
        retryConfig: { maxRetries: 0, initialDelayMs: 0, maxDelayMs: 0, backoffFactor: 1 },
        defaultTimeoutMs: Math.min(this.config.timeoutMs, 5000),
      });

      const data = await response.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- model list from OpenAI models API
      const models = Array.isArray(data.data) ? data.data.map((m: any) => m.id ?? String(m)) : [];

      return {
        ok: true,
        adapter: this.id,
        latencyMs: response.latencyMs,
        models: models.length > 0 ? models : undefined,
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
