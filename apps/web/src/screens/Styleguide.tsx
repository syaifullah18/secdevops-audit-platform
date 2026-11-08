import {
  SeverityBadge,
  VerdictBadge,
  StatusBadge,
  AdvisoryBadge,
  DraftBadge,
} from "../components/Badges.js";
import { Icon } from "../components/Icon.js";
import {
  Meter,
  PageHeader,
  Panel,
  Pill,
  Stat,
  btn,
  tableCls,
  type Tone,
} from "../components/stitch.js";

const TONES: Tone[] = ["critical", "high", "medium", "low", "verified", "advisory", "neutral"];
const SWATCHES = [
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
  "surface-container-high",
  "surface-container-highest",
  "on-surface",
  "on-surface-variant",
  "outline-variant",
];

/** Living styleguide: every sample is the real component, so it cannot drift from the screens. */
export function StyleguideScreen() {
  return (
    <div className="flex flex-col gap-6" data-testid="styleguide-screen">
      <PageHeader
        title="Design System"
        subtitle="shadcn/ui Zinc palette with Inter, JetBrains Mono and Material Symbols, all self-hosted."
      />

      <Panel
        title="Severity and verdict spectrum"
        subtitle="Only confirmed findings can fail a gate"
      >
        <div className="flex flex-wrap gap-2">
          {(["critical", "high", "medium", "low", "informational"] as const).map((s) => (
            <SeverityBadge key={s} severity={s} />
          ))}
          <VerdictBadge verdict="confirmed" />
          <VerdictBadge verdict="needs_validation" />
          <VerdictBadge verdict="rejected" />
          <StatusBadge status="in_progress" />
          <AdvisoryBadge />
          <DraftBadge />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {TONES.map((t) => (
            <Pill key={t} tone={t}>
              {t}
            </Pill>
          ))}
        </div>
      </Panel>

      <Panel
        title="Colour tokens"
        subtitle="Dark mode re-points the same names, so no per-element overrides"
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {SWATCHES.map((n) => (
            <div key={n} className="flex items-center gap-2.5">
              <span
                className="h-8 w-8 rounded-md border border-outline-variant"
                style={{ background: `var(--color-${n})` }}
              />
              <code className="text-[11px] font-mono">{n}</code>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Typography">
        <div className="flex flex-col gap-2">
          <p className="text-xl font-bold font-headline">Inter headline, tight tracking</p>
          <p className="text-sm">Inter body copy for descriptions and form labels.</p>
          <p className="text-xs font-mono">
            JetBrains Mono: 9f2c1e7a · services/ledger/webhooks.ts:42
          </p>
        </div>
      </Panel>

      <Panel title="Buttons and controls">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={btn.primary}>
            <Icon name="play_arrow" className="text-[16px]" />
            Primary
          </button>
          <button type="button" className={btn.secondary}>
            Secondary
          </button>
          <button type="button" className={btn.danger}>
            Danger
          </button>
          <button type="button" className={btn.primary} disabled>
            Disabled
          </button>
        </div>
      </Panel>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat label="Open Findings" value={12} sub="Stat card" />
        <Stat
          label="SLA Breaches"
          value={2}
          valueClassName="!text-sev-critical-ink"
          sub="Emphasised value"
        />
        <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-lg p-5 flex flex-col gap-3">
          <span className="text-xs font-medium text-on-surface-variant">Meters</span>
          <Meter pct={72} label="Sample 72%" />
          <Meter pct={35} barClassName="bg-sev-medium-ink" label="Sample 35%" />
        </div>
      </div>

      <Panel title="Table">
        <div className={tableCls.wrap}>
          <table className={tableCls.table}>
            <thead>
              <tr className={tableCls.headRow}>
                <th className={tableCls.th}>Repository</th>
                <th className={tableCls.th}>Severity</th>
                <th className={tableCls.th}>Verdict</th>
              </tr>
            </thead>
            <tbody>
              <tr className={tableCls.row}>
                <td className={`${tableCls.td} font-mono`}>payments-api</td>
                <td className={tableCls.td}>
                  <SeverityBadge severity="high" />
                </td>
                <td className={tableCls.td}>
                  <VerdictBadge verdict="confirmed" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
