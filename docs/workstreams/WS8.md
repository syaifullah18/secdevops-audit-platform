# WS8 Sandbox runner

- **Runner / model:** claude / `claude-opus-5-5` (fallback claude / `claude-sonnet-5-5`)
- **Branch:** `ws/WS8`
- **Paths:** `packages/sandbox/**`, `deploy/sandbox/**`
- **Consumes (core):** `SandboxRunner`, `SandboxPolicy`, `SandboxExecRequest`, `SandboxExecResult`

## Goal

Run agent CLIs and target code with OS-enforced isolation: no network except allowlisted model
endpoints, sanitized env, CPU/memory/time limits, read-only target mount, writes only to the
output dir (PRD 5.3, 10).

## Deliverables

1. `DockerSandboxRunner` (`kind: "docker-hardened"`, with `runtime: "runsc"` when gVisor is
   available → `kind: "gvisor"`): `docker run` via `node:child_process` `spawn` with an argv array
   (never a shell string): `--network` on an internal network whose only egress is an allowlist
   proxy, `--read-only`, `--tmpfs /tmp`, target mounted `ro` at `/target`, output `rw` at
   `/out`, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--pids-limit`, `--cpus`,
   `--memory`, non-root `--user`, `--env` only from `policy.env`, timeout with kill.
2. **Egress allowlist**: a small forward proxy (container or Node `http` CONNECT proxy) that only
   allows `policy.egressAllowlist` hosts; everything else is refused. With an empty allowlist the
   container gets `--network none`.
3. `NoSandboxRunner` (`kind: "none"`, `enforcing: false`) for local development only; the worker
   uses `enforcing` to keep execution-dependent leads `needs_validation`.
4. `preflight()`: checks docker/runsc availability and that the policy can be applied.
5. `deploy/sandbox/`: gVisor `runsc` install notes and Docker daemon config, a Firecracker
   profile stub (documented as future), a seccomp profile, the egress proxy image, a Kubernetes
   `RuntimeClass` for gVisor.
6. Input hardening: reject relative/escaping mount paths, control characters in argv, env keys
   that are not `[A-Z_][A-Z0-9_]*`.

## Acceptance criteria

- **Tests prove egress is blocked**: inside the sandbox, a request to a non-allowlisted host fails
  and (when an allowlist is set) a request to a local allowlisted test server succeeds.
- **Tests prove writes outside the output dir fail**: writing to `/target`, `/`, `/etc` fails;
  writing to `/out` succeeds and appears on the host.
- Tests for env sanitization (host env vars not visible), timeout kill, memory limit.
- Docker-dependent tests are skipped with a clear message when Docker is not reachable; unit tests
  for argv construction and input validation always run.
- `pnpm -r typecheck lint test` green. README with the threat model and what is and is not
  enforced per runner kind.

## Out of scope

Calling the sandbox from the worker (WS1 codes against the interface; wiring in Phase 2).
