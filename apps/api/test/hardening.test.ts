import crypto from "node:crypto";
import type { PlatformEvent, Role } from "@sdap/core";
import { SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuthVerifier, parseClientIds } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { getOpenApiSpec } from "../src/openapi.js";
import {
  createTestKeyPair,
  createToken,
  sampleFinding,
  samplePolicy,
  sampleProject,
  sampleRun,
  setupTestApp,
  TEST_AUDIENCE,
  TEST_ISSUER,
  WEBHOOK_SECRET,
  type TestContext,
} from "./helpers.js";

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe("Authentication", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupTestApp();
  });

  const get = (token: string) =>
    ctx.app.inject({ method: "GET", url: "/api/v1/projects", headers: auth(token) });

  it("rejects an expired token, a wrong audience and a wrong issuer (401)", async () => {
    const user = { subject: "u", roles: ["admin" as Role], clientIds: "*" as const };
    const expired = await new SignJWT({ roles: user.roles, clientIds: "*" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
      .setSubject("u")
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_AUDIENCE)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(ctx.keys.privateKey);
    expect((await get(expired)).statusCode).toBe(401);
    const badAud = await createToken(user, ctx.keys.privateKey, { audience: "someone-else" });
    expect((await get(badAud)).statusCode).toBe(401);
    const badIss = await createToken(user, ctx.keys.privateKey, { issuer: "https://evil.example" });
    expect((await get(badIss)).statusCode).toBe(401);
  });

  it("rejects a token signed by an unknown key (401)", async () => {
    const other = await createTestKeyPair();
    const token = await createToken(
      { subject: "u", roles: ["admin"], clientIds: "*" },
      other.privateKey,
    );
    expect((await get(token)).statusCode).toBe(401);
  });

  it("returns 403 for a valid token without any recognised role", async () => {
    const token = await ctx.issueToken({ subject: "u", roles: [], clientIds: "*" });
    expect((await get(token)).statusCode).toBe(403);
  });

  it("fails closed when the clientIds claim is missing: nothing is visible", async () => {
    await ctx.store.projects.create(sampleProject());
    // clientIds omitted from the claims entirely.
    const noClaim = await new SignJWT({ roles: ["admin"] })
      .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
      .setSubject("u")
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_AUDIENCE)
      .setExpirationTime("1h")
      .sign(ctx.keys.privateKey);
    const res = await get(noClaim);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    expect(parseClientIds(undefined)).toEqual([]);
    expect(parseClientIds(["a", 3, ""])).toEqual(["a"]);
    expect(parseClientIds(["*"])).toBe("*");
  });

  it("accepts static dev tokens only when dev mode is on", async () => {
    // setupTestApp enables dev mode.
    expect((await get("dev-admin")).statusCode).toBe(200);

    const strict = await setupTestApp({ devMode: false });
    const res = await strict.app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: auth("dev-admin"),
    });
    expect(res.statusCode).toBe(401);
  });

  it("dev mode can never be enabled in production, even through overrides", () => {
    const cfg = loadConfig(
      { authDevMode: true },
      { NODE_ENV: "production", AUTH_DEV_MODE: "true" },
    );
    expect(cfg.authDevMode).toBe(false);
    expect(loadConfig({}, { NODE_ENV: "development", AUTH_DEV_MODE: "true" }).authDevMode).toBe(
      true,
    );
  });

  it("refuses to start without OIDC or dev mode instead of falling back to open access", () => {
    expect(() => createAuthVerifier(loadConfig({}, { NODE_ENV: "production" }))).toThrow(
      /not configured/,
    );
  });

  it("does not leak token verification details", async () => {
    const res = await get("not-a-jwt");
    expect(res.statusCode).toBe(401);
    expect(res.headers["www-authenticate"]).toContain("Bearer");
    expect(res.json().message).toBe("Invalid or expired token");
  });
});

