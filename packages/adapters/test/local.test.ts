import { describe, expect, it } from "vitest";
import { LocalAdapter } from "../src/adapters/local.js";
import { describeGenerativeAdapterContract } from "./contract.js";

const OLLAMA_MODEL = "codellama:13b";

const mockOllamaHappyResponse = {
  model: OLLAMA_MODEL,
  message: {
    role: "assistant",
    content: "No insecure deserialization detected.",
  },
  done: true,
  done_reason: "stop",
  prompt_eval_count: 90,
  eval_count: 45,
};

const mockOllamaModelsResponse = {
  models: [{ name: OLLAMA_MODEL }],
};

describe("Local Adapter (Ollama)", () => {
  describeGenerativeAdapterContract({
    adapterKind: "local",
    createAdapter: (baseUrl: string) =>
      new LocalAdapter({
        provider: "ollama",
        baseUrl,
        retry: {
          maxRetries: 2,
          initialDelayMs: 10,
          maxDelayMs: 50,
          backoffFactor: 1.5,
        },
      }),
    modelName: OLLAMA_MODEL,
    mockHappyResponse: mockOllamaHappyResponse,
    expectedInputTokens: 90,
    expectedOutputTokens: 45,
    expectedCostUsd: 0, // Local models have 0 USD cost
    mockModelsResponse: mockOllamaModelsResponse,
  });

  const VLLM_MODEL = "mistralai/Mistral-7B-Instruct-v0.3";

  const mockVllmHappyResponse = {
    id: "chatcmpl-vllm-1",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "No command injection found in exec calls.",
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 75,
      completion_tokens: 35,
    },
  };

  const mockVllmModelsResponse = {
    data: [{ id: VLLM_MODEL }],
  };

  describe("Local Adapter (vLLM)", () => {
    describeGenerativeAdapterContract({
      adapterKind: "local-vllm",
      createAdapter: (baseUrl: string) =>
        new LocalAdapter({
          provider: "vllm",
          baseUrl,
          retry: {
            maxRetries: 2,
            initialDelayMs: 10,
            maxDelayMs: 50,
            backoffFactor: 1.5,
          },
        }),
      modelName: VLLM_MODEL,
      mockHappyResponse: mockVllmHappyResponse,
      expectedInputTokens: 75,
      expectedOutputTokens: 35,
      expectedCostUsd: 0,
      mockModelsResponse: mockVllmModelsResponse,
    });

    it("verifies vllm provider capabilities", () => {
      const vllmAdapter = new LocalAdapter({
        provider: "vllm",
        baseUrl: "http://localhost:8000/v1",
      });
      expect(vllmAdapter.capabilities().selfHosted).toBe(true);
      expect(vllmAdapter.capabilities().generate).toBe(true);
      expect(vllmAdapter.capabilities().decide).toBe(false);
    });
  });
});
