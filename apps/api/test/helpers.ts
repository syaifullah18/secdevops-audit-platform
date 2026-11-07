import type { Finding, Policy, Project, Run } from "@sdap/core";
import { type CryptoKey, exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { buildApp } from "../src/app.js";
import { type AuthUser, OidcAuthVerifier } from "../src/auth.js";
import { MemoryQueue } from "../src/queue.js";
import { MemoryStore } from "./fake-store.js";

export const TEST_ISSUER = "https://auth.sdap.local";
export const TEST_AUDIENCE = "sdap-api";

export interface KeyPairContext {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwk: JWK;
}

export const createTestKeyPair = async (): Promise<KeyPairContext> => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "test-key-1";
  publicJwk.alg = "RS256";
  return { privateKey, publicKey, publicJwk };
};

export const createToken = async (
  user: AuthUser,
  privateKey: CryptoKey,
  options?: { issuer?: string; audience?: string; expiresIn?: string },
): Promise<string> => {
  const jwt = new SignJWT({
    roles: user.roles,
    clientIds: user.clientIds,
    team: user.team,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
    .setSubject(user.subject)
    .setIssuer(options?.issuer ?? TEST_ISSUER)
    .setAudience(options?.audience ?? TEST_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(options?.expiresIn ?? "1h");

  return jwt.sign(privateKey);
};

export interface TestContext {
  store: MemoryStore;
  queue: MemoryQueue;
  app: Awaited<ReturnType<typeof buildApp>>;
  keys: KeyPairContext;
  authVerifier: OidcAuthVerifier;
  issueToken: (user: AuthUser) => Promise<string>;
  /** Parsed JSON log lines written by the app (audit entries included). */
  logs: () => Record<string, unknown>[];
}

export const WEBHOOK_SECRET = "test-webhook-secret";

export interface SetupOptions {
  /** Accept static dev tokens (default true). */
  devMode?: boolean;
  /** Do not wire a webhook secret resolver. */
  noSecret?: boolean;
  secrets?: Record<string, string>;
}

export const setupTestApp = async (opts: SetupOptions = {}): Promise<TestContext> => {
  const keys = await createTestKeyPair();
  const authVerifier = new OidcAuthVerifier({
    jwks: { keys: [keys.publicJwk] },
    issuer: TEST_ISSUER,
    audience: TEST_AUDIENCE,
    devMode: opts.devMode ?? true,
  });

  const lines: string[] = [];
  const store = new MemoryStore();
  const queue = new MemoryQueue();

  const app = await buildApp({
    store,
    queue,
    auth: authVerifier,
    config: {
      authDevMode: opts.devMode ?? true,
      nodeEnv: "test",
      logLevel: "info",
      webhookSecrets: opts.secrets ?? {},
    },
    webhookSecretResolver: opts.noSecret ? undefined : () => WEBHOOK_SECRET,
    logStream: { write: (line) => void lines.push(line) },
    ssePollMs: 20,
  });

  const issueToken = (user: AuthUser) => createToken(user, keys.privateKey);

  return {
    store,
    queue,
    app,
    keys,
    authVerifier,
    issueToken,
    logs: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>),
  };
};

export const sampleProject = (overrides: Partial<Project> = {}): Project => ({
  id: "00000000-0000-4000-8000-000000000001",
  slug: "project-alpha",
  name: "Project Alpha",
  repoUrl: "https://github.com/example/alpha",
  defaultBranch: "main",
  team: "team-alpha",
  clientId: "client-a",
  policyId: null,
  webhookSecretRef: null,
  modelRouting: [],
  escalation: null,
  criticalPaths: ["auth/**"],
  monthlyTokenBudget: 500000,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...overrides,
});

export const sampleRun = (overrides: Partial<Run> = {}): Run => ({
  id: "00000000-0000-4000-8000-000000000011",
  projectId: "00000000-0000-4000-8000-000000000001",
  mode: "focused",
  repeat: 1,
  trigger: {
    kind: "api",
    actor: "user-1",
    ref: null,
  },
  ref: "main",
  commitSha: "1234567890abcdef",
  baseCommitSha: null,
  previousRunId: null,
  scope: {
    paths: [],
    attackClasses: [],
    maxRuntimeSec: 14400,
    tokenBudget: null,
  },
  status: "queued",
  phases: [],
  validators: { findings: "pending", coverageLedger: "pending" },
  skillVersion: "pinned-0.1.0",
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
  createdAt: "2026-11-01T00:00:00.000Z",
  startedAt: null,
  endedAt: null,
  ...overrides,
});

export const sampleFinding = (overrides: Partial<Finding> = {}): Finding => ({
  id: "00000000-0000-4000-8000-000000000101",
  projectId: "00000000-0000-4000-8000-000000000001",
  fingerprint: "alpha:authz:idor-1",
  sourceRun: "00000000-0000-4000-8000-000000000011",
  firstRun: "00000000-0000-4000-8000-000000000011",
  attackClass: "authz",
  cwe: "CWE-639",
  title: "Broken Object Level Authorization",
  description: "User can access other users data via orderId",
  rootCause: "Missing authorization check in order controller",
  location: { file: "src/orders.ts", line: 42 },
  trace: [
    {
      kind: "entrypoint",
      file: "src/routes.ts",
      line: 12,
      scope: "GET /orders/:id",
      description: "Request received",
    },
    {
      kind: "sink",
      file: "src/orders.ts",
      line: 42,
      scope: "OrderService.get",
      description: "Direct lookup by id",
    },
  ],
  evidence: [{ file: "src/orders.ts", line: 42, description: "Direct database query" }],
  verdict: "confirmed",
  originalSeverity: "high",
  verifiedSeverity: "high",
  confidence: "high",
  status: "new",
  owner: null,
  firstSeen: "2026-11-01T00:00:00.000Z",
  lastSeen: "2026-11-01T00:00:00.000Z",
  slaDue: "2026-12-01T00:00:00.000Z",
  model: { adapter: "test", model: "argon-test" },
  phase: "record_verify",
  blockers: [],
  rejectionReason: null,
  remediation: null,
  triageSuggestion: null,
  rootCauseGroup: null,
  ...overrides,
});

export const samplePolicy = (overrides: Partial<Policy> = {}): Policy => ({
  id: "00000000-0000-4000-8000-000000000201",
  name: "Default Enforce Policy",
  clientId: null,
  mode: "enforce",
  rules: [{ verdict: "confirmed", minSeverity: "high", attackClasses: [] }],
  slaDays: { critical: 7, high: 30, medium: 90, low: 180, informational: null },
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...overrides,
});