describe("Audit log", () => {
  it("writes actor, action, target and status for mutating requests only", async () => {
    const ctx = await setupTestApp();
    const project = sampleProject();
    await ctx.store.projects.create(project);
    const devops = await ctx.issueToken({ subject: "ops-1", roles: ["devops"], clientIds: "*" });
    const viewer = await ctx.issueToken({ subject: "view-1", roles: ["viewer"], clientIds: "*" });

    await ctx.app.inject({ method: "GET", url: "/api/v1/projects", headers: auth(devops) });
    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/runs",
      headers: auth(devops),
      payload: { projectId: project.id },
    });
    const denied = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/runs",
      headers: auth(viewer),
      payload: { projectId: project.id },
    });
    expect(created.statusCode).toBe(201);
    expect(denied.statusCode).toBe(403);

    const audits = ctx
      .logs()
      .map((l) => l["audit"] as Record<string, unknown> | undefined)
      .filter((a): a is Record<string, unknown> => a !== undefined);
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({
      actor: "ops-1",
      action: "run.create",
      target: created.json().id,
      status: 201,
    });
    expect(audits[1]).toMatchObject({ actor: "view-1", status: 403 });
    expect(typeof audits[0]?.["at"]).toBe("string");
  });
});

describe("Findings and projects", () => {
  let ctx: TestContext;
  let admin: string;
  const project = sampleProject();

  beforeEach(async () => {
    ctx = await setupTestApp();
    admin = await ctx.issueToken({ subject: "admin-1", roles: ["admin"], clientIds: "*" });
    await ctx.store.projects.create(project);
  });

  it("hides rejected findings by default, including with includeRejected=false", async () => {
    await ctx.store.findings.upsert(sampleFinding({ projectId: project.id }));
    await ctx.store.findings.upsert(
      sampleFinding({
        id: "00000000-0000-4000-8000-000000000102",
        projectId: project.id,
        fingerprint: "alpha:injection:rejected-1",
        attackClass: "injection",
        location: { file: "src/other.ts", line: 7 },
        verdict: "rejected",
        verifiedSeverity: null,
        rejectionReason: "not reachable",
      }),
    );
    const ids = async (qs: string) =>
      (
        await ctx.app.inject({ method: "GET", url: `/api/v1/findings${qs}`, headers: auth(admin) })
      ).json().items.length as number;
    expect(await ids("")).toBe(1);
    expect(await ids("?includeRejected=false")).toBe(1);
    expect(await ids("?includeRejected=true")).toBe(2);
    expect(await ids("?verdict=rejected")).toBe(1);
  });

  it("validates query parameters and path ids", async () => {
    const bad = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/findings?limit=9999",
      headers: auth(admin),
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().details).toBeDefined();
    const notUuid = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/runs/not-a-uuid",
      headers: auth(admin),
    });
    expect(notUuid.statusCode).toBe(404);
    const badPage = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/runs?limit=abc`,
      headers: auth(admin),
    });
    expect(badPage.statusCode).toBe(400);
  });

  it("PATCH only changes the fields that were sent", async () => {
    await ctx.store.projects.update(project.id, {
      defaultBranch: "develop",
      criticalPaths: ["a/**"],
    });
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}`,
      headers: auth(admin),
      payload: { name: "Renamed" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      name: "Renamed",
      defaultBranch: "develop",
      criticalPaths: ["a/**"],
    });
    const empty = await ctx.app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}`,
      headers: auth(admin),
      payload: {},
    });
    expect(empty.statusCode).toBe(400);
  });

  it("scoped users cannot create or move projects into another client, and slugs are unique", async () => {
    const scoped = await ctx.issueToken({
      subject: "dev-ops-a",
      roles: ["devops"],
      clientIds: [project.clientId],
    });
    const body = {
      slug: "other",
      name: "Other",
      repoUrl: "https://git.example/other",
      team: "team-alpha",
    };
    const foreign = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: auth(scoped),
      payload: { ...body, clientId: "client-zzz" },
    });
    expect(foreign.statusCode).toBe(403);
    const dup = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: auth(scoped),
      payload: { ...body, slug: project.slug, clientId: project.clientId },
    });
    expect(dup.statusCode).toBe(409);
    const move = await ctx.app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}`,
      headers: auth(scoped),
      payload: { clientId: "client-zzz" },
    });
    expect(move.statusCode).toBe(403);
    expect((await ctx.store.projects.get(project.id, { clientIds: "*" }))?.clientId).toBe(
      project.clientId,
    );
  });

  it("a client cannot read or overwrite a policy attached to another client's project", async () => {
    const policy = samplePolicy();
    await ctx.store.policies.upsert(policy);
    await ctx.store.projects.update(project.id, { policyId: policy.id });
    const other = await ctx.issueToken({
      subject: "sec-b",
      roles: ["security"],
      clientIds: ["client-b"],
    });
    const read = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/policies/${policy.id}`,
      headers: auth(other),
    });
    expect(read.statusCode).toBe(404);
    const write = await ctx.app.inject({
      method: "PUT",
      url: `/api/v1/policies/${policy.id}`,
      headers: auth(other),
      payload: { name: "weakened", mode: "report_only" },
    });
    expect(write.statusCode).toBe(404);
    expect((await ctx.store.policies.get(policy.id))?.mode).toBe("enforce");

    const owner = await ctx.issueToken({
      subject: "sec-a",
      roles: ["security"],
      clientIds: [project.clientId],
    });
    const ok = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/policies/${policy.id}`,
      headers: auth(owner),
    });
    expect(ok.statusCode).toBe(200);
  });
});

