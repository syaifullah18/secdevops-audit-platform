# SDAP Egress Proxy Image

Lightweight, zero-dependency forward HTTP and HTTPS CONNECT proxy that enforces allowlist egress filtering for sandboxed execution containers.

## Configuration

| Environment Variable | Default   | Description                                                                                                                                                                              |
| -------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`               | `8080`    | Port on which the proxy listens.                                                                                                                                                         |
| `HOST`               | `0.0.0.0` | Bind address.                                                                                                                                                                            |
| `ALLOWLIST`          | `""`      | Comma- or space-separated list of permitted hostnames or `host:port` pairs. Wildcards like `*.anthropic.com` are supported. If empty, all outbound requests are blocked (403 Forbidden). |

## Building and Running

```bash
# Build the container image
docker build -t sdap-egress-proxy:latest -f deploy/sandbox/egress-proxy/Dockerfile deploy/sandbox/egress-proxy

# Run with allowlisted model endpoints
docker run -d --name egress-proxy \
  -p 8080:8080 \
  -e ALLOWLIST="api.anthropic.com,api.openai.com,127.0.0.1:8000" \
  sdap-egress-proxy:latest
```

## In Kubernetes Pod Deployments

In Kubernetes, the egress proxy can run as a sidecar container in the audit worker pod sharing a local network namespace or communicating over an internal bridge network, ensuring untrusted target code can only communicate with approved external LLM gateways.
