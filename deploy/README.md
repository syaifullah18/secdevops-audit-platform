# Deployment, observability and metrics (WS7)

Everything needed to run the SecDevOps Audit Platform for evaluation (Docker Compose) or on
Kubernetes (Helm), plus the Prometheus metrics contract, Grafana dashboards and alert rules.
CI templates live in `deploy/ci` (WS6) and the sandbox runtime in `deploy/sandbox` (WS8).

| Path                        | What                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `../docker-compose.yml`     | Evaluation stack: api, worker, web, postgres 17, redis 7, prometheus, loki, alloy, grafana    |
| `compose/`                  | Overrides (`docker-compose.dev.yml`, `docker-compose.hardened.yml`) and `env.compose.example` |
| `../apps/*/Dockerfile`      | Multi-stage, Node 24 slim build, non-root, `pnpm deploy --prod`                               |
| `web/default.conf.template` | nginx config for the web image (static files, `/api` proxy, SSE-safe)                         |
| `postgres/10-init.sh`       | Applies Drizzle migrations on first start and creates the read-only Grafana role              |
| `prometheus/prometheus.yml` | Scrapes `api:8080/metrics` and `worker:9464/metrics`                                          |
| `loki/`                     | Loki config and Grafana Alloy log shipper (`service` and `level` labels only)                 |
| `grafana/`                  | Provisioning (datasources, dashboards, alert rules) and the two dashboards                    |
| `helm/sdap/`                | Helm chart (api, worker, web; external Postgres and Redis by default)                         |

## Quick start (Docker Compose)

```sh
cp .env.example .env
cat deploy/compose/env.compose.example >> .env   # optional: ports, passwords, retention
docker compose up --build
```

- Web: http://localhost:3000, API: http://localhost:8080, Grafana: http://localhost:3001
  (`admin` / `GRAFANA_ADMIN_PASSWORD`, default `sdap-change-me`).
- Every port is bound to `127.0.0.1`; Postgres, Redis, Prometheus and Loki are not published.
  Use `-f deploy/compose/docker-compose.dev.yml` to publish them locally.
- All passwords have evaluation-only defaults. Set `POSTGRES_PASSWORD`, `GRAFANA_PG_PASSWORD` and
  `GRAFANA_ADMIN_PASSWORD` before exposing the stack. For shared hosts add
  `-f deploy/compose/docker-compose.hardened.yml` and configure OIDC (dev tokens are refused in
  production).
- **No telemetry:** Grafana analytics, update checks and the news feed are off, Loki and Alloy
  reporting are off, and `SDAP_TELEMETRY` defaults to `off`.
- Podman: set `CONTAINER_SOCKET` to the Podman API socket so Alloy can tail logs.

> **Status:** `docker compose config` and `docker compose up` need the Docker Compose plugin, which
> was not available when this was written. The compose file, overrides, Prometheus, Loki, Alloy,
> Grafana provisioning and the Postgres init script were validated individually (see "Verification").
> A full `docker compose up` to a healthy stack is verified in Phase 2, once the worker has a process
> entrypoint (see below).

## Metrics contract

Both `apps/api/src/metrics.ts` and `apps/worker/src/metrics.ts` export `createMetrics(registry?)`
and register these metrics (plus default process metrics) on a fresh `Registry`:

| Metric                                                                           | Type      |
| -------------------------------------------------------------------------------- | --------- |
| `sdap_findings{severity,verdict,status,project}`                                 | gauge     |
| `sdap_runs_total{status,mode,project}`                                           | counter   |
| `sdap_run_duration_seconds{mode,status}`                                         | histogram |
| `sdap_run_failures_total{phase,reason}`                                          | counter   |
| `sdap_queue_depth{queue,state}`                                                  | gauge     |
| `sdap_tokens_total{phase,adapter,model,direction}`                               | counter   |
| `sdap_cost_usd_total{phase,adapter,model,direction}`                             | counter   |
| `sdap_slice_attempts_total{phase,adapter,model,outcome}` (fallbacks are visible) | counter   |
| `sdap_jev_decisions_total{key,outcome}`                                          | counter   |
| `sdap_jev_precision{key}` (System 1 is advisory only)                            | gauge     |

