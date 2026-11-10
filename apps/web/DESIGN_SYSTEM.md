---
type: "DesignSystem"
status: "Active"
icon: "palette"
project: "[[secdevops-audit-platform]]"
subsystem: "[[apps/web]]"
workstream: "[[WS5]]"
reference: "https://ui.shadcn.com/docs/installation"
---

# SecDevOps Audit Platform Design System & Guidelines

## 1. Philosophy & Architectural Foundation

The SecDevOps Audit Platform UI (`@sdap/web`) is built on a **modular, component-driven design system** inspired by **shadcn/ui** and **Radix UI** primitives.

### Core Tenets

1. **Bright Theme First (Default is White `#FFFFFF`)**:
   - Clean, high-legibility enterprise canvas designed for daytime security operations and auditor compliance reviews.
   - Secondary **Dark Mode (`#09090B`)** toggleable globally via `.dark` class or `[data-theme="dark"]`.
2. **Modular Primitive Composition**:
   - Every interface element is constructed from standalone, composable primitives (`Button`, `Card`, `Badge`, `Tabs`, `Table`, `Input`, `Alert`, `Modal`).
   - No ad-hoc or inline styles; all components consume semantic design tokens.
3. **Dual-Track Security Telemetry**:
   - **System 1 Heuristics**: Advisory, non-blocking suggestions badged in violet/indigo (`#7C3AED`).
   - **System 2 Verification**: Authoritative sandbox proofs badged in emerald (`#10B981`) or blocking crimson (`#EF4444`).
4. **Deterministic Information Hierarchy**:
   - High information density with micro-borders (`1px solid var(--border)`).
   - Monospace typography (`JetBrains Mono`) for all hashes, commit SHAs, CVEs, and CVSS scores.

---

## 2. Design Tokens & CSS Variables

The platform implements dual-theme semantic CSS tokens configured in `src/index.css`.

### 2.1 Color Tokens Dictionary

```
┌───────────────────────────────┬──────────────────────────┬──────────────────────────┐
│ Token Variable                │ Bright Theme (Default)   │ Dark Theme (.dark)       │
├───────────────────────────────┼──────────────────────────┼──────────────────────────┤
│ --background                  │ #ffffff (Pure White)     │ #09090b (Deep Zinc)      │
│ --foreground                  │ #09090b (Dark Zinc)      │ #f4f4f5 (Light Zinc)     │
│ --card                        │ #ffffff                  │ #18181b (Card Surface)   │
│ --card-foreground             │ #09090b                  │ #f4f4f5                  │
│ --popover                     │ #ffffff                  │ #18181b                  │
│ --popover-foreground          │ #09090b                  │ #f4f4f5                  │
│ --primary                     │ #18181b (Solid Dark)     │ #f4f4f5 (Solid White)    │
│ --primary-foreground          │ #ffffff                  │ #09090b                  │
│ --secondary                   │ #f4f4f5 (Light Gray)     │ #27272a (Muted Dark)     │
│ --secondary-foreground        │ #18181b                  │ #fafafa                  │
│ --muted                       │ #f4f4f5                  │ #27272a                  │
│ --muted-foreground            │ #71717a (Slate/Zinc)     │ #a1a1aa                  │
│ --accent                      │ #f4f4f5                  │ #27272a                  │
│ --accent-foreground           │ #18181b                  │ #fafafa                  │
│ --destructive                 │ #ef4444 (Crimson)        │ #7f1d1d                  │
│ --destructive-foreground      │ #ffffff                  │ #fef2f2                  │
│ --border                      │ #e4e4e7 (Zinc 200)       │ #27272a (Zinc 800)       │
│ --input                       │ #e4e4e7                  │ #27272a                  │
│ --ring                        │ #18181b                  │ #d4d4d8                  │
└───────────────────────────────┴──────────────────────────┴──────────────────────────┘
```

### 2.2 Security Severity Spectrum

