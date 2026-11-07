# PRD: SecDevOps Audit Platform

Nov 7, 2026 · @Muhammad Syaifullah

## 1. Summary

A single self-hosted platform that runs Cloudflare's open-source [security-audit-skill](https://github.com/cloudflare/security-audit-skill) (MIT) on demand or from CI, stores its verified findings, and gives Security and DevOps one dashboard. There is no dependency on SaaS security products such as Snyk: the skill is the only audit engine, and every component runs on our own infrastructure.

## 1a. Open-source strategy

The platform is released as an open-source project. Acme Consulting (mock name for the founding company) runs it internally as the first adopter and keeps client-specific configuration in a private repository.

**License and attribution**

- **License:** Apache-2.0 (patent grant, enterprise-friendly). It is compatible with the MIT-licensed security-audit-skill.
- The skill is vendored at a pinned version with its MIT notice and a credit to Cloudflare in `NOTICE`. Improvements to the skill itself go upstream as PRs rather than living only in our fork.
- Needs Acme management and legal approval before the public repo is created (IP ownership, name, contributor policy).

**What is public and what stays private**


| Public repo                                                                                         | Private (Acme internal)                                                                |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Orchestrator, API, normalizer, web dashboard                                                        | Client repo lists, credentials, model keys                                             |
| Model adapters, plugin SDK                                                                          | Client-specific policies and SLAs                                                      |
| Generic attack-class packs (Spring Security, Struts, tenant scoping, IP filters, actuator exposure) | Findings and reports from client code                                                  |
| Grafana dashboards, Helm chart, Docker Compose                                                      | Real project names and raw pilot reports (section 12 holds only the sanitized summary) |
| Benchmarks on public vulnerable apps (OWASP WebGoat, Juice Shop, DVWA)                              |                                                                                        |


**Design rules for an open-source release**

- **Provider-neutral models:** adapters for Gemini (incl. Argon), Claude, OpenAI-compatible APIs and local models (Ollama, vLLM). No default that requires a paid account.
- **Self-hosted only, no telemetry** unless the operator opts in.
- **Plugin points:** model adapters, attack-class packs, CI triggers (Bitbucket, GitHub Actions, GitLab CI, Jenkins), issue trackers (Jira, GitHub Issues), notifiers (Slack, Teams, email).
- **One-command start:** `docker compose up` for evaluation; Helm chart for Kubernetes.

**Project hygiene**

- `README`, `CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY.md` with a private disclosure address, `GOVERNANCE.md` naming maintainers.
- Signed releases, SBOM per release, semantic versioning, CI on every PR.
- Public roadmap and issue labels (`good first issue`, `attack-class`, `adapter`).

**Success metrics (community)**

- External contributors and adopting organisations in the first 12 months.
- Number of community attack-class packs and model adapters.
- Detection rate on the public benchmark apps, published per release.

## 1b. AI design: System 1 and System 2

The platform uses two AI modes. **System 1 is Jev**, TypeSafe AI's "System One" decision model: it does not write text, it answers narrow typed questions (yes/no, pick one, rate it) with calibrated probabilities, in milliseconds and at low cost. It decides, scores and routes. **System 2** is slow and deliberate: the full security-audit-skill on a generative model (e.g. Argon), with adversarial verification. Anything that needs words, reasoning or code goes to System 2; anything that is a decision goes to Jev. System 2's verified results are used to calibrate Jev's thresholds over time.


|                    | System 1: Jev                                                    | System 2: deep audit                                                                                           |
| ------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Goal               | Triage, gating, routing, ranking                                 | Find, prove and explain real vulnerabilities                                                                   |
| Engine             | Jev (typed decisions, probabilities, no text output)             | Full six-phase security-audit-skill on a generative model (Argon by default), different model for verification |
| Trigger            | Every PR/commit, every candidate finding, every routing decision | Escalation from Jev, nightly incremental, pre-release full, on demand                                          |
| Time / cost        | Milliseconds to seconds per question                             | 30 minutes to hours; budget per run                                                                            |
| Output             | Scores, labels, probabilities the pipeline acts on               | `confirmed` / `needs_validation` / `rejected` findings with evidence, explanations, fix drafts                 |
| Can block a merge? | No, advisory gate only                                           | Yes, `confirmed` findings only                                                                                 |


### System 1 capabilities

