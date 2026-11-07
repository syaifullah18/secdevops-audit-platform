# SecDevOps Audit Platform (SDAP)

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-24%20LTS-brightgreen.svg)](.nvmrc)
[![TypeScript](https://img.shields.io/badge/typescript-strict-blue.svg)](tsconfig.base.json)
[![Release](https://img.shields.io/badge/release-v0.1.0--rc.1-orange.svg)](docs/build-log.md)

Self-hosted, air-gappable security audit platform that orchestrates Cloudflare's open-source
[security-audit-skill](https://github.com/cloudflare/security-audit-skill) on demand or directly from CI,
normalizes and dedupes verified findings, and provides Security and DevOps teams with a unified real-time dashboard.

Zero SaaS security dependencies. Zero telemetry by default. Strict tenant isolation and sandboxed container execution.

Product Specification: [docs/PRD.md](docs/PRD.md) | Architecture Decisions: [docs/decisions.md](docs/decisions.md)

---

## 🏛️ Architecture Overview

```mermaid
graph TD
    CI[CI Pipeline / CLI] -->|Trigger Audit / Query Gate| API[Fastify API Service]
    Web[Web Dashboard] -->|View Findings & Manage Triage| API
    API -->|Queue Job| Redis[(BullMQ Redis)]
    API -->|Persist Runs & Policies| DB[(PostgreSQL 17)]
    Redis --> Worker[Audit Worker]
    Worker -->|Fetch Policies & State| DB
    Worker -->|Execute Isolated Audit| Sandbox[Hardened Sandbox Runner]
    Sandbox -->|Restricted Proxy Egress| Adapters[Model Adapters: Claude / Gemini / Jev / Ollama]
    Worker -->|Parse & Deduplicate| Norm[Findings Normalizer]
    Norm -->|Store Confirmed Leads| DB
    Prom[Prometheus] -->|Scrape Metrics| API
    Prom -->|Scrape Metrics| Worker
    Grafana[Grafana Dashboards] -->|Visualize| Prom
```

---

## 📦 Workspace Layout

| Path                                         | Component                  | Description                                                                                     |
| -------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------- |
| [`packages/core`](packages/core)             | Contracts & Schema         | Shared Zod schemas, data contracts, event types, JSON Schema definitions                        |
| [`packages/adapters`](packages/adapters)     | LLM Model Adapters         | Unified SDK adapters for Jev, Gemini 4 Argon, Claude Opus/Sonnet, OpenAI-compat, and local LLMs |
| [`packages/normalizer`](packages/normalizer) | Normalizer & Deduplication | AST findings extractor, fingerprint hashing, CWE/OWASP classification, and SLA calculation      |
| [`packages/sandbox`](packages/sandbox)       | Hardened Sandbox Runner    | OCI container execution with dropped capabilities, read-only mounts, and egress allowlist proxy |
| [`packages/cli`](packages/cli)               | SDAP CLI Tool              | Command-line runner (`sdap scan`, `sdap gate`, `sdap report`) for CI/CD integration             |
| [`apps/api`](apps/api)                       | Fastify REST API           | Multi-tenant API with RBAC, OIDC authentication, webhook ingestion, and metrics endpoint        |
| [`apps/worker`](apps/worker)                 | BullMQ Audit Worker        | Multi-phase execution engine managing audit slice parallelization and fallbacks                 |
| [`apps/web`](apps/web)                       | Frontend Dashboard         | React 19 + Vite dashboard with real-time SSE updates, findings triage, and gate compliance      |
| [`deploy/`](deploy)                          | Deployment Assets          | Docker Compose stacks, Helm chart, Grafana dashboards, Prometheus alerts, and CI templates      |
| `vendor/security-audit-skill`                | Vendored Upstream Skill    | Pinned upstream audit skill (MIT, (c) Cloudflare, Inc.)                                         |

---

## 🚀 Quick Start

### 1. Local Evaluation (Docker Compose)

Spin up the complete evaluation stack (API, Web, Worker, Postgres, Redis, Prometheus, Loki, Alloy, Grafana) with a single command:

```sh
# Copy environment template
cp .env.example .env

# Start evaluation stack
docker compose up --build -d
```

- **Web Dashboard**: [http://localhost:3000](http://localhost:3000)
- **API Swagger/Docs**: [http://localhost:8080/docs](http://localhost:8080/docs)
- **Grafana Monitoring**: [http://localhost:3001](http://localhost:3001) (`admin` / `sdap-change-me`)

### 2. Hardened Production Mode

For shared servers and production workloads, use the hardened override that drops all container capabilities, enables read-only root filesystems, enforces OIDC, and mandates operator-set secrets:

```sh
docker compose -f docker-compose.yml -f deploy/compose/docker-compose.hardened.yml up -d
```

### 3. Kubernetes Deployment (Helm)

Deploy to Kubernetes with our production-ready Helm chart:

```sh
# Create secret containing connection strings
kubectl create secret generic sdap-secrets \
  --from-literal=DATABASE_URL="postgres://user:pass@postgres:5432/sdap" \
  --from-literal=REDIS_URL="redis://redis:6379"

# Install Helm release
helm install sdap deploy/helm/sdap \
  --set secrets.existingSecret=sdap-secrets \
  --set config.oidcIssuerUrl="https://auth.example.com"
```

---

## 💻 CLI & CI/CD Integration

Install or run the CLI directly in your GitHub Actions, GitLab CI, or Jenkins pipelines:

```sh
# Run audit scan against local repository
sdap scan --target . --policy security-critical

# Evaluate security gate against target project
sdap gate --project my-service --fail-on confirmed:high
```

Pre-configured pipeline configurations are available in [`deploy/ci`](deploy/ci):

- GitHub Actions: [`deploy/ci/github-action/action.yml`](deploy/ci/github-action/action.yml)
- GitLab CI: [`deploy/ci/.gitlab-ci.yml`](deploy/ci/.gitlab-ci.yml)
- Jenkins: [`deploy/ci/Jenkinsfile`](deploy/ci/Jenkinsfile)
- Bitbucket Pipelines: [`deploy/ci/bitbucket-pipelines.yml`](deploy/ci/bitbucket-pipelines.yml)

---

## 🛠️ Local Development

### Requirements

- **Node.js**: Node 24 LTS (`nvm use` or `/opt/homebrew/opt/node@24/bin`)
- **pnpm**: `corepack enable && pnpm --version`
- **Container Engine**: Docker or Podman (for running sandboxed audits)

### Build and Test

```sh
# Initialize submodules
git submodule update --init

# Install dependencies
pnpm install

# Build all packages
pnpm -r build

# Run full test suite (560+ tests)
pnpm -r test

# Typecheck and lint
pnpm -r typecheck && pnpm -r lint
```

---

## 🔒 Security & Disclosure

Security is fundamental to this platform. For threat modeling, isolation architecture, and vulnerability reporting procedures, please review:

- [Security Policy](SECURITY.md)
- [Contributing Guidelines](CONTRIBUTING.md)
- [Sandbox Threat Model](packages/sandbox/README.md)

---

## 📄 License & Attribution

- Licensed under the **Apache License, Version 2.0** ([LICENSE](LICENSE)).
- Vendored `security-audit-skill` is copyright (c) Cloudflare, Inc. and licensed under the **MIT License** ([NOTICE](NOTICE)).