Rules: labels are bounded enums or ids, never finding titles, paths or code. Only `confirmed`
findings count towards gate-related panels and alerts. The handles are not wired into routes or jobs
yet (Phase 2); the API exports `metricsHandler` and the worker `startMetricsServer`. Both support an
optional bearer token, because unauthenticated metrics endpoints are a known leak (a repeated pattern in the PRD pilot evidence).

## Dashboards and alerts

- **SDAP Overview:** open confirmed findings, SLA breaches (PostgreSQL), findings by severity,
  status and verdict, runs by status, failures by phase and reason, queue depth, duration p50/p95,
  tokens and cost.
- **SDAP Models:** attempts and outcomes by model, fallback and failure rate, tokens and cost by
  model, Jev precision and decisions.
- **Alert rules** (`grafana/provisioning/alerting/rules.yml`): run failure rate over 20% for 10m,
  confirmed findings past SLA (> 0), run queue backlog over 20 for 10m. Add contact points in
  Grafana; webhook URLs are credentials and are not part of the repository.

Dashboards are provisioned read-only (`allowUiUpdates: false`); edit the JSON and reload.

## Logs

Alloy tails the compose project's containers and pushes to Loki with two labels: `service` and
`level`. Run id, project and phase stay in the JSON log line: use
`{service="worker"} | json | run_id="..."`. Do not promote high-cardinality fields to labels.

## Kubernetes (Helm)

```sh
kubectl create secret generic sdap-secrets \
  --from-literal=DATABASE_URL=... --from-literal=REDIS_URL=...
helm install sdap deploy/helm/sdap --set secrets.existingSecret=sdap-secrets \
  --set image.registry=registry.example.internal --set config.oidcIssuerUrl=https://idp.example.internal
```

- Secrets are referenced by name (`secrets.existingSecret`); the chart contains no values.
- PostgreSQL and Redis are external by default. `postgres.enabled` / `redis.enabled` add
  single-replica evaluation instances.
- `worker.runtimeClassName` selects the gVisor RuntimeClass for the worker pods.
- `worker.networkPolicy` limits worker egress to DNS, the in-chart datastores, public HTTPS (never
  private ranges or the cloud metadata endpoint) and anything you add in `extraEgress`
  (for example the CIDR of an external PostgreSQL). Disable `allowPublicHttps` for air-gapped installs.
- Pods run as non-root with read-only root filesystems, dropped capabilities and the
  `RuntimeDefault` seccomp profile. Prometheus discovers pods through the `prometheus.io/*` annotations.
- `helm lint deploy/helm/sdap` works with the defaults (no secret is needed to render).

## Verification

Tools available when this was written: Podman (Docker API), no `docker compose`, no `helm`.

| Check                                                              | How                                                                  |
| ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Unit and parse tests (metrics, compose, dashboards, alerts, chart) | `pnpm --filter @sdap/api test` and `pnpm --filter @sdap/worker test` |
| Dockerfiles                                                        | Built with Podman; api and web run, containers are non-root          |
| Postgres init script and read-only role                            | Run in `postgres:17-alpine`; `DELETE` as the role is rejected        |
| `prometheus.yml`, `loki.yaml`, `config.alloy`                      | `promtool check config`, `loki -verify-config`, `alloy validate`     |
| Grafana provisioning (datasources, both dashboards, 3 alert rules) | Loaded by `grafana/grafana:12.1.0` and read back through its API     |
| `docker compose config`, `docker compose up` healthy               | **Deferred to Phase 2** (plugin not installed)                       |
| `helm lint`, `helm template`                                       | **Deferred** (helm not installed); static checks in `helm.test.ts`   |

## Known gaps

- `apps/worker` has no process entrypoint (`src/main.ts`), so the worker container exits until WS1
  adds one that builds `createAuditWorker`, starts `startMetricsServer`, and handles `SIGTERM`.
- The API does not mount `/metrics` yet and nothing increments the metrics (Phase 2 wiring).
- `prom-client@15.1.3` is the latest release and is marked deprecated on npm in favour of
  `@prometheus-io/client`. The PRD names `prom-client`, so it is kept; the metrics modules are the
  only code to change if the dependency is swapped.
