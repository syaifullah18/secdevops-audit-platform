# WS1 Orchestrator + skill runner

- **Runner / model:** claude / `claude-opus-5-5` (fallback agy / `gemini-4-argon-high`)
- **Branch:** `ws/WS1`
- **Paths:** `apps/worker/**` (except `apps/worker/src/metrics.ts`, owned by WS7)
- **Consumes (core):** `RunJob`, `Run`, `RunPhase`, `Slice`, `SliceAttempt`, `ModelRoute`, `ModelRef`,
  `ModelAdapterError`, `AdapterRegistry`, `SandboxRunner`, `SandboxPolicy`, `Store`, `EventSink`,
  `PlatformEvent`, `QUEUE_NAMES`, `JevQuestion`, `escalationReason`, `modelFamily`

## Goal

The BullMQ worker that executes one audit run end to end: prepare the target, run the
security-audit-skill's phases with parallel slices and a per-slice model fallback chain,
validate outputs with the skill's own validators, and hand the artefacts to the normalizer.

## Deliverables

1. **Queue consumer** on `QUEUE_NAMES.runs` (BullMQ, Redis from `REDIS_URL`), payload parsed with
   `RunJob`. Concurrency from config. Cancellation via a BullMQ job flag or a `cancel` key checked
   between slices.
2. **Pipeline** `preflight → recon → hunt (parallel slices) → triage (optional Jev) → validate
(parallel, cross-family verifier) → output → record_verify → report`. The skill's
   instructions are not modified; the worker drives an agent CLI with the skill installed and
   prompts that select a phase and an output directory.
3. **Agent runner**: spawn agent CLIs (`claude -p ... --model <id>`, `agy -p ... --model <id>`) as
   child processes **only through the `SandboxRunner` interface**. Register them in the
   `AdapterRegistry` as `agent-cli:claude` and `agent-cli:agy` (ModelAdapter whose `generate`
   runs the CLI). Map CLI failures to `ModelErrorCode` (quota, rate limit, safety block,
   permission denied, timeout).
4. **Preflight**: `health()` for every model in the run's routes; a harness permission check (can
   the agent write in the output dir and read the target); fail fast with a clear reason.
5. **Routing with fallback**: for each slice, try `route.primary`, then each fallback when
   `ModelAdapterError.shouldFallBack` is true; retry with backoff on `rate_limited`/`timeout`.
   `validate` must use a different `modelFamily` than the slice's `hunt` model when one exists in
   the route. Every attempt is a `SliceAttempt` (model, status, error code, usage, log key).
6. **Validation**: run `vendor/security-audit-skill/skills/security-audit/validate-findings.cjs`
   and `validate-coverage-ledger.cjs` (`node <file> <path>`, exit code 0 = pass). Invalid JSON
   (concatenated objects, filter notices) is moved to `quarantine/` and the slice retried, at most
   N times. A failed validation fails the run; never mark it clean.
7. **Modes**: `focused` (diff `baseCommitSha..commitSha`, only changed paths, reuse previous
   ledger), `incremental` (whole scope, reuse previous ledger + findings), `full` (fresh;
   `repeat` N independent runs merged by fingerprint).
8. **Resume**: slice state is persisted through `Store.runs.upsertSlice` after every transition;
   a job with `resume: true` (or a re-delivered job) skips slices already `succeeded`.
9. **Events**: emit `run.started`, `phase.started/done`, `slice.started/attempt_failed/done`,
   `validator.done`, `run.completed/failed/cancelled` through `EventSink` with monotonically
   increasing `seq`. Provide a Redis pub/sub `EventSink` on `EVENT_CHANNEL` plus `Store.events.append`.
10. **Normalizer hook**: after `output`, call an injected `importFindings(run, artefactDir)`
    function (WS3 provides the real one in Phase 2); emit `finding.upserted` for its results.
11. Config parsed with Zod from env (see `.env.example`), budgets enforced: stop scheduling new
    slices when `scope.tokenBudget` or `maxRuntimeSec` is exceeded and fail with a clear reason.

## Acceptance criteria

- Unit tests with a **fake agent CLI** (a small Node script under `apps/worker/test/fixtures/`
  that writes canned `findings.json` / `coverage-ledger.json`) and fake `Store`/`SandboxRunner`/
  `EventSink`. No network, no Redis needed for unit tests (inject the queue).
- Test: primary model returns `quota_exceeded` → fallback model is used, both attempts recorded.
- Test: invalid `findings.json` → quarantined, retried, then run `failed` (never `succeeded`).
- Test: **resumes a killed run**: kill after 2 of 4 hunt slices, resume, only 2 slices re-run.
- Test: verifier family differs from hunter family when the route allows it.
- Test: events are emitted in order with increasing `seq`.
- `pnpm -r typecheck lint test` green. README documents config, phases and the fake CLI.

## Out of scope

Real Drizzle store (WS3), real sandbox (WS8), metrics (WS7), real model adapters (WS4).
