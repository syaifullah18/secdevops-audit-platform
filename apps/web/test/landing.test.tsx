import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
  });
  afterEach(cleanup);

  it("shows to a signed-out visitor at / with sign-up and log in", () => {
    at("/");
    expect(screen.getByTestId("landing-screen")).toBeTruthy();
    expect(screen.getByTestId("landing-signup").getAttribute("href")).toBe("/signup");
    expect(screen.getByTestId("landing-login").getAttribute("href")).toBe("/login");
    expect(screen.queryByTestId("dash")).toBeNull();
  });

  it("still sends a signed-out visitor to sign-in from any other address", () => {
    at("/projects");
    expect(screen.getByTestId("login-page")).toBeTruthy();
    expect(screen.queryByTestId("landing-screen")).toBeNull();
  });
});
