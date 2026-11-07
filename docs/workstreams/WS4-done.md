# WS4 Workstream Completion Report: Model Adapters

- **Workstream**: WS4 (Model adapters)
- **Branch**: `ws/WS4`
- **Package**: `packages/adapters`
- **Owner**: Worker WS4

---

## 1. Complete

All deliverables and acceptance criteria in `docs/workstreams/WS4.md` are implemented and verified:

1. **Model Adapters (`packages/adapters/src/adapters/`)**:
   - `jev`: System 1 decision-only adapter. Posts minimal payload (`prompt` and `context` only) to `JEV_API_URL`. Returns calibrated `JevDecision` with pinned `modelVersion`. Rejects `generate()` with `ModelAdapterError("unsupported")`. Rejects invalid schemas with `ModelAdapterError("invalid_output")`.
   - `rules`: Deterministic System 1 fallback when Jev is not configured. Evaluates path patterns and keyword heuristics over `subject.context` (auth, filters, interceptors, CI/CD, IaC, user input). Supports binary, choice, and rating questions. Rejects `generate()` with `unsupported`.
   - `gemini`: Google Gemini generative adapter (Gemini 1.5, 2.0, Argon). Translates system instructions and JSON schemas (`responseSchema`, `responseMimeType`). Detects prompt and candidate safety blocks (`SAFETY`, `RECITATION`) and maps to `safety_blocked`. Calculates token usage and USD cost from price table. Rejects `decide()` with `unsupported`.
   - `claude`: Anthropic Messages API (`/v1/messages`). Translates system prompt and messages. Maps refusal stop reasons to `safety_blocked`. Computes input/output token usage and USD cost. Rejects `decide()` with `unsupported`.
   - `openai_compat`: Standard OpenAI chat completions (`/v1/chat/completions`) supporting OpenAI, vLLM, DeepSeek. Supports `json_schema` response format, detects `content_filter` safety finish reasons, and accounts for token usage/cost. Rejects `decide()` with `unsupported`.
   - `local`: Self-hosted offline inference supporting Ollama native chat API (`/api/chat`, `/api/tags` health check) and vLLM (via OpenAI-compatible delegation with `selfHosted: true`). Token cost is always 0 USD. Rejects `decide()` with `unsupported`.
   - `mock`: Scriptable deterministic adapter for unit and integration testing across other packages. Supports canned generate text, canned decision probabilities/distributions, forced health states, and scripted sequential failures (`failNext()`, e.g. failing with `quota_exceeded` on first call). Supports both `generate()` and `decide()`.

2. **Error Mapping (`packages/adapters/src/http.ts`)**:
   - HTTP 429: Discriminated by response body text. Bodies containing `quota`, `insufficient_quota`, `resource_exhausted`, `billing`, or `exceeded your current quota` map to `quota_exceeded`. Other 429s map to `rate_limited`.
   - HTTP 401 → `auth_failed`.
   - HTTP 403 → `permission_denied`.
   - HTTP 5xx → `unavailable`.
   - Safety blocks in body or status → `safety_blocked`.
   - Timeouts / Aborts → `timeout`.
   - `Retry-After` header: Supports integer seconds, HTTP-date (RFC 7231), and `retry-after-ms` into `error.retryAfterMs`.

3. **Retries with Exponential Backoff (`packages/adapters/src/http.ts`)**:
   - Bounded exponential backoff with jitter on `rate_limited`, `timeout`, and `unavailable`.
   - Configurable retry parameters (`maxRetries`, `initialDelayMs`, `maxDelayMs`, `backoffFactor`). Default: 2 retries.
   - Non-retryable errors (`auth_failed`, `permission_denied`, `safety_blocked`, `quota_exceeded`, `unsupported`, `invalid_output`) fail immediately without retry.
   - Respects caller-cancelled `AbortSignal` without retrying.

4. **Usage & Pricing Accounting (`packages/adapters/src/pricing.ts`)**:
   - Token counts extracted directly from provider responses (`promptTokenCount`/`candidatesTokenCount`, `input_tokens`/`output_tokens`, `prompt_tokens`/`completion_tokens`, `prompt_eval_count`/`eval_count`).
   - Price table (`TokenPricing` per 1M tokens) with exact matching, case-insensitive matching, prefix matching, and default fallback.
   - Defaults to 0 USD for self-hosted or unconfigured models.

5. **Health & Capabilities**:
   - Lightweight `health()` checks on every adapter (reporting latency, model lists, and status).
   - `capabilities(model?)` accurately reflecting `generate`, `decide`, `toolUse`, `parallelSubAgents`, `maxContextTokens`, and `selfHosted`.

6. **Registry & Environment Configuration (`packages/adapters/src/registry.ts`)**:
   - `createAdapterRegistry(config)` implements `AdapterRegistry`. Validates with Zod. Registers offline adapters (`mock`, `rules`, `local`) by default; keyed adapters (`gemini`, `claude`, `jev`, `openaiCompat`) registered only when credentials or endpoints are provided. Throws `ModelAdapterError("unavailable")` when resolving an unregistered adapter.
   - `configFromEnv(env)` derives registry config from standard environment variables (`JEV_API_URL`, `JEV_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `LOCAL_MODEL_PROVIDER`, `LOCAL_MODEL_BASE_URL`).

7. **Shared Contract Test Suite (`packages/adapters/test/contract.ts`)**:
   - Exported from `@sdap/adapters/contract` and `@sdap/adapters/test/contract`.
   - Tests every adapter with a local `node:http` mock server.
   - Validates happy paths, usage accounting, each HTTP error mapping, retry recovery, timeout handling, and health reporting.
   - Validates Jev minimal data egress (HTTP body contains only `prompt` and `context`, no extra fields).

8. **Package Documentation & Hygiene**:
   - `packages/adapters/README.md` updated with architecture overview, configuration table per adapter, error mapping guide, retry policy, and usage accounting documentation.
   - Zero ESLint warnings or errors, zero TypeScript errors, Prettier formatting clean.

---

## 2. Mocked

- All tests operate offline using ephemeral local `node:http` servers and simulated response fixtures. No real network calls are made and no live API keys exist in the repository.
- `MockAdapter` is provided and exported for use by other workstreams (WS1 orchestrator, WS2 API, WS3 normalizer) to script deterministic outputs and failure cascades.

---

## 3. Deferred

- **Agent-CLI adapters (`agent-cli:*`)**: Out of scope for WS4; owned by WS1 as defined in `docs/workstreams/WS4.md`.
- **Response streaming**: Explicitly out of scope for Phase 1 as defined in `docs/workstreams/WS4.md`.

---

## 4. Contract Status

- No contract additions or modifications were needed in `@sdap/core`. All contracts provided in `@sdap/core/src` (`ModelAdapter`, `ModelCapabilities`, `GenerateRequest`, `GenerateResult`, `HealthStatus`, `ModelAdapterError`, `ModelErrorCode`, `JevQuestion`, `JevDecision`, `AdapterRegistry`, `ModelRef`, `Usage`) were fully sufficient and followed without deviation.
- No `docs/workstreams/WS4-contract-request.md` was required.
