# WS2 API

- **Runner / model:** claude / `claude-sonnet-5-5` (fallback agy / `gemini-4-argon-high`)
- **Branch:** `ws/WS2`
- **Paths:** `apps/api/**` (except `apps/api/src/db/**` owned by WS3, `apps/api/src/metrics.ts` owned by WS7)
- **Consumes (core):** `Store` + repos, `AccessScope`, `Project`, `Run`, `RunJob`, `CreateRunRequest`,
  `FindingQuery`, `TriageRequest`, `TriageEvent`, `canTransition`, `Policy`, `Exception`,
  `evaluateGate`, `computeSlaDue`, `Role`, `ApiError`, `PlatformEvent`, `QUEUE_NAMES`

## Goal

Fastify API for triggers, runs, findings, triage, policy and webhooks, with OIDC auth, RBAC and
per-client isolation. OpenAPI generated from the Zod contracts.

## Deliverables

1. `buildApp({ store, queue, auth, config })` factory (dependency-injected; no globals) and
   `src/main.ts` that wires real deps from env. `queue` is a small interface
   (`enqueue(job: RunJob)`, `cancel(runId)`) with a BullMQ implementation and an in-memory fake.
2. Endpoints under `/api/v1`:
   - `GET/POST /projects`, `GET/PATCH /projects/:id`
   - `POST /runs` (validates `CreateRunRequest`, creates `Run` status `queued`, enqueues `RunJob`),
     `GET /runs/:id`, `GET /projects/:id/runs`, `POST /runs/:id/cancel`, `GET /runs/:id/events`
     (JSON list, plus SSE stream at `/runs/:id/events/stream`)
   - `GET /findings` (`FindingQuery`; rejected hidden by default), `GET /findings/:id`,
     `GET /findings/:id/history`, `POST /findings/:id/triage` (`TriageRequest`; enforces
     `canTransition`; `accepted_risk` requires `expiresAt` and creates an `Exception`;
     `false_positive` requires a reason)
   - `GET /review-queue` (open `needs_validation` findings in caller scope)
   - `GET/PUT /policies/:id`, `GET /projects/:id/gate` (runs `evaluateGate` over open findings
     and active exceptions; returns `GateResult`)
   - `POST /webhooks/{github,gitlab,bitbucket}`: verify the HMAC signature header with a
     per-project secret, map push/PR/tag events to a `focused` run (`trigger.kind = webhook`)
   - `GET /healthz`, `GET /readyz`, `GET /openapi.json`
3. **Auth**: OIDC bearer JWT verification (JWKS from `OIDC_ISSUER_URL`, audience check) using
   `jose`. Claims map to `{ subject, roles: Role[], clientIds: string[] | "*" }`. A dev mode
   (`AUTH_DEV_MODE=true`) accepting static tokens is allowed only when `NODE_ENV !== production`.
4. **RBAC**: Viewer read; Developer read + triage `in_progress`/`fixed` request on own team;
   Security triage all, review queue, exceptions; DevOps runs + projects; Admin everything.
   Document the matrix in the README and test it.
5. **Isolation**: every store call gets the caller's `AccessScope`. A user of client A gets `404`
   (not 403) for client B's resources.
6. Audit log: every mutating request writes a structured log line (actor, action, target).
7. Error responses use `ApiError`. Zod validation errors → 400 with details.
8. OpenAPI 3.1 generated from the Zod schemas (e.g. `fastify-type-provider-zod` or
   `zod-openapi`), served at `/openapi.json` and written to `apps/api/openapi.json` by a script.

## Acceptance criteria

- Contract tests: every endpoint's request/response validates against the core schemas, using
  `app.inject()` and an **in-memory `Store` fake** implemented in `apps/api/test/`.
- RBAC tests: a table-driven test of role × endpoint → allowed/denied.
- Isolation test: client A cannot list, read, triage or gate client B's findings.
- Gate test: `needs_validation` high never fails the gate; confirmed high does.
- Webhook test: bad signature → 401; good signature → run enqueued.
- `pnpm -r typecheck lint test` green. README with endpoint list and RBAC matrix.

## Out of scope

Drizzle implementation (WS3), metrics endpoint content (WS7; expose `/metrics` only if WS7's
module is present, wired in Phase 2), the worker (WS1).
