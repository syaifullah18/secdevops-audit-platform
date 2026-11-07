# WS10 Workstream Completion Report: Security Self-Review & Hardening

- **Workstream**: WS10 (Security Self-Review & Platform Hardening)
- **Branch**: `main`
- **Owner**: AGY (Lead)
- **Status**: Complete

---

## 1. Scope & Objectives

The goal of WS10 is to perform a cross-cutting security self-review of the entire platform, identify subtle failure modes or attack vectors, harden platform components, and resolve outstanding security items from the follow-up log.

---

## 2. Issues Reviewed & Remediated

### 1. Robust Sandbox Resource Cleanup Under Load, Timeout, and Abort

- **Vulnerability / Flaw**: Under heavy parallel execution, early timeout, or cancellation abort signals, container and network removal could race or fail. In particular:
  - An un-awaited `docker kill` command was triggered concurrently with `docker rm -f`, causing Docker/Podman container daemon lock contention and race conditions.
  - Bridge networks with lingering or transitioning container endpoints failed removal with `network ... has active endpoints`.
  - Swallowed cleanup errors resulted in leaked `--internal` networks, sandbox containers, and egress sidecars.
- **Hardening Applied** (`packages/sandbox/src/docker-runner.ts`):
  - Added `removeContainer(name, retries = 3)` with exponential backoff.
  - Added `removeNetwork(network, retries = 5)` with active container endpoint inspection and forced detachment (`docker network disconnect -f`) before network removal.
  - Removed racing background `docker kill` invocation in favor of direct child process signal propagation combined with deterministic, retried container force-removal (`docker rm -f`) in the execution `finally` block.
  - Added `AbortSignal` checks to the egress proxy sidecar startup polling loop so that aborted runs immediately terminate without holding network or proxy locks.
- **Verification**: All 102 sandbox tests (including live container tests against Podman/Docker) pass cleanly, with zero leaked containers or networks verified by post-test audits.

### 2. Elimination of Hardcoded / Default Passwords in Production Deployments

- **Vulnerability / Flaw**: Default passwords (`sdap`, `sdap-change-me`) shipped in `docker-compose.yml` for zero-configuration local developer evaluation. If an operator deployed the stack with production overrides without explicitly defining passwords, evaluation defaults could persist into shared or production environments.
- **Hardening Applied** (`deploy/compose/docker-compose.hardened.yml`, `deploy/compose/env.compose.example`):
  - Updated `docker-compose.hardened.yml` to strictly enforce operator-supplied credentials for `POSTGRES_PASSWORD`, `GRAFANA_PG_PASSWORD`, and `GRAFANA_ADMIN_PASSWORD` using mandatory variable substitutions (`${VAR:?error_msg}`). Launching the hardened stack without explicit passwords fails fatally at startup.
  - Updated `deploy/compose/env.compose.example` with clear instructions specifying mandatory variables.
  - Verified that Kubernetes Helm charts (`deploy/helm/sdap/templates/postgres.yaml` and `values.yaml`) mandate `secrets.existingSecret` and never embed default secrets.

### 3. API Tenant Scoping & Policy Scope Enforcement

- **Vulnerability / Flaw**: Multi-tenant environments require strict policy and project data separation. If an API client can query or mutate global policies or another client's policies, tenant boundaries are violated.
- **Hardening Applied** (`apps/api/src/routes/policies.ts`, `apps/api/src/routes/projects.ts`, `packages/core/src/policy.ts`):
  - Verified and solidified tenant filtering: `policies.clientId` scopes policies to individual clients unless a tenant holds admin wildcard (`*`) scope.
  - Enforced `req.scope` propagation to all `store.policies.get(id, scope)` call sites.
  - Confirmed exception revocation uses inclusive timestamp comparison (`>=`) to prevent fail-open bypass on same-millisecond reopens (D-014).

### 4. Egress Proxy & SSRF Defenses

- **Defense-in-depth Review** (`deploy/sandbox/egress-proxy/server.cjs`, `packages/sandbox/src/egress-rules.ts`):
  - The sandbox container runs in an isolated bridge network with `--network none` when allowlist is empty, or a private `--internal` bridge network when allowlist is non-empty.
  - The egress proxy sidecar pins DNS resolution, blocks cloud metadata services (`169.254.169.254`), prevents loopback bypass, refuses IPv4-mapped IPv6 obfuscation, and strips hop-by-hop headers.
  - Unsafe proxy traversal attempts (`wget -Y off`) and direct IP connects are dropped at the packet level.

### 5. Untrusted Model & Normalizer Output Sanitization

- **Boundary Defense Review** (`packages/normalizer/src/`):
  - All outputs from LLM model adapters are validated through strict Zod parsers before entering the database.
  - Unrecognized fields, prototype-pollution attempts, or malformed CWE/OWASP identifiers are safely rejected or mapped to fallback classifications.

---

## 3. Verification & Test Receipts

- `pnpm -r build`: **Green** across all workspace packages.
- `pnpm -r typecheck`: **0 errors**.
- `pnpm -r lint`: **0 errors, 0 warnings**.
- `pnpm -r test`: **560 tests passing, 0 failures**.
- `pnpm format:check`: **Clean formatting**.
