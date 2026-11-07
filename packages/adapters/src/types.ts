import { z } from "zod";

/**
 * Token pricing configuration (USD per 1,000,000 tokens).
 */
export const TokenPricing = z.object({
  inputPricePerMillion: z.number().nonnegative().default(0),
  outputPricePerMillion: z.number().nonnegative().default(0),
});
export type TokenPricing = z.infer<typeof TokenPricing>;

/** Price table mapping model names or prefixes to token pricing. */
export const PriceTable = z.record(z.string(), TokenPricing);
export type PriceTable = z.infer<typeof PriceTable>;

/** Default retry configuration. */
export const DEFAULT_RETRY_CONFIG = {
  maxRetries: 2,
  initialDelayMs: 200,
  maxDelayMs: 10000,
  backoffFactor: 2,
} as const;

/** Retry configuration for adapters. */
export const RetryConfig = z.object({
  maxRetries: z.number().int().nonnegative().default(DEFAULT_RETRY_CONFIG.maxRetries),
  initialDelayMs: z.number().nonnegative().default(DEFAULT_RETRY_CONFIG.initialDelayMs),
  maxDelayMs: z.number().nonnegative().default(DEFAULT_RETRY_CONFIG.maxDelayMs),
  backoffFactor: z.number().positive().default(DEFAULT_RETRY_CONFIG.backoffFactor),
});
export type RetryConfig = z.infer<typeof RetryConfig>;

/** Jev adapter configuration (System 1 decision model). */
export const JevAdapterConfig = z.object({
  id: z.string().default("jev"),
  apiUrl: z.string().url(),
  apiKey: z.string().optional(),
  model: z.string().default("jev-1"),
  modelVersion: z.string().default("2026-11-01"),
  timeoutMs: z.number().positive().default(30000),
  retry: RetryConfig.default(DEFAULT_RETRY_CONFIG),
});
export type JevAdapterConfig = z.infer<typeof JevAdapterConfig>;

/** Rules adapter configuration (deterministic System 1 fallback). */
export const RulesAdapterConfig = z.object({
  id: z.string().default("rules"),
  model: z.string().default("deterministic-rules"),
  modelVersion: z.string().default("1.0.0"),
});
export type RulesAdapterConfig = z.infer<typeof RulesAdapterConfig>;

/** Gemini adapter configuration (incl. Argon models). */
export const GeminiAdapterConfig = z.object({
  id: z.string().default("gemini"),
  apiKey: z.string().min(1),
  baseUrl: z.string().url().default("https://generativelanguage.googleapis.com"),
  prices: PriceTable.default({}),
  timeoutMs: z.number().positive().default(60000),
  retry: RetryConfig.default(DEFAULT_RETRY_CONFIG),
});
export type GeminiAdapterConfig = z.infer<typeof GeminiAdapterConfig>;

/** Claude (Anthropic Messages API) adapter configuration. */
export const ClaudeAdapterConfig = z.object({
  id: z.string().default("claude"),
  apiKey: z.string().min(1),
  baseUrl: z.string().url().default("https://api.anthropic.com"),
  anthropicVersion: z.string().default("2023-06-01"),
  prices: PriceTable.default({}),
  timeoutMs: z.number().positive().default(60000),
  retry: RetryConfig.default(DEFAULT_RETRY_CONFIG),
});
export type ClaudeAdapterConfig = z.infer<typeof ClaudeAdapterConfig>;

/** OpenAI-compatible adapter configuration (OpenAI, vLLM, etc.). */
export const OpenAICompatAdapterConfig = z.object({
  id: z.string().default("openai_compat"),
  baseUrl: z.string().url().default("https://api.openai.com/v1"),
  apiKey: z.string().optional(),
  selfHosted: z.boolean().default(false),
  prices: PriceTable.default({}),
  timeoutMs: z.number().positive().default(60000),
  retry: RetryConfig.default(DEFAULT_RETRY_CONFIG),
});
export type OpenAICompatAdapterConfig = z.infer<typeof OpenAICompatAdapterConfig>;

/** Local adapter configuration (Ollama native or vLLM). */
export const LocalAdapterConfig = z.object({
  id: z.string().default("local"),
  provider: z.enum(["ollama", "vllm"]).default("ollama"),
  baseUrl: z.string().url().default("http://localhost:11434"),
  prices: PriceTable.default({}),
  timeoutMs: z.number().positive().default(120000),
  retry: RetryConfig.default(DEFAULT_RETRY_CONFIG),
});
export type LocalAdapterConfig = z.infer<typeof LocalAdapterConfig>;

/** Mock adapter configuration for scripted failures and deterministic outputs. */
export const MockAdapterConfig = z.object({
  id: z.string().default("mock"),
  cannedText: z.string().optional(),
  cannedProbability: z.number().min(0).max(1).optional(),
});
export type MockAdapterConfig = z.infer<typeof MockAdapterConfig>;

/** Full registry configuration schema. */
export const AdaptersConfig = z.object({
  jev: JevAdapterConfig.optional(),
  rules: RulesAdapterConfig.optional(),
  gemini: GeminiAdapterConfig.optional(),
  claude: ClaudeAdapterConfig.optional(),
  openaiCompat: OpenAICompatAdapterConfig.optional(),
  local: LocalAdapterConfig.optional(),
  mock: MockAdapterConfig.optional(),
});
export type AdaptersConfig = z.infer<typeof AdaptersConfig>;
