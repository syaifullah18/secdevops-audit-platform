# Build log

| Date       | Phase | Workstream | Runner / model                 | Status | Notes                                                                             |
| ---------- | ----- | ---------- | ------------------------------ | ------ | --------------------------------------------------------------------------------- |
| 2026-11-07 | 0     | preflight  | claude / claude-opus-5-5       | ok     | 1-line test call                                                                  |
| 2026-11-07 | 0     | preflight  | claude / claude-sonnet-5-5     | ok     | 1-line test call                                                                  |
| 2026-11-07 | 0     | preflight  | claude / claude-haiku-5-5      | ok     | 1-line test call                                                                  |
| 2026-11-07 | 0     | preflight  | agy / gemini-4-argon-high      | ok     | 1-line test call                                                                  |
| 2026-11-07 | 0     | preflight  | agy / gemini-3.8-flash-medium  | ok     | 1-line test call                                                                  |
| 2026-11-07 | 0     | preflight  | agy / claude-sonnet-5-5-medium | quota  | RESOURCE_EXHAUSTED, resets ~40h; Claude fallbacks use the `claude` runner (D-010) |
| 2026-11-07 | 0     | foundation | lead: claude / claude-opus-5-5 | done   | Monorepo, tooling, CI, core contracts; Node 24 + pnpm 12 via Homebrew (D-001)     |
