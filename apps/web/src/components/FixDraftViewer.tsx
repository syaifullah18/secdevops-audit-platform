import { DraftBadge } from "./Badges.js";

interface Remediation {
  strategy: string;
  codeChanges: Array<{ file: string; fixedCode: string }>;
}

/** Generated remediation, always labelled as a draft that needs human review. */
export function FixDraftViewer({ remediation }: { remediation: Remediation | null }) {
  if (!remediation) {
    return (
      <div className="text-sm text-on-surface-variant" data-testid="fix-draft-empty">
        No automated fix draft available for this finding.
      </div>
    );
  }
  return (
    <section
      data-testid="fix-draft-viewer"
      className="rounded-lg border border-dashed border-sev-high-border bg-surface-container-lowest p-5 flex flex-col gap-3"
    >
      <div className="flex items-center gap-2.5 flex-wrap">
        <DraftBadge />
        <h3 className="text-base font-semibold font-headline">Proposed Remediation Strategy</h3>
      </div>
      <p className="text-sm leading-relaxed">{remediation.strategy}</p>
      {remediation.codeChanges.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
            Draft Code Changes (Human Verification Required)
          </span>
          {remediation.codeChanges.map((change, idx) => (
            <div key={idx} className="rounded-md overflow-hidden border border-outline-variant/60">
              <div className="px-3 py-1.5 text-[11px] font-mono bg-surface-container-high text-on-surface-variant">
                File: {change.file}
              </div>
              <pre className="m-0 p-3 text-xs font-mono overflow-x-auto bg-[#0B0F19] text-zinc-200">
                <code>{change.fixedCode}</code>
              </pre>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
