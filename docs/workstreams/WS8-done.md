# Workstream WS8 Done Receipt: Sandbox Runner

- **Workstream:** WS8 (Sandbox runner)
- **Branch:** `ws/WS8`
- **Owner package:** `packages/sandbox`
- **Deployment assets:** `deploy/sandbox`
- **Status:** Complete (DONE)

---

## Deliverables & Acceptance Verification

| Deliverable / Requirement                                  |  Status  | Evidence / Implementation                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------- | :------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`DockerSandboxRunner` (`kind: "docker-hardened"`)**      | Complete | `packages/sandbox/src/docker-runner.ts`: hardened Docker spawn with argv array (never shell string), `--read-only`, `--tmpfs /tmp:rw,noexec,nosuid,size=64m`, target mounted `ro` at `/target`, output `rw` at `/out`, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--pids-limit`, `--cpus`, `--memory`, non-root `--user`, env strictly from `policy.env`, timeout termination.                                                                           |
| **gVisor support (`kind: "gvisor"`)**                      | Complete | `DockerSandboxRunner` detects or takes `runtime: "runsc"`. Reports `kind: "gvisor"`, passes `--runtime runsc` to Docker/Podman CLI. Live test skips cleanly when daemon lacks runsc.                                                                                                                                                                                                                                                                                 |
| **Egress allowlist & proxy**                               | Complete | `packages/sandbox/src/proxy.ts`: HTTP forward & HTTPS CONNECT proxy strictly allowing `policy.egressAllowlist` hosts/wildcards and returning 403 Forbidden for unlisted egress. Containers with empty allowlist receive `--network none`.                                                                                                                                                                                                                            |
| **`NoSandboxRunner` (`kind: "none"`, `enforcing: false`)** | Complete | `packages/sandbox/src/no-sandbox.ts`: local process runner for dev/testing. Sanitizes host env (only `policy.env` + minimal PATH), enforces timeout kill. Sets `enforcing: false` so worker keeps execution-dependent leads `needs_validation`.                                                                                                                                                                                                                      |
| **`preflight()` method**                                   | Complete | Both runners implement `preflight(policy?)`: verifies Docker/Podman daemon and `runsc` availability, and validates policy configuration if supplied.                                                                                                                                                                                                                                                                                                                 |
| **`deploy/sandbox/` artifacts**                            | Complete | - `runsc-install.md`: installation and daemon setup guide.<br>- `daemon.json`: Docker daemon runtime configuration snippet.<br>- `gvisor-runtimeclass.yaml`: Kubernetes `RuntimeClass` resource.<br>- `seccomp.json`: Hardened seccomp profile with `SCMP_ACT_ERRNO` default.<br>- `firecracker-profile.stub.json` & `firecracker-profile.md`: Firecracker profile stub documented as future.<br>- `egress-proxy/`: Multi-stage Dockerfile and standalone server.js. |
| **Input hardening**                                        | Complete | `packages/sandbox/src/validation.ts`: rejects relative/escaping mount paths, reserved system paths (`/`, `/proc`, `/sys`, `/dev`), control characters in argv/paths/env, and validates env keys match `^[A-Z_][A-Z0-9_]*$`.                                                                                                                                                                                                                                          |
| **Threat model documentation**                             | Complete | `packages/sandbox/README.md` details threat model, attacks mitigated, and comprehensive enforcement matrix across runner kinds.                                                                                                                                                                                                                                                                                                                                      |

---

## Acceptance Criteria Verification

1. **Egress blocked**:
   - `test/docker-runner.test.ts`: Proves egress to unlisted hosts fails when `egressAllowlist` is empty (`--network none`).
   - `test/docker-runner.test.ts` & `test/proxy.test.ts`: Proves request to allowlisted test server succeeds and non-allowlisted destination is rejected with 403 Forbidden.
2. **Writes outside output directory fail**:
   - `test/docker-runner.test.ts`: Writing to `/target`, `/`, and `/etc` fails with "Read-only file system". Writing to `/out` succeeds and file appears on host with matching contents. Writing to `/tmp` succeeds in tmpfs.
3. **Environment sanitization**:
   - Host environment variables (e.g. `LEAK_TEST_SECRET`) are not visible inside sandbox containers or `NoSandboxRunner` processes. Only explicitly allowed `policy.env` variables are exposed.
4. **Timeout kill**:
   - Containers and host processes exceeding `policy.timeoutSec` are terminated with SIGKILL and flagged with `killedBy: "timeout"`.
5. **Memory limit & OOM**:
   - Memory-hungry processes exceeding `policy.memoryMb` are killed and flagged with `killedBy: "oom"`.
6. **Graceful skips on absent daemon**:
   - Integration tests detect Docker/Podman availability and runsc availability in `beforeAll`, skipping live container tests cleanly when unavailable while argv and validation unit tests always run.

---

## Summary of Complete, Mocked, and Deferred

- **Complete**:
  - Full implementation of `DockerSandboxRunner` (`docker-hardened` and `gvisor`).
  - Full implementation of `NoSandboxRunner` (`none`, non-enforcing).
  - Built-in Node `EgressProxy` and standalone containerized egress proxy server.
  - Robust input hardening, path traversal prevention, and control character rejection.
  - Complete `deploy/sandbox/` operational manifests, guides, and security profiles.
  - Unit and integration tests covering all acceptance criteria.
  - Package documentation and threat model.
- **Mocked**:
  - Test suite uses synthetic local target directories and mock HTTP servers for integration verification; no real client code or secrets.
- **Deferred**:
  - Firecracker microVM runner implementation deferred to Phase 2 (architectural specification and stub profile provided in `deploy/sandbox/firecracker-profile.*`).
  - Orchestrator wiring: WS1 consumes `SandboxRunner` interface in Phase 2; worker integration is out of scope for WS8 Phase 1.
