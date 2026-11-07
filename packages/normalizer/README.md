# @sdap/normalizer

Normalizer, deduplication, fingerprinting, and findings store mapper for the SecDevOps Audit Platform.

Owner: workstream **WS3** (see `docs/workstreams/WS3.md`).

## Responsibilities

1. **Schemas & Parsing (`src/schemas.ts`)**:
   - Mirrors Cloudflare's `security-audit-skill` `report-schema.json` for `findings.json` across all three canonical verdict variants (`confirmed`, `needs_validation`, `rejected`).
   - Parses `coverage-ledger.json` units as verified by `validate-coverage-ledger.cjs`.

2. **Verdict Normalization (`src/verdict.ts`)**:
   - Maps canonical, legacy, and model-specific verdict words:
     - `CONFIRMED | VALID | TRUE_POSITIVE` → `confirmed`
     - `PLAUSIBLE | PARTIAL | NEEDS_VALIDATION | UNVERIFIED | INCONCLUSIVE` → `needs_validation`
     - `REFUTED | REJECTED | FALSE_POSITIVE | INVALID` → `rejected`
   - Case-, surrounding whitespace-, and delimiter-insensitive.
   - Throws `UnknownVerdictError` on unrecognized terms (never silently defaults).

3. **Salvage (`src/salvage.ts`)**:
   - Tolerant reader that strips provider filter notices, markdown fences, and prose wrapping JSON.
   - Recovers concatenated top-level JSON objects (`{..}{..}` or `[..][..]`) and merges them into a single array.

4. **Attack Class Mapping (`src/attack-class.ts`)**:
   - Maps coverage ledger unit `canonical_refs.attack_class` to platform attack-class families (`authn`, `authz`, `injection`, `config`, `supply_chain`, `client_side`, `data_isolation`, `resource_exhaustion`, `crypto`, `secrets`, `other`).
   - Conforms to Decision D-006.

5. **Fingerprinting (`src/fingerprint.ts`)**:
   - Primary identity: skill-provided `fingerprint`.
   - Secondary identity: `secondaryFingerprint(finding)` computed as a line-independent SHA-256 hash of attack class, normalized sink file, sink scope, and root cause words. Enables tracking when source code moves or refactors.
   - Deterministic UUIDv5 generator for stable platform finding IDs.

6. **Merging & Deduplication (`src/merge.ts`)**:
   - Matches existing findings first by primary `fingerprint`, then by `secondaryFingerprint`.
   - Preserves `id`, `firstSeen`, `firstRun`, `status`, `owner`.
   - Updates `lastSeen`, `sourceRun`, `location`, `trace`, and `evidence`.
   - Records verdict transitions (e.g. `confirmed → rejected`).
   - Detects regressions: a `fixed` finding re-confirmed in a subsequent run resets status to `confirmed` and restarts SLA.
   - Collapses repeat-N observations into one finding with the strongest verdict, highest verified severity, and boosted confidence score.

7. **SLA (`src/normalize.ts`)**:
   - Computes SLA due dates via `computeSlaDue` based on verified severity from `firstSeen`.

## Scripts

- `pnpm build`: compile TypeScript to `dist/`
- `pnpm typecheck`: typecheck without emit
- `pnpm lint`: run ESLint
- `pnpm test`: execute Vitest unit and golden-file suites
