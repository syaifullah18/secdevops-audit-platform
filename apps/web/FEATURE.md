---
type: "Specification"
status: "Active"
icon: "layout"
project: "[[secdevops-audit-platform]]"
subsystem: "[[apps/web]]"
workstream: "[[WS5]]"
references:
  - "[[ui-references/sec-1.webp]]"
  - "[[ui-references/sec-2.webp]]"
  - "[[ui-references/sec-3.webp]]"
  - "[[ui-references/sec-4.webp]]"
  - "[[ui-references/sec-5.webp]]"
  - "[[ui-references/sec-6.webp]]"
  - "[[ui-references/sec-7.webp]]"
  - "[[ui-references/sec-8.webp]]"
  - "[[ui-references/sec-9.webp]]"
  - "[[ui-references/sec-10.webp]]"
  - "[[ui-references/sec-11.webp]]"
  - "[[ui-references/sec-12.webp]]"
  - "[[ui-references/sec-13.webp]]"
  - "[[ui-references/sec-14.webp]]"
  - "[[ui-references/sec-15.webp]]"
  - "[[ui-references/sec-16.webp]]"
---

# Web Dashboard Redesign Specification (Stitch UI Blueprint)

## 1. Executive Summary & Product Vision

This document defines the comprehensive redesign specification for the **SecDevOps Audit Platform Web Dashboard** (`@sdap/web`), corresponding to **PRD Section 5.6** and **Workstream WS5**.

The redesign transforms the current functional dashboard into a tier-1, dark-mode-first cyber intelligence command center inspired by leading security platforms (Wiz, Datadog Security, Astra, Linear). This specification is purpose-built to feed directly into **Google Stitch** (`stitch.googleapis.com/mcp`) for automated screen generation, design system creation, and component extraction.

### Core Value Proposition & System Responsibilities

1. **Multi-Agent Audit Telemetry**: Real-time observability over autonomous LLM security audits (Recon $\rightarrow$ Hunt $\rightarrow$ Validate $\rightarrow$ Report) with visible model fallback chains (e.g. `gemini-4-argon-high` $\rightarrow$ `claude-sonnet-5-5`).
2. **Authoritative vs Advisory Dual-Track Triage**: Strict visual separation between System 1 fast heuristics (advisory, non-blocking) and System 2 sandbox-verified proofs (authoritative, gate-binding).
3. **Deterministic Release Gatekeeper**: Clear pass/fail release gating where **only open confirmed findings block merges or deployments**.
4. **Interactive Sandbox Verification Terminal**: Direct inspection of simulated exploit executions (SQL injection extractions, privilege escalation, shell proofs) and tamper-evident triage audit logs.

---

## 2. Design DNA & Visual Identity (Stitch Tokens)

When generating screens and tokens on Google Stitch, enforce the following design language:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           STITCH DESIGN SYSTEM DNA                          │
├───────────────────┬─────────────────────────────────────────────────────────┤
│ Theme Default     │ Dark-Mode First (Obsidian & Slate with Neon Accents)    │
│ Primary Palette   │ Void: #090D16 | Surface: #111827 | Card: #1F2937        │
│ Severity Palette  │ Critical: #EF4444 | High: #F97316 | Medium: #F59E0B      │
│                   │ Low: #06B6D4 | Informational: #64748B | Verified: #10B981│
│ AI Intelligence   │ System 1 Advisory: #8B5CF6 (Violet) / #A78BFA (Light)   │
│ Typography        │ UI: Inter / Geist Sans | Monospace: JetBrains Mono     │
│ Surface Treatment │ Glassmorphic 1px borders (rgba(255,255,255,0.08)),       │
│                   │ Backdrop blur (16px), subtle radial gradient glows       │
│ Radius & Density  │ Card Radius: 12px | Pill Radius: 9999px | Compact-Dense │
└───────────────────┴─────────────────────────────────────────────────────────┘
```

### 2.1 Color Tokens & Semantic Mappings

- **Canvas / Background**: `#090D16` (`hsl(222, 40%, 6%)`) — Deep cyber void.
- **Surface Layer 1 (Navigation & Sidebar)**: `#0D1322` (`hsl(222, 38%, 9%)`).
- **Surface Layer 2 (Cards & Panels)**: `#111827` (`hsl(220, 39%, 11%)`) with `1px solid rgba(255, 255, 255, 0.08)`.
- **Surface Layer 3 (Inner Well / Terminal)**: `#0B0F19` (`hsl(222, 45%, 7%)`) with `border: 1px solid rgba(255, 255, 255, 0.05)`.
- **Primary Action Accent**: `#3B82F6` (Electric Blue) hover `#2563EB`.
- **Severity Tokens**:
  - `critical`: Crimson `#EF4444` (`bg: rgba(239, 68, 68, 0.12)`, `border: rgba(239, 68, 68, 0.35)`, glow: `0 0 12px rgba(239, 68, 68, 0.25)`).
  - `high`: Flame Orange `#F97316` (`bg: rgba(249, 115, 22, 0.12)`, `border: rgba(249, 115, 22, 0.35)`).
  - `medium`: Amber `#F59E0B` (`bg: rgba(245, 158, 11, 0.12)`, `border: rgba(245, 158, 11, 0.35)`).
  - `low`: Cyan `#06B6D4` (`bg: rgba(6, 182, 212, 0.12)`, `border: rgba(6, 182, 212, 0.35)`).
  - `informational`: Slate `#94A3B8` (`bg: rgba(148, 163, 184, 0.10)`, `border: rgba(148, 163, 184, 0.20)`).
