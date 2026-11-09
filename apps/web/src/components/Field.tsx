import type { InputHTMLAttributes, ReactNode } from "react";
import { Icon } from "./Icon.js";

export const inputCls =
  "w-full rounded-md border border-outline-variant/60 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface placeholder:text-outline focus:outline-none focus-visible:ring-2 focus-visible:ring-on-surface disabled:opacity-60";

export function Field({
  id,
  label,
  hint,
  ...input
}: { id: string; label: string; hint?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-on-surface-variant">
        {label}
      </label>
      <input id={id} className={inputCls} {...input} />
      {hint && <p className="text-[11px] text-on-surface-variant">{hint}</p>}
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-sev-critical-border bg-sev-critical-bg text-sev-critical-ink px-3.5 py-2.5 text-xs"
    >
      <Icon name="error" className="text-[16px]" />
      {message}
    </div>
  );
}

export function Notice({ children, tone = "ok" }: { children: ReactNode; tone?: "ok" | "info" }) {
  return (
    <div
      role="status"
      className={`flex items-start gap-2 rounded-md border px-3.5 py-2.5 text-xs ${
        tone === "ok"
          ? "border-verified-border bg-verified-bg text-verified-ink"
          : "border-advisory-border bg-advisory-bg text-advisory-ink"
      }`}
    >
      <Icon name={tone === "ok" ? "check_circle" : "info"} className="text-[16px]" />
      <div>{children}</div>
    </div>
  );
}

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
