# @sdap/cli (`sdap`)

`sdap` is a lightweight, zero-heavy-framework CLI designed for CI/CD pipelines to trigger security audits on the SecDevOps Audit Platform (SDAP), poll run progress, retrieve audit reports, and enforce gating policies.

## Installation

```bash
# Global installation (recommended for CI runners)
npm install -g @sdap/cli

# Or in a local Node project
pnpm add -D @sdap/cli
```

The CLI requires **Node.js >= 24**.

## Configuration

Configuration is provided via command-line flags or environment variables. Command-line flags take precedence over environment variables:

| Setting        | Flag              | Environment Variable | Default                 | Description                                |
| -------------- | ----------------- | -------------------- | ----------------------- | ------------------------------------------ |
| **API URL**    | `--api-url <url>` | `SDAP_API_URL`       | `http://localhost:3000` | Base URL of the SDAP API server            |
| **Auth Token** | `--token <token>` | `SDAP_TOKEN`         | -                       | Bearer token for API / OIDC authentication |
| **Project ID** | `--project <id>`  | `SDAP_PROJECT`       | -                       | Target project UUID registered in SDAP     |

---

## Commands

### 1. `sdap run`

Trigger an audit run, optionally stream execution phases, wait for completion, and enforce policy thresholds.

```bash
sdap run --project <id> \
  [--mode focused|incremental|full] \
  [--ref <git-ref>] \
  [--repeat N] \
  [--paths a,b] \
  [--wait] \
  [--timeout 3600] \
  [--fail-on confirmed:<severity>] \
  [--json]
```

#### Options:

- `--project <id>` (or `SDAP_PROJECT`): Target project UUID.
- `--mode <mode>`: Audit mode:
  - `focused` (default): Scans code changed since last run, reusing prior coverage ledgers.
  - `incremental`: Targets gaps across the scope.
  - `full`: Complete repository scan.
- `--ref <git-ref>`: Git reference to audit (default: `HEAD`).
- `--repeat <N>`: Number of independent runs merged for consensus (1..10, default: 1).
- `--paths <a,b>`: Comma-separated list of repository-relative path filters.
- `--wait`: Poll the run until a terminal status (`succeeded`, `failed`, `cancelled`) is reached. Streams phase progress (`recon`, `hunt`, `validate`, `report`) to `stderr`.
- `--timeout <seconds>`: Maximum wait duration before aborting with exit code `4` (default: `3600`).
- `--fail-on confirmed:<severity>`: Gate threshold. Accepts **only** `confirmed:<severity>` (`confirmed:informational`, `confirmed:low`, `confirmed:medium`, `confirmed:high`, `confirmed:critical`). System 1 (Jev) and `needs_validation` findings are advisory only and cannot fail a gate.
- `--json`: Output machine-readable JSON to `stdout`.

---

### 2. `sdap status`

Inspect current state, validator health, and phase progress for a given audit run.

```bash
sdap status <run-id> [--json]
```

#### Example output (human-readable):

```text
Run ID:          00000000-0000-4000-8000-0000000000b1
Project:         00000000-0000-4000-8000-0000000000aa
Status:          SUCCEEDED
Mode:            focused
Git Ref:         HEAD
Commit SHA:      a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
Validators:
  - findings:       passed
  - coverageLedger: passed
Phases:
  - recon         : succeeded  (2/2 slices completed)
  - hunt          : succeeded  (4/4 slices completed)
  - validate      : succeeded  (2/2 slices completed)
```

---

### 3. `sdap report`

Retrieve the audit report in Markdown or JSON format, optionally saving to a file.

```bash
sdap report <run-id> [--format md|json] [--out <file>]
```

#### Options:

- `<run-id>`: Run UUID to retrieve.
- `--format <format>`: Output format: `md` (default) or `json`.
- `--out <file>`: Destination file path. If omitted, prints directly to `stdout`.

---

### 4. `sdap gate`

Directly evaluate project policy rules and active exceptions against open confirmed findings.

```bash
sdap gate --project <id> [--json]
```

- Exits with `0` if policy gate passes.
- Exits with `1` if policy violations exist.

---

## Exit Codes

`sdap` returns strict, standardized exit codes for CI pipeline automation:

|  Code   | Status                   | Description                                                                                                |
| :-----: | :----------------------- | :--------------------------------------------------------------------------------------------------------- |
| **`0`** | **Pass**                 | All checks succeeded, or gate evaluation satisfied (no confirmed findings meeting/exceeding threshold).    |
| **`1`** | **Gate Failed**          | Policy violation: confirmed findings found at or above configured threshold (`--fail-on`).                 |
| **`2`** | **Run Failed / Invalid** | Run status failed or cancelled, validator check failed, or run result is invalid. Never treated as a pass. |
| **`3`** | **Usage / Config Error** | Invalid flags, missing required arguments, malformed `--fail-on` format, or auth failure.                  |
| **`4`** | **Timeout**              | Polling wait operation exceeded the configured `--timeout` without reaching a terminal status.             |

> [!IMPORTANT]
> **Safety Guardrail**: `--fail-on` strictly requires the `confirmed:` prefix (e.g. `confirmed:high`). Any attempts to pass `needs_validation:<severity>` or other formats result in exit code `3`, enforcing the platform invariant that only verified System 2 findings can block pipeline merges.

---

## CI/CD Pipeline Integration

Pre-built, copy-paste templates are available in the repository under `deploy/ci/`:

- **GitHub Actions**: `deploy/ci/github-action/action.yml` (Composite Action)
- **Bitbucket Pipelines**: `deploy/ci/bitbucket-pipelines.yml`
- **GitLab CI**: `deploy/ci/.gitlab-ci.yml`
- **Jenkins**: `deploy/ci/Jenkinsfile`

Each template is preconfigured to run:

```bash
sdap run --mode focused --wait --fail-on confirmed:high
```

and securely bind the API token from each system's secret store. See [`deploy/ci/README.md`](../../deploy/ci/README.md) for full setup instructions.
