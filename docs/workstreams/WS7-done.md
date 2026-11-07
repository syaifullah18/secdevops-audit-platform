# WS7 Observability + deploy: Done Report

Branch `ws/WS7`. Paths: `deploy/**` (not `ci/`, `sandbox/`), `apps/{api,worker}/src/metrics.ts`,
`apps/*/Dockerfile`, `docker-compose.yml`, `.dockerignore`, the `prom-client` dependency lines.

A first pass (Gemini Flash) had only added `prom-client` to `apps/api` and `apps/worker` and the lockfile.
Reviewed and kept. The lockfile diff also bumped `drizzle-orm`'s peer resolution to include
`@opentelemetry/api` (pulled in by `prom-client`); that is harmless and expected.

## Complete

- **Metrics modules** (`apps/api/src/metrics.ts`, `apps/worker/src/metrics.ts`): `createMetrics(registry?)`
  returns typed handles and the registry for every `sdap_*` metric on the card, with default process
  metrics, on a fresh `Registry` (no global state). API exports `metricsHandler(registry, { bearerToken? })`;
  the worker exports `startMetricsServer` (minimal `/metrics` + `/healthz`). `sanitizeLabelValue` bounds
  free-form label values. Tests cover registration, label sets, rejection of unknown labels, the text
  exposition and the bearer token.
- **Dockerfiles** for api, worker, web: multi-stage, `node:24-slim` build, `pnpm deploy --prod`, non-root
  (`node` uid 1000; nginx-unprivileged uid 101 for web). Built with Podman; api and web images run, worker
  image contains git and the vendored skill.
- **`docker-compose.yml`** (+ `deploy/compose/` dev and hardened overrides, `env.compose.example`):
  api, worker, web, postgres 17, redis 7, prometheus, loki, alloy (log shipper), grafana; healthchecks,
  named volumes, localhost-only ports, env from `.env.example`. Grafana analytics, update checks and news
  off; Loki/Alloy reporting off.
- **Grafana:** provisioned Prometheus, read-only PostgreSQL (SELECT-only role created by
  `deploy/postgres/10-init.sh`) and Loki datasources; dashboards "SDAP Overview" and "SDAP Models";
  alert rules for run failure rate, confirmed findings past SLA, and queue backlog.
  `prometheus/prometheus.yml` scrapes api and worker. Loki labels are `service` and `level` only.
- **Helm chart** `deploy/helm/sdap`: api/worker/web Deployments and Services, ConfigMap, Secret references
  (no values), optional evaluation Postgres/Redis (external by default), worker `runtimeClassName` (gVisor),
  worker egress NetworkPolicy, optional Ingress, non-root/read-only/seccomp pod security.
- **Tests** (`apps/api/test/deploy/*.test.ts`, 44 tests): every dashboard and alert query references only
  metrics and labels that exist in the real registry; compose, overrides, Prometheus, Loki, Alloy, Dockerfiles
  and Helm chart are parse-checked (yaml); Helm `.Values` references resolve and template blocks balance.
- `deploy/README.md` documents the stack, the metrics contract, dashboards, alerts, logs and verification.

## Verified with real tools (beyond the unit tests)

Podman builds of all three images; `sdap-api` boots (imports resolve, stops at the missing Redis);
`sdap-web` serves `/healthz` and SPA routes as uid 101; the Postgres init script applies the Drizzle
migration and creates a role that can `SELECT` but not `DELETE`; `promtool check config`,
`loki -verify-config` and `alloy validate` pass; `grafana/grafana:12.1.0` loads all three datasources,
both dashboards and all three alert rules from the provisioning files.

## Mocked / not verifiable here

- `docker compose config` and `docker compose up` (plugin not installed): **Phase 2**. Compose YAML is
  parse-tested only.
- `helm lint` / `helm template` (helm not installed): chart is statically checked in `helm.test.ts` only.
  Please run `helm lint deploy/helm/sdap` once helm is available.

## Deferred / needs follow-up

- **Worker entrypoint:** `apps/worker` has no `src/main.ts`, so `CMD ["node", "dist/main.js"]` in the worker
  image (and the compose/Helm worker) cannot start yet. WS1 should add one that builds `createAuditWorker`,
  calls `startMetricsServer(registry)` and handles `SIGTERM`. Marked `TODO` in the Dockerfile.
- Wiring (Phase 2): mount `/metrics` in the API, increment metrics from routes, pipeline and queue sampler.
- `sdap_findings` and `sdap_queue_depth` are gauges that need a periodic collector (store aggregation,
  BullMQ `getJobCounts`); not written because wiring is out of scope.
- Contact points / notification policies for Grafana alerts are operator-specific and not provisioned.
- Loki is single-binary with filesystem storage and no auth (internal network only); production should use
  object storage and a gateway.

## Decisions and deviations (simplest reasonable choice)

- **`.prettierignore` (root file) got one line**, `deploy/helm/*/templates/`: Helm templates contain Go
  template actions and are not valid YAML, so `prettier --check .` would otherwise fail. Revert it if you
  prefer another approach (for example naming templates `.tpl`, which Helm treats differently).
- **`yaml` devDependency added to `apps/api`** (outside the "prom-client line only" ownership) because the
  parse tests need it and the card asks for the yaml package. The deploy tests live in `apps/api/test/deploy/`
  so they can import `createMetrics` and check dashboards against the real registry.
- **Web runtime is nginx-unprivileged** rather than Node: the build stage is Node 24 slim, but serving static
  files and proxying SSE is simpler and safer with nginx than with a hand-written Node server.
- **Grafana alerting provisioning** uses Grafana-managed rules with the PostgreSQL datasource for the SLA
  alert (no SLA metric exists in the contract; a gauge such as `sdap_sla_breaches` could replace it).
- **Alloy instead of Promtail** for log shipping (Promtail is end-of-life). It mounts the container runtime
  socket read-only, configurable with `CONTAINER_SOCKET`.
- **Metrics are optional-token protected** (`bearerToken`), so an exposed API port does not leak operational
  data; Prometheus config documents the matching `authorization` block.
- **`prom-client@15.1.3` is flagged deprecated** by npm in favour of `@prometheus-io/client` but is the
  latest release and what the PRD names. Kept.
- No contract changes needed, so no `WS7-contract-request.md`.