- **Verification Verdict Tokens**:
  - `confirmed`: Neon Emerald `#10B981` (`bg: rgba(16, 185, 129, 0.12)`).
  - `needs_validation`: Amber/Sunset `#F59E0B` (`bg: rgba(245, 158, 11, 0.12)`).
  - `rejected`: Muted Zinc `#71717A` (`bg: rgba(113, 113, 122, 0.12)`).

---

## 3. UI Reference Mapping (`ui-references/`)

The repository includes 16 high-fidelity design references in [ui-references/](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references). Each screen in our platform directly adopts key architectural components from these references:

| Image Reference                                                                                         | Source Concept              | Target Screen / Modal               | Key Elements to Replicate on Stitch                                                                                                                                                      |
| :------------------------------------------------------------------------------------------------------ | :-------------------------- | :---------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [sec-1.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-1.webp)   | `vuln.eye` Dark Dashboard   | **Org Overview (`/overview`)**      | Metric sparkline cards, CVSS score badges (10.0, 9.8), regional threat distribution map, quick time-range filter, and download report CTA.                                               |
| [sec-2.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-2.webp)   | Full App Scanning Rail      | **Run Timeline (`/runs/:id`)**      | Right-hand pipeline progress rail (`Connectivity Check` $\rightarrow$ `Crawling` $\rightarrow$ `Active` $\rightarrow$ `Emerging Threats`), grade progression bar (A-E), auditor avatars. |
| [sec-3.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-3.webp)   | Astra Security Dark Shell   | **Global Shell & Project View**     | Collapsible sidebar navigation, multi-workspace switcher (`2 Workspaces, 5 Targets`), grouped vulnerability list, severity matrix heatmap.                                               |
| [sec-4.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-4.webp)   | Pentest Hero & Filters      | **Project View (`/projects/:id`)**  | Clean hero banner with instant scan trigger, pill filter tabs (`All`, `In Progress`, `Vulnerabilities`, `Completed`), target tags.                                                       |
| [sec-5.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-5.webp)   | Continuous Scanning View    | **Run Timeline (`/runs/:id`)**      | Stage-by-stage ETA and completion tracker (`ETA Friday · 33%`), dual-tab switch between "Vulnerabilities" and "Test Cases".                                                              |
| [sec-6.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-6.webp)   | Executive Grade & Trends    | **Org Overview (`/overview`)**      | Overall Security Grade pills (`A B C D E`), Potential Loss Saved metric, Severity distribution columns (`24 Critical`, `35 High`, `64 Med`), Open vs Resolved dual sparklines.           |
| [sec-7.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-7.webp)   | Workspace & Target Modal    | **Tenant & Repo Switcher Modal**    | Two-column modal: left sidebar for Workspaces/Tenants, right pane for Targets/Repositories with status pills (`Delivery Completed`, `Pending`).                                          |
| [sec-8.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-8.webp)   | Light Posture Dashboard     | **Light Theme Alternate**           | High-contrast enterprise light palette with clean card drop-shadows and status checklists.                                                                                               |
| [sec-9.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-9.webp)   | CI/CD Integration Hub       | **Integrations View (`/policy`)**   | App integration grid: GitHub, GitLab, Bitbucket Server connectors with `Active` / `Connect` pills and action buttons.                                                                    |
| [sec-10.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-10.webp) | Quick Audit Command Palette | **Trigger Run Command Modal**       | Segmented scan intensity selector (`Light`, `Standard`, `Deep` with `AI · Light reasoning` badge), target repo input, token budget meter (`46 / 50 left`).                               |
| [sec-11.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-11.webp) | Real-time SSE Execution     | **Live Run Stream Modal**           | Real-time progress bar (64%), step-by-step activity log console (`Target resolved` $\rightarrow$ `Port scan` $\rightarrow$ `Service detection`), pause/cancel buttons.                   |
| [sec-12.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-12.webp) | Scan Complete Modal         | **Run Completion Summary**          | Clean modal listing discovered vulnerabilities with color-coded severity pills (`CRITICAL`, `HIGH`, `MEDIUM`) and direct finding links.                                                  |
| [sec-13.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-13.webp) | Exploit Evidence Terminal   | **Finding Detail Proof Modal**      | Embedded monospace terminal displaying sandbox exploit logs (e.g., `sqlmap` execution, database dump) and extracted user credentials table.                                              |
| [sec-14.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-14.webp) | Root Privilege Confirmation | **Finding Verification Proof**      | Terminal trace showing privilege escalation (`whoami && id -> root`), checklist of confirmed impacts (`Shell access`, `Root privileges`, `Full filesystem access`).                      |
| [sec-15.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-15.webp) | Executive Report Summary    | **Audit Export Dialog (`/export`)** | Target overview card, scan duration badge, confirmed impact checklist, direct `Download PDF` action button.                                                                              |
| [sec-16.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-16.webp) | Vulnerability Kanban Board  | **Review Queue & Triage Board**     | Multi-column drag-and-drop board (`Draft`, `Unsolved`, `Under Review`, `Solved`, `Need Help`), CVSS burst badges, and `Verified by System 2` tooltips.                                   |

---

