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
  type Policy,
  type PolicyRepo,
  type Project,
  Project as ProjectContract,
  type ProjectRepo,
  type Run,
  Run as RunContract,
  type RunPhase,
  type RunRepo,
  severityAtLeast,
  type Slice,
  type Store,
  type TriageEvent,
  type UpsertResult,
} from "@sdap/core";
import { mergeFindings, secondaryFingerprint } from "@sdap/normalizer";

const matchesScope = (clientId: string, scope: AccessScope): boolean => {
  if (scope.clientIds === "*") return true;
  return scope.clientIds.includes(clientId);
};

export class MemoryStore implements Store {
  readonly projects: ProjectRepo;
  readonly runs: RunRepo;
  readonly findings: FindingRepo;
  readonly policies: PolicyRepo;
  readonly events: EventRepo;
  readonly decisions: DecisionRepo;

  // Internal state
  readonly projectList: Project[] = [];
  readonly runList: Run[] = [];
  readonly phaseList: RunPhase[] = [];
  readonly sliceList: Slice[] = [];
  readonly findingList: Finding[] = [];
  readonly triageHistory: Map<string, TriageEvent[]> = new Map();
  readonly policyList: Policy[] = [];
  readonly exceptionList: Exception[] = [];
  readonly eventList: PlatformEvent[] = [];
  readonly decisionList: DecisionOutcome[] = [];

  constructor() {
    this.projects = new MemoryProjectRepo(this);
    this.runs = new MemoryRunRepo(this);
    this.findings = new MemoryFindingRepo(this);
    this.policies = new MemoryPolicyRepo(this);
    this.events = new MemoryEventRepo(this);
    this.decisions = new MemoryDecisionRepo(this);
  }

  async tx<T>(fn: (s: Store) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async close(): Promise<void> {
    // In-memory store no-op
  }

  clear(): void {
    this.projectList.length = 0;
    this.runList.length = 0;
    this.phaseList.length = 0;
    this.sliceList.length = 0;
    this.findingList.length = 0;
    this.triageHistory.clear();
    this.policyList.length = 0;
    this.exceptionList.length = 0;
    this.eventList.length = 0;
    this.decisionList.length = 0;
  }
}

class MemoryProjectRepo implements ProjectRepo {
  constructor(private readonly store: MemoryStore) {}

  async create(p: Project): Promise<Project> {
    const validated = ProjectContract.parse(p);
    const existingIndex = this.store.projectList.findIndex((item) => item.id === validated.id);
    if (existingIndex >= 0) {
      throw new Error(`Project with id ${validated.id} already exists`);
    }
    this.store.projectList.push(validated);
    return validated;
  }

  async get(id: string, scope: AccessScope): Promise<Project | null> {
    const project = this.store.projectList.find((p) => p.id === id);
    if (!project) return null;
    if (!matchesScope(project.clientId, scope)) return null;
    return project;
  }

  async list(scope: AccessScope): Promise<Project[]> {
    return this.store.projectList
      .filter((p) => matchesScope(p.clientId, scope))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async update(id: string, patch: Partial<Omit<Project, "id" | "createdAt">>): Promise<Project> {
    const index = this.store.projectList.findIndex((p) => p.id === id);
    if (index === -1) {
      throw new Error(`Project with id ${id} not found`);
    }
    const current = this.store.projectList[index]!;
    const updated = ProjectContract.parse({
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    });
    this.store.projectList[index] = updated;
    return updated;
  }
}

class MemoryRunRepo implements RunRepo {
  constructor(private readonly store: MemoryStore) {}

  async create(run: Run): Promise<Run> {
    const validated = RunContract.parse(run);
    this.store.runList.push(validated);
    return validated;
  }

  async get(id: string, scope: AccessScope): Promise<Run | null> {
    const run = this.store.runList.find((r) => r.id === id);
    if (!run) return null;
    const project = this.store.projectList.find((p) => p.id === run.projectId);
    if (!project || !matchesScope(project.clientId, scope)) return null;
    const phases = this.store.phaseList.filter((ph) => ph.runId === run.id);
    return { ...run, phases };
  }

