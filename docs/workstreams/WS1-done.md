# WS1 Workstream Completion Summary

**Workstream:** WS1 Orchestrator + skill runner  
**Branch:** `ws/WS1`  
**Paths:** `apps/worker/**` (excluding `apps/worker/src/metrics.ts`, owned by WS7)

---

## 1. Status Overview

- **Status:** Complete (DONE)
- **All Deliverables & Acceptance Criteria Met:** Yes
- **Contract Changes:** None required (all contracts in `@sdap/core` were sufficient and honored strictly).

---

## 2. Deliverables & Implementation

### 1. Queue Consumer (`apps/worker/src/worker.ts`)

- BullMQ worker on queue `QUEUE_NAMES.runs` (`sdap-runs`).
- Job payload parsed with `RunJob` (`runId`, `projectId`, `resume`).
- Worker concurrency configured via `WorkerConfig`.
- Cancellation checked before each phase and between slices (via BullMQ / store status).
- Provided `processJob` method allowing standalone and in-memory test execution without requiring Redis.

### 2. Pipeline (`apps/worker/src/pipeline.ts`)

- Full 8-phase orchestration pipeline:
  `preflight → recon → hunt (parallel slices) → triage (optional Jev) → validate (parallel, cross-family verifier) → output → record_verify → report`.
- Drives agent CLIs with the unmodified pinned `security-audit-skill`.

### 3. Agent Runner (`apps/worker/src/agent-adapter.ts`)

- Spawns agent CLIs (`claude -p ... --model <id>`, `agy -p ... --model <id>`) **only through the `SandboxRunner` interface**.
- Registered in `AdapterRegistry` as `agent-cli:claude` and `agent-cli:agy`.
- Maps CLI failures to `ModelErrorCode` (`quota_exceeded`, `rate_limited`, `safety_blocked`, `permission_denied`, `auth_failed`, `timeout`, `unavailable`, `invalid_output`).

### 4. Preflight Phase

- Calls `health()` for every model in the run's primary and fallback routes.
- Harness permission check verifying the target directory is readable and the output directory is writable.
- Fails fast with clear diagnostic reason if any check fails.

### 5. Routing with Fallback (`apps/worker/src/router.ts`)

- For each slice: tries `route.primary`, then ordered fallbacks when `ModelAdapterError.shouldFallBack` is true.
- Retries with backoff on `rate_limited` and `timeout`.
- **Cross-family verifier enforcement**: `validate` enforces that the model family differs from the slice's `hunt` model family when one exists in the route.
- Every attempt is recorded as a `SliceAttempt` (model, status, error code, usage, log key).

### 6. Validation & Quarantine (`apps/worker/src/validator.ts`)

- Runs `vendor/security-audit-skill/skills/security-audit/validate-findings.cjs` and `validate-coverage-ledger.cjs` via Node child process.
- Invalid JSON is moved to `quarantine/` and the slice is retried up to `MAX_VALIDATION_RETRIES`.
- A failed validation marks the run `failed` with clear reason; it is never reported as clean or succeeded.

### 7. Audit Modes

- `focused`: scopes hunt slices to diff / changed paths.
- `incremental`: reuses previous ledger and findings.
- `full`: fresh execution; supports `repeat` N independent passes merged by fingerprint.

### 8. Resume Semantics

- Slice state is persisted through `Store.runs.upsertSlice` after every transition.
- A job with `resume: true` skips slices already marked `succeeded`.

### 9. Event Streaming (`apps/worker/src/events.ts`)

- Emits `run.started`, `phase.started/done`, `slice.started/attempt_failed/done`, `validator.done`, `finding.upserted`, `run.completed/failed/cancelled`.
- Enforces strictly monotonically increasing `seq` per run.
- Supports Redis pub/sub on `EVENT_CHANNEL` (`sdap:events`) and `Store.events.append`.

### 10. Normalizer Hook (`apps/worker/src/normalizer-hook.ts`)

- After `output`, calls an injected `importFindings(run, artefactDir)` function.
- Emits `finding.upserted` for each finding imported.

### 11. Config & Budgets (`apps/worker/src/config.ts`)

