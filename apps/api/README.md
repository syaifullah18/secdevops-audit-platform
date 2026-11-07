# @sdap/api

Fastify REST API of the SecDevOps Audit Platform: projects, audit runs, findings and triage,
policies and release gates, webhooks, OIDC authentication, RBAC and per-client isolation.

Owner: workstream **WS2** (`docs/workstreams/WS2.md`). Persistence is WS3 (`src/db`), the worker
is WS1; this package only talks to them through the `Store` interface and the `Queue` interface.

## Design

- `buildApp({ store, queue, auth, config, webhookSecretResolver })` is a dependency-injected
  factory: no globals, nothing is read from the environment except through `loadConfig`.
  `src/main.ts` wires the real PostgreSQL store, BullMQ queue and OIDC verifier from env.
- `Queue` is `enqueue(job: RunJob)` / `cancel(runId)`, with `BullMqQueue` and an in-memory
  `MemoryQueue` for tests. If enqueueing fails the run is marked `failed` and the caller gets a 503.
- Tests use an in-memory `Store` (`test/fake-store.ts`) and a locally generated JWKS (`jose`).
- Errors are `ApiError` (`{ error, message, details? }`). Zod validation failures are 400 with the
  issues in `details`. 5xx responses never include internal messages.
- OpenAPI 3.1 is generated from the `@sdap/core` Zod schemas, served at `/openapi.json` and written
  to `openapi.json` by `pnpm openapi`. A test checks that every documented path is a served route.

## Configuration

| Variable                 | Meaning                                                                           |
| ------------------------ | --------------------------------------------------------------------------------- |
| `DATABASE_URL`           | PostgreSQL connection (required by `main.ts`)                                     |
| `REDIS_URL`              | BullMQ Redis (default `redis://localhost:6379`)                                   |
| `API_PORT` / `HOST`      | Listen address (default `8080` / `0.0.0.0`)                                       |
| `OIDC_ISSUER_URL`        | Issuer; the JWKS URL is discovered from `/.well-known/openid-configuration`       |
| `OIDC_JWKS_URL`          | Optional explicit JWKS URL                                                        |
| `OIDC_AUDIENCE`          | Required token audience (falls back to `OIDC_CLIENT_ID`, then `sdap-api`)         |
| `AUTH_DEV_MODE`          | `true` accepts static dev tokens. Ignored when `NODE_ENV=production`              |
| `WEBHOOK_SECRETS`        | JSON `{ "<projectIdOrSlug>": "<secret>" }`. There is no default secret            |
| `SKILL_VERSION`          | Skill commit recorded on queued runs (the worker overwrites it with the real pin) |
| `LOG_LEVEL` / `NODE_ENV` | Logging and environment                                                           |

The API refuses to start when neither OIDC nor dev mode is configured.

## Endpoints

All `/api/v1` endpoints except webhooks need `Authorization: Bearer <token>`.

| Method  | Path                                         | Notes                                                                               |
| ------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| GET     | `/healthz`, `/readyz`, `/openapi.json`       | No auth. `/readyz` round-trips to the store. `/metrics` is WS7's, wired in Phase 2  |
| GET     | `/api/v1/projects`                           | Projects in the caller's scope                                                      |
| POST    | `/api/v1/projects`                           | 403 if `clientId` is outside the caller's scope, 409 on duplicate slug              |
| GET     | `/api/v1/projects/:id`                       |                                                                                     |
| PATCH   | `/api/v1/projects/:id`                       | Only the fields sent are changed; moving to another client needs scope on it        |
| POST    | `/api/v1/runs`                               | `CreateRunRequest`; creates a `queued` run, `run.queued` event, enqueues a `RunJob` |
| GET     | `/api/v1/runs/:id`                           |                                                                                     |
| GET     | `/api/v1/projects/:id/runs`                  | `cursor`, `limit`                                                                   |
| POST    | `/api/v1/runs/:id/cancel`                    | 409 if already finished                                                             |
| GET     | `/api/v1/runs/:id/events`                    | JSON list, optional `afterSeq`                                                      |
| GET     | `/api/v1/runs/:id/events/stream`             | SSE; replays then follows; resumes with `Last-Event-ID`; closes when the run ends   |
| GET     | `/api/v1/findings`                           | `FindingQuery`; rejected hidden unless `includeRejected=true` or `verdict=rejected` |
| GET     | `/api/v1/findings/:id`, `/:id/history`       |                                                                                     |
| POST    | `/api/v1/findings/:id/triage`                | `TriageRequest`, see rules below                                                    |
| GET     | `/api/v1/review-queue`                       | Open `needs_validation` findings in scope                                           |
| GET/PUT | `/api/v1/policies/:id`                       | PUT creates or replaces                                                             |
| GET     | `/api/v1/projects/:id/gate`                  | `GateResult` from `evaluateGate`                                                    |
| POST    | `/api/v1/webhooks/{github,gitlab,bitbucket}` | Signature auth, see below                                                           |

