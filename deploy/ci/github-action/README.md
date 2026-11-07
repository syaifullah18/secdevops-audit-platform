# GitHub Action: SDAP Audit Gate

Composite GitHub Action for running automated security audit gates on pull requests and commits using the SecDevOps Audit Platform (`sdap`).

## Features

- Composite action running on Node.js 24
- Automatically triggers focused security scans on pull request changes
- Streams execution phases (`recon`, `hunt`, `validate`, `report`) to the GitHub workflow console
- Fails the workflow job if confirmed high or critical security findings exist
- Accepts secrets securely via inputs

## Prerequisites

1. Generate an API token in the SDAP Web Dashboard or OIDC provider.
2. In your GitHub repository, navigate to **Settings > Secrets and variables > Actions**.
3. Create a repository secret named `SDAP_TOKEN` containing your bearer token.

## Usage

In your `.github/workflows/sdap-audit.yml`:

```yaml
name: Security Audit

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Run SDAP Audit Gate
        uses: ./deploy/ci/github-action
        with:
          api-url: "https://sdap.internal.example.com"
          project: "00000000-0000-4000-8000-000000000001"
          token: ${{ secrets.SDAP_TOKEN }}
          mode: "focused"
          fail-on: "confirmed:high"
```

## Inputs

| Input     | Description                                   | Required | Default                             |
| --------- | --------------------------------------------- | -------- | ----------------------------------- |
| `api-url` | SDAP API base URL                             | No       | `https://sdap.internal.example.com` |
| `token`   | Bearer token from GitHub Secrets              | **Yes**  | -                                   |
| `project` | SDAP Project UUID                             | **Yes**  | -                                   |
| `mode`    | Audit mode (`focused`, `incremental`, `full`) | No       | `focused`                           |
| `ref`     | Git ref to evaluate                           | No       | `${{ github.sha }}`                 |
| `fail-on` | Failure threshold                             | No       | `confirmed:high`                    |
