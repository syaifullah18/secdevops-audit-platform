import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppProvider } from "../src/context/AppContext.js";
import { installFetchShim, mockStore } from "../src/api/mock.js";
import { Layout } from "../src/components/Layout.js";

describe("workspace switcher", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStore.reset();
    return installFetchShim(mockStore);
  });
  afterEach(cleanup);

  it("opens a menu of repositories and closes on Escape", async () => {
    render(
      <AppProvider>
        <MemoryRouter>
          <Layout />
        </MemoryRouter>
      </AppProvider>,
    );
    const btn = screen.getByTestId("workspace-switcher");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => expect(btn.textContent).toMatch(/\d+ Repositor/));

    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByTestId("workspace-menu");
    expect(menu.querySelectorAll("a[href^='/projects/']").length).toBe(mockStore.projects.length);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("workspace-menu")).toBeNull());
  });
});

import { Route, Routes } from "react-router-dom";
import { ProjectsScreen } from "../src/screens/Projects.js";

describe("projects page", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStore.reset();
    return installFetchShim(mockStore);
  });
  afterEach(cleanup);

  it("lists every repository and the Projects nav opens it", async () => {
    render(
      <AppProvider>
        <MemoryRouter initialEntries={["/projects"]}>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route path="projects" element={<ProjectsScreen />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AppProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("projects-screen")).toBeTruthy());
    expect(screen.getByTestId("nav-projects").getAttribute("href")).toBe("/projects");
    expect(screen.getByTestId("nav-projects").getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("page-title").textContent).toBe("Projects");
    expect(
      screen.getByTestId("projects-screen").querySelectorAll("a[href^='/projects/']").length,
    ).toBe(mockStore.projects.length);
  });
});
