# gVisor (runsc) Installation and Daemon Configuration

This document describes how to install and configure gVisor (`runsc`) as an OCI runtime for Docker and Podman on SDAP worker nodes.

## 1. Prerequisites

- Linux x86_64 or AArch64 kernel (5.4+)
- Docker Engine 20.10+ or Podman 4.0+
- Root access on the host or VM

## 2. Installation (Debian / Ubuntu)

Install the official gVisor binary release via APT:

```bash
sudo apt-get update && sudo apt-get install -y apt-transport-https ca-certificates curl gnupg

curl -fsSL https://gvisor.dev/archive.key | sudo gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" | sudo tee /etc/apt/sources.list.d/gvisor.list > /dev/null

sudo apt-get update && sudo apt-get install -y runsc
```

Alternatively, install the statically compiled standalone binary:

```bash
ARCH=$(uname -m)
URL="https://storage.googleapis.com/gvisor/releases/release/latest/${ARCH}"
curl -fsSL "${URL}/runsc" -o runsc
curl -fsSL "${URL}/runsc.sha512" -o runsc.sha512
sha512sum -c runsc.sha512
sudo install -m 0755 runsc /usr/local/bin/runsc
```

## 3. Docker Daemon Configuration

Add `runsc` to `/etc/docker/daemon.json` (see `deploy/sandbox/daemon.json`):

```json
{
  "runtimes": {
    "runsc": {
      "path": "/usr/local/bin/runsc",
      "runtimeArgs": ["--network=sandbox"]
    }
  }
}
```

Reload and restart Docker:

```bash
sudo systemctl reload docker || sudo systemctl restart docker
```

Verify registration:

```bash
docker info | grep runsc
# Expected: Runtimes: ... runsc
```

Test running a container with gVisor:

```bash
docker run --rm --runtime=runsc alpine:3.22 dmesg
# In gVisor, dmesg output displays "[    0.000000] Starting gVisor..."
```

## 4. Podman Configuration

For Podman, register `runsc` in `/etc/containers/containers.conf` under `[engine.runtimes]`:

```toml
[engine.runtimes]
runsc = [
  "/usr/local/bin/runsc",
  "/usr/bin/runsc"
]
```

Verify with:

```bash
podman info | grep runsc
podman run --rm --runtime=runsc alpine:3.22 dmesg
```

## 5. Kubernetes Integration

To run sandboxed pods in Kubernetes via containerd:

1. Configure containerd's `/etc/containerd/config.toml`:

```toml
[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc]
  runtime_type = "io.containerd.runsc.v1"
```

2. Apply the `RuntimeClass` resource (`deploy/sandbox/gvisor-runtimeclass.yaml`):

```bash
kubectl apply -f deploy/sandbox/gvisor-runtimeclass.yaml
```

3. Specify `runtimeClassName: gvisor` in pod specifications running target code or untrusted tools.
