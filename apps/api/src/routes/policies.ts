import type { FastifyPluginAsync } from "fastify";
import {
  type AccessScope,
  DEFAULT_SLA_DAYS,
  evaluateGate,
  type Exception,
  type Finding,
  GateResult,
  Policy,
  type Store,
} from "@sdap/core";
import { setAudit } from "../audit.js";
import { ForbiddenError, NotFoundError } from "../errors.js";
import { parseId, parseWith } from "../http.js";
import { requireRoles, scopeIncludes } from "../rbac.js";

export const PolicyInput = Policy.omit({ id: true, createdAt: true, updatedAt: true });

/** Used when a project has no policy yet: block on confirmed high and above. */
const defaultPolicy = (): Policy => {
  const now = new Date().toISOString();
  return {
    id: "00000000-0000-4000-8000-000000000000",
    name: "Default policy",
    clientId: null,
    mode: "enforce",
    rules: [{ verdict: "confirmed", minSeverity: "high", attackClasses: [] }],
    slaDays: DEFAULT_SLA_DAYS,
    createdAt: now,
    updatedAt: now,
  };
};

/**
 * Findings the gate evaluates:
 * - every open finding, minus those whose exception is still in force, and
 * - `accepted_risk` findings whose exception has expired, which count as open again.
 * An exception stops applying once the finding was triaged back to `confirmed` after it.
 */
const gateInputs = async (
  store: Store,
  scope: AccessScope,
  projectId: string,
  exceptions: Exception[],
  now: Date,
): Promise<{ findings: Finding[]; exceptions: Exception[] }> => {
  const findings = await store.findings.listOpen(projectId);

  const expired = new Set(
    exceptions
      .filter((e) => e.kind === "accepted_risk" && e.expiresAt && new Date(e.expiresAt) <= now)
      .map((e) => e.fingerprint),
  );
  if (expired.size > 0) {
    let cursor: string | undefined;
    do {
      const page = await store.findings.query(
        { projectId, status: ["accepted_risk"], verdict: ["confirmed"], limit: 500, cursor },
        scope,
      );
      for (const f of page.items) {
        if (expired.has(f.fingerprint)) findings.push({ ...f, status: "confirmed" });
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }

  const applicable: Exception[] = [];
  for (const e of exceptions) {
    const target = findings.find((f) => f.fingerprint === e.fingerprint);
    if (!target) continue;
    const history = await store.findings.history(target.id);
    // `>=`: a reopen in the same millisecond as the exception still revokes it. The event that
    // created the exception goes *to* accepted_risk/false_positive, so it can never match here.
    const reopened = history.some(
      (h) =>
        new Date(h.at) >= new Date(e.createdAt) &&
        (h.from === "accepted_risk" || h.from === "false_positive") &&
        h.to === "confirmed",
    );
    if (!reopened) applicable.push(e);
  }
  return { findings, exceptions: applicable };
};

export const policyRoutes: FastifyPluginAsync<{ store: Store }> = async (app, opts) => {
  const { store } = opts;

  app.get("/policies/:id", async (req) => {
    const id = parseId((req.params as { id: string }).id, "Policy");
    const policy = await store.policies.get(id, req.scope);
    if (!policy) {
      throw new NotFoundError("Policy not found");
    }
    return policy;
  });

  app.put("/policies/:id", { preHandler: [requireRoles("security")] }, async (req) => {
    const id = parseId((req.params as { id: string }).id, "Policy");
    setAudit(req, { action: "policy.upsert", target: id });
    const input = parseWith(PolicyInput, req.body, "policy");

    const globalExisting = await store.policies.get(id, { clientIds: "*" });
    if (globalExisting && req.scope.clientIds !== "*") {
      if (globalExisting.clientId === null || !scopeIncludes(req.scope, globalExisting.clientId)) {
        throw new NotFoundError("Policy not found");
      }
    }

    let effectiveClientId = input.clientId;
    if (req.scope.clientIds !== "*") {
      if (effectiveClientId === null) {
        effectiveClientId = req.scope.clientIds[0] ?? null;
      } else if (!scopeIncludes(req.scope, effectiveClientId)) {
        throw new ForbiddenError("Cannot assign policy to a client outside your scope");
      }
    }

    const now = new Date().toISOString();
    return store.policies.upsert({
      ...input,
      clientId: effectiveClientId,
      id,
      createdAt: globalExisting?.createdAt ?? now,
      updatedAt: now,
    });
  });

  app.get("/projects/:id/gate", async (req) => {
    const id = parseId((req.params as { id: string }).id, "Project");
    const project = await store.projects.get(id, req.scope);
    if (!project) throw new NotFoundError("Project not found");

    const policy =
      (project.policyId ? await store.policies.get(project.policyId, req.scope) : null) ??
      defaultPolicy();
    const now = new Date();
    const exceptions = await store.policies.listExceptions(id);
    const inputs = await gateInputs(store, req.scope, id, exceptions, now);
    // Only `confirmed` findings can violate a rule; evaluateGate enforces that.
    return GateResult.parse(evaluateGate(policy, inputs.findings, inputs.exceptions, now));
  });
};
