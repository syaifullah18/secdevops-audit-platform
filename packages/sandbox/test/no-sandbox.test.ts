import os from "node:os";
import { describe, expect, it } from "vitest";
import { NoSandboxRunner } from "../src/no-sandbox.js";

describe("NoSandboxRunner", () => {
  const runner = new NoSandboxRunner();
  const tmpDir = os.tmpdir();

  it("reports kind=none and enforcing=false", () => {
    expect(runner.kind).toBe("none");
    expect(runner.enforcing).toBe(false);
  });

  it("preflight returns ok: true with no policy or valid policy", async () => {
    const result = await runner.preflight();
    expect(result.ok).toBe(true);
    expect(result.message).toBeNull();

    const resultWithPolicy = await runner.preflight({
      targetDir: tmpDir,
      outputDir: tmpDir,
    });
    expect(resultWithPolicy.ok).toBe(true);
  });

  it("preflight returns ok: false when invalid policy is passed", async () => {
    const result = await runner.preflight({
      targetDir: "relative/path",
      outputDir: tmpDir,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("targetDir must be an absolute path");
  });

  it("executes a basic command and captures stdout/stderr", async () => {
    const result = await runner.exec({
      argv: ["node", "-e", "console.log('stdout-test'); console.error('stderr-test');"],
      policy: {
        targetDir: tmpDir,
        outputDir: tmpDir,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.killedBy).toBeNull();
    expect(result.stdout).toContain("stdout-test");
    expect(result.stderr).toContain("stderr-test");
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("sanitizes host environment and passes only policy.env", async () => {
    process.env.SDAP_HOST_SECRET_VAR = "leak_attempt";

    const result = await runner.exec({
      argv: [
        "node",
        "-e",
        "console.log(JSON.stringify({ hostVar: process.env.SDAP_HOST_SECRET_VAR, policyVar: process.env.POLICY_VAR }))",
      ],
      policy: {
        targetDir: tmpDir,
        outputDir: tmpDir,
        env: {
          POLICY_VAR: "expected_value",
        },
      },
    });

    delete process.env.SDAP_HOST_SECRET_VAR;

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.hostVar).toBeUndefined();
    expect(parsed.policyVar).toBe("expected_value");
  });

  it("pipes stdin to the child process", async () => {
    const result = await runner.exec({
      argv: ["node", "-e", "process.stdin.pipe(process.stdout)"],
      stdin: "hello from stdin stream",
      policy: {
        targetDir: tmpDir,
        outputDir: tmpDir,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello from stdin stream");
  });

  it("terminates process on timeout and sets killedBy=timeout", async () => {
    const result = await runner.exec({
      argv: ["node", "-e", "setTimeout(() => {}, 10000)"],
      policy: {
        targetDir: tmpDir,
        outputDir: tmpDir,
        timeoutSec: 1,
      },
    });

    expect(result.killedBy).toBe("timeout");
  });

  it("terminates process on abort signal and sets killedBy=abort", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);

    const result = await runner.exec({
      argv: ["node", "-e", "setTimeout(() => {}, 10000)"],
      signal: controller.signal,
      policy: {
        targetDir: tmpDir,
        outputDir: tmpDir,
        timeoutSec: 10,
      },
    });

    expect(result.killedBy).toBe("abort");
  });
});
