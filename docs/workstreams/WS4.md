# WS4 Model adapters

- **Runner / model:** agy / `gemini-4-argon-high` (fallback claude / `claude-sonnet-5-5`)
- **Branch:** `ws/WS4`
- **Paths:** `packages/adapters/**`
- **Consumes (core):** `ModelAdapter`, `ModelCapabilities`, `GenerateRequest`, `GenerateResult`,
  `HealthStatus`, `ModelAdapterError`, `ModelErrorCode`, `JevQuestion`, `JevDecision`,
  `AdapterRegistry`, `ModelRef`, `Usage`

## Goal

One TypeScript package with an adapter per provider behind the core `ModelAdapter` interface.
Provider-neutral: no default requires a paid account; the mock adapter works offline.

## Deliverables

1. Adapters (each in its own module, using `fetch`; SDKs optional but keep deps small):
   - `jev`: **decide only**. Posts a `JevQuestion` to `JEV_API_URL` and returns a `JevDecision`
     with pinned `modelVersion`. Sends only `question.prompt` and `question.subject.context`
     (minimal data). `generate()` throws `unsupported`.
   - `rules` (System 1 fallback without Jev): deterministic `decide()` from path rules and keyword
     heuristics over `subject.context` (e.g. touches auth/filter/interceptor/CI/IaC paths).
     `source: "rules"`. Used when Jev is not configured.
   - `gemini` (incl. Argon models), `claude` (Anthropic Messages API), `openai_compat`
     (chat completions; base URL configurable, covers vLLM), `local` (Ollama `/api/chat`, and
     vLLM via openai_compat). `decide()` throws `unsupported` for generative adapters.
   - `mock`: deterministic, configurable responses and decisions, scripted failures
     (e.g. fail with `quota_exceeded` on first call) for tests in other packages.
2. **Error mapping**: HTTP 429 → `rate_limited` or `quota_exceeded` (by body), 401/403 →
   `auth_failed`/`permission_denied`, provider safety blocks → `safety_blocked`, timeouts →
   `timeout`, 5xx → `unavailable`. `retryAfterMs` from `Retry-After`.
3. **Retries**: bounded exponential backoff with jitter on `rate_limited`/`timeout`/`unavailable`
   inside the adapter (configurable, default 2 retries); never on safety/auth.
4. **Usage and cost**: token counts from provider responses; a price table (per 1M tokens,
   configurable, empty by default for self-hosted) → `costUsd`.
5. `health()` per adapter (lightweight list-models or tiny request); `capabilities(model)`.
6. `createAdapterRegistry(config)` implementing `AdapterRegistry`, building adapters from a Zod-
   validated config object (env-derived helper `configFromEnv()`); adapters without keys are not
   registered (except `mock`, `rules`, `local`).

## Acceptance criteria

- A **shared contract test suite** (`test/contract.ts`, exported for reuse) that every adapter
  passes using a local mock HTTP server (`node:http`), covering: happy path, usage accounting,
  each error mapping, retry then success, timeout via `AbortSignal`, `health()`.
- Jev test: the HTTP body contains only prompt + context (no extra fields), decision parses with
  `JevDecision`.
- No real network in tests. No API keys in the repo.
- `pnpm -r typecheck lint test` green. README with a config table per adapter.

## Out of scope

Agent-CLI adapters (`agent-cli:*`, WS1), streaming.
