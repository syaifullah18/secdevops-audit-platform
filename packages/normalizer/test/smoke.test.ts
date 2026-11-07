import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "../src/index.js";

describe("@sdap/normalizer", () => {
  it("loads", () => {
    expect(PACKAGE_NAME).toBe("@sdap/normalizer");
  });
});
