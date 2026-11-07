# Workstreams

One card per workstream. Each worker runs as its own process in its own Orca worktree on branch
`ws/<id>`, branched from `main` after the task-card commit (tag `phase-0` marks the foundation).

| Card                                      | Phase | Runner / model (fallback)                                  |
| ----------------------------------------- | ----- | ---------------------------------------------------------- |
| [WS1](WS1.md) Orchestrator + skill runner | 1     | claude / claude-opus-5-5 (agy / gemini-4-argon-high)       |
| [WS2](WS2.md) API                         | 1     | claude / claude-sonnet-5-5 (agy / gemini-4-argon-high)     |
| [WS3](WS3.md) Normalizer + store          | 1     | claude / claude-sonnet-5-5 (agy / gemini-4-argon-high)     |
| [WS4](WS4.md) Model adapters              | 1     | agy / gemini-4-argon-high (claude / claude-sonnet-5-5)     |
| [WS5](WS5.md) Web dashboard               | 1     | agy / gemini-4-argon-high (claude / claude-sonnet-5-5)     |
| [WS6](WS6.md) CLI + CI                    | 1     | agy / gemini-3.8-flash-medium (claude / claude-haiku-5-5)  |
| [WS7](WS7.md) Observability + deploy      | 1     | agy / gemini-3.8-flash-medium (claude / claude-sonnet-5-5) |
| [WS8](WS8.md) Sandbox runner              | 1     | claude / claude-opus-5-5 (claude / claude-sonnet-5-5)      |

## Rules for every worker

- Read `docs/PRD.md`, your card, and `packages/core` (the contracts) first.
- Edit only your card's paths. You may add tests anywhere. Never edit `packages/core`.
  If a contract is missing or wrong, write `docs/workstreams/<WS>-contract-request.md`
  (what, why, proposed Zod) and continue with a local type marked `// TODO(contract)`.
- Your branch must be green on its own: `pnpm install && pnpm -r typecheck && pnpm -r lint && pnpm -r test`.
  Use `PATH=/opt/homebrew/opt/node@24/bin:$PATH` (Node 24).
- Do not import code from another Phase 1 workstream's branch. Code against the interfaces in
  core (`Store`, `SandboxRunner`, `AdapterRegistry`, `ModelAdapter`, `EventSink`) and use fakes.
- TypeScript strict, Zod at every boundary, Vitest. No `any` without a comment explaining why.
- Never commit secrets; only `.env.example`. No real client names, paths or code anywhere.
- Package README updated. Write `docs/workstreams/<WS>-done.md`: complete / mocked / deferred.
- Do not edit root files (`package.json`, `tsconfig.base.json`, `eslint.config.js`, CI) except
  where your card says so. Commit your `pnpm-lock.yaml` changes; the lead regenerates the lockfile
  when merging.
- Small Conventional Commits on `ws/<id>`. Do not merge, do not push.
