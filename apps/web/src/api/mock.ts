import {
  evaluateGate,
  canTransition,
  isOpenStatus,
  type Finding,
  type Project,
  type Run,
  type Slice,
  type Policy,
  type Exception,
  type TriageEvent,
  type PlatformEvent,
  type FindingQuery,
  type TriageRequest,
} from "@sdap/core";
import {
  FIXTURE_PROJECTS,
  FIXTURE_POLICIES,
  FIXTURE_EXCEPTIONS,
  FIXTURE_RUNS,
  FIXTURE_SLICES,
  FIXTURE_FINDINGS,
  FIXTURE_TRIAGE_HISTORY,
  FIXTURE_EVENTS,
} from "./fixtures.js";
import type { CoverageSummary, OrgOverviewMetrics } from "./types.js";

export class MockDataStore {
  projects: Project[] = [];
  policies: Policy[] = [];
  exceptions: Exception[] = [];
  runs: Run[] = [];
  slices: Slice[] = [];
  findings: Finding[] = [];
  triageHistory: Record<string, TriageEvent[]> = {};
  events: PlatformEvent[] = [];
  eventListeners: Map<string, Set<(ev: PlatformEvent) => void>> = new Map();

  constructor() {
    this.reset();
  }

  reset() {
    this.projects = JSON.parse(JSON.stringify(FIXTURE_PROJECTS));
    this.policies = JSON.parse(JSON.stringify(FIXTURE_POLICIES));
    this.exceptions = JSON.parse(JSON.stringify(FIXTURE_EXCEPTIONS));
    this.runs = JSON.parse(JSON.stringify(FIXTURE_RUNS));
    this.slices = JSON.parse(JSON.stringify(FIXTURE_SLICES));
    this.findings = JSON.parse(JSON.stringify(FIXTURE_FINDINGS));
    this.triageHistory = JSON.parse(JSON.stringify(FIXTURE_TRIAGE_HISTORY));
    this.events = JSON.parse(JSON.stringify(FIXTURE_EVENTS));
  }

  getProjects(): Project[] {
    return this.projects;
  }

  getProject(id: string): Project | undefined {
    return this.projects.find((p) => p.id === id || p.slug === id);
  }

  createProject(data: Partial<Project>): Project {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const newProj: Project = {
      id,
      slug: data.slug || `proj-${Date.now()}`,
      name: data.name || "Untitled Project",
      repoUrl: data.repoUrl || "https://git.internal.example.org/project.git",
      defaultBranch: data.defaultBranch || "main",
      team: data.team || "default-team",
      clientId: data.clientId || "default-client",
      policyId: data.policyId || this.policies[0]?.id || null,
      webhookSecretRef: null,
      modelRouting: data.modelRouting || [],
      escalation: data.escalation || null,
      criticalPaths: data.criticalPaths || [],
      monthlyTokenBudget: data.monthlyTokenBudget || 1000000,
      createdAt: now,
      updatedAt: now,
    };
    this.projects.push(newProj);
    return newProj;
  }

  getRuns(projectId?: string): Run[] {
    if (projectId) {
      return this.runs.filter((r) => r.projectId === projectId);
    }
    return this.runs;
  }

  getRun(id: string): Run | undefined {
    return this.runs.find((r) => r.id === id);
  }