- **Change risk gate:** for each PR, Jev scores questions such as "does this diff touch authentication or authorization?", "does it add an endpoint without tenant scoping?", "does it change CI or deployment config?". The scores decide whether System 2 runs.
- **Attack-class routing:** Jev picks which attack classes (authz, injection, config, supply chain, client-side) are relevant to the change, so System 2 only hunts where it matters.
- **Candidate filtering:** before verification, Jev rates each hunter candidate ("is this reachable from user input?", "is this a duplicate of finding X?", "likely false positive?") so the expensive verifier sees fewer, better candidates.
- **Triage labels:** proposed severity band, owner (pick from CODEOWNERS candidates) and duplicate matching, as probabilities shown in the UI.
- **Relevance ranking:** ranks files and code regions by how relevant they are to a finding or question, to cut the context System 2 must read.
- **Model routing:** decides per task whether a cheap or strong generative model is needed in System 2.

What Jev does not do: write PR comments, explanations or fixes, or answer free-text questions. Those come from System 2's generative model, using Jev's scores as input.

### System 2 capabilities

- **Deep audit:** recon, coverage-led hunting with parallel agents, adversarial validation, independent record verification and reporting, as defined by the skill.
- **Sandboxed proof:** executes target code in the sandbox to move items from `needs_validation` to `confirmed` or `rejected`.
- **Repeated runs and consensus:** N runs per release, optionally with different models; findings seen by several runs or models get higher confidence.
- **Root-cause grouping:** clusters findings into root causes (e.g. "role gate disabled in global interceptor") so teams fix causes, not symptoms.
- **Fix verification:** after a fix is merged, re-traces the original finding to confirm it is closed before the status changes to Fixed.

### Router: when System 1 escalates to System 2

- Jev's risk probability for the change is above the configured threshold.
- The diff touches security-critical paths (auth config, filters, interceptors, pipeline files, IaC), judged by Jev or by path rules.
- Jev matches the change to a class System 2 has already confirmed elsewhere in the org.
- A developer or security engineer clicks "Deep check".
- Jev's answer is uncertain (probability near 0.5), so the decision is handed to System 2 rather than guessed.
- Budget allows; otherwise the item is queued for the nightly run and shown as pending.

### Learning loop

- Every Jev question, its probability and the later System 2 verdict or human decision are logged together.
- That log is used to calibrate thresholds per question and per project (e.g. escalate authz changes at 0.4, config changes at 0.6).
- Patterns confirmed repeatedly become new Jev questions and org-level attack classes; patterns repeatedly rejected become suppressions with expiry.
- Dashboard tracks Jev precision and recall against System 2 verdicts, escalation rate and cost per confirmed finding.
- Jev model version is pinned and recorded with every decision so results can be reproduced.

### Guardrails

- System 1 never blocks a merge and never closes a finding on its own.
- No finding reaches a gate without System 2 verification; severity shown is the verified one, with the original kept for audit.
- All AI output is labelled with the model and phase that produced it.
- Fix suggestions are drafts for human review only.

**Open point: Jev is a hosted API.** It is available from TypeSafe AI directly and through Vercel AI Gateway, so diffs and snippets leave our infrastructure. This conflicts with the "no SaaS dependency, self-hosted only" rule. Options: send Jev only minimal snippets and metadata, enable it per client only where allowed, and keep a fallback System 1 (path rules plus a small local classifier) so the platform still works without Jev. Pricing and data-retention terms must be confirmed before adoption.

## 2. Problem

- Security reviews are manual, inconsistent and scattered, so there is no single view of risk per project or client.
- Signature-based tools miss logic flaws such as auth bypass, tenant isolation and business-logic abuse.
- Commercial SaaS scanners cost per developer and send code outside, which some banking and insurance clients do not allow.
- Findings lack an owner, SLA and triage history, so the same issues return every run.

## 3. Goals and non-goals

**Goals**

1. Run the security-audit-skill on any repository on demand, on schedule, or from a CI pipeline.
2. Turn the skill's outputs (`findings.json`, `coverage-ledger.json`, reports) into a tracked, deduplicated findings backlog.
3. One dashboard for Security and DevOps, with Grafana as an optional view.
4. Fully self-hosted: code, findings and the AI model stay inside approved infrastructure.

**Non-goals (v1)**

