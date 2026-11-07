import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { sampleProject, setupTestApp, type TestContext } from "./helpers.js";

describe("Webhook Ingestion Tests (POST /api/v1/webhooks/:provider)", () => {
  let ctx: TestContext;
  let project: ReturnType<typeof sampleProject>;
  const WEBHOOK_SECRET = "test-webhook-secret";

  beforeEach(async () => {
    ctx = await setupTestApp();
    project = sampleProject({
      id: "00000000-0000-4000-8000-000000000401",
      slug: "webhook-repo",
      repoUrl: "https://github.com/example/webhook-repo",
    });
    await ctx.store.projects.create(project);
  });

  const sign = (body: string, secret = WEBHOOK_SECRET): string => {
    const hex = crypto.createHmac("sha256", secret).update(body).digest("hex");
    return `sha256=${hex}`;
  };

  it("rejects webhook request with missing signature (401)", async () => {
    const payload = JSON.stringify({
      ref: "refs/heads/main",
      after: "1234567890abcdef",
    });

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/webhooks/github?projectId=${project.id}`,
      headers: {
        "content-type": "application/json",
      },
      payload,
    });

    expect(res.statusCode).toBe(401);
  });

  it("rejects webhook request with invalid HMAC signature (401)", async () => {
    const payload = JSON.stringify({
      ref: "refs/heads/main",
      after: "1234567890abcdef",
    });

    const badSignature = sign(payload, "wrong-secret");

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/webhooks/github?projectId=${project.id}`,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": badSignature,
      },
      payload,
    });

    expect(res.statusCode).toBe(401);
    expect(ctx.queue.jobs.length).toBe(0);
  });

  it("accepts valid GitHub push webhook and enqueues focused run", async () => {
    const payloadObj = {
      ref: "refs/heads/feature-branch",
      after: "abcdef1234567890",
      repository: {
        html_url: project.repoUrl,
      },
    };
    const payload = JSON.stringify(payloadObj);
    const validSignature = sign(payload);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/webhooks/github?projectId=${project.id}`,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": validSignature,
      },
      payload,
    });

    expect(res.statusCode).toBe(202);
    const data = res.json();
    expect(data.status).toBe("queued");
    expect(data.runId).toBeDefined();

    // Check enqueued job in queue
    expect(ctx.queue.jobs.length).toBe(1);
    expect(ctx.queue.jobs[0]?.runId).toBe(data.runId);
    expect(ctx.queue.jobs[0]?.projectId).toBe(project.id);

    // Verify stored run
    const createdRun = await ctx.store.runs.get(data.runId, { clientIds: "*" });
    expect(createdRun).not.toBeNull();
    expect(createdRun?.mode).toBe("focused");
    expect(createdRun?.ref).toBe("feature-branch");
    expect(createdRun?.commitSha).toBe("abcdef1234567890");
    expect(createdRun?.trigger.kind).toBe("webhook");
    expect(createdRun?.trigger.actor).toBe("webhook:github");
  });

  it("accepts valid GitHub pull_request webhook and maps ref / commit", async () => {
    const payloadObj = {
      pull_request: {
        html_url: "https://github.com/example/webhook-repo/pull/42",
        head: {
          ref: "pr-auth-fix",
          sha: "fedcba0987654321",
        },
      },
      repository: {
        html_url: project.repoUrl,
      },
    };
    const payload = JSON.stringify(payloadObj);
    const validSignature = sign(payload);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/webhooks/github?projectId=${project.id}`,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": validSignature,
      },
      payload,
    });

    expect(res.statusCode).toBe(202);
    const data = res.json();

    const createdRun = await ctx.store.runs.get(data.runId, { clientIds: "*" });
    expect(createdRun?.ref).toBe("pr-auth-fix");
    expect(createdRun?.commitSha).toBe("fedcba0987654321");
    expect(createdRun?.trigger.ref).toBe("https://github.com/example/webhook-repo/pull/42");
  });

  it("accepts valid GitLab webhook with token header", async () => {
    const payloadObj = {
      object_attributes: {
        source_branch: "gitlab-patch",
        last_commit: { id: "a1b2c3d4e5f67890" },
        url: "https://gitlab.example.com/merge_requests/1",
      },
    };
    const payload = JSON.stringify(payloadObj);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/webhooks/gitlab?projectId=${project.id}`,
      headers: {
        "content-type": "application/json",
        "x-gitlab-token": WEBHOOK_SECRET,
      },
      payload,
    });

    expect(res.statusCode).toBe(202);
    const data = res.json();
    const createdRun = await ctx.store.runs.get(data.runId, { clientIds: "*" });
    expect(createdRun?.trigger.actor).toBe("webhook:gitlab");
    expect(createdRun?.ref).toBe("gitlab-patch");
  });

  it("accepts valid Bitbucket webhook", async () => {
    const payloadObj = {
      push: {
        changes: [
          {
            new: {
              name: "bb-branch",
              target: { hash: "1122334455667788" },
            },
          },
        ],
      },
    };
    const payload = JSON.stringify(payloadObj);
    const validSig = sign(payload);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/webhooks/bitbucket?projectId=${project.id}`,
      headers: {
        "content-type": "application/json",
        "x-hub-signature": validSig,
      },
      payload,
    });

    expect(res.statusCode).toBe(202);
    const data = res.json();
    const createdRun = await ctx.store.runs.get(data.runId, { clientIds: "*" });
    expect(createdRun?.trigger.actor).toBe("webhook:bitbucket");
    expect(createdRun?.ref).toBe("bb-branch");
  });

  it("returns 400 for unsupported provider", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/webhooks/unsupported-vcs",
    });
    expect(res.statusCode).toBe(400);
  });
});
