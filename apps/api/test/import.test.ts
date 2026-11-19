import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleProject, setupTestApp, type TestContext } from "./helpers.js";

const golden = (p: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../../packages/normalizer/test/golden/${p}`, import.meta.url), "utf8"),
  );

const H = { authorization: "Bearer dev-admin" };

describe("POST /projects/:id/import", () => {
  let c: TestContext;
  const project = sampleProject();
  const post = (body: unknown, headers: Record<string, string> = H, id = project.id) =>
    c.app.inject({
      method: "POST",
      url: `/api/v1/projects/${id}/import`,
      headers,
      payload: body as object,
    });

  beforeEach(async () => {
    c = await setupTestApp();
    await c.store.projects.create(project);
  });
  afterEach(async () => {
    await c.app.close();
  });

  it("imports a findings.json and shows it through the findings and overview routes", async () => {
    const findings = golden("mixed/findings.json");
    const res = await post({ findings });
    expect(res.statusCode).toBe(201);
    const out = res.json();
    expect(out.imported).toBe((findings as unknown[]).length);
    expect(out.created).toBe(out.imported);

    const list = await c.app.inject({
      method: "GET",
      url: `/api/v1/findings?projectId=${project.id}&includeRejected=true&limit=200`,
      headers: H,
    });
    expect(list.json().total).toBe(out.imported);
    const runs = await c.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/runs`,
      headers: H,
    });
    expect(runs.json().items[0].id).toBe(out.runId);
  });

  it("importing the same file again updates findings instead of duplicating them", async () => {
    const findings = golden("mixed/findings.json");
    const first = (await post({ findings })).json();
    const second = (await post({ findings })).json();
    expect(second.created).toBe(0);
    expect(second.updated).toBe(first.imported);
  });

  it("rejects malformed input with a 400 and stores nothing", async () => {
    expect((await post({ findings: { not: "an array" } })).statusCode).toBe(400);
    expect((await post({ findings: [{ verdict: "confirmed" }] })).statusCode).toBe(400);
    expect((await post({ findings: [], coverageLedger: "nope" })).statusCode).toBe(400);
    const list = await c.app.inject({ method: "GET", url: "/api/v1/findings", headers: H });
    expect(list.json().total).toBe(0);
  });

  it("needs a session, an existing project and the devops or security role", async () => {
    expect((await post({ findings: [] }, {})).statusCode).toBe(401);
    expect(
      (await post({ findings: [] }, H, "00000000-0000-4000-8000-0000000000ff")).statusCode,
    ).toBe(404);
    expect((await post({ findings: [] }, { authorization: "Bearer dev-viewer" })).statusCode).toBe(
      403,
    );
  });
});
