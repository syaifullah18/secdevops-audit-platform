# @sdap/core

Shared contracts for the SecDevOps Audit Platform: the source of truth every package codes
against. Schemas are defined once with Zod and exported as JSON Schema into `schema/`.

Owner: the lead. Workers do not edit this package; open a contract request instead
(`docs/workstreams/<WS>-contract-request.md`).

## What is here

| Module       | Contracts                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| `enums.ts`   | `Verdict`, `Severity`, `FindingStatus`, `AuditMode`, `PhaseName`, `Role`, `ModelTask`, `AttackClass` |
| `finding.ts` | `Finding` (with verdict invariants), `TraceStep`, `EvidenceItem`, `TriageEvent`, triage transitions  |
| `run.ts`     | `Run`, `RunPhase`, `Slice`, `SliceAttempt`, `RunScope`, `RunJob`, queue names                        |
| `model.ts`   | `ModelAdapter` interface, `ModelRef`, `ModelRoute`, `ModelAdapterError` + codes                      |
| `jev.ts`     | `JevQuestion`, `JevDecision`, `EscalationPolicy`, `escalationReason()`                               |
| `project.ts` | `Project`                                                                                            |
| `policy.ts`  | `Policy`, `GateRule`, `Exception`, `GateResult`, `evaluateGate()`, `computeSlaDue()`                 |
| `events.ts`  | `PlatformEvent` union (`run.started`, `slice.done`, `finding.upserted`, ...), `EventSink`            |
| `api.ts`     | `CreateRunRequest`, `FindingQuery`, `TriageRequest`, pages, `ApiError`                               |
| `store.ts`   | `Store` and repository interfaces (WS3 implements, WS1/WS2 consume), `AccessScope`                   |
| `sandbox.ts` | `SandboxPolicy`, `SandboxRunner` (WS8 implements), `AdapterRegistry` (WS4 implements)                |
| `testing.ts` | `makeFinding()` test builder (import from `@sdap/core/testing`)                                      |

## Invariants enforced here

- Only `confirmed` findings can fail a gate: `GateRule.verdict` is the literal `"confirmed"`, and
  `evaluateGate` ignores every other verdict and closed statuses.
- Gates use `verifiedSeverity`; `originalSeverity` is kept for audit only.
- `needs_validation` has blockers and no severity; `rejected` has a reason and no severity.
- System 1 (Jev) output is advisory (`TriageSuggestion`, `JevDecision`); nothing in a gate reads it.

## Scripts

- `pnpm schema`: regenerate `schema/*.schema.json` (a test fails if they are stale)
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`