## 4. Screen-by-Screen Redesign Specifications & Stitch Prompts

### Screen 1: Org Overview (`/` and `/overview`)

- **Reference**: [sec-1.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-1.webp), [sec-6.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-6.webp)
- **Goal**: Provide the CISO and SecOps lead with an instantaneous pulse of overall security posture, MTTR, SLA breaches, and cross-repo attack classes.

#### Wireframe Breakdown

1. **Top Nav / Global Header**:
   - Workspace/Tenant Selector with tenant isolation pill (e.g., `FinTech Global Corp`).
   - "Show Rejected Findings" toggle (hidden by default per PRD 5.4).
   - Global Quick-Scan Trigger button (`⌘K` or "Run Audit").
   - Light/Dark theme toggle + User avatar (`Security Admin`).
2. **Hero Metric Cards (Grid of 4)**:
   - **Open Findings**: Total open count, verified severity breakdown pills (`Critical: 3`, `High: 8`, `Med: 14`).
   - **Active SLA Breaches**: Highlighted with ruby-red pulsing warning dot, linking directly to overdue findings.
   - **Mean Time to Remediate (MTTR)**: e.g. `4.2 days` with $\downarrow 18\%$ improvement sparkline.
   - **Monitored Repositories & Coverage**: Audited units percentage (e.g. `87.4% across 18 repos`).
3. **Cross-Project Attack-Class Heatmap**:
   - Matrix showing Attack Classes (`authn`, `authz`, `injection`, `config`, `secrets`, `client_side`, `deserialization`) across repositories.
   - Colored cells by highest severity finding present in that slice.
4. **Active SLA Breach Table**:
   - Columns: Severity, Finding Title, Target Repo, Due Date, Days Overdue, Assignee, Actions.

#### Google Stitch Generation Prompt

```text
Create a modern, sleek dark-mode cybersecurity posture overview dashboard called 'SecDevOps Audit Platform - Org Overview'.
Layout:
- Left-hand collapsible dark sidebar (#0D1322) with brand logo, workspace switcher, and navigation items: Overview, Projects, Review Queue, Policy & Gates, Compliance Export.
- Top header with search bar, global toggle 'Show Rejected Leads' (off by default), date range dropdown ('Last 30 Days'), and a glowing blue 'Trigger Audit Run' button.
- Top row: 4 KPI metric cards in dark obsidian (#111827) with subtle 1px glassmorphic borders:
  1. 'Open Findings' (Count: 25, mini breakdown tags: 3 Critical red, 8 High orange, 14 Med yellow, sparkline trend).
  2. 'SLA Breaches' (Count: 2, highlighted with bright crimson alert border and warning icon).
  3. 'Mean Time to Remediate' (Value: 4.2 Days, with green -18% sparkline badge).
  4. 'Audited Coverage' (Value: 88.5%, circular progress ring).
- Main section (2 columns, 65% / 35%):
  - Left column: 'Attack Class Distribution Matrix' showing repositories on Y axis and attack types (AuthN, AuthZ, SQL Injection, SSRF, Secrets, RCE) on X axis, with glowing heat-map indicators. Below it, 'Recent High-Risk Findings' table with CVSS score badges, CWE numbers, and verification status pills ('Confirmed', 'Needs Validation').
  - Right column: 'Overall Security Posture Grade' card showing grade 'B+' with circular grade indicator, 'Potential Financial Loss Prevented ($1.4M)', and dual 'Identified vs Remediated' sparkline charts in red and green.
Style: Ultra-modern dark UI (#090D16 background, #111827 surfaces), glowing severity badges, crisp monospaced font for IDs, high visual fidelity inspired by Linear and Wiz.
```

---

### Screen 2: Project View (`/projects/:id`)

- **Reference**: [sec-3.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-3.webp), [sec-4.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-4.webp)
- **Goal**: Single-repository governance dashboard showing release gate readiness, token spend, coverage ledger, and run history.

#### Wireframe Breakdown

1. **Repository Banner**:
   - Git repository URL (`github.com/org/payment-service`), owning team (`Payments Team`), default branch (`main`).
   - **Release Gate Banner**: Large status pill — `GATE: BLOCKED` (red) or `GATE: PASS` (emerald) based on policy enforcement mode (`enforce` vs `report_only`).
   - Token budget gauge (`$142.50 / $250.00` monthly budget used).
2. **Coverage Ledger Summary Card**:
   - Total vs audited code units (e.g. `142 / 160 units, 88.75%`).
   - Un-audited target gap paths list (collapsible) with "Schedule Targeted Audit" quick action.
3. **Run History Timeline Table**:
   - Run ID, Mode badge (`focused`, `incremental`, `full`), Git Commit SHA, Duration, Validator Status badges (`validate-findings: PASS`), Token Cost ($ USD), and "View Diagnostics" action.
4. **Trigger Run Modal Dialog**:
   - Interactive modal triggering `focused`, `incremental`, or `full` runs with target branch/commit SHA input.

#### Google Stitch Generation Prompt

