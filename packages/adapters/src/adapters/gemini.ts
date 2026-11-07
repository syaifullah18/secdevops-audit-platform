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
import { GeminiAdapterConfig } from "../types.js";

/**
 * Google Gemini adapter (supporting Gemini 1.5, 2.0, and Argon models).
 */
export class GeminiAdapter implements ModelAdapter {
  readonly id: string;
  readonly kind = "gemini" as const;
  private readonly config: GeminiAdapterConfig;

  constructor(config: GeminiAdapterConfig | { apiKey: string; [key: string]: unknown }) {
    this.config = GeminiAdapterConfig.parse(config);
    this.id = this.config.id;
  }

  capabilities(_model?: string): ModelCapabilities {
    return {
      generate: true,
      decide: false,
      toolUse: true,
      parallelSubAgents: true,
      maxContextTokens: 1_048_576,
      selfHosted: false,
    };
  }

  async decide(_question: JevQuestion, _opts?: CallOptions): Promise<JevDecision> {
    throw new ModelAdapterError(
      "unsupported",
      this.id,
      "Gemini is a generative model adapter; decide() is not supported",
    );
  }

  async generate(req: GenerateRequest, opts?: CallOptions): Promise<GenerateResult> {
    const systemMessages = req.messages.filter((m) => m.role === "system");
    const nonSystemMessages = req.messages.filter((m) => m.role !== "system");

    // Format Gemini contents
    const contents = nonSystemMessages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Gemini payload requires flexible JSON structure
    const payload: Record<string, any> = {
      contents,
      generationConfig: {
        maxOutputTokens: req.maxOutputTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      },
    };

    if (systemMessages.length > 0) {
      payload.systemInstruction = {
        parts: systemMessages.map((m) => ({ text: m.content })),
      };
    }

    if (req.responseJsonSchema) {
      payload.generationConfig.responseMimeType = "application/json";
      payload.generationConfig.responseSchema = req.responseJsonSchema;
    }

    const cleanBaseUrl = this.config.baseUrl.replace(/\/+$/, "");
    const modelPath = req.model.startsWith("models/") ? req.model : `models/${req.model}`;
    const url = `${cleanBaseUrl}/v1beta/${modelPath}:generateContent?key=${encodeURIComponent(this.config.apiKey)}`;

    const response = await executeHttpRequest({
      adapterId: this.id,
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.config.apiKey,
      },
      body: JSON.stringify(payload),
      callOptions: opts,
      retryConfig: this.config.retry,
      defaultTimeoutMs: this.config.timeoutMs,
    });

    const resJson = await response.json();

    // Check prompt-level safety blocks
    if (resJson.promptFeedback?.blockReason) {
      throw new ModelAdapterError(
        "safety_blocked",
        this.id,
        `Gemini prompt blocked due to ${resJson.promptFeedback.blockReason}`,
      );
    }

    const candidate = resJson.candidates?.[0];
    if (!candidate) {
      throw new ModelAdapterError(
        "invalid_output",
        this.id,
        "Gemini returned an empty candidates array",
      );
    }

    // Check candidate-level safety blocks
    if (candidate.finishReason === "SAFETY" || candidate.finishReason === "RECITATION") {
      throw new ModelAdapterError(
        "safety_blocked",
        this.id,
        `Gemini generation blocked with finish reason ${candidate.finishReason}`,
      );
    }

    let finishReason: GenerateResult["finishReason"] = "stop";
    if (candidate.finishReason === "MAX_TOKENS") {
      finishReason = "length";
    } else if (candidate.finishReason === "SAFETY") {
      finishReason = "safety";
    }

    // Extract text from parts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- part structure from Gemini API
    const text = candidate.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";

    const inputTokens = resJson.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = resJson.usageMetadata?.candidatesTokenCount ?? 0;
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
      const url = `${cleanBaseUrl}/v1beta/models?key=${encodeURIComponent(this.config.apiKey)}`;

      const response = await executeHttpRequest({
        adapterId: this.id,
        url,
        method: "GET",
        headers: {
          "x-goog-api-key": this.config.apiKey,
        },
        callOptions: opts,
        retryConfig: { maxRetries: 0, initialDelayMs: 0, maxDelayMs: 0, backoffFactor: 1 },
        defaultTimeoutMs: Math.min(this.config.timeoutMs, 5000),
      });

      const data = await response.json();
      const models = Array.isArray(data.models)
        ? data.models.map((m: { name?: unknown }) =>
            typeof m?.name === "string" ? m.name.replace(/^models\//, "") : String(m),
          )
        : undefined;

      return {
        ok: true,
        adapter: this.id,
        latencyMs: response.latencyMs,
        models,
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
