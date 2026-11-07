import { describe } from "vitest";
import { GeminiAdapter } from "../src/adapters/gemini.js";
import { describeGenerativeAdapterContract } from "./contract.js";

const MODEL_NAME = "gemini-4-argon";

const mockHappyResponse = {
  candidates: [
    {
      content: {
        role: "model",
        parts: [{ text: "Security audit completed. No critical issues in auth filter." }],
      },
      finishReason: "STOP",
    },
  ],
  usageMetadata: {
    promptTokenCount: 100,
    candidatesTokenCount: 50,
  },
};

const mockSafetyBlockedResponse = {
  candidates: [
    {
      content: { parts: [] },
      finishReason: "SAFETY",
    },
  ],
};

const mockModelsResponse = {
  models: [{ name: "models/gemini-1.5-pro" }, { name: "models/gemini-4-argon" }],
};

describe("Gemini Adapter", () => {
  describeGenerativeAdapterContract({
    adapterKind: "gemini",
    createAdapter: (baseUrl: string) =>
      new GeminiAdapter({
        apiKey: "fake-test-key",
        baseUrl,
        prices: {
          [MODEL_NAME]: {
            inputPricePerMillion: 3.0,
            outputPricePerMillion: 15.0,
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
    expectedInputTokens: 100,
    expectedOutputTokens: 50,
    expectedCostUsd: 0.00105,
    mockSafetyBlockedResponse,
    mockModelsResponse,
  });
});
