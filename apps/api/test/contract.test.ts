import {
  Finding,
  FindingPage,
  GateResult,
  PlatformEvent,
  Policy,
  Project,
  Run,
  RunPage,
  TriageEvent,
} from "@sdap/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  sampleFinding,
  samplePolicy,
  sampleProject,
  sampleRun,
  setupTestApp,
  type TestContext,
} from "./helpers.js";

describe("API Contract Tests (Endpoint Request / Response Validation)", () => {
  let ctx: TestContext;
  let adminToken: string;

  beforeEach(async () => {
    ctx = await setupTestApp();
    adminToken = await ctx.issueToken({
      subject: "admin-user",
      roles: ["admin"],
      clientIds: "*",
    });
  });

  it("GET /healthz returns ok status", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/healthz",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("GET /readyz returns ready status", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/readyz",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ready" });
  });

  it("GET /openapi.json returns valid OpenAPI 3.1 specification", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/openapi.json",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.openapi).toBe("3.1.0");
    expect(body.info.title).toBe("SecDevOps Audit Platform API");
    expect(body.paths["/api/v1/projects"]).toBeDefined();
  });

  it("POST /api/v1/projects and GET /api/v1/projects/:id conform to Project contract", async () => {
    const projectInput = {
      slug: "contract-proj",
      name: "Contract Project",
      repoUrl: "https://github.com/example/contract",
      defaultBranch: "main",
      team: "team-sec",
      clientId: "client-contract",
      policyId: null,
      modelRouting: [],
      escalation: null,
      criticalPaths: ["src/**"],
      monthlyTokenBudget: 100000,
    };

    const postRes = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: projectInput,
    });

    expect(postRes.statusCode).toBe(201);
    const created = postRes.json();
    expect(() => Project.parse(created)).not.toThrow();
    expect(created.slug).toBe(projectInput.slug);

    const getRes = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/projects/${created.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(getRes.statusCode).toBe(200);
    expect(() => Project.parse(getRes.json())).not.toThrow();
  });

  it("PATCH /api/v1/projects/:id conforms to Project contract", async () => {
    const project = sampleProject();
    await ctx.store.projects.create(project);

    const patchRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: "Updated Project Name" },
    });

    expect(patchRes.statusCode).toBe(200);
    const updated = patchRes.json();
    expect(() => Project.parse(updated)).not.toThrow();
    expect(updated.name).toBe("Updated Project Name");
  });

  it("POST /api/v1/runs creates queued Run and enqueues RunJob", async () => {
    const project = sampleProject();
    await ctx.store.projects.create(project);

    const runPayload = {
      projectId: project.id,
      mode: "focused",
      repeat: 1,
      ref: "HEAD",
      scope: { paths: ["src/auth"] },
      trigger: { kind: "api", ref: null },
    };

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/runs",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: runPayload,
    });

    expect(res.statusCode).toBe(201);
    const createdRun = res.json();
    expect(() => Run.parse(createdRun)).not.toThrow();
    expect(createdRun.status).toBe("queued");
    expect(createdRun.projectId).toBe(project.id);

    // Verify job was queued
    expect(ctx.queue.jobs.length).toBe(1);
    expect(ctx.queue.jobs[0]?.runId).toBe(createdRun.id);
  });

  it("GET /api/v1/runs/:id and GET /api/v1/projects/:id/runs validate against schemas", async () => {
    const project = sampleProject();
    await ctx.store.projects.create(project);
    const run = sampleRun({ projectId: project.id });
    await ctx.store.runs.create(run);

    const getRes = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/runs/${run.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(getRes.statusCode).toBe(200);
    expect(() => Run.parse(getRes.json())).not.toThrow();

    const listRes = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/runs`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(listRes.statusCode).toBe(200);
    const page = listRes.json();
    expect(() => RunPage.parse(page)).not.toThrow();
    expect(page.items.length).toBe(1);
  });

  it("POST /api/v1/runs/:id/cancel cancels active run and appends event", async () => {
    const project = sampleProject();
    await ctx.store.projects.create(project);
    const run = sampleRun({ projectId: project.id, status: "running" });
    await ctx.store.runs.create(run);

    const cancelRes = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/runs/${run.id}/cancel`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(cancelRes.statusCode).toBe(200);
    const cancelled = cancelRes.json();
    expect(() => Run.parse(cancelled)).not.toThrow();
    expect(cancelled.status).toBe("cancelled");
    expect(ctx.queue.cancelledRunIds.has(run.id)).toBe(true);

    const events = await ctx.store.events.listByRun(run.id);
    expect(events.some((e) => e.type === "run.cancelled")).toBe(true);
  });

  it("GET /api/v1/runs/:id/events returns valid PlatformEvent list", async () => {
    const project = sampleProject();
    await ctx.store.projects.create(project);
    const run = sampleRun({ projectId: project.id });
    await ctx.store.runs.create(run);

    const event: PlatformEvent = {
      id: crypto.randomUUID(),
      runId: run.id,
      projectId: project.id,
      seq: 0,
      at: new Date().toISOString(),
      type: "run.queued",
      payload: {},
    };
    await ctx.store.events.append(event);

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/runs/${run.id}/events`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const events = res.json();
    expect(Array.isArray(events)).toBe(true);
    expect(() => PlatformEvent.parse(events[0])).not.toThrow();
  });

  it("GET /api/v1/findings and GET /api/v1/findings/:id validate against Finding schemas", async () => {
    const project = sampleProject();
    await ctx.store.projects.create(project);
    const finding = sampleFinding({ projectId: project.id });
    await ctx.store.findings.upsert(finding);

    const listRes = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/findings?projectId=${project.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(listRes.statusCode).toBe(200);
    const page = listRes.json();
    expect(() => FindingPage.parse(page)).not.toThrow();
    expect(page.items.length).toBe(1);

    const getRes = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/findings/${finding.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(getRes.statusCode).toBe(200);
    expect(() => Finding.parse(getRes.json())).not.toThrow();
  });

  it("POST /api/v1/findings/:id/triage transitions finding status and records history", async () => {
    const project = sampleProject();
    await ctx.store.projects.create(project);
    const finding = sampleFinding({ projectId: project.id, status: "new" });
    await ctx.store.findings.upsert(finding);

    const triageRes = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/findings/${finding.id}/triage`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        to: "in_progress",
        reason: "Fixing in branch fix/authz",
        owner: "dev-alice",
      },
    });

    expect(triageRes.statusCode).toBe(200);
    const updated = triageRes.json();
    expect(() => Finding.parse(updated)).not.toThrow();
    expect(updated.status).toBe("in_progress");
    expect(updated.owner).toBe("dev-alice");

    const histRes = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/findings/${finding.id}/history`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(histRes.statusCode).toBe(200);
    const history = histRes.json();
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBe(1);
    expect(() => TriageEvent.parse(history[0])).not.toThrow();
  });

  it("GET /api/v1/review-queue returns needs_validation findings", async () => {
    const project = sampleProject();
    await ctx.store.projects.create(project);
    const unconfirmed = sampleFinding({
      id: crypto.randomUUID(),
      projectId: project.id,
      fingerprint: "alpha:nv:1",
      verdict: "needs_validation",
      verifiedSeverity: null,
      blockers: ["Cannot prove sink reachability"],
    });
    await ctx.store.findings.upsert(unconfirmed);

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/review-queue",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const page = res.json();
    expect(() => FindingPage.parse(page)).not.toThrow();
    expect(page.items.length).toBe(1);
    expect(page.items[0]?.verdict).toBe("needs_validation");
  });

  it("GET /api/v1/policies/:id and PUT /api/v1/policies/:id validate Policy schema", async () => {
    const policy = samplePolicy();
    await ctx.store.policies.upsert(policy);

    const getRes = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/policies/${policy.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(getRes.statusCode).toBe(200);
    expect(() => Policy.parse(getRes.json())).not.toThrow();

    const putRes = await ctx.app.inject({
      method: "PUT",
      url: `/api/v1/policies/${policy.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: "Updated Policy",
        mode: "report_only",
        rules: [{ verdict: "confirmed", minSeverity: "critical", attackClasses: [] }],
        slaDays: policy.slaDays,
      },
    });
    expect(putRes.statusCode).toBe(200);
    const updated = putRes.json();
    expect(() => Policy.parse(updated)).not.toThrow();
    expect(updated.mode).toBe("report_only");
  });

  it("GET /api/v1/projects/:id/gate returns valid GateResult", async () => {
    const project = sampleProject();
    await ctx.store.projects.create(project);

    const gateRes = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/gate`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(gateRes.statusCode).toBe(200);
    const result = gateRes.json();
    expect(() => GateResult.parse(result)).not.toThrow();
    expect(result.pass).toBe(true);
  });
});
