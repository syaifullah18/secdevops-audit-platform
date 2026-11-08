import type { ReactNode } from "react";
import { Icon } from "./Icon.js";

/** Shared Stitch primitives so every screen shares one look. Tokens live in tailwind.css. */

export const cx = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(" ");

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-xl font-bold font-headline text-on-surface tracking-tight">{title}</h2>
        {subtitle && <p className="text-xs text-on-surface-variant mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = "",
  bodyClassName = "",
  testId,
  tone = "default",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  testId?: string;
  tone?: "default" | "danger";
}) {
  return (
    <section
      data-testid={testId}
      className={cx(
        "bg-surface-container-lowest border rounded-lg shadow-sm",
        tone === "danger" ? "border-sev-critical-border" : "border-outline-variant/60",
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-outline-variant/40">
          <div className="min-w-0">
            {title && (
              <h3 className="text-base font-semibold font-headline text-on-surface">{title}</h3>
            )}
            {subtitle && <p className="text-xs text-on-surface-variant mt-0.5">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={cx("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

const PILL =
  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold";

export type Tone = "critical" | "high" | "medium" | "low" | "verified" | "advisory" | "neutral";

const TONE: Record<Tone, string> = {
  critical: "bg-sev-critical-bg border-sev-critical-border text-sev-critical-ink",
  high: "bg-sev-high-bg border-sev-high-border text-sev-high-ink",
  medium: "bg-sev-medium-bg border-sev-medium-border text-sev-medium-ink",
  low: "bg-sev-low-bg border-sev-low-border text-sev-low-ink",
  verified: "bg-verified-bg border-verified-border text-verified-ink",
  advisory: "bg-advisory-bg border-advisory-border text-advisory-ink",
  neutral: "bg-surface-container-low border-outline-variant/60 text-on-surface-variant",
};

export function Pill({
  tone = "neutral",
  icon,
  children,
  className = "",
  testId,
  title,
}: {
  tone?: Tone;
  icon?: string;
  children: ReactNode;
  className?: string;
  testId?: string;
  title?: string;
}) {
  return (
    <span data-testid={testId} title={title} className={cx(PILL, TONE[tone], className)}>
      {icon && <Icon name={icon} className="text-[13px]" />}
      {children}
    </span>
  );
}

/** Severity -> tone. Informational folds into the sky "low" tone per the design system. */
export const severityTone = (s: string | null | undefined): Tone => {
  switch (s) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "low":
    case "informational":
      return "low";
    default:
      return "neutral";
  }
};

export function Stat({
  label,
  value,
  sub,
  testId,
  valueClassName = "",
  right,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  testId?: string;
  valueClassName?: string;
  right?: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className="bg-surface-container-lowest border border-outline-variant/60 rounded-lg p-5 shadow-sm flex flex-col gap-1 hover:border-outline transition-colors"
    >
      <div className="flex items-center justify-between text-xs font-medium text-on-surface-variant">
        <span>{label}</span>
        {right}
      </div>
      <span className={cx("text-3xl font-bold font-headline text-on-surface", valueClassName)}>
        {value}
      </span>
      {sub && <span className="text-xs text-on-surface-variant">{sub}</span>}
    </div>
  );
}

export function Meter({
  pct,
  barClassName = "bg-on-surface",
  label,
}: {
  pct: number;
  barClassName?: string;
  label?: string;
}) {
  const v = Math.max(0, Math.min(100, pct));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="h-1.5 w-full rounded-full bg-surface-container-high overflow-hidden"
    >
      <div className={cx("h-full rounded-full", barClassName)} style={{ width: `${v}%` }} />
    </div>
  );
}

export const tableCls = {
  wrap: "overflow-x-auto",
  table: "w-full text-left text-xs",
  headRow: "border-b border-outline-variant/40 text-on-surface-variant",
  th: "py-2.5 px-3 font-medium whitespace-nowrap",
  row: "border-b border-outline-variant/30 last:border-0 hover:bg-surface-container-low transition-colors",
  td: "py-2.5 px-3 align-middle",
};

export const btn = {
  primary:
    "inline-flex items-center justify-center gap-1.5 bg-on-surface text-surface-container-lowest hover:opacity-90 font-medium text-xs px-3.5 py-1.5 rounded-md shadow-sm transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed",
  secondary:
    "inline-flex items-center justify-center gap-1.5 bg-surface-container-lowest border border-outline-variant/60 text-on-surface hover:bg-surface-container-low font-medium text-xs px-3 py-1.5 rounded-md shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
  danger:
    "inline-flex items-center justify-center gap-1.5 bg-sev-critical-bg border border-sev-critical-border text-sev-critical-ink hover:opacity-90 font-medium text-xs px-3 py-1.5 rounded-md transition-all",
};

export function Loading({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="loading-indicator"
      className="flex items-center gap-2 text-sm text-on-surface-variant py-10 justify-center"
    >
      <Icon name="progress_activity" className="animate-spin text-lg" />
      {children}
    </div>
  );
}

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-sev-critical-border bg-sev-critical-bg text-sev-critical-ink px-4 py-3 text-sm"
    >
      <Icon name="error" className="text-lg" />
      <div>{children}</div>
    </div>
  );
}