  createRun(data: {
    projectId: string;
    mode?: "focused" | "incremental" | "full";
    ref?: string;
  }): Run {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const newRun: Run = {
      id,
      projectId: data.projectId,
      mode: data.mode || "focused",
      repeat: 1,
      trigger: {
        kind: "manual",
        actor: "dashboard-user@acme-corp.example",
        ref: "web-dashboard",
      },
      ref: data.ref || "main",
      commitSha: "e9f0a1b2c3d4e5f60718293a4b5c6d7e8f901234",
      baseCommitSha: null,
      previousRunId: null,
      scope: {
        paths: [],
        attackClasses: [],
        maxRuntimeSec: 7200,
        tokenBudget: 1000000,
      },
      status: "queued",
      phases: [
        {
          runId: id,
          name: "preflight",
          status: "pending",
          startedAt: null,
          endedAt: null,
          sliceCount: 1,
          slicesDone: 0,
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        },
        {
          runId: id,
          name: "recon",
          status: "pending",
          startedAt: null,
          endedAt: null,
          sliceCount: 2,
          slicesDone: 0,
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        },
        {
          runId: id,
          name: "hunt",
          status: "pending",
          startedAt: null,
          endedAt: null,
          sliceCount: 3,
          slicesDone: 0,
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        },
        {
          runId: id,
          name: "validate",
          status: "pending",
          startedAt: null,
          endedAt: null,
          sliceCount: 2,
          slicesDone: 0,
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        },
        {
          runId: id,
          name: "report",
          status: "pending",
          startedAt: null,
          endedAt: null,
          sliceCount: 1,
          slicesDone: 0,
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        },
      ],
      validators: { findings: "pending", coverageLedger: "pending" },
      skillVersion: "1.4.2-rev8219ef",
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      artifacts: {
        findingsJson: null,
        coverageLedgerJson: null,
        architectureMd: null,
        reportMd: null,
        findingsDetailMd: null,
        needsValidationMd: null,
      },
      failureReason: null,
      retries: 0,
      createdAt: now,
      startedAt: null,
      endedAt: null,
    };
    this.runs.unshift(newRun);

    // Emit run.queued event
    const ev: PlatformEvent = {
      id: crypto.randomUUID(),
      runId: id,
      projectId: data.projectId,
      seq: 1,
      at: now,
      type: "run.queued",
      payload: {},
    };
    this.events.push(ev);
    this.notifyRunEvent(id, ev);

    return newRun;
  }

  cancelRun(id: string): boolean {
    const run = this.getRun(id);
    if (!run) return false;
    run.status = "cancelled";
    const ev: PlatformEvent = {
      id: crypto.randomUUID(),
      runId: id,
      projectId: run.projectId,
      seq: this.events.filter((e) => e.runId === id).length + 1,
      at: new Date().toISOString(),
      type: "run.cancelled",
      payload: { by: "web-dashboard-user" },
    };
    this.events.push(ev);
    this.notifyRunEvent(id, ev);
    return true;
  }

  getRunSlices(runId: string): Slice[] {
    return this.slices.filter((s) => s.runId === runId);
  }

  getRunEvents(runId: string): PlatformEvent[] {
    return this.events.filter((e) => e.runId === runId).sort((a, b) => a.seq - b.seq);
  }

  subscribeRunEvents(runId: string, cb: (ev: PlatformEvent) => void): () => void {
    if (!this.eventListeners.has(runId)) {
      this.eventListeners.set(runId, new Set());
    }
    this.eventListeners.get(runId)!.add(cb);
    return () => {
      this.eventListeners.get(runId)?.delete(cb);
    };
  }

