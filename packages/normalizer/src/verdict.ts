import type { Verdict } from "@sdap/core";

/** Thrown for a verdict word the normalizer does not know. Never silently defaulted. */
export class UnknownVerdictError extends Error {
  constructor(readonly word: string) {
    super(`Unknown verdict word: ${JSON.stringify(word)}`);
    this.name = "UnknownVerdictError";
  }
}

const VERDICT_WORDS: Readonly<Record<string, Verdict>> = {
  CONFIRMED: "confirmed",
  VALID: "confirmed",
  TRUE_POSITIVE: "confirmed",
  PLAUSIBLE: "needs_validation",
  PARTIAL: "needs_validation",
  NEEDS_VALIDATION: "needs_validation",
  UNVERIFIED: "needs_validation",
  INCONCLUSIVE: "needs_validation",
  REFUTED: "rejected",
  REJECTED: "rejected",
  FALSE_POSITIVE: "rejected",
  INVALID: "rejected",
};

const canonicalWord = (word: string): string =>
  word
    .trim()
    .replace(/[\s-]+/g, "_")
    .toUpperCase();

/**
 * Map a canonical, legacy or model-specific verdict word to one of the three
 * platform verdicts. Case, surrounding space and space/hyphen/underscore
 * separators are ignored. Throws {@link UnknownVerdictError} for anything else.
 */
export const mapVerdict = (word: unknown): Verdict => {
  if (typeof word !== "string") throw new UnknownVerdictError(String(word));
  const verdict = Object.hasOwn(VERDICT_WORDS, canonicalWord(word))
    ? VERDICT_WORDS[canonicalWord(word)]
    : undefined;
  if (verdict === undefined) throw new UnknownVerdictError(word);
  return verdict;
};
