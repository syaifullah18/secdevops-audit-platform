# WS6 Workstream Completion Report: CLI + CI Integrations

- **Workstream**: WS6 (CLI + CI integrations)
- **Branch**: `ws/WS6`
- **Package**: `packages/cli`
- **Deploy**: `deploy/ci`
- **Owner**: Worker WS6

---

## 1. Complete

All deliverables and acceptance criteria in `docs/workstreams/WS6.md` have been implemented, tested, and verified:

1. **`sdap` CLI Binary (`packages/cli/src/bin/sdap.ts`, `bin` in `package.json`)**:
   - Zero heavy framework; built with native `node:util` `parseArgs` on Node 24.
   - Configurable from flags or environment variables:
     - `SDAP_API_URL` / `--api-url` (default: `http://localhost:3000`)
     - `SDAP_TOKEN` / `--token` (Bearer authentication)
     - `SDAP_PROJECT` / `--project` (Target project UUID)

2. **CLI Commands**:
   - `sdap run --project <id> --mode focused|incremental|full [--ref <git-ref>] [--repeat N] [--paths a,b] [--wait] [--timeout 3600] [--fail-on confirmed:<severity>] [--json]`:
     - Creates run via `POST /api/v1/runs`.
     - With `--wait`: polls status until terminal (`succeeded`, `failed`, `cancelled`), streaming phase progress (`recon`, `hunt`, `validate`, etc.) to `stderr`.
     - Checks validator health (`findings` and `coverageLedger`).
     - Evaluates `--fail-on confirmed:<severity>` against confirmed findings or project gate results.
     - Enforces timeout abort (exit code `4`).
   - `sdap status <run-id> [--json]`:
     - Fetches and displays run status, commit, duration, validator status, and phase progress.
   - `sdap report <run-id> [--format md|json] [--out file]`:
     - Generates Markdown or structured JSON audit reports.
     - Supports direct file export via `--out <file>` or standard stdout streaming.
   - `sdap gate --project <id> [--json]`:
     - Directly queries `GET /api/v1/projects/:id/gate`.
     - Exits with `0` if policy gate passes, `1` if violations exist.

3. **Documented Exit Codes**:
   - `0`: Pass / gate satisfied / command succeeded.
   - `1`: Gate failed (confirmed findings at or above configured threshold).
   - `2`: Run failed, cancelled, validator check failed, or invalid state.
   - `3`: Usage or configuration error (invalid flags, missing arguments, or bad threshold).
   - `4`: Wait operation timed out before reaching a terminal status.
   - **Safety Invariant**: `--fail-on` strictly accepts only `confirmed:<severity>`; any other prefix (such as `needs_validation:high`) throws exit code `3` because only verified System 2 findings can block gates.

4. **CI Templates & Documentation (`deploy/ci/`)**:
   - `bitbucket-pipelines.yml`: Bitbucket Pipelines pull-request and branch audit gate reading `$SDAP_TOKEN` from secured repository variables.
   - `github-action/action.yml`: Composite GitHub Action with required fields (`name`, `description`, `inputs`, `runs.using: 'composite'`) running on Node 24.
   - `.gitlab-ci.yml`: GitLab CI security audit stage reading `$SDAP_TOKEN` from masked and protected CI/CD variables.
   - `Jenkinsfile`: Jenkins Declarative Pipeline stage using `credentials('sdap-token')` credentials store.
   - Each template executes: `sdap run --mode focused --wait --fail-on confirmed:high`.
   - Comprehensive README per template:
     - `deploy/ci/README.md`
     - `deploy/ci/github-action/README.md`
     - `deploy/ci/bitbucket.README.md`
     - `deploy/ci/gitlab.README.md`
     - `deploy/ci/jenkins.README.md`

5. **Test Suites**:
   - `packages/cli/test/cli.test.ts`: 19 integration tests with local `node:http` mock server verifying:
     - `run + wait success → 0` with phase progress streamed to stderr
     - `confirmed high → 1`
     - `run failed → 2` (run failure and validator failure)
     - `bad --fail-on → 3`
     - `timeout → 4`
     - `--json` output parses for run, status, and gate
     - `status`, `report`, and `gate` commands
     - All usage error branches (exit code `3`)
   - `packages/cli/test/templates.test.ts`: 5 lint tests verifying:
     - All YAML templates parse cleanly with `yaml`
     - GitHub composite action has all required fields
     - Jenkinsfile contains expected command and credentials binding
     - Documentation exists for every template

---

## 2. Mocked

- CLI tests execute entirely offline using a local `node:http` ephemeral mock server (`packages/cli/test/mock-server.ts`) simulating the SDAP API server and returning valid contracts (`Run`, `GateResult`, `FindingPage`). No real network calls or live API keys are used.

---

## 3. Deferred

- Server-side webhooks (WS2): Out of scope for WS6 as noted in `docs/workstreams/WS6.md`.

---

## 4. Contract Status

- No contract additions or modifications were required in `@sdap/core`. All schemas and helpers (`CreateRunRequest`, `Run`, `GateResult`, `FindingQuery`, `FindingPage`, `ApiError`, `evaluateGate`, `severityAtLeast`, `isOpenStatus`) were complete, accurate, and honored without deviation.
- No `docs/workstreams/WS6-contract-request.md` was necessary.
