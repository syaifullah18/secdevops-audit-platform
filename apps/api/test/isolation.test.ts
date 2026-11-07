import { beforeEach, describe, expect, it } from "vitest";
import {
  sampleFinding,
  sampleProject,
  sampleRun,
  setupTestApp,
  type TestContext,
} from "./helpers.js";

describe("Client Isolation Tests (Multi-tenant isolation & 404 masking)", () => {
  let ctx: TestContext;
  let clientAToken: string;
  let clientBToken: string;

  const CLIENT_A = "client-alpha";
  const CLIENT_B = "client-beta";

  let projectA: ReturnType<typeof sampleProject>;
  let projectB: ReturnType<typeof sampleProject>;
  let runB: ReturnType<typeof sampleRun>;
  let findingB: ReturnType<typeof sampleFinding>;

  beforeEach(async () => {
    ctx = await setupTestApp();

    clientAToken = await ctx.issueToken({
      subject: "user-client-a",
      roles: ["admin"], // Admin within client-a
      clientIds: [CLIENT_A],
    });

    clientBToken = await ctx.issueToken({
      subject: "user-client-b",
      roles: ["admin"], // Admin within client-b
      clientIds: [CLIENT_B],
    });

    projectA = sampleProject({
      id: "00000000-0000-4000-8000-00000000000a",
      slug: "project-a",
      name: "Project Alpha",
      clientId: CLIENT_A,
    });
    await ctx.store.projects.create(projectA);

    projectB = sampleProject({
      id: "00000000-0000-4000-8000-00000000000b",
      slug: "project-b",
      name: "Project Beta",
      clientId: CLIENT_B,
    });
    await ctx.store.projects.create(projectB);

    runB = sampleRun({
      id: "00000000-0000-4000-8000-00000000001b",
      projectId: projectB.id,
      status: "running",
    });
    await ctx.store.runs.create(runB);

    findingB = sampleFinding({
      id: "00000000-0000-4000-8000-00000000010b",
      projectId: projectB.id,
      title: "Secret finding in Client B",
      status: "new",
    });
    await ctx.store.findings.upsert(findingB);
  });

  it("Client A gets 404 when requesting Client B project", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectB.id}`,
      headers: { authorization: `Bearer ${clientAToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("Client A gets 404 when patching Client B project", async () => {
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${projectB.id}`,
      headers: { authorization: `Bearer ${clientAToken}` },
      payload: { name: "Malicious Edit" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("Client A gets 404 when triggering run on Client B project", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/runs",
      headers: { authorization: `Bearer ${clientAToken}` },
      payload: { projectId: projectB.id },
    });
    expect(res.statusCode).toBe(404);
  });

  it("Client A gets 404 when requesting Client B run or run list", async () => {
    const getRunRes = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/runs/${runB.id}`,
      headers: { authorization: `Bearer ${clientAToken}` },
    });
    expect(getRunRes.statusCode).toBe(404);

    const listRunsRes = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectB.id}/runs`,
      headers: { authorization: `Bearer ${clientAToken}` },
    });
    expect(listRunsRes.statusCode).toBe(404);
  });

  it("Client A gets 404 when cancelling Client B run", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/runs/${runB.id}/cancel`,
      headers: { authorization: `Bearer ${clientAToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("Client A cannot list Client B findings", async () => {
    const findingA = sampleFinding({
      id: "00000000-0000-4000-8000-00000000010a",
      projectId: projectA.id,
      title: "Client A finding",
    });
    await ctx.store.findings.upsert(findingA);

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/findings",
      headers: { authorization: `Bearer ${clientAToken}` },
    });

    expect(res.statusCode).toBe(200);
    const page = res.json();
    expect(page.items.length).toBe(1);
    expect(page.items[0]?.id).toBe(findingA.id);
    expect(page.items.some((f: { id: string }) => f.id === findingB.id)).toBe(false);
  });

  it("Client A gets 404 when reading or triaging Client B finding", async () => {
    const readRes = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/findings/${findingB.id}`,
      headers: { authorization: `Bearer ${clientAToken}` },
    });
    expect(readRes.statusCode).toBe(404);

    const histRes = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/findings/${findingB.id}/history`,
      headers: { authorization: `Bearer ${clientAToken}` },
    });
    expect(histRes.statusCode).toBe(404);

    const triageRes = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/findings/${findingB.id}/triage`,
      headers: { authorization: `Bearer ${clientAToken}` },
      payload: { to: "in_progress" },
    });
    expect(triageRes.statusCode).toBe(404);
  });

  it("Client A gets 404 when checking release gate on Client B project", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectB.id}/gate`,
      headers: { authorization: `Bearer ${clientAToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("Client B CAN access own resources", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectB.id}`,
      headers: { authorization: `Bearer ${clientBToken}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
