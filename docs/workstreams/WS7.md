# WS7 Observability + deploy

- **Runner / model:** agy / `gemini-3.8-flash-medium` (fallback claude / `claude-sonnet-5-5`)
- **Branch:** `ws/WS7`
- **Paths:** `deploy/**` (except `deploy/ci/**` WS6 and `deploy/sandbox/**` WS8),
  `apps/api/src/metrics.ts`, `apps/worker/src/metrics.ts`, `apps/*/Dockerfile`, `docker-compose.yml`,
  `.dockerignore`, and the `prom-client` dependency line in `apps/api` and `apps/worker` package.json.
- **Consumes (core):** `Severity`, `FindingStatus`, `Verdict`, `PhaseName`, `RunStatus`

## Goal

Prometheus metrics, Grafana dashboards, Loki labels, Docker Compose for one-command evaluation,
and a Helm chart.

## Deliverables

1. `apps/api/src/metrics.ts` and `apps/worker/src/metrics.ts`: each exports
   `createMetrics(registry?: Registry)` returning typed metric handles and the registry.
   Metric names (prefix `sdap_`):
   - `sdap_findings{severity,verdict,status,project}` gauge
   - `sdap_runs_total{status,mode,project}` counter
   - `sdap_run_duration_seconds{mode,status}` histogram
   - `sdap_run_failures_total{phase,reason}` counter
   - `sdap_queue_depth{queue,state}` gauge
   - `sdap_tokens_total{phase,adapter,model,direction}` counter, `sdap_cost_usd_total{...}` counter
   - `sdap_slice_attempts_total{phase,adapter,model,outcome}` counter (fallbacks visible)
   - `sdap_jev_decisions_total{key,outcome}` and `sdap_jev_precision{key}` gauge
     Plus default process metrics. No metric label may contain finding titles or code.
     Do not wire them into routes/jobs (Phase 2); export a `metricsHandler` for the API.
2. Dockerfiles for api, worker, web (multi-stage, Node 24 slim, non-root, pnpm deploy).
3. `docker-compose.yml` at repo root (and `deploy/compose/` overrides): api, worker, web,
   postgres 17, redis 7, prometheus, grafana, loki; healthchecks; named volumes; env from
   `.env.example`; Grafana provisioned with Prometheus + read-only PostgreSQL datasources and
   dashboards. No telemetry enabled anywhere (Grafana analytics off).
4. `deploy/grafana/dashboards/`: "SDAP Overview" (findings by severity/status, runs, failures,
   queue depth, duration, tokens/cost) and "SDAP Models" (attempts by model, fallback rate,
   Jev precision). `deploy/prometheus/prometheus.yml` scraping api and worker.
   Grafana alert rules: run failure rate, SLA breach count, queue backlog.
5. `deploy/helm/sdap/`: Chart with api, worker, web Deployments, Services, ConfigMap, Secret refs
   (no values), optional Postgres/Redis via values (external by default), worker
   `runtimeClassName` value for gVisor, NetworkPolicy restricting worker egress.

## Acceptance criteria

- Unit tests for both `metrics.ts` (metrics register, label sets as above, `/metrics` text
  contains `sdap_` names).
- Test that every Grafana dashboard JSON parses and references only metrics defined above.
- `docker compose config` succeeds; `helm lint deploy/helm/sdap` succeeds if helm is installed
  (document otherwise). `docker compose up` starts a healthy stack is verified in Phase 2.
- `pnpm -r typecheck lint test` green. `deploy/README.md`.

## Out of scope

Sandbox runtime config (WS8), CI templates (WS6).