- Any SaaS security product or third-party scanner (Snyk, Semgrep, Trivy, etc.).
- A dependency CVE database or SCA matching (the skill does not provide one; see Risks).
- Runtime protection (WAF, RASP) and automatic code fixes.

## 4. Users


| Persona                    | Needs                                                                          |
| -------------------------- | ------------------------------------------------------------------------------ |
| Security engineer          | Trigger audits, review `needs_validation` items, triage, export audit evidence |
| DevOps / platform engineer | Wire audits into CI, run workers and sandbox, monitor platform health and cost |
| Team lead / developer      | See confirmed findings for their service, fix, mark resolved                   |
| Management / client PM     | Risk trend, SLA compliance, release readiness                                  |


## 5. Features

### 5.1 Audit orchestration

- **Triggers:** manual "Run now" in the web UI, REST API, CLI step in any CI (Bitbucket Pipelines, Jenkins, GitLab CI), schedule (nightly or weekly), and release tags.
- **Run modes:** `focused` (only paths changed since the last run, reusing the previous coverage ledger), `full` (whole repository), `repeat-N` (several independent runs merged, because one run finds only part of the issues).
- **Scope controls:** target path, attack classes to include, max runtime and token budget per run.
- **Queue:** concurrency and budget limits per team and per client.

### 5.2 Audit engine: security-audit-skill

Each run executes the skill's six phases unchanged:

1. Reconnaissance: architecture, trust boundaries, input surfaces.
2. Coverage-led hunting by isolated sub-agents.
3. Candidate validation by a fresh verifier that tries to disprove each candidate.
4. Structured output to `findings.json`, checked by the skill's JSON-schema validators.
5. Independent re-verification of final claims.
6. Reports: `REPORT.md`, `FINDINGS-DETAIL.md`, `NEEDS-VALIDATION.md`.

Platform additions around the engine, not inside it:

- Pin the skill to a tested commit; upgrade through a review step.
- Company attack-class files for our stack (Spring Boot, Spring Security, JPA, Kotlin/Android, Swift/iOS, procurement and payment flows), kept in our own fork.
- Run the skill's validators (`validate-findings.cjs`, `validate-coverage-ledger.cjs`) after every run; a failed validation marks the run failed, never "clean".

### 5.3 Execution environment

- **Agent runtime:** a coding agent with tool use and parallel sub-agents, packaged as a worker container.
- **Model:** pluggable through a model adapter. Argon is the default; any other model with tool use and parallel sub-agent support can be swapped in per client or project without code changes. Endpoint is self-hosted or privately deployed per client data policy; no code goes to a public SaaS endpoint unless the client approves it.
- **Sandbox:** OS-enforced sandbox (gVisor or Firecracker) for running target code: no external network, clean environment, resource limits, restricted writes. Without it, execution-dependent leads stay `needs_validation`.
- **Workers:** ephemeral, one per run, on our Kubernetes cluster or VMs; destroyed after artefacts are uploaded.

### 5.4 Findings management

- Import `findings.json` into a unified store: id, verdict (`confirmed` / `needs_validation` / `rejected`), attack class, severity, location, evidence trace, owner, first and last seen, SLA due date.
- Fingerprint-based dedup across runs; status carries forward when code moves, in line with the skill's own evidence carry-forward.
- Triage flow: New, Confirmed, In progress, then Fixed, Accepted risk (approver and expiry) or False positive (reason).
- `needs_validation` items go to a Security review queue and never fail a gate on their own.
- Rejected candidates kept for audit trail, hidden by default.

### 5.5 Policy and gates

- Policy as code per repo or client, e.g. block release on any open `confirmed` Critical or High; report-only mode for new projects.
- CI CLI returns a pass/fail exit code from the policy result.

### 5.6 Dashboard and reporting

**Web dashboard (primary)**

- Org overview: open findings by severity and verdict, SLA breaches, mean time to remediate, trend.
- Project view: run history, coverage ledger (which units were audited and when), open findings.
- Finding detail: source trace, evidence, verifier result, triage history, links to code.
- Run view: phase progress, duration, token cost, validator status, generated reports.
- Exports: PDF/Markdown audit report per project and period for client compliance.

**Grafana (self-hosted alternative)**

- Platform exposes Prometheus metrics: findings by severity and status, runs, failures, queue length, duration, token cost.
- Read-only PostgreSQL datasource and ready-made dashboards; logs to Loki.
- Alerts through Grafana alerting.

