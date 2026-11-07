import { describe } from "vitest";
import { ClaudeAdapter } from "../src/adapters/claude.js";
import { describeGenerativeAdapterContract } from "./contract.js";

const MODEL_NAME = "claude-3-5-sonnet-20241022";

const mockHappyResponse = {
  id: "msg_123",
  type: "message",
  role: "assistant",
  content: [{ type: "text", text: "Security audit verified. No SSRF flaws identified." }],
  model: MODEL_NAME,
  stop_reason: "end_turn",
  usage: {
    input_tokens: 120,
    output_tokens: 60,
  },
};

const mockSafetyBlockedResponse = {
  type: "error",
  error: {
    type: "refusal",
    message: "Content blocked by Anthropic safety policy",
  },
  stop_reason: "refusal",
};

const mockModelsResponse = {
  data: [{ id: MODEL_NAME }, { id: "claude-3-opus-20240229" }],
};

describe("Claude Adapter", () => {
  describeGenerativeAdapterContract({
    adapterKind: "claude",
    createAdapter: (baseUrl: string) =>
      new ClaudeAdapter({
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
    expectedInputTokens: 120,
    expectedOutputTokens: 60,
    expectedCostUsd: 0.00126,
    mockSafetyBlockedResponse,
    mockModelsResponse,
  });
});
