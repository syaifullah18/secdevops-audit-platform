# SDAP Egress Proxy Sidecar

Zero-dependency forward HTTP and HTTPS `CONNECT` proxy. `DockerSandboxRunner` starts one per
`exec` whose policy has a non-empty `egressAllowlist`:

```
 sandbox container ──(internal network, no gateway)──► egress-proxy ──(egress network)──► allowlisted host
```

The sandbox container is attached **only** to a per-run `--internal` network, so it has no route
anywhere except the proxy sidecar. Setting `HTTP(S)_PROXY` is a convenience for clients, not the
enforcement mechanism: a client that ignores the proxy variables simply has no route out.

## Rules

`ALLOWLIST` is comma-separated. Each entry is `host[:port]`, `*.domain.tld[:port]`,
`IPv4[:port]` or `[IPv6][:port]`.

- An entry without a port allows ports 80 and 443 only.
- A bare `*`, `*.tld`, schemes, paths, userinfo and unbracketed IPv6 are rejected; an invalid
  entry aborts startup (exit 2).
- Destinations are resolved once and the connection is pinned to the vetted address (no DNS
  rebinding between check and connect). Every resolved address must be permitted:
  - loopback, link-local (incl. `169.254.169.254`), `fd00:ec2::254`, multicast, NAT64/6to4 and
    other special ranges are **never** reachable through a hostname;
  - private ranges (RFC 1918, CGNAT, ULA) are reachable only through an **exact hostname**
    entry (e.g. a local model gateway), never through a wildcard;
  - an IP-literal entry allows exactly that address.
- Only absolute-form `http://` requests and `CONNECT host:port` are accepted; hop-by-hop and
  `Proxy-*` headers are stripped.

| Env         | Default   | Meaning                                         |
| ----------- | --------- | ----------------------------------------------- |
| `ALLOWLIST` | `""`      | Rules (empty = everything is refused with 403). |
| `PORT`      | `3128`    | Listen port (`0` = ephemeral, logged).          |
| `HOST`      | `0.0.0.0` | Bind address inside the sidecar's network ns.   |

## Build

```bash
docker build -t sdap-egress-proxy:latest deploy/sandbox/egress-proxy
```

`DockerSandboxRunner` uses `sdap-egress-proxy:latest` by default (`egressProxyImage` option) and
runs it `--read-only --cap-drop ALL --security-opt no-new-privileges` with small pids/memory
limits. The logic mirrors `packages/sandbox/src/egress-rules.ts`;
`packages/sandbox/test/proxy-conformance.test.ts` runs the same cases against both.