| Severity Level           | Bright Theme Badge                                  | Dark Theme Badge                                        | Border & Glow               |
| :----------------------- | :-------------------------------------------------- | :------------------------------------------------------ | :-------------------------- |
| **Critical** ($\ge 9.0$) | `bg-red-50 text-red-700 border-red-200`             | `bg-red-950/40 text-red-400 border-red-800`             | Pulse glow on gate-blocking |
| **High** ($7.0 - 8.9$)   | `bg-orange-50 text-orange-700 border-orange-200`    | `bg-orange-950/40 text-orange-400 border-orange-800`    | Solid 1px containment       |
| **Medium** ($4.0 - 6.9$) | `bg-amber-50 text-amber-700 border-amber-200`       | `bg-amber-950/40 text-amber-400 border-amber-800`       | Subtle border               |
| **Low** ($0.1 - 3.9$)    | `bg-sky-50 text-sky-700 border-sky-200`             | `bg-sky-950/40 text-sky-400 border-sky-800`             | Informational border        |
| **Verified / Confirmed** | `bg-emerald-50 text-emerald-700 border-emerald-200` | `bg-emerald-950/40 text-emerald-400 border-emerald-800` | Checkmark indicator         |
| **System 1 Advisory**    | `bg-purple-50 text-purple-700 border-purple-200`    | `bg-purple-950/40 text-purple-400 border-purple-800`    | Violet spark indicator      |

---

## 3. Typography Scale & Density

- **UI Headings & Body**: `Inter`, `-apple-system`, `BlinkMacSystemFont`, `"Segoe UI"`, `sans-serif`.
- **Code & Security Identifiers**: `JetBrains Mono`, `ui-monospace`, `monospace`.

```css
/* Typography Scale */
--font-sans: "Inter", -apple-system, sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, monospace;

--text-xs: 0.75rem /* 12px / 16px */ --text-sm: 0.875rem /* 14px / 20px */ --text-base: 1rem
  /* 16px / 24px */ --text-lg: 1.125rem /* 18px / 28px */ --text-xl: 1.25rem /* 20px / 28px */
  --text-2xl: 1.5rem /* 24px / 32px */ --text-3xl: 1.875rem /* 30px / 36px */;
```

---

## 4. Modular Component Architecture (`components/ui/`)

All modular UI primitives reside in `src/components/ui/` with typed props:

### 4.1 Button (`<Button />`)

- **Variants**: `default` (Primary Dark in bright, White in dark), `secondary`, `destructive`, `outline`, `ghost`, `link`.
- **Sizes**: `sm` (h-8 px-3 text-xs), `default` (h-9 px-4 py-2 text-sm), `lg` (h-10 px-8), `icon` (h-9 w-9).

### 4.2 Card (`<Card />`)

- **Structure**: `<Card>` $\rightarrow$ `<CardHeader>` $\rightarrow$ `<CardTitle>` + `<CardDescription>` $\rightarrow$ `<CardContent>` $\rightarrow$ `<CardFooter>`.
- **Styling**: `rounded-lg border border-border bg-card text-card-foreground shadow-sm`.

### 4.3 Badge (`<Badge />`)

- **Variants**: `default`, `secondary`, `destructive`, `outline`.
- **Severity Variants**: `critical`, `high`, `medium`, `low`, `confirmed`, `needs_validation`, `advisory`.

### 4.4 Table (`<Table />`)

- **Structure**: `<Table>` $\rightarrow$ `<TableHeader>` / `<TableBody>` $\rightarrow$ `<TableRow>` $\rightarrow$ `<TableHead>` / `<TableCell>`.
- **Styling**: Dense tabular layout with `h-10 px-3 text-left align-middle border-b border-border`.

### 4.5 Tabs (`<Tabs />`)

- **Structure**: `<Tabs defaultValue="all">` $\rightarrow$ `<TabsList>` $\rightarrow$ `<TabsTrigger value="...">` $\rightarrow$ `<TabsContent value="...">`.
- **Styling**: Segmented pill container (`bg-muted p-1 rounded-lg`).

### 4.6 Input & Textarea (`<Input />`, `<Textarea />`)

- **Styling**: `rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring`.

### 4.7 Alert (`<Alert />`)

- **Variants**: `default` (info/neutral), `destructive` (crimson), `warning` (amber), `success` (emerald).

### 4.8 ThemeToggle (`<ThemeToggle />`)

- Accessible button switching between **Bright (☀️)** and **Dark (🌙)**, persisting preference in `localStorage`.

---

## 5. Usage Guidelines for Developers

```tsx
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "../components/ui";

export function SecurityMetricCard() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Open Findings</CardTitle>
          <Badge variant="critical">3 Critical</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">25</div>
        <p className="text-xs text-muted-foreground mt-1">+3 identified in latest CI run</p>
      </CardContent>
    </Card>
  );
}
```