  notifyRunEvent(runId: string, ev: PlatformEvent) {
    const listeners = this.eventListeners.get(runId);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(ev);
        } catch {
          // ignore callback failures
        }
      }
    }
  }

  getFindings(query?: FindingQuery): {
    items: Finding[];
    total: number;
    nextCursor: string | null;
  } {
    let result = [...this.findings];

    // Filter rejected findings by default unless includeRejected is true
    if (!query?.includeRejected) {
      result = result.filter((f) => f.verdict !== "rejected");
    }

    if (query?.projectId) {
      result = result.filter((f) => f.projectId === query.projectId);
    }

    if (query?.verdict && query.verdict.length > 0) {
      result = result.filter((f) => query.verdict!.includes(f.verdict));
    }

    if (query?.status && query.status.length > 0) {
      result = result.filter((f) => query.status!.includes(f.status));
    }

    if (query?.attackClass && query.attackClass.length > 0) {
      result = result.filter((f) => query.attackClass!.includes(f.attackClass));
    }

    if (query?.q) {
      const q = query.q.toLowerCase();
      result = result.filter(
        (f) =>
          f.title.toLowerCase().includes(q) ||
          f.description.toLowerCase().includes(q) ||
          f.location.file.toLowerCase().includes(q) ||
          f.fingerprint.toLowerCase().includes(q),
      );
    }

    const limit = typeof query?.limit === "number" ? query.limit : 50;
    const items = result.slice(0, limit);
    return {
      items,
      total: result.length,
      nextCursor: null,
    };
  }

  getFinding(id: string): Finding | undefined {
    return this.findings.find((f) => f.id === id);
  }

  getFindingHistory(id: string): TriageEvent[] {
    return this.triageHistory[id] || [];
  }

  triageFinding(id: string, req: TriageRequest): { finding: Finding; event: TriageEvent } {
    const finding = this.getFinding(id);
    if (!finding) {
      throw new Error(`Finding ${id} not found`);
    }

    if (!canTransition(finding.status, req.to)) {
      throw new Error(`Invalid transition from ${finding.status} to ${req.to}`);
    }

    if (req.to === "accepted_risk" && !req.expiresAt) {
      throw new Error("accepted_risk requires expiresAt");
    }

    if (req.to === "false_positive" && !req.reason) {
      throw new Error("false_positive requires a reason");
    }

    const prevStatus = finding.status;
    finding.status = req.to;
    if (req.owner !== undefined) {
      finding.owner = req.owner;
    }

    const now = new Date().toISOString();
    const eventId = crypto.randomUUID();
    const event: TriageEvent = {
      id: eventId,
      findingId: id,
      from: prevStatus,
      to: req.to,
      actor: { subject: "current-user@acme-corp.example", role: "security" },
      reason: req.reason ?? null,
      at: now,
    };

    if (!this.triageHistory[id]) {
      this.triageHistory[id] = [];
    }
    this.triageHistory[id].push(event);

    if (req.to === "accepted_risk") {
      const excId = crypto.randomUUID();
      const newExc: Exception = {
        id: excId,
        projectId: finding.projectId,
        fingerprint: finding.fingerprint,
        kind: "accepted_risk",
        reason: req.reason || "Accepted risk via triage dashboard",
        approver: "current-user@acme-corp.example",
        expiresAt: req.expiresAt ?? null,
        createdAt: now,
      };
      this.exceptions.push(newExc);
    } else if (req.to === "false_positive") {
      const excId = crypto.randomUUID();
      const newExc: Exception = {
        id: excId,
        projectId: finding.projectId,
        fingerprint: finding.fingerprint,
        kind: "false_positive",
        reason: req.reason || "Marked false positive via triage dashboard",
        approver: "current-user@acme-corp.example",
        expiresAt: null,
        createdAt: now,
      };
      this.exceptions.push(newExc);
    }

    return { finding, event };
  }

  getReviewQueue(): Finding[] {
    return this.findings.filter((f) => f.verdict === "needs_validation" && isOpenStatus(f.status));
  }

  getPolicy(id: string): Policy | undefined {
    return this.policies.find((p) => p.id === id);
  }

  getExceptions(projectId?: string): Exception[] {
    if (projectId) {
      return this.exceptions.filter((e) => e.projectId === projectId);
    }
    return this.exceptions;
  }

  getGateResult(projectId: string): ReturnType<typeof evaluateGate> {
    const project = this.getProject(projectId);
    const policy = this.policies.find((p) => p.id === project?.policyId) ||
      this.policies[0] || { mode: "enforce" as const, rules: [] };
    const projectFindings = this.findings.filter((f) => f.projectId === projectId);
    const projectExceptions = this.exceptions.filter((e) => e.projectId === projectId);
    return evaluateGate(policy, projectFindings, projectExceptions);
  }

  getCoverageSummary(projectId: string): CoverageSummary {
    const isGateway = projectId === FIXTURE_PROJECTS[0]?.id;
    return {
      projectId,
      totalUnits: isGateway ? 24 : 18,
      auditedUnits: isGateway ? 22 : 14,
      coveragePct: isGateway ? 91.6 : 77.8,
      lastAuditedAt: isGateway ? "2026-11-06T10:25:30Z" : "2026-11-05T02:50:00Z",
      uncoveredPaths: isGateway
        ? ["src/auth/legacy-sso.ts", "src/auth/deprecated-certs.ts"]
        : ["services/ledger/offline-batch.ts", "services/ledger/archiver.ts"],
    };
  }

  getOrgOverview(): OrgOverviewMetrics {
    const openFindings = this.findings.filter((f) => isOpenStatus(f.status));
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

    for (const f of openFindings) {
      if (f.verifiedSeverity) {
        openBySeverity[f.verifiedSeverity] = (openBySeverity[f.verifiedSeverity] || 0) + 1;
      }
      openByVerdict[f.verdict] = (openByVerdict[f.verdict] || 0) + 1;
    }

    const now = new Date();
    const slaBreachesCount = openFindings.filter(
      (f) => f.slaDue && new Date(f.slaDue).getTime() < now.getTime(),
    ).length;

    // Cross project attack classes
    const acMap = new Map<string, { count: number; byProject: Record<string, number> }>();
    for (const f of openFindings) {
      const entry = acMap.get(f.attackClass) || { count: 0, byProject: {} };
      entry.count += 1;
      entry.byProject[f.projectId] = (entry.byProject[f.projectId] || 0) + 1;
      acMap.set(f.attackClass, entry);
    }
    const crossProjectAttackClasses = Array.from(acMap.entries()).map(([attackClass, val]) => ({
      attackClass,
      count: val.count,
      byProject: val.byProject,
    }));

    return {
      totalOpenFindings: openFindings.length,
      openBySeverity,
      openByVerdict,
      slaBreachesCount,
      meanTimeToRemediateDays: 4.8,
      crossProjectAttackClasses,
      trend: [
        { date: "2026-10-10", openFindings: 8, resolvedFindings: 1 },
        { date: "2026-10-17", openFindings: 6, resolvedFindings: 3 },
        { date: "2026-10-24", openFindings: 9, resolvedFindings: 5 },
        { date: "2026-10-31", openFindings: 7, resolvedFindings: 8 },
        { date: "2026-11-07", openFindings: openFindings.length, resolvedFindings: 11 },
      ],
    };
  }
}

