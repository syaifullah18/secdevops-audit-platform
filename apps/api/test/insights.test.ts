import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  sampleFinding,
  sampleProject,
  sampleRun,
  setupTestApp,
  type TestContext,
} from "./helpers.js";

const H = { authorization: "Bearer dev-admin" };
const get = (c: TestContext, url: string, headers: Record<string, string> = H) =>
  c.app.inject({ method: "GET", url: `/api/v1${url}`, headers });

describe("dashboard read routes", () => {
  let c: TestContext;
  const project = sampleProject();
  beforeEach(async () => {
    c = await setupTestApp();
    await c.store.projects.create(project);
  });
  afterEach(async () => {
    await c.app.close();
  });

  it("returns an empty overview, not an error, when there is no data", async () => {
    const res = await get(c, "/overview");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalOpenFindings).toBe(0);
    expect(body.meanTimeToRemediateDays).toBeNull();
    expect(body.trend).toEqual([]);
  });

  it("serves the built-in default policy when a project has none of its own", async () => {
    const res = await get(c, "/policies/00000000-0000-4000-8000-000000000000");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: "Default policy", mode: "enforce" });
    expect((await get(c, "/policies/11111111-1111-4111-8111-111111111111")).statusCode).toBe(404);
  });

  it("returns the review queue as a page of findings", async () => {
    const body = (await get(c, "/review-queue")).json();
    expect(body).toMatchObject({ items: [], total: 0, nextCursor: null });
  });

  it("counts open findings by severity and verdict", async () => {
    await c.store.findings.upsert(
      sampleFinding({ projectId: project.id, status: "new", verifiedSeverity: "high" }),
    );
    const body = (await get(c, "/overview")).json();
    expect(body.totalOpenFindings).toBe(1);
    expect(body.openBySeverity.high).toBe(1);
    expect(body.openByVerdict.confirmed).toBe(1);
    expect(body.crossProjectAttackClasses).toHaveLength(1);
    expect(body.trend).toHaveLength(1);
  });

  it("lists runs across projects, newest first, and their slices", async () => {
    const run = sampleRun({ projectId: project.id });
    await c.store.runs.create(run);
    const list = (await get(c, "/runs")).json();
    expect(list.items.map((r: { id: string }) => r.id)).toEqual([run.id]);
    expect((await get(c, `/runs/${run.id}/slices`)).json()).toEqual([]);
    expect((await get(c, "/runs/00000000-0000-4000-8000-0000000000ff/slices")).statusCode).toBe(
      404,
    );
  });

  it("returns zero coverage before any run has succeeded", async () => {
    const body = (await get(c, `/projects/${project.id}/coverage`)).json();
    expect(body).toMatchObject({ totalUnits: 0, auditedUnits: 0, coveragePct: 0 });
    expect(
      (await get(c, "/projects/00000000-0000-4000-8000-0000000000ff/coverage")).statusCode,
    ).toBe(404);
  });

  it("lists exceptions, and needs a session", async () => {
    expect((await get(c, "/exceptions")).json()).toEqual([]);
    expect((await get(c, "/exceptions", {})).statusCode).toBe(401);
  });
});