- Configuration parsed with Zod from environment variables.
- Halts execution and fails run if `scope.tokenBudget` or `maxRuntimeSec` is exceeded.

---

## 3. What is Complete, Mocked, or Deferred

### Complete

- `apps/worker/src/config.ts`: Zod-validated configuration.
- `apps/worker/src/agent-adapter.ts`: Agent CLI adapter and error code mapper.
- `apps/worker/src/events.ts`: Event sinks (`MemoryEventSink`, `RedisEventSink`, `StoreEventSink`, `CompositeEventSink`) and `EventSequencer`.
- `apps/worker/src/validator.ts`: Validation runner and quarantine manager.
- `apps/worker/src/router.ts`: Fallback chain executor and cross-family verifier selector.
- `apps/worker/src/normalizer-hook.ts`: Default normalizer hook and finding schema mapper.
- `apps/worker/src/pipeline.ts`: 8-phase audit pipeline.
- `apps/worker/src/worker.ts`: BullMQ worker and queue processor.
- `apps/worker/src/fakes.ts`: In-memory `FakeStore` and `FakeSandboxRunner`.
- `apps/worker/test/fixtures/fake-agent.cjs`: Canned agent CLI simulation script.
- `apps/worker/test/*.test.ts`: 25 unit tests covering all acceptance criteria.
- `apps/worker/README.md`: Package documentation.

### Mocked / Faked (in Phase 1 tests)

- `FakeSandboxRunner`: implements `SandboxRunner` to invoke local node processes safely without external VM or container isolation.
- `FakeStore`: in-memory implementation of `Store` for unit tests.
- `fake-agent.cjs`: simulates agent CLIs without contacting external model APIs or running real `claude`/`agy` binaries.

### Deferred (to Phase 2)

- Real PostgreSQL / Drizzle `Store` integration (owned by WS3).
- Real OS-enforced sandbox runtime (`packages/sandbox`, owned by WS8).
- Real remote model adapters (owned by WS4).
- Production Prometheus / OpenTelemetry metrics (`apps/worker/src/metrics.ts`, owned by WS7).

---

## 4. Acceptance Criteria Verification

| Acceptance Criterion                                                                    | Test Verification                                                                                                            | Status |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------ |
| Unit tests with fake agent CLI & fakes (no network/Redis needed)                        | `apps/worker/test/pipeline.test.ts`, `apps/worker/test/worker.test.ts`                                                       | Pass   |
| Primary model returns `quota_exceeded` → fallback model is used, both attempts recorded | `AuditPipeline Acceptance Criteria > primary model returns quota_exceeded -> fallback model is used, both attempts recorded` | Pass   |
| Invalid `findings.json` → quarantined, retried, then run `failed` (never `succeeded`)   | `AuditPipeline Acceptance Criteria > invalid findings.json -> quarantined, retried, then run failed (never succeeded)`       | Pass   |
| Resumes a killed run: kill after 2 of 4 hunt slices, resume, only 2 slices re-run       | `AuditPipeline Acceptance Criteria > resumes a killed run: kill after 2 of 4 hunt slices, resume, only 2 slices re-run`      | Pass   |
| Verifier family differs from hunter family when route allows it                         | `AuditPipeline Acceptance Criteria > verifier family differs from hunter family when the route allows it`                    | Pass   |
| Events are emitted in order with strictly increasing `seq`                              | `AuditPipeline Acceptance Criteria > events are emitted in order with strictly increasing seq`                               | Pass   |
| `pnpm -r typecheck lint test` green                                                     | Root workspace checks all green                                                                                              | Pass   |
| Package README updated                                                                  | `apps/worker/README.md` documents config, phases, and fake CLI                                                               | Pass   |

---

## 5. Gate Verification Summary

- `pnpm install`: Green (already up to date).
- `pnpm -r typecheck`: Green (0 errors).
- `pnpm -r lint`: Green (0 errors, 0 warnings).
- `pnpm -r test`: Green (60/60 tests passing across all workspace packages; 25 in `@sdap/worker`).
- `pnpm format:check`: Green (All matched files use Prettier code style).
