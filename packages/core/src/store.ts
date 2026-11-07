import type { PlatformEvent } from "./events.js";
import type { Finding, TriageEvent } from "./finding.js";
import type { FindingQuery } from "./api.js";
import type { Exception, Policy } from "./policy.js";
import type { Project } from "./project.js";
import type { Run, RunPhase, Slice } from "./run.js";
import type { DecisionOutcome } from "./jev.js";

/**
 * Persistence interfaces. WS3 implements them with Drizzle on PostgreSQL
 * (apps/api/src/db). WS1 and WS2 code against these and use in-memory fakes in tests.
 *
 * Isolation rule: every read that returns findings takes a `scope` listing the
 * client ids the caller may see. Implementations must filter by it.
 */
export interface AccessScope {
  /** Client ids visible to the caller; `"*"` for platform admins. */
  clientIds: readonly string[] | "*";
}

export interface Page<T> {
  items: T[];
  total: number;
  nextCursor: string | null;
}

export interface ProjectRepo {
  create(p: Project): Promise<Project>;
  get(id: string, scope: AccessScope): Promise<Project | null>;
  list(scope: AccessScope): Promise<Project[]>;
  update(id: string, patch: Partial<Omit<Project, "id" | "createdAt">>): Promise<Project>;
}

export interface RunRepo {
  create(run: Run): Promise<Run>;
  get(id: string, scope: AccessScope): Promise<Run | null>;
  list(
    projectId: string,
    scope: AccessScope,
    opts?: { cursor?: string; limit?: number },
  ): Promise<Page<Run>>;
  update(id: string, patch: Partial<Omit<Run, "id" | "projectId">>): Promise<Run>;
  /** Latest succeeded run of a project, used as the base for focused/incremental runs. */
  latestSucceeded(projectId: string): Promise<Run | null>;
  upsertPhase(phase: RunPhase): Promise<void>;
  upsertSlice(slice: Slice): Promise<void>;
  listSlices(runId: string): Promise<Slice[]>;
}

export interface UpsertResult {
  finding: Finding;
  isNew: boolean;
}

export interface FindingRepo {
  /** Upsert by (projectId, fingerprint). Carries status/owner forward per WS3 rules. */
  upsert(f: Finding): Promise<UpsertResult>;
  get(id: string, scope: AccessScope): Promise<Finding | null>;
  getByFingerprint(projectId: string, fingerprint: string): Promise<Finding | null>;
  query(q: FindingQuery, scope: AccessScope): Promise<Page<Finding>>;
  /** Open findings of a project, all verdicts, for gate evaluation. */
  listOpen(projectId: string): Promise<Finding[]>;
  setStatus(id: string, event: TriageEvent, owner?: string | null): Promise<Finding>;
  history(findingId: string): Promise<TriageEvent[]>;
}

export interface PolicyRepo {
  get(id: string): Promise<Policy | null>;
  upsert(p: Policy): Promise<Policy>;
  listExceptions(projectId: string): Promise<Exception[]>;
  addException(e: Exception): Promise<Exception>;
}

export interface EventRepo {
  append(e: PlatformEvent): Promise<void>;
  listByRun(runId: string, afterSeq?: number): Promise<PlatformEvent[]>;
}

export interface DecisionRepo {
  record(o: DecisionOutcome): Promise<void>;
}

export interface Store {
  projects: ProjectRepo;
  runs: RunRepo;
  findings: FindingRepo;
  policies: PolicyRepo;
  events: EventRepo;
  decisions: DecisionRepo;
  /** Run fn in one transaction. */
  tx<T>(fn: (s: Store) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
