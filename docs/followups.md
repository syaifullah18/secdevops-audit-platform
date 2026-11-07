# Follow-ups

Items found during lead review and testing. Owner in brackets.

- [done] `packages/adapters/test/http.test.ts` timeout-retry test made load-independent by the lead.
- [done] Org Overview "Findings by Verification Verdict" counts only open findings, so the
  "rejected" row stays 0 even with "Show rejected findings" on (rejected findings are closed as
  `false_positive`). Fixed: now counts all rejected candidates in that row.
- [done] Apply WS2 contract requests in `packages/core` (`docs/workstreams/WS2-contract-request.md`):
  per-project webhook secret ref, exception revoke + policy clientId, atomic event seq, store readiness probe.
- [done] `apps/worker/src/fakes.ts` holds test fakes (incl. a non-isolating sandbox) in `src`;
  moved to `apps/worker/test/fakes.ts`.
- [Testing note] Orca browser `click` on refs stopped navigating after `goto`/`eval` in the same tab;
  native `element.click()` worked. Not an app bug; drive navigation with `goto` when testing.
- [done] Sandbox cleanup is not robust under load: during a parallel full-gate run, one live run
  leaked its egress sidecar, sandbox container and `--internal` network (caught by the
  "nothing may outlive a run" test). Fixed: retried container and network removal with backoff,
  endpoint disconnection on removal, and race-free termination on timeout/abort.
- [done] `apps/worker` has no `main.ts`: implemented `apps/worker/src/main.ts` with Prometheus metrics server, real adapter registry, and graceful shutdown.
- [done] Wire `apps/api/src/metrics.ts` and `apps/worker/src/metrics.ts` into routes and jobs.
- [done] `docker-compose.yml` ships evaluation-default passwords (`sdap`, `sdap-change-me`).
  Fine for local evaluation; hardened override (`docker-compose.hardened.yml`) now enforces
  mandatory operator-set credentials for Postgres and Grafana, and Helm chart requires existingSecret.
- [done] Gate exception revoke used a strict `>` on timestamps and missed same-millisecond
  reopens (fail-open edge case); fixed to `>=` by the lead.
