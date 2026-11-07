import { describe, expect, it } from "vitest";
import { SalvageError, salvageFindingsJson, salvageJson } from "../src/index.js";

describe("salvageJson", () => {
  it("returns clean JSON untouched", () => {
    const r = salvageJson('[{"a":1}]');
    expect(r).toEqual({ value: [{ a: 1 }], salvaged: false, warnings: [] });
  });

  it("strips a BOM", () => {
    expect(salvageJson('﻿{"a":1}').salvaged).toBe(false);
  });

  it("recovers an array from concatenated objects", () => {
    const r = salvageJson('{"a":1}\n{"b":"}{"}{"c":[1,2]}');
    expect(r.salvaged).toBe(true);
    expect(r.value).toEqual([{ a: 1 }, { b: "}{" }, { c: [1, 2] }]);
    expect(r.warnings.join(" ")).toMatch(/merged 3/);
  });

  it("merges concatenated arrays", () => {
    expect(salvageJson("[1][2,3]").value).toEqual([1, 2, 3]);
  });

  it("strips provider notices and markdown fences", () => {
    const text = 'Notice: [content filtered] by provider.\n```json\n[{"x":1}]\n```\n{not json}';
    const r = salvageJson(text);
    expect(r.value).toEqual([{ x: 1 }]);
    expect(r.salvaged).toBe(true);
    expect(r.warnings.some((w) => /stripped/.test(w))).toBe(true);
  });

  it("wraps a single recovered object when an array is expected", () => {
    expect(salvageFindingsJson('note {"a":1} note').value).toEqual([{ a: 1 }]);
    expect(salvageFindingsJson('{"a":1}').value).toEqual([{ a: 1 }]);
    expect(salvageJson('note {"a":1}').value).toEqual({ a: 1 });
  });

  it("throws when nothing is recoverable", () => {
    expect(() => salvageJson("no json here")).toThrow(SalvageError);
    expect(() => salvageJson("")).toThrow(SalvageError);
  });

  it("bounds work on pathological input", () => {
    const evil = "{".repeat(50_000);
    const started = Date.now();
    expect(() => salvageJson(evil)).toThrow(SalvageError);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("rejects oversized input", () => {
    expect(() => salvageJson("x".repeat(20), { maxChars: 10 })).toThrow(/exceeds/);
  });
});