describe("Triage rules", () => {
  let ctx: TestContext;
  let security: string;
  const project = sampleProject();
  const triage = (id: string, payload: Record<string, unknown>, token = security) =>
    ctx.app.inject({
      method: "POST",
      url: `/api/v1/findings/${id}/triage`,
      headers: auth(token),
      payload,
    });
  const gate = async () =>
    (
      await ctx.app.inject({
        method: "GET",
        url: `/api/v1/projects/${project.id}/gate`,
        headers: auth(security),
      })
    ).json() as { pass: boolean; violations: unknown[] };

  beforeEach(async () => {
    ctx = await setupTestApp();
    security = await ctx.issueToken({ subject: "sec-1", roles: ["security"], clientIds: "*" });
    await ctx.store.projects.create(project);
  });

  it("enforces required fields and legal transitions", async () => {
    const f = sampleFinding({ projectId: project.id });
    await ctx.store.findings.upsert(f);
    expect((await triage(f.id, { to: "accepted_risk", reason: "ok" })).statusCode).toBe(400);
    expect(
      (await triage(f.id, { to: "accepted_risk", expiresAt: "2020-01-01T00:00:00Z" })).statusCode,
    ).toBe(400);
    expect((await triage(f.id, { to: "false_positive" })).statusCode).toBe(400);
    expect((await triage(f.id, { to: "false_positive", reason: "  " })).statusCode).toBe(400);
    // new -> fixed is not a legal transition
    expect((await triage(f.id, { to: "fixed" })).statusCode).toBe(400);
    expect((await triage(f.id, { to: "nonsense" })).statusCode).toBe(400);
    expect((await ctx.store.findings.history(f.id)).length).toBe(0);
    expect((await ctx.store.policies.listExceptions(project.id)).length).toBe(0);
  });

  it("false_positive creates an exception and records who decided", async () => {
    const f = sampleFinding({ projectId: project.id });
    await ctx.store.findings.upsert(f);
    const res = await triage(f.id, { to: "false_positive", reason: "test fixture only" });
    expect(res.statusCode).toBe(200);
    const [ex] = await ctx.store.policies.listExceptions(project.id);
    expect(ex).toMatchObject({
      kind: "false_positive",
      approver: "sec-1",
      fingerprint: f.fingerprint,
    });
    const [event] = await ctx.store.findings.history(f.id);
    expect(event).toMatchObject({ from: "new", to: "false_positive", actor: { role: "security" } });
  });

  it("an expired accepted_risk counts against the gate again", async () => {
    const f = sampleFinding({ projectId: project.id, status: "accepted_risk" });
    await ctx.store.findings.upsert(f);
    await ctx.store.policies.addException({
      id: crypto.randomUUID(),
      projectId: project.id,
      fingerprint: f.fingerprint,
      kind: "accepted_risk",
      reason: "risk",
      approver: "sec-1",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      createdAt: new Date().toISOString(),
    });
    expect((await gate()).pass).toBe(true);
    ctx.store.exceptionList[0]!.expiresAt = new Date(Date.now() - 1000).toISOString();
    const res = await gate();
    expect(res.pass).toBe(false);
    expect(res.violations).toHaveLength(1);
  });

  it("reopening a finding after accepted_risk makes it count against the gate again", async () => {
    const f = sampleFinding({ projectId: project.id });
    await ctx.store.findings.upsert(f);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(
      (await triage(f.id, { to: "accepted_risk", expiresAt: future, reason: "r" })).statusCode,
    ).toBe(200);
    expect((await gate()).pass).toBe(true);
    expect((await triage(f.id, { to: "confirmed", reason: "revisit" })).statusCode).toBe(200);
    expect((await gate()).pass).toBe(false);
  });
});

