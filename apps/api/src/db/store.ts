import { and, asc, desc, eq, gt, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  type AccessScope,
  type DecisionOutcome,
  type DecisionRepo,
  type EventRepo,
  type Exception,
  type Finding,
  Finding as FindingContract,
  type FindingQuery,
  type FindingRepo,
  type Page,
  type PlatformEvent,
  PlatformEvent as PlatformEventContract,
  type Policy,
  Policy as PolicyContract,
  type PolicyRepo,
  type Project,
  Project as ProjectContract,
  type ProjectRepo,
  type Run,
  Run as RunContract,
  type RunPhase,
  type RunRepo,
  SEVERITY_RANK,
  type Severity,
  type Slice,
  type Store,
  type TriageEvent,
  TriageEvent as TriageEventContract,
  type UpsertResult,
} from "@sdap/core";
import { mergeFindings, secondaryFingerprint } from "@sdap/normalizer";
import * as schema from "./schema.js";

const { Pool } = pg;

// Helper to check access scope on client_id column
const scopeCondition = (column: typeof schema.projects.clientId, scope: AccessScope) => {
  if (scope.clientIds === "*") {
    return sql`TRUE`;
  }
  if (!scope.clientIds || scope.clientIds.length === 0) {
    return sql`FALSE`;
  }
  return inArray(column, scope.clientIds as string[]);
};

const severitiesAtLeast = (min: Severity): Severity[] => {
  const minRank = SEVERITY_RANK[min];
  const all: Severity[] = ["informational", "low", "medium", "high", "critical"];
  return all.filter((s) => SEVERITY_RANK[s] >= minRank);
};

export class PgStore implements Store {
  readonly projects: ProjectRepo;
  readonly runs: RunRepo;
  readonly findings: FindingRepo;
  readonly policies: PolicyRepo;
  readonly events: EventRepo;
  readonly decisions: DecisionRepo;

  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly pool?: pg.Pool,
  ) {
    this.projects = new PgProjectRepo(this.db);
    this.runs = new PgRunRepo(this.db);
    this.findings = new PgFindingRepo(this.db);
    this.policies = new PgPolicyRepo(this.db);
    this.events = new PgEventRepo(this.db);
    this.decisions = new PgDecisionRepo(this.db);
  }

  async tx<T>(fn: (s: Store) => Promise<T>): Promise<T> {
    return this.db.transaction(async (txDb) => {
      const txStore = new PgStore(txDb as unknown as NodePgDatabase<typeof schema>);
      return fn(txStore);
    });
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
    }
  }
}

class PgProjectRepo implements ProjectRepo {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async create(p: Project): Promise<Project> {
    const validated = ProjectContract.parse(p);
    await this.db.insert(schema.projects).values({
      id: validated.id,
      slug: validated.slug,
      name: validated.name,
      repoUrl: validated.repoUrl,
      defaultBranch: validated.defaultBranch,
      team: validated.team,
      clientId: validated.clientId,
      policyId: validated.policyId,
      modelRouting: validated.modelRouting,
      escalation: validated.escalation,
      criticalPaths: validated.criticalPaths,
      monthlyTokenBudget: validated.monthlyTokenBudget,
      createdAt: validated.createdAt,
      updatedAt: validated.updatedAt,
    });
    return validated;
  }

