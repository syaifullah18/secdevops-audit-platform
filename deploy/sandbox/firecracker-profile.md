# Firecracker MicroVM Profile (Phase 2 Future Specification)

## Overview

Workstream WS8 focuses in Phase 1 on Docker hardened containers (`docker-hardened`) and gVisor (`gvisor`) kernel virtualization via `runsc`.

Firecracker microVM isolation provides hardware-assisted hardware virtualization (KVM) with sub-100ms boot times and absolute kernel separation. This document and `firecracker-profile.stub.json` serve as the foundation stub for Phase 2 implementation.

## Architecture

```
+-------------------------------------------------------------+
| Host OS (Bare Metal / KVM-enabled instance)                 |
|                                                             |
|  +-------------------------------------------------------+  |
|  | Jailer (chroot, cgroups v2, seccomp, drop privileges) |  |
|  |                                                       |  |
|  |  +-------------------------------------------------+  |  |
|  |  | Firecracker VMM Process                         |  |  |
|  |  |                                                 |  |  |
|  |  |   +------------------------------------------+  |  |  |
|  |  |   | Guest Kernel (vmlinux-6.1)               |  |  |  |
|  |  |   |  - Read-Only Root Drive (/dev/vda)       |  |  |  |
|  |  |   |  - Read-Only Target Drive (/dev/vdb)     |  |  |  |
|  |  |   |  - Read-Write Output Drive (/dev/vdc)    |  |  |  |
|  |  |   |  - Ephemeral tmpfs (/tmp)                |  |  |  |
|  |  |   |  - TAP Network Interface (tap0)          |  |  |  |
|  |  |   +------------------------------------------+  |  |  |
|  |  +-------------------------------------------------+  |  |
|  +-------------------------------------------------------+  |
|                             | (Strict Egress Routing)       |
|                             v                               |
|                     Egress Proxy (Allowlist)                |
+-------------------------------------------------------------+
```

## Security Invariants

1. **Rootless Jailer**: Firecracker runs under the Jailer daemon (`/usr/bin/jailer`), which chroots into an isolated directory, drops all privileges to non-root UID/GID `65534:65534`, applies a strict seccomp filter to the VMM process itself, and configures cgroups v2 limits.
2. **Drive Immutability**: The target directory and OS base image are mounted as read-only block devices (`is_read_only: true`). Only the assigned output block device (`/dev/vdc`) allows writes.
3. **Network Confinement**: Network egress is mapped through a dedicated host TAP device (`tap-sdap-0`) with host-level iptables/nftables forwarding only to the local egress proxy service.

## Integration Plan (Phase 2)

- WS8 will provide `FirecrackerSandboxRunner` implementing `SandboxRunner` (`kind: "firecracker"`, `enforcing: true`).
- Preflight verifies `/dev/kvm` accessibility and jailer binary presence.
- Execution builds ephemeral ext4 scratch images, launches microVM via Firecracker REST API socket, monitors execution, extracts output artifacts from `/dev/vdc`, and destroys the microVM.