export const mockStore = new MockDataStore();

/**
 * Installs a fetch shim that intercepts `/api/v1` requests and routes them to the MockDataStore.
 */
export function installFetchShim(store: MockDataStore = mockStore): () => void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlString =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(urlString, "http://localhost:8080");

    if (!url.pathname.startsWith("/api/v1/")) {
      if (originalFetch) {
        return originalFetch(input, init);
      }
      return new Response("Not Found", { status: 404 });
    }

    const method = (init?.method || "GET").toUpperCase();
    const pathname = url.pathname.replace("/api/v1", "");

    try {
      // GET /projects
      if (pathname === "/projects" && method === "GET") {
        return new Response(JSON.stringify(store.getProjects()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // POST /projects
      if (pathname === "/projects" && method === "POST") {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        const project = store.createProject(body);
        return new Response(JSON.stringify(project), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }

      // GET /projects/:id
      const projectMatch = pathname.match(/^\/projects\/([^/]+)$/);
      if (projectMatch && projectMatch[1] && method === "GET") {
        const id = projectMatch[1];
        const proj = store.getProject(id);
        if (!proj)
          return new Response(JSON.stringify({ error: "Project not found" }), { status: 404 });
        return new Response(JSON.stringify(proj), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // GET /projects/:id/runs
      const projectRunsMatch = pathname.match(/^\/projects\/([^/]+)\/runs$/);
      if (projectRunsMatch && projectRunsMatch[1] && method === "GET") {
        const projectId = projectRunsMatch[1];
        const runs = store.getRuns(projectId);
        return new Response(JSON.stringify({ items: runs, total: runs.length, nextCursor: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // GET /projects/:id/gate
      const projectGateMatch = pathname.match(/^\/projects\/([^/]+)\/gate$/);
      if (projectGateMatch && projectGateMatch[1] && method === "GET") {
        const projectId = projectGateMatch[1];
        const gate = store.getGateResult(projectId);
        return new Response(JSON.stringify(gate), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // GET /projects/:id/coverage
      const projectCovMatch = pathname.match(/^\/projects\/([^/]+)\/coverage$/);
      if (projectCovMatch && projectCovMatch[1] && method === "GET") {
        const projectId = projectCovMatch[1];
        const cov = store.getCoverageSummary(projectId);
        return new Response(JSON.stringify(cov), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // GET /runs
      if (pathname === "/runs" && method === "GET") {
        const runs = store.getRuns();
        return new Response(JSON.stringify({ items: runs, total: runs.length, nextCursor: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // POST /runs
      if (pathname === "/runs" && method === "POST") {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        const run = store.createRun(body);
        return new Response(JSON.stringify(run), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }

      // GET /runs/:id
      const runMatch = pathname.match(/^\/runs\/([^/]+)$/);
      if (runMatch && runMatch[1] && method === "GET") {
        const id = runMatch[1];
        const run = store.getRun(id);
        if (!run) return new Response(JSON.stringify({ error: "Run not found" }), { status: 404 });
        return new Response(JSON.stringify(run), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // POST /runs/:id/cancel
      const runCancelMatch = pathname.match(/^\/runs\/([^/]+)\/cancel$/);
      if (runCancelMatch && runCancelMatch[1] && method === "POST") {
        const id = runCancelMatch[1];
        const ok = store.cancelRun(id);
        return new Response(JSON.stringify({ success: ok }), {
          status: ok ? 200 : 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // GET /runs/:id/slices
      const runSlicesMatch = pathname.match(/^\/runs\/([^/]+)\/slices$/);
      if (runSlicesMatch && runSlicesMatch[1] && method === "GET") {
        const id = runSlicesMatch[1];
        const slices = store.getRunSlices(id);
        return new Response(JSON.stringify(slices), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // GET /runs/:id/events
      const runEventsMatch = pathname.match(/^\/runs\/([^/]+)\/events$/);
      if (runEventsMatch && runEventsMatch[1] && method === "GET") {
        const id = runEventsMatch[1];
        const events = store.getRunEvents(id);
        return new Response(JSON.stringify(events), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // GET /findings
      if (pathname === "/findings" && method === "GET") {
        const includeRejected = url.searchParams.get("includeRejected") === "true";
        const projectId = url.searchParams.get("projectId") || undefined;
        const q = url.searchParams.get("q") || undefined;
        const limitStr = url.searchParams.get("limit");
        const limit = limitStr ? parseInt(limitStr, 10) : undefined;
        const result = store.getFindings({ includeRejected, projectId, q, limit });
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // GET /findings/:id
      const findingMatch = pathname.match(/^\/findings\/([^/]+)$/);
      if (findingMatch && findingMatch[1] && method === "GET") {
        const id = findingMatch[1];
        const f = store.getFinding(id);
        if (!f)
          return new Response(JSON.stringify({ error: "Finding not found" }), { status: 404 });
        return new Response(JSON.stringify(f), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // GET /findings/:id/history
      const findingHistoryMatch = pathname.match(/^\/findings\/([^/]+)\/history$/);
      if (findingHistoryMatch && findingHistoryMatch[1] && method === "GET") {
        const id = findingHistoryMatch[1];
        const history = store.getFindingHistory(id);
        return new Response(JSON.stringify(history), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // POST /findings/:id/triage
      const findingTriageMatch = pathname.match(/^\/findings\/([^/]+)\/triage$/);
      if (findingTriageMatch && findingTriageMatch[1] && method === "POST") {
        const id = findingTriageMatch[1];
        const body = init?.body ? JSON.parse(init.body as string) : {};
        const { finding } = store.triageFinding(id, body);
        return new Response(JSON.stringify(finding), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // GET /review-queue
      if (pathname === "/review-queue" && method === "GET") {
        const queue = store.getReviewQueue();
        return new Response(JSON.stringify(queue), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // GET /policies/:id
      const policyMatch = pathname.match(/^\/policies\/([^/]+)$/);
      if (policyMatch && policyMatch[1] && method === "GET") {
        const id = policyMatch[1];
        const p = store.getPolicy(id);
        if (!p) return new Response(JSON.stringify({ error: "Policy not found" }), { status: 404 });
        return new Response(JSON.stringify(p), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // GET /exceptions
      if (pathname === "/exceptions" && method === "GET") {
        const projectId = url.searchParams.get("projectId") || undefined;
        const exceptions = store.getExceptions(projectId);
        return new Response(JSON.stringify(exceptions), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // GET /overview
      if (pathname === "/overview" && method === "GET") {
        const metrics = store.getOrgOverview();
        return new Response(JSON.stringify(metrics), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // GET /healthz
      if (pathname === "/healthz") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "Endpoint not found", path: pathname }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: "Bad Request", message }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}