  async get(id: string, scope: AccessScope): Promise<Project | null> {
    const rows = await this.db
      .select()
      .from(schema.projects)
      .where(and(eq(schema.projects.id, id), scopeCondition(schema.projects.clientId, scope)))
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    return ProjectContract.parse({
      id: row.id,
      slug: row.slug,
      name: row.name,
      repoUrl: row.repoUrl,
      defaultBranch: row.defaultBranch,
      team: row.team,
      clientId: row.clientId,
      policyId: row.policyId,
      modelRouting: row.modelRouting,
      escalation: row.escalation,
      criticalPaths: row.criticalPaths,
      monthlyTokenBudget: row.monthlyTokenBudget,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  async list(scope: AccessScope): Promise<Project[]> {
    const rows = await this.db
      .select()
      .from(schema.projects)
      .where(scopeCondition(schema.projects.clientId, scope))
      .orderBy(asc(schema.projects.name));

    return rows.map((row) =>
      ProjectContract.parse({
        id: row.id,
        slug: row.slug,
        name: row.name,
        repoUrl: row.repoUrl,
        defaultBranch: row.defaultBranch,
        team: row.team,
        clientId: row.clientId,
        policyId: row.policyId,
        modelRouting: row.modelRouting,
        escalation: row.escalation,
        criticalPaths: row.criticalPaths,
        monthlyTokenBudget: row.monthlyTokenBudget,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }),
    );
  }

  async update(id: string, patch: Partial<Omit<Project, "id" | "createdAt">>): Promise<Project> {
    const updateValues: Record<string, unknown> = {};
    if (patch.slug !== undefined) updateValues["slug"] = patch.slug;
    if (patch.name !== undefined) updateValues["name"] = patch.name;
    if (patch.repoUrl !== undefined) updateValues["repoUrl"] = patch.repoUrl;
    if (patch.defaultBranch !== undefined) updateValues["defaultBranch"] = patch.defaultBranch;
    if (patch.team !== undefined) updateValues["team"] = patch.team;
    if (patch.clientId !== undefined) updateValues["clientId"] = patch.clientId;
    if (patch.policyId !== undefined) updateValues["policyId"] = patch.policyId;
    if (patch.modelRouting !== undefined) updateValues["modelRouting"] = patch.modelRouting;
    if (patch.escalation !== undefined) updateValues["escalation"] = patch.escalation;
    if (patch.criticalPaths !== undefined) updateValues["criticalPaths"] = patch.criticalPaths;
    if (patch.monthlyTokenBudget !== undefined)
      updateValues["monthlyTokenBudget"] = patch.monthlyTokenBudget;
    if (patch.updatedAt !== undefined) updateValues["updatedAt"] = patch.updatedAt;

    const rows = await this.db
      .update(schema.projects)
      .set(updateValues)
      .where(eq(schema.projects.id, id))
      .returning();

    const row = rows[0];
    if (!row) throw new Error(`Project ${id} not found for update`);
    return ProjectContract.parse({
      id: row.id,
      slug: row.slug,
      name: row.name,
      repoUrl: row.repoUrl,
      defaultBranch: row.defaultBranch,
      team: row.team,
      clientId: row.clientId,
      policyId: row.policyId,
      modelRouting: row.modelRouting,
      escalation: row.escalation,
      criticalPaths: row.criticalPaths,
      monthlyTokenBudget: row.monthlyTokenBudget,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}

class PgRunRepo implements RunRepo {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  private async loadPhases(runId: string): Promise<RunPhase[]> {
    const rows = await this.db
      .select()
      .from(schema.runPhases)
      .where(eq(schema.runPhases.runId, runId))
      .orderBy(asc(schema.runPhases.name));

    return rows.map((r) => ({
      runId: r.runId,
      name: r.name,
      status: r.status,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      sliceCount: r.sliceCount,
      slicesDone: r.slicesDone,
      usage: r.usage,
    }));
  }

  async create(run: Run): Promise<Run> {
    const validated = RunContract.parse(run);
    await this.db.insert(schema.runs).values({
      id: validated.id,
      projectId: validated.projectId,
      mode: validated.mode,
      repeat: validated.repeat,
      trigger: validated.trigger,
      ref: validated.ref,
      commitSha: validated.commitSha,
      baseCommitSha: validated.baseCommitSha,
      previousRunId: validated.previousRunId,
      scope: validated.scope,
      status: validated.status,
      validators: validated.validators,
      skillVersion: validated.skillVersion,
      usage: validated.usage,
      artifacts: validated.artifacts,
      failureReason: validated.failureReason,
      retries: validated.retries,
      createdAt: validated.createdAt,
      startedAt: validated.startedAt,
      endedAt: validated.endedAt,
    });

    if (validated.phases && validated.phases.length > 0) {
      for (const phase of validated.phases) {
        await this.upsertPhase(phase);
      }
    }

    return validated;
  }

  async get(id: string, scope: AccessScope): Promise<Run | null> {
    const rows = await this.db
      .select({ run: schema.runs })
      .from(schema.runs)
      .innerJoin(schema.projects, eq(schema.runs.projectId, schema.projects.id))
      .where(and(eq(schema.runs.id, id), scopeCondition(schema.projects.clientId, scope)))
      .limit(1);

    const row = rows[0]?.run;
    if (!row) return null;

    const phases = await this.loadPhases(row.id);
    return RunContract.parse({
      id: row.id,
      projectId: row.projectId,
      mode: row.mode,
      repeat: row.repeat,
      trigger: row.trigger,
      ref: row.ref,
      commitSha: row.commitSha,
      baseCommitSha: row.baseCommitSha,
      previousRunId: row.previousRunId,
      scope: row.scope,
      status: row.status,
      phases,
      validators: row.validators,
      skillVersion: row.skillVersion,
      usage: row.usage,
      artifacts: row.artifacts,
      failureReason: row.failureReason,
      retries: row.retries,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
    });
  }

  async list(
    projectId: string,
    scope: AccessScope,
    opts?: { cursor?: string; limit?: number },
  ): Promise<Page<Run>> {
    const limit = opts?.limit ?? 50;
    const conditions = [
      eq(schema.runs.projectId, projectId),
      scopeCondition(schema.projects.clientId, scope),
    ];

    if (opts?.cursor) {
      const [cursorTime, cursorId] = opts.cursor.includes("_")
        ? opts.cursor.split("_")
        : [opts.cursor, ""];
      if (cursorTime) {
        if (cursorId) {
          conditions.push(
            or(
              lt(schema.runs.createdAt, cursorTime),
              and(eq(schema.runs.createdAt, cursorTime), lt(schema.runs.id, cursorId)),
            ) as unknown as ReturnType<typeof eq>,
          );
        } else {
          conditions.push(lt(schema.runs.createdAt, cursorTime));
        }
      }
    }

    const whereClause = and(...conditions);

    // Count total
    const countResult = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.runs)
      .innerJoin(schema.projects, eq(schema.runs.projectId, schema.projects.id))
      .where(
        and(eq(schema.runs.projectId, projectId), scopeCondition(schema.projects.clientId, scope)),
      );
    const total = countResult[0]?.count ?? 0;

    const rows = await this.db
      .select({ run: schema.runs })
      .from(schema.runs)
      .innerJoin(schema.projects, eq(schema.runs.projectId, schema.projects.id))
      .where(whereClause)
      .orderBy(desc(schema.runs.createdAt), desc(schema.runs.id))
      .limit(limit);

    const items: Run[] = [];
    for (const r of rows) {
      const phases = await this.loadPhases(r.run.id);
      items.push(
        RunContract.parse({
          id: r.run.id,
          projectId: r.run.projectId,
          mode: r.run.mode,
          repeat: r.run.repeat,
          trigger: r.run.trigger,
          ref: r.run.ref,
          commitSha: r.run.commitSha,
          baseCommitSha: r.run.baseCommitSha,
          previousRunId: r.run.previousRunId,
          scope: r.run.scope,
          status: r.run.status,
          phases,
          validators: r.run.validators,
          skillVersion: r.run.skillVersion,
          usage: r.run.usage,
          artifacts: r.run.artifacts,
          failureReason: r.run.failureReason,
          retries: r.run.retries,
          createdAt: r.run.createdAt,
          startedAt: r.run.startedAt,
          endedAt: r.run.endedAt,
        }),
      );
    }

    const lastItem = items[items.length - 1];
    const nextCursor =
      items.length === limit && lastItem ? `${lastItem.createdAt}_${lastItem.id}` : null;

    return { items, total, nextCursor };
  }

  async update(id: string, patch: Partial<Omit<Run, "id" | "projectId">>): Promise<Run> {
    const updateValues: Record<string, unknown> = {};
    if (patch.mode !== undefined) updateValues["mode"] = patch.mode;
    if (patch.repeat !== undefined) updateValues["repeat"] = patch.repeat;
    if (patch.trigger !== undefined) updateValues["trigger"] = patch.trigger;
    if (patch.ref !== undefined) updateValues["ref"] = patch.ref;
    if (patch.commitSha !== undefined) updateValues["commitSha"] = patch.commitSha;
    if (patch.baseCommitSha !== undefined) updateValues["baseCommitSha"] = patch.baseCommitSha;
    if (patch.previousRunId !== undefined) updateValues["previousRunId"] = patch.previousRunId;
    if (patch.scope !== undefined) updateValues["scope"] = patch.scope;
    if (patch.status !== undefined) updateValues["status"] = patch.status;
    if (patch.validators !== undefined) updateValues["validators"] = patch.validators;
    if (patch.skillVersion !== undefined) updateValues["skillVersion"] = patch.skillVersion;
    if (patch.usage !== undefined) updateValues["usage"] = patch.usage;
    if (patch.artifacts !== undefined) updateValues["artifacts"] = patch.artifacts;
    if (patch.failureReason !== undefined) updateValues["failureReason"] = patch.failureReason;
    if (patch.retries !== undefined) updateValues["retries"] = patch.retries;
    if (patch.startedAt !== undefined) updateValues["startedAt"] = patch.startedAt;
    if (patch.endedAt !== undefined) updateValues["endedAt"] = patch.endedAt;

    if (Object.keys(updateValues).length > 0) {
      await this.db.update(schema.runs).set(updateValues).where(eq(schema.runs.id, id));
    }

    if (patch.phases) {
      for (const phase of patch.phases) {
        await this.upsertPhase(phase);
      }
    }

    const rows = await this.db.select().from(schema.runs).where(eq(schema.runs.id, id)).limit(1);

    const row = rows[0];
    if (!row) throw new Error(`Run ${id} not found for update`);
    const phases = await this.loadPhases(id);

    return RunContract.parse({
      id: row.id,
      projectId: row.projectId,
      mode: row.mode,
      repeat: row.repeat,
      trigger: row.trigger,
      ref: row.ref,
      commitSha: row.commitSha,
      baseCommitSha: row.baseCommitSha,
      previousRunId: row.previousRunId,
      scope: row.scope,
      status: row.status,
      phases,
      validators: row.validators,
      skillVersion: row.skillVersion,
      usage: row.usage,
      artifacts: row.artifacts,
      failureReason: row.failureReason,
      retries: row.retries,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
    });
  }

  async latestSucceeded(projectId: string): Promise<Run | null> {
    const rows = await this.db
      .select()
      .from(schema.runs)
      .where(and(eq(schema.runs.projectId, projectId), eq(schema.runs.status, "succeeded")))
      .orderBy(desc(schema.runs.createdAt))
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    const phases = await this.loadPhases(row.id);

    return RunContract.parse({
      id: row.id,
      projectId: row.projectId,
      mode: row.mode,
      repeat: row.repeat,
      trigger: row.trigger,
      ref: row.ref,
      commitSha: row.commitSha,
      baseCommitSha: row.baseCommitSha,
      previousRunId: row.previousRunId,
      scope: row.scope,
      status: row.status,
      phases,
      validators: row.validators,
      skillVersion: row.skillVersion,
      usage: row.usage,
      artifacts: row.artifacts,
      failureReason: row.failureReason,
      retries: row.retries,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
    });
  }

  async upsertPhase(phase: RunPhase): Promise<void> {
    await this.db
      .insert(schema.runPhases)
      .values({
        runId: phase.runId,
        name: phase.name,
        status: phase.status,
        startedAt: phase.startedAt,
        endedAt: phase.endedAt,
        sliceCount: phase.sliceCount,
        slicesDone: phase.slicesDone,
        usage: phase.usage,
      })
      .onConflictDoUpdate({
        target: [schema.runPhases.runId, schema.runPhases.name],
        set: {
          status: phase.status,
          startedAt: phase.startedAt,
          endedAt: phase.endedAt,
          sliceCount: phase.sliceCount,
          slicesDone: phase.slicesDone,
          usage: phase.usage,
        },
      });
  }

  async upsertSlice(slice: Slice): Promise<void> {
    await this.db
      .insert(schema.slices)
      .values({
        id: slice.id,
        runId: slice.runId,
        phase: slice.phase,
        label: slice.label,
        attackClass: slice.attackClass,
        coverageIds: slice.coverageIds,
        paths: slice.paths,
        status: slice.status,
        attempts: slice.attempts,
        startedAt: slice.startedAt,
        endedAt: slice.endedAt,
      })
      .onConflictDoUpdate({
        target: schema.slices.id,
        set: {
          phase: slice.phase,
          label: slice.label,
          attackClass: slice.attackClass,
          coverageIds: slice.coverageIds,
          paths: slice.paths,
          status: slice.status,
          attempts: slice.attempts,
          startedAt: slice.startedAt,
          endedAt: slice.endedAt,
        },
      });
  }

  async listSlices(runId: string): Promise<Slice[]> {
    const rows = await this.db
      .select()
      .from(schema.slices)
      .where(eq(schema.slices.runId, runId))
      .orderBy(asc(schema.slices.label));

    return rows.map((r) => ({
      id: r.id,
      runId: r.runId,
      phase: r.phase,
      label: r.label,
      attackClass: r.attackClass,
      coverageIds: r.coverageIds,
      paths: r.paths,
      status: r.status,
      attempts: r.attempts,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
    }));
  }
}

class PgFindingRepo implements FindingRepo {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  private mapRowToFinding(row: typeof schema.findings.$inferSelect): Finding {
    return FindingContract.parse({
      id: row.id,
      projectId: row.projectId,
      fingerprint: row.fingerprint,
      sourceRun: row.sourceRun,
      firstRun: row.firstRun,
      attackClass: row.attackClass,
      cwe: row.cwe,
      title: row.title,
      description: row.description,
      rootCause: row.rootCause,
      location: row.location,
      trace: row.trace,
      evidence: row.evidence,
      verdict: row.verdict,
      originalSeverity: row.originalSeverity,
      verifiedSeverity: row.verifiedSeverity,
      confidence: row.confidence,
      status: row.status,
      owner: row.owner,
      firstSeen: row.firstSeen,
      lastSeen: row.lastSeen,
      slaDue: row.slaDue,
      model: row.model,
      phase: row.phase,
      blockers: row.blockers,
      rejectionReason: row.rejectionReason,
      remediation: row.remediation,
      triageSuggestion: row.triageSuggestion ?? null,
      rootCauseGroup: row.rootCauseGroup,
    });
  }

  async upsert(incoming: Finding): Promise<UpsertResult> {
    const validated = FindingContract.parse(incoming);
    const now = new Date();

    // Look for existing finding in this project by primary fingerprint
    let existingRow = (
      await this.db
        .select()
        .from(schema.findings)
        .where(
          and(
            eq(schema.findings.projectId, validated.projectId),
            eq(schema.findings.fingerprint, validated.fingerprint),
          ),
        )
        .limit(1)
    )[0];

    // If not found, look up by secondary fingerprint
    if (!existingRow) {
      const sfp = secondaryFingerprint(validated);
      const candidates = await this.db
        .select()
        .from(schema.findings)
        .where(
          and(
            eq(schema.findings.projectId, validated.projectId),
            eq(schema.findings.secondaryFingerprint, sfp),
          ),
        )
        .orderBy(asc(schema.findings.firstSeen))
        .limit(1);

      if (candidates[0]) {
        existingRow = candidates[0];
      }
    }

    const existingFindings = existingRow ? [this.mapRowToFinding(existingRow)] : [];
    const outcomes = mergeFindings(existingFindings, [validated], now);
    const outcome = outcomes[0];
    if (!outcome) {
      throw new Error("mergeFindings returned no outcome");
    }

    const f = outcome.finding;
    const sfp = secondaryFingerprint(f);

    if (outcome.isNew) {
      await this.db.insert(schema.findings).values({
        id: f.id,
        projectId: f.projectId,
        fingerprint: f.fingerprint,
        secondaryFingerprint: sfp,
        sourceRun: f.sourceRun,
        firstRun: f.firstRun,
        attackClass: f.attackClass,
        cwe: f.cwe,
        title: f.title,
        description: f.description,
        rootCause: f.rootCause,
        location: f.location,
        trace: f.trace,
        evidence: f.evidence,
        verdict: f.verdict,
        originalSeverity: f.originalSeverity,
        verifiedSeverity: f.verifiedSeverity,
        confidence: f.confidence,
        status: f.status,
        owner: f.owner,
        firstSeen: f.firstSeen,
        lastSeen: f.lastSeen,
        slaDue: f.slaDue,
        model: f.model,
        phase: f.phase,
        blockers: f.blockers,
        rejectionReason: f.rejectionReason,
        remediation: f.remediation,
        triageSuggestion: f.triageSuggestion,
        rootCauseGroup: f.rootCauseGroup,
        createdAt: f.firstSeen,
        updatedAt: f.lastSeen,
      });
      return { finding: f, isNew: true };
    } else {
      await this.db
        .update(schema.findings)
        .set({
          fingerprint: f.fingerprint,
          secondaryFingerprint: sfp,
          sourceRun: f.sourceRun,
          firstRun: f.firstRun,
          attackClass: f.attackClass,
          cwe: f.cwe,
          title: f.title,
          description: f.description,
          rootCause: f.rootCause,
          location: f.location,
          trace: f.trace,
          evidence: f.evidence,
          verdict: f.verdict,
          originalSeverity: f.originalSeverity,
          verifiedSeverity: f.verifiedSeverity,
          confidence: f.confidence,
          status: f.status,
          owner: f.owner,
          firstSeen: f.firstSeen,
          lastSeen: f.lastSeen,
          slaDue: f.slaDue,
          model: f.model,
          phase: f.phase,
          blockers: f.blockers,
          rejectionReason: f.rejectionReason,
          remediation: f.remediation,
          triageSuggestion: f.triageSuggestion,
          rootCauseGroup: f.rootCauseGroup,
          updatedAt: f.lastSeen,
        })
        .where(eq(schema.findings.id, f.id));

      return { finding: f, isNew: false };
    }
  }

  async get(id: string, scope: AccessScope): Promise<Finding | null> {
    const rows = await this.db
      .select({ finding: schema.findings })
      .from(schema.findings)
      .innerJoin(schema.projects, eq(schema.findings.projectId, schema.projects.id))
      .where(and(eq(schema.findings.id, id), scopeCondition(schema.projects.clientId, scope)))
      .limit(1);

    const row = rows[0]?.finding;
    if (!row) return null;
    return this.mapRowToFinding(row);
  }

  async getByFingerprint(projectId: string, fingerprint: string): Promise<Finding | null> {
    const rows = await this.db
      .select()
      .from(schema.findings)
      .where(
        and(eq(schema.findings.projectId, projectId), eq(schema.findings.fingerprint, fingerprint)),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    return this.mapRowToFinding(row);
  }

  async query(q: FindingQuery, scope: AccessScope): Promise<Page<Finding>> {
    const limit: number = typeof q.limit === "number" ? q.limit : 50;
    const conditions = [scopeCondition(schema.projects.clientId, scope)];

    if (q.projectId) {
      conditions.push(eq(schema.findings.projectId, q.projectId));
    }

    if (q.verdict && q.verdict.length > 0) {
      conditions.push(inArray(schema.findings.verdict, q.verdict));
    } else if (!q.includeRejected) {
      conditions.push(sql`${schema.findings.verdict} != 'rejected'`);
    }

    if (q.status && q.status.length > 0) {
      conditions.push(inArray(schema.findings.status, q.status));
    }

    if (q.minSeverity) {
      const allowedSeverities = severitiesAtLeast(q.minSeverity);
      conditions.push(inArray(schema.findings.verifiedSeverity, allowedSeverities));
    }

    if (q.attackClass && q.attackClass.length > 0) {
      conditions.push(inArray(schema.findings.attackClass, q.attackClass));
    }

    if (q.q) {
      const searchPattern = `%${q.q}%`;
      conditions.push(
        or(
          ilike(schema.findings.title, searchPattern),
          ilike(schema.findings.description, searchPattern),
          ilike(schema.findings.rootCause, searchPattern),
        ) as unknown as ReturnType<typeof eq>,
      );
    }

    if (q.cursor) {
      const [cursorTime, cursorId] = q.cursor.includes("_") ? q.cursor.split("_") : [q.cursor, ""];
      if (cursorTime) {
        if (cursorId) {
          conditions.push(
            or(
              lt(schema.findings.lastSeen, cursorTime),
              and(eq(schema.findings.lastSeen, cursorTime), lt(schema.findings.id, cursorId)),
            ) as unknown as ReturnType<typeof eq>,
          );
        } else {
          conditions.push(lt(schema.findings.lastSeen, cursorTime));
        }
      }
    }

    const whereClause = and(...conditions);

    // Total count for query conditions
    const countConditions = conditions.filter(
      (c) => c !== conditions[conditions.length - 1] || !q.cursor,
    );
    const countResult = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.findings)
      .innerJoin(schema.projects, eq(schema.findings.projectId, schema.projects.id))
      .where(and(...countConditions));
    const total = countResult[0]?.count ?? 0;

    const rows = await this.db
      .select({ finding: schema.findings })
      .from(schema.findings)
      .innerJoin(schema.projects, eq(schema.findings.projectId, schema.projects.id))
      .where(whereClause)
      .orderBy(desc(schema.findings.lastSeen), desc(schema.findings.id))
      .limit(limit);

    const items = rows.map((r) => this.mapRowToFinding(r.finding));
    const lastItem = items[items.length - 1];
    const nextCursor =
      items.length === limit && lastItem ? `${lastItem.lastSeen}_${lastItem.id}` : null;

    return { items, total, nextCursor };
  }

  async listOpen(projectId: string): Promise<Finding[]> {
    const rows = await this.db
      .select()
      .from(schema.findings)
      .where(
        and(
          eq(schema.findings.projectId, projectId),
          inArray(schema.findings.status, ["new", "confirmed", "in_progress"]),
        ),
      )
      .orderBy(desc(schema.findings.lastSeen));

    return rows.map((r) => this.mapRowToFinding(r));
  }

  async setStatus(id: string, event: TriageEvent, owner?: string | null): Promise<Finding> {
    const validatedEvent = TriageEventContract.parse(event);

    const updateSet: Record<string, unknown> = {
      status: validatedEvent.to,
      updatedAt: validatedEvent.at,
    };
    if (owner !== undefined) {
      updateSet["owner"] = owner;
    }

    const rows = await this.db
      .update(schema.findings)
      .set(updateSet)
      .where(eq(schema.findings.id, id))
      .returning();

    const row = rows[0];
    if (!row) throw new Error(`Finding ${id} not found for setStatus`);

    await this.db.insert(schema.triageEvents).values({
      id: validatedEvent.id,
      findingId: validatedEvent.findingId,
      from: validatedEvent.from,
      to: validatedEvent.to,
      actor: validatedEvent.actor,
      reason: validatedEvent.reason,
      at: validatedEvent.at,
    });

    return this.mapRowToFinding(row);
  }

  async history(findingId: string): Promise<TriageEvent[]> {
    const rows = await this.db
      .select()
      .from(schema.triageEvents)
      .where(eq(schema.triageEvents.findingId, findingId))
      .orderBy(asc(schema.triageEvents.at));

    return rows.map((r) =>
      TriageEventContract.parse({
        id: r.id,
        findingId: r.findingId,
        from: r.from,
        to: r.to,
        actor: r.actor,
        reason: r.reason,
        at: r.at,
      }),
    );
  }
}

class PgPolicyRepo implements PolicyRepo {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async get(id: string): Promise<Policy | null> {
    const rows = await this.db
      .select()
      .from(schema.policies)
      .where(eq(schema.policies.id, id))
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    return PolicyContract.parse({
      id: row.id,
      name: row.name,
      mode: row.mode,
      rules: row.rules,
      slaDays: row.slaDays,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  async upsert(p: Policy): Promise<Policy> {
    const validated = PolicyContract.parse(p);
    await this.db
      .insert(schema.policies)
      .values({
        id: validated.id,
        name: validated.name,
        mode: validated.mode,
        rules: validated.rules,
        slaDays: validated.slaDays,
        createdAt: validated.createdAt,
        updatedAt: validated.updatedAt,
      })
      .onConflictDoUpdate({
        target: schema.policies.id,
        set: {
          name: validated.name,
          mode: validated.mode,
          rules: validated.rules,
          slaDays: validated.slaDays,
          updatedAt: validated.updatedAt,
        },
      });

    return validated;
  }

  async listExceptions(projectId: string): Promise<Exception[]> {
    const rows = await this.db
      .select()
      .from(schema.exceptions)
      .where(eq(schema.exceptions.projectId, projectId))
      .orderBy(desc(schema.exceptions.createdAt));

    return rows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      fingerprint: r.fingerprint,
      kind: r.kind,
      reason: r.reason,
      approver: r.approver,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    }));
  }

  async addException(e: Exception): Promise<Exception> {
    await this.db.insert(schema.exceptions).values({
      id: e.id,
      projectId: e.projectId,
      fingerprint: e.fingerprint,
      kind: e.kind,
      reason: e.reason,
      approver: e.approver,
      expiresAt: e.expiresAt,
      createdAt: e.createdAt,
    });
    return e;
  }
}

class PgEventRepo implements EventRepo {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async append(e: PlatformEvent): Promise<void> {
    const validated = PlatformEventContract.parse(e);
    await this.db.insert(schema.events).values({
      id: validated.id,
      runId: validated.runId,
      projectId: validated.projectId,
      seq: validated.seq,
      type: validated.type,
      payload: validated.payload,
      at: validated.at,
    });
  }

  async listByRun(runId: string, afterSeq?: number): Promise<PlatformEvent[]> {
    const conditions = [eq(schema.events.runId, runId)];
    if (afterSeq !== undefined) {
      conditions.push(gt(schema.events.seq, afterSeq));
    }

    const rows = await this.db
      .select()
      .from(schema.events)
      .where(and(...conditions))
      .orderBy(asc(schema.events.seq));

    return rows.map((r) =>
      PlatformEventContract.parse({
        id: r.id,
        runId: r.runId,
        projectId: r.projectId,
        seq: r.seq,
        type: r.type,
        payload: r.payload,
        at: r.at,
      }),
    );
  }
}

class PgDecisionRepo implements DecisionRepo {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async record(o: DecisionOutcome): Promise<void> {
    const id = crypto.randomUUID();
    await this.db.insert(schema.decisions).values({
      id,
      questionId: o.decision.questionId,
      key: o.decision.key,
      projectId: o.question.projectId ?? null,
      question: o.question,
      decision: o.decision,
      laterVerdict: o.laterVerdict ?? null,
      humanLabel: o.humanLabel ?? null,
      decidedAt: o.decision.decidedAt,
    });
  }
}

export function createPgStore(databaseUrlOrPool: string | pg.Pool): Store {
  const pool =
    typeof databaseUrlOrPool === "string"
      ? new Pool({ connectionString: databaseUrlOrPool })
      : databaseUrlOrPool;

  const db = drizzle(pool, { schema });
  return new PgStore(db, typeof databaseUrlOrPool === "string" ? pool : undefined);
}
