# Deployment & Sandbox Infrastructure

This directory contains deployment configuration, security profiles, container definitions, and Kubernetes resources for OS-enforced sandboxed execution in the SecDevOps Audit Platform (SDAP).

## Directory Contents

| File / Directory                | Purpose                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `runsc-install.md`              | Installation guide for gVisor (`runsc`) on host nodes and container engine setup.              |
| `daemon.json`                   | Sample `/etc/docker/daemon.json` snippet configuring the `runsc` runtime.                      |
| `gvisor-runtimeclass.yaml`      | Kubernetes `RuntimeClass` resource for scheduling pods onto gVisor-enabled nodes.              |
| `seccomp.json`                  | Strict seccomp profile for container sandboxing (`SCMP_ACT_ERRNO` default).                    |
| `firecracker-profile.stub.json` | JSON configuration profile stub for future Phase 2 microVM sandboxing.                         |
| `firecracker-profile.md`        | Architectural specification and security invariants for Phase 2 Firecracker integration.       |
| `egress-proxy/`                 | Standalone Dockerfile and Node.js proxy server for containerized egress allowlist enforcement. |

## Quick Start: Host Node Hardening

1. Follow `runsc-install.md` to install gVisor `runsc`.
2. Apply `daemon.json` to register `runsc` with Docker/Podman daemon.
3. Test with `docker run --rm --runtime=runsc alpine:3.22 uname -a`.
4. Deploy `gvisor-runtimeclass.yaml` to your Kubernetes cluster.
