import { z } from "zod";

/**
 * The only three verdicts the platform knows. Legacy or model-specific words
 * (PLAUSIBLE, PARTIAL, REFUTED, ...) are mapped by @sdap/normalizer.
 */
export const Verdict = z.enum(["confirmed", "needs_validation", "rejected"]);
export type Verdict = z.infer<typeof Verdict>;

/** Severity scale used by the security-audit-skill (report-schema.json). */
export const Severity = z.enum(["informational", "low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof Severity>;

/** Ordinal rank, higher is more severe. */
export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  informational: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export const severityAtLeast = (s: Severity, min: Severity): boolean =>
  SEVERITY_RANK[s] >= SEVERITY_RANK[min];

/** Triage lifecycle (PRD 5.4). */
export const FindingStatus = z.enum([
  "new",
  "confirmed",
  "in_progress",
  "fixed",
  "accepted_risk",
  "false_positive",
]);
export type FindingStatus = z.infer<typeof FindingStatus>;

/** Statuses that count as "open" for gates, SLAs and dashboards. */
export const OPEN_STATUSES: readonly FindingStatus[] = ["new", "confirmed", "in_progress"];
export const isOpenStatus = (s: FindingStatus): boolean => OPEN_STATUSES.includes(s);

/**
 * Audit modes.
 * - focused: only paths changed since the last run, reusing the previous ledger.
 * - incremental: whole scope, but reuse the previous ledger and findings to target gaps.
 * - full: whole repository from scratch; may be repeated N times and merged (repeat-N).
 */
export const AuditMode = z.enum(["focused", "incremental", "full"]);
export type AuditMode = z.infer<typeof AuditMode>;

/** Worker pipeline phases (WS1). Maps onto the skill's six phases plus optional Jev triage. */
export const PhaseName = z.enum([
  "preflight",
  "recon",
  "hunt",
  "triage",
  "validate",
  "output",
  "record_verify",
  "report",
]);
export type PhaseName = z.infer<typeof PhaseName>;

export const RunStatus = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);
export type RunStatus = z.infer<typeof RunStatus>;

export const WorkStatus = z.enum(["pending", "running", "succeeded", "failed", "skipped"]);
export type WorkStatus = z.infer<typeof WorkStatus>;

export const Role = z.enum(["admin", "security", "devops", "developer", "viewer"]);
export type Role = z.infer<typeof Role>;

/**
 * Tasks a model can be routed to. System 2 tasks are generative; `decide` is System 1 (Jev).
 */
export const ModelTask = z.enum([
  "recon",
  "hunt",
  "validate",
  "record_verify",
  "report",
  "fix_draft",
  "decide",
]);
export type ModelTask = z.infer<typeof ModelTask>;

/**
 * Well-known attack-class families. Attack classes are open strings so community
 * packs can add their own; these are the defaults the UI groups by.
 */
export const KNOWN_ATTACK_CLASSES = [
  "authn",
  "authz",
  "injection",
  "config",
  "supply_chain",
  "client_side",
  "data_isolation",
  "resource_exhaustion",
  "crypto",
  "secrets",
  "other",
] as const;
export const AttackClass = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9_.:/-]*$/);
export type AttackClass = z.infer<typeof AttackClass>;

export const TriggerKind = z.enum(["manual", "api", "ci", "schedule", "release_tag", "webhook"]);
export type TriggerKind = z.infer<typeof TriggerKind>;
