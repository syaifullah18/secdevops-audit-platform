import { describe, expect, it } from "vitest";
import { mapVerdict, UnknownVerdictError } from "../src/index.js";

describe("mapVerdict", () => {
  it.each([
    ["CONFIRMED", "confirmed"],
    ["valid", "confirmed"],
    ["True Positive", "confirmed"],
    ["true-positive", "confirmed"],
    ["PLAUSIBLE", "needs_validation"],
    ["partial", "needs_validation"],
    ["needs_validation", "needs_validation"],
    ["Needs Validation", "needs_validation"],
    ["UNVERIFIED", "needs_validation"],
    ["inconclusive", "needs_validation"],
    ["REFUTED", "rejected"],
    ["rejected", "rejected"],
    ["False-Positive", "rejected"],
    ["  invalid ", "rejected"],
  ])("%s -> %s", (word, expected) => {
    expect(mapVerdict(word)).toBe(expected);
  });

  it.each(["", "maybe", "CONFIRMED!", "toString", "__proto__", "constructor"])(
    "throws for unknown word %j",
    (word) => {
      expect(() => mapVerdict(word)).toThrow(UnknownVerdictError);
    },
  );

  it("throws for non-strings", () => {
    expect(() => mapVerdict(undefined)).toThrow(UnknownVerdictError);
    expect(() => mapVerdict(3)).toThrow(UnknownVerdictError);
  });
});
