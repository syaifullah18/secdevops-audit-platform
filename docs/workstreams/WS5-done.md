# WS5 Workstream Completion Summary

**Workstream:** WS5 Web dashboard  
**Branch:** `ws/WS5`  
**Paths:** `apps/web/**`  
**Consumes (core):** `Finding`, `Run`, `RunPhase`, `Slice`, `Project`, `Policy`, `Exception`, `GateResult`, `FindingQuery`, `FindingPage`, `RunPage`, `TriageRequest`, `TriageEvent`, `PlatformEvent`, `SEVERITY_RANK`, `TRIAGE_TRANSITIONS`

---

## 1. Status Overview

- **Status:** Complete (DONE)
- **All Deliverables & Acceptance Criteria Met:** Yes
- **Contract Changes:** None required (all shared contracts in `@sdap/core` were fully sufficient and validated with Zod at runtime boundaries).

---

## 2. Deliverables & Implementation

### 1. Typed API Client & Mock Store (`apps/web/src/api/`)

- `src/api/client.ts`: Typed API client validating all incoming request and response payloads with `@sdap/core` Zod schemas (`Project`, `Run`, `RunPage`, `Slice`, `Finding`, `FindingPage`, `TriageEvent`, `Policy`, `Exception`, `GateResult`, `PlatformEvent`).
- `src/api/fixtures.ts`: Rich synthetic fixtures representing realistic security audits across multiple repositories (`auth-gateway`, `payments-api`, `analytics-worker`), vulnerability attack classes (`authz`, `injection`, `secrets`, `client_side`), and verification verdicts (`confirmed`, `needs_validation`, `rejected`).
- `src/api/mock.ts`: In-memory `MockDataStore` and browser/Node `installFetchShim` intercepting `/api/v1/*` requests. Provides offline operation without any running backend (`pnpm dev:mock`).
- Supports live Server-Sent Events (SSE) subscriptions for real-time run updates.

### 2. All 8 Screens (React Router)

1. **Org Overview (`/` and `/overview`)**:
   - Posture metrics: Total open findings, SLA breaches count, Mean Time to Remediate (MTTR), active monitored projects.
   - Open findings distribution by authoritative verified severity and verdict.
   - Weekly findings volume trend chart (open vs resolved).
   - Cross-project attack-class matrix tracking vulnerability families across services.
   - Active SLA breaches table with countdowns and direct links.

2. **Project View (`/projects/:id`)**:
   - Project metadata, tenant scoping, default branch, and monthly token budget.
   - Release gate card showing pass/fail status, mode (`enforce` vs `report_only`), blocking violations, and active exceptions.
   - Coverage ledger summary with audited units ratio, coverage percentage bar, and un-audited target gap paths.
   - Run history table with phase progress indicators, skill validator results, token cost, and timestamps.
   - Interactive modal to trigger on-demand `focused`, `incremental`, or `full` audit runs.
   - Project-scoped findings table.

3. **Run Timeline & Diagnostics (`/runs/:id`)**:
   - Status badge, duration, token usage (input/output), and USD expenditure accounting.
   - Automated skill validator status badges for `validate-findings.cjs` and `validate-coverage-ledger.cjs`.
   - Links to persisted report artifacts (`report.md`, `findings.json`, `coverage-ledger.json`, `architecture.md`, `needs-validation.md`).
   - Pipeline phase timeline (`preflight`, `recon`, `hunt`, `validate`, `report`).
   - **Model used per attempt (fallbacks visible)**: Detailed per-slice attempt log clearly showing initial attempt failures (e.g. rate limits or quota exceeded) and automatic secondary model fallbacks.
   - Live SSE event stream log with real-time connection status indicator.

4. **Finding Detail & Inspection (`/findings/:id`)**:
   - Identifiers, attack class, CWE, source location (`file:line`), and fingerprint.
   - **Original vs verified severity side by side**: Visual comparison contrasting preliminary hunter severity with final verifier severity.
   - **Model + Phase label on all AI output**: Attribution badges identifying generating model and pipeline phase.
   - **System 1 (Jev) Triage Suggestions**: Labelled `System 1 · Advisory (non-binding)` with predicted severity band probabilities, owner candidate recommendations, and false-positive risk.
   - **Fix Draft**: Generative remediation strategy and code changes badged `Draft · Human Review Only` with file diff preview.
   - Verifier proof details, unresolved blockers (if `needs_validation`), or rejection rationale (if `rejected`).
   - Vulnerability source trace (`entrypoint` → `propagation` → `sink`) and supporting evidence items.
   - Triage action form enforcing `TRIAGE_TRANSITIONS` with validation for `accepted_risk` expiration dates and `false_positive` reasons.
   - Chronological triage audit log.

5. **Security Review Queue (`/review-queue`)**:
   - Dedicated review list of all open `needs_validation` findings.
   - **Prominently displays the specific resolution blockers** preventing automated verification.
   - Invariant notice: Review queue items **never block a merge or fail a gate on their own**.
   - Filtering by attack class.

6. **Policy & Governance Exceptions (`/policy`)**:
   - Policy mode (`enforce` vs `report_only`), gate rules, and SLA remediation targets.
   - Approved security exceptions table (accepted risks with approver/expiry and false positives) with active/expired indicators.

7. **Release Readiness (`/release-readiness`)**:
   - Per-project release gate evaluation using `evaluateGate()`.
   - **Only confirmed findings shown as blocking**; advisory suggestions and unverified candidate leads do not block deployment.
   - Listing of exact blocking violations and exempted findings.

8. **Compliance Audit Export (`/export`)**:
   - Client-side CSV export with field escaping.
   - Client-side Markdown report generator with executive summary, tables, and detailed traces.
   - PDF export via dedicated `@media print` stylesheet.

