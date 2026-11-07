# WS3 Normalizer + Findings Store: Done Report

## Overview

Workstream WS3 is responsible for `@sdap/normalizer` and `apps/api/src/db/**` (plus `apps/api/drizzle/**`).
Branch: `ws/WS3`.

## Complete

1. **`@sdap/normalizer`**:
   - **Raw Zod Schemas (`src/schemas.ts`)**:
     - Mirrors Cloudflare's `security-audit-skill` `report-schema.json` across all three canonical verdict variants (`confirmed`, `needs_validation`, `rejected`).
     - Parses `coverage-ledger.json` unit structures mirroring `validate-coverage-ledger.cjs`.
   - **Verdict Mapping (`src/verdict.ts`)**:
     - Exact, case-insensitive, space/hyphen/underscore-insensitive mapping:
       - `CONFIRMED | VALID | TRUE_POSITIVE` → `confirmed`
       - `PLAUSIBLE | PARTIAL | NEEDS_VALIDATION | UNVERIFIED | INCONCLUSIVE` → `needs_validation`
       - `REFUTED | REJECTED | FALSE_POSITIVE | INVALID` → `rejected`
     - Unknown verdict terms throw `UnknownVerdictError` (never silently defaulted).
   - **Salvage (`src/salvage.ts`)**:
     - Tolerant JSON parser stripping provider safety/content filter notices, markdown code blocks, and prose.
     - Recovers concatenated top-level JSON objects (`{..}{..}` or `[..][..]`) and collapses them into a single array.
   - **Attack Class Mapping (`src/attack-class.ts`)**:
     - Maps `canonical_refs.attack_class` to platform attack-class families according to Decision D-006.
   - **Fingerprinting (`src/fingerprint.ts`)**:
     - Retains skill `fingerprint` as primary source identity.
     - Computes line-independent `secondaryFingerprint` (SHA-256 of attack class, normalized sink file, sink scope, and root cause keywords) for carry-forward when code is moved or refactored.
     - Generates stable UUIDv5 platform finding IDs via `deterministicFindingId`.
   - **Normalization (`src/normalize.ts`)**:
     - Produces core `Finding[]` objects validated against `Finding.parse`.
     - Assigns location from sink trace step (falling back to first step).
     - Derives originalSeverity from hunter candidate, verifiedSeverity from `severity.overall_severity` for confirmed findings, blockers for needs_validation, and rejectionReason for rejected findings.
     - Computes SLA due dates via `computeSlaDue` based on verified severity.
   - **Merging & Deduplication (`src/merge.ts`)**:
     - Dedup matches by primary fingerprint, then secondary fingerprint.
     - Carries forward initial identity (`id`), origin timestamps (`firstSeen`, `firstRun`), and triage state (`status`, `owner`).
     - Updates `lastSeen`, `sourceRun`, `location`, `trace`, and `evidence`.
     - Handles verdict transitions (`confirmed → rejected` preserves status and records change).
     - Handles regressions (`fixed` re-confirmed resets status to `confirmed` and restarts SLA).
     - Collapses repeat-N observations into one finding with the strongest verdict, highest severity, and boosted confidence.
   - **Unit & Golden-file Test Suite (`packages/normalizer/test/`)**:
     - `golden.test.ts`: Golden file tests for mixed verdicts, legacy verdict words, and concatenated raw output.
     - `salvage.test.ts`: Salvage unit tests for fragments, notices, and markdown fences.
     - `verdict.test.ts`: Thorough verdict mapping permutations and error handling.
     - `merge.test.ts`: Moved code dedup, status carry-forward, regression handling, repeat-N collapse, and SLA logic.

2. **`apps/api/src/db` & `apps/api/drizzle`**:
   - **Drizzle Schema (`apps/api/src/db/schema.ts`)**:
     - 10 tables: `policies`, `projects`, `runs`, `run_phases`, `slices`, `findings`, `triage_events`, `exceptions`, `events`, `decisions`.
     - Unique constraint `(project_id, fingerprint)` and secondary index on `secondary_fingerprint` for findings.
     - Unique constraint `(run_id, seq)` for append-only monotonic events.
     - Composite primary key `(run_id, name)` on `run_phases`.
     - `slices.attempts` stored as `jsonb`.
     - Multi-tenant indexing on `projects.client_id`.
   - **Migrations (`apps/api/drizzle/`)**:
     - Migration `0000_productive_the_spike.sql` and journal metadata generated via `drizzle-kit generate`.
   - **PostgreSQL Store Implementation (`apps/api/src/db/store.ts`)**:
     - `createPgStore(databaseUrlOrPool): Store` implementing all repo interfaces (`projects`, `runs`, `findings`, `policies`, `events`, `decisions`).
     - Enforces `AccessScope` on every project, run, and finding query through `projects.client_id` join.
     - `findings.upsert` implements `mergeFindings` semantics.
     - Full transaction support via `store.tx(...)`.
     - Connection pool cleanup via `store.close()`.
   - **Database Tests (`apps/api/test/store.test.ts`)**:
     - Skips cleanly when `DATABASE_URL` is unset with clear console notification.
     - Full integration suite when `DATABASE_URL` is provided, including multi-tenant isolation verification.

3. **Documentation**:
   - Updated `packages/normalizer/README.md`.
   - Created `apps/api/src/db/README.md`.

## Mocked / Synthetic

- Synthetic golden fixtures in `packages/normalizer/test/golden/` use mock repository paths (`src/orders/...`, `src/auth/...`) with no real proprietary source code or client names.
- Integration tests in `apps/api/test/store.test.ts` use synthetic test tenants (`client-alpha`, `client-beta`) and synthetic repositories.

## Deferred

- Calling the normalizer inside the worker execution pipeline (deferred to Phase 2 orchestration wiring in WS1).
- Fastify HTTP endpoints exposing finding and store operations (owned by WS2).

## Gate Output Summary

- `pnpm install`: All 9 workspace packages up to date.
- `pnpm -r typecheck`: All workspace packages clean (0 errors).
- `pnpm -r lint`: All workspace packages clean (0 errors, 0 warnings).
- `pnpm -r test`: 8 of 8 active test packages passing (48 total tests passed, 3 skipped when DB unset).
- `pnpm format:check`: All matched files conform to Prettier code style.
