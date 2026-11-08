import type { TraceStep } from "@sdap/core";
import { Icon } from "./Icon.js";
import { cx } from "./stitch.js";

const KIND: Record<TraceStep["kind"], { icon: string; dot: string; label: string }> = {
  entrypoint: { icon: "login", dot: "bg-sev-low-ink", label: "text-sev-low-ink" },
  propagation: { icon: "arrow_downward", dot: "bg-outline", label: "text-on-surface-variant" },
  sink: { icon: "flag", dot: "bg-sev-critical-ink", label: "text-sev-critical-ink" },
};

/** Source-to-sink data-flow, one numbered step per trace entry. */
export function SourceTraceViewer({ trace }: { trace: TraceStep[] }) {
  if (!trace || trace.length === 0) {
    return <div className="text-sm text-on-surface-variant">No trace steps recorded.</div>;
  }
  return (
    <ol className="relative flex flex-col gap-4" data-testid="source-trace-viewer">
      {trace.map((step, index) => {
        const k = KIND[step.kind];
        return (
          <li key={index} className="relative flex gap-3">
            {index < trace.length - 1 && (
              <span
                className="absolute left-[11px] top-6 bottom-[-16px] w-px bg-outline-variant"
                aria-hidden="true"
              />
            )}
            <span
              className={cx(
                "mt-0.5 h-6 w-6 shrink-0 rounded-full flex items-center justify-center text-white",
                k.dot,
              )}
              aria-hidden="true"
            >
              <Icon name={k.icon} className="text-[14px]" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cx("text-[11px] font-bold uppercase tracking-wide", k.label)}>
                  Step {index + 1}: {step.kind}
                </span>
                <code className="text-[11px] font-mono text-on-surface">
                  {step.file}:{step.line}
                </code>
              </div>
              <p className="mt-0.5 text-xs text-on-surface-variant">{step.description}</p>
              <span className="text-[10px] font-mono text-outline">{step.scope}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
