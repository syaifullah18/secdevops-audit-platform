import { describe, expect, it } from "vitest";
import { RulesAdapter } from "../src/adapters/rules.js";
import { describeDecisionAdapterContract } from "./contract.js";

describe("Rules Adapter", () => {
  describeDecisionAdapterContract({
    adapterKind: "rules",
    createAdapter: () => new RulesAdapter(),
    isHttp: false,
  });

  it("determines high probability when diff touches security-critical paths", async () => {
    const rules = new RulesAdapter();
    const decision = await rules.decide({
      id: "00000000-0000-4000-8000-000000000010",
      key: "change.touches_authz",
      kind: "binary",
      prompt: "Does this change touch authorization or authentication?",
      subject: {
        type: "diff",
        ref: "commit-1",
        context: ["src/security/JwtAuthenticationFilter.java", "SecurityContextHolder"],
      },
      projectId: null,
    });

    expect(decision.kind).toBe("binary");
    if (decision.kind === "binary") {
      expect(decision.probability).toBeGreaterThanOrEqual(0.8);
    }
  });

  it("determines low probability for benign non-security files", async () => {
    const rules = new RulesAdapter();
    const decision = await rules.decide({
      id: "00000000-0000-4000-8000-000000000011",
      key: "change.touches_authz",
      kind: "binary",
      prompt: "Does this change touch authorization or authentication?",
      subject: {
        type: "diff",
        ref: "commit-2",
        context: ["public/styles/theme.css", "assets/logo.png"],
      },
      projectId: null,
    });

    expect(decision.kind).toBe("binary");
    if (decision.kind === "binary") {
      expect(decision.probability).toBeLessThanOrEqual(0.2);
    }
  });

  it("identifies CI and IaC modifications", async () => {
    const rules = new RulesAdapter();
    const decision = await rules.decide({
      id: "00000000-0000-4000-8000-000000000012",
      key: "change.modifies_ci",
      kind: "binary",
      prompt: "Does this change modify CI or IaC pipelines?",
      subject: {
        type: "diff",
        ref: "commit-3",
        context: [".github/workflows/deploy.yml", "terraform/main.tf"],
      },
      projectId: null,
    });

    expect(decision.kind).toBe("binary");
    if (decision.kind === "binary") {
      expect(decision.probability).toBeGreaterThanOrEqual(0.8);
    }
  });

  it("routes attack classes based on keywords", async () => {
    const rules = new RulesAdapter();
    const decision = await rules.decide({
      id: "00000000-0000-4000-8000-000000000013",
      key: "routing.attack_class",
      kind: "choice",
      prompt: "Pick relevant attack classes",
      options: ["authz", "injection", "config"],
      multi: false,
      subject: {
        type: "diff",
        ref: "commit-4",
        context: ["raw query execute sql database statement"],
      },
      projectId: null,
    });

    expect(decision.kind).toBe("choice");
    if (decision.kind === "choice") {
      expect(decision.distribution["injection"]).toBeGreaterThan(
        decision.distribution["authz"] ?? 0,
      );
    }
  });
});
