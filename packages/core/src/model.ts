import { z } from "zod";
import { IsoDateTime, Usage } from "./common.js";
import { ModelTask } from "./enums.js";
import type { JevDecision, JevQuestion } from "./jev.js";

/** Adapter families shipped with the platform. Community adapters may use other ids. */
export const ADAPTER_KINDS = ["jev", "gemini", "claude", "openai_compat", "local", "mock"] as const;
export type AdapterKind = (typeof ADAPTER_KINDS)[number];

/**
 * Reference to a model through a registered adapter, e.g.
 * { adapter: "gemini", model: "gemini-4-argon" } or { adapter: "agent-cli:claude", model: "claude-opus-5-5" }.
 */
export const ModelRef = z.object({
  adapter: z.string().min(1),
  model: z.string().min(1),
});
export type ModelRef = z.infer<typeof ModelRef>;

/** Primary model plus ordered fallbacks for one task (PRD 12: fallback chain per slice). */
export const ModelRoute = z.object({
  task: ModelTask,
  primary: ModelRef,
  fallbacks: z.array(ModelRef).default([]),
  /**
   * Verification must use a different model family than hunting when possible
   * (adversarial validation). The worker enforces this for `validate`.
   */
  requireDifferentFamilyFrom: ModelTask.optional(),
});
export type ModelRoute = z.infer<typeof ModelRoute>;

export const ModelRouting = z.array(ModelRoute);
export type ModelRouting = z.infer<typeof ModelRouting>;

export const ModelCapabilities = z.object({
  /** Can produce text (System 2). */
  generate: z.boolean(),
  /** Can answer typed questions (System 1). */
  decide: z.boolean(),
  toolUse: z.boolean(),
  parallelSubAgents: z.boolean(),
  maxContextTokens: z.number().int().positive().nullable(),
  /** Runs inside approved infrastructure (self-hosted or private deployment). */
  selfHosted: z.boolean(),
});
export type ModelCapabilities = z.infer<typeof ModelCapabilities>;

export const ChatMessage = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const GenerateRequest = z.object({
  task: ModelTask,
  model: z.string().min(1),
  messages: z.array(ChatMessage).min(1),
  maxOutputTokens: z.number().int().positive().default(4096),
  temperature: z.number().min(0).max(2).optional(),
  /** Ask for a JSON response matching this JSON Schema, where the provider supports it. */
  responseJsonSchema: z.record(z.string(), z.unknown()).optional(),
  /** Correlation ids for logs and cost accounting. */
  metadata: z.record(z.string(), z.string()).default({}),
});
export type GenerateRequest = z.infer<typeof GenerateRequest>;

export const GenerateResult = z.object({
  text: z.string(),
  adapter: z.string(),
  model: z.string(),
  finishReason: z.enum(["stop", "length", "safety", "tool_use", "error"]),
  usage: Usage,
});
export type GenerateResult = z.infer<typeof GenerateResult>;

export const HealthStatus = z.object({
  ok: z.boolean(),
  adapter: z.string(),
  latencyMs: z.number().nonnegative().nullable(),
  /** Models the endpoint reports as available, when it can list them. */
  models: z.array(z.string()).optional(),
  message: z.string().nullable(),
  checkedAt: IsoDateTime,
});
export type HealthStatus = z.infer<typeof HealthStatus>;

/**
 * Failure codes that drive fallback and retry decisions (lessons from PRD 12):
 * quota and unavailability retry later or fall back; safety blocks and permission
 * denials fall back to another model immediately; invalid output is quarantined and retried.
 */
export const ModelErrorCode = z.enum([
  "unsupported",
  "quota_exceeded",
  "rate_limited",
  "safety_blocked",
  "permission_denied",
  "timeout",
  "unavailable",
  "invalid_output",
  "auth_failed",
  "unknown",
]);
export type ModelErrorCode = z.infer<typeof ModelErrorCode>;

export class ModelAdapterError extends Error {
  readonly code: ModelErrorCode;
  readonly adapter: string;
  readonly retryAfterMs: number | null;

  constructor(
    code: ModelErrorCode,
    adapter: string,
    message: string,
    opts: { retryAfterMs?: number | null; cause?: unknown } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = "ModelAdapterError";
    this.code = code;
    this.adapter = adapter;
    this.retryAfterMs = opts.retryAfterMs ?? null;
  }

  /** Should the caller move to the next model in the route instead of retrying this one? */
  get shouldFallBack(): boolean {
    return [
      "unsupported",
      "quota_exceeded",
      "safety_blocked",
      "permission_denied",
      "auth_failed",
      "unavailable",
    ].includes(this.code);
  }
}

export interface CallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * The one interface every model provider implements.
 * Generative adapters set capabilities.decide=false and throw ModelAdapterError("unsupported")
 * from decide(); Jev sets generate=false and throws from generate().
 */
export interface ModelAdapter {
  /** Registry id, e.g. "gemini", "claude", "jev", "openai_compat", "local", "mock". */
  readonly id: string;
  readonly kind: AdapterKind | (string & {});
  capabilities(model?: string): ModelCapabilities;
  generate(req: GenerateRequest, opts?: CallOptions): Promise<GenerateResult>;
  decide(question: JevQuestion, opts?: CallOptions): Promise<JevDecision>;
  health(opts?: CallOptions): Promise<HealthStatus>;
}

/** Model family used for the "different family for verification" rule. */
export const modelFamily = (ref: ModelRef): string => {
  const m = ref.model.toLowerCase();
  if (m.includes("claude")) return "anthropic";
  if (m.includes("gemini") || m.includes("argon")) return "google";
  if (m.startsWith("gpt") || m.includes("openai")) return "openai";
  return `${ref.adapter}:${m.split(/[-:/]/)[0] ?? m}`;
};
