import { Finding } from "@sdap/core";
import { describe, expect, it } from "vitest";
import { mergeFindings, secondaryFingerprint } from "../src/index.js";

const PROJECT_ID = "00000000-0000-4000-8000-0000000000aa";
const RUN_1 = "00000000-0000-4000-8000-0000000000b1";
const RUN_2 = "00000000-0000-4000-8000-0000000000b2";
const RUN_3 = "00000000-0000-4000-8000-0000000000b3";
const RUN_4 = "00000000-0000-4000-8000-0000000000b4";

const baseFinding = (overrides: Partial<Finding> = {}): Finding =>
  Finding.parse({
    id: "00000000-0000-4000-8000-000000000001",
    projectId: PROJECT_ID,
    fingerprint: "fp-order-idor-42",
    sourceRun: RUN_1,
    firstRun: RUN_1,
    attackClass: "authz",
    cwe: null,
    title: "Order IDOR allows viewing other users' orders",
    description: "User id is taken from request body instead of session context",
    rootCause: "Order service trusts client-supplied tenant id without validation",
    location: { file: "src/orders/service.ts", line: 42 },
    trace: [
      {
        kind: "entrypoint",
        file: "src/orders/routes.ts",
        line: 10,
        scope: "getOrderHandler",
        description: "Request received",
      },
      {
        kind: "sink",
        file: "src/orders/service.ts",
        line: 42,
        scope: "getOrderById",
        description: "Direct DB query by client id",
      },
    ],
    evidence: [
      {
        file: "src/orders/service.ts",
        line: 42,
        description: "db.orders.find(req.params.id)",
      },
    ],
    verdict: "confirmed",
    originalSeverity: null,
    verifiedSeverity: "high",
    confidence: "high",
    status: "new",
    owner: null,
    firstSeen: "2026-11-01T10:00:00.000Z",
    lastSeen: "2026-11-01T10:00:00.000Z",
    slaDue: "2026-12-01T10:00:00.000Z",
    model: { adapter: "mock", model: "test-model" },
    phase: "record_verify",
    blockers: [],
    rejectionReason: null,
    remediation: {
      strategy: "Enforce session tenant ID in query",
      codeChanges: [],
    },
    triageSuggestion: null,
    rootCauseGroup: null,
    ...overrides,
  });

