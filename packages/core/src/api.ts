import { z } from "zod";
import { Id, pageOf } from "./common.js";
import { AttackClass, AuditMode, FindingStatus, Severity, TriggerKind, Verdict } from "./enums.js";
import { Finding } from "./finding.js";
import { RunScope, Run } from "./run.js";

/**
 * Request/response shapes shared by the API (WS2), web dashboard (WS5) and CLI (WS6).
 * The API derives its OpenAPI document from these.
 */

export const CreateRunRequest = z.object({
  projectId: Id,
  mode: AuditMode.default("focused"),
  repeat: z.number().int().min(1).max(10).default(1),
  ref: z.string().min(1).default("HEAD"),
  scope: RunScope.partial().default({}),
  trigger: z.object({ kind: TriggerKind, ref: z.string().nullable().default(null) }).default({
    kind: "api",
    ref: null,
  }),
});
export type CreateRunRequest = z.input<typeof CreateRunRequest>;

export const RunPage = pageOf(Run);
export type RunPage = z.infer<typeof RunPage>;

export const FindingQuery = z.object({
  projectId: Id.optional(),
  verdict: z.array(Verdict).optional(),
  status: z.array(FindingStatus).optional(),
  minSeverity: Severity.optional(),
  attackClass: z.array(AttackClass).optional(),
  /** Rejected findings are hidden unless explicitly requested (PRD 5.4). */
  includeRejected: z.coerce.boolean().default(false),
  q: z.string().max(200).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
export type FindingQuery = z.input<typeof FindingQuery>;

export const FindingPage = pageOf(Finding);
export type FindingPage = z.infer<typeof FindingPage>;

export const TriageRequest = z.object({
  to: FindingStatus,
  reason: z.string().min(1).max(4000).nullable().default(null),
  owner: z.string().nullable().optional(),
  /** accepted_risk requires an expiry. */
  expiresAt: z.iso.datetime({ offset: true }).nullable().default(null),
});
export type TriageRequest = z.input<typeof TriageRequest>;

export const ApiError = z.object({
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiError>;
