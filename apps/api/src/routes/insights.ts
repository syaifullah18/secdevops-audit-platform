import type { FastifyPluginAsync } from "fastify";
import { type AccessScope, type Finding, isOpenStatus, RunPage, type Store } from "@sdap/core";
import { z } from "zod";
import { NotFoundError } from "../errors.js";
import { PageQuery, parseId, parseWith } from "../http.js";

/**
 * Read-only aggregates the dashboard needs: organisation overview, exceptions, run list, slices and
 * coverage. Everything is computed from the store, inside the caller's access scope.
 */
export const insightRoutes: FastifyPluginAsync<{ store: Store }> = async (app, opts) => {
  const { store } = opts;

  const allFindings = async (scope: AccessScope): Promise<Finding[]> => {
    const out: Finding[] = [];
    let cursor: string | undefined;
    do {
      const page = await store.findings.query(
        { includeRejected: true, limit: 500, ...(cursor ? { cursor } : {}) },
        scope,
      );
      out.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return out;
  };

  app.get("/overview", async (req) => {
    const findings = await allFindings(req.scope);
    const open = findings.filter((f) => isOpenStatus(f.status));
    const openBySeverity: Record<string, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      informational: 0,
    };
    const openByVerdict: Record<string, number> = {
      confirmed: 0,
      needs_validation: 0,
      rejected: 0,
    };
    for (const f of open) {
      if (f.verifiedSeverity) {
        openBySeverity[f.verifiedSeverity] = (openBySeverity[f.verifiedSeverity] ?? 0) + 1;
      }
      if (f.verdict !== "rejected") openByVerdict[f.verdict] = (openByVerdict[f.verdict] ?? 0) + 1;
    }
    openByVerdict["rejected"] = findings.filter((f) => f.verdict === "rejected").length;

    const now = Date.now();
    const slaBreachesCount = open.filter((f) => f.slaDue && Date.parse(f.slaDue) < now).length;

    const classes = new Map<string, { count: number; byProject: Record<string, number> }>();
    for (const f of open) {
      const entry = classes.get(f.attackClass) ?? { count: 0, byProject: {} };
      entry.count += 1;
      entry.byProject[f.projectId] = (entry.byProject[f.projectId] ?? 0) + 1;
      classes.set(f.attackClass, entry);
    }

    // Measured from the data: time between first and last sighting of fixed findings. No history
    // is invented; with nothing fixed yet the value is null.
    const fixed = findings.filter((f) => f.status === "fixed");
    const mttr =
      fixed.length === 0
        ? null
        : Math.round(
            (fixed.reduce((sum, f) => sum + (Date.parse(f.lastSeen) - Date.parse(f.firstSeen)), 0) /
              fixed.length /
              864e5) *
              10,
          ) / 10;

    const byDay = new Map<string, { open: number; fixed: number }>();
    for (const f of findings) {
      if (f.verdict === "rejected") continue;
      const day = f.firstSeen.slice(0, 10);
      const cur = byDay.get(day) ?? { open: 0, fixed: 0 };
      if (f.status === "fixed") cur.fixed += 1;
      else if (isOpenStatus(f.status)) cur.open += 1;
      byDay.set(day, cur);
    }

    return {
      totalOpenFindings: open.length,
      openBySeverity,
      openByVerdict,
      slaBreachesCount,
      meanTimeToRemediateDays: mttr,
      crossProjectAttackClasses: [...classes.entries()].map(([attackClass, v]) => ({
        attackClass,
        ...v,
      })),
      trend: [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, v]) => ({ date, openFindings: v.open, resolvedFindings: v.fixed })),
    };
  });

  app.get("/exceptions", async (req) => {
    const { projectId } = parseWith(
      z.object({ projectId: z.string().optional() }),
      req.query ?? {},
      "query",
    );
    const projects = await store.projects.list(req.scope);
    const wanted = projectId ? projects.filter((p) => p.id === projectId) : projects;
    const lists = await Promise.all(wanted.map((p) => store.policies.listExceptions(p.id)));
    return lists.flat();
  });

  app.get("/runs", async (req) => {
    const { limit } = parseWith(PageQuery, req.query ?? {}, "query");
    const projects = await store.projects.list(req.scope);
    const pages = await Promise.all(
      projects.map((p) => store.runs.list(p.id, req.scope, { limit })),
    );
    const items = pages
      .flatMap((p) => p.items)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return RunPage.parse({ items: items.slice(0, limit), total: items.length, nextCursor: null });
  });

  app.get("/runs/:id/slices", async (req) => {
    const id = parseId((req.params as { id: string }).id, "Run");
    if (!(await store.runs.get(id, req.scope))) throw new NotFoundError("Run not found");
    return store.runs.listSlices(id);
  });

  app.get("/projects/:id/coverage", async (req) => {
    const id = parseId((req.params as { id: string }).id, "Project");
    if (!(await store.projects.get(id, req.scope))) throw new NotFoundError("Project not found");
    const run = await store.runs.latestSucceeded(id);
    const slices = run ? await store.runs.listSlices(run.id) : [];
    const units = new Map<string, boolean>();
    for (const s of slices) {
      const keys = s.coverageIds.length > 0 ? s.coverageIds : [s.id];
      for (const k of keys) units.set(k, (units.get(k) ?? false) || s.status === "succeeded");
    }
    const audited = [...units.values()].filter(Boolean).length;
    const uncovered = slices
      .filter((s) => s.status !== "succeeded")
      .flatMap((s) => s.paths)
      .slice(0, 50);
    return {
      projectId: id,
      totalUnits: units.size,
      auditedUnits: audited,
      coveragePct: units.size === 0 ? 0 : Math.round((audited / units.size) * 1000) / 10,
      lastAuditedAt: run?.endedAt ?? null,
      uncoveredPaths: uncovered,
    };
  });
};