```text
Design a dark-mode project governance and security audit view for a specific repository ('payment-service') in SecDevOps Audit Platform.
Components:
1. Header Card: Repository name 'org/payment-service', Git branch pill 'main · 7f9a12c', Owning Team badge 'Core FinTech', and an interactive 'Trigger New Audit' action button with dropdown ('Full Audit', 'Incremental', 'Focused Target').
2. Status Callout Banner: 'Release Gate Status: BLOCKED' in bold crimson glassmorphic card, explaining: 'Blocked by 2 Confirmed Critical findings under strict policy mode (Enforce)'. Include an 'Active Exceptions: 0' tag.
3. Metric Bar (3 cards):
   - 'Coverage Ledger': 88.8% audited (142 of 160 code units analyzed, 18 gaps pending).
   - 'Token & Model Budget': $142.50 spent of $250.00 monthly cap (progress bar with 57%).
   - 'Active Findings': 12 total (2 Critical, 4 High, 6 Medium).
4. Run History Table: Columns for Run ID (#run-9821), Audit Mode pill ('Full', 'Incremental'), Commit SHA in monospace, Phase Progress dots (Preflight -> Recon -> Hunt -> Validate -> Report), Execution Duration ('3m 42s'), Cost ('$4.82'), Skill Validators status ('Passed'), and chevron link to run diagnostics.
5. Filterable Findings Ledger: Table of active vulnerabilities for this repository with search bar, severity filter pills, and quick triage status.
Aesthetic: Dark cyber styling (#090D16), glowing borders on blocked gates, crisp tabular typography, modern badges.
```

---

### Screen 3: Run Timeline & Diagnostics (`/runs/:id`)

- **Reference**: [sec-2.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-2.webp), [sec-5.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-5.webp), [sec-11.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-11.webp)
- **Goal**: Deep diagnostic trace of autonomous audit executions, real-time SSE stream events, and multi-model fallback chains.

#### Wireframe Breakdown

1. **Run Header & Accounting Summary**:
   - Status badge with live spinner if running (`queued`, `running`, `succeeded`, `failed`).
   - Duration timer, Total tokens ingested/generated, Total Cost in USD.
   - Skill Validators status cards (`validate-findings.cjs`: PASS, `validate-coverage-ledger.cjs`: PASS).
2. **Phase Progression Track (Horizontal or Stepper Rail)**:
   - 5 core audit phases: `Preflight` $\rightarrow$ `Recon` $\rightarrow$ `Hunt` $\rightarrow$ `Validate` $\rightarrow$ `Report`.
   - Each phase shows duration, token consumption, and status dot.
3. **Work Slices & Model Fallback Ledger**:
   - Granular table of parallel slices (e.g. `slice-auth-handlers`, `slice-db-queries`).
   - **Model Fallback Chain Indicator**: Explicitly highlights multi-attempt failovers:
     - _Attempt 1_: `gemini-4-argon-high` $\rightarrow$ `Failed (RateLimit 429)`.
     - _Attempt 2_: `claude-sonnet-5-5` $\rightarrow$ `Success (2 findings extracted)`.
4. **Live SSE Console / Event Stream**:
   - Collapsible terminal-style log streaming events (`/api/v1/runs/:id/events/stream`) with color-coded log levels (`[INFO]`, `[HUNTER]`, `[VALIDATOR]`, `[WARN]`).
5. **Artifacts Registry Drawer**:
   - Direct download links for generated reports: `report.md`, `findings.json`, `coverage-ledger.json`, `architecture.md`, `needs-validation.md`.

#### Google Stitch Generation Prompt

```text
Design a high-tech audit run execution diagnostics and timeline screen for 'Run #run-4029' in a dark-mode SecDevOps platform.
Key Elements:
1. Header Bar: 'Run #run-4029 · payment-service@main', Run Status badge ('SUCCEEDED' in neon green), Total Duration ('4m 18s'), Total Token Cost ('$3.14 · 1.2M tokens'), and SSE Live Stream connected pill with pulsating green light.
2. Skill Validators Bar: Two checkmark badges: 'validate-findings.cjs: PASSED' and 'validate-coverage-ledger.cjs: PASSED'.
3. Phase Pipeline Stepper: 5 connected cards showing progression:
   - Preflight (Done, 12s, $0.05)
   - Recon (Done, 45s, $0.42)
   - Hunt (Done, 2m 10s, $1.85)
   - Validate (Done, 58s, $0.72)
   - Report (Done, 23s, $0.10)
4. Model Fallback Chain Ledger: A card highlighting autonomous model resilience:
   - Slice 'auth-middleware.ts': Attempt 1 on 'gemini-4-argon-high' (failed: rate_limit_exceeded) -> Auto-fallback Attempt 2 on 'claude-sonnet-5-5' (succeeded, 1 finding identified).
5. Live Console Stream: Terminal-like black container (#0B0F19) displaying server-sent events (SSE) logs with timestamps, model IDs, and color-coded event tags.
6. Artifacts Download Panel: Grid of download cards for 'report.md', 'findings.json', 'coverage-ledger.json', and 'needs-validation.md'.
Styling: Deep dark canvas (#090D16), glowing status accents, monospaced log traces, sleek tech aesthetics.
```

---

### Screen 4: Finding Detail & Triage Console (`/findings/:id`)

- **Reference**: [sec-13.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-13.webp), [sec-14.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-14.webp), [sec-16.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-16.webp)
- **Goal**: Provide security engineers with conclusive exploit proof, source trace, AI advisory recommendations, fix diffs, and strictly enforced triage state transitions.

#### Wireframe Breakdown

