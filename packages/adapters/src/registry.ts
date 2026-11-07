import {
  ModelAdapterError,
  type AdapterRegistry,
  type ModelAdapter,
  type ModelRef,
} from "@sdap/core";
import type { z } from "zod";
import { ClaudeAdapter } from "./adapters/claude.js";
import { GeminiAdapter } from "./adapters/gemini.js";
import { JevAdapter } from "./adapters/jev.js";
import { LocalAdapter } from "./adapters/local.js";
import { MockAdapter } from "./adapters/mock.js";
import { OpenAICompatAdapter } from "./adapters/openai_compat.js";
import { RulesAdapter } from "./adapters/rules.js";
import { AdaptersConfig } from "./types.js";

/**
 * Creates an AdapterRegistry from a validated configuration.
 * Adapters without keys are not registered (except mock, rules, and local which work offline).
 */
export function createAdapterRegistry(
  configInput?: z.input<typeof AdaptersConfig>,
): AdapterRegistry {
  const config = AdaptersConfig.parse(configInput ?? {});
  const adapters = new Map<string, ModelAdapter>();

  // Offline-first and self-hosted adapters: always registered by default
  const rulesAdapter = new RulesAdapter(config.rules);
  adapters.set(rulesAdapter.id, rulesAdapter);

  const mockAdapter = new MockAdapter(config.mock);
  adapters.set(mockAdapter.id, mockAdapter);

  const localAdapter = new LocalAdapter(config.local);
  adapters.set(localAdapter.id, localAdapter);

  // External / Keyed adapters: registered only when credentials / endpoints are provided
  if (config.jev?.apiUrl) {
    const jev = new JevAdapter(config.jev);
    adapters.set(jev.id, jev);
  }

  if (config.gemini?.apiKey) {
    const gemini = new GeminiAdapter(config.gemini);
    adapters.set(gemini.id, gemini);
  }

  if (config.claude?.apiKey) {
    const claude = new ClaudeAdapter(config.claude);
    adapters.set(claude.id, claude);
  }

  if (config.openaiCompat && (config.openaiCompat.apiKey || config.openaiCompat.baseUrl)) {
    const openaiCompat = new OpenAICompatAdapter(config.openaiCompat);
    adapters.set(openaiCompat.id, openaiCompat);
  }

  return {
    register(adapter: ModelAdapter): void {
      adapters.set(adapter.id, adapter);
    },

    get(id: string): ModelAdapter | undefined {
      return adapters.get(id);
    },

    resolve(ref: ModelRef): ModelAdapter {
      const adapter = adapters.get(ref.adapter);
      if (!adapter) {
        throw new ModelAdapterError(
          "unavailable",
          ref.adapter,
          `Model adapter "${ref.adapter}" is not registered in the adapter registry`,
        );
      }
      return adapter;
    },

    list(): ModelAdapter[] {
      return Array.from(adapters.values());
    },
  };
}

/**
 * Derives adapter configuration from environment variables.
 */
export function configFromEnv(
  env: Record<string, string | undefined> = process.env,
): z.input<typeof AdaptersConfig> {
  const result: z.input<typeof AdaptersConfig> = {
    rules: {},
    mock: {},
    local: {
      provider: env.LOCAL_MODEL_PROVIDER === "vllm" ? "vllm" : "ollama",
      baseUrl:
        env.LOCAL_MODEL_BASE_URL ??
        (env.LOCAL_MODEL_PROVIDER === "vllm"
          ? "http://localhost:8000/v1"
          : "http://localhost:11434"),
    },
  };

  if (env.JEV_API_URL) {
    result.jev = {
      apiUrl: env.JEV_API_URL,
      apiKey: env.JEV_API_KEY,
      model: env.JEV_MODEL ?? "jev-1",
      modelVersion: env.JEV_MODEL_VERSION ?? "2026-11-01",
    };
  }

  if (env.GEMINI_API_KEY) {
    result.gemini = {
      apiKey: env.GEMINI_API_KEY,
      baseUrl: env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com",
    };
  }

  const anthropicKey = env.ANTHROPIC_API_KEY ?? env.CLAUDE_API_KEY;
  if (anthropicKey) {
    result.claude = {
      apiKey: anthropicKey,
      baseUrl: env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
    };
  }

  if (env.OPENAI_API_KEY || env.OPENAI_BASE_URL) {
    result.openaiCompat = {
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    };
  }

  return result;
}
