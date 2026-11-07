import type { FastifyPluginAsync } from "fastify";
import {
  canTransition,
  type Exception,
  FindingPage,
  FindingQuery,
  OPEN_STATUSES,
  type Role,
  type Store,
  type TriageEvent,
  TriageRequest,
} from "@sdap/core";
import { setAudit } from "../audit.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../errors.js";
import { asArray, asBoolean, PageQuery, parseId, parseWith } from "../http.js";
import { hasAnyRole, requireRoles } from "../rbac.js";

/** Roles that may triage at all; developers are further limited below. */
const TRIAGE_ROLES: Role[] = ["admin", "security", "developer"];
const DEVELOPER_TARGETS = ["in_progress", "fixed"] as const;

export const findingRoutes: FastifyPluginAsync<{ store: Store }> = async (app, opts) => {
  const { store } = opts;

  app.get("/findings", async (req) => {
    const raw = (req.query ?? {}) as Record<string, unknown>;
    const query = parseWith(
      FindingQuery,
      {
        ...raw,
        verdict: asArray(raw["verdict"]),
        status: asArray(raw["status"]),
        attackClass: asArray(raw["attackClass"]),
        includeRejected: asBoolean(raw["includeRejected"]),
      },
      "finding query",
    );
    return FindingPage.parse(await store.findings.query(query, req.scope));
  });

  // Open `needs_validation` findings in the caller's scope: the Security review queue.
  app.get("/review-queue", { preHandler: [requireRoles("security")] }, async (req) => {
    const page = parseWith(PageQuery, req.query ?? {}, "query");
    return FindingPage.parse(
      await store.findings.query(
        {
          verdict: ["needs_validation"],
          status: [...OPEN_STATUSES],
          includeRejected: false,
          cursor: page.cursor,
          limit: page.limit,
        },
        req.scope,
      ),
    );
  });

  app.get("/findings/:id", async (req) => {
    const id = parseId((req.params as { id: string }).id, "Finding");
    const finding = await store.findings.get(id, req.scope);
    if (!finding) throw new NotFoundError("Finding not found");
    return finding;
  });

  app.get("/findings/:id/history", async (req) => {
    const id = parseId((req.params as { id: string }).id, "Finding");
    if (!(await store.findings.get(id, req.scope))) throw new NotFoundError("Finding not found");
    return store.findings.history(id);
  });

  app.post("/findings/:id/triage", async (req) => {
    const id = parseId((req.params as { id: string }).id, "Finding");
    setAudit(req, { action: "finding.triage", target: id });

    if (!hasAnyRole(req.user, ...TRIAGE_ROLES)) {
      throw new ForbiddenError("Your role cannot triage findings");
    }
    const finding = await store.findings.get(id, req.scope);
    if (!finding) throw new NotFoundError("Finding not found");

    const body = parseWith(TriageRequest, req.body ?? {}, "triage request");
    const { to, owner } = body;
    const reason = body.reason?.trim() ? body.reason.trim() : null;
    setAudit(req, { action: "finding.triage", target: id, details: { from: finding.status, to } });

    // Security and admin triage everything; a developer only moves own-team findings forward.
    const privileged = hasAnyRole(req.user, "admin", "security");
    if (!privileged) {
      const project = await store.projects.get(finding.projectId, req.scope);
      if (!project || req.user.team === undefined || project.team !== req.user.team) {
        throw new ForbiddenError("Developers can only triage findings of their own team");
      }
      if (!(DEVELOPER_TARGETS as readonly string[]).includes(to)) {
        throw new ForbiddenError("Developers can only move findings to in_progress or fixed");
      }
    }
    const actorRole: Role = hasAnyRole(req.user, "admin")
      ? "admin"
      : privileged
        ? "security"
        : "developer";

    if (!canTransition(finding.status, to)) {
      throw new BadRequestError(`Cannot move a finding from ${finding.status} to ${to}`);
    }

    const now = new Date();
    let exception: Exception | null = null;
    if (to === "accepted_risk") {
      if (!body.expiresAt) throw new BadRequestError("accepted_risk requires expiresAt");
      if (new Date(body.expiresAt) <= now) {
        throw new BadRequestError("expiresAt must be in the future");
      }
      exception = {
        id: crypto.randomUUID(),
        projectId: finding.projectId,
        fingerprint: finding.fingerprint,
        kind: "accepted_risk",
        reason: reason ?? "Accepted risk",
        approver: req.user.subject,
        expiresAt: body.expiresAt,
        createdAt: now.toISOString(),
      };
    } else if (to === "false_positive") {
      if (!reason) throw new BadRequestError("false_positive requires a reason");
      exception = {
        id: crypto.randomUUID(),
        projectId: finding.projectId,
        fingerprint: finding.fingerprint,
        kind: "false_positive",
        reason,
        approver: req.user.subject,
        expiresAt: null,
        createdAt: now.toISOString(),
      };
    }

    const event: TriageEvent = {
      id: crypto.randomUUID(),
      findingId: finding.id,
      from: finding.status,
      to,
      actor: { subject: req.user.subject, role: actorRole },
      reason,
      at: now.toISOString(),
    };
    // The exception and the status change succeed or fail together.
    return store.tx(async (tx) => {
      if (exception) await tx.policies.addException(exception);
      return tx.findings.setStatus(id, event, owner !== undefined ? owner : finding.owner);
    });
  });
};