1. **Finding Headline & Metadata**:
   - Attack Class tag (`injection`), CWE (`CWE-89: SQL Injection`), Fingerprint SHA.
   - Model + Phase Attribution tag (`Hunter: gemini-4-argon-high · Phase: hunt`).
2. **Side-by-Side Severity Comparison**:
   - **Hunter Preliminary Severity** (Left card, e.g. `High`, non-binding).
   - **Verifier Authoritative Severity** (Right card, e.g. `Critical`, **System 2 gate-binding**).
3. **System 1 (Jev) Triage Advisory Card**:
   - Prominently badged `System 1 · Advisory (Non-Binding)` in purple/violet.
   - Predicted severity band probabilities (`Critical 82%`, `High 15%`, `Med 3%`).
   - Recommended team owner with confidence rating (`Payments Core · 94% confidence`).
   - False-positive risk score (`< 2%`).
4. **Vulnerability Source Trace (Entrypoint $\rightarrow$ Propagation $\rightarrow$ Sink)**:
   - Visual step-by-step dataflow viewer with syntax-highlighted code snippets and exact file lines.
5. **Interactive Sandbox Verification Proof & Root Access Modal**:
   - Monospace terminal showing simulated sandbox exploit proof (e.g. `sqlmap` execution or script execution confirming database exfiltration).
   - Confirmed Impact Checklist (`Shell access confirmed`, `Root privileges confirmed`, `Filesystem access confirmed`).
6. **Automated Fix Draft**:
   - Badged `Draft · Human Review Only`.
   - Side-by-side git diff viewer showing proposed sanitization/parameterization code patch.
7. **Triage Action Form & State Machine**:
   - Enforces valid `TRIAGE_TRANSITIONS`:
     - `open` $\rightarrow$ `triaged`, `false_positive`, `accepted_risk`, `remediated`.
     - `accepted_risk` requires mandatory **Expiration Date** & **Approver**.
     - `false_positive` requires mandatory **Justification Reason**.
     - Disallowed transitions are strictly disabled in the UI.
8. **Tamper-Evident Audit History**:
   - Chronological log of all past triage state changes, actor emails, timestamps, and justification notes.

#### Google Stitch Generation Prompt

```text
Create a comprehensive, dark-mode vulnerability detail and triage interface for 'CWE-89 SQL Injection in /api/v1/search' in SecDevOps Audit Platform.
Layout & Components:
1. Top Header: Finding title, Attack Class badge 'injection' (red), CWE tag 'CWE-89', Fingerprint hash 'a8f1...b92c', and AI Attribution chip 'Hunter: gemini-4-argon-high (Phase: hunt)'.
2. Dual Severity Card: Two side-by-side cards comparing:
   - 'Hunter Preliminary Severity': HIGH (pre-verification).
   - 'Verified Authoritative Severity': CRITICAL (System 2 sandbox proved, release gate blocking).
3. System 1 Advisory Box: Violet/purple glassmorphic container badged 'System 1 · Advisory (Non-Binding)' displaying predicted severity probabilities (Critical 84%), suggested owner ('@payments-backend' with 94% confidence), and False Positive Risk (1.8%).
4. Vulnerability Dataflow Trace: 3-step visual trace cards:
   - Step 1 (Entrypoint): 'req.query.q' in 'controllers/search.ts:34'.
   - Step 2 (Propagation): 'rawQuery' variable passed unescaped to 'models/query.ts:89'.
   - Step 3 (Sink): 'db.query(rawQuery)' in 'db/driver.ts:112'.
5. Exploit Verification Proof Panel: Monospace terminal box (#0B0F19) displaying verified sandbox reproduction logs ('$ sqlmap -u ... parameter appears injectable (boolean-based blind)'), with 3 green verified checklist items ('Shell access', 'Data exfiltration', 'Proof confirmed').
6. Generative Remediation Patch: 'Draft · Human Review Only' code diff block with green additions (+ parameterized query) and red deletions (- string interpolation).
7. Triage State Action Card: State selector dropdown enforcing valid transitions, justification textarea, expiry date picker (for accepted risk), and 'Commit Triage Decision' button.
8. Triage Audit Trail: Timeline showing previous actions by security analysts.
Style: Dark aesthetic (#090D16), glowing badges, high-contrast syntax highlighting, enterprise cyber tool look.
```

---

### Screen 5: Security Review Queue (`/review-queue`)

- **Reference**: [sec-3.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-3.webp), [sec-16.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-16.webp)
- **Goal**: Dedicated workspace for items marked `needs_validation`, where hunter agents found candidate flaws but automated sandbox proof was blocked.

#### Wireframe Breakdown

1. **Policy Invariant Banner**:
   - Blue/info banner explicitly reinforcing: _"Review queue items (`needs_validation`) never block a release gate on their own. They require human validation or environmental configuration to prove or refute."_
2. **Filter Controls**:
   - Filter by Attack Class, Repository, Assigned Analyst, and Resolution Blocker type.
   - Dual view toggle: **Table View** vs **Kanban Board** ([sec-16.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-16.webp)).
3. **Queue Item Cards**:
   - Finding title, target repo, hunter severity.
   - **Resolution Blocker Tag**: Clear badge explaining what blocked automated proof (e.g. `Blocked: Dynamic Reflection`, `Blocked: Missing Mock DB`, `Blocked: OAuth Provider Unavailable`).
   - Quick action buttons: "Launch Sandbox Session", "Mark Confirmed", "Refute Lead (Reject)".

