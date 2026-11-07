# WS2 API: Done Report

Branch `ws/WS2`. Paths: `apps/api/**` except `src/db/**` (WS3) and `src/metrics.ts` (WS7).

A first pass of this workstream (uncommitted) was reviewed against the card. Most of the endpoint
and test scaffolding was kept; the corrections below were made.

## Complete

- `buildApp({ store, queue, auth, config, webhookSecretResolver })` factory and `src/main.ts`
  (PostgreSQL store from WS3, `BullMqQueue`, OIDC verifier from env). `Queue` has `enqueue` and
  `cancel` with a BullMQ implementation and `MemoryQueue`.
- All card endpoints under `/api/v1`, plus `/healthz`, `/readyz`, `/openapi.json`. SSE stream at
  `/runs/:id/events/stream` (replay, follow, `Last-Event-ID`, keep-alive, closes on terminal runs).
- OIDC bearer verification with `jose` (JWKS, issuer, audience, expiry; JWKS discovered from the
  issuer when no URL is given). Dev tokens only when `AUTH_DEV_MODE=true` and not production.
- RBAC (matrix in the README, table-driven test), isolation with `404` for other clients,
  structured audit log for every mutating request, `ApiError` everywhere, Zod 400 with details.
- OpenAPI 3.1 generated from the core Zod schemas (and the API's own input schemas), served and
  written to `apps/api/openapi.json` by `pnpm openapi`.
- Tests (in-memory `Store` fake in `test/fake-store.ts`, local JWKS): contract, RBAC, isolation,
  gate, webhook, events, plus `hardening.test.ts` for auth, audit, triage rules, webhooks, SSE and
  OpenAPI route coverage. Every acceptance criterion of the card has a test.

## Corrections to the first pass

- **Auth failed open:** a token without a `clientIds` claim got every client (`"*"`), and the
  verifier fell back to dev mode when OIDC was unconfigured. Now a missing claim means no access,
  the API refuses to start without OIDC or dev mode, and `loadConfig` forces dev mode off in
  production even through overrides. Tokens with no recognised role get 403.
- **Webhooks:** removed the hard-coded default secret (`"default-webhook-secret"`); unknown project,
  no secret and bad signature are one 401 (no project enumeration); each provider accepts only its
  own header; GitLab token and HMACs are compared in constant time; only `sha256=` signatures;
  non-run events (ping, branch delete, closed PR) are ignored with 202; tag pushes and Bitbucket
  PRs are mapped. The route was registered twice (with and without prefix); now once.
- **Audit log was discarded:** the logger was `false`, so `req.log` did nothing. Logging is on, and
  audit lines are written centrally from a response hook (including denied and failed requests).
- `includeRejected=false` was parsed as `true` (`z.coerce.boolean`); fixed.
- Project `PATCH` used a partial schema whose defaults overwrote unsent fields; now only sent
  fields change. A scoped user could create or move a project into another client; now 403.
  Duplicate slugs give 409 instead of a database error.
- Policies were readable and writable by id across clients; now scoped through the projects that
  use them.
- Triage: exception creation and status change are in one `store.tx`; `accepted_risk` needs a
  future `expiresAt`; role is checked before the lookup; the actor role is recorded accurately.
- Gate: expired `accepted_risk` findings count again, and an exception no longer applies after a
  finding is triaged back to `confirmed`.
- Runs: shared `queueRun` service for API and webhooks; if the queue is down the run is marked
  `failed` and the API answers 503 (no run stuck as `queued`); `repeat > 1` requires `full` mode.
- Errors: 5xx no longer leak internal messages; unknown routes return `ApiError` 404; malformed
  ids are 404 and query strings are validated with Zod.
- OpenAPI request bodies now describe the real inputs; removed the `any`-typed dynamic import hack
  for `/metrics`; test type errors (`CryptoKey`, `inject` typing) fixed.

## Decisions

- Security role cannot create runs (the card gives runs to DevOps and Admin). Admin passes every
  role check.
- A project without a policy is gated with a default enforce policy (block `confirmed` high and
  above). PRD 5.5 suggests report-only for new projects; attach a `report_only` policy for that.
- Webhook secrets come from `WEBHOOK_SECRETS` or an injected resolver, because `Project` has no
  secret reference (contract request 1).
- `index.ts` no longer re-exports `src/db` (WS3 owns it; `main.ts` imports it directly).

## Mocked

- Store: in-memory `MemoryStore` in tests; PostgreSQL store tests need `DATABASE_URL` (WS3).
- Queue: `MemoryQueue` in tests; `BullMqQueue` is not exercised without Redis.
- IdP: locally generated JWKS. The discovery and remote JWKS paths are not tested against a server.

## Deferred

- `/metrics` (WS7, wired in Phase 2).
- Contract requests in `WS2-contract-request.md`: webhook secret reference, exception revoke and
  policy client, atomic event `seq`, store ping.
- SSE follows by polling the store every second; Redis pub/sub fan-out can replace it later.
- The OpenAPI path list is written by hand (schemas are generated); a test keeps it aligned with
  the served routes.
