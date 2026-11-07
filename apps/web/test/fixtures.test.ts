import { describe, expect, it } from "vitest";
import {
  Finding,
  Project,
  Run,
  Slice,
  Policy,
  Exception,
  PlatformEvent,
} from "@sdap/core";
import {
  FIXTURE_FINDINGS,
  FIXTURE_PROJECTS,
  FIXTURE_RUNS,
  FIXTURE_SLICES,
  FIXTURE_POLICIES,
  FIXTURE_EXCEPTIONS,
  FIXTURE_EVENTS,
} from "../src/api/fixtures.js";

describe("Fixtures validation against core contracts", () => {
  it("validates all fixture projects", () => {
    for (const project of FIXTURE_PROJECTS) {
      expect(() => Project.parse(project)).not.toThrow();
    }
  });

  it("validates all fixture policies", () => {
    for (const policy of FIXTURE_POLICIES) {
      expect(() => Policy.parse(policy)).not.toThrow();
    }
  });

  it("validates all fixture exceptions", () => {
    for (const exception of FIXTURE_EXCEPTIONS) {
      expect(() => Exception.parse(exception)).not.toThrow();
    }
  });

  it("validates all fixture runs", () => {
    for (const run of FIXTURE_RUNS) {
      expect(() => Run.parse(run)).not.toThrow();
    }
  });

  it("validates all fixture slices", () => {
    for (const slice of FIXTURE_SLICES) {
      expect(() => Slice.parse(slice)).not.toThrow();
    }
  });

  it("validates all fixture findings against Finding schema (including verdict invariants)", () => {
    for (const finding of FIXTURE_FINDINGS) {
      const parsed = Finding.safeParse(finding);
      if (!parsed.success) {
        console.error("Finding validation failed:", parsed.error.issues);
      }
      expect(parsed.success).toBe(true);
    }
  });

  it("validates all fixture platform events", () => {
    for (const ev of FIXTURE_EVENTS) {
      expect(() => PlatformEvent.parse(ev)).not.toThrow();
    }
  });
});