#### Google Stitch Generation Prompt

```text
Design a dark-mode 'Security Review Queue' screen for unverified vulnerability leads ('needs_validation') in a DevSecOps platform.
Key Features:
1. Header: 'Security Review Queue' with count '14 Leads Pending Human Validation'.
2. Explanatory Banner: Glassmorphic alert callout: 'Policy Invariant: Review queue items do NOT block release gates. Automated sandbox verification encountered environmental blockers that require human triage.'
3. Filter Toolbar: Attack class dropdown, repository selector, search bar, and view toggle ('Table View' | 'Kanban Board').
4. Interactive Kanban Board (or List): Cards grouped by blocker category:
   - Column 1: 'Dynamic Reflection / Metaprogramming' (4 items)
   - Column 2: 'External Service Dependencies' (6 items)
   - Column 3: 'Missing Runtime Secrets' (4 items)
5. Card Anatomy:
   - Finding Title (e.g. 'Potential Deserialization in XMLParser')
   - Repo: 'payments/worker@main'
   - Hunter preliminary severity: High
   - Blocker Reason chip in amber: 'Blocker: SOAP client requires live endpoint mock'
   - Actions: 'Test in Sandbox', 'Confirm Lead', 'Refute (Reject)'.
Visuals: Dark background (#090D16), amber warning accents, clean drag-and-drop card styling.
```

---

### Screen 6: Policy & Exceptions (`/policy`)

- **Reference**: [sec-8.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-8.webp), [sec-9.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-9.webp)
- **Goal**: Manage Policy-as-Code rules, enforcement modes (`enforce` vs `report_only`), SLA targets, and active security exceptions.

#### Wireframe Breakdown

1. **Policy Mode Switcher**:
   - Global or per-repo enforcement toggle: `Enforce Mode` (fails CI/release gate on open confirmed Critical/High) vs `Report-Only Mode` (audits run without breaking CI builds).
2. **Gate Threshold Configuration**:
   - Minimum blocking severity selector (e.g. `Critical + High`).
   - Blocked attack classes multi-select.
   - Remediation SLA targets (Critical: 24h, High: 7d, Medium: 30d, Low: 90d).
3. **Exceptions Ledger**:
   - Table of active and expired exceptions (`accepted_risk` and `false_positive`).
   - Displays Finding ID, Approver Email, Justification Reason, Expiration Date, and Status (`Active` green, `Expired` red).
   - "Revoke Exception" and "Extend Expiry" action buttons.

#### Google Stitch Generation Prompt

```text
Create a sleek dark-mode 'Policy & Security Exceptions' configuration view for a DevSecOps audit platform.
Sections:
1. Policy-as-Code Configuration:
   - Mode Toggle: 'Enforcement Mode' (Active - Releases block on policy failures) vs 'Report-Only Mode' (Advisory only).
   - Release Gate Rules: Checkbox grid for blocking conditions: 'Block on any open Confirmed Critical', 'Block on open Confirmed High', 'Block on SLA breach'.
   - SLA Targets: Editable inputs for SLA deadlines (Critical: 1 day, High: 7 days, Medium: 30 days).
2. Security Exceptions Ledger:
   - Clean data table listing approved security waivers.
   - Columns: Finding ID (#f-8812), Vulnerability Title, Approving Security Lead, Approval Date, Expiration Date, Status badge ('Active' green, 'Expiring in 2 days' orange, 'Expired' red).
   - Actions: 'Add Security Exception', 'Revoke', 'Audit History'.
Aesthetics: Refined dark obsidian theme (#111827 surfaces), crisp toggle switches, clean input fields, glowing status indicators.
```

---

### Screen 7: Release Readiness (`/release-readiness`)

- **Reference**: [sec-2.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-2.webp), [sec-6.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-6.webp)
- **Goal**: Real-time release gate status for release engineering and DevOps, deterministically computing `evaluateGate()` across all release candidates.

#### Wireframe Breakdown

1. **Strict Invariant Display**:
   - Prominent header banner: _"Strict Invariant: ONLY open confirmed findings can fail a release gate. Advisory System 1 suggestions and needs_validation items never block."_
2. **Multi-Project Release Matrix**:
   - Table of upcoming releases with Pass/Blocked status pill.
   - Blocked releases display the exact list of gate-blocking confirmed findings with one-click links.
   - "Bypass with Exception" action requiring dual security lead approval.

#### Google Stitch Generation Prompt

```text
Design a mission-critical 'Release Readiness & Gatekeeper' dashboard screen for DevOps engineers in a dark UI theme.
Layout:
1. Top Rule Banner: 'Deterministic Gatekeeper: Releases are blocked ONLY by open, verified confirmed vulnerabilities. Unverified leads and advisory suggestions never fail a gate.'
2. Overall Release Summary: 12 Projects Audited: 10 READY TO DEPLOY (green), 2 BLOCKED BY SECURITY GATE (red).
3. Projects Gate Matrix: Table showing:
   - Repository Name ('payment-service', 'auth-api', 'web-gateway')
   - Release Candidate Tag ('v2.4.0-rc1')
   - Gate Verdict (Large glowing pill: 'PASSED' in emerald or 'BLOCKED' in ruby red)
   - Gate-Blocking Findings Count (e.g. '2 Confirmed Blockers')
   - Exception Override Status ('None', 'Approved Exception')
   - Action Button ('Inspect Blockers' or 'Approve Release')
4. Blocker Drill-Down Panel (expanded for 'payment-service'): Lists the 2 blocking vulnerabilities (CWE-89 SQL Injection and CWE-287 Authentication Bypass) with direct links to sandbox proofs and one-click 'Request Emergency Exception' button.
Style: High-contrast dark palette (#090D16), glowing red and green status indicators, technical typography.
```

