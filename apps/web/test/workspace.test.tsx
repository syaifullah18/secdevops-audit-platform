import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppProvider } from "../src/context/AppContext.js";
import { installFetchShim, mockStore } from "../src/api/mock.js";
import { Layout } from "../src/components/Layout.js";

describe("workspace switcher", () => {
  beforeEach(() => {
    sessionStorage.clear();
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
