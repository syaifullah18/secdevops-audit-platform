import { test, expect } from "@playwright/test";

test.describe("SecDevOps Web Dashboard E2E Smoke Tests", () => {
  test("1. overview loads and displays security posture metrics", async ({ page }) => {
    await page.goto("/");

    // Verify main header and metrics
    await expect(page.getByTestId("page-title")).toHaveText("Organization Overview");
    await expect(page.getByTestId("metric-open-findings")).toBeVisible();
    await expect(page.getByTestId("metric-sla-breaches")).toBeVisible();
    await expect(page.getByTestId("metric-mttr")).toBeVisible();

    // Verify cross-project attack class table
    await expect(page.getByTestId("cross-project-attack-class")).toBeVisible();
    await expect(page.getByText("Cross-Project Attack Class Distribution")).toBeVisible();
  });

  test("2. open a finding and inspect side-by-side severity, advisory label, and fix draft", async ({
    page,
  }) => {
    // Navigate directly to the critical finding
    await page.goto("/findings/40000000-0000-4000-8000-000000000001");

    // Title and side-by-side severity
    await expect(
      page.getByText("Broken Object Level Authorization in Session Impersonation Endpoint"),
    ).toBeVisible();
    await expect(page.getByTestId("side-by-side-severity")).toBeVisible();
    await expect(page.getByText("Hunter Severity (Pre-Verification)")).toBeVisible();
    await expect(page.getByText("Verified Severity (Gate Authoritative)")).toBeVisible();

    // Attribution and advisory badge
    await expect(page.getByTestId("attribution-label")).toBeVisible();
    await expect(page.getByTestId("system1-advisory")).toBeVisible();
    await expect(page.getByText("System 1 · Advisory")).toBeVisible();

    // Fix draft viewer
    await expect(page.getByTestId("fix-draft-viewer")).toBeVisible();
    await expect(page.getByText("Draft · Human Review Only")).toBeVisible();

    // Source trace
    await expect(page.getByTestId("source-trace-card")).toBeVisible();
  });

  test("3. triage a finding respecting state transitions", async ({ page }) => {
    await page.goto("/findings/40000000-0000-4000-8000-000000000001");

    await expect(page.getByTestId("triage-action-form")).toBeVisible();

    // Select in_progress
    const select = page.getByTestId("target-status-select");
    await select.selectOption("in_progress");

    // Submit triage decision
    await page.getByTestId("submit-triage-button").click();

    // Verify confirmation feedback
    await expect(page.getByText("Triage state successfully updated!")).toBeVisible();
  });

  test("4. review queue lists needs_validation items with blockers", async ({ page }) => {
    await page.goto("/review-queue");

    await expect(page.getByTestId("page-title")).toHaveText("Security Review Queue");
    await expect(page.getByTestId("queue-item-40000000-0000-4000-8000-000000000004")).toBeVisible();

    // Check that blockers are prominently displayed
    const blockers = page.getByTestId("blockers-40000000-0000-4000-8000-000000000004");
    await expect(blockers).toBeVisible();
    await expect(blockers).toContainText("Resolution Blockers");
    await expect(blockers).toContainText(
      "Production runtime configuration not verifiable statically",
    );
  });
});
