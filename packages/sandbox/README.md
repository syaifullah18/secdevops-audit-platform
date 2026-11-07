# @sdap/sandbox

OS-enforced sandbox runners, egress allowlist proxying, and input validation for the SecDevOps Audit Platform (SDAP).

Owner: Workstream **WS8** (see `docs/workstreams/WS8.md`).

---

## Overview

The SecDevOps Audit Platform executes AI agent commands and untrusted target code (e.g., test harnesses, exploit proofs, build scripts) during security audits. To prevent sandbox escapes, credential theft, lateral movement, or data exfiltration, execution MUST occur in an isolated, OS-enforced sandbox environment (PRD 5.3, 10).

When an OS-enforced sandbox is unavailable (such as during local development using `NoSandboxRunner`), the runner sets `enforcing: false`. The audit worker uses this flag to keep execution-dependent leads marked `needs_validation`, ensuring unverified execution never leads to confirmed findings or gate failures.

---

## Threat Model

| Threat                                   | Impact                                                                                                            | Mitigation Strategy                                                                                                                                                                                            | Enforced By                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Malicious Target Code Execution**      | Target repository contains malicious scripts, build hooks, or exploit payloads targeting the audit worker.        | Run in an unprivileged container with separate kernel/user space, dropped Linux capabilities, and blocked privilege escalation.                                                                                | `DockerSandboxRunner` (`docker-hardened` / `gvisor`)  |
| **Data Exfiltration & C2 Communication** | Target code or compromised agent attempts to leak source code, tokens, or environment data to an external server. | Network isolation: containers default to `--network none`. When egress is permitted for LLM endpoints, all traffic is routed through a CONNECT allowlist proxy that rejects unlisted hosts with 403 Forbidden. | `DockerSandboxRunner` + `EgressProxy`                 |
| **Host Filesystem Tampering**            | Target code writes persistence mechanisms, modifies host binaries, or tampers with target sources.                | Root filesystem is mounted read-only (`--read-only`), `/target` is mounted read-only (`:ro`), `/tmp` is an isolated in-memory tmpfs (`noexec,nosuid`). Only `/out` is mounted read-write for audit artifacts.  | `DockerSandboxRunner`                                 |
| **Credential / Environment Leakage**     | Target process reads host environment variables (AWS keys, database credentials, API tokens).                     | Complete environment sanitization: the container receives ONLY variables explicitly declared in `policy.env`. Zero host environment inheritance.                                                               | `DockerSandboxRunner`, `NoSandboxRunner`              |
| **Resource Exhaustion (DoS)**            | Fork bombs, memory leaks, or infinite loops hungrily consume worker node resources.                               | Strict kernel/cgroup resource limits: `--pids-limit`, `--cpus`, `--memory`, combined with enforced execution timeouts and SIGKILL termination.                                                                 | `DockerSandboxRunner`                                 |
| **Path Traversal & Command Injection**   | Malicious requests provide relative paths (`../../etc/passwd`) or control characters in argv/env.                 | Strict boundary validation with Zod and path sanitization before invoking runtime binaries.                                                                                                                    | `validateSandboxPolicy`, `validateSandboxExecRequest` |

---

## Enforcement Matrix per Runner Kind

