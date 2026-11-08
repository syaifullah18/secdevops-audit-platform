import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { IS_MOCK } from "../api/mode.js";
import {
  DEMO_USER,
  UNAUTHORIZED_EVENT,
  clearSession,
  clearSignedOutFlag,
  decodeToken,
  getToken,
  isExpired,
  setToken,
  wasSignedOut,
  type SessionUser,
} from "../auth/session.js";

interface AppContextValue {
  theme: "light" | "dark";
  toggleTheme: () => void;
  showRejected: boolean;
  setShowRejected: (show: boolean) => void;
  toggleShowRejected: () => void;
  /** Signed-in user, or null when signed out. */
  user: SessionUser | null;
  /** Returns an error message, or null on success. */
  signIn: (token: string) => string | null;
  /** Mock API only; returns false against a real backend. */
  signInDemo: () => boolean;
  signOut: () => void;
}

const initialUser = (): SessionUser | null => {
  const token = getToken();
  if (token) {
    const u = decodeToken(token);
    if (u && !isExpired(u)) return u;
    clearSession();
    return null;
  }
  return IS_MOCK && !wasSignedOut() ? DEMO_USER : null;
};

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

  const [user, setUser] = useState<SessionUser | null>(initialUser);

  const signOut = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  const signIn = useCallback((raw: string): string | null => {
    const token = raw.trim().replace(/^Bearer\s+/i, "");
    const u = decodeToken(token);
    if (!u) return "That is not a valid access token (expected a JWT with a subject claim).";
    if (isExpired(u)) return "That token has already expired.";
    setToken(token);
    setUser(u);
    return null;
  }, []);

  const signInDemo = useCallback((): boolean => {
    if (!IS_MOCK) return false;
    clearSignedOutFlag();
    setUser(DEMO_USER);
    return true;
  }, []);

  // A 401 from the API ends the session; an expiring token ends it on time.
  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, signOut);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, signOut);
  }, [signOut]);
  useEffect(() => {
    if (!user || user.expiresAt === null) return;
    const ms = Math.min(user.expiresAt - Date.now(), 2_147_000_000);
    const t = setTimeout(signOut, Math.max(ms, 0));
    return () => clearTimeout(t);
  }, [user, signOut]);

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
        user,
        signIn,
        signInDemo,
        signOut,
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