  async list(
    projectId: string,
    scope: AccessScope,
    opts?: { cursor?: string; limit?: number },
  ): Promise<Page<Run>> {
    const project = this.store.projectList.find((p) => p.id === projectId);
    if (!project || !matchesScope(project.clientId, scope)) {
      return { items: [], total: 0, nextCursor: null };
    }

    const all = this.store.runList
      .filter((r) => r.projectId === projectId)
      .sort((a, b) => {
        const timeCmp = b.createdAt.localeCompare(a.createdAt);
        if (timeCmp !== 0) return timeCmp;
        return b.id.localeCompare(a.id);
      });

    const total = all.length;
    let filtered = all;

    if (opts?.cursor) {
      const [cursorTime, cursorId] = opts.cursor.includes("_")
        ? opts.cursor.split("_")
        : [opts.cursor, ""];
      filtered = all.filter((r) => {
        if (!cursorTime) return true;
        const timeDiff = r.createdAt.localeCompare(cursorTime);
        if (timeDiff < 0) return true;
        if (timeDiff === 0 && cursorId && r.id.localeCompare(cursorId) < 0) return true;
        return false;
      });
    }

    const limit = opts?.limit ?? 50;
    const items = filtered.slice(0, limit).map((r) => ({
      ...r,
      phases: this.store.phaseList.filter((ph) => ph.runId === r.id),
    }));

    const lastItem = items[items.length - 1];
    const nextCursor =
      items.length === limit && lastItem && filtered.length > limit
        ? `${lastItem.createdAt}_${lastItem.id}`
        : null;

    return { items, total, nextCursor };
  }

  async update(id: string, patch: Partial<Omit<Run, "id" | "projectId">>): Promise<Run> {
    const index = this.store.runList.findIndex((r) => r.id === id);
    if (index === -1) {
      throw new Error(`Run with id ${id} not found`);
    }
    const current = this.store.runList[index]!;
    const updated = RunContract.parse({
      ...current,
      ...patch,
      id: current.id,
      projectId: current.projectId,
    });
    this.store.runList[index] = updated;
    const phases = this.store.phaseList.filter((ph) => ph.runId === updated.id);
    return { ...updated, phases };
  }

  async latestSucceeded(projectId: string): Promise<Run | null> {
    const succeeded = this.store.runList
      .filter((r) => r.projectId === projectId && r.status === "succeeded")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return succeeded[0] ?? null;
  }

  async upsertPhase(phase: RunPhase): Promise<void> {
    const idx = this.store.phaseList.findIndex(
      (p) => p.runId === phase.runId && p.name === phase.name,
    );
    if (idx >= 0) {
      this.store.phaseList[idx] = phase;
    } else {
      this.store.phaseList.push(phase);
    }
  }

  async upsertSlice(slice: Slice): Promise<void> {
    const idx = this.store.sliceList.findIndex((s) => s.id === slice.id);
    if (idx >= 0) {
      this.store.sliceList[idx] = slice;
    } else {
      this.store.sliceList.push(slice);
    }
  }

  async listSlices(runId: string): Promise<Slice[]> {
    return this.store.sliceList
      .filter((s) => s.runId === runId)
      .sort((a, b) => a.label.localeCompare(b.label));
  }
}

class MemoryFindingRepo implements FindingRepo {
  constructor(private readonly store: MemoryStore) {}

  async upsert(incoming: Finding): Promise<UpsertResult> {
    const validated = FindingContract.parse(incoming);
    const now = new Date();

    let existingIdx = this.store.findingList.findIndex(
      (f) => f.projectId === validated.projectId && f.fingerprint === validated.fingerprint,
    );

    if (existingIdx === -1) {
      const sfp = secondaryFingerprint(validated);
      existingIdx = this.store.findingList.findIndex(
        (f) => f.projectId === validated.projectId && secondaryFingerprint(f) === sfp,
      );
    }

    const existingFindings = existingIdx >= 0 ? [this.store.findingList[existingIdx]!] : [];
    const outcomes = mergeFindings(existingFindings, [validated], now);
    const outcome = outcomes[0];
    if (!outcome) {
      throw new Error("mergeFindings returned no outcome");
    }

    if (outcome.isNew) {
      this.store.findingList.push(outcome.finding);
    } else if (existingIdx >= 0) {
      this.store.findingList[existingIdx] = outcome.finding;
    }

    return {
      finding: outcome.finding,
      isNew: outcome.isNew,
    };
  }

  async get(id: string, scope: AccessScope): Promise<Finding | null> {
    const finding = this.store.findingList.find((f) => f.id === id);
    if (!finding) return null;
    const project = this.store.projectList.find((p) => p.id === finding.projectId);
    if (!project || !matchesScope(project.clientId, scope)) return null;
    return finding;
  }

  async getByFingerprint(projectId: string, fingerprint: string): Promise<Finding | null> {
    return (
      this.store.findingList.find(
        (f) => f.projectId === projectId && f.fingerprint === fingerprint,
      ) ?? null
    );
  }

