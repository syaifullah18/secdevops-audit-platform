import type { Severity } from "@sdap/core";
import { SeverityBadge } from "./Badges.js";
import { Icon } from "./Icon.js";

/** Dual-track severity: the hunter's pre-verification guess next to the gate-authoritative one. */
export function SideBySideSeverity({
  originalSeverity,
  verifiedSeverity,
}: {
  originalSeverity: Severity | null;
  verifiedSeverity: Severity | null;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="side-by-side-severity">
      <div className="rounded-lg border border-advisory-border bg-advisory-bg/40 p-4 flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-advisory-ink">
          Hunter Severity (Pre-Verification)
        </span>
        <div className="flex items-center gap-3">
          <SeverityBadge severity={originalSeverity} />
          <span className="text-xs text-on-surface-variant">Initial candidate assessment</span>
        </div>
      </div>
      <div className="rounded-lg border border-verified-border bg-verified-bg/40 p-4 flex flex-col gap-2">
        <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-verified-ink">
          <Icon name="verified" filled className="text-[14px]" />
          Verified Severity (Gate Authoritative)
        </span>
        <div className="flex items-center gap-3">
          <SeverityBadge severity={verifiedSeverity} />
          <span className="text-xs text-on-surface-variant">Authoritative verified ranking</span>
        </div>
      </div>
    </div>
  );
}
