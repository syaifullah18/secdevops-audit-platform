import { describe, expect, it } from "vitest";
import {
  CreateRunRequest,
  Exception,
  Finding,
  GateRule,
  JevDecision,
  JevQuestion,
  ModelAdapterError,
  PlatformEvent,
  canTransition,
  computeSlaDue,
  escalationReason,
  evaluateGate,
  modelFamily,
} from "../src/index.js";
import { makeFinding } from "../src/testing.js";

const NOW = new Date("2026-11-07T00:00:00Z");

describe("Finding", () => {
  it("accepts a valid confirmed finding", () => {
    expect(Finding.safeParse(makeFinding()).success).toBe(true);
  });

  it("requires verifiedSeverity on confirmed", () => {
    expect(Finding.safeParse(makeFinding({ verifiedSeverity: null })).success).toBe(false);
  });

  it("forbids severity and requires blockers on needs_validation", () => {
    const bad = makeFinding({ verdict: "needs_validation", verifiedSeverity: "low", blockers: [] });
    const r = Finding.safeParse(bad);
    expect(r.success).toBe(false);
    const ok = makeFinding({
      verdict: "needs_validation",
      verifiedSeverity: null,
      blockers: ["Is the route mounted behind the admin filter?"],
    });
    expect(Finding.safeParse(ok).success).toBe(true);
  });

  it("requires a reason on rejected", () => {
    expect(
      Finding.safeParse(makeFinding({ verdict: "rejected", verifiedSeverity: null })).success,
    ).toBe(false);
  });

  it("rejects absolute and parent-escaping paths", () => {
    const f = makeFinding({ location: { file: "/etc/passwd", line: 1 } });
    expect(Finding.safeParse(f).success).toBe(false);
    const g = makeFinding({ location: { file: "a/../../b", line: 1 } });
    expect(Finding.safeParse(g).success).toBe(false);
  });
});

describe("triage transitions", () => {
  it("allows new -> confirmed and blocks fixed -> false_positive", () => {
    expect(canTransition("new", "confirmed")).toBe(true);
    expect(canTransition("fixed", "false_positive")).toBe(false);
  });
});

describe("gate", () => {
  const policy = {
    mode: "enforce" as const,
    rules: [{ verdict: "confirmed" as const, minSeverity: "high" as const, attackClasses: [] }],
  };

  it("fails on an open confirmed high", () => {
    const r = evaluateGate(policy, [makeFinding()], [], NOW);
    expect(r.pass).toBe(false);
    expect(r.violations).toHaveLength(1);
  });

  it("never fails on needs_validation or rejected", () => {
    const nv = makeFinding({
      verdict: "needs_validation",
      verifiedSeverity: null,
      blockers: ["x"],
    });
    const rj = makeFinding({ verdict: "rejected", verifiedSeverity: null, rejectionReason: "x" });
    expect(evaluateGate(policy, [nv, rj], [], NOW).pass).toBe(true);
  });

  it("ignores closed findings and medium below threshold", () => {
    const fixed = makeFinding({ status: "fixed" });
    const med = makeFinding({ verifiedSeverity: "medium" });
    expect(evaluateGate(policy, [fixed, med], [], NOW).pass).toBe(true);
  });

  it("uses verified severity, not hunter severity", () => {
    const f = makeFinding({ originalSeverity: "critical", verifiedSeverity: "low" });
    expect(evaluateGate(policy, [f], [], NOW).pass).toBe(true);
  });

  it("honours active exceptions and ignores expired ones", () => {
    const f = makeFinding();
    const ex = {
      id: "00000000-0000-4000-8000-0000000000e1",
      projectId: f.projectId,
      fingerprint: f.fingerprint,
      kind: "accepted_risk" as const,
      reason: "compensating control",
      approver: "security-lead",
      expiresAt: "2026-12-01T00:00:00Z",
      createdAt: "2026-11-01T00:00:00Z",
    };
    expect(evaluateGate(policy, [f], [ex], NOW).pass).toBe(true);
    expect(
      evaluateGate(policy, [f], [{ ...ex, expiresAt: "2026-11-02T00:00:00Z" }], NOW).pass,
    ).toBe(false);
  });

  it("report_only always passes but still lists violations", () => {
    const r = evaluateGate({ ...policy, mode: "report_only" }, [makeFinding()], [], NOW);
    expect(r.pass).toBe(true);
    expect(r.violations).toHaveLength(1);
  });

  it("schema refuses rules on anything but confirmed", () => {
    expect(GateRule.safeParse({ verdict: "needs_validation", minSeverity: "high" }).success).toBe(
      false,
    );
  });

  it("accepted_risk exceptions need an expiry", () => {
    const r = Exception.safeParse({
      id: "00000000-0000-4000-8000-0000000000e1",
      projectId: "00000000-0000-4000-8000-0000000000aa",
      fingerprint: "fp",
      kind: "accepted_risk",
      reason: "r",
      approver: "a",
      expiresAt: null,
      createdAt: "2026-11-01T00:00:00Z",
    });
    expect(r.success).toBe(false);
  });
});