  async query(q: FindingQuery, scope: AccessScope): Promise<Page<Finding>> {
    const limit = typeof q.limit === "number" ? q.limit : 50;

    let items = this.store.findingList.filter((f) => {
      const project = this.store.projectList.find((p) => p.id === f.projectId);
      if (!project || !matchesScope(project.clientId, scope)) return false;

      if (q.projectId && f.projectId !== q.projectId) return false;

      if (q.verdict && q.verdict.length > 0) {
        if (!q.verdict.includes(f.verdict)) return false;
      } else if (!q.includeRejected) {
        if (f.verdict === "rejected") return false;
      }

      if (q.status && q.status.length > 0) {
        if (!q.status.includes(f.status)) return false;
      }

      if (q.minSeverity) {
        if (!f.verifiedSeverity) return false;
        if (!severityAtLeast(f.verifiedSeverity, q.minSeverity)) return false;
      }

      if (q.attackClass && q.attackClass.length > 0) {
        if (!q.attackClass.includes(f.attackClass)) return false;
      }

      if (q.q) {
        const queryLower = q.q.toLowerCase();
        const inTitle = f.title.toLowerCase().includes(queryLower);
        const inDesc = f.description.toLowerCase().includes(queryLower);
        const inCause = f.rootCause ? f.rootCause.toLowerCase().includes(queryLower) : false;
        if (!inTitle && !inDesc && !inCause) return false;
      }

      return true;
    });

    items.sort((a, b) => {
      const timeCmp = b.lastSeen.localeCompare(a.lastSeen);
      if (timeCmp !== 0) return timeCmp;
      return b.id.localeCompare(a.id);
    });

    const total = items.length;

    if (q.cursor) {
      const [cursorTime, cursorId] = q.cursor.includes("_") ? q.cursor.split("_") : [q.cursor, ""];
      items = items.filter((f) => {
        if (!cursorTime) return true;
        const timeDiff = f.lastSeen.localeCompare(cursorTime);
        if (timeDiff < 0) return true;
        if (timeDiff === 0 && cursorId && f.id.localeCompare(cursorId) < 0) return true;
        return false;
      });
    }

    const paged = items.slice(0, limit);
    const lastItem = paged[paged.length - 1];
    const nextCursor =
      paged.length === limit && lastItem && items.length > limit
        ? `${lastItem.lastSeen}_${lastItem.id}`
        : null;

    return { items: paged, total, nextCursor };
  }

  async listOpen(projectId: string): Promise<Finding[]> {
    return this.store.findingList
      .filter(
        (f) =>
          f.projectId === projectId &&
          (f.status === "new" || f.status === "confirmed" || f.status === "in_progress"),
      )
      .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  }

  async setStatus(id: string, event: TriageEvent, owner?: string | null): Promise<Finding> {
    const index = this.store.findingList.findIndex((f) => f.id === id);
    if (index === -1) {
      throw new Error(`Finding with id ${id} not found`);
    }
    const current = this.store.findingList[index]!;
    const updated = FindingContract.parse({
      ...current,
      status: event.to,
      owner: owner !== undefined ? owner : current.owner,
    });
    this.store.findingList[index] = updated;

    let history = this.store.triageHistory.get(id);
    if (!history) {
      history = [];
      this.store.triageHistory.set(id, history);
    }
    history.push(event);

    return updated;
  }

  async history(findingId: string): Promise<TriageEvent[]> {
    return this.store.triageHistory.get(findingId) ?? [];
  }
}

class MemoryPolicyRepo implements PolicyRepo {
  constructor(private readonly store: MemoryStore) {}

  async get(id: string): Promise<Policy | null> {
    return this.store.policyList.find((p) => p.id === id) ?? null;
  }

  async upsert(p: Policy): Promise<Policy> {
    const idx = this.store.policyList.findIndex((item) => item.id === p.id);
    if (idx >= 0) {
      this.store.policyList[idx] = p;
    } else {
      this.store.policyList.push(p);
    }
    return p;
  }

  async listExceptions(projectId: string): Promise<Exception[]> {
    return this.store.exceptionList.filter((e) => e.projectId === projectId);
  }

  async addException(e: Exception): Promise<Exception> {
    this.store.exceptionList.push(e);
    return e;
  }
}

class MemoryEventRepo implements EventRepo {
  constructor(private readonly store: MemoryStore) {}

  async append(e: PlatformEvent): Promise<void> {
    this.store.eventList.push(e);
  }

  async listByRun(runId: string, afterSeq?: number): Promise<PlatformEvent[]> {
    return this.store.eventList
      .filter((e) => e.runId === runId && (afterSeq === undefined || e.seq > afterSeq))
      .sort((a, b) => a.seq - b.seq);
  }
}

class MemoryDecisionRepo implements DecisionRepo {
  constructor(private readonly store: MemoryStore) {}

  async record(o: DecisionOutcome): Promise<void> {
    this.store.decisionList.push(o);
  }
}
