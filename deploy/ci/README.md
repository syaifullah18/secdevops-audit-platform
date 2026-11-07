# CI/CD Pipeline Integration Templates

This directory contains production-ready, copy-paste templates to integrate the SecDevOps Audit Platform (`sdap`) CLI into common CI/CD platforms.

## Overview

Each template configures a security audit gate that runs on every pull/merge request and branch commit:

- Mode: `focused` (scans code changed in the diff, reusing prior coverage ledger)
- Wait: polls the audit run until completion, streaming phase progress to stderr
- Gating: `--fail-on confirmed:high` blocks merges when confirmed high or critical vulnerabilities exist
- Secrets: reads `SDAP_TOKEN` securely from the CI platform's secret manager

## Supported CI Platforms

| CI Platform             | Template Path                        | Documentation                                     | Secret Store Reference                      |
| ----------------------- | ------------------------------------ | ------------------------------------------------- | ------------------------------------------- |
| **GitHub Actions**      | `deploy/ci/github-action/action.yml` | [GitHub Action README](./github-action/README.md) | `${{ secrets.SDAP_TOKEN }}`                 |
| **Bitbucket Pipelines** | `deploy/ci/bitbucket-pipelines.yml`  | [Bitbucket README](./bitbucket.README.md)         | `$SDAP_TOKEN` (Secured variable)            |
| **GitLab CI**           | `deploy/ci/.gitlab-ci.yml`           | [GitLab README](./gitlab.README.md)               | `$SDAP_TOKEN` (Masked & protected variable) |
| **Jenkins**             | `deploy/ci/Jenkinsfile`              | [Jenkins README](./jenkins.README.md)             | `credentials('sdap-token')`                 |

## Standard Command Invocation

All templates invoke:

```bash
sdap run --mode focused --wait --fail-on confirmed:high
```

Configuration is provided via environment variables:

- `SDAP_API_URL`: The base URL of the self-hosted SDAP API server (e.g. `https://sdap.internal.example.com`).
- `SDAP_PROJECT`: The project UUID registered in SDAP.
- `SDAP_TOKEN`: Bearer token for OIDC/API authentication.

## Exit Codes

| Code | Meaning                                                       | CI Impact                  |
| ---- | ------------------------------------------------------------- | -------------------------- |
| `0`  | Audit passed policy gate (no confirmed findings >= threshold) | Build passes               |
| `1`  | Policy gate failed (confirmed findings at or above threshold) | Build fails (blocks merge) |
| `2`  | Audit run failed or was invalid (e.g., validator failure)     | Build fails                |
| `3`  | Configuration or usage error (e.g., missing token/project)    | Build fails                |
| `4`  | Polling operation timed out before run completion             | Build fails                |
