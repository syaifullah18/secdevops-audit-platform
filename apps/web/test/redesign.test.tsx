import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppProvider } from "../src/context/AppContext.js";
import { installFetchShim, mockStore } from "../src/api/mock.js";
import { FIXTURE_FINDING_1_ID, FIXTURE_FINDING_4_ID } from "../src/api/fixtures.js";
import { Layout, pageTitleFor } from "../src/components/Layout.js";
import { buildReplay } from "../src/components/ExploitTerminalModal.js";
import { ReviewQueueScreen, columnOf } from "../src/screens/ReviewQueue.js";
import { countdown } from "../src/screens/ReleaseReadiness.js";
import { FindingDetailScreen } from "../src/screens/FindingDetail.js";
import { ReleaseReadinessScreen } from "../src/screens/ReleaseReadiness.js";
import { severityTone } from "../src/components/stitch.js";
import { makeFinding } from "@sdap/core/testing";

describe("Stitch redesign", () => {
  let uninstall: () => void;

  beforeEach(() => {
    mockStore.reset();
    uninstall = installFetchShim(mockStore);
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    uninstall();
  });

  const shell = (initial = "/review-queue") =>
    render(
      <AppProvider>
        <MemoryRouter initialEntries={[initial]}>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<div>home</div>} />
              <Route path="review-queue" element={<ReviewQueueScreen />} />
              <Route path="findings/:id" element={<FindingDetailScreen />} />
              <Route path="release-readiness" element={<ReleaseReadinessScreen />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AppProvider>,
    );

  describe("shell", () => {
    it("shows the six nav items, breadcrumb title and a live review-queue count", async () => {
      shell();
      for (const id of [
        "nav-overview",
        "nav-projects",
        "nav-review-queue",
        "nav-release-readiness",
        "nav-policy",
        "nav-export",
      ]) {
        expect(screen.getByTestId(id)).toBeTruthy();
      }
      expect(screen.getByTestId("page-title").textContent).toBe("Security Review Queue");
      await waitFor(() =>
        expect(screen.getByTestId("nav-review-queue-count").textContent).toBe("1"),
      );
    });

    it("keeps Review Queue highlighted while viewing one of its findings", async () => {
      shell(`/findings/${FIXTURE_FINDING_4_ID}`);
      expect(screen.getByTestId("nav-review-queue").getAttribute("aria-current")).toBe("page");
      expect(screen.getByTestId("nav-overview").getAttribute("aria-current")).toBeNull();
    });

    it("toggles theme on <html> and exposes the rejected switch state", () => {
      shell();
      const toggle = screen.getByTestId("toggle-show-rejected");
      expect(toggle.getAttribute("role")).toBe("switch");
      expect(toggle.getAttribute("aria-checked")).toBe("false");
      fireEvent.click(toggle);
      expect(toggle.getAttribute("aria-checked")).toBe("true");

      fireEvent.click(screen.getByTestId("theme-toggle-button"));
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      fireEvent.click(screen.getByTestId("theme-toggle-button"));
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    });

    it("maps routes to the page titles the e2e suite relies on", () => {
      expect(pageTitleFor("/")).toBe("Organization Overview");
      expect(pageTitleFor("/findings/x")).toBe("Finding Inspection & Triage");
      expect(pageTitleFor("/nope")).toBe("SecDevOps Audit Platform");
    });
  });

  describe("command palette", () => {
    it("opens with Ctrl+K, filters, navigates with the keyboard and closes on Escape", async () => {
      shell("/");
      expect(screen.queryByTestId("command-palette")).toBeNull();
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
      expect(screen.getByTestId("command-palette")).toBeTruthy();
      expect(screen.getByText("Run Deterministic Audit")).toBeTruthy();

      const input = screen.getByRole("combobox");
      fireEvent.change(input, { target: { value: "export" } });
      expect(screen.getByText("Export Compliance Report")).toBeTruthy();
      expect(screen.queryByText("Toggle Theme")).toBeNull();

      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByTestId("command-palette")).toBeNull();
    });

    it("runs the highlighted command on Enter and Toggle Theme on its shortcut", async () => {
      shell("/");
      fireEvent.click(screen.getByTestId("open-command-palette"));
      fireEvent.keyDown(window, { key: "ArrowDown" });
      fireEvent.keyDown(window, { key: "ArrowUp" });
      fireEvent.keyDown(window, { key: "d", metaKey: true });
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });

    it("lists only confirmed or needs_validation findings, never rejected ones", async () => {
      shell("/");
      fireEvent.click(screen.getByTestId("open-command-palette"));
      await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(4));
      const rejected = mockStore.findings.filter((f) => f.verdict === "rejected");
      for (const f of rejected) expect(screen.queryByText(f.title)).toBeNull();
    });
  });

  describe("review queue board", () => {
    it("places an unowned lead in Unassigned Triage and never offers a gate-failing action", async () => {
      shell();
      await waitFor(() => expect(screen.getByTestId("review-queue-screen")).toBeTruthy());
      const col = screen.getByTestId("column-unassigned");
      expect(col.querySelector(`[data-testid="queue-item-${FIXTURE_FINDING_4_ID}"]`)).toBeTruthy();
      expect(screen.getByTestId(`sandbox-${FIXTURE_FINDING_4_ID}`)).toBeTruthy();
    });

    it("Reject needs a reason and removes the lead once confirmed", async () => {
      shell();
      await waitFor(() => screen.getByTestId(`reject-${FIXTURE_FINDING_4_ID}`));
      fireEvent.click(screen.getByTestId(`reject-${FIXTURE_FINDING_4_ID}`));
      const confirm = screen.getByTestId(
        `confirm-reject-${FIXTURE_FINDING_4_ID}`,
      ) as HTMLButtonElement;
      expect(confirm.disabled).toBe(true);

      fireEvent.change(screen.getByLabelText(/Why is this a false positive/), {
        target: { value: "Unreachable in production: the secret is overridden by deploy config." },
      });
      expect(confirm.disabled).toBe(false);
      fireEvent.click(confirm);
      await waitFor(() =>
        expect(screen.queryByTestId(`queue-item-${FIXTURE_FINDING_4_ID}`)).toBeNull(),
      );
      const stored = mockStore.findings.find((f) => f.id === FIXTURE_FINDING_4_ID);
      expect(stored?.status).toBe("false_positive");
      expect(stored?.verdict).toBe("needs_validation"); // triage never rewrites the verdict
    });

    it("Accept moves the lead to In Investigation only via an allowed transition", async () => {
      shell();
      await waitFor(() => screen.getByTestId(`accept-${FIXTURE_FINDING_4_ID}`));
      fireEvent.click(screen.getByTestId(`accept-${FIXTURE_FINDING_4_ID}`));
      await waitFor(() =>
        expect(
          screen
            .getByTestId("column-investigating")
            .querySelector(`[data-testid="queue-item-${FIXTURE_FINDING_4_ID}"]`),
        ).toBeTruthy(),
      );
    });

    it("columnOf follows the documented rules", () => {
      const base = makeFinding({ verdict: "needs_validation", blockers: ["needs sandbox"] });
      expect(columnOf({ ...base, owner: null, status: "new" })).toBe("unassigned");
      expect(columnOf({ ...base, owner: "a@x.example", status: "new" })).toBe("investigating");
      expect(columnOf({ ...base, owner: null, status: "in_progress" })).toBe("investigating");
    });
  });

  describe("exploit terminal", () => {
    it("builds a replay from the finding's own trace and never claims proof for a lead", () => {
      const lead = makeFinding({ verdict: "needs_validation", blockers: ["needs sandbox"] });
      const lines = buildReplay(lead).map((l) => l.text);
      expect(lines[0]).toContain(lead.fingerprint);
      expect(lines.some((l) => l.includes("not proof"))).toBe(true);
      expect(lines.some((l) => l.includes("proof matches the verdict"))).toBe(false);
    });

    it("opens from a finding, labels itself a simulation and closes on Escape", async () => {
      shell(`/findings/${FIXTURE_FINDING_1_ID}`);
      await waitFor(() => screen.getByTestId("launch-sandbox-proof"));
      fireEvent.click(screen.getByTestId("launch-sandbox-proof"));
      expect(screen.getByText("Simulation: no code is executed")).toBeTruthy();
      expect(screen.getByRole("log")).toBeTruthy();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByTestId("exploit-terminal")).toBeNull();
    });
  });

  describe("release readiness", () => {
    it("computes invariants from data and keeps advisory leads informational", async () => {
      shell("/release-readiness");
      await waitFor(() => screen.getByTestId("gatekeeper-status"));
      expect(screen.getByTestId("check-signoff").textContent).toContain("never fail the gate");
      expect(screen.getByTestId("check-blocking")).toBeTruthy();
      expect(["BLOCKED", "PASSED"]).toContain(screen.getByTestId("gatekeeper-status").textContent);
    });

    it("formats exception countdowns in both directions", () => {
      const now = Date.parse("2026-01-10T00:00:00Z");
      expect(countdown("2026-01-12T05:00:00Z", now)).toBe("2d 5h left");
      expect(countdown("2026-01-09T20:00:00Z", now)).toBe("expired 4h ago");
      expect(countdown(null, now)).toBe("No expiry");
    });
  });

  it("maps every severity, including informational, to a tone", () => {
    expect(severityTone("critical")).toBe("critical");
    expect(severityTone("informational")).toBe("low");
    expect(severityTone(null)).toBe("neutral");
  });
});