**Notifications:** email and self-hosted chat (e.g. Mattermost) or the client's approved channel, for new confirmed Critical, SLA breach, failed gate and failed run.

### 5.7 Access control

- SSO through our identity provider (OIDC/SAML, e.g. Keycloak); roles: Admin, Security, DevOps, Developer, Viewer.
- Project-level isolation so one client's findings are never visible to another client's team.

## 6. Architecture

- **API service** (TypeScript, Node.js + Fastify): triggers, runs, findings, policy, auth.
- **Orchestrator and queue** (RabbitMQ or Redis): scheduling, concurrency, budgets.
- **Audit workers:** agent runtime + pinned security-audit-skill, inside the sandbox; egress allowed only to the model endpoint and the internal git server.
- **Model adapter and endpoint:** Argon by default, or any other supported model; self-hosted or private deployment.
- **Importer:** validates and loads `findings.json` and `coverage-ledger.json`.
- **Storage:** PostgreSQL (runs, findings, policy); MinIO or other self-hosted object storage (reports, ledgers, logs).
- **Web UI:** dashboard SPA (TypeScript, React).
- **Observability:** Prometheus, Loki, Grafana.
- **Integrations (self-hosted only):** Bitbucket Server / GitLab self-managed, Jira Data Center, email, Mattermost.

**Language: TypeScript everywhere.** One language for API, orchestrator, workers, CLI and dashboard keeps the project simple for contributors and maintainers.

- The skill's validators (`validate-findings.cjs`, `validate-coverage-ledger.cjs`) and the `npx skills` installer are already Node.js, so they run in-process with no second runtime.
- Shared types for the findings schema, Jev questions and API contracts between backend and frontend; schemas defined once with Zod and exported as JSON Schema.
- Suggested stack: Node.js 24 LTS, pnpm monorepo (`apps/api`, `apps/worker`, `apps/web`, `packages/core`, `packages/adapters`, `packages/cli`), Fastify, Drizzle ORM on PostgreSQL, BullMQ on Redis for the queue, React + Vite for the dashboard, `prom-client` for Prometheus metrics, Vitest for tests.
- Model adapters (Jev, Gemini/Argon, Claude, OpenAI-compatible, local) are TypeScript packages behind one interface.
- Python is used only where a scanned target needs it inside the sandbox, never in the platform itself.

Flow: trigger, queue, worker clones repo, skill runs six phases, validators, importer, dedup and policy, then dashboard, Grafana, CI result and notifications.

## 7. Non-functional requirements


| Area           | Requirement                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| Self-hosting   | No runtime dependency on any SaaS security product; all components deployable on-prem or in our private cloud |
| Data residency | Code, findings and model traffic stay in approved infrastructure per client                                   |
| Reliability    | Failed or invalid runs are reported as failed, never as clean; automatic retry                                |
| Security       | Sandboxed target execution, secrets in vault, audit log of all user actions                                   |
| Scale          | 200+ repositories, 20 concurrent audit runs                                                                   |
| Cost           | Per-team and per-client token or GPU budget with alerts                                                       |
| Licensing      | Respect the skill's MIT licence; keep attribution in our fork                                                 |


## 8. Success metrics

- 100% of active repositories audited at least once per release.
- Confirmed Critical fixed within 7 days, High within 30 days.
- Under 10% of `confirmed` findings later marked false positive.
- Audit evidence for a client produced in minutes instead of days.

## 9. Roadmap


| Phase              | Scope                                                                                                                  | Exit criteria                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 0. Pilot (4 weeks) | Run the skill by hand on one Java service with a self-hosted model and sandbox; measure findings, noise, runtime, cost | Go/no-go; chosen model is good enough       |
| 1. MVP             | Worker image, orchestrator, CLI and manual trigger, importer, findings store, basic dashboard, Grafana metrics         | 3 projects onboarded                        |
| 2. Workflow        | Triage, review queue, policy gates, SLAs, notifications, Jira Data Center sync                                         | Gates on pilot projects in report-only mode |
| 3. Scale           | Focused/repeat runs, per-client isolation, budgets, company attack-class files                                         | Org-wide adoption                           |


## 10. Risks and mitigations


