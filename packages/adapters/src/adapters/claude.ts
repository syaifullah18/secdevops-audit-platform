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
import { ClaudeAdapterConfig } from "../types.js";

/**
 * Anthropic Claude adapter using the Messages API (/v1/messages).
 */
export class ClaudeAdapter implements ModelAdapter {
  readonly id: string;
  readonly kind = "claude" as const;
  private readonly config: ClaudeAdapterConfig;

  constructor(config: ClaudeAdapterConfig | { apiKey: string; [key: string]: unknown }) {
    this.config = ClaudeAdapterConfig.parse(config);
    this.id = this.config.id;
  }

  capabilities(_model?: string): ModelCapabilities {
    return {
      generate: true,
      decide: false,
      toolUse: true,
      parallelSubAgents: true,
      maxContextTokens: 200_000,
      selfHosted: false,
    };
  }

  async decide(_question: JevQuestion, _opts?: CallOptions): Promise<JevDecision> {
    throw new ModelAdapterError(
      "unsupported",
      this.id,
      "Claude is a generative model adapter; decide() is not supported",
    );
  }

  async generate(req: GenerateRequest, opts?: CallOptions): Promise<GenerateResult> {
    const systemMessages = req.messages.filter((m) => m.role === "system");
    const nonSystemMessages = req.messages.filter((m) => m.role !== "system");

    const systemPrompt = systemMessages.map((m) => m.content).join("\n\n");
    const messages = nonSystemMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Anthropic payload requires flexible JSON structure
    const payload: Record<string, any> = {
      model: req.model,
      max_tokens: req.maxOutputTokens,
      messages,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    };

    const cleanBaseUrl = this.config.baseUrl.replace(/\/+$/, "");
    const url = `${cleanBaseUrl}/v1/messages`;

    const response = await executeHttpRequest({
      adapterId: this.id,
      url,
      method: "POST",
      headers: {
        "x-api-key": this.config.apiKey,
        "anthropic-version": this.config.anthropicVersion,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      callOptions: opts,
      retryConfig: this.config.retry,
      defaultTimeoutMs: this.config.timeoutMs,
    });

    const resJson = await response.json();

    if (resJson.stop_reason === "refusal" || resJson.error?.type === "refusal") {
      throw new ModelAdapterError(
        "safety_blocked",
        this.id,
        `Claude generation blocked with refusal: ${resJson.error?.message ?? "content refusal"}`,
      );
    }

    let finishReason: GenerateResult["finishReason"] = "stop";
    if (resJson.stop_reason === "max_tokens") {
      finishReason = "length";
    } else if (resJson.stop_reason === "tool_use") {
      finishReason = "tool_use";
    } else if (resJson.stop_reason === "refusal") {
      finishReason = "safety";
    }

    // Extract text from content blocks
    const contentList = Array.isArray(resJson.content) ? resJson.content : [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- content block from Anthropic API
    const text = contentList.map((c: any) => c.text ?? "").join("");

    const inputTokens = resJson.usage?.input_tokens ?? 0;
    const outputTokens = resJson.usage?.output_tokens ?? 0;
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
      const url = `${cleanBaseUrl}/v1/models`;

      const response = await executeHttpRequest({
        adapterId: this.id,
        url,
        method: "GET",
        headers: {
          "x-api-key": this.config.apiKey,
          "anthropic-version": this.config.anthropicVersion,
        },
        callOptions: opts,
        retryConfig: { maxRetries: 0, initialDelayMs: 0, maxDelayMs: 0, backoffFactor: 1 },
        defaultTimeoutMs: Math.min(this.config.timeoutMs, 5000),
      });

      const data = await response.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- models response from Anthropic API
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
