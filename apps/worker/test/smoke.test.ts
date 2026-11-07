import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "../src/index.js";

describe("@sdap/worker", () => {
  it("loads", () => {
    expect(PACKAGE_NAME).toBe("@sdap/worker");
  });
});
