import type { ModelAttribution, PhaseName } from "@sdap/core";
import { Icon } from "./Icon.js";

/** Every piece of AI output is labelled with the model and phase that produced it. */
export function AttributionLabel({
  model,
  phase,
}: {
  model?: ModelAttribution | null;
  phase?: PhaseName | null;
}) {
  if (!model && !phase) return null;
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/60 bg-surface-container-low px-2.5 py-0.5 text-[11px] text-on-surface-variant"
      title="Source AI attribution"
      data-testid="attribution-label"
    >
      <Icon name="smart_toy" className="text-[13px]" />
      <span>AI Output:</span>
      {model && (
        <strong className="font-mono text-on-surface">
          {model.adapter}/{model.model}
          {model.version ? ` (${model.version})` : ""}
        </strong>
      )}
      {phase && <span>· Phase: {phase}</span>}
    </div>
  );
}
