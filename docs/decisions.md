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

## D-018 Honest sign-in: bearer token or demo mode

The API accepts only OIDC bearer JWTs, but the SPA sent none and had no sign-in or profile. Added `/login` and `/profile`, a route guard, a user menu and a theme switch.

- Against a real API, the user pastes an access token. It is kept in `sessionStorage` (per tab), sent as `Authorization: Bearer`, and a 401 ends the session.
- Under the mock API only, "Continue in demo mode" signs in a labelled demo user. The demo user is never available when `VITE_API_BASE_URL` is set.
- The SPA decodes token claims for display only (name, roles, team, client scope, expiry). It never trusts them; the API verifies the token and enforces RBAC and client scope on every request.
- Profile is read-only: identity and roles belong to the identity provider.

Consequences: `sessionStorage` is readable by any script on the page, so an XSS would expose the token. Mitigated by the strict CSP and no third-party scripts; the proper fix is an OIDC authorization-code flow with PKCE (see follow-ups).

## D-019 Native accounts for public hosting (supersedes the sign-in part of D-018)

D-018 assumed an external identity provider. Running the platform on a public domain needs accounts that do not depend on one, so the API can now manage them. It is opt-in (`AUTH_NATIVE=true`) and sits beside OIDC: a token that starts with `sdap_` goes to the account store, anything else to the OIDC or dev verifier.

- **Accounts:** email + password (scrypt, 10+ characters), email verification and password reset by single-use links, sign-out everywhere on reset or password change, lockout after five failures and a per-address rate limit. Responses for sign-up, reset and login do not reveal whether an address exists.
- **Sessions and tokens:** opaque secrets (`sdap_s_…` sessions, `sdap_pat_…` API tokens), stored only as SHA-256, revocable, with a sliding expiry for sessions. An API token can only narrow its owner's roles. The browser keeps the session in `localStorage` so it survives tabs; the web server sends a strict CSP to reduce the XSS risk this carries.
- **Google and GitHub:** authorization code flow with PKCE. State is a signed, 10-minute JWT bound to an HttpOnly cookie, so a callback from another browser fails. The browser receives a one-time code, never the session, and exchanges it. Identities are keyed by the provider's account id; an existing account is matched only on an address the provider verified.
- **Access:** the first account (or `BOOTSTRAP_ADMIN_EMAIL`) becomes admin with every client. Later sign-ups get `SIGNUP_DEFAULT_ROLE` and no clients, so a stranger sees no data until an admin grants some. Admins manage roles, client scope and team, invite people, and read an account audit log. The last admin cannot be demoted, disabled or deleted.
- **Not done:** SAML, MFA/TOTP, per-project membership (access is by client id), session cookies instead of bearer tokens, and OpenAPI entries for the new routes (see follow-ups).

Consequences: the API now stores credentials, so it needs HTTPS, a strong `AUTH_SECRET`, SMTP for verification, and backups of the account tables. Hosts that prefer an identity provider keep using OIDC unchanged.
