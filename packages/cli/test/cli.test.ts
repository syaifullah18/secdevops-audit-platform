import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { type Run, type GateResult, GateResult as GateResultSchema } from "@sdap/core";
import { runCli } from "../src/cli.js";
import { EXIT_CODES } from "../src/types.js";
import { MockHttpServer } from "./mock-server.js";

const PROJECT_ID = "00000000-0000-4000-8000-0000000000aa";
const RUN_ID = "00000000-0000-4000-8000-0000000000b1";
const FINDING_ID = "00000000-0000-4000-8000-0000000000c1";

describe("sdap CLI", () => {
  let server: MockHttpServer;
  let serverUrl: string;

  beforeEach(async () => {
    server = new MockHttpServer();
    serverUrl = await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  function createTestIo() {
    let stdout = "";
    let stderr = "";
    return {
      stdout: (t: string) => {
        stdout += `${t}\n`;
      },
      stderr: (t: string) => {
        stderr += `${t}\n`;
      },
      getStdout: () => stdout,
      getStderr: () => stderr,
      env: {
        SDAP_API_URL: serverUrl,
        SDAP_PROJECT: PROJECT_ID,
      } as Record<string, string | undefined> as NodeJS.ProcessEnv,
    };
  }

  const makeMockRun = (overrides: Partial<Run> = {}): Run => ({
    id: RUN_ID,
    projectId: PROJECT_ID,
    mode: "focused",
    repeat: 1,
    trigger: { kind: "ci", actor: "ci-bot", ref: "refs/pull/42/head" },
    ref: "HEAD",
    commitSha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    baseCommitSha: "0000000000000000000000000000000000000000",
    previousRunId: null,
    scope: { paths: [], attackClasses: [], maxRuntimeSec: 14400, tokenBudget: null },
    status: "succeeded",
    phases: [
      {
        runId: RUN_ID,
        name: "recon",
        status: "succeeded",
        startedAt: "2026-11-07T12:00:00.000Z",
        endedAt: "2026-11-07T12:01:00.000Z",
        sliceCount: 2,
        slicesDone: 2,
        usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.001 },
      },
      {
        runId: RUN_ID,
        name: "hunt",
        status: "succeeded",
        startedAt: "2026-11-07T12:01:00.000Z",
        endedAt: "2026-11-07T12:05:00.000Z",
        sliceCount: 4,
        slicesDone: 4,
        usage: { inputTokens: 400, outputTokens: 200, costUsd: 0.004 },
      },
    ],
    validators: { findings: "passed", coverageLedger: "passed" },
    skillVersion: "skill-v1.0.0",
    usage: { inputTokens: 500, outputTokens: 250, costUsd: 0.005 },
    artifacts: {
      findingsJson: `runs/${RUN_ID}/findings.json`,
      coverageLedgerJson: `runs/${RUN_ID}/coverage-ledger.json`,
      architectureMd: null,
      reportMd: `runs/${RUN_ID}/REPORT.md`,
      findingsDetailMd: null,
      needsValidationMd: null,
    },
    failureReason: null,
    retries: 0,
    createdAt: "2026-11-07T12:00:00.000Z",
    startedAt: "2026-11-07T12:00:05.000Z",
    endedAt: "2026-11-07T12:05:30.000Z",
    ...overrides,
  });

  describe("AC 1: run + wait success → 0 and stream progress", () => {
    it("polls until run completes, streams phase progress to stderr, and exits with 0", async () => {
      let pollCount = 0;
      server.on("POST", "/runs", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(makeMockRun({ status: "queued" })));
      });

      server.on("GET", `/runs/${RUN_ID}`, (_req, res) => {
        pollCount++;
        res.setHeader("Content-Type", "application/json");
        if (pollCount === 1) {
          res.end(
            JSON.stringify(
              makeMockRun({
                status: "running",
                phases: [
                  {
                    runId: RUN_ID,
                    name: "recon",
                    status: "running",
                    startedAt: "2026-11-07T12:00:00.000Z",
                    endedAt: null,
                    sliceCount: 2,
                    slicesDone: 1,
                    usage: { inputTokens: 50, outputTokens: 25, costUsd: 0.0005 },
                  },
                ],
              }),
            ),
          );
        } else {
          res.end(JSON.stringify(makeMockRun({ status: "succeeded" })));
        }
      });

      server.on("GET", `/projects/${PROJECT_ID}/gate`, (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        const gate: GateResult = {
          pass: true,
          mode: "enforce",
          violations: [],
          excepted: [],
          evaluatedAt: new Date().toISOString(),
        };
        res.end(JSON.stringify(gate));
      });

      const io = createTestIo();
      const code = await runCli(
        ["run", "--project", PROJECT_ID, "--wait", "--poll-interval", "20"],
        io,
      );

      expect(code).toBe(EXIT_CODES.PASS);
      expect(io.getStdout()).toContain(`Run ${RUN_ID} completed successfully`);
      expect(io.getStderr()).toContain("[phase] recon: running (1/2 slices)");
      expect(io.getStderr()).toContain("[phase] recon: succeeded (2/2 slices)");
      expect(io.getStderr()).toContain("[phase] hunt: succeeded (4/4 slices)");
    });
  });

  describe("AC 2: confirmed high → 1", () => {
    it("fails with exit code 1 when confirmed findings at or above threshold exist", async () => {
      server.on("POST", "/runs", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(makeMockRun({ status: "succeeded" })));
      });

      server.on("GET", `/runs/${RUN_ID}`, (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(makeMockRun({ status: "succeeded" })));
      });

      server.on("GET", `/projects/${PROJECT_ID}/gate`, (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        const gate: GateResult = {
          pass: false,
          mode: "enforce",
          violations: [
            {
              findingId: FINDING_ID,
              fingerprint: "auth.bypass.v1",
              severity: "high",
            },
          ],
          excepted: [],
          evaluatedAt: new Date().toISOString(),
        };
        res.end(JSON.stringify(gate));
      });

      const io = createTestIo();
      const code = await runCli(
        [
          "run",
          "--project",
          PROJECT_ID,
          "--wait",
          "--fail-on",
          "confirmed:high",
          "--poll-interval",
          "20",
        ],
        io,
      );

      expect(code).toBe(EXIT_CODES.GATE_FAILED);
      expect(io.getStderr()).toContain(
        "Gate failed: 1 confirmed finding(s) at or above high found",
      );
      expect(io.getStderr()).toContain(`Finding ${FINDING_ID}`);
    });
  });

  describe("AC 3: run failed → 2", () => {
    it("exits with 2 when run status becomes failed", async () => {
      server.on("POST", "/runs", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(makeMockRun({ status: "running" })));
      });

      server.on("GET", `/runs/${RUN_ID}`, (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify(
            makeMockRun({
              status: "failed",
              failureReason: "Sandbox out of memory during adversarial validation",
            }),
          ),
        );
      });

      const io = createTestIo();
      const code = await runCli(
        ["run", "--project", PROJECT_ID, "--wait", "--poll-interval", "20"],
        io,
      );

      expect(code).toBe(EXIT_CODES.RUN_FAILED);
      expect(io.getStderr()).toContain(`Run ${RUN_ID} failed: Sandbox out of memory`);
    });

    it("exits with 2 when validator fails", async () => {
      server.on("POST", "/runs", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(makeMockRun({ status: "running" })));
      });

      server.on("GET", `/runs/${RUN_ID}`, (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify(
            makeMockRun({
              status: "succeeded",
              validators: { findings: "failed", coverageLedger: "passed" },
            }),
          ),
        );
      });

      const io = createTestIo();
      const code = await runCli(
        ["run", "--project", PROJECT_ID, "--wait", "--poll-interval", "20"],
        io,
      );

      expect(code).toBe(EXIT_CODES.RUN_FAILED);
      expect(io.getStderr()).toContain("validator failed: findings=failed");
    });
  });

  describe("AC 4: bad --fail-on → 3", () => {
    it("exits with 3 for needs_validation:high because only confirmed findings may fail a gate", async () => {
      const io = createTestIo();
      const code = await runCli(
        ["run", "--project", PROJECT_ID, "--fail-on", "needs_validation:high"],
        io,
      );

      expect(code).toBe(EXIT_CODES.USAGE_ERROR);
      expect(io.getStderr()).toContain('Invalid --fail-on: "needs_validation:high"');
      expect(io.getStderr()).toContain("Only confirmed findings may fail a gate");
    });

    it("exits with 3 for malformed fail-on syntax", async () => {
      const io = createTestIo();
      const code = await runCli(
        ["run", "--project", PROJECT_ID, "--fail-on", "confirmed:unknown_sev"],
        io,
      );

      expect(code).toBe(EXIT_CODES.USAGE_ERROR);
      expect(io.getStderr()).toContain('Invalid --fail-on: "confirmed:unknown_sev"');
    });
  });

  describe("AC 5: timeout → 4", () => {
    it("exits with 4 when polling exceeds the specified timeout", async () => {
      server.on("POST", "/runs", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(makeMockRun({ status: "running" })));
      });

      server.on("GET", `/runs/${RUN_ID}`, (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(makeMockRun({ status: "running" })));
      });

      const io = createTestIo();
      const code = await runCli(
        ["run", "--project", PROJECT_ID, "--wait", "--timeout", "1", "--poll-interval", "50"],
        io,
      );

      expect(code).toBe(EXIT_CODES.TIMEOUT);
      expect(io.getStderr()).toContain("timed out after 1s");
    });
  });

  describe("AC 6: --json output parses", () => {
    it("outputs valid JSON for sdap run", async () => {
      server.on("POST", "/runs", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(makeMockRun()));
      });

      const io = createTestIo();
      const code = await runCli(["run", "--project", PROJECT_ID, "--json"], io);

      expect(code).toBe(EXIT_CODES.PASS);
      const parsed = JSON.parse(io.getStdout());
      expect(parsed.id).toBe(RUN_ID);
      expect(parsed.projectId).toBe(PROJECT_ID);
    });

    it("outputs valid JSON for sdap status", async () => {
      server.on("GET", `/runs/${RUN_ID}`, (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(makeMockRun()));
      });

      const io = createTestIo();
      const code = await runCli(["status", RUN_ID, "--json"], io);

      expect(code).toBe(EXIT_CODES.PASS);
      const parsed = JSON.parse(io.getStdout());
      expect(parsed.id).toBe(RUN_ID);
      expect(parsed.validators.findings).toBe("passed");
    });

    it("outputs valid JSON for sdap gate", async () => {
      server.on("GET", `/projects/${PROJECT_ID}/gate`, (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        const gate: GateResult = {
          pass: true,
          mode: "enforce",
          violations: [],
          excepted: [],
          evaluatedAt: new Date().toISOString(),
        };
        res.end(JSON.stringify(gate));
      });

      const io = createTestIo();
      const code = await runCli(["gate", "--project", PROJECT_ID, "--json"], io);

      expect(code).toBe(EXIT_CODES.PASS);
      const parsed = JSON.parse(io.getStdout());
      expect(parsed.pass).toBe(true);
      expect(GateResultSchema.safeParse(parsed).success).toBe(true);
    });
  });

  describe("Commands: status, report, and gate", () => {
    it("prints human-readable status", async () => {
      server.on("GET", `/runs/${RUN_ID}`, (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(makeMockRun()));
      });

      const io = createTestIo();
      const code = await runCli(["status", RUN_ID], io);

      expect(code).toBe(EXIT_CODES.PASS);
      expect(io.getStdout()).toContain(`Run ID:          ${RUN_ID}`);
      expect(io.getStdout()).toContain("Status:          SUCCEEDED");
      expect(io.getStdout()).toContain("recon");
      expect(io.getStdout()).toContain("hunt");
    });

    it("generates markdown report to stdout and file", async () => {
      server.on("GET", `/runs/${RUN_ID}`, (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(makeMockRun()));
      });

      const io = createTestIo();
      const code = await runCli(["report", RUN_ID, "--format", "md"], io);

      expect(code).toBe(EXIT_CODES.PASS);
      expect(io.getStdout()).toContain(`# SDAP Audit Report - Run ${RUN_ID}`);

      // Test with --out
      const tmpFile = path.join(os.tmpdir(), `sdap-report-${Date.now()}.md`);
      const ioFile = createTestIo();
      const codeFile = await runCli(["report", RUN_ID, "--format", "md", "--out", tmpFile], ioFile);

      expect(codeFile).toBe(EXIT_CODES.PASS);
      const content = await fs.readFile(tmpFile, "utf-8");
      expect(content).toContain(`# SDAP Audit Report - Run ${RUN_ID}`);
      await fs.unlink(tmpFile).catch(() => {});
    });

    it("evaluates gate command passing and failing", async () => {
      let shouldPass = true;
      server.on("GET", `/projects/${PROJECT_ID}/gate`, (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            pass: shouldPass,
            mode: "enforce",
            violations: shouldPass
              ? []
              : [{ findingId: FINDING_ID, fingerprint: "fp_1", severity: "high" }],
            excepted: [],
            evaluatedAt: new Date().toISOString(),
          }),
        );
      });

      // Pass
      const ioPass = createTestIo();
      const codePass = await runCli(["gate", "--project", PROJECT_ID], ioPass);
      expect(codePass).toBe(EXIT_CODES.PASS);
      expect(ioPass.getStdout()).toContain("PASSED");

      // Fail
      shouldPass = false;
      const ioFail = createTestIo();
      const codeFail = await runCli(["gate", "--project", PROJECT_ID], ioFail);
      expect(codeFail).toBe(EXIT_CODES.GATE_FAILED);
      expect(ioFail.getStdout()).toContain("FAILED");
      expect(ioFail.getStdout()).toContain(`Finding ${FINDING_ID}`);
    });
  });

  describe("Usage and configuration errors (exit code 3)", () => {
    it("exits with 3 on missing project", async () => {
      const io = createTestIo();
      delete io.env.SDAP_PROJECT;
      const code = await runCli(["run"], io);
      expect(code).toBe(EXIT_CODES.USAGE_ERROR);
      expect(io.getStderr()).toContain("Missing required option: --project");
    });

    it("exits with 3 on invalid mode", async () => {
      const io = createTestIo();
      const code = await runCli(["run", "--project", PROJECT_ID, "--mode", "unknown_mode"], io);
      expect(code).toBe(EXIT_CODES.USAGE_ERROR);
      expect(io.getStderr()).toContain('Invalid --mode: "unknown_mode"');
    });

    it("exits with 3 on invalid repeat", async () => {
      const io = createTestIo();
      const code = await runCli(["run", "--project", PROJECT_ID, "--repeat", "15"], io);
      expect(code).toBe(EXIT_CODES.USAGE_ERROR);
      expect(io.getStderr()).toContain('Invalid --repeat: "15"');
    });

    it("exits with 3 on missing status run-id", async () => {
      const io = createTestIo();
      const code = await runCli(["status"], io);
      expect(code).toBe(EXIT_CODES.USAGE_ERROR);
      expect(io.getStderr()).toContain("Missing required argument: <run-id>");
    });

    it("exits with 3 on unknown command", async () => {
      const io = createTestIo();
      const code = await runCli(["nonexistent-command"], io);
      expect(code).toBe(EXIT_CODES.USAGE_ERROR);
      expect(io.getStderr()).toContain('Unknown command "nonexistent-command"');
    });

    it("exits with 3 when no arguments provided", async () => {
      const io = createTestIo();
      const code = await runCli([], io);
      expect(code).toBe(EXIT_CODES.USAGE_ERROR);
      expect(io.getStderr()).toContain("sdap - SecDevOps Audit Platform CLI");
    });
  });
});
