import type { ReactNode } from "react";
import { Icon } from "./Icon.js";
import { ThemeToggle } from "./ui/ThemeToggle.js";

/** Centered card used by every signed-out screen (login, sign-up, reset...). */
export function AuthShell({
  title,
  subtitle,
  children,
  testId,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  testId?: string;
  footer?: ReactNode;
}) {
  return (
    <div
      className="sdap-shell min-h-screen flex items-center justify-center p-4"
      data-testid={testId}
    >
      <div className="w-full max-w-md flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-zinc-900 text-white flex items-center justify-center shadow-sm">
            <Icon name="security" filled className="text-xl" />
          </div>
          <div>
            <div className="text-xs font-semibold text-on-surface-variant">SecDevOps Audit</div>
            <h1 className="text-lg font-bold font-headline tracking-tight leading-tight">
              {title}
            </h1>
            {subtitle && <p className="text-xs text-on-surface-variant">{subtitle}</p>}
          </div>
        </div>
        <div className="rounded-lg border border-outline-variant/60 bg-surface-container-lowest shadow-sm p-5 flex flex-col gap-4">
          {children}
        </div>
        {footer && <div className="text-xs text-on-surface-variant text-center">{footer}</div>}
        <div className="rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-4 py-3">
          <ThemeToggle testId="auth-theme-toggle" />
        </div>
      </div>
    </div>
  );
}
