import { spawn } from "node:child_process";
import {
  type AccessScope,
  type DecisionOutcome,
  type DecisionRepo,
  type EventRepo,
  type Exception,
  type Finding,
  type FindingQuery,
  type FindingRepo,
  isOpenStatus,
  type Page,
  type PlatformEvent,
  type Policy,
  type PolicyRepo,
  type Project,
  type ProjectRepo,
  type Run,
  type RunPhase,
  type RunRepo,
  type SandboxExecRequest,
  type SandboxExecResult,
  type SandboxRunner,
  type Slice,
  type Store,
  type TriageEvent,
  type UpsertResult,
} from "@sdap/core";

export class FakeSandboxRunner implements SandboxRunner {
  readonly kind = "local-fake";
  readonly enforcing = false;
  private preflightOk = true;
  private preflightMessage: string | null = null;

  setPreflightStatus(ok: boolean, message: string | null = null): void {
    this.preflightOk = ok;
    this.preflightMessage = message;
  }

  async preflight(): Promise<{ ok: boolean; message: string | null }> {
    return {
      ok: this.preflightOk,
      message: this.preflightMessage,
    };
  }

  async exec(req: SandboxExecRequest): Promise<SandboxExecResult> {
    const start = Date.now();
    const [command, ...args] = req.argv;

    if (!command) {
      return {
        exitCode: 1,
        killedBy: null,
        stdout: "",
        stderr: "No command provided",
        durationMs: 0,
      };
    }

    return new Promise<SandboxExecResult>((resolve) => {
      let killedBy: "timeout" | "abort" | "oom" | null = null;
      let timedOut = false;
      const timeoutMs = req.policy.timeoutSec ? req.policy.timeoutSec * 1000 : 30000;

      const child = spawn(command, args, {
        cwd: req.cwd || req.policy.targetDir,
        env: {
          ...process.env,
          ...req.policy.env,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        killedBy = "timeout";
        child.kill("SIGKILL");
      }, timeoutMs);

      if (req.signal) {
        req.signal.addEventListener("abort", () => {
          killedBy = "abort";
          child.kill("SIGTERM");
        });
      }

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stdout += text;
        req.onStdout?.(text);
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stderr += text;
        req.onStderr?.(text);
      });

      if (req.stdin && child.stdin) {
        child.stdin.write(req.stdin);
        child.stdin.end();
      }

      child.on("close", (exitCode) => {
        clearTimeout(timer);
        resolve({
          exitCode: timedOut ? null : exitCode,
          killedBy,
          stdout,
          stderr,
          durationMs: Date.now() - start,
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          exitCode: 1,
          killedBy: null,
          stdout,
          stderr: `${stderr}\n${err.message}`,
          durationMs: Date.now() - start,
        });
      });
    });
  }
}

export class FakeStore implements Store {
  readonly projectsMap = new Map<string, Project>();
  readonly runsMap = new Map<string, Run>();
  readonly slicesMap = new Map<string, Slice>(); // key: `${runId}:${sliceId}`
  readonly phasesMap = new Map<string, RunPhase>(); // key: `${runId}:${phaseName}`
  readonly findingsMap = new Map<string, Finding>(); // key: `${projectId}:${fingerprint}`
  readonly exceptionsMap = new Map<string, Exception[]>(); // key: projectId
  readonly policiesMap = new Map<string, Policy>();
  readonly eventsList: PlatformEvent[] = [];
  readonly decisionsList: DecisionOutcome[] = [];

  readonly projects: ProjectRepo = {
    create: async (p: Project) => {
      this.projectsMap.set(p.id, p);
      return p;
    },
    get: async (id: string, _scope: AccessScope) => this.projectsMap.get(id) ?? null,
    list: async (_scope: AccessScope) => Array.from(this.projectsMap.values()),
    update: async (id: string, patch: Partial<Omit<Project, "id" | "createdAt">>) => {
      const existing = this.projectsMap.get(id);
      if (!existing) throw new Error(`Project not found: ${id}`);
      const updated = { ...existing, ...patch };
      this.projectsMap.set(id, updated);
      return updated;
    },
  };

