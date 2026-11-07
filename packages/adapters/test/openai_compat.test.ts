import { describe } from "vitest";
import { OpenAICompatAdapter } from "../src/adapters/openai_compat.js";
import { describeGenerativeAdapterContract } from "./contract.js";

const MODEL_NAME = "gpt-4o";

const mockHappyResponse = {
  id: "chatcmpl-123",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: "No IDOR vulnerabilities detected in routes.",
      },
      finish_reason: "stop",
    },
  ],
  usage: {
    prompt_tokens: 80,
    completion_tokens: 40,
  },
};

const mockSafetyBlockedResponse = {
  id: "chatcmpl-123",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: "",
      },
      finish_reason: "content_filter",
    },
  ],
};

const mockModelsResponse = {
  data: [{ id: MODEL_NAME }, { id: "vllm-model" }],
};

describe("OpenAI-Compatible Adapter", () => {
  describeGenerativeAdapterContract({
    adapterKind: "openai_compat",
    createAdapter: (baseUrl: string) =>
      new OpenAICompatAdapter({
        apiKey: "fake-test-key",
        baseUrl,
        prices: {
          [MODEL_NAME]: {
            inputPricePerMillion: 2.5,
            outputPricePerMillion: 10.0,
          },
        },
        retry: {
          maxRetries: 2,
          initialDelayMs: 10,
          maxDelayMs: 50,
          backoffFactor: 1.5,
        },
      }),
    modelName: MODEL_NAME,
    mockHappyResponse,
    expectedInputTokens: 80,
    expectedOutputTokens: 40,
    expectedCostUsd: 0.0006,
    mockSafetyBlockedResponse,
    mockModelsResponse,
  });
});
