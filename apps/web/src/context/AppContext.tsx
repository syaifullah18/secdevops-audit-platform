import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

interface AppContextValue {
  theme: "light" | "dark";
  toggleTheme: () => void;
  showRejected: boolean;
  setShowRejected: (show: boolean) => void;
  toggleShowRejected: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("sdap_theme");
      if (saved === "light" || saved === "dark") return saved;
      if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
        return "dark";
      }
    }
    return "light";
  });

  const [showRejected, setShowRejected] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("sdap_show_rejected");
      return saved === "true";
    }
    return false;
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("sdap_theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("sdap_show_rejected", String(showRejected));
  }, [showRejected]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  const toggleShowRejected = () => {
    setShowRejected((prev) => !prev);
  };

  return (
    <AppContext.Provider
      value={{
        theme,
        toggleTheme,
        showRejected,
        setShowRejected,
        toggleShowRejected,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return ctx;
}
