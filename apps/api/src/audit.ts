import type { FastifyRequest } from "fastify";

export interface AuditEntry {
  /** Overrides the authenticated subject (webhooks authenticate by signature, not by user). */
  actor?: string;
  /** Stable dotted action name, e.g. `finding.triage`. */
  action: string;
  /** Id (or other identifier) of the affected resource. */
  target: string;
  details?: Record<string, unknown>;
}

declare module "fastify" {
  interface FastifyRequest {
    auditEntry?: AuditEntry;
  }
}

/** Handlers call this to describe a mutation; the response hook writes the log line. */
export const setAudit = (req: FastifyRequest, entry: AuditEntry): void => {
  req.auditEntry = entry;
};

export const MUTATING_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Writes one structured line per mutating request (success or failure), so denied and failed
 * attempts are visible too. Shape: `{ audit: { actor, action, target, status, at, details? } }`.
 */
export const writeAuditLog = (req: FastifyRequest, statusCode: number): void => {
  if (!MUTATING_METHODS.has(req.method)) return;
  const entry = req.auditEntry;
  const params = (req.params ?? {}) as Record<string, unknown>;
  const fallbackTarget = typeof params["id"] === "string" ? params["id"] : req.url.split("?")[0];
  const actor =
    entry?.actor ?? (req.user as { subject?: string } | undefined)?.subject ?? "anonymous";
  const action = entry?.action ?? `${req.method} ${req.routeOptions?.url ?? req.url}`;
  const target = entry?.target ?? fallbackTarget ?? "";
  req.log.info(
    {
      audit: {
        actor,
        action,
        target,
        status: statusCode,
        at: new Date().toISOString(),
        ...(entry?.details ? { details: entry.details } : {}),
      },
    },
    `audit ${action}`,
  );
};
