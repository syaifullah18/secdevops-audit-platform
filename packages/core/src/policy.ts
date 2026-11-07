import { z } from "zod";
import { Id, IsoDateTime } from "./common.js";
import { Severity, isOpenStatus, severityAtLeast } from "./enums.js";
import { Fingerprint, type Finding } from "./finding.js";

/**
 * A gate rule. `verdict` is the literal "confirmed": by construction no policy can
 * fail a gate on needs_validation or rejected findings, nor on System 1 output.
 */
export const GateRule = z.object({
  verdict: z.literal("confirmed"),
  minSeverity: Severity,
  /** Optional attack-class filter; empty means all classes. */
  attackClasses: z.array(z.string()).default([]),
});
export type GateRule = z.infer<typeof GateRule>;

export const SlaDays = z.record(Severity, z.number().int().positive().nullable());
export type SlaDays = z.infer<typeof SlaDays>;

export const DEFAULT_SLA_DAYS: SlaDays = {
  critical: 7,
  high: 30,
  medium: 90,
  low: 180,
  informational: null,
};

/** Policy as code, per repo or client (PRD 5.5). */
export const Policy = z.object({
  id: Id,
  name: z.string().min(1),
  /** report_only never fails the gate; it only reports what would have failed. */
  mode: z.enum(["enforce", "report_only"]),
  rules: z
    .array(GateRule)
    .default([{ verdict: "confirmed", minSeverity: "high", attackClasses: [] }]),
  slaDays: SlaDays.default(DEFAULT_SLA_DAYS),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Policy = z.infer<typeof Policy>;

/** Accepted risk (approver + expiry) or false positive (reason), PRD 5.4. */
export const Exception = z
  .object({
    id: Id,
    projectId: Id,
    fingerprint: Fingerprint,
    kind: z.enum(["accepted_risk", "false_positive"]),
    reason: z.string().min(1),
    approver: z.string().min(1),
    /** Required for accepted_risk; optional for false_positive. */
    expiresAt: IsoDateTime.nullable(),
    createdAt: IsoDateTime,
  })
  .refine((e) => e.kind !== "accepted_risk" || e.expiresAt !== null, {
    message: "accepted_risk requires expiresAt",
    path: ["expiresAt"],
  });
export type Exception = z.infer<typeof Exception>;

export const GateResult = z.object({
  pass: z.boolean(),
  mode: z.enum(["enforce", "report_only"]),
  /** Findings that violate a rule (would block in enforce mode). */
  violations: z.array(z.object({ findingId: Id, fingerprint: Fingerprint, severity: Severity })),
  /** Findings skipped because of an active exception. */
  excepted: z.array(Id),
  evaluatedAt: IsoDateTime,
});
export type GateResult = z.infer<typeof GateResult>;

const exceptionActive = (e: Exception, now: Date): boolean =>
  e.expiresAt === null || new Date(e.expiresAt).getTime() > now.getTime();

/**
 * Reference gate evaluation shared by API and CLI. Only open, confirmed findings
 * with a verified severity can produce violations.
 */
export const evaluateGate = (
  policy: Pick<Policy, "mode" | "rules">,
  findings: readonly Finding[],
  exceptions: readonly Exception[],
  now: Date = new Date(),
): GateResult => {
  const active = new Set(
    exceptions.filter((e) => exceptionActive(e, now)).map((e) => `${e.projectId}|${e.fingerprint}`),
  );
  const violations: GateResult["violations"] = [];
  const excepted: string[] = [];
  for (const f of findings) {
    if (f.verdict !== "confirmed" || f.verifiedSeverity === null || !isOpenStatus(f.status))
      continue;
    const sev = f.verifiedSeverity;
    const hit = policy.rules.some(
      (r) =>
        severityAtLeast(sev, r.minSeverity) &&
        (r.attackClasses.length === 0 || r.attackClasses.includes(f.attackClass)),
    );
    if (!hit) continue;
    if (active.has(`${f.projectId}|${f.fingerprint}`)) {
      excepted.push(f.id);
      continue;
    }
    violations.push({ findingId: f.id, fingerprint: f.fingerprint, severity: sev });
  }
  return {
    pass: policy.mode === "report_only" || violations.length === 0,
    mode: policy.mode,
    violations,
    excepted,
    evaluatedAt: now.toISOString(),
  };
};

/** SLA due date from verified severity and first-seen time; null when no SLA applies. */
export const computeSlaDue = (
  verifiedSeverity: Severity | null,
  firstSeen: string,
  slaDays: SlaDays = DEFAULT_SLA_DAYS,
): string | null => {
  if (verifiedSeverity === null) return null;
  const days = slaDays[verifiedSeverity];
  if (days === null || days === undefined) return null;
  return new Date(new Date(firstSeen).getTime() + days * 86_400_000).toISOString();
};
