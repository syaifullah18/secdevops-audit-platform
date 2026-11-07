import type { ModelAttribution, PhaseName } from "@sdap/core";

export function AttributionLabel({
  model,
  phase,
}: {
  model?: ModelAttribution | null;
  phase?: PhaseName | null;
}) {
  if (!model && !phase) return null;
  return (
    <div className="attribution-tag" title="Source AI attribution" data-testid="attribution-label">
      <span>AI Output:</span>
      {model && (
        <strong>
          {model.adapter}/{model.model}
          {model.version ? ` (${model.version})` : ""}
        </strong>
      )}
      {phase && <span>· Phase: {phase}</span>}
    </div>
  );
}
