import type { TriageSuggestion } from "@sdap/core";
import { AdvisoryBadge } from "./Badges.js";
import { Meter } from "./stitch.js";

/** System 1 (Jev) output. Advisory only: it never blocks a merge or closes a finding. */
export function System1AdvisoryView({ suggestion }: { suggestion: TriageSuggestion | null }) {
  if (!suggestion) return null;
  return (
    <section
      data-testid="system1-advisory"
      className="rounded-lg border border-advisory-border bg-advisory-bg/40 shadow-sm"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <div className="flex items-center gap-3 flex-wrap">
          <AdvisoryBadge />
          <h3 className="text-base font-semibold font-headline">
            System 1 (Jev) Triage Recommendation
          </h3>
        </div>
        <span className="text-[11px] font-mono text-on-surface-variant">
          {suggestion.model.adapter}/{suggestion.model.model}
        </span>
      </header>
      <p className="px-5 pt-1 text-xs text-on-surface-variant">
        Advisory guidance generated via fast probabilistic classifier. Does not block merges or
        close findings.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 p-5">
        {suggestion.severityBand && (
          <div className="flex flex-col gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
              Predicted severity
            </div>
            {Object.entries(suggestion.severityBand).map(([sev, prob]) => (
              <div key={sev} className="flex flex-col gap-1">
                <div className="flex justify-between text-xs">
                  <span className="capitalize">{sev}</span>
                  <span className="font-mono font-semibold">{(prob * 100).toFixed(0)}%</span>
                </div>
                <Meter
                  pct={prob * 100}
                  barClassName="bg-advisory-ink"
                  label={`${sev} probability`}
                />
              </div>
            ))}
          </div>
        )}
        {suggestion.ownerCandidates && suggestion.ownerCandidates.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
              Recommended owners
            </div>
            {suggestion.ownerCandidates.map((cand) => (
              <div key={cand.owner} className="flex justify-between text-xs">
                <span className="font-mono">{cand.owner}</span>
                <span className="font-mono font-semibold">
                  {(cand.probability * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        )}
        {suggestion.falsePositiveProbability !== undefined && (
          <div className="flex flex-col gap-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
              False positive risk
            </div>
            <div className="text-3xl font-bold font-headline text-advisory-ink">
              {(suggestion.falsePositiveProbability * 100).toFixed(1)}%
            </div>
            <div className="text-[11px] text-on-surface-variant">Calibrated confidence</div>
          </div>
        )}
      </div>
    </section>
  );
}
