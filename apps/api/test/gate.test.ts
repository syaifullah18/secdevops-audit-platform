import type { Exception, Finding, Policy } from "@sdap/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  sampleFinding,
  samplePolicy,
  sampleProject,
  setupTestApp,
  type TestContext,
} from "./helpers.js";

describe("Gate Evaluation Tests (GET /api/v1/projects/:id/gate)", () => {
  let ctx: TestContext;
  let token: string;
  let project: ReturnType<typeof sampleProject>;
  let policy: Policy;

  beforeEach(async () => {
    ctx = await setupTestApp();
    token = await ctx.issueToken({
      subject: "test-user",
      roles: ["security", "admin"],
      clientIds: "*",
    });

    policy = samplePolicy({
      id: "00000000-0000-4000-8000-000000000301",
      mode: "enforce",
      rules: [{ verdict: "confirmed", minSeverity: "high", attackClasses: [] }],
    });
    await ctx.store.policies.upsert(policy);

    project = sampleProject({
      id: "00000000-0000-4000-8000-000000000302",
      policyId: policy.id,
    });
    await ctx.store.projects.create(project);
  });

  it("passes when project has clean audit (no findings)", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/gate`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const gate = res.json();
    expect(gate.pass).toBe(true);
    expect(gate.violations.length).toBe(0);
    expect(gate.excepted.length).toBe(0);
  });

  it("needs_validation high never fails the gate", async () => {
    const nvFinding: Finding = sampleFinding({
      id: "00000000-0000-4000-8000-000000000311",
      projectId: project.id,
      fingerprint: "project:authz:candidate-1",
      verdict: "needs_validation",
      originalSeverity: "high",
      verifiedSeverity: null, // by definition needs_validation has null verifiedSeverity
      blockers: ["Requires live database connection to prove exploitability"],
      status: "new",
    });
    await ctx.store.findings.upsert(nvFinding);

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/gate`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const gate = res.json();
    expect(gate.pass).toBe(true);
    expect(gate.violations.length).toBe(0);
  });

  it("confirmed high DOES fail the gate", async () => {
    const confirmedHigh: Finding = sampleFinding({
      id: "00000000-0000-4000-8000-000000000312",
      projectId: project.id,
      fingerprint: "project:authz:confirmed-high",
      verdict: "confirmed",
      originalSeverity: "high",
      verifiedSeverity: "high",
      blockers: [],
      status: "confirmed",
    });
    await ctx.store.findings.upsert(confirmedHigh);

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/gate`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const gate = res.json();
    expect(gate.pass).toBe(false);
    expect(gate.violations.length).toBe(1);
    expect(gate.violations[0]?.findingId).toBe(confirmedHigh.id);
    expect(gate.violations[0]?.severity).toBe("high");
  });

  it("active exception allows confirmed high to pass gate (excepted)", async () => {
    const confirmedHigh: Finding = sampleFinding({
      id: "00000000-0000-4000-8000-000000000313",
      projectId: project.id,
      fingerprint: "project:authz:excepted-high",
      verdict: "confirmed",
      verifiedSeverity: "high",
      status: "confirmed",
    });
    await ctx.store.findings.upsert(confirmedHigh);

    // Active exception with future expiry
    const futureDate = new Date(Date.now() + 86400000 * 30).toISOString();
    const exception: Exception = {
      id: crypto.randomUUID(),
      projectId: project.id,
      fingerprint: confirmedHigh.fingerprint,
      kind: "accepted_risk",
      reason: "Migration in progress, scheduled for Q1",
      approver: "ciso@company.local",
      expiresAt: futureDate,
      createdAt: new Date().toISOString(),
    };
    await ctx.store.policies.addException(exception);

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/gate`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const gate = res.json();
    expect(gate.pass).toBe(true);
    expect(gate.violations.length).toBe(0);
    expect(gate.excepted).toContain(confirmedHigh.id);
  });

  it("expired exception causes gate to fail", async () => {
    const confirmedHigh: Finding = sampleFinding({
      id: "00000000-0000-4000-8000-000000000314",
      projectId: project.id,
      fingerprint: "project:authz:expired-high",
      verdict: "confirmed",
      verifiedSeverity: "high",
      status: "confirmed",
    });
    await ctx.store.findings.upsert(confirmedHigh);

    // Expired exception
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    const exception: Exception = {
      id: crypto.randomUUID(),
      projectId: project.id,
      fingerprint: confirmedHigh.fingerprint,
      kind: "accepted_risk",
      reason: "Old exception",
      approver: "security@company.local",
      expiresAt: pastDate,
      createdAt: new Date(Date.now() - 86400000 * 10).toISOString(),
    };
    await ctx.store.policies.addException(exception);

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/gate`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const gate = res.json();
    expect(gate.pass).toBe(false);
    expect(gate.violations.length).toBe(1);
  });

  it("report_only mode never blocks gate (pass: true with violations listed)", async () => {
    const reportPolicy = samplePolicy({
      id: crypto.randomUUID(),
      mode: "report_only",
    });
    await ctx.store.policies.upsert(reportPolicy);
    await ctx.store.projects.update(project.id, { policyId: reportPolicy.id });

    const confirmedCrit = sampleFinding({
      id: crypto.randomUUID(),
      projectId: project.id,
      fingerprint: "crit-1",
      verdict: "confirmed",
      verifiedSeverity: "critical",
      status: "confirmed",
    });
    await ctx.store.findings.upsert(confirmedCrit);

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/gate`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const gate = res.json();
    expect(gate.pass).toBe(true);
    expect(gate.mode).toBe("report_only");
    expect(gate.violations.length).toBe(1);
  });
});