describe("mergeFindings", () => {
  it("dedup test: same finding in run 2 at a moved line keeps same id, firstSeen, and carries status", () => {
    const existing = baseFinding({
      status: "in_progress",
      owner: "alice@example.com",
      firstSeen: "2026-11-01T10:00:00.000Z",
      lastSeen: "2026-11-01T10:00:00.000Z",
    });

    // In run 2, code refactoring moved the method from line 42 to line 85.
    // The skill's primary fingerprint changed from `fp-order-idor-42` to `fp-order-idor-85`.
    const run2Time = "2026-11-05T12:00:00.000Z";
    const incoming = baseFinding({
      id: "00000000-0000-4000-8000-000000000099", // generated new id for run 2 before merge
      fingerprint: "fp-order-idor-85",
      sourceRun: RUN_2,
      firstRun: RUN_2,
      location: { file: "src/orders/service.ts", line: 85 },
      trace: [
        {
          kind: "entrypoint",
          file: "src/orders/routes.ts",
          line: 15,
          scope: "getOrderHandler",
          description: "Request received",
        },
        {
          kind: "sink",
          file: "src/orders/service.ts",
          line: 85,
          scope: "getOrderById",
          description: "Direct DB query by client id",
        },
      ],
      evidence: [
        {
          file: "src/orders/service.ts",
          line: 85,
          description: "db.orders.find(req.params.id)",
        },
      ],
      firstSeen: run2Time,
      lastSeen: run2Time,
      status: "new",
      owner: null,
    });

    // Verify secondary fingerprint matches despite line number difference
    expect(secondaryFingerprint(existing)).toBe(secondaryFingerprint(incoming));

    const outcomes = mergeFindings([existing], [incoming], run2Time);
    expect(outcomes).toHaveLength(1);
    const outcome = outcomes[0]!;

    expect(outcome.isNew).toBe(false);
    expect(outcome.matchedBy).toBe("secondary");
    expect(outcome.fingerprintChanged).toBe(true);

    const merged = outcome.finding;
    // Carries identity and history forward
    expect(merged.id).toBe(existing.id);
    expect(merged.firstSeen).toBe(existing.firstSeen);
    expect(merged.firstRun).toBe(existing.firstRun);
    expect(merged.status).toBe("in_progress");
    expect(merged.owner).toBe("alice@example.com");

    // Updates to latest run details
    expect(merged.sourceRun).toBe(RUN_2);
    expect(merged.lastSeen).toBe(run2Time);
    expect(merged.location).toEqual({ file: "src/orders/service.ts", line: 85 });
    expect(merged.trace[1]?.line).toBe(85);
  });

  it("exact fingerprint match: updates lastSeen and sourceRun, carries triage status", () => {
    const existing = baseFinding({
      status: "confirmed",
      owner: "bob@example.com",
      firstSeen: "2026-11-01T10:00:00.000Z",
    });

    const run2Time = "2026-11-03T10:00:00.000Z";
    const incoming = baseFinding({
      sourceRun: RUN_2,
      firstRun: RUN_2,
      firstSeen: run2Time,
      lastSeen: run2Time,
      status: "new",
    });

    const outcomes = mergeFindings([existing], [incoming], run2Time);
    expect(outcomes).toHaveLength(1);
    const outcome = outcomes[0]!;

    expect(outcome.isNew).toBe(false);
    expect(outcome.matchedBy).toBe("fingerprint");
    expect(outcome.finding.id).toBe(existing.id);
    expect(outcome.finding.status).toBe("confirmed");
    expect(outcome.finding.owner).toBe("bob@example.com");
    expect(outcome.finding.firstSeen).toBe("2026-11-01T10:00:00.000Z");
    expect(outcome.finding.lastSeen).toBe(run2Time);
    expect(outcome.finding.sourceRun).toBe(RUN_2);
  });

  it("verdict change: confirmed -> rejected in later run keeps status and records change", () => {
    const existing = baseFinding({ status: "confirmed", verdict: "confirmed" });
    const run2Time = "2026-11-04T12:00:00.000Z";

    const incoming = Finding.parse({
      ...baseFinding(),
      sourceRun: RUN_2,
      verdict: "rejected",
      verifiedSeverity: null,
      rejectionReason: "Proven unreachable after framework middleware authentication check",
      remediation: null,
      confidence: null,
    });

    const outcomes = mergeFindings([existing], [incoming], run2Time);
    const outcome = outcomes[0]!;

    expect(outcome.verdictChange).toEqual({
      from: "confirmed",
      to: "rejected",
      at: run2Time,
      runId: RUN_2,
    });
    // Keeps triage status
    expect(outcome.finding.status).toBe("confirmed");
    expect(outcome.finding.verdict).toBe("rejected");
    expect(outcome.finding.rejectionReason).toBe(
      "Proven unreachable after framework middleware authentication check",
    );
  });

  it("regression: fixed finding seen again resets status to confirmed", () => {
    const existing = baseFinding({
      status: "fixed",
      firstSeen: "2026-11-01T10:00:00.000Z",
    });

    const run2Time = "2026-11-06T14:00:00.000Z";
    const incoming = baseFinding({
      sourceRun: RUN_4,
      verdict: "confirmed",
      verifiedSeverity: "critical",
    });

    const outcomes = mergeFindings([existing], [incoming], run2Time);
    const outcome = outcomes[0]!;

    expect(outcome.regression).toBe(true);
    expect(outcome.finding.status).toBe("confirmed");
    // Regression recalculates SLA from now
    expect(outcome.finding.slaDue).toBe("2026-11-13T14:00:00.000Z"); // 7 days for critical
  });

  it("repeat-N merge: same fingerprint in multiple runs collapses into one with highest severity and raised confidence", () => {
    const run1 = baseFinding({
      sourceRun: RUN_1,
      verifiedSeverity: "medium",
      confidence: "low",
      firstSeen: "2026-11-01T10:00:00.000Z",
    });
    const run2 = baseFinding({
      sourceRun: RUN_2,
      verifiedSeverity: "high",
      confidence: "low",
      firstSeen: "2026-11-01T10:05:00.000Z",
    });
    const run3 = baseFinding({
      sourceRun: RUN_3,
      verifiedSeverity: "medium",
      confidence: "medium",
      firstSeen: "2026-11-01T10:10:00.000Z",
    });

    const outcomes = mergeFindings([], [run1, run2, run3], "2026-11-01T10:15:00.000Z");
    expect(outcomes).toHaveLength(1);
    const collapsed = outcomes[0]!.finding;

    // Highest severity wins
    expect(collapsed.verifiedSeverity).toBe("high");
    // Earliest firstSeen kept
    expect(collapsed.firstSeen).toBe("2026-11-01T10:00:00.000Z");
    // 3 agreeing runs bump confidence from medium to high (or low + 2 steps = high)
    expect(collapsed.confidence).toBe("high");
  });
});