describe("Runs", () => {
  let ctx: TestContext;
  let devops: string;
  const project = sampleProject();

  beforeEach(async () => {
    ctx = await setupTestApp();
    devops = await ctx.issueToken({ subject: "ops", roles: ["devops"], clientIds: "*" });
    await ctx.store.projects.create(project);
  });

  it("rejects repeat > 1 outside full mode and accepts it for full", async () => {
    const post = (payload: Record<string, unknown>) =>
      ctx.app.inject({ method: "POST", url: "/api/v1/runs", headers: auth(devops), payload });
    expect((await post({ projectId: project.id, repeat: 3 })).statusCode).toBe(400);
    expect((await post({ projectId: project.id, mode: "full", repeat: 3 })).statusCode).toBe(201);
  });

  it("marks the run failed and answers 503 when the queue is down", async () => {
    ctx.queue.enqueue = () => Promise.reject(new Error("redis down"));
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/runs",
      headers: auth(devops),
      payload: { projectId: project.id },
    });
    expect(res.statusCode).toBe(503);
    expect(ctx.store.runList).toHaveLength(1);
    expect(ctx.store.runList[0]).toMatchObject({
      status: "failed",
      failureReason: "enqueue_failed",
    });
  });

  it("uses the base commit of the last succeeded run for focused runs", async () => {
    const prev = sampleRun({
      projectId: project.id,
      status: "succeeded",
      commitSha: "abcdef1234567",
    });
    await ctx.store.runs.create(prev);
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/runs",
      headers: auth(devops),
      payload: { projectId: project.id, mode: "focused" },
    });
    expect(res.json()).toMatchObject({ baseCommitSha: "abcdef1234567", previousRunId: prev.id });
  });

  it("streams live events of a running run and closes when it finishes", async () => {
    const run = sampleRun({ projectId: project.id, status: "running" });
    await ctx.store.runs.create(run);
    const ev = (seq: number, type: "run.queued" | "run.cancelled"): PlatformEvent =>
      type === "run.queued"
        ? {
            id: crypto.randomUUID(),
            runId: run.id,
            projectId: project.id,
            seq,
            at: new Date().toISOString(),
            type,
            payload: {},
          }
        : {
            id: crypto.randomUUID(),
            runId: run.id,
            projectId: project.id,
            seq,
            at: new Date().toISOString(),
            type,
            payload: { by: null },
          };
    await ctx.store.events.append(ev(0, "run.queued"));

    const pending = ctx.app.inject({
      method: "GET",
      url: `/api/v1/runs/${run.id}/events/stream`,
      headers: auth(devops),
    });
    await new Promise((r) => setTimeout(r, 80));
    await ctx.store.events.append(ev(1, "run.cancelled"));
    await ctx.store.runs.update(run.id, { status: "cancelled" });
    const res = await pending;
    expect(res.body).toContain("id: 0");
    expect(res.body).toContain("event: run.cancelled");

    // Reconnect with Last-Event-ID: only newer events are replayed.
    const resumed = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/runs/${run.id}/events/stream`,
      headers: { ...auth(devops), "last-event-id": "0" },
    });
    expect(resumed.body).not.toContain("event: run.queued");
    expect(resumed.body).toContain("event: run.cancelled");
  });
});

describe("Webhooks", () => {
  let ctx: TestContext;
  const project = sampleProject({
    id: "00000000-0000-4000-8000-000000000401",
    slug: "hook-repo",
    repoUrl: "https://git.example/acme/hook-repo",
  });
  const sign = (body: string, secret = WEBHOOK_SECRET) =>
    `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
  const send = (
    provider: string,
    body: unknown,
    headers: Record<string, string>,
    query = `?projectId=${project.id}`,
  ) =>
    ctx.app.inject({
      method: "POST",
      url: `/api/v1/webhooks/${provider}${query}`,
      headers: { "content-type": "application/json", ...headers },
      payload: JSON.stringify(body),
    });

  beforeEach(async () => {
    ctx = await setupTestApp();
    await ctx.store.projects.create(project);
  });

  it("answers 401 for an unknown project, never revealing whether it exists", async () => {
    const body = { ref: "refs/heads/main", after: "abcdef1234567" };
    const raw = JSON.stringify(body);
    const res = await send(
      "github",
      body,
      { "x-hub-signature-256": sign(raw) },
      "?projectId=00000000-0000-4000-8000-0000000000ff",
    );
    expect(res.statusCode).toBe(401);
    expect(ctx.queue.jobs).toHaveLength(0);
  });

  it("has no default secret: a project without a configured secret rejects everything", async () => {
    const bare = await setupTestApp({ noSecret: true });
    await bare.store.projects.create(project);
    const body = { ref: "refs/heads/main", after: "abcdef1234567" };
    for (const secret of ["", "default-webhook-secret", "undefined"]) {
      const res = await bare.app.inject({
        method: "POST",
        url: `/api/v1/webhooks/github?projectId=${project.id}`,
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": sign(JSON.stringify(body), secret),
        },
        payload: JSON.stringify(body),
      });
      expect(res.statusCode).toBe(401);
    }
  });

  it("reads secrets from config keyed by project slug", async () => {
    const keyed = await setupTestApp({
      noSecret: true,
      secrets: { [project.slug]: "slug-secret" },
    });
    await keyed.store.projects.create(project);
    const raw = JSON.stringify({ ref: "refs/heads/main", after: "abcdef1234567" });
    const res = await keyed.app.inject({
      method: "POST",
      url: `/api/v1/webhooks/github?project=${project.slug}`,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(raw, "slug-secret"),
      },
      payload: raw,
    });
    expect(res.statusCode).toBe(202);
    expect(keyed.queue.jobs).toHaveLength(1);
  });

  it("rejects a tampered body, a wrong GitLab token and a sha1-only header", async () => {
    const body = { ref: "refs/heads/main", after: "abcdef1234567" };
    const signed = sign(JSON.stringify(body));
    expect(
      (await send("github", { ...body, after: "fedcba9876543" }, { "x-hub-signature-256": signed }))
        .statusCode,
    ).toBe(401);
    expect((await send("gitlab", body, { "x-gitlab-token": "nope" })).statusCode).toBe(401);
    expect((await send("github", body, { "x-hub-signature": signed })).statusCode).toBe(401);
    // A GitHub-style HMAC must not be accepted as a GitLab token.
    expect((await send("gitlab", body, { "x-gitlab-token": signed })).statusCode).toBe(401);
    expect(ctx.queue.jobs).toHaveLength(0);
  });

  it("finds the project from the repository URL in the payload", async () => {
    const body = {
      ref: "refs/heads/main",
      after: "abcdef1234567",
      repository: { html_url: `${project.repoUrl}.git` },
    };
    const res = await send(
      "github",
      body,
      { "x-hub-signature-256": sign(JSON.stringify(body)) },
      "",
    );
    expect(res.statusCode).toBe(202);
  });

  it("maps tag pushes and ignores pings, branch deletions and closed pull requests", async () => {
    const run = async (body: Record<string, unknown>, event: string) =>
      send("github", body, {
        "x-hub-signature-256": sign(JSON.stringify(body)),
        "x-github-event": event,
      });

    const tag = await run({ ref: "refs/tags/v1.2.0", after: "abcdef1234567" }, "push");
    expect(tag.statusCode).toBe(202);
    expect(ctx.store.runList[0]).toMatchObject({ ref: "refs/tags/v1.2.0", mode: "focused" });
    expect(ctx.store.runList[0]?.trigger.kind).toBe("webhook");

    const before = ctx.queue.jobs.length;
    for (const [body, event] of [
      [{ zen: "hello" }, "ping"],
      [
        { ref: "refs/heads/x", after: "0000000000000000000000000000000000000000", deleted: true },
        "push",
      ],
      [
        { action: "closed", pull_request: { head: { ref: "x", sha: "abcdef1234567" } } },
        "pull_request",
      ],
      [{ action: "labeled" }, "issues"],
    ] as const) {
      const res = await run({ ...body }, event);
      expect(res.statusCode).toBe(202);
      expect(res.json().status).toBe("ignored");
    }
    expect(ctx.queue.jobs.length).toBe(before);
  });

  it("is audit logged with the webhook as actor", async () => {
    const body = { ref: "refs/heads/main", after: "abcdef1234567" };
    await send("github", body, { "x-hub-signature-256": sign(JSON.stringify(body)) });
    const audit = ctx
      .logs()
      .map((l) => l["audit"])
      .find(Boolean) as Record<string, unknown>;
    expect(audit).toMatchObject({
      actor: "webhook:github",
      action: "webhook.run_create",
      status: 202,
    });
  });
});