---

## 6. Stitch Remote Design System & Living Styleguide

The design system is fully registered on Google Stitch Remote MCP server and paired with live generated screen artifacts.

- **Stitch Project ID**: `9700812912285765434` (`SecDevOps Audit Platform`)
- **Stitch Design System Asset**: `assets/14003065313697164838` ("shadcn/ui Zinc (Bright & Dark)")

### Synchronized Stitch Screens

| #   | Screen Name                                  | Stitch Screen ID                   | Description                                                                                      | Local HTML & PNG                                                                                                                                                                                                                                                                                                  |
| :-- | :------------------------------------------- | :--------------------------------- | :----------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Design System & Component Library**        | `5c2cdedd54ab403a9f2be437aa342cc3` | Living styleguide: Button matrix, badges, cards, data table, alerts, dialog, tokens & typography | [`design-system-components.html`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/design-system-components.html) / [`design-system-components.png`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/design-system-components.png) |
| 2   | **Org Overview (Bright Mode Default)**       | `ca6c3e21a8c14772b07031595de50d05` | Pure white `#FFFFFF` default org posture dashboard with shadcn/ui zinc layout                    | [`org-overview.html`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/org-overview.html) / [`org-overview.png`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/org-overview.png)                                                 |
| 3   | **Project View / Governance**                | `d0f86fa241c642c09e508cc59b9cc4a7` | Repository dashboard, release gate banner, coverage ledger & run history                         | [`project-view.html`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/project-view.html) / [`project-view.png`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/project-view.png)                                                 |
| 4   | **Finding Detail & Triage Console**          | `caf1a48823ed4d3cba1eba39a6650e45` | Deep-dive triage console, dual-track telemetry, justification modal                              | [`finding-detail.html`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/finding-detail.html) / [`finding-detail.png`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/finding-detail.png)                                         |
| 5   | **Run Diagnostics & Timeline**               | `9d0edf18e4824ddfac87601c9199caa0` | CI/CD run timeline, execution steps, gate evaluation & verification proofs                       | [`run-timeline.html`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/run-timeline.html) / [`run-timeline.png`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/run-timeline.png)                                                 |
| 6   | **Security Review Queue**                    | `337433812d244d64a0e6a4ee22efb9d7` | Unverified leads (`needs_validation`) workspace, blocker-based Kanban board                      | [`review-queue.html`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/review-queue.html) / [`review-queue.png`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/review-queue.png)                                                 |
| 7   | **Policy & Security Exceptions**             | `93e3251d3ff24ef0a357922cdf764cbf` | Policy-as-Code rules, enforcement mode switcher, exceptions ledger                               | [`policy-exceptions.html`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/policy-exceptions.html) / [`policy-exceptions.png`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/policy-exceptions.png)                             |
| 8   | **Release Readiness & Gatekeeper**           | `056bfac9227d4cd08ef47b7ed8a44f1f` | Deterministic release gatekeeper (`evaluateGate()`), blocker drill-down panel                    | [`release-readiness.html`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/release-readiness.html) / [`release-readiness.png`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/release-readiness.png)                             |
| 9   | **Compliance & Audit Export**                | `8d73c34ec6a348e78bff3b75e758bbc1` | Client-ready PDF/Markdown/CSV export generator, live document preview                            | [`compliance-export.html`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/compliance-export.html) / [`compliance-export.png`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/compliance-export.png)                             |
| 10  | **Modal: Quick-Scan Command Palette** (`⌘K`) | `3604e59e08554715b71fdf7c45bccff7` | Floating scan intensity selector (Light/Standard/Deep), token credit meter                       | [`command-palette-modal.html`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/command-palette-modal.html) / [`command-palette-modal.png`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/command-palette-modal.png)             |
| 11  | **Modal: Sandbox Exploit Proof Terminal**    | `bfc24ce86ab94b5a9a461b58ca193702` | Embedded terminal showing simulated exploit proof, extracted credentials                         | [`exploit-terminal-modal.html`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/exploit-terminal-modal.html) / [`exploit-terminal-modal.png`](file:///Users/adwkhaqim/orca/projects/secdevops-audit-platform/apps/web/stitch-redesign/exploit-terminal-modal.png)         |
