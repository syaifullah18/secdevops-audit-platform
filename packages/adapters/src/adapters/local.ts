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
import { LocalAdapterConfig } from "../types.js";
import { OpenAICompatAdapter } from "./openai_compat.js";

/**
 * Local model adapter supporting Ollama (/api/chat) and vLLM (via OpenAI-compatible API).
 * Cost is always 0 USD for self-hosted execution.
 */
export class LocalAdapter implements ModelAdapter {
  readonly id: string;
  readonly kind = "local" as const;
  private readonly config: LocalAdapterConfig;
  private readonly vllmDelegate?: OpenAICompatAdapter;

  constructor(config?: Partial<LocalAdapterConfig>) {
    this.config = LocalAdapterConfig.parse(config ?? {});
    this.id = this.config.id;

    if (this.config.provider === "vllm") {
      this.vllmDelegate = new OpenAICompatAdapter({
        id: this.id,
        baseUrl: this.config.baseUrl,
        selfHosted: true,
        prices: this.config.prices,
        timeoutMs: this.config.timeoutMs,
        retry: this.config.retry,
      });
    }
  }

  capabilities(_model?: string): ModelCapabilities {
    return {
      generate: true,
      decide: false,
      toolUse: true,
      parallelSubAgents: true,
      maxContextTokens: 32_768,
      selfHosted: true,
    };
  }

  async decide(_question: JevQuestion, _opts?: CallOptions): Promise<JevDecision> {
    throw new ModelAdapterError(
      "unsupported",
      this.id,
      "Local model adapter is a generative model adapter; decide() is not supported",
    );
  }

  async generate(req: GenerateRequest, opts?: CallOptions): Promise<GenerateResult> {
    if (this.vllmDelegate) {
      return this.vllmDelegate.generate(req, opts);
    }

    // Native Ollama API: POST /api/chat
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Ollama payload requires flexible JSON structure
    const payload: Record<string, any> = {
      model: req.model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
      options: {
        num_predict: req.maxOutputTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      },
    };

    if (req.responseJsonSchema) {
      payload.format = "json";
    }

    const cleanBaseUrl = this.config.baseUrl.replace(/\/+$/, "");
    const url = `${cleanBaseUrl}/api/chat`;

    const response = await executeHttpRequest({
      adapterId: this.id,
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      callOptions: opts,
      retryConfig: this.config.retry,
      defaultTimeoutMs: this.config.timeoutMs,
    });

    const resJson = await response.json();

    const text = resJson.message?.content ?? "";
    const finishReason: GenerateResult["finishReason"] =
      resJson.done_reason === "length" ? "length" : "stop";

    const inputTokens = resJson.prompt_eval_count ?? 0;
    const outputTokens = resJson.eval_count ?? 0;

    return {
      text,
      adapter: this.id,
      model: req.model,
      finishReason,
      usage: {
        inputTokens,
        outputTokens,
        costUsd: 0, // Always 0 for local/self-hosted
      },
    };
  }

  async health(opts?: CallOptions): Promise<HealthStatus> {
    if (this.vllmDelegate) {
      return this.vllmDelegate.health(opts);
    }

    const checkedAt = new Date().toISOString();
    try {
      const cleanBaseUrl = this.config.baseUrl.replace(/\/+$/, "");
      const url = `${cleanBaseUrl}/api/tags`;

      const response = await executeHttpRequest({
        adapterId: this.id,
        url,
        method: "GET",
        callOptions: opts,
        retryConfig: { maxRetries: 0, initialDelayMs: 0, maxDelayMs: 0, backoffFactor: 1 },
        defaultTimeoutMs: Math.min(this.config.timeoutMs, 5000),
      });

      const data = (await response.json()) as { models?: unknown[] };
      const models = Array.isArray(data.models)
        ? data.models.map((m: unknown) =>
            typeof m === "object" && m !== null && "name" in m
              ? String((m as { name: unknown }).name)
              : String(m),
          )
        : [];

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
