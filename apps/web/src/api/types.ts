import { z } from "zod";
import {
  Finding,
  Project,
  Run,
  Slice,
  Policy,
  Exception,
  GateResult,
  FindingQuery,
  FindingPage,
  RunPage,
  TriageRequest,
  TriageEvent,
  PlatformEvent,
} from "@sdap/core";

export {
  Finding,
  Project,
  Run,
  Slice,
  Policy,
  Exception,
  GateResult,
  FindingQuery,
  FindingPage,
  RunPage,
  TriageRequest,
  TriageEvent,
  PlatformEvent,
};

export const CoverageSummarySchema = z.object({
  projectId: z.string(),
  totalUnits: z.number().int().nonnegative(),
  auditedUnits: z.number().int().nonnegative(),
  coveragePct: z.number().min(0).max(100),
  lastAuditedAt: z.string().nullable(),
  uncoveredPaths: z.array(z.string()),
});
export type CoverageSummary = z.infer<typeof CoverageSummarySchema>;

export const OrgOverviewMetricsSchema = z.object({
  totalOpenFindings: z.number().int().nonnegative(),
  openBySeverity: z.record(z.string(), z.number()),
  openByVerdict: z.record(z.string(), z.number()),
  slaBreachesCount: z.number().int().nonnegative(),
  meanTimeToRemediateDays: z.number().nonnegative(),
  crossProjectAttackClasses: z.array(
    z.object({
      attackClass: z.string(),
      count: z.number(),
      byProject: z.record(z.string(), z.number()),
    }),
  ),
  trend: z.array(
    z.object({
      date: z.string(),
      openFindings: z.number(),
      resolvedFindings: z.number(),
    }),
  ),
});
export type OrgOverviewMetrics = z.infer<typeof OrgOverviewMetricsSchema>;
