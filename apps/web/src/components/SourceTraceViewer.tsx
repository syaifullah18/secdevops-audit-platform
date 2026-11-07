import type { TraceStep } from "@sdap/core";

export function SourceTraceViewer({ trace }: { trace: TraceStep[] }) {
  if (!trace || trace.length === 0) {
    return <div style={{ color: "var(--text-muted)" }}>No trace steps recorded.</div>;
  }

  return (
    <div className="trace-timeline" data-testid="source-trace-viewer">
      {trace.map((step, index) => {
        let labelColor = "var(--primary)";
        if (step.kind === "sink") labelColor = "var(--critical)";
        if (step.kind === "entrypoint") labelColor = "var(--low)";

        return (
          <div key={index} className={`trace-step ${step.kind}`}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <span
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  color: labelColor,
                }}
              >
                Step {index + 1}: {step.kind}
              </span>
              <code
                style={{
                  fontSize: "0.8rem",
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {step.file}:{step.line}
              </code>
              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>({step.scope})</span>
            </div>
            <p style={{ fontSize: "0.9rem", color: "var(--text)" }}>{step.description}</p>
          </div>
        );
      })}
    </div>
  );
}
