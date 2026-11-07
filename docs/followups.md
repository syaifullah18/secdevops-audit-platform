# Follow-ups

Items found during lead review and testing. Owner in brackets.

- [WS9] `packages/adapters/test/http.test.ts` "retries on timeout ..." is timing-sensitive and failed
  once under load (passed 5/5 on rerun). Make it deterministic with fake timers.
- [WS9] Org Overview "Findings by Verification Verdict" counts only open findings, so the
  "rejected" row stays 0 even with "Show rejected findings" on (rejected findings are closed as
  `false_positive`). Count all rejected findings in that row, or relabel it.
- [Phase 2] Apply WS2 contract requests in `packages/core` (`docs/workstreams/WS2-contract-request.md`):
  per-project webhook secret ref, exception revoke + policy clientId, atomic event seq, store readiness probe.
- [Phase 2] `apps/worker/src/fakes.ts` holds test fakes (incl. a non-isolating sandbox) in `src`;
  make sure production wiring never uses them, or move them to `test/`.
- [Testing note] Orca browser `click` on refs stopped navigating after `goto`/`eval` in the same tab;
  native `element.click()` worked. Not an app bug; drive navigation with `goto` when testing.
