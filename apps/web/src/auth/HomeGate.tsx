import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { LandingScreen } from "../screens/Landing.js";
import { useApp } from "../context/AppContext.js";

/**
 * The app shell for signed-in users. A visitor without a session sees the public landing page at
 * `/`, and is sent to sign-in from any other address. The API enforces access on every request.
 */
export function HomeGate({ children }: { children: ReactNode }) {
  const { user } = useApp();
  const location = useLocation();
  if (user) return <>{children}</>;
  if (location.pathname === "/") return <LandingScreen />;
  return <Navigate to="/login" replace state={{ from: location.pathname }} />;
}
