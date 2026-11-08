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

## D-011 Container runtime is Podman

Docker Desktop and OrbStack are not installed; a Podman machine is. → Docker CLI and tests use
`DOCKER_HOST=unix://<podman machine socket>`. `docker compose` is not installed; Phase 2 uses
`podman compose` or installs the compose plugin.

## D-012 Default worker model: Gemini 3.8 Flash (High)

The maintainer reported a tight Claude quota. → Every worker defaults to agy /
`gemini-3.8-flash-high`, overriding the primary column of the routing table. Claude is reserved for
the lead (integration, review, contracts). The cross-family review rule still applies: Flash-
authored code is reviewed by the lead (Claude) before merge.

## D-013 agy workers run headless with a scoped allowlist

The Orca-supervised agy TUI did not reach readiness, and headless agy cannot prompt for command
permission (`--mode auto` is unavailable on this account). → Each worker runs `agy -p` as its own
process in its own worktree with `--settings` granting a scoped allowlist (pnpm, node, read-only
shell tools, git add/commit/diff/log/status; docker/podman for WS8 only) and denying push, branch
switching, reset/merge/rebase, network fetchers and sudo. Permissions are never bypassed wholesale.

Update: file tools need a target rule. Globs (`/**`, `**`) do not match; a directory prefix does.
Each worker gets its own settings file granting file tools only on its own worktree
(`write_file(<worktree dir>)` and so on) and read access to its spec. Specs tell workers to run one
command per call without `PATH=` prefixes; the runner exports Node 24 on PATH.

## D-014 Claude available again: return to the routing table

The maintainer reported Claude capacity is back. → Running Flash workers finish their current pass
(restarting would discard work). New launches and relaunches follow the section B routing table.
Claude-routed work runs as Orca-supervised `claude` workers, which appear in Orca's UI. WS8
(security-critical) gets an Opus review-and-harden pass on its branch before merge.

## D-015 Lead handoff from Claude to agy (Antigravity)

Phase 1 closed under Claude Opus (`phase-1`, 555 tests green). The maintainer directed continuation and takeover from Claude to agy for Phase 2 integration and onward.
→ `agy` (Gemini 3.8 Flash High / Gemini 4 Argon High) takes over as the Lead Orchestrator for Phase 2 integration, contract reconciliation, builds, and merges.
Consequences:

- Phase 2 WS2 contract requests applied cleanly across `@sdap/core`, `@sdap/api`, `@sdap/worker`, and `@sdap/web` (`webhookSecretRef`, `clientId` on Policy, `revokeException`, `appendNext`, `ping`).
- `apps/worker` receives its production entrypoint `src/main.ts` with Prometheus metrics server, real adapter registry, and graceful signal handling.
- Worker test fakes moved out of `src/` to `test/fakes.ts` to prevent production leakage.
- Prometheus `/metrics` mounted in `apps/api` via `systemRoutes`.
- All workspace packages build, typecheck, lint, and test 100% green under Node 24.

## D-016 Dashboard redesign: build-time Tailwind, self-hosted fonts and icons

The Stitch exports load the Tailwind Play CDN, Google Fonts and the Material Symbols font at runtime. That would add third-party requests to a self-hosted product that promises no telemetry and no SaaS dependency.
→ Tailwind v4 (`@tailwindcss/vite`) compiles at build time; Inter, JetBrains Mono, Public Sans and Material Symbols come from npm (`@fontsource*`, `material-symbols`) and are bundled.
→ The legacy stylesheet moves into `@layer legacy` (below utilities) instead of being deleted, so screens migrate without a flag day. Dark mode overrides the colour tokens rather than adding `dark:` classes.
Consequences: the Material Symbols font adds about 4 MB to `dist` (see follow-ups); the legacy CSS stays until the older `components/ui` primitives are re-based.

## D-017 The redesign shows only what the platform can back

Several Stitch panels were static mock content. Where the platform has no backing capability, the UI says so instead of imitating it:

- Sandbox terminal is a labelled simulation built from the finding's trace. "Mark Verified Exploit" is omitted: only System 2 verification confirms a finding.
- Framework cards (SOC 2, ISO 27001, PCI-DSS) show indicative signals computed from the scope (SLA adherence, audit coverage, serious findings fixed), labelled as not a compliance determination.
- Slack, PagerDuty and Jira appear as "Not connected"; outbound notifications are not in v0.1. Inbound webhook secret status is real (`webhookSecretRef`).
- Policy mode is shown read-only: policy is code and changes through a reviewed commit.
- Review-queue Accept and Reject call the real triage API; Reject requires a reason, as the API does.
