# WS5 Web dashboard

- **Runner / model:** agy / `gemini-4-argon-high` (fallback claude / `claude-sonnet-5-5`)
- **Branch:** `ws/WS5`
- **Paths:** `apps/web/**`
- **Consumes (core):** `Finding`, `Run`, `RunPhase`, `Slice`, `Project`, `Policy`, `Exception`,
  `GateResult`, `FindingQuery`, `FindingPage`, `RunPage`, `TriageRequest`, `TriageEvent`,
  `PlatformEvent`, `SEVERITY_RANK`, `TRIAGE_TRANSITIONS`

## Goal

The primary dashboard for Security and DevOps (PRD 5.6), React + Vite, talking to the API
(`/api/v1`, see WS2 card for endpoints).

## Deliverables

1. Typed API client in `src/api/` that validates responses with the core Zod schemas, and a
   **mock API** (MSW or a fetch shim) with synthetic fixtures so the app runs with no backend
   (`pnpm dev:mock`).
2. Screens (React Router):
   - **Org overview**: open findings by verified severity and verdict, SLA breaches, mean time to
     remediate, trend over time, cross-project attack-class view.
   - **Project view**: run history, coverage ledger summary, open findings, gate status.
   - **Run timeline**: phases and slices with status, duration, **model used per attempt**
     (fallbacks visible), token cost, validator status, links to reports; live updates from the
     SSE events endpoint.
   - **Finding detail**: source trace (entrypoint → sink), evidence, verifier result,
     **original vs verified severity side by side**, triage history, model + phase label on all
     AI output, System 1 suggestions labelled "advisory", fix draft labelled "draft".
   - **Review queue**: open `needs_validation` items with their blockers.
   - **Policy and exceptions**: policy mode/rules, exceptions with approver and expiry.
   - **Release readiness**: per project gate result; only confirmed findings shown as blocking.
   - **Audit export**: Markdown and CSV client-side; PDF via print stylesheet.
3. Triage actions respect `TRIAGE_TRANSITIONS` (disabled options otherwise).
4. Rejected findings hidden by default with a toggle.
5. Accessible (labels, keyboard, contrast), works at 1280px and 375px widths, light/dark.
   Keep dependencies modest (no heavy UI kit required; a small chart lib is fine).

## Acceptance criteria

- Renders every screen against the mocked API (component tests with Vitest +
  Testing Library, `jsdom` environment for those files).
- **Playwright smoke tests** (`apps/web/e2e/`) against `vite preview` with the mock API:
  overview loads, open a finding, triage it, review queue lists needs_validation items.
  Playwright tests are a separate script (`pnpm e2e`), not part of `pnpm test`.
- `pnpm -r typecheck lint test` and `pnpm --filter @sdap/web build` green. README with
  screenshots-free description of screens and how to run with the mock API.

## Out of scope

Auth UI beyond attaching a bearer token from config/OIDC redirect stub; the API itself.
