import type { PlatformEvent } from "@sdap/core";
import { beforeEach, describe, expect, it } from "vitest";
import { sampleProject, sampleRun, setupTestApp, type TestContext } from "./helpers.js";

describe("Event Streaming and Error Formatting Tests", () => {
  let ctx: TestContext;
  let token: string;
  let project: ReturnType<typeof sampleProject>;
  let run: ReturnType<typeof sampleRun>;

  beforeEach(async () => {
    ctx = await setupTestApp();
    token = await ctx.issueToken({
      subject: "devops-user",
      roles: ["devops"],
      clientIds: "*",
    });

    project = sampleProject();
    await ctx.store.projects.create(project);

    run = sampleRun({ projectId: project.id, status: "succeeded" });
    await ctx.store.runs.create(run);
  });

  it("GET /api/v1/runs/:id/events/stream streams events as SSE and closes on terminal run", async () => {
    const event1: PlatformEvent = {
      id: crypto.randomUUID(),
      runId: run.id,
      projectId: project.id,
      seq: 0,
      at: new Date().toISOString(),
      type: "run.queued",
      payload: {},
    };
    const event2: PlatformEvent = {
      id: crypto.randomUUID(),
      runId: run.id,
      projectId: project.id,
      seq: 1,
      at: new Date().toISOString(),
      type: "run.started",
      payload: { commitSha: "1234567", skillVersion: "0.1.0" },
    };
    await ctx.store.events.append(event1);
    await ctx.store.events.append(event2);

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/runs/${run.id}/events/stream`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(res.body).toContain("event: run.queued");
    expect(res.body).toContain("event: run.started");
    expect(res.body).toContain(`id: 0`);
    expect(res.body).toContain(`id: 1`);
  });

  it("handles malformed JSON body with ApiError 400 response", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: "invalid-json{",
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBeDefined();
    expect(body.message).toBeDefined();
  });

  it("handles missing bearer token with ApiError 401 response", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/projects",
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBe("Unauthorized");
  });
});
