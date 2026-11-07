import { describe, expect, it } from "vitest";
import { calculateCost } from "../src/pricing.js";

describe("Pricing and Cost Calculation", () => {
  const priceTable = {
    "gemini-4-argon": {
      inputPricePerMillion: 3.0,
      outputPricePerMillion: 15.0,
    },
    "claude-3-5-sonnet": {
      inputPricePerMillion: 3.0,
      outputPricePerMillion: 15.0,
    },
    default: {
      inputPricePerMillion: 1.0,
      outputPricePerMillion: 2.0,
    },
  };

  it("calculates cost accurately for exact model matches", () => {
    const cost = calculateCost(
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      "gemini-4-argon",
      priceTable,
    );
    expect(cost).toBe(18.0);
  });

  it("calculates cost accurately for fractional token counts", () => {
    // 500 input tokens = 500/1e6 * 3 = 0.0015
    // 200 output tokens = 200/1e6 * 15 = 0.003
    // total = 0.0045
    const cost = calculateCost(
      { inputTokens: 500, outputTokens: 200 },
      "gemini-4-argon",
      priceTable,
    );
    expect(cost).toBe(0.0045);
  });

  it("matches models via prefix matching", () => {
    // "claude-3-5-sonnet-20241022" should match "claude-3-5-sonnet"
    const cost = calculateCost(
      { inputTokens: 1_000_000, outputTokens: 0 },
      "claude-3-5-sonnet-20241022",
      priceTable,
    );
    expect(cost).toBe(3.0);
  });

  it("falls back to default pricing when model is not explicitly listed", () => {
    const cost = calculateCost(
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      "unknown-model",
      priceTable,
    );
    expect(cost).toBe(3.0);
  });

  it("returns 0 when no price table is supplied (self-hosted / unconfigured)", () => {
    const cost = calculateCost({ inputTokens: 50_000, outputTokens: 10_000 }, "vllm-llama");
    expect(cost).toBe(0);
  });
});
