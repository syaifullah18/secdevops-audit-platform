import type { Finding } from "./finding.js";

/**
 * Builders for tests in any package. Values are synthetic; never put real
 * client names, paths or code here.
 */
export const makeFinding = (overrides: Partial<Finding> = {}): Finding => ({
  id: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-0000000000aa",
  fingerprint: "sample-app:authz:orders-idor",
  sourceRun: "00000000-0000-4000-8000-0000000000b1",
  firstRun: "00000000-0000-4000-8000-0000000000b1",
  attackClass: "authz",
  cwe: "CWE-639",
  title: "Order lookup does not check ownership",
  description: "GET /orders/:id returns any order to any authenticated user.",
  rootCause: "Missing owner check in order service.",
  location: { file: "src/orders/service.ts", line: 42 },
  trace: [
    {
      kind: "entrypoint",
      file: "src/orders/routes.ts",
      line: 10,
      scope: "GET /orders/:id",
      description: "Route takes id from the path.",
    },
    {
      kind: "sink",
      file: "src/orders/service.ts",
      line: 42,
      scope: "OrderService.get",
      description: "Loads by id without owner filter.",
    },
  ],
  evidence: [
    { file: "src/orders/service.ts", line: 42, description: "findById(id) with no user scope" },
  ],
  verdict: "confirmed",
  originalSeverity: "critical",
  verifiedSeverity: "high",
  confidence: "high",
  status: "new",
  owner: null,
  firstSeen: "2026-11-01T00:00:00.000Z",
  lastSeen: "2026-11-01T00:00:00.000Z",
  slaDue: "2026-12-01T00:00:00.000Z",
  model: { adapter: "mock", model: "mock-1" },
  phase: "record_verify",
  blockers: [],
  rejectionReason: null,
  remediation: null,
  triageSuggestion: null,
  rootCauseGroup: null,
  ...overrides,
});