| Isolation Feature        |                            `gvisor`                             |                        `docker-hardened`                        |        `none` (`NoSandboxRunner`)        |
| ------------------------ | :-------------------------------------------------------------: | :-------------------------------------------------------------: | :--------------------------------------: |
| **Enforcing Flag**       |                             `true`                              |                             `true`                              |                 `false`                  |
| **Kernel Isolation**     |       Virtualized Sentry kernel (intercepts all syscalls)       |                    Shared host Linux kernel                     |       None (runs directly on host)       |
| **Filesystem Isolation** | Read-only root & `/target`; tmpfs `/tmp`; writeable `/out` only | Read-only root & `/target`; tmpfs `/tmp`; writeable `/out` only | No filesystem isolation (writes to host) |
| **Network Isolation**    |               `--network none` or proxy allowlist               |               `--network none` or proxy allowlist               |           Host network access            |
| **Capabilities Dropped** |                    `ALL` (`--cap-drop ALL`)                     |                    `ALL` (`--cap-drop ALL`)                     |   N/A (runs with host user privileges)   |
| **No New Privileges**    |               `--security-opt no-new-privileges`                |               `--security-opt no-new-privileges`                |                   N/A                    |
| **User Separation**      |                  Non-root UID (`65534:65534`)                   |                  Non-root UID (`65534:65534`)                   |        Inherits host process UID         |
| **Memory Limit**         |                Enforced via cgroups (`--memory`)                |                Enforced via cgroups (`--memory`)                |   Not enforced (monitors process only)   |
| **CPU Limit**            |                 Enforced via cgroups (`--cpus`)                 |                 Enforced via cgroups (`--cpus`)                 |               Not enforced               |
| **PIDs Limit**           |              Enforced via cgroups (`--pids-limit`)              |              Enforced via cgroups (`--pids-limit`)              |               Not enforced               |
| **Timeout Termination**  |             Process & container killed with SIGKILL             |             Process & container killed with SIGKILL             |       Process killed with SIGKILL        |
| **Host Env Sanitized**   |                   Strictly `policy.env` only                    |                   Strictly `policy.env` only                    |  Strictly `policy.env` (+ minimal PATH)  |

---

## Architecture & Components

### 1. `DockerSandboxRunner`

Provides OS-enforced isolation using Docker or Podman.

- Detects whether gVisor (`runsc`) is registered on the daemon (`kind: "gvisor"`), otherwise operates as hardened Docker (`kind: "docker-hardened"`).
- Spawns the Docker CLI via `node:child_process` `spawn` with an explicit `argv` array (never a shell string).
- Automatically mounts `targetDir` as read-only at `/target` and `outputDir` as read-write at `/out`.
- Sets `--read-only`, `--tmpfs /tmp:rw,noexec,nosuid,size=64m`, `--cap-drop ALL`, and `--security-opt no-new-privileges`.
- Automatically provisions and tears down an internal `EgressProxy` when `policy.egressAllowlist` contains entries; otherwise applies `--network none`.

### 2. `EgressProxy`

A lightweight forward HTTP and HTTPS CONNECT proxy.

- Allows outbound connections only to hosts matching `policy.egressAllowlist` (exact hostnames, `host:port`, or wildcard domains such as `*.anthropic.com`).
- Returns `403 Forbidden` for any non-allowlisted destination.
- Gracefully handles host resolution aliases (`host.docker.internal` -> `127.0.0.1`) when running in local development or container test environments.

### 3. `NoSandboxRunner`

A non-enforcing runner designed for local testing and debugging.

- Executes commands directly on the host.
- Sanitizes the environment so host variables are not passed through.
- Sets `enforcing: false`, instructing the orchestrator to mark leads as `needs_validation`.

### 4. Input Validation & Hardening

- Paths must be absolute and free of traversal (`..`) or control characters.
- Reserved paths (`/`, `/proc`, `/sys`, `/dev`) are rejected for mounts.
- Environment keys must match `/^[A-Z_][A-Z0-9_]*$/`.
- Environment values and command `argv` must not contain ASCII control characters.

---

## Usage Example

```typescript
import { DockerSandboxRunner } from "@sdap/sandbox";

const runner = new DockerSandboxRunner();

// Verify runtime availability and policy validity
const preflight = await runner.preflight({
  targetDir: "/path/to/repo",
  outputDir: "/path/to/artifacts",
  cpus: 2,
  memoryMb: 2048,
  timeoutSec: 300,
  egressAllowlist: ["api.anthropic.com"],
});

if (!preflight.ok) {
  throw new Error(`Sandbox cannot run: ${preflight.message}`);
}

const result = await runner.exec({
  argv: ["npm", "test"],
  policy: {
    targetDir: "/path/to/repo",
    outputDir: "/path/to/artifacts",
    timeoutSec: 120,
    env: {
      CI: "true",
      NODE_ENV: "test",
    },
    egressAllowlist: [], // Network disabled (--network none)
  },
  onStdout: (chunk) => console.log(chunk),
});

console.log("Exit code:", result.exitCode);
console.log("Killed by:", result.killedBy);
```

---

## Scripts

- `pnpm build`: Compile TypeScript to `dist/`
- `pnpm typecheck`: Run `tsc --noEmit`
- `pnpm lint`: Run ESLint
- `pnpm test`: Run Vitest unit and integration suite
