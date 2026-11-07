# @sdap/adapters

Provider-neutral model adapters behind the core `ModelAdapter` interface for the SecDevOps Audit Platform.

Owner: workstream **WS4** (see `docs/workstreams/WS4.md`).

## Overview

The platform uses two AI modes:

- **System 1 (Decision Models)**: High-speed, narrow, typed decisions with calibrated probabilities. Never generates free text; `generate()` throws `unsupported`.
  - `jev`: Connects to TypeSafe AI's hosted Jev API. Sends only `prompt` and `context` (minimal data egress).
  - `rules`: Deterministic fallback when Jev is not configured. Evaluates path patterns and keyword heuristics (auth, filters, interceptors, CI/CD, IaC).
- **System 2 (Generative Models)**: Full deep audits, code reasoning, and evidence verification. `decide()` throws `unsupported`.
  - `gemini`: Google Gemini API, including Gemini 1.5, 2.0, and Argon models.
  - `claude`: Anthropic Messages API (`/v1/messages`).
  - `openai_compat`: Standard OpenAI Chat Completions API (`/v1/chat/completions`), also compatible with vLLM, DeepSeek, and other providers.
  - `local`: Self-hosted local execution via Ollama native chat API (`/api/chat`) and vLLM (via OpenAI-compatible endpoint). Always 0 USD token cost.
  - `mock`: Scriptable deterministic adapter for offline testing across other packages.

## Configuration Table

The adapter registry can be initialized using `createAdapterRegistry(config)` or auto-configured from environment variables using `configFromEnv()`. Keyed adapters without API keys or endpoints are omitted from the registry (offline-first adapters `mock`, `rules`, and `local` are always registered).

| Adapter         | Primary Env Vars                                                    | Optional Env / Config Options                                            | Default Endpoint / Model                                              | Supported Methods                    | Description                                                                                 |
| --------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `jev`           | `JEV_API_URL`, `JEV_API_KEY`                                        | `JEV_MODEL`, `JEV_MODEL_VERSION`, `timeoutMs`, `retry`                   | `jev-1` / `2026-11-01`                                                | `decide()`, `health()`               | System 1 decision engine. Sends minimal data (`prompt` + `context`).                        |
| `rules`         | _(None required)_                                                   | `model`, `modelVersion`                                                  | `deterministic-rules` / `1.0.0`                                       | `decide()`, `health()`               | Deterministic System 1 fallback using path rules and keyword heuristics.                    |
| `gemini`        | `GEMINI_API_KEY`                                                    | `GEMINI_BASE_URL`, `prices`, `timeoutMs`, `retry`                        | `https://generativelanguage.googleapis.com`                           | `generate()`, `health()`             | Google Gemini & Argon generative models. Translates system instruction and response schema. |
| `claude`        | `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY`                              | `ANTHROPIC_BASE_URL`, `anthropicVersion`, `prices`, `timeoutMs`, `retry` | `https://api.anthropic.com`                                           | `generate()`, `health()`             | Anthropic Messages API. Handles system prompts and stop reasons.                            |
| `openai_compat` | `OPENAI_API_KEY`, `OPENAI_BASE_URL`                                 | `prices`, `timeoutMs`, `retry`, `selfHosted`                             | `https://api.openai.com/v1`                                           | `generate()`, `health()`             | OpenAI chat completions and compatible servers (vLLM, Ollama, etc.).                        |
| `local`         | `LOCAL_MODEL_PROVIDER` (`ollama` \| `vllm`), `LOCAL_MODEL_BASE_URL` | `prices`, `timeoutMs`, `retry`                                           | Ollama: `http://localhost:11434`<br/>vLLM: `http://localhost:8000/v1` | `generate()`, `health()`             | Self-hosted offline inference. Token cost is 0 USD.                                         |
| `mock`          | `MOCK_ADAPTER_ENABLED`                                              | `cannedText`, `cannedProbability`, scripted failures                     | In-memory                                                             | `generate()`, `decide()`, `health()` | Scriptable mock adapter supporting deterministic responses and scripted failures.           |

## Error Mapping & Resiliency

All HTTP status codes and provider errors are mapped to `@sdap/core`'s `ModelAdapterError`:

- **HTTP 429**: Discriminated by response body:
  - If body contains `"quota"`, `"insufficient_quota"`, `"resource_exhausted"`, `"exceeded your current quota"`, `"billing"` → `quota_exceeded`
  - Otherwise → `rate_limited`
- **HTTP 401**: Mapped to `auth_failed`
- **HTTP 403**: Mapped to `permission_denied`
- **HTTP 5xx**: Mapped to `unavailable`
- **Provider Safety Filters**: Mapped to `safety_blocked` (e.g. Gemini `SAFETY` finish reason, Anthropic `refusal`, OpenAI `content_filter`)
- **Timeouts / Aborts**: Mapped to `timeout`
- **Retry-After Header**: Automatically parsed from `Retry-After` (integer seconds or HTTP date) or `retry-after-ms` into `error.retryAfterMs`.

### Retry Policy

Adapters perform bounded exponential backoff with jitter internally:

- Retryable error codes: `rate_limited`, `timeout`, `unavailable`.
- Non-retryable error codes: `auth_failed`, `permission_denied`, `safety_blocked`, `quota_exceeded`, `unsupported`, `invalid_output`.
- Maximum retries: configurable per adapter (default 2 retries).

## Usage & Cost Accounting

Tokens are extracted directly from provider response metadata:

- Input tokens (`promptTokenCount` / `input_tokens` / `prompt_tokens` / `prompt_eval_count`)
- Output tokens (`candidatesTokenCount` / `output_tokens` / `completion_tokens` / `eval_count`)
- Cost in USD is calculated from a configurable `PriceTable` (pricing per 1,000,000 tokens). Defaults to 0 USD for self-hosted or unconfigured models.

## Shared Contract Test Suite

The contract test suite is exported from `@sdap/adapters/contract` (or `@sdap/adapters/test/contract`):

- `describeGenerativeAdapterContract(options)`
- `describeDecisionAdapterContract(options)`
- `createMockServer()`: Node.js `node:http` mock server for testing adapters without network access or live API keys.

## Scripts

- `pnpm build`: compile TypeScript to `dist/`
- `pnpm typecheck`: verify TypeScript types
- `pnpm lint`: verify ESLint rules
- `pnpm test`: execute Vitest test suites
