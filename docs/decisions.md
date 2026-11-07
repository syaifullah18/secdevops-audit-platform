# Decisions

Where the PRD or brief was ambiguous, the simplest option was chosen and recorded here.
Newest last. Format: context → decision → consequence.

## D-001 Toolchain: Node 24 via Homebrew keg, pnpm 12

The host had Node 23.6.1 and a corepack with a stale signing key (fails to fetch pnpm).
→ Install `node@24` (keg-only, does not replace the system default) and pnpm 12.18 from Homebrew.
Build commands prepend `/opt/homebrew/opt/node@24/bin` to `PATH`. `.nvmrc` = 24, `engines.node >= 24`.
pnpm 12 blocks dependency build scripts; `esbuild` is allow-listed in `pnpm-workspace.yaml`.

## D-002 Workspace packages resolve to source through a `source` export condition

Each package exports `{ source: ./src/index.ts, types: ./dist/index.d.ts, default: ./dist/index.js }`.
`tsconfig.base.json` sets `customConditions: ["source"]` and every Vitest config sets the same
condition, so typecheck and tests need no prior build; runtime uses `dist/`.

## D-003 Audit modes

The PRD lists `focused`, `full`, `repeat-N`; the brief lists `focused | incremental | full`.
→ `AuditMode = focused | incremental | full`; repeat-N is `Run.repeat` (1–10, full mode).

## D-004 Worker phases

→ `PhaseName = preflight, recon, hunt, triage, validate, output, record_verify, report`.
`preflight` (model health + permission check) and `triage` (optional Jev) wrap the skill's six
phases without changing them.

## D-005 One ModelRef shape for API models and agent CLIs

→ `ModelRef = { adapter, model }`. The adapter id resolves through a registry. Agent CLIs the
worker spawns (claude, agy) register as adapters named `agent-cli:<runner>`, so fallback chains
can mix API models and agent CLIs.

## D-006 Attack class and CWE come from the platform, not the skill

The skill's `findings.json` has no attack class or CWE. → The normalizer derives `attackClass`
from the coverage ledger unit whose `result_fingerprints` contains the finding, falling back to
`other`. `cwe` is nullable and filled only when known.

## D-007 Path ownership overlaps in the task cards

WS2 owns `apps/api/**` but WS3 owns `apps/api/src/db/**`; WS7 owns `deploy/**` and
`apps/*/src/metrics.ts` but WS6 owns `deploy/ci/**` and WS8 owns `deploy/sandbox/**`.
→ The more specific path wins. To keep each branch green on its own, WS1/WS2 do not import
`./metrics.js` or the Drizzle store: WS2 codes against the `Store` interface in core with an
in-memory fake; WS3 delivers `createPgStore()` in `apps/api/src/db`; WS7 delivers `metrics.ts`
files. The lead wires them together in Phase 2.

## D-008 Events transport

→ Worker publishes `PlatformEvent` JSON on Redis pub/sub channel `sdap:events` and persists each
event (append-only table) for replay. Consumers ignore unknown types.

## D-009 Gate invariant enforced in the type system

→ `GateRule.verdict` is `z.literal("confirmed")` and `evaluateGate` lives in core, shared by API
and CLI, so no policy file can make `needs_validation`, `rejected` or System 1 output block a gate.

## D-010 Agent runner fallback for agy-routed Claude models

Preflight: agy's Claude Sonnet 5.5 quota is exhausted. → Every Claude fallback runs on the
`claude` runner, every Gemini model on `agy`.
