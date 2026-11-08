# @sdap/web

The primary web dashboard for Security and DevOps (PRD 5.6), built with React 19, TypeScript, and Vite. Connects to the SecDevOps Audit Platform API (`/api/v1`), validated by `@sdap/core` Zod contracts, and includes an in-memory mock API and synthetic data engine for standalone offline operation (`pnpm dev:mock`).

Owner: workstream **WS5** (see `docs/workstreams/WS5.md`).

---

## Running the Dashboard

### Standalone with Mock API (No Backend Required)

To run the full dashboard with realistic synthetic fixtures, simulated audit runs, fallback chains, and live SSE updates:

```bash
pnpm --filter @sdap/web dev:mock
```

This starts the Vite dev server at `http://localhost:5173` with `VITE_MOCK_API=true`. The client installs an in-memory fetch shim intercepting all `/api/v1/*` requests.

### Development with Live Backend API

To run against a running `@sdap/api` instance (default port 8080):

```bash
pnpm --filter @sdap/web dev
```

Requests to `/api` are automatically proxied to `http://localhost:8080`.

---

## Screen Inventory

The dashboard implements 8 primary views using React Router with light/dark theme support, mobile responsiveness (375px through 1280px+), and print stylesheets for PDF compliance exports:

### 1. Org Overview (`/` and `/overview`)

- **Key Posture Metrics**: Total open findings, active SLA breaches count, mean time to remediate (MTTR in days), and monitored repositories.
- **Severity Breakdown**: Distribution of open findings by authoritative verified severity (`critical`, `high`, `medium`, `low`, `informational`).
- **Verification Verdict Breakdown**: Proved (`confirmed`), pending sandbox/verifier verification (`needs_validation`), and refuted candidate leads (`rejected`).
- **Trend Over Time**: Rolling weekly volume comparison of newly identified vs remediated findings.
- **Cross-Project Attack-Class View**: Matrix heatmap tracking attack classes (`authn`, `authz`, `injection`, `config`, `secrets`, `client_side`, etc.) across all audited microservices and repositories.
- **SLA Breach Alerts**: Table listing findings that exceeded SLA resolution deadlines, linking directly to finding records.

### 2. Project View (`/projects/:id`)

- **Project Governance Summary**: Repo URL, owning team, client tenant scoping, default branch, and token budget.
- **Release Gate Status**: Pass/blocked status, policy enforcement mode (`enforce` vs `report_only`), count of gate-blocking confirmed findings, and active exceptions.
- **Coverage Ledger Summary**: Total vs audited code units, percentage coverage score, last audit timestamp, and un-audited target gap paths.
- **Run History**: Historical audit executions showing mode (`focused`, `incremental`, `full`), git ref/commit SHA, pipeline phase progress dots, validator results, token cost in USD, and timestamp.
- **Trigger Audit Run**: Interactive dialog allowing on-demand triggering of `focused`, `incremental`, or `full` runs with target git ref.
- **Project Findings Ledger**: Filtered list of all active vulnerabilities for the repository.

### 3. Run Timeline & Diagnostics (`/runs/:id`)

- **Run Header & Resource Accounting**: Status badge (`queued`, `running`, `succeeded`, `failed`, `cancelled`), execution duration, total token usage, and cost in USD.
- **Live SSE Event Stream**: Real-time connection indicator listening to server-sent events (`/api/v1/runs/:id/events/stream`) with event log console.
- **Skill Validators**: Status badges for `validate-findings.cjs` and `validate-coverage-ledger.cjs`.
- **Artifacts Registry**: Download and view links for generated reports (`report.md`, `findings.json`, `coverage-ledger.json`, `architecture.md`, `needs-validation.md`).
- **Phases Timeline**: Progress and token cost across the audit lifecycle (`preflight`, `recon`, `hunt`, `validate`, `report`).
- **Work Slices & Model Fallback Chains**: Detailed per-slice attempt ledger displaying **model used per attempt** (e.g. attempt 1 on `gemini-4-argon-high` failed with rate limits, triggering automatic fallback to attempt 2 on `claude-sonnet-5-5` which succeeded).

### 4. Finding Detail & Triage (`/findings/:id`)

- **Headline & Attribution**: Attack class, CWE, source location (`file:line`), fingerprint, and Model + Phase attribution tag on all AI output.
- **Side-by-Side Severity**: Direct comparison of hunter preliminary severity (pre-verification) alongside verified authoritative severity.
- **Triage Recommendation**: Prominently badged `AI Suggestion · Advisory (non-binding)` displaying predicted severity band probabilities, owner candidate recommendations with confidence scores, and false-positive risk.
- **Verification Proof & Blockers**: Verifier confidence level, unresolved blockers (if `needs_validation`), or refutation rationale (if `rejected`).
- **Vulnerability Source Trace**: Step-by-step dataflow path (`entrypoint` → `propagation` → `sink`) with code location and scope.
- **Automated Fix Draft**: Generative remediation code proposal prominently badged `Draft · Human Review Only` with file diff preview.
- **Triage Action Form**: State machine enforcing allowed lifecycle transitions (`TRIAGE_TRANSITIONS`). Disallowed options are strictly disabled. Requires expiration date for `accepted_risk` and justification reason for `false_positive`.
- **Triage Audit History**: Chronological tamper-evident audit log of past status transitions, actors, roles, and notes.

### 5. Security Review Queue (`/review-queue`)

