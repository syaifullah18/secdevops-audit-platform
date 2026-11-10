import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AppProvider } from "../src/context/AppContext.js";
import { installFetchShim, mockStore } from "../src/api/mock.js";
import { Layout } from "../src/components/Layout.js";
import { ThemeToggle } from "../src/components/ui/ThemeToggle.js";
import { RequireSession } from "../src/auth/RequireSession.js";
import { LoginScreen } from "../src/screens/Login.js";
import { ProfileScreen } from "../src/screens/Profile.js";
import {
  UNAUTHORIZED_EVENT,
  decodeToken,
  initialsOf,
  isExpired,
  setToken,
  topRole,
} from "../src/auth/session.js";
import { api } from "../src/api/client.js";

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "");
const jwt = (claims: object) => `${b64({ alg: "none" })}.${b64(claims)}.sig`;

const Where = () => <div data-testid="where">{useLocation().pathname}</div>;

const app = (path: string) =>
  render(
    <AppProvider>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/login" element={<LoginScreen />} />
          <Route
            path="/"
            element={
              <RequireSession>
                <Layout />
              </RequireSession>
            }
          >
            <Route index element={<div>home</div>} />
            <Route path="profile" element={<ProfileScreen />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AppProvider>,
  );

describe("session helpers", () => {
  it("decodes claims and rejects malformed tokens", () => {
    expect(decodeToken("nope")).toBeNull();
    expect(decodeToken(jwt({ name: "x" }))).toBeNull();
    expect(decodeToken(jwt({ sub: "u1" }))?.subject).toBe("u1");
  });
  it("derives initials, expiry and top role", () => {
    expect(initialsOf("Alex Vance")).toBe("AV");
    const u = decodeToken(jwt({ sub: "u", exp: 1 }))!;
    expect(isExpired(u)).toBe(true);
    expect(isExpired({ ...u, expiresAt: null })).toBe(false);
    expect(topRole(["viewer", "admin"])).toBe("admin");
  });
});

describe("auth flow (mock API)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStore.reset();
    return installFetchShim(mockStore);
  });
  afterEach(cleanup);

  it("auto-signs in the demo user and shows the profile", async () => {
    app("/profile");
    await waitFor(() => expect(screen.getByTestId("profile-screen")).toBeTruthy());
    expect(screen.getByText(/Demo mode/)).toBeTruthy();
  });

  it("signing out lands on /login and the guard blocks the app", async () => {
    app("/");
    fireEvent.click(await screen.findByTestId("user-menu-button"));
    fireEvent.click(screen.getByTestId("sign-out-button"));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/login"));
    expect(screen.getByTestId("login-screen")).toBeTruthy();
  });

  it("a 401 event signs the user out", async () => {
    app("/");
    await screen.findByTestId("user-menu-button");
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/login"));
  });

  it("notifications bell opens a panel with review items and can mark them read", async () => {
    app("/");
    const bell = await screen.findByTestId("notifications-button");
    await waitFor(() => expect(screen.getByTestId("notifications-badge")).toBeTruthy());
    fireEvent.click(bell);
    const panel = await screen.findByTestId("notifications-panel");
    await waitFor(() => expect(panel.querySelectorAll("a").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId("notifications-mark-read"));
    await waitFor(() => expect(screen.queryByTestId("notifications-badge")).toBeNull());
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("notifications-panel")).toBeNull());
  });

  it("user menu closes on Escape", async () => {
    app("/");
    fireEvent.click(await screen.findByTestId("user-menu-button"));
    expect(screen.getByTestId("user-menu")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("user-menu")).toBeNull());
  });
});

describe("theme switch and API auth header", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("is a switch whose aria-checked follows the theme", () => {
    render(
      <AppProvider>
        <ThemeToggle testId="t" />
      </AppProvider>,
    );
    const sw = screen.getByRole("switch");
    const before = sw.getAttribute("aria-checked");
    fireEvent.click(sw);
    expect(sw.getAttribute("aria-checked")).not.toBe(before);
  });

  it("sends the stored token as a bearer header", async () => {
    setToken("abc.def.ghi");
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      );
    await api.getProjects().catch(() => undefined);
    const init = spy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer abc.def.ghi");
  });
});