  readonly runs: RunRepo = {
    create: async (run: Run) => {
      this.runsMap.set(run.id, run);
      return run;
    },
    get: async (id: string, _scope: AccessScope) => this.runsMap.get(id) ?? null,
    list: async (projectId: string, _scope: AccessScope, opts) => {
      const items = Array.from(this.runsMap.values()).filter((r) => r.projectId === projectId);
      const limit = opts?.limit ?? 50;
      return {
        items: items.slice(0, limit),
        total: items.length,
        nextCursor: null,
      };
    },
    update: async (id: string, patch: Partial<Omit<Run, "id" | "projectId">>) => {
      const existing = this.runsMap.get(id);
      if (!existing) throw new Error(`Run not found: ${id}`);
      const updated = { ...existing, ...patch };
      this.runsMap.set(id, updated);
      return updated;
    },
    latestSucceeded: async (projectId: string) => {
      const runs = Array.from(this.runsMap.values())
        .filter((r) => r.projectId === projectId && r.status === "succeeded")
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return runs[0] ?? null;
    },
    upsertPhase: async (phase: RunPhase) => {
      this.phasesMap.set(`${phase.runId}:${phase.name}`, phase);
    },
    upsertSlice: async (slice: Slice) => {
      this.slicesMap.set(`${slice.runId}:${slice.id}`, slice);
    },
    listSlices: async (runId: string) => {
      return Array.from(this.slicesMap.values()).filter((s) => s.runId === runId);
    },
  };

  readonly findings: FindingRepo = {
    upsert: async (f: Finding): Promise<UpsertResult> => {
      const key = `${f.projectId}:${f.fingerprint}`;
      const existing = this.findingsMap.get(key);
      if (existing) {
        const merged: Finding = {
          ...f,
          id: existing.id,
          firstSeen: existing.firstSeen,
          firstRun: existing.firstRun,
          status: existing.status,
          owner: existing.owner,
        };
        this.findingsMap.set(key, merged);
        return { finding: merged, isNew: false };
      }
      this.findingsMap.set(key, f);
      return { finding: f, isNew: true };
    },
    get: async (id: string, _scope: AccessScope) => {
      for (const finding of this.findingsMap.values()) {
        if (finding.id === id) return finding;
      }
      return null;
    },
    getByFingerprint: async (projectId: string, fingerprint: string) => {
      return this.findingsMap.get(`${projectId}:${fingerprint}`) ?? null;
    },
    query: async (q: FindingQuery, _scope: AccessScope): Promise<Page<Finding>> => {
      let items = Array.from(this.findingsMap.values());
      if (q.projectId) {
        items = items.filter((f) => f.projectId === q.projectId);
      }
      if (q.verdict && q.verdict.length > 0) {
        items = items.filter((f) => q.verdict!.includes(f.verdict));
      }
      if (q.status && q.status.length > 0) {
        items = items.filter((f) => q.status!.includes(f.status));
      }
      return { items, total: items.length, nextCursor: null };
    },
    listOpen: async (projectId: string) => {
      return Array.from(this.findingsMap.values()).filter(
        (f) => f.projectId === projectId && isOpenStatus(f.status),
      );
    },
    setStatus: async (id: string, event: TriageEvent, owner?: string | null) => {
      for (const [key, finding] of this.findingsMap.entries()) {
        if (finding.id === id) {
          const updated: Finding = {
            ...finding,
            status: event.to,
            owner: owner !== undefined ? owner : finding.owner,
          };
          this.findingsMap.set(key, updated);
          return updated;
        }
      }
      throw new Error(`Finding not found: ${id}`);
    },
    history: async (_findingId: string) => [],
  };

  readonly policies: PolicyRepo = {
    get: async (id: string) => this.policiesMap.get(id) ?? null,
    upsert: async (p: Policy) => {
      this.policiesMap.set(p.id, p);
      return p;
    },
    listExceptions: async (projectId: string) => this.exceptionsMap.get(projectId) ?? [],
    addException: async (e: Exception) => {
      const list = this.exceptionsMap.get(e.projectId) ?? [];
      list.push(e);
      this.exceptionsMap.set(e.projectId, list);
      return e;
    },
  };

  readonly events: EventRepo = {
    append: async (e: PlatformEvent) => {
      this.eventsList.push(e);
    },
    listByRun: async (runId: string, afterSeq?: number) => {
      return this.eventsList.filter(
        (e) => e.runId === runId && (afterSeq === undefined || e.seq > afterSeq),
      );
    },
  };

  readonly decisions: DecisionRepo = {
    record: async (o: DecisionOutcome) => {
      this.decisionsList.push(o);
    },
  };

  async tx<T>(fn: (s: Store) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async close(): Promise<void> {}
}
