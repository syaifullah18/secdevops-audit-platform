import { useApp } from "../../context/AppContext.js";
import { Icon } from "../Icon.js";

/** Bright / Dark switch: a labelled `role="switch"` with a sliding thumb. */
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
    <div className={`flex items-center justify-between gap-3 ${className}`.trim()}>
      <span
        id={`${testId}-label`}
        className="flex items-center gap-2 text-xs font-medium text-on-surface-variant select-none"
      >
        <Icon name={isDark ? "dark_mode" : "light_mode"} className="text-[16px]" />
        {isDark ? "Dark mode" : "Bright mode"}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={isDark}
        aria-labelledby={`${testId}-label`}
        onClick={toggleTheme}
        title={isDark ? "Switch to Bright Mode (Default White)" : "Switch to Dark Mode"}
        data-testid={testId}
        className={`relative h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-on-surface ${
          isDark ? "bg-on-surface" : "bg-surface-container-highest"
        }`}
      >
        <span
          className={`block h-4 w-4 rounded-full bg-surface-container-lowest shadow-sm transition-transform ${
            isDark ? "translate-x-4" : ""
          }`}
        />
      </button>
    </div>
  );
}
