# Workstream WS8 Done Receipt: Sandbox Runner

- **Workstream:** WS8 (Sandbox runner)
- **Branch:** `ws/WS8`
- **Owner package:** `packages/sandbox`
- **Deployment assets:** `deploy/sandbox`
- **Status:** Complete (DONE)

---

## Deliverables & Acceptance Verification

| Deliverable / Requirement                                  |                      Status                      | Evidence / Implementation                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------- | :----------------------------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`DockerSandboxRunner` (`kind: "docker-hardened"`)**      |                     Complete                     | `packages/sandbox/src/docker-runner.ts`: hardened Docker spawn with argv array (never shell string), `--read-only`, `--tmpfs /tmp:rw,noexec,nosuid,size=64m`, target mounted `ro` at `/target`, output `rw` at `/out`, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--pids-limit`, `--cpus`, `--memory`, non-root `--user`, env strictly from `policy.env`, timeout termination.                                                                           |
| **gVisor support (`kind: "gvisor"`)**                      | Complete (not live-tested: gVisor not installed) | `DockerSandboxRunner` takes `runtime: "runsc"` and reports `kind: "gvisor"`, but refuses to run until a probe shows a non-host kernel (see Security review, finding 2). On this machine the probe correctly fails and the live test asserts `exec` refuses.                                                                                                                                                                                                          |
| **Egress allowlist & proxy**                               |                     Complete                     | Per-run `--internal` network + proxy sidecar (`deploy/sandbox/egress-proxy/server.cjs`); in-process `EgressProxy` mirrors the rules (`src/egress-rules.ts`). Empty allowlist: `--network none`.                                                                                                                                                                                                                                                                      |
| **`NoSandboxRunner` (`kind: "none"`, `enforcing: false`)** |                     Complete                     | `packages/sandbox/src/no-sandbox.ts`: local dev only. Env is `policy.env` + fixed PATH; timeout/abort kill the whole process group; `enforcing: false`.                                                                                                                                                                                                                                                                                                              |
| **`preflight()` method**                                   |                     Complete                     | Both runners implement `preflight(policy?)`: verifies Docker/Podman daemon and `runsc` availability, and validates policy configuration if supplied.                                                                                                                                                                                                                                                                                                                 |
| **`deploy/sandbox/` artifacts**                            |                     Complete                     | - `runsc-install.md`: installation and daemon setup guide.<br>- `daemon.json`: Docker daemon runtime configuration snippet.<br>- `gvisor-runtimeclass.yaml`: Kubernetes `RuntimeClass` resource.<br>- `seccomp.json`: Hardened seccomp profile with `SCMP_ACT_ERRNO` default.<br>- `firecracker-profile.stub.json` & `firecracker-profile.md`: Firecracker profile stub documented as future.<br>- `egress-proxy/`: Multi-stage Dockerfile and standalone server.js. |
| **Input hardening**                                        |                     Complete                     | `packages/sandbox/src/validation.ts`: path, mount-spec, env, resource and allowlist validation plus `resolveHostMounts` (realpath, sensitive-path and overlap checks).                                                                                                                                                                                                                                                                                               |
| **Threat model documentation**                             |                     Complete                     | `packages/sandbox/README.md` details threat model, attacks mitigated, and comprehensive enforcement matrix across runner kinds.                                                                                                                                                                                                                                                                                                                                      |

---

## Acceptance Criteria Verification

All live tests below run against a real engine (Podman 5.6 machine via the Docker CLI on this
host; `DOCKER_HOST` auto-detected) and are skipped with a message when no engine is reachable.
File: `packages/sandbox/test/docker-runner.test.ts` unless noted.

1. **Egress blocked / allowlisted host reachable**: empty allowlist => only `lo`, no IP egress,
   no DNS, host unreachable. With `host.docker.internal:<port>` allowlisted, a local HTTP server
   on the host is reached through the sidecar; the same server and `1.1.1.1` are unreachable when
   the proxy is bypassed (`wget -Y off`), as is the internal network's gateway; `example.com`,
   `169.254.169.254` and another port get 403; raw `CONNECT`s to non-allowlisted/metadata targets
   get 403 while the allowlisted one gets 200; no DNS. An allowlisted public hostname
   (`example.com`) is reached when the host has internet. Proxy rules are additionally covered
   by `test/proxy-conformance.test.ts` (both implementations) and `test/proxy.test.ts`.
2. **Writes**: `/target`, `/`, `/etc`, `/usr/bin` fail with "Read-only file system"; `/out`
   write appears on the host with the expected content; `/tmp` is writable but `noexec`; extra
   mounts are read-only.
3. **Env sanitization**: a secret in the docker CLI's own environment and in `process.env` is
   not visible in the container (nor is `DOCKER_HOST`); `policy.env` is.
4. **Timeout kill**: `sleep 60` with `timeoutSec: 1` => `killedBy: "timeout"` in < 15 s; abort
   => `killedBy: "abort"`; no runner containers or networks are left behind.
5. **Memory limit**: 16 MiB limit => exit 137 with `killedBy: "oom"` (strict assertion).
6. **Also verified live**: uid 65534, `CapEff`/`CapBnd` 0, `NoNewPrivs: 1`, pids limit, stdin,
   output cap, seccomp profile (`unshare` denied, `Seccomp: 2`; via the `podman` CLI because the
   Docker CLI inlines the JSON), gVisor honesty.

## Summary of Complete, Mocked, and Deferred

- **Complete**:
  - `DockerSandboxRunner` (`docker-hardened`; `gvisor` gated by a kernel probe).
  - Full implementation of `NoSandboxRunner` (`none`, non-enforcing).
  - Egress proxy sidecar (the enforcement path) and the in-process `EgressProxy`, kept in sync by conformance tests.
  - Robust input hardening, path traversal prevention, and control character rejection.
  - Complete `deploy/sandbox/` operational manifests, guides, and security profiles.
  - Unit and integration tests covering all acceptance criteria.
  - Package documentation and threat model.
- **Mocked**:
  - Test suite uses synthetic local target directories and mock HTTP servers for integration verification; no real client code or secrets.
- **Deferred**:
  - Firecracker microVM runner implementation deferred to Phase 2 (architectural specification and stub profile provided in `deploy/sandbox/firecracker-profile.*`).
  - Orchestrator wiring: WS1 consumes `SandboxRunner` interface in Phase 2; worker integration is out of scope for WS8 Phase 1.

---

## Security review (WS8 hardening pass, 2026-11-07)

Reviewer: Claude Opus 5.5. Scope: `packages/sandbox/**`, `deploy/sandbox/**`, against the WS8
card and `packages/core/src/sandbox.ts` (unchanged). Gates: `pnpm install && pnpm -r typecheck
&& pnpm -r lint && pnpm -r test && pnpm format:check` green; sandbox suite 102 tests, live tests
run against Podman 5.6 (only the gVisor positive path cannot run here).

### Issues found and fixed

| #   | Severity     | Finding                                                                                                                                                                                                                                                                                         | Fix                                                                                                                                                                                                                        |
| --- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Critical** | With a non-empty allowlist the container ran on the default bridge with only `HTTP(S)_PROXY` set: any client ignoring the env var had full internet and host access (reproduced: `wget -Y off http://example.com` succeeded). The old tests passed because they only used proxy-aware requests. | Per-run `--internal` network; the container's only peer is the proxy sidecar, which alone has egress. Live tests now assert proxy-bypass attempts fail (direct host, direct IP, gateway, DNS).                             |
| 2   | High         | `kind: "gvisor"` was claimed whenever `runtime: "runsc"` was set. Podman lists `runsc` in `docker info` even when absent, and its compat API silently ignores `--runtime`: the old gVisor live test "passed" on plain `crun`.                                                                   | Kernel probe (default runtime vs requested) in `preflight`/`exec`; mismatch required, otherwise `preflight` fails and `exec` throws. Live test asserts refusal here.                                                       |
| 3   | High         | Host-side proxy listened on `0.0.0.0` (open proxy for the LAN) and rewrote `host.docker.internal`/`host.containers.internal` to `127.0.0.1`, exposing every host-loopback service to anything that could name the host.                                                                         | Host-side `EgressProxy` binds `127.0.0.1` by default; alias rewrite removed. Enforcement now happens in the sidecar.                                                                                                       |
| 4   | High         | Proxy SSRF: no destination IP checks (metadata `169.254.169.254`, loopback, IPv4-mapped IPv6, integer IPs), re-resolution between check and connect (DNS rebinding), bare `*` rule allowed everything, port-less rules allowed every port, `Proxy-Authorization` forwarded upstream.            | Strict allowlist grammar (`src/egress-rules.ts`); resolve once, classify every address, pin the connection; per-rule-kind address policy; port-less => 80/443; hop-by-hop/`Proxy-*` headers stripped; origin-form refused. |
| 5   | High         | Mount injection / sensitive mounts: `-v src:dst:ro` built from unvalidated `:`/`,` characters; `hostPath` could be `/`, `/etc`, the engine socket or its parent (a read-only bind does not stop `connect(2)` on a socket => host takeover); `outputDir` could equal or contain `targetDir`.     | `--mount` with metacharacters rejected; realpath + sensitive-path/ancestor checks; sockets/devices refused; target/output overlap refused; extra mounts may not shadow `/target`, `/out`, `/tmp`.                          |
| 6   | High         | `exec` ran `chmod 0777` on any existing `outputDir` (e.g. a home directory).                                                                                                                                                                                                                    | Only a directory the runner itself created is chmod-ed.                                                                                                                                                                    |
| 7   | Medium       | Shipped `seccomp.json` was invalid (`SCMP_CMP_MASKED_EQUAL` is not a libseccomp operator: crun refused every container) and returned `EPERM` for `clone3`, breaking glibc threads.                                                                                                              | `SCMP_CMP_MASKED_EQ`; `clone3` => `ENOSYS` so libc falls back to filtered `clone`. Verified live (`unshare` denied, node worker threads OK). If the profile path is set but missing, runner fails closed.                  |
| 8   | Medium       | Sidecar DNS: attaching the internal network rewrote the sidecar's resolv.conf to a resolver that cannot answer external names, so allowlisted public hosts returned 502.                                                                                                                        | Sidecar snapshots resolvers and `/etc/hosts` at startup; runner attaches the internal network only after the sidecar is listening. Verified with docker and podman CLIs.                                                   |
| 9   | Medium       | Runner options were unvalidated docker argv: `image: "--privileged"` or `runtime` starting with `-` would be parsed as flags; `user: "0"` allowed root.                                                                                                                                         | Constructor validates image/runtime refs, numeric non-root `user`, positive integer limits.                                                                                                                                |
| 10  | Medium       | `timeoutSec` above ~24.8 days overflows `setTimeout` and fires immediately; unbounded stdout/stderr buffering lets the sandbox OOM the worker; no swap limit (`--memory` without `--memory-swap`).                                                                                              | `timeoutSec` capped at 2147483; 16 MiB per-stream cap with truncation marker; `--memory-swap` = `--memory`.                                                                                                                |
| 11  | Medium       | `NoSandboxRunner` leaked the host `PATH`, killed only the direct child on timeout (grandchildren survived), and used the container cwd (`/target`) as a host path.                                                                                                                              | Fixed `PATH`; detached process group killed with `SIGKILL`; `/target`, `/out` cwd mapped to host dirs, others refused. Still `enforcing: false`.                                                                           |
| 12  | Low          | Env keys `HTTP_PROXY`/`NO_PROXY` etc. could be overridden by policy; `--pull` implicit at exec time; `/tmp` without `nodev`.                                                                                                                                                                    | Proxy keys reserved; `--pull never` (preflight checks images); `nodev` added.                                                                                                                                              |

### Remaining risks

- **gVisor not exercised here**: `runsc` is not installed on this host. The positive gVisor
  path (probe passes, workload runs under gVisor) is untested; only refusal is tested.
- **Shared kernel** for `docker-hardened`: a kernel exploit escapes. Prefer gVisor in production.
- **Sidecar exposure**: the sidecar listens on all its interfaces, so other containers on the
  engine's default network can use it as a proxy to the run's allowlisted hosts for the run's
  duration. Its allow/deny log is discarded with the container.
- **Allowlisted destinations are exfiltration channels** by definition (e.g. a model API).
  Exact-hostname entries may resolve to private addresses (intended for local gateways).
- **Engine assumptions**: Docker Engine < 26 forwards DNS from internal networks
  (CVE-2024-29018). On Linux Docker, verify the live "gateway" check passes on your hosts.
  Podman via the Docker CLI cannot apply `seccomp.json` or `--runtime`; use `dockerPath: "podman"`.
- **Output directory permissions**: a runner-created `outputDir` is world-writable (`0777`) on
  the host for the unprivileged container uid; pre-existing directories must be made writable by
  the caller. Files written to `/out` are attacker-controlled content.
- **Busybox-style clients** that send `GET https://...` to the proxy (instead of `CONNECT`) are
  refused with 400.
- **Duplicated proxy logic** (`egress-rules.ts` vs `server.cjs`) is guarded by conformance
  tests, not by construction.
- Images are referenced by tag (`alpine:3.22`, `node:24-alpine`); pin digests in production.
- `SandboxRunner.preflight()` in core takes no arguments; the optional `policy` parameter is
  a WS8 extension (no contract change requested).
