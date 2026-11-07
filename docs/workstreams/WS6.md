# WS6 CLI + CI integrations

- **Runner / model:** agy / `gemini-3.8-flash-medium` (fallback claude / `claude-haiku-5-5`)
- **Branch:** `ws/WS6`
- **Paths:** `packages/cli/**`, `deploy/ci/**`
- **Consumes (core):** `CreateRunRequest`, `Run`, `GateResult`, `Severity`, `SEVERITY_RANK`,
  `FindingPage`, `ApiError`

## Goal

`sdap`, a small CLI for CI pipelines, plus copy-paste templates for common CI systems.

## Deliverables

1. Binary `sdap` (`bin` entry in package.json, Node 24, no heavy framework; `node:util`
   `parseArgs` is fine). Config from flags or env: `SDAP_API_URL`, `SDAP_TOKEN`, `SDAP_PROJECT`.
2. Commands:
   - `sdap run --project <id> --mode focused|incremental|full [--ref <git-ref>] [--repeat N]
[--paths a,b] [--wait] [--timeout 3600] [--fail-on confirmed:high]`
     Creates a run; with `--wait` polls until done, streams phase progress to stderr.
   - `sdap status <run-id> [--json]`
   - `sdap report <run-id> [--format md|json] [--out file]`
   - `sdap gate --project <id> [--json]`
3. **Exit codes** (documented): `0` pass; `1` gate failed (confirmed at or above the threshold);
   `2` run failed or invalid (never treated as pass); `3` usage/config error; `4` timeout.
   `--fail-on` accepts only `confirmed:<severity>`; anything else (e.g. `needs_validation:high`)
   is a usage error, because only confirmed findings may fail a gate.
4. Templates in `deploy/ci/`: `bitbucket-pipelines.yml`, `github-action/action.yml` (composite
   action), `.gitlab-ci.yml`, `Jenkinsfile`; each runs `sdap run --mode focused --wait
--fail-on confirmed:high` and reads the token from the CI secret store. README per template.

## Acceptance criteria

- CLI tests with a mock HTTP server: run + wait success → 0; confirmed high → 1; run failed → 2;
  bad `--fail-on` → 3; timeout → 4; `--json` output parses.
- Templates lint: YAML files parse (test using the `yaml` package), the action has required
  fields, the Jenkinsfile contains the expected command.
- `pnpm -r typecheck lint test` green. README with usage and exit codes.

## Out of scope

Server-side webhooks (WS2).