---

### Screen 8: Compliance & Audit Export (`/export`)

- **Reference**: [sec-1.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-1.webp), [sec-15.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-15.webp)
- **Goal**: Export client-ready security audit reports in CSV, Markdown, and print-ready PDF formats.

#### Wireframe Breakdown

1. **Export Configuration Panel**:
   - Target Project & Period Selector (Date range picker, All Repositories vs Single Project).
   - Severity & Status Filters (Include/exclude rejected leads, include triage audit history).
2. **Format Selection & Action Cards (Grid of 3)**:
   - **CSV Export**: Client-side generated tabular dataset with escaping.
   - **Markdown Export**: Formatted executive summary and vulnerability detail document for client compliance deliverables.
   - **PDF Export via Print Stylesheet**: Dedicated `@media print` CSS cleanly hiding navigation, sidebars, and interactive controls to produce clean audit PDFs via browser print dialog.
3. **Live Document Preview**:
   - Interactive document preview showing formatted executive summary, posture score, and findings breakdown.

#### Google Stitch Generation Prompt

```text
Create a dark-mode 'Audit Report & Compliance Export' screen for SecDevOps Audit Platform.
Components:
1. Export Configuration Card: Project dropdown ('All Monitored Projects' or select single repo), Date range selector ('Q3 2026 Audit Period'), and Checkbox filters ('Include Verified Findings', 'Include Accepted Risks', 'Include Triage Sign-offs').
2. Export Options Grid (3 Cards):
   - 'Client-Ready Audit PDF' (Icon: File-Text): 'Official compliance deliverable with executive summary, methodology, and verified findings. Formatted with clean print stylesheet.' -> Blue CTA button 'Generate & Print PDF'.
   - 'Markdown Technical Report' (Icon: Code): 'Full markdown document for technical review, pull requests, and security tickets.' -> Secondary CTA 'Download .MD'.
   - 'Raw Findings CSV' (Icon: Table): 'Complete tabular vulnerability ledger for spreadsheet analysis and SIEM ingestion.' -> Secondary CTA 'Export CSV'.
3. Report Live Preview Pane: A paper-like document container previewing the generated executive summary with company branding, audit timestamp, scope ledger, and verified vulnerabilities table.
Styling: Dark cyber aesthetic (#090D16) with clean white document preview panel, modern iconography.
```

---

### Key Modals: Command Palette & Sandbox Proof Terminal

- **Reference**: [sec-10.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-10.webp), [sec-13.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-13.webp), [sec-14.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-14.webp)

#### Modal 1: Quick-Scan Command Palette (`⌘K`)

- **Reference**: [sec-10.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-10.webp)
- **Google Stitch Prompt**:

```text
Design a floating command palette modal dialog (#111827) with backdrop blur for launching security audits.
Features:
- Search input with search icon: 'Scan repository or target for vulnerabilities...'
- Scan Intensity segmented selector:
  - 'Light': Fast port/config check
  - 'Standard': Codebase AST scan & hunter agents
  - 'Deep' (badged with 'AI · Multi-Agent Reasoning'): Full 6-phase scan with sandbox verification
- Bottom status bar: Keyboard shortcuts ('↑↓ Navigate', '↵ Scan', 'ESC Close') and token credit meter '46 / 50 runs remaining'.
Aesthetic: Minimalist, glassmorphic, glowing active segment.
```

#### Modal 2: Interactive Sandbox Exploit Proof Terminal

- **Reference**: [sec-13.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-13.webp), [sec-14.webp](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/ui-references/sec-14.webp)
- **Google Stitch Prompt**:

```text
Design a dark-mode modal dialog displaying an autonomous sandbox exploit verification proof for SQL Injection.
Components:
- Modal Header: 'Exploiting SQL Injection' with target '/api/v1/search?q=...' and 'Cancel' button.
- Terminal Window (#0B0F19): Monospace text showing real-time execution:
  $ sqlmap -u "https://target.local/api/v1/search?q=1" --dbs
  [*] starting detection engine
  [+] parameter 'q' appears injectable (boolean-based blind)
  [+] back-end DBMS: PostgreSQL 16
  [*] dumping table 'users' ... 1,284 rows extracted
- Extracted Data Evidence Card: Sample records showing anonymized accounts ('admin@example.com', 'Role: ADMIN').
- Access Impact Summary: 3 checkmarked pills ('Shell Access Confirmed', 'Database Read/Write Proved', 'Root Privileges Confirmed').
- Footer Actions: 'Back to Finding' and 'Download Full Evidence Log'.
Aesthetic: Cyberpunk/terminal feel with green and cyan syntax highlighting on deep black background.
```

---

## 5. Architectural & Platform Invariants

Any code or screen generated via Stitch must strictly preserve these platform invariants:

1. **System 2 Gate-Binding Severity**:
   - `Hunter Preliminary Severity` is advisory.
   - Only `Verifier Authoritative Severity` can bind release gates.
