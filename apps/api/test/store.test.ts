import {
  DEFAULT_SLA_DAYS,
  Finding,
  type PlatformEvent,
  type Policy,
  type Project,
  type Run,
  type Store,
  type TriageEvent,
} from "@sdap/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgStore } from "../src/db/index.js";

const DATABASE_URL = process.env["DATABASE_URL"];

if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.info("DATABASE_URL not set; skipping PostgreSQL store tests.");
}

describe("PostgreSQL Store tests", () => {
  it("skips cleanly when DATABASE_URL is unset", () => {
    if (!DATABASE_URL) {
      expect(DATABASE_URL).toBeUndefined();
    }
  });

  describe.skipIf(!DATABASE_URL)("PostgreSQL Store integration", () => {
    let store: Store;

    const CLIENT_ALPHA = "client-alpha";
    const CLIENT_BETA = "client-beta";

    const PROJECT_A: Project = {
      id: "00000000-0000-4000-8000-0000000000a1",
      slug: "project-alpha",
      name: "Project Alpha",
      repoUrl: "https://github.com/example/alpha",
      defaultBranch: "main",
      team: "team-alpha",
      clientId: CLIENT_ALPHA,
      policyId: null,
      modelRouting: [],
      escalation: null,
      criticalPaths: ["auth/**"],
      monthlyTokenBudget: 500000,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    };

    const PROJECT_B: Project = {
      id: "00000000-0000-4000-8000-0000000000b1",
      slug: "project-beta",
      name: "Project Beta",
      repoUrl: "https://github.com/example/beta",
      defaultBranch: "main",
      team: "team-beta",
      clientId: CLIENT_BETA,
      policyId: null,
      modelRouting: [],
      escalation: null,
      criticalPaths: [],
      monthlyTokenBudget: null,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    };

    const RUN_A: Run = {
      id: "00000000-0000-4000-8000-0000000001a1",
      projectId: PROJECT_A.id,
      mode: "full",
      repeat: 1,
      trigger: { kind: "api", actor: "tester", ref: null },
      ref: "main",
      commitSha: "abcdef1234567890",
      baseCommitSha: null,
      previousRunId: null,
      scope: { paths: [], attackClasses: [], maxRuntimeSec: 3600, tokenBudget: null },
      status: "succeeded",
      phases: [],
      validators: { findings: "passed", coverageLedger: "passed" },
      skillVersion: "v1.0.0-test",
      usage: { inputTokens: 100, outputTokens: 200, costUsd: 0.01 },
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
      createdAt: "2026-11-01T01:00:00.000Z",
      startedAt: "2026-11-01T01:01:00.000Z",
      endedAt: "2026-11-01T01:05:00.000Z",
    };

    const RUN_B: Run = {
      id: "00000000-0000-4000-8000-0000000001b1",
      projectId: PROJECT_B.id,
      mode: "full",
      repeat: 1,
      trigger: { kind: "ci", actor: "github-actions", ref: "PR-42" },
      ref: "feat/login",
      commitSha: "1234567890abcdef",
      baseCommitSha: null,
      previousRunId: null,
      scope: { paths: [], attackClasses: [], maxRuntimeSec: 3600, tokenBudget: null },
      status: "running",
      phases: [],
      validators: { findings: "pending", coverageLedger: "pending" },
      skillVersion: "v1.0.0-test",
      usage: { inputTokens: 50, outputTokens: 50, costUsd: 0.005 },
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
      createdAt: "2026-11-01T02:00:00.000Z",
      startedAt: "2026-11-01T02:01:00.000Z",
      endedAt: null,
    };

    const FINDING_A = Finding.parse({
      id: "00000000-0000-4000-8000-0000000002a1",
      projectId: PROJECT_A.id,
      fingerprint: "fp-alpha-sql-injection-10",
      sourceRun: RUN_A.id,
      firstRun: RUN_A.id,
      attackClass: "injection",
      cwe: null,
      title: "SQL Injection in user search",
      description: "User search query is concatenated directly into SQL statement",
      rootCause: "Unsanitized query string passed to raw sql query",
      location: { file: "src/users/search.ts", line: 10 },
      trace: [
        {
          kind: "entrypoint",
          file: "src/users/routes.ts",
          line: 5,
          scope: "searchHandler",
          description: "Incoming HTTP query",
        },
        {
          kind: "sink",
          file: "src/users/search.ts",
          line: 10,
          scope: "findUsers",
          description: "Raw SQL query executed",
        },
      ],
      evidence: [
        {
          file: "src/users/search.ts",
          line: 10,
          description: "db.query(`SELECT * FROM users WHERE name = '${req.query.q}'`)",
        },
      ],
      verdict: "confirmed",
      originalSeverity: null,
      verifiedSeverity: "critical",
      confidence: "high",
      status: "new",
      owner: null,
      firstSeen: "2026-11-01T01:05:00.000Z",
      lastSeen: "2026-11-01T01:05:00.000Z",
      slaDue: "2026-11-08T01:05:00.000Z",
      model: { adapter: "mock", model: "model-1" },
      phase: "record_verify",
      blockers: [],
      rejectionReason: null,
      remediation: { strategy: "Use parameterized query", codeChanges: [] },
      triageSuggestion: null,
      rootCauseGroup: null,
    });

    const FINDING_B = Finding.parse({
      id: "00000000-0000-4000-8000-0000000002b1",
      projectId: PROJECT_B.id,
      fingerprint: "fp-beta-auth-bypass-20",
      sourceRun: RUN_B.id,
      firstRun: RUN_B.id,
      attackClass: "authn",
      cwe: null,
      title: "Authentication bypass in login route",
      description: "Missing password validation check in edge case",
      rootCause: "Null check returns true before verifying password hash",
      location: { file: "src/auth/login.ts", line: 20 },
      trace: [
        {
          kind: "sink",
          file: "src/auth/login.ts",
          line: 20,
          scope: "loginUser",
          description: "Token generated without checking password",
        },
      ],
      evidence: [
        {
          file: "src/auth/login.ts",
          line: 20,
          description: "if (user) return createToken(user)",
        },
      ],
      verdict: "confirmed",
      originalSeverity: null,
      verifiedSeverity: "high",
      confidence: "high",
      status: "new",
      owner: null,
      firstSeen: "2026-11-01T02:05:00.000Z",
      lastSeen: "2026-11-01T02:05:00.000Z",
      slaDue: "2026-12-01T02:05:00.000Z",
      model: { adapter: "mock", model: "model-1" },
      phase: "record_verify",
      blockers: [],
      rejectionReason: null,
      remediation: { strategy: "Validate password against hash", codeChanges: [] },
      triageSuggestion: null,
      rootCauseGroup: null,
    });

    beforeAll(() => {
      store = createPgStore(DATABASE_URL!);
    });

    afterAll(async () => {
      await store?.close();
    });

    it("isolation test: scope restricts project, run, and finding reads by client_id", async () => {
      // Setup projects
      await store.projects.create(PROJECT_A);
      await store.projects.create(PROJECT_B);

      // Setup runs
      await store.runs.create(RUN_A);
      await store.runs.create(RUN_B);

      // Setup findings
      await store.findings.upsert(FINDING_A);
      await store.findings.upsert(FINDING_B);

      // 1. Project read isolation
      const projAForBeta = await store.projects.get(PROJECT_A.id, { clientIds: [CLIENT_BETA] });
      expect(projAForBeta).toBeNull();

      const projAForAlpha = await store.projects.get(PROJECT_A.id, { clientIds: [CLIENT_ALPHA] });
      expect(projAForAlpha?.id).toBe(PROJECT_A.id);

      const projListBeta = await store.projects.list({ clientIds: [CLIENT_BETA] });
      expect(projListBeta.map((p) => p.id)).not.toContain(PROJECT_A.id);
      expect(projListBeta.map((p) => p.id)).toContain(PROJECT_B.id);

      // 2. Run read isolation
      const runAForBeta = await store.runs.get(RUN_A.id, { clientIds: [CLIENT_BETA] });
      expect(runAForBeta).toBeNull();

      const runAForAlpha = await store.runs.get(RUN_A.id, { clientIds: [CLIENT_ALPHA] });
      expect(runAForAlpha?.id).toBe(RUN_A.id);

      const runListBeta = await store.runs.list(PROJECT_A.id, { clientIds: [CLIENT_BETA] });
      expect(runListBeta.items).toHaveLength(0);

      // 3. Finding read isolation
      const findingAForBeta = await store.findings.get(FINDING_A.id, { clientIds: [CLIENT_BETA] });
      expect(findingAForBeta).toBeNull();

      const findingAForAlpha = await store.findings.get(FINDING_A.id, {
        clientIds: [CLIENT_ALPHA],
      });
      expect(findingAForAlpha?.id).toBe(FINDING_A.id);

      // 4. Query findings isolation
      const queryBeta = await store.findings.query({}, { clientIds: [CLIENT_BETA] });
      expect(queryBeta.items.map((f) => f.id)).not.toContain(FINDING_A.id);
      expect(queryBeta.items.map((f) => f.id)).toContain(FINDING_B.id);

      // 5. Admin wildcard sees all
      const queryAdmin = await store.findings.query({}, { clientIds: "*" });
      const adminIds = queryAdmin.items.map((f) => f.id);
      expect(adminIds).toContain(FINDING_A.id);
      expect(adminIds).toContain(FINDING_B.id);
    });

    it("upsert uses mergeFindings semantics to carry status forward when code moves", async () => {
      // First upsert of finding in Project A
      const initialUpsert = await store.findings.upsert(FINDING_A);
      expect(initialUpsert.isNew).toBe(false); // was inserted during setup

      // Triage finding to in_progress with owner
      const triageEvent: TriageEvent = {
        id: "00000000-0000-4000-8000-0000000003a1",
        findingId: FINDING_A.id,
        from: "new",
        to: "in_progress",
        actor: { subject: "alice@example.com", role: "security" },
        reason: "Fix underway",
        at: "2026-11-01T03:00:00.000Z",
      };
      await store.findings.setStatus(FINDING_A.id, triageEvent, "alice@example.com");

      // In a subsequent run, code moves to line 45. Skill produces a new fingerprint.
      const movedFinding = Finding.parse({
        ...FINDING_A,
        id: "00000000-0000-4000-8000-000000000999",
        fingerprint: "fp-alpha-sql-injection-45",
        location: { file: "src/users/search.ts", line: 45 },
        trace: [
          FINDING_A.trace[0]!,
          {
            kind: "sink",
            file: "src/users/search.ts",
            line: 45,
            scope: "findUsers",
            description: "Raw SQL query executed",
          },
        ],
        evidence: [
          {
            file: "src/users/search.ts",
            line: 45,
            description: "db.query(`SELECT * FROM users WHERE name = '${req.query.q}'`)",
          },
        ],
        status: "new",
        owner: null,
        firstSeen: "2026-11-05T00:00:00.000Z",
        lastSeen: "2026-11-05T00:00:00.000Z",
      });

      const movedUpsert = await store.findings.upsert(movedFinding);
      expect(movedUpsert.isNew).toBe(false);
      // Carried forward id, status, and owner
      expect(movedUpsert.finding.id).toBe(FINDING_A.id);
      expect(movedUpsert.finding.status).toBe("in_progress");
      expect(movedUpsert.finding.owner).toBe("alice@example.com");
      expect(movedUpsert.finding.firstSeen).toBe(FINDING_A.firstSeen);
      expect(movedUpsert.finding.lastSeen).toBe("2026-11-05T00:00:00.000Z");
      expect(movedUpsert.finding.location.line).toBe(45);
    });

    it("supports policy, exception, and event lifecycle", async () => {
      const policy: Policy = {
        id: "00000000-0000-4000-8000-0000000004a1",
        name: "Default Strict Policy",
        mode: "enforce",
        rules: [{ verdict: "confirmed", minSeverity: "high", attackClasses: [] }],
        slaDays: DEFAULT_SLA_DAYS,
        createdAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-01T00:00:00.000Z",
      };

      await store.policies.upsert(policy);
      const fetchedPolicy = await store.policies.get(policy.id);
      expect(fetchedPolicy?.name).toBe("Default Strict Policy");

      const exception = {
        id: "00000000-0000-4000-8000-0000000005a1",
        projectId: PROJECT_A.id,
        fingerprint: FINDING_A.fingerprint,
        kind: "accepted_risk" as const,
        reason: "Legacy system migration scheduled for next quarter",
        approver: "ciso@example.com",
        expiresAt: "2027-01-01T00:00:00.000Z",
        createdAt: "2026-11-01T04:00:00.000Z",
      };
      await store.policies.addException(exception);
      const excList = await store.policies.listExceptions(PROJECT_A.id);
      expect(excList.map((e) => e.id)).toContain(exception.id);

      const event: PlatformEvent = {
        id: "00000000-0000-4000-8000-0000000006a1",
        runId: RUN_A.id,
        projectId: PROJECT_A.id,
        seq: 0,
        type: "run.started",
        payload: { commitSha: "abcdef", skillVersion: "v1.0" },
        at: "2026-11-01T01:01:00.000Z",
      };
      await store.events.append(event);
      const events = await store.events.listByRun(RUN_A.id);
      expect(events).toHaveLength(1);
      expect(events[0]?.id).toBe(event.id);
    });
  });
});