| Risk                                                                            | Mitigation                                                                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Self-hosted models may be weaker than frontier models, lowering finding quality | Pilot compares models; allow approved private deployments of stronger models per client           |
| Non-deterministic results                                                       | Gate only on `confirmed`; repeat-N runs before release; human review queue                        |
| No dependency CVE coverage without other scanners                               | Accept for v1 and state it in client reports; revisit an open-source SCA plugin later if required |
| Sandbox escape or abuse                                                         | gVisor/Firecracker, egress block, resource limits, dedicated nodes                                |
| Long run times and compute cost                                                 | Focused runs on changed code; deep runs per release, not per commit; budgets                      |
| Upstream skill changes break the platform                                       | Pin to a commit, own fork, regression tests on known-vulnerable sample repos                      |


## 11. Open questions

- Does Argon support the tool use and parallel sub-agents the skill needs, and is it strong enough? Which fallback model, and on what GPU capacity?
- Which clients allow AI analysis of their code at all?
- Is the web dashboard required in v1, or can Grafana cover the MVP?
- Who owns the platform: Security, DevOps or a shared team?
- Is missing dependency CVE scanning acceptable to clients for v1?

## 12. Pilot evidence (sanitized)

The skill was run manually on two internal Java codebases. Project names, file paths, finding IDs and code details are replaced with mock values. Both runs were read-only static reviews with no sandbox, so nothing was executed.


|                             | Project Alpha                                                                                  | Project Beta                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Stack                       | Legacy Java MVC web app with JSP views                                                         | Spring Boot multi-module REST API (3 modules) |
| Hunting                     | 6 slices (recon, authn, authz, injection, client-side, config); fast model with fallback chain | 1 hunter per module, single strong model      |
| Verification                | Adversarial verifiers on a different model, refute-by-default                                  | Same, plus manual spot check of highs         |
| Candidates                  | 42                                                                                             | 24                                            |
| Confirmed                   | 28 (7 high, 13 medium, 7 low, 1 info)                                                          | 8 (2 high, 5 medium, 1 low)                   |
| Needs validation            | 4                                                                                              | 14                                            |
| Rejected                    | 10                                                                                             | 2                                             |
| Critical after verification | 0 (every hunter "critical" downgraded)                                                         | 0                                             |


### What the findings show

- **Authorization is the main risk, not injection.** Alpha: a disabled role check in a global request interceptor and actions that bypass the auth chain. Beta: object-level access (IDOR) and missing tenant scoping. Injection hunting was largely clean on both.
- **Patterns repeated across both projects:** IP allowlists trusting `X-Forwarded-For`, secrets in source, tokens or logs, unauthenticated API docs and metrics endpoints, unbounded page sizes (memory DoS), verbose error messages.
- **Supply chain matters:** one of the most urgent items was a sensitive artefact committed to the repo and packaged into the build by the CI pipeline.
- **Verification earns its cost:** 12 of 66 candidates were refuted and many severities were downgraded. Raw hunter output alone would have produced false criticals.

### Lessons turned into requirements


| Observation                                                                                                                                      | Requirement for the platform                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The primary model was denied tool permissions on most slices; a provider safety filter blocked injection prompts; another provider hit its quota | Configurable **model fallback chain** per slice, with the model used recorded on every finding; preflight check of harness permissions; quota-aware scheduling and retry |
| Runs needed several manual restarts                                                                                                              | Orchestrator handles retries, resumable slices and per-slice status in the UI                                                                                            |
| Malformed JSON (concatenated objects, filter notices) had to be salvaged                                                                         | Strict schema validation with the skill's validators; quarantine and auto-retry for invalid output                                                                       |
| The two runs used different output layouts and verdict words                                                                                     | Normalizer maps all verdicts to `confirmed` / `needs_validation` / `rejected`; one run layout enforced                                                                   |
| Many items stayed unresolved because nothing ran                                                                                                 | Sandbox required in Phase 2; pending items routed to the security review queue                                                                                           |
| Hunter severity often differed from verified severity                                                                                            | Store and show both; gate only on verified                                                                                                                               |
| Same flaw classes recur across projects                                                                                                          | Shared attack-class packs and a cross-project trend view                                                                                                                 |
| Mixed models (one hunting, another verifying) gave usable results                                                                                | Model adapter supports different models per phase                                                                                                                        |


### Next steps from the pilot

- Remediate the confirmed highs in both projects through the normal internal process.
- Re-run both projects with the sandbox and measure how many of the 18 pending items become confirmed.
- Rebuild this benchmark on public vulnerable apps so results can be published with the open-source release.