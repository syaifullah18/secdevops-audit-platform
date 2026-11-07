# @sdap/sandbox

OS-enforced sandbox runners, egress allowlisting, and input validation for the SecDevOps Audit
Platform (SDAP). Owner: Workstream **WS8** (see `docs/workstreams/WS8.md`).

The platform executes agent CLIs and untrusted target code (test harnesses, exploit proofs,
build scripts). That must happen in an OS-enforced sandbox (PRD 5.3, 10). When only
`NoSandboxRunner` is available, `enforcing` is `false` and the worker keeps execution-dependent
leads `needs_validation`.

## Threat model

Attacker: code inside the sandbox (malicious target repo, prompt-injected agent). Trusted: the
worker process, the `SandboxPolicy` it builds, runner options, the container engine.

| Threat                    | Mitigation (docker-hardened / gvisor)                                                                                                                                                                                                                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exfiltration / C2         | Empty allowlist: `--network none` (loopback only). Non-empty: the container joins **only** a per-run `--internal` network whose sole other member is the allowlist proxy sidecar; there is no route around it. `HTTP(S)_PROXY` is set for convenience, not enforcement. No external DNS from the internal network.                                                      |
| SSRF to host / metadata   | Proxy resolves once, checks **every** resolved address and pins the connection to it (no DNS rebinding). Loopback, link-local (`169.254.169.254`), `fd00:ec2::254`, multicast, NAT64/6to4 are never reachable via a hostname; private ranges only via an exact-hostname entry; IP literals only via an identical IP entry.                                              |
| Host filesystem tampering | `--read-only` rootfs; `/target` and extra mounts `readonly`; only `/out` is writable; `/tmp` is tmpfs `noexec,nosuid,nodev`.                                                                                                                                                                                                                                            |
| Mount / argv injection    | `--mount` (not `-v`) with paths free of `,` `:` `"`, control chars, `.`/`..`; host paths `realpath`-ed (symlinks followed) before checks; `/`, `/proc`, `/sys`, `/dev`, `/run`, `/var/run`, `/etc`, `/boot`, `/root`, the engine socket (and any parent) and non-regular files are refused; `outputDir` may not overlap `targetDir`. Request argv goes after the image. |
| Privilege escalation      | Non-root numeric `--user` (root refused), `--cap-drop ALL`, `no-new-privileges`, optional seccomp allowlist profile, `--ipc private`, `--init`.                                                                                                                                                                                                                         |
| Credential / env leakage  | Container env is exactly `policy.env` (+ proxy vars). Always `--env KEY=value`, never a bare `KEY` (which would copy from the CLI's env). Keys `^[A-Z_][A-Z0-9_]*$`; `*_PROXY` keys reserved.                                                                                                                                                                           |
| Resource exhaustion       | `--memory` = `--memory-swap` (no swap), `--cpus`, `--pids-limit`, tmpfs size, timeout → `docker kill`, captured output capped (16 MiB/stream default).                                                                                                                                                                                                                  |
| Isolation over-claiming   | `kind: "gvisor"` only runs after a probe proves a non-host kernel; Podman's compat API ignores `--runtime`, so the flag alone is not trusted. `NoSandboxRunner.enforcing` is `false`.                                                                                                                                                                                   |

## Enforcement matrix

| Property            | `gvisor`                    | `docker-hardened`           | `none` (`NoSandboxRunner`)                       |
| ------------------- | --------------------------- | --------------------------- | ------------------------------------------------ |
| `enforcing`         | `true`                      | `true`                      | `false`                                          |
| Kernel              | gVisor Sentry (user-space)  | shared host kernel          | host                                             |
| Network             | none / internal net + proxy | none / internal net + proxy | **not restricted**                               |
| Filesystem writes   | `/out` + tmpfs `/tmp` only  | `/out` + tmpfs `/tmp` only  | **not restricted** (cwd mapped to target/output) |
| Capabilities / NNP  | none / yes                  | none / yes                  | host user                                        |
| Memory / CPU / pids | cgroups                     | cgroups                     | **not restricted**                               |
| Timeout / abort     | `docker kill` + SIGKILL     | `docker kill` + SIGKILL     | SIGKILL to the whole process group               |
| Env                 | `policy.env` only           | `policy.env` only           | `policy.env` + fixed `PATH`                      |

## Components

- `DockerSandboxRunner` (`src/docker-runner.ts`): spawns the Docker-compatible CLI with an argv
  array (never a shell). Options: `dockerPath`, `image` (default `alpine:3.22`, `--pull never`),
  `runtime` (`runsc`), `user` (default `65534:65534`), `pidsLimit`, `seccompProfile`
  (`deploy/sandbox/seccomp.json`; fail-closed if missing), `tmpfsSizeMb`, `egressProxyImage`
  (default `sdap-egress-proxy:latest`), `maxOutputBytes`, `dockerEnv`. A runner-created
  `outputDir` is chmod `0777` so the unprivileged uid can write; pre-existing directories are
  never chmod-ed (make them writable for the sandbox uid yourself).
- Egress sidecar: `deploy/sandbox/egress-proxy/server.cjs` (build the image first). Started per
  run on the default network, then attached to the internal network after it has snapshot its
  resolvers. Allowlist grammar: `host[:port]`, `*.domain.tld[:port]`, IPv4, `[IPv6]`; no port
  means 80/443 only; `*` and `*.tld` are rejected. Clients must use `CONNECT` for HTTPS
  (absolute-form `https://` GETs are refused).
- `EgressProxy` (`src/proxy.ts`): the same rules in-process (binds `127.0.0.1` by default).
  `test/proxy-conformance.test.ts` runs identical cases against both implementations.
- `NoSandboxRunner` (`src/no-sandbox.ts`): local development only, see matrix.
- Validation (`src/validation.ts`): `validateSandboxPolicy` (pure), `validateSandboxExecRequest`,
  `resolveHostMounts` (filesystem checks).

## Engine notes

- Podman via the Docker CLI (`DOCKER_HOST=unix://$(podman machine inspect --format
'{{.ConnectionInfo.PodmanSocket.Path}}')`) works for everything except `--runtime` (silently
  ignored, caught by the probe) and seccomp (CLI inlines the JSON). Use `dockerPath: "podman"`
  for those.
- Docker Engine >= 26 is required for internal networks not to forward DNS (CVE-2024-29018).

## Remaining risks

See the "Security review" section of `docs/workstreams/WS8-done.md`.

## Tests

`pnpm test` runs unit tests always, and live container tests when a Docker-compatible engine is
reachable (`DOCKER_HOST`, or an auto-detected Podman machine). Live tests build
`sdap-egress-proxy:latest` from `deploy/sandbox/egress-proxy` and need `alpine:3.22` locally;
otherwise they are skipped with a message. gVisor tests run only when the probe proves gVisor.
