import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, it, expect } from "vitest";
import * as yaml from "yaml";

const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");
const CI_DIR = path.join(WORKSPACE_ROOT, "deploy/ci");
const EXPECTED_COMMAND = "sdap run --mode focused --wait --fail-on confirmed:high";

describe("CI Templates Lint & Validation", () => {
  describe("YAML Parsing", () => {
    it("parses deploy/ci/bitbucket-pipelines.yml successfully", async () => {
      const filePath = path.join(CI_DIR, "bitbucket-pipelines.yml");
      const content = await fs.readFile(filePath, "utf-8");
      const parsed: unknown = yaml.parse(content);

      expect(parsed).toBeDefined();
      expect(typeof parsed).toBe("object");
      expect(content).toContain(EXPECTED_COMMAND);
      expect(content).toContain("SDAP_TOKEN");
    });

    it("parses deploy/ci/github-action/action.yml successfully with required fields", async () => {
      const filePath = path.join(CI_DIR, "github-action/action.yml");
      const content = await fs.readFile(filePath, "utf-8");
      const parsed = yaml.parse(content) as Record<string, unknown>;

      expect(parsed).toBeDefined();
      expect(typeof parsed.name).toBe("string");
      expect(typeof parsed.description).toBe("string");
      expect(parsed.inputs).toBeDefined();
      expect(typeof parsed.inputs).toBe("object");

      // Verify composite action structure
      expect(parsed.runs).toBeDefined();
      const runs = parsed.runs as Record<string, unknown>;
      expect(runs.using).toBe("composite");
      expect(Array.isArray(runs.steps)).toBe(true);

      // Verify expected command and token reference
      expect(content).toContain(EXPECTED_COMMAND);
      expect(content).toContain("inputs.token");
    });

    it("parses deploy/ci/.gitlab-ci.yml successfully", async () => {
      const filePath = path.join(CI_DIR, ".gitlab-ci.yml");
      const content = await fs.readFile(filePath, "utf-8");
      const parsed: unknown = yaml.parse(content);

      expect(parsed).toBeDefined();
      expect(typeof parsed).toBe("object");
      expect(content).toContain(EXPECTED_COMMAND);
      expect(content).toContain("SDAP_TOKEN");
    });
  });

  describe("Jenkinsfile Validation", () => {
    it("contains the expected command and credentials reference", async () => {
      const filePath = path.join(CI_DIR, "Jenkinsfile");
      const content = await fs.readFile(filePath, "utf-8");

      expect(content).toContain(EXPECTED_COMMAND);
      expect(content).toContain("credentials('sdap-token')");
    });
  });

  describe("Template Documentation", () => {
    it("provides a README for each template", async () => {
      const files = [
        path.join(CI_DIR, "README.md"),
        path.join(CI_DIR, "github-action/README.md"),
        path.join(CI_DIR, "bitbucket.README.md"),
        path.join(CI_DIR, "gitlab.README.md"),
        path.join(CI_DIR, "jenkins.README.md"),
      ];

      for (const f of files) {
        const stat = await fs.stat(f);
        expect(stat.isFile()).toBe(true);
        const text = await fs.readFile(f, "utf-8");
        expect(text.length).toBeGreaterThan(100);
      }
    });
  });
});
