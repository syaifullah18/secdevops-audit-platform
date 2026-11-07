import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppProvider } from "../src/context/AppContext.js";
import { installFetchShim, mockStore } from "../src/api/mock.js";
import {
  FIXTURE_FINDING_1_ID,
  FIXTURE_FINDING_4_ID,
  FIXTURE_PROJECT_1_ID,
  FIXTURE_RUN_1_ID,
} from "../src/api/fixtures.js";
import { OrgOverviewScreen } from "../src/screens/OrgOverview.js";
import { ProjectViewScreen } from "../src/screens/ProjectView.js";
import { RunTimelineScreen } from "../src/screens/RunTimeline.js";
import { FindingDetailScreen } from "../src/screens/FindingDetail.js";
import { ReviewQueueScreen } from "../src/screens/ReviewQueue.js";
import { PolicyViewScreen } from "../src/screens/PolicyView.js";
import { ReleaseReadinessScreen } from "../src/screens/ReleaseReadiness.js";
import { AuditExportScreen } from "../src/screens/AuditExport.js";

describe("Component Screen Tests against Mock API", () => {
  let uninstall: () => void;

  beforeEach(() => {
    mockStore.reset();
    uninstall = installFetchShim(mockStore);
    return () => {
      uninstall();
    };
  });

  afterEach(() => {
    cleanup();
  });

  const renderWithRouter = (ui: React.ReactNode, initialEntries = ["/"]) => {
    return render(
      <AppProvider>
        <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
      </AppProvider>,
    );
  };

  it("renders OrgOverviewScreen with key metrics, breakdowns, trend, and attack classes", async () => {
    renderWithRouter(<OrgOverviewScreen />);

    expect(screen.getByTestId("loading-indicator")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByTestId("org-overview-screen")).toBeTruthy();
    });

    expect(screen.getByTestId("metric-open-findings")).toBeTruthy();
    expect(screen.getByTestId("metric-sla-breaches")).toBeTruthy();
    expect(screen.getByTestId("metric-mttr")).toBeTruthy();
    expect(screen.getByTestId("trend-chart-card")).toBeTruthy();
    expect(screen.getByTestId("cross-project-attack-class")).toBeTruthy();
  });

  it("renders ProjectViewScreen with gate status, coverage ledger, run history and findings", async () => {
    renderWithRouter(
      <Routes>
        <Route path="/projects/:id" element={<ProjectViewScreen />} />
      </Routes>,
      [`/projects/${FIXTURE_PROJECT_1_ID}`],
    );

    await waitFor(() => {
      expect(screen.getByTestId("project-view-screen")).toBeTruthy();
    });

    expect(screen.getAllByText("Authentication & Session Gateway").length).toBeGreaterThan(0);
    expect(screen.getByTestId("gate-status-card")).toBeTruthy();
    expect(screen.getByTestId("coverage-ledger-card")).toBeTruthy();
    expect(screen.getByTestId("run-history-card")).toBeTruthy();
    expect(screen.getByTestId("project-findings-card")).toBeTruthy();

    // Trigger run modal can open
    const triggerBtn = screen.getByTestId("trigger-run-button");
    fireEvent.click(triggerBtn);
    expect(screen.getByText("Trigger Security Audit")).toBeTruthy();
  });

  it("renders RunTimelineScreen with phases, multi-attempt model fallbacks, validators and artifacts", async () => {
    renderWithRouter(
      <Routes>
        <Route path="/runs/:id" element={<RunTimelineScreen />} />
      </Routes>,
      [`/runs/${FIXTURE_RUN_1_ID}`],
    );

    await waitFor(() => {
      expect(screen.getByTestId("run-timeline-screen")).toBeTruthy();
    });

    expect(screen.getByTestId("run-status-badge").textContent).toContain("SUCCEEDED");
    expect(screen.getByTestId("validators-card")).toBeTruthy();
    expect(screen.getByTestId("artifacts-card")).toBeTruthy();
    expect(screen.getByTestId("phases-card")).toBeTruthy();
    expect(screen.getByTestId("slices-card")).toBeTruthy();

    // Fallback visibility test:
    // Attempt 1 on gemini failed with rate_limit_exceeded -> Attempt 2 on claude succeeded
    expect(
      screen.getByTestId("slice-attempt-60000000-0000-4000-8000-000000000001-1").textContent,
    ).toContain("rate_limit_exceeded");
    expect(
      screen.getByTestId("slice-attempt-60000000-0000-4000-8000-000000000001-2").textContent,
    ).toContain("claude-sonnet-5-5");
  });

  it("renders FindingDetailScreen with side-by-side severity, advisory label, draft fix, and trace", async () => {
    renderWithRouter(
      <Routes>
        <Route path="/findings/:id" element={<FindingDetailScreen />} />
      </Routes>,
      [`/findings/${FIXTURE_FINDING_1_ID}`],
    );

    await waitFor(() => {
      expect(screen.getByTestId("finding-detail-screen")).toBeTruthy();
    });

    // Side-by-side severity
    expect(screen.getByTestId("side-by-side-severity")).toBeTruthy();
    expect(screen.getByText("Hunter Severity (Pre-Verification)")).toBeTruthy();
    expect(screen.getByText("Verified Severity (Gate Authoritative)")).toBeTruthy();

    // Attribution
    expect(screen.getByTestId("attribution-label")).toBeTruthy();

    // System 1 Advisory badge
    expect(screen.getByTestId("system1-advisory")).toBeTruthy();
    expect(screen.getByText("System 1 · Advisory")).toBeTruthy();

    // Fix Draft badge
    expect(screen.getByTestId("fix-draft-viewer")).toBeTruthy();
    expect(screen.getByText("Draft · Human Review Only")).toBeTruthy();

    // Source trace & evidence
    expect(screen.getByTestId("source-trace-card")).toBeTruthy();
    expect(screen.getByTestId("evidence-items-card")).toBeTruthy();

    // Triage Action Form
    expect(screen.getByTestId("triage-action-form")).toBeTruthy();
  });

  it("enforces triage transitions and updates status in FindingDetailScreen", async () => {
    renderWithRouter(
      <Routes>
        <Route path="/findings/:id" element={<FindingDetailScreen />} />
      </Routes>,
      [`/findings/${FIXTURE_FINDING_1_ID}`],
    );

    await waitFor(() => {
      expect(screen.getByTestId("triage-action-form")).toBeTruthy();
    });

    // Current status is confirmed
    // Disallowed transition (e.g. "fixed" or "new") should be disabled in select
    const select = screen.getByTestId("target-status-select") as HTMLSelectElement;
    const fixedOption = select.querySelector('option[value="fixed"]') as HTMLOptionElement;
    expect(fixedOption.disabled).toBe(true);

    const inProgressOption = select.querySelector(
      'option[value="in_progress"]',
    ) as HTMLOptionElement;
    expect(inProgressOption.disabled).toBe(false);

    // Transition to in_progress
    fireEvent.change(select, { target: { value: "in_progress" } });
    fireEvent.click(screen.getByTestId("submit-triage-button"));

    await waitFor(() => {
      expect(screen.getByText("Triage state successfully updated!")).toBeTruthy();
    });
  });

  it("renders ReviewQueueScreen with open needs_validation items and their blockers", async () => {
    renderWithRouter(<ReviewQueueScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("review-queue-screen")).toBeTruthy();
    });

    expect(screen.getByTestId(`queue-item-${FIXTURE_FINDING_4_ID}`)).toBeTruthy();

    // Blockers must be prominently displayed
    const blockersEl = screen.getByTestId(`blockers-${FIXTURE_FINDING_4_ID}`);
    expect(blockersEl.textContent).toContain("Resolution Blockers");
    expect(blockersEl.textContent).toContain(
      "Production runtime configuration not verifiable statically",
    );
  });

  it("renders PolicyViewScreen with rules, SLA targets and exceptions ledger", async () => {
    renderWithRouter(<PolicyViewScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("policy-view-screen")).toBeTruthy();
    });

    expect(screen.getByTestId("policy-rules-card")).toBeTruthy();
    expect(screen.getByTestId("exceptions-table-card")).toBeTruthy();
    expect(screen.getByText("Production Strict Policy")).toBeTruthy();
    expect(screen.getByText("STRICT ENFORCE")).toBeTruthy();
  });

  it("renders ReleaseReadinessScreen ensuring only confirmed findings block gates", async () => {
    renderWithRouter(<ReleaseReadinessScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("release-readiness-screen")).toBeTruthy();
    });

    // FIXTURE_PROJECT_1 has open confirmed critical finding -> Gate Blocked
    const card1 = screen.getByTestId(`project-gate-card-${FIXTURE_PROJECT_1_ID}`);
    expect(card1).toBeTruthy();
    expect(screen.getByTestId(`gate-badge-${FIXTURE_PROJECT_1_ID}`).textContent).toContain(
      "GATE BLOCKED",
    );

    // Violations list contains confirmed critical finding
    const violations = screen.getByTestId(`violations-list-${FIXTURE_PROJECT_1_ID}`);
    expect(violations.textContent?.toLowerCase()).toContain("critical");
  });

  it("renders AuditExportScreen and triggers CSV and Markdown exports", async () => {
    // Mock URL.createObjectURL and URL.revokeObjectURL
    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    window.URL.createObjectURL = createObjectURL;
    window.URL.revokeObjectURL = revokeObjectURL;

    renderWithRouter(<AuditExportScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("audit-export-screen")).toBeTruthy();
    });

    const exportCsvBtn = screen.getByTestId("export-csv-button");
    fireEvent.click(exportCsvBtn);
    expect(createObjectURL).toHaveBeenCalled();

    const exportMdBtn = screen.getByTestId("export-md-button");
    fireEvent.click(exportMdBtn);
    expect(createObjectURL).toHaveBeenCalledTimes(2);

    // Test print PDF calls window.print
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    const exportPdfBtn = screen.getByTestId("export-pdf-button");
    fireEvent.click(exportPdfBtn);
    expect(printSpy).toHaveBeenCalled();
  });
});