describe("SLA", () => {
  it("computes due dates from verified severity", () => {
    expect(computeSlaDue("critical", "2026-11-01T00:00:00.000Z")).toBe("2026-11-08T00:00:00.000Z");
    expect(computeSlaDue("informational", "2026-11-01T00:00:00.000Z")).toBeNull();
    expect(computeSlaDue(null, "2026-11-01T00:00:00.000Z")).toBeNull();
  });
});

describe("Jev contracts", () => {
  const q = {
    id: "00000000-0000-4000-8000-0000000000f1",
    key: "change.touches_authz",
    kind: "binary",
    prompt: "Does this diff touch authorization?",
    subject: { type: "diff", ref: "abc123..def456" },
    projectId: null,
  };

  it("parses questions and decisions", () => {
    expect(JevQuestion.parse(q).kind).toBe("binary");
    const d = JevDecision.parse({
      questionId: q.id,
      key: q.key,
      kind: "binary",
      probability: 0.52,
      source: "mock",
      model: "jev",
      modelVersion: "2026-10-01",
      latencyMs: 12,
      decidedAt: "2026-11-07T00:00:00Z",
    });
    expect(d.kind).toBe("binary");
    if (d.kind === "binary") {
      expect(
        escalationReason(d, { thresholds: {}, defaultThreshold: 0.6, uncertaintyBand: 0.1 }),
      ).toBe("uncertain");
      expect(
        escalationReason(
          { ...d, probability: 0.45 },
          {
            thresholds: { "change.touches_authz": 0.4 },
            defaultThreshold: 0.6,
            uncertaintyBand: 0,
          },
        ),
      ).toBe("above_threshold");
      expect(
        escalationReason(
          { ...d, probability: 0.1 },
          { thresholds: {}, defaultThreshold: 0.6, uncertaintyBand: 0.1 },
        ),
      ).toBeNull();
    }
  });
});

describe("events", () => {
  it("parses a finding.upserted event", () => {
    const e = PlatformEvent.parse({
      id: "00000000-0000-4000-8000-000000000101",
      runId: "00000000-0000-4000-8000-000000000102",
      projectId: "00000000-0000-4000-8000-000000000103",
      seq: 3,
      at: "2026-11-07T00:00:00Z",
      type: "finding.upserted",
      payload: {
        findingId: "00000000-0000-4000-8000-000000000104",
        fingerprint: "fp-1",
        verdict: "confirmed",
        verifiedSeverity: "high",
        status: "new",
        isNew: true,
      },
    });
    expect(e.type).toBe("finding.upserted");
  });
});

describe("model helpers", () => {
  it("classifies families and fallback errors", () => {
    expect(modelFamily({ adapter: "claude", model: "claude-opus-5-5" })).toBe("anthropic");
    expect(modelFamily({ adapter: "gemini", model: "gemini-4-argon" })).toBe("google");
    expect(new ModelAdapterError("quota_exceeded", "x", "q").shouldFallBack).toBe(true);
    expect(new ModelAdapterError("timeout", "x", "t").shouldFallBack).toBe(false);
  });

  it("applies run request defaults", () => {
    const r = CreateRunRequest.parse({ projectId: "00000000-0000-4000-8000-0000000000aa" });
    expect(r.mode).toBe("focused");
    expect(r.ref).toBe("HEAD");
  });
});
