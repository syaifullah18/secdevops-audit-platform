import type { FastifyPluginAsync } from "fastify";
import { type AccessScope, Id, Project, type Store } from "@sdap/core";
import { setAudit } from "../audit.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../errors.js";
import { parseId, parseWith } from "../http.js";
import { requireRoles, scopeIncludes } from "../rbac.js";

/** `policyId` is optional on create (a policy is attached later). */
export const CreateProjectInput = Project.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  policyId: Id.nullable().default(null),
});
export const PatchProjectInput = CreateProjectInput.partial();

export const projectRoutes: FastifyPluginAsync<{ store: Store }> = async (app, opts) => {
  const { store } = opts;

  app.get("/projects", async (req) => store.projects.list(req.scope));

  app.post("/projects", { preHandler: [requireRoles("devops")] }, async (req, reply) => {
    const input = parseWith(CreateProjectInput, req.body, "project");
    if (!scopeIncludes(req.scope, input.clientId)) {
      throw new ForbiddenError("Cannot create a project for a client outside your scope");
    }
    await assertPolicyExists(store, req.scope, input.policyId);
    // Slugs are unique across all clients, so the check must not be scope-limited.
    const all = await store.projects.list({ clientIds: "*" });
    if (all.some((p) => p.slug === input.slug)) {
      throw new ConflictError(`Project slug "${input.slug}" is already in use`);
    }

    const now = new Date().toISOString();
    const created = await store.projects.create(
      Project.parse({ ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now }),
    );
    setAudit(req, { action: "project.create", target: created.id });
    return reply.status(201).send(created);
  });

  app.get("/projects/:id", async (req) => {
    const id = parseId((req.params as { id: string }).id, "Project");
    const project = await store.projects.get(id, req.scope);
    if (!project) throw new NotFoundError("Project not found");
    return project;
  });

  app.patch("/projects/:id", { preHandler: [requireRoles("devops")] }, async (req) => {
    const id = parseId((req.params as { id: string }).id, "Project");
    setAudit(req, { action: "project.update", target: id });
    const project = await store.projects.get(id, req.scope);
    if (!project) throw new NotFoundError("Project not found");

    const body = parseWith(PatchProjectInput, req.body ?? {}, "project patch");
    // Schema defaults would otherwise overwrite fields the caller did not send.
    const sent = new Set(Object.keys((req.body ?? {}) as Record<string, unknown>));
    const patch = Object.fromEntries(Object.entries(body).filter(([key]) => sent.has(key)));
    if (Object.keys(patch).length === 0) throw new BadRequestError("Empty project patch");

    if (body.clientId !== undefined && !scopeIncludes(req.scope, body.clientId)) {
      throw new ForbiddenError("Cannot move a project to a client outside your scope");
    }
    if (body.slug !== undefined && body.slug !== project.slug) {
      const all = await store.projects.list({ clientIds: "*" });
      if (all.some((p) => p.slug === body.slug)) {
        throw new ConflictError(`Project slug "${body.slug}" is already in use`);
      }
    }
    if ("policyId" in patch) await assertPolicyExists(store, req.scope, body.policyId ?? null);

    return store.projects.update(id, { ...patch, updatedAt: new Date().toISOString() });
  });
};

const assertPolicyExists = async (
  store: Store,
  scope: AccessScope,
  policyId: string | null,
): Promise<void> => {
  if (policyId === null) return;
  if (!(await store.policies.get(policyId, scope))) {
    throw new BadRequestError("policyId does not reference an existing policy");
  }
};
