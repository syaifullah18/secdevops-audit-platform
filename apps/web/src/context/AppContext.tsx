import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { accountApi, authApi, type SessionIssue } from "../api/auth.js";
import { IS_MOCK } from "../api/mode.js";
import {
  DEMO_USER,
  UNAUTHORIZED_EVENT,
  clearSession,
  clearSignedOutFlag,
  getStoredUser,
  isExpired,
  setStoredUser,
  userFromAccount,
  wasSignedOut,
  type AccountView,
  type SessionUser,
} from "../auth/session.js";

interface AppContextValue {
  theme: "light" | "dark";
  toggleTheme: () => void;
  /** Signed-in user, or null when signed out. */
  user: SessionUser | null;
  /** Starts a session issued by this instance (password, provider or sign-up). */
  startSession: (s: SessionIssue) => void;
  /** Applies a fresh profile (after a rename, or when roles changed server-side). */
  updateUser: (a: AccountView) => void;
  /** Mock API only; returns false against a real backend. */
  signInDemo: () => boolean;
  signOut: () => void;
}

const initialUser = (): SessionUser | null => {
  // The cookie cannot be inspected from here, so the stored profile stands in until /account
  // answers; a 401 then ends the session.
  const u = getStoredUser();
  if (u) {
    if (!isExpired(u)) return u;
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

  const [user, setUser] = useState<SessionUser | null>(initialUser);

  /** Local only: used when the server already ended the session (401) or the token expired. */
  const endLocal = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  const signOut = useCallback(() => {
    // Ask the server to revoke the session and clear the cookie; the screen does not wait for it.
    if (user?.native) void authApi.logout().catch(() => undefined);
    endLocal();
  }, [endLocal, user]);

  const startSession = useCallback((s: SessionIssue) => {
    const u = userFromAccount(s.user, Date.parse(s.expiresAt));
    setStoredUser(u);
    setUser(u);
  }, []);

  const updateUser = useCallback((a: AccountView) => {
    setUser((cur) => {
      if (!cur) return cur;
      const next = { ...userFromAccount(a, cur.expiresAt), demo: cur.demo };
      if (cur.native) setStoredUser(next);
      return next;
    });
  }, []);

  const signInDemo = useCallback((): boolean => {
    if (!IS_MOCK) return false;
    clearSignedOutFlag();
    setUser(DEMO_USER);
    return true;
  }, []);

  // A 401 from the API ends the session; an expiring token ends it on time.
  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, endLocal);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, endLocal);
  }, [endLocal]);

  // Roles can change on the server (an admin edits them); pick that up when the app opens.
  const nativeId = user?.native ? user.subject : null;
  useEffect(() => {
    if (!nativeId) return;
    accountApi
      .me()
      .then((a) => updateUser(a))
      .catch(() => undefined);
  }, [nativeId, updateUser]);
  useEffect(() => {
    if (!user || user.expiresAt === null) return;
    const ms = Math.min(user.expiresAt - Date.now(), 2_147_000_000);
    const t = setTimeout(endLocal, Math.max(ms, 0));
    return () => clearTimeout(t);
  }, [user, endLocal]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("sdap_theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  return (
    <AppContext.Provider
      value={{
        theme,
        toggleTheme,
        user,
        startSession,
        updateUser,
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