describe("OpenAPI", () => {
  it("documents exactly the routes the app serves", async () => {
    const ctx = await setupTestApp();
    const spec = getOpenApiSpec() as { paths: Record<string, Record<string, unknown>> };
    const documented: string[] = [];
    for (const [path, ops] of Object.entries(spec.paths)) {
      for (const method of Object.keys(ops)) {
        documented.push(`${method.toUpperCase()} ${path}`);
        const url = path.replace(/\{(\w+)\}/g, ":$1");
        expect(
          ctx.app.hasRoute({ method: method.toUpperCase() as "GET", url }),
          `${method} ${path} is documented but not served`,
        ).toBe(true);
      }
    }
    const required = [
      "GET /api/v1/projects",
      "POST /api/v1/projects",
      "GET /api/v1/projects/{id}",
      "PATCH /api/v1/projects/{id}",
      "POST /api/v1/runs",
      "GET /api/v1/runs/{id}",
      "GET /api/v1/projects/{id}/runs",
      "POST /api/v1/runs/{id}/cancel",
      "GET /api/v1/runs/{id}/events",
      "GET /api/v1/runs/{id}/events/stream",
      "GET /api/v1/findings",
      "GET /api/v1/findings/{id}",
      "GET /api/v1/findings/{id}/history",
      "POST /api/v1/findings/{id}/triage",
      "GET /api/v1/review-queue",
      "GET /api/v1/policies/{id}",
      "PUT /api/v1/policies/{id}",
      "GET /api/v1/projects/{id}/gate",
      "POST /api/v1/webhooks/{provider}",
      "GET /healthz",
      "GET /readyz",
      "GET /openapi.json",
    ];
    expect(documented).toEqual(expect.arrayContaining(required));
  });

  it("request schemas describe the real inputs (no server-generated fields)", () => {
    const spec = getOpenApiSpec() as {
      components: { schemas: Record<string, { properties: object }> };
    };
    const create = spec.components.schemas["CreateProjectRequest"]!.properties;
    expect(create).not.toHaveProperty("id");
    expect(create).not.toHaveProperty("createdAt");
    expect(spec.components.schemas["PolicyRequest"]!.properties).not.toHaveProperty("id");
    expect(JSON.stringify(spec)).not.toContain("$schema");
  });
});
