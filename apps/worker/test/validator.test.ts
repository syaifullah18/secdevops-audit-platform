import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ValidationService } from "../src/validator.js";

describe("ValidationService", () => {
  const skillPath = path.resolve(
    __dirname,
    "../../../vendor/security-audit-skill/skills/security-audit",
  );
  const validator = new ValidationService(skillPath);

  it("validates valid findings successfully", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "val-test-"));
    const findingsFile = path.join(tmp, "findings.json");

    const validFindings = [
      {
        verdict: "confirmed",
        fingerprint: "test-authz-rule",
        title: "Missing authorization check",
        description: "Public endpoint accesses protected resource without auth check.",
        root_cause: "Controller omits user check.",
        intended_behavior: "Verify user ID before returning object.",
        trace: [
          {
            kind: "entrypoint",
            file: "src/routes.ts",
            line: 10,
            scope: "GET /data",
            description: "Request handler",
          },
          {
            kind: "sink",
            file: "src/service.ts",
            line: 25,
            scope: "fetchData",
            description: "Direct read",
          },
        ],
        evidence: [
          {
            file: "src/service.ts",
            line: 25,
            description: "Query without filter",
          },
        ],
        conditions: [],
        execution: {
          attacker_perspective: "Authenticated remote user",
          payloads: ["target-id"],
          instructions: ["GET /data"],
          observed_result: "Victim data leaked",
        },
        remediation: { strategy: "Add user filter" },
        severity: {
          likelihood: { score: "medium", reason: "Direct route" },
          impact: { score: "high", reason: "Data exposure" },
          overall_severity: "high",
        },
        confidence: { score: "high", reason: "Confirmed locally" },
      },
    ];

    await fs.writeFile(findingsFile, JSON.stringify(validFindings, null, 2));
    const result = await validator.validateFindings(findingsFile);

    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);

    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("fails on invalid findings and moves file to quarantine", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "val-test-"));
    const findingsFile = path.join(tmp, "findings.json");

    // Concatenated invalid JSON
    await fs.writeFile(findingsFile, '{"verdict":"confirmed"} {"invalid":"syntax"}');

    const result = await validator.validateFindings(findingsFile);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);

    const quarantined = await validator.quarantineFile(findingsFile, tmp, "slice-1");
    expect(quarantined).toContain("quarantine");

    const quarantinedExists = await fs
      .access(quarantined)
      .then(() => true)
      .catch(() => false);
    expect(quarantinedExists).toBe(true);

    await fs.rm(tmp, { recursive: true, force: true });
  });
});
