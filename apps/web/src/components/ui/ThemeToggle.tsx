import { useApp } from "../../context/AppContext.js";
import { Icon } from "../Icon.js";

/** Bright / Dark switch. Icon-only so it fits the sidebar footer; the label is for assistive tech. */
export function ThemeToggle({
  className = "",
  testId = "theme-toggle-button",
}: {
  className?: string;
  testId?: string;
}) {
  const { theme, toggleTheme } = useApp();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      className={`h-8 w-8 shrink-0 rounded-lg border border-outline-variant/60 flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors ${className}`.trim()}
      onClick={toggleTheme}
      title={isDark ? "Switch to Bright Mode (Default White)" : "Switch to Dark Mode"}
      aria-label="Toggle theme"
      aria-pressed={isDark}
      data-testid={testId}
    >
      <Icon name={isDark ? "dark_mode" : "light_mode"} className="text-[18px]" />
      <span className="sr-only">{isDark ? "Dark" : "Bright"}</span>
    </button>
  );
}