### 3. Triage Lifecycle Constraints

- Triage actions strictly enforce `TRIAGE_TRANSITIONS` from `@sdap/core`. Options that are disallowed from the current state are disabled in the UI.
- `accepted_risk` requires a future expiration date; `false_positive` requires a justification reason.

### 4. Visibility of Rejected Findings

- Rejected candidate findings are hidden by default across all tables and screens per PRD 5.4.
- A "Show rejected findings" checkbox toggle in the top navigation bar allows revealing refuted candidate leads on demand.

### 5. UI, Accessibility & Responsiveness

- Semantic HTML, ARIA roles, accessible contrast ratios, and keyboard navigation.
- Responsive layout verified at mobile widths (375px) through desktop widescreen (1280px+).
- Light and dark theme toggle with CSS variable theming persisted in `localStorage`.

---

## 3. What is Complete, Mocked, or Deferred

### Complete

- `apps/web/src/api/client.ts`: Typed API client with runtime Zod schema parsing.
- `apps/web/src/api/mock.ts`: Mock data store and fetch shim.
- `apps/web/src/api/fixtures.ts`: Synthetic audit fixtures covering all contracts.
- `apps/web/src/api/types.ts`: Supporting types and schemas for metrics and summaries.
- `apps/web/src/components/*`: Badges, Attribution, SideBySideSeverity, System1Advisory, FixDraftViewer, SourceTraceViewer, TriageActionForm, Layout.
- `apps/web/src/screens/*`: OrgOverview, ProjectView, RunTimeline, FindingDetail, ReviewQueue, PolicyView, ReleaseReadiness, AuditExport.
- `apps/web/src/context/AppContext.tsx`: Global preferences context (theme, showRejected).
- `apps/web/src/index.css`: Design system, CSS variables, mobile media queries, and `@media print` print stylesheet.
- `apps/web/test/*.test.ts` & `test/*.test.tsx`: 30 unit & component tests passing with Vitest + Testing Library in JSDOM environment.
- `apps/web/e2e/smoke.spec.ts`: Playwright smoke test suite running against `vite preview`.
- `apps/web/playwright.config.ts`: Playwright test configuration.
- `apps/web/README.md`: Comprehensive package documentation.

### Mocked / Faked

- Mock API fetch shim: Simulates `/api/v1` Fastify backend responses using synthetic data so the dashboard can run entirely standalone (`pnpm dev:mock`).
- Synthetic fixtures: Realistic projects, runs, slices, findings, and events used for demonstration and tests.

### Deferred (Out of Scope for WS5)

- Production OIDC authentication UI (beyond bearer token header attachment stub, per WS5 card scope).
- Backend Fastify API implementation (owned by WS2).

---

## 4. Acceptance Criteria Verification

| Acceptance Criterion                                                    | Verification Method                                                | Status |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------ | ------ |
| Typed API client validates responses with core Zod schemas              | `apps/web/test/api-client.test.ts` (13 tests)                      | Pass   |
| Mock API runs with no backend (`pnpm dev:mock`)                         | `src/api/mock.ts` with fetch shim & synthetic fixtures             | Pass   |
| All 8 screens render against mocked API                                 | `apps/web/test/screens.test.tsx` (9 component tests in JSDOM)      | Pass   |
| Original vs verified severity side by side                              | `FindingDetailScreen` and `SideBySideSeverity` component           | Pass   |
| Model used per attempt (fallbacks visible)                              | `RunTimelineScreen` displaying fallback from argon to sonnet       | Pass   |
| System 1 suggestions labelled "advisory"                                | `System1AdvisoryView` with advisory badge                          | Pass   |
| Fix draft labelled "draft"                                              | `FixDraftViewer` with draft human review badge                     | Pass   |
| Review queue lists `needs_validation` items with blockers               | `ReviewQueueScreen` & `apps/web/test/screens.test.tsx`             | Pass   |
| Only confirmed findings fail a gate                                     | `ReleaseReadinessScreen` & `evaluateGate()` verification           | Pass   |
| Triage actions respect `TRIAGE_TRANSITIONS`                             | `TriageActionForm` with disallowed transitions disabled            | Pass   |
| Rejected findings hidden by default with a toggle                       | `AppContext` & `FindingQuery.includeRejected`                      | Pass   |
| Accessible, 1280px & 375px responsive, light/dark                       | `index.css` media queries, CSS variables, semantic HTML            | Pass   |
| Audit export (Markdown, CSV, PDF via print stylesheet)                  | `AuditExportScreen` with client-side generators and `@media print` | Pass   |
| Playwright smoke tests (`apps/web/e2e/`) against `vite preview`         | `pnpm --filter @sdap/web e2e` (4 tests passing)                    | Pass   |
| Playwright tests separate from `pnpm test`                              | `e2e` script separated; `pnpm test` runs Vitest only               | Pass   |
| `pnpm -r typecheck lint test` and `pnpm --filter @sdap/web build` green | Verified across workspace                                          | Pass   |
| Package README updated                                                  | `apps/web/README.md` documents screens and mock execution          | Pass   |

---

## 5. Gate Verification Summary

- `pnpm install`: Green (up to date).
- `pnpm -r typecheck`: Green (0 errors across all 9 packages).
- `pnpm -r lint`: Green (0 errors, 0 warnings across all packages).
- `pnpm -r test`: Green (65/65 tests passing across monorepo; 30 in `@sdap/web`).
- `pnpm format:check`: Green (all files formatted with Prettier).
- `pnpm --filter @sdap/web build`: Green (Vite production bundle built successfully in 1.2s).
- `pnpm --filter @sdap/web e2e`: Green (4/4 Playwright smoke tests passed against preview server).