2. **Non-Blocking Rule for Advisory Items**:
   - System 1 Jev suggestions (`System 1 · Advisory (non-binding)`) and Review Queue items (`needs_validation`) **NEVER block a merge or fail a gate on their own**.
3. **AI Attribution Transparency**:
   - All AI-generated content (findings, summaries, remediation fix drafts) must display a visible attribution tag (`Hunter: <model> · Phase: <phase>` or `Draft · Human Review Only`).
4. **Default Hiding of Rejected Leads**:
   - Refuted candidate leads (`rejected`) are hidden by default across all tables and charts. They are revealed only when the user toggles "Show Rejected Findings" in the global navigation bar.
5. **Enforced Triage State Transitions**:
   - UI transition buttons must strictly conform to `TRIAGE_TRANSITIONS`.
   - `accepted_risk` requires expiration date and approver.
   - `false_positive` requires justification reason.
6. **Standalone Mock API Compatibility**:
   - The UI must run completely standalone via `pnpm dev:mock` without requiring a live backend, using `@sdap/core` Zod schemas and synthetic fixtures.

---

## 6. Google Stitch MCP Execution Log & Artifact Registry

The Stitch MCP server (`https://stitch.googleapis.com/mcp`) has been successfully connected and executed for the entire suite of platform screens and subpages.

### Live Stitch Project Metadata

- **Project Name**: `SecDevOps Audit Platform`
- **Project Resource ID**: `projects/9700812912285765434` (`projectId: 9700812912285765434`)
- **Active Modular Design System**: `shadcn/ui Zinc (Bright & Dark)` (`assets/14003065313697164838`)
- **Legacy Design System**: `Obsidian Sentinel` (`assets/5cc97f5b0a5448ba8655164ec85e562d`)

### Comprehensive Screen & Subpage Catalog

All 8 core pages, living styleguide, and 2 interactive subpage modals have been generated on Stitch, downloaded locally, and mirrored in both HTML code and 4K PNG renders:

| #   | Screen / Subpage Title                                    | Stitch Screen ID                   | Dimensions         | Local HTML Asset                                                                                                                                         | High-Res Render Screenshot                                                                                                                             |
| :-- | :-------------------------------------------------------- | :--------------------------------- | :----------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Design System & Component Library**                     | `5c2cdedd54ab403a9f2be437aa342cc3` | 2560 $\times$ 7798 | [`design-system-components.html`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/design-system-components.html) | [`design-system-components.png`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/design-system-components.png) |
| 2   | **Org Overview (Bright Mode Default)**                    | `ca6c3e21a8c14772b07031595de50d05` | 2560 $\times$ 2938 | [`org-overview.html`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/org-overview.html)                         | [`org-overview.png`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/org-overview.png)                         |
| 3   | **Project View / Governance** (`/projects/:id`)           | `d0f86fa241c642c09e508cc59b9cc4a7` | 2560 $\times$ 2740 | [`project-view.html`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/project-view.html)                         | [`project-view.png`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/project-view.png)                         |
| 4   | **Finding Detail & Triage Console** (`/findings/:id`)     | `caf1a48823ed4d3cba1eba39a6650e45` | 2560 $\times$ 4472 | [`finding-detail.html`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/finding-detail.html)                     | [`finding-detail.png`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/finding-detail.png)                     |
| 5   | **Run Diagnostics & Timeline** (`/runs/:id`)              | `9d0edf18e4824ddfac87601c9199caa0` | 2560 $\times$ 4032 | [`run-timeline.html`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/run-timeline.html)                         | [`run-timeline.png`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/run-timeline.png)                         |
| 6   | **Security Review Queue** (`/review-queue`)               | `337433812d244d64a0e6a4ee22efb9d7` | 2560 $\times$ 4116 | [`review-queue.html`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/review-queue.html)                         | [`review-queue.png`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/review-queue.png)                         |
| 7   | **Policy & Security Exceptions** (`/policy`)              | `93e3251d3ff24ef0a357922cdf764cbf` | 2560 $\times$ 2840 | [`policy-exceptions.html`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/policy-exceptions.html)               | [`policy-exceptions.png`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/policy-exceptions.png)               |
| 8   | **Release Readiness & Gatekeeper** (`/release-readiness`) | `056bfac9227d4cd08ef47b7ed8a44f1f` | 2560 $\times$ 3030 | [`release-readiness.html`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/release-readiness.html)               | [`release-readiness.png`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/release-readiness.png)               |
| 9   | **Compliance & Audit Export** (`/export`)                 | `8d73c34ec6a348e78bff3b75e758bbc1` | 2560 $\times$ 3740 | [`compliance-export.html`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/compliance-export.html)               | [`compliance-export.png`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/compliance-export.png)               |
| 10  | **Modal: Quick-Scan Command Palette** (`⌘K`)              | `3604e59e08554715b71fdf7c45bccff7` | 2560 $\times$ 2048 | [`command-palette-modal.html`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/command-palette-modal.html)       | [`command-palette-modal.png`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/command-palette-modal.png)       |
| 11  | **Modal: Sandbox Exploit Proof Terminal**                 | `bfc24ce86ab94b5a9a461b58ca193702` | 2560 $\times$ 2048 | [`exploit-terminal-modal.html`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/exploit-terminal-modal.html)     | [`exploit-terminal-modal.png`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/exploit-terminal-modal.png)     |
