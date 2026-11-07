# Deployment & Sandbox Infrastructure

This directory contains deployment configuration, security profiles, container definitions, and Kubernetes resources for OS-enforced sandboxed execution in the SecDevOps Audit Platform (SDAP).

## Directory Contents

| File / Directory                | Purpose                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `runsc-install.md`              | Installation guide for gVisor (`runsc`) on host nodes and container engine setup.              |
| `daemon.json`                   | Sample `/etc/docker/daemon.json` snippet configuring the `runsc` runtime.                      |
| `gvisor-runtimeclass.yaml`      | Kubernetes `RuntimeClass` resource for scheduling pods onto gVisor-enabled nodes.              |
| `seccomp.json`                  | Allowlist seccomp profile (`SCMP_ACT_ERRNO` default; namespace-creating `clone` flags denied). |
| `firecracker-profile.stub.json` | JSON configuration profile stub for future Phase 2 microVM sandboxing.                         |
| `firecracker-profile.md`        | Architectural specification and security invariants for Phase 2 Firecracker integration.       |
| `egress-proxy/`                 | Allowlist proxy sidecar image (`sdap-egress-proxy`); the sandbox's only route out.             |

## Quick Start: Host Node Hardening

1. Follow `runsc-install.md` to install gVisor `runsc`.
2. Apply `daemon.json` to register `runsc` with Docker/Podman daemon.
3. Test with `docker run --rm --runtime=runsc alpine:3.22 uname -r` (must differ from the host
   kernel; see the Podman caveat in `runsc-install.md`).
4. Build the egress sidecar: `docker build -t sdap-egress-proxy:latest deploy/sandbox/egress-proxy`.
5. Pull the sandbox image (`alpine:3.22` by default); the runner uses `--pull never`.
6. Deploy `gvisor-runtimeclass.yaml` to your Kubernetes cluster.

## Engine requirements

- Egress isolation relies on `docker network create --internal`. Use Docker Engine >= 26
  (CVE-2024-29018: older embedded DNS forwarded external queries from internal networks) or
  Podman with netavark/aardvark-dns (verified: no external resolution on internal networks).
- `seccomp.json` must be passed as a file path. The Docker CLI inlines the JSON, which
  Podman's compat API rejects; with Podman use the `podman` CLI (`dockerPath: "podman"`).
