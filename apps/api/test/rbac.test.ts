import type { Role } from "@sdap/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  sampleFinding,
  samplePolicy,
  sampleProject,
  sampleRun,
  setupTestApp,
  type TestContext,
} from "./helpers.js";

describe("RBAC Matrix Tests (role × endpoint -> allowed/denied)", () => {
  let ctx: TestContext;
  let tokens: Record<Role, string>;

  const TEAM_ALPHA = "team-alpha";
  const TEAM_BETA = "team-beta";

  beforeEach(async () => {
    ctx = await setupTestApp();

    const roles: Role[] = ["viewer", "developer", "security", "devops", "admin"];
    tokens = {} as Record<Role, string>;

    for (const r of roles) {
      tokens[r] = await ctx.issueToken({
        subject: `user-${r}`,
        roles: [r],
        clientIds: "*",
        team: TEAM_ALPHA,
      });
    }
  });

  const endpoints: Array<{
    name: string;
    method: "GET" | "POST" | "PATCH" | "PUT";
    url: (ids: { projectId: string; runId: string; findingId: string; policyId: string }) => string;
    payload?: (ids: {
      projectId: string;
      runId: string;
      findingId: string;
      policyId: string;
    }) => Record<string, unknown>;
    allowedRoles: Role[];
  }> = [
    {
      name: "GET /api/v1/projects",
      method: "GET",
      url: () => "/api/v1/projects",
      allowedRoles: ["viewer", "developer", "security", "devops", "admin"],
    },
    {
      name: "POST /api/v1/projects",
      method: "POST",
      url: () => "/api/v1/projects",
      payload: () => ({
        slug: "new-proj",
        name: "New Project",
        repoUrl: "https://github.com/example/new",
        team: "team-alpha",
        clientId: "client-a",
      }),
      allowedRoles: ["devops", "admin"],
    },
    {
      name: "GET /api/v1/projects/:id",
      method: "GET",
      url: (ids) => `/api/v1/projects/${ids.projectId}`,
      allowedRoles: ["viewer", "developer", "security", "devops", "admin"],
    },
    {
      name: "PATCH /api/v1/projects/:id",
      method: "PATCH",
      url: (ids) => `/api/v1/projects/${ids.projectId}`,
      payload: () => ({ name: "Renamed Project" }),
      allowedRoles: ["devops", "admin"],
    },
    {
      name: "POST /api/v1/runs",
      method: "POST",
      url: () => "/api/v1/runs",
      payload: (ids) => ({
        projectId: ids.projectId,
        mode: "focused",
        trigger: { kind: "api", ref: null },
      }),
      allowedRoles: ["devops", "admin"],
    },
    {
      name: "GET /api/v1/runs/:id",
      method: "GET",
      url: (ids) => `/api/v1/runs/${ids.runId}`,
      allowedRoles: ["viewer", "developer", "security", "devops", "admin"],
    },
    {
      name: "GET /api/v1/projects/:id/runs",
      method: "GET",
      url: (ids) => `/api/v1/projects/${ids.projectId}/runs`,
      allowedRoles: ["viewer", "developer", "security", "devops", "admin"],
    },
    {
      name: "POST /api/v1/runs/:id/cancel",
      method: "POST",
      url: (ids) => `/api/v1/runs/${ids.runId}/cancel`,
      allowedRoles: ["devops", "admin"],
    },
    {
      name: "GET /api/v1/findings",
      method: "GET",
      url: () => "/api/v1/findings",
      allowedRoles: ["viewer", "developer", "security", "devops", "admin"],
    },
    {
      name: "GET /api/v1/findings/:id",
      method: "GET",
      url: (ids) => `/api/v1/findings/${ids.findingId}`,
      allowedRoles: ["viewer", "developer", "security", "devops", "admin"],
    },
    {
      name: "GET /api/v1/review-queue",
      method: "GET",
      url: () => "/api/v1/review-queue",
      allowedRoles: ["security", "admin"],
    },
    {
      name: "GET /api/v1/policies/:id",
      method: "GET",
      url: (ids) => `/api/v1/policies/${ids.policyId}`,
      allowedRoles: ["viewer", "developer", "security", "devops", "admin"],
    },
    {
      name: "PUT /api/v1/policies/:id",
      method: "PUT",
      url: (ids) => `/api/v1/policies/${ids.policyId}`,
      payload: () => ({
        name: "Security Policy",
        mode: "enforce",
        rules: [{ verdict: "confirmed", minSeverity: "high", attackClasses: [] }],
      }),
      allowedRoles: ["security", "admin"],
    },
    {
      name: "GET /api/v1/projects/:id/gate",
      method: "GET",
      url: (ids) => `/api/v1/projects/${ids.projectId}/gate`,
      allowedRoles: ["viewer", "developer", "security", "devops", "admin"],
    },
  ];

  for (const ep of endpoints) {
    describe(ep.name, () => {
      const allRoles: Role[] = ["viewer", "developer", "security", "devops", "admin"];

      for (const role of allRoles) {
        const isAllowed = ep.allowedRoles.includes(role);

        it(`role "${role}" is ${isAllowed ? "allowed" : "denied (403)"}`, async () => {
          // Prepare entities
          const project = sampleProject();
          await ctx.store.projects.create(project);
          const run = sampleRun({ projectId: project.id, status: "running" });
          await ctx.store.runs.create(run);
          const finding = sampleFinding({ projectId: project.id });
          await ctx.store.findings.upsert(finding);
          const policy = samplePolicy();
          await ctx.store.policies.upsert(policy);

          const ids = {
            projectId: project.id,
            runId: run.id,
            findingId: finding.id,
            policyId: policy.id,
          };

          const res = await ctx.app.inject({
            method: ep.method,
            url: ep.url(ids),
            headers: { authorization: `Bearer ${tokens[role]}` },
            payload: ep.payload ? ep.payload(ids) : undefined,
          });

          if (isAllowed) {
            expect(
              res.statusCode,
              `Expected ${role} to be allowed but got ${res.statusCode}: ${res.body}`,
            ).toBeLessThan(400);
          } else {
            expect(res.statusCode, `Expected ${role} to be 403 Forbidden`).toBe(403);
          }
        });
      }
    });
  }

  describe("POST /api/v1/findings/:id/triage fine-grained RBAC", () => {
    it("Developer CAN triage in_progress on own team", async () => {
      const project = sampleProject({ team: TEAM_ALPHA });
      await ctx.store.projects.create(project);
      const finding = sampleFinding({ projectId: project.id, status: "new" });
      await ctx.store.findings.upsert(finding);

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/v1/findings/${finding.id}/triage`,
        headers: { authorization: `Bearer ${tokens.developer}` },
        payload: { to: "in_progress", reason: "Working on fix" },
      });

      expect(res.statusCode).toBe(200);
    });

    it("Developer CAN triage fixed on own team", async () => {
      const project = sampleProject({ team: TEAM_ALPHA });
      await ctx.store.projects.create(project);
      const finding = sampleFinding({ projectId: project.id, status: "in_progress" });
      await ctx.store.findings.upsert(finding);

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/v1/findings/${finding.id}/triage`,
        headers: { authorization: `Bearer ${tokens.developer}` },
        payload: { to: "fixed", reason: "Fix merged" },
      });

      expect(res.statusCode).toBe(200);
    });

    it("Developer CANNOT triage to accepted_risk (403)", async () => {
      const project = sampleProject({ team: TEAM_ALPHA });
      await ctx.store.projects.create(project);
      const finding = sampleFinding({ projectId: project.id, status: "new" });
      await ctx.store.findings.upsert(finding);

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/v1/findings/${finding.id}/triage`,
        headers: { authorization: `Bearer ${tokens.developer}` },
        payload: {
          to: "accepted_risk",
          expiresAt: "2026-12-01T00:00:00.000Z",
          reason: "Risk accepted",
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it("Developer CANNOT triage on other team (403)", async () => {
      const otherProject = sampleProject({ id: crypto.randomUUID(), team: TEAM_BETA });
      await ctx.store.projects.create(otherProject);
      const finding = sampleFinding({ projectId: otherProject.id, status: "new" });
      await ctx.store.findings.upsert(finding);

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/v1/findings/${finding.id}/triage`,
        headers: { authorization: `Bearer ${tokens.developer}` },
        payload: { to: "in_progress" },
      });

      expect(res.statusCode).toBe(403);
    });

    it("Security CAN triage all, including accepted_risk exception", async () => {
      const project = sampleProject({ team: TEAM_BETA });
      await ctx.store.projects.create(project);
      const finding = sampleFinding({ projectId: project.id, status: "new" });
      await ctx.store.findings.upsert(finding);

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/v1/findings/${finding.id}/triage`,
        headers: { authorization: `Bearer ${tokens.security}` },
        payload: {
          to: "accepted_risk",
          expiresAt: "2026-12-01T00:00:00.000Z",
          reason: "Approved security risk",
        },
      });

      expect(res.statusCode).toBe(200);
      const updated = res.json();
      expect(updated.status).toBe("accepted_risk");

      const exceptions = await ctx.store.policies.listExceptions(project.id);
      expect(exceptions.length).toBe(1);
      expect(exceptions[0]?.kind).toBe("accepted_risk");
    });

    it("Viewer and DevOps CANNOT triage findings (403)", async () => {
      const project = sampleProject();
      await ctx.store.projects.create(project);
      const finding = sampleFinding({ projectId: project.id, status: "new" });
      await ctx.store.findings.upsert(finding);

      for (const r of ["viewer", "devops"] as Role[]) {
        const res = await ctx.app.inject({
          method: "POST",
          url: `/api/v1/findings/${finding.id}/triage`,
          headers: { authorization: `Bearer ${tokens[r]}` },
          payload: { to: "in_progress" },
        });
        expect(res.statusCode).toBe(403);
      }
    });
  });
});
