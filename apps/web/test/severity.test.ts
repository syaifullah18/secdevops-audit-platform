import { describe, expect, it } from "vitest";
import { bySeverityDesc } from "../src/severity.js";

describe("bySeverityDesc", () => {
  it("orders critical before low and null last", () => {
    expect(["low", null, "critical"].sort(bySeverityDesc as never)).toEqual([
      "critical",
      "low",
      null,
    ]);
  });
});