- **Needs Validation Triage**: Dedicated queue for findings where automatic proof could not be verified by hunter agents.
- **Resolution Blockers**: Explicitly highlights the unresolved facts blocking automatic verification (e.g., dynamic reflection, missing runtime configuration).
- **Policy Invariant**: Explains and enforces that review queue items **never block a merge or fail a gate on their own**.
- **Class Filtering**: Quick dropdown to filter review items by attack class.

### 6. Policy & Exceptions (`/policy`)

- **Policy as Code**: Policy mode (`enforce` vs `report_only`), gate rules (verdict, minimum severity, attack classes), and remediation SLA targets.
- **Exceptions Ledger**: Active and expired security exceptions (accepted risks and false positives) with approver, reason, and expiration dates.

### 7. Release Readiness (`/release-readiness`)

- **Multi-Project Gate Evaluation**: Deterministic release evaluation running `evaluateGate()` across all projects.
- **Strict Invariant**: **Only open confirmed findings can fail a release gate**. Advisory AI suggestions and `needs_validation` items are never blocking.
- **Violations Inspection**: Explicit listing of the exact confirmed findings blocking a deployment.

### 8. Compliance Audit Export (`/export`)

- **CSV Export**: Client-side generated tabular dataset with escaping.
- **Markdown Export**: Formatted executive summary and vulnerability detail document for client compliance deliverables.
- **PDF Export via Print Stylesheet**: Dedicated `@media print` CSS cleanly hiding navigation, sidebars, and interactive controls to produce clean audit PDFs via browser print dialog.

---

## Global Controls & Accessibility

- **Rejected candidates**: refuted leads are hidden from lists and exports; there is no toggle, and they never affect the release gate.
- **Light / Dark Mode**: Icon toggle in the sidebar footer. Dark mode re-points the same colour tokens under `[data-theme="dark"]`, so no per-element overrides exist. Persisted in `localStorage`.
- **Command Palette** (`⌘K` / `Ctrl+K`, or click the top-bar search): quick actions (`⌘R` audit, `⌘E` exception, `⌘P` export, `⌘D` theme) and recent confirmed or advisory findings. Arrow keys move, `Enter` runs, `Esc` closes. Rejected findings are never listed.
- **Sandbox Replay terminal**: opened from a finding or a review-queue card. It is a **simulation**: it replays the finding's own recorded trace, executes nothing, shows no invented data, and cannot change a verdict or status.
- **Responsive Layout**: Designed and tested for mobile devices (375px) up through widescreen displays (1280px+).

---

## Design System

The UI follows the Stitch redesign (`stitch-redesign/*.html` are the reference renders) on the shadcn/ui Zinc palette.

- **Tokens**: `src/tailwind.css` defines the Stitch palette, the severity/verdict spectrum (`sev-*`, `verified-*`, `advisory-*`) and fonts as Tailwind v4 `@theme` tokens. Tailwind runs at **build time only**; there is no CDN.
- **Self-hosted assets**: Inter, JetBrains Mono, Public Sans and Material Symbols come from npm packages and are bundled, so the dashboard makes no third-party requests (the platform ships no telemetry by default).
- **Cascade**: `@layer theme, legacy, utilities`. The older stylesheet in `index.css` lives in `legacy`, below utilities, so its global reset cannot override Tailwind spacing. Tailwind's preflight is not imported; `.sdap-shell` carries a minimal reset.
- **Primitives**: `src/components/stitch.tsx` (`Panel`, `Pill`, `Stat`, `Meter`, table and button classes). `Badges.tsx` builds on `Pill`.
- **Styleguide**: `/styleguide` renders the real components for review.
- **Invariants kept in the UI**: only `confirmed` findings gate; AI suggestions are always badged "AI Suggestion · Advisory"; drafts are badged "Draft · Human Review Only"; `false_positive` needs a reason and `accepted_risk` an expiry.

## Sign-in & Session

- `/login`: paste an OIDC access token for a real API (`VITE_API_BASE_URL` set). With the mock API, "Continue in demo mode" is also offered and the demo user is signed in automatically until you sign out.
- The token lives in `sessionStorage` for the tab only and is sent as a bearer token. A 401 or token expiry signs you out. Claims are decoded for display only; the API enforces roles and client scope.
- `/profile`: identity, roles, team, client scope, session expiry and preferences (theme). Identity is read-only.
- The theme control is a labelled switch (`role="switch"`) in the sidebar, login and profile.
- Caveat: `sessionStorage` is readable by page scripts; see D-018 and the PKCE follow-up.

## Scripts & Verification

| Command          | Description                                                             |
| ---------------- | ----------------------------------------------------------------------- |
| `pnpm dev`       | Start Vite dev server on `:5173`                                        |
| `pnpm dev:mock`  | Start Vite dev server on `:5173` with mock API enabled                  |
| `pnpm build`     | Bundle production assets with Vite into `dist/`                         |
| `pnpm preview`   | Serve production build locally on `:4173`                               |
| `pnpm typecheck` | Run TypeScript compiler strict checks (`tsc -p tsconfig.json --noEmit`) |
| `pnpm lint`      | Run ESLint checks against React and browser globals                     |
| `pnpm test`      | Run Vitest unit and component tests with JSDOM environment              |
| `pnpm e2e`       | Run Playwright smoke tests against `vite preview` with mock API         |

## Local dataset from real audit runs

`node scripts/import-audit-data.mjs <dir>` converts security-audit-skill run folders (`<project>/run-1/…`) into mock data at `src/api/audit-data.generated.json`. Start with `VITE_MOCK_DATASET=audit pnpm dev:mock`. The file is git-ignored on purpose: it describes real, possibly unfixed vulnerabilities, so never commit it or the folders it came from.
