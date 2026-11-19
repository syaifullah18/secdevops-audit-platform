import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { installFetchShim, mockStore } from "../src/api/mock.js";
import { AppProvider } from "../src/context/AppContext.js";
import { HomeGate } from "../src/auth/HomeGate.js";

const at = (path: string) =>
  render(
    <AppProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<div data-testid="login-page" />} />
          <Route path="/" element={<HomeGate>{<div data-testid="dash" />}</HomeGate>}>
            <Route path="projects" element={<div />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AppProvider>,
  );

describe("landing page", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("sdap_signed_out", "1");
    return installFetchShim(mockStore);
  });
  afterEach(cleanup);

  it("shows to a signed-out visitor at / with sign-up (when open) and log in", async () => {
    at("/");
    expect(screen.getByTestId("landing-screen")).toBeTruthy();
    // Sign-up appears once the instance says it is open; example data is never shown.
    await waitFor(() =>
      expect(screen.getByTestId("landing-signup").getAttribute("href")).toBe("/signup"),
    );
    expect(screen.queryByText(/example data/i)).toBeNull();
    expect(screen.getByTestId("landing-login").getAttribute("href")).toBe("/login");
    expect(screen.queryByTestId("dash")).toBeNull();
  });

  it("hides sign-up when the instance does not allow it", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          native: true,
          passwordLogin: true,
          signupMode: "invite",
          requireEmailVerification: false,
          providers: ["google"],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;
    try {
      at("/");
      expect(await screen.findByText(/Sign in with Google ·/)).toBeTruthy();
      expect(screen.queryByTestId("landing-signup")).toBeNull();
      expect(screen.getByTestId("landing-cta").getAttribute("href")).toBe("/login");
    } finally {
      globalThis.fetch = real;
    }
  });

  it("still sends a signed-out visitor to sign-in from any other address", () => {
    at("/projects");
    expect(screen.getByTestId("login-page")).toBeTruthy();
    expect(screen.queryByTestId("landing-screen")).toBeNull();
  });
});
