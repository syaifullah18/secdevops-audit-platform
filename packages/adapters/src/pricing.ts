import type { PriceTable, TokenPricing } from "./types.js";

/**
 * Calculates the USD cost of a model invocation given token usage and a price table.
 * If the model is not found in the price table, cost is 0 (appropriate for self-hosted or default).
 */
export function calculateCost(
  usage: { inputTokens: number; outputTokens: number },
  model: string,
  priceTable?: PriceTable,
): number {
  if (!priceTable) {
    return 0;
  }

  const pricing = resolvePricing(model, priceTable);
  if (!pricing) {
    return 0;
  }

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPricePerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPricePerMillion;
  const total = inputCost + outputCost;

  // Round to 8 decimal places to avoid floating point precision artifacts
  return Math.round(total * 1e8) / 1e8;
}

/**
 * Resolves pricing for a model by exact match, case-insensitive match, or prefix match.
 */
function resolvePricing(model: string, priceTable: PriceTable): TokenPricing | undefined {
  if (priceTable[model]) {
    return priceTable[model];
  }

  const lowerModel = model.toLowerCase();
  for (const [key, value] of Object.entries(priceTable)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === lowerModel) {
      return value;
    }
  }

  // Prefix match (e.g. key "claude-3-5-sonnet" matches "claude-3-5-sonnet-20241022")
  for (const [key, value] of Object.entries(priceTable)) {
    const lowerKey = key.toLowerCase();
    if (lowerModel.startsWith(lowerKey)) {
      return value;
    }
  }

  return priceTable["default"];
}
