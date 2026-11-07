# Build plan

Companion to [PRD.md](PRD.md). Sections B to D were supplied by the maintainer with the build
brief. The lead keeps this file in sync with what actually runs; deviations are logged in
[build-log.md](build-log.md) and [decisions.md](decisions.md).

Phases: 0 foundation (lead) → 1 parallel build WS1–WS8 → 2 integration → 3 hardening WS9–WS11
→ 4 release candidate `v0.1.0-rc.1`. Max parallel workers per phase: **4**. Each worker runs as
its own process in its own Orca worktree on branch `ws/<id>`.

## B. Model routing

| Workstream / task                                                     | Primary                       | Runner     | Fallback          | Why                                                             |
| --------------------------------------------------------------------- | ----------------------------- | ---------- | ----------------- | --------------------------------------------------------------- |
| Lead: plan, contracts, merges, integration                            | Claude Opus 5.5               | claude     | Claude Sonnet 5.5 | Architecture judgment, cross-package consistency                |
| WS1 Orchestrator + skill runner (worker app)                          | Claude Opus 5.5               | claude     | Gemini 4 Argon    | Hardest logic: phases, parallel slices, retries, fallback chain |
| WS2 API (Fastify, auth, RBAC, policy)                                 | Claude Sonnet 5.5             | claude     | Gemini 4 Argon    | Solid backend CRUD + auth                                       |
| WS3 Normalizer + findings store (Drizzle, dedup, fingerprints)        | Claude Sonnet 5.5             | claude     | Gemini 4 Argon    | Schema-heavy, needs precision                                   |
| WS4 Model adapters (Jev, Gemini, Claude, OpenAI-compat, local)        | Gemini 4 Argon                | agy        | Claude Sonnet 5.5 | Many similar SDK wrappers, broad docs reading                   |
| WS5 Web dashboard (React + Vite)                                      | Gemini 4 Argon                | agy        | Claude Sonnet 5.5 | Large UI surface, many screens                                  |
| WS6 CLI + CI integrations                                             | Gemini 3.8 Flash              | agy        | Claude Haiku 5.5  | Templates and glue, cheap                                       |
| WS7 Observability + deploy (prom-client, Grafana JSON, compose, Helm) | Gemini 3.8 Flash              | agy        | Claude Sonnet 5.5 | Config-heavy, pattern-based                                     |
| WS8 Sandbox runner (gVisor/Firecracker profile, egress block)         | Claude Opus 5.5               | claude     | Claude Sonnet 5.5 | Security-critical isolation                                     |
| Phase 2 integration helper                                            | Claude Sonnet 5.5             | claude     | Gemini 4 Argon    | Debugging across packages                                       |
| WS9 Test coverage + e2e                                               | Gemini 3.8 Flash              | agy        | Claude Haiku 5.5  | High-volume test writing                                        |
| WS10 Security self-review of the platform                             | Claude Opus 5.5               | claude     | Gemini 4 Argon    | Different model than the code's main author                     |
| WS11 Docs + OSS hygiene                                               | Claude Sonnet 5.5             | claude     | Gemini 3.8 Flash  | Clear writing                                                   |
| Code review of each workstream before merge                           | Opposite family of the author | claude/agy | -                 | Cross-family review catches more                                |

Concrete model ids used on this host (from `agy models` and the preflight):

| Name              | claude runner       | agy runner                                              |
| ----------------- | ------------------- | ------------------------------------------------------- |
| Claude Opus 5.5   | `claude-opus-5-5`   | `claude-opus-5-5-high`                                  |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | `claude-sonnet-5-5-medium` (quota-limited at preflight) |
| Claude Haiku 5.5  | `claude-haiku-5-5`  | n/a                                                     |
| Gemini 4 Argon    | n/a                 | `gemini-4-argon-high`                                   |
| Gemini 3.8 Flash  | n/a                 | `gemini-3.8-flash-medium`                               |

Claude fallbacks always run on the `claude` runner; Gemini fallbacks on `agy`.

## C. Workstream task cards

Full cards with acceptance criteria live in [workstreams/](workstreams/). Summary:

| WS   | Title                       | Paths                                                                             |
| ---- | --------------------------- | --------------------------------------------------------------------------------- |
| WS1  | Orchestrator + skill runner | `apps/worker/**` (except `src/metrics.ts`)                                        |
| WS2  | API                         | `apps/api/**` (except `src/db/**`, `src/metrics.ts`)                              |
| WS3  | Normalizer + store          | `packages/normalizer/**`, `apps/api/src/db/**`                                    |
| WS4  | Model adapters              | `packages/adapters/**`                                                            |
| WS5  | Web dashboard               | `apps/web/**`                                                                     |
| WS6  | CLI + CI                    | `packages/cli/**`, `deploy/ci/**`                                                 |
| WS7  | Observability + deploy      | `deploy/**` (except `deploy/ci/**`, `deploy/sandbox/**`), `apps/*/src/metrics.ts` |
| WS8  | Sandbox runner              | `packages/sandbox/**`, `deploy/sandbox/**`                                        |
| WS9  | Tests                       | tests anywhere, `fixtures/**`, `e2e/**`                                           |
| WS10 | Security self-review        | findings report + fixes via lead                                                  |
| WS11 | Docs + OSS hygiene          | `docs/**`, root community files                                                   |

## D. Worker prompt template

```
You are a worker on workstream {{WS_ID}} of the SecDevOps Audit Platform.
Read docs/PRD.md, docs/workstreams/{{WS_ID}}.md and packages/core (the contracts).

- Work only in: {{PATHS}}. Do not change packages/core; if a contract is missing or wrong,
  write the proposal in docs/workstreams/{{WS_ID}}-contract-request.md and stop that part.
- TypeScript strict, Zod at boundaries, tests with Vitest. No secrets, no real client data.
- Done means: acceptance criteria met, `pnpm -r typecheck lint test` green for your packages,
  README for your package, short summary in docs/workstreams/{{WS_ID}}-done.md listing
  what is complete, mocked, or deferred.
- Commit on branch ws/{{WS_ID}} with Conventional Commits. Do not merge.
```
