# SecDevOps Audit Platform

Self-hosted platform that runs Cloudflare's open-source
[security-audit-skill](https://github.com/cloudflare/security-audit-skill) on demand or from CI,
stores its verified findings, and gives Security and DevOps one dashboard. No SaaS security
dependency, no telemetry by default. Product spec: [docs/PRD.md](docs/PRD.md).

> Status: under construction (pre-0.1). See [docs/build-log.md](docs/build-log.md).

## Layout

| Path                          | What                                                                       |
| ----------------------------- | -------------------------------------------------------------------------- |
| `packages/core`               | Shared contracts: Zod schemas, types, events, JSON Schema                  |
| `packages/adapters`           | Model adapters (Jev, Gemini/Argon, Claude, OpenAI-compatible, local, mock) |
| `packages/normalizer`         | Skill output to findings, fingerprints, dedup, SLA                         |
| `packages/sandbox`            | Sandboxed execution of agent CLIs and target code                          |
| `packages/cli`                | `sdap` CLI for CI pipelines                                                |
| `apps/api`                    | Fastify API                                                                |
| `apps/worker`                 | BullMQ audit worker running the skill's phases                             |
| `apps/web`                    | React + Vite dashboard                                                     |
| `deploy/`                     | Docker Compose, Helm, Grafana, CI templates, sandbox profiles              |
| `vendor/security-audit-skill` | Pinned upstream skill (MIT, git submodule)                                 |

## Development

Requires Node.js 24 LTS and pnpm.

```sh
git submodule update --init
pnpm install
pnpm -r typecheck && pnpm -r lint && pnpm -r test
```

## License

Apache-2.0. The vendored security-audit-skill is MIT, (c) Cloudflare, Inc. See [NOTICE](NOTICE).
