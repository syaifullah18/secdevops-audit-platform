import { z } from "zod";
import { Id, IsoDateTime, Slug } from "./common.js";
import { ModelRouting } from "./model.js";
import { EscalationPolicy } from "./jev.js";

/**
 * A repository under audit. `clientId` is the isolation boundary: one client's
 * findings are never visible to another client's team (PRD 5.7).
 */
export const Project = z.object({
  id: Id,
  slug: Slug,
  name: z.string().min(1).max(200),
  repoUrl: z.string().min(1),
  defaultBranch: z.string().min(1).default("main"),
  /** Owning team slug, for budgets and RBAC. */
  team: Slug,
  /** Tenant / client slug. */
  clientId: Slug,
  policyId: Id.nullable(),
  /** Per-project model routing; falls back to the platform default when empty. */
  modelRouting: ModelRouting.default([]),
  escalation: EscalationPolicy.nullable().default(null),
  /** Path globs treated as security-critical by the router (auth config, filters, IaC, CI). */
  criticalPaths: z.array(z.string()).default([]),
  /** Monthly token budget for this project; null inherits the team/client budget. */
  monthlyTokenBudget: z.number().int().positive().nullable().default(null),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Project = z.infer<typeof Project>;
