import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../src/api/client.js";
import { installFetchShim, mockStore } from "../src/api/mock.js";
import {
  FIXTURE_FINDING_1_ID,
  FIXTURE_FINDING_4_ID,
  FIXTURE_PROJECT_1_ID,
  FIXTURE_RUN_1_ID,
  FIXTURE_POLICY_1_ID,
} from "../src/api/fixtures.js";

describe("Typed API client against mock API", () => {
  let uninstall: () => void;

  beforeEach(() => {
    mockStore.reset();
    uninstall = installFetchShim(mockStore);
    return () => {
      uninstall();
    };
  });

  it("fetches projects and validates with Project schema", async () => {
    const projects = await api.getProjects();
    expect(projects.length).toBeGreaterThan(0);
    expect(projects[0].slug).toBe("auth-gateway");
  });

  it("fetches single project", async () => {
    const project = await api.getProject(FIXTURE_PROJECT_1_ID);
    expect(project.id).toBe(FIXTURE_PROJECT_1_ID);
    expect(project.name).toBe("Authentication & Session Gateway");
  });

  it("fetches runs and validates RunPage", async () => {
    const runPage = await api.getRuns(FIXTURE_PROJECT_1_ID);
    expect(runPage.items.length).toBeGreaterThan(0);
    expect(runPage.items[0].id).toBe(FIXTURE_RUN_1_ID);
  });

  it("fetches single run and its slices and events", async () => {
    const run = await api.getRun(FIXTURE_RUN_1_ID);
    expect(run.id).toBe(FIXTURE_RUN_1_ID);
    expect(run.status).toBe("succeeded");

    const slices = await api.getRunSlices(FIXTURE_RUN_1_ID);
    expect(slices.length).toBeGreaterThan(0);
    expect(slices[0].attempts.length).toBeGreaterThan(0);

    const events = await api.getRunEvents(FIXTURE_RUN_1_ID);
    expect(events.length).toBeGreaterThan(0);
  });

  it("fetches findings with includeRejected=false by default (hiding rejected findings)", async () => {
    const page = await api.getFindings();
    expect(page.items.some((f) => f.verdict === "rejected")).toBe(false);
  });

  it("fetches findings with includeRejected=true (revealing rejected findings)", async () => {
    const page = await api.getFindings({ includeRejected: true });
    expect(page.items.some((f) => f.verdict === "rejected")).toBe(true);
  });

  it("fetches single finding and triage history", async () => {
    const finding = await api.getFinding(FIXTURE_FINDING_1_ID);
    expect(finding.id).toBe(FIXTURE_FINDING_1_ID);
    expect(finding.verifiedSeverity).toBe("critical");

    const history = await api.getFindingHistory(FIXTURE_FINDING_1_ID);
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].to).toBe("confirmed");
  });

  it("performs valid triage transition and updates finding", async () => {
    const updated = await api.triageFinding(FIXTURE_FINDING_1_ID, {
      to: "in_progress",
      reason: "Assigned to engineer for mitigation",
      owner: "engineer@example.org",
    });
    expect(updated.status).toBe("in_progress");
    expect(updated.owner).toBe("engineer@example.org");

    const history = await api.getFindingHistory(FIXTURE_FINDING_1_ID);
    expect(history[history.length - 1].to).toBe("in_progress");
  });

  it("rejects invalid triage transition according to TRIAGE_TRANSITIONS", async () => {
    // Current status of FIXTURE_FINDING_1_ID is confirmed. TRIAGE_TRANSITIONS:
    // confirmed -> ["in_progress", "accepted_risk", "false_positive"]
    // so transitioning directly from confirmed to new or fixed is invalid.
    await expect(
      api.triageFinding(FIXTURE_FINDING_1_ID, {
        to: "fixed",
        reason: "Fixed without in_progress",
      }),
    ).rejects.toThrow();
  });

  it("fetches review queue (needs_validation findings)", async () => {
    const queue = await api.getReviewQueue();
    expect(queue.length).toBeGreaterThan(0);
    expect(queue.every((f) => f.verdict === "needs_validation")).toBe(true);
    expect(queue.some((f) => f.id === FIXTURE_FINDING_4_ID)).toBe(true);
  });

  it("fetches policy and gate evaluation", async () => {
    const policy = await api.getPolicy(FIXTURE_POLICY_1_ID);
    expect(policy.id).toBe(FIXTURE_POLICY_1_ID);
    expect(policy.mode).toBe("enforce");

    const gate = await api.getGate(FIXTURE_PROJECT_1_ID);
    expect(gate).toHaveProperty("pass");
    expect(gate).toHaveProperty("violations");
    expect(gate).toHaveProperty("excepted");
  });

  it("fetches coverage summary", async () => {
    const cov = await api.getCoverage(FIXTURE_PROJECT_1_ID);
    expect(cov.projectId).toBe(FIXTURE_PROJECT_1_ID);
    expect(cov.coveragePct).toBeGreaterThan(80);
  });

  it("fetches org overview metrics", async () => {
    const overview = await api.getOverview();
    expect(overview.totalOpenFindings).toBeGreaterThan(0);
    expect(overview.meanTimeToRemediateDays).toBeGreaterThan(0);
    expect(overview.crossProjectAttackClasses.length).toBeGreaterThan(0);
  });
});