### Triage rules

- Must be a legal `canTransition` move, else 400.
- `accepted_risk` needs a future `expiresAt` and creates an `Exception` (approver = caller).
- `false_positive` needs a non-blank `reason` and creates an `Exception`.
- The exception and the status change are written in one `store.tx`.
- Every move is recorded in the finding's triage history with the actor and the role used.

### Gate

Runs `evaluateGate` over the project's policy (or a default: block on `confirmed` high and above)
and its exceptions. Only `confirmed` findings can fail it; `needs_validation`, `rejected` and
System 1 output never do. Two lifecycle rules sit on top of the core function:

- an `accepted_risk` finding whose exception has expired counts as open again;
- an exception stops applying once the finding was triaged back to `confirmed` after it.

### Webhooks

The project is found by `?projectId=`, `?project=<slug>`, or the repository URL in the payload.
The request must then carry a valid signature for that project's secret:

- GitHub: `X-Hub-Signature-256: sha256=<HMAC-SHA256(body)>`
- Bitbucket Server: `X-Hub-Signature: sha256=<HMAC-SHA256(body)>`
- GitLab: `X-GitLab-Token: <secret>`

Unknown project, missing secret and bad signature are all the same 401. Push (branch or tag) and
pull/merge request events start a `focused` run with `trigger.kind = webhook`; pings, branch
deletions, closed PRs and other events return 202 `{ "status": "ignored" }`.

## Roles and access (RBAC)

Roles come from the token (`roles`, Keycloak `realm_access.roles`, or `role`). A token without any
recognised role is rejected with 403. Admin is allowed everywhere.

| Endpoint                                               | Viewer |     Developer     | Security | DevOps | Admin |
| ------------------------------------------------------ | :----: | :---------------: | :------: | :----: | :---: |
| `GET` projects, runs, events, findings, policies, gate |   ✔    |         ✔         |    ✔     |   ✔    |   ✔   |
| `POST /projects`, `PATCH /projects/:id`                |   ✘    |         ✘         |    ✘     |   ✔    |   ✔   |
| `POST /runs`, `POST /runs/:id/cancel`                  |   ✘    |         ✘         |    ✘     |   ✔    |   ✔   |
| `POST /findings/:id/triage` → `in_progress`/`fixed`    |   ✘    | ✔ (own team only) |    ✔     |   ✘    |   ✔   |
| `POST /findings/:id/triage` → any other status         |   ✘    |         ✘         |    ✔     |   ✘    |   ✔   |
| `GET /review-queue`                                    |   ✘    |         ✘         |    ✔     |   ✘    |   ✔   |
| `PUT /policies/:id`                                    |   ✘    |         ✘         |    ✔     |   ✘    |   ✔   |

Denied means 403. "Own team" means `token.team` equals the project's `team`. The matrix is
enforced by `requireRoles` and the triage handler, and tested table-driven in `test/rbac.test.ts`.

## Client isolation

Every store call receives the caller's `AccessScope` (`clientIds` claim: a list, or `"*"`).
Resources of another client answer **404**, never 403, so their existence is not revealed. A missing
or malformed `clientIds` claim means no access, not "all clients". Policies carry no client in the
contract, so a scoped caller sees a policy only while it is attached to one of their projects
(see `docs/workstreams/WS2-contract-request.md`). Tests: `test/isolation.test.ts`.

## Authentication

Bearer JWTs are verified with `jose` (signature via JWKS, issuer, audience, expiry). Claims map to
`{ subject, roles: Role[], clientIds: string[] | "*", team? }`. With `AUTH_DEV_MODE=true` (never in
production) the static tokens `dev-admin`, `dev-security`, `dev-devops`, `dev-developer`
(team `team-alpha`), `dev-viewer` and `dev:<base64 JSON>` are accepted.

## Audit log

Every mutating request (POST, PUT, PATCH, DELETE), including denied and failed ones, writes one
structured log line:

```json
{
  "audit": {
    "actor": "sub-123",
    "action": "finding.triage",
    "target": "<finding id>",
    "status": 200,
    "at": "2026-11-07T12:00:00.000Z",
    "details": { "from": "new", "to": "in_progress" }
  }
}
```

Webhooks use the actor `webhook:<provider>`.

## Scripts

`pnpm build`, `pnpm start`, `pnpm dev`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm openapi`.
