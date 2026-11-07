import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_SYSTEM_PATH, NoSandboxRunner } from "../src/no-sandbox.js";

describe("NoSandboxRunner", () => {
  const runner = new NoSandboxRunner();
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sdap-nosbx-")));
  const targetDir = path.join(base, "target");
  const outputDir = path.join(base, "out");
  fs.mkdirSync(targetDir);
  fs.mkdirSync(outputDir);
  const policy = { targetDir, outputDir };
  const node = process.execPath;

  afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

  it("reports kind=none and enforcing=false (never claims isolation)", () => {
    expect(runner.kind).toBe("none");
    expect(runner.enforcing).toBe(false);
  });

  it("preflight passes with a non-enforcing warning, and validates policies", async () => {
    const result = await runner.preflight();
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/not enforcing/);

    const invalid = await runner.preflight({ targetDir: "relative/path", outputDir });
    expect(invalid.ok).toBe(false);
    expect(invalid.message).toContain("targetDir must be an absolute path");
  });

  it("executes a basic command and captures stdout/stderr", async () => {
    const result = await runner.exec({
      argv: [node, "-e", "console.log('stdout-test'); console.error('stderr-test');"],
      policy,
    });
    expect(result.exitCode).toBe(0);
    expect(result.killedBy).toBeNull();
    expect(result.stdout).toContain("stdout-test");
    expect(result.stderr).toContain("stderr-test");
  });

  it("passes only policy.env plus a fixed PATH (host PATH is not inherited)", async () => {
    process.env.SDAP_HOST_SECRET_VAR = "leak_attempt";
    try {
      const result = await runner.exec({
        argv: [node, "-e", "console.log(JSON.stringify(process.env))"],
        policy: { ...policy, env: { POLICY_VAR: "expected_value" } },
      });
      expect(result.exitCode).toBe(0);
      const env = JSON.parse(result.stdout.trim()) as Record<string, string>;
      expect(env.SDAP_HOST_SECRET_VAR).toBeUndefined();
      expect(env.POLICY_VAR).toBe("expected_value");
      expect(env.PATH).toBe(DEFAULT_SYSTEM_PATH);
      expect(env.HOME).toBeUndefined();
    } finally {
      delete process.env.SDAP_HOST_SECRET_VAR;
    }
  });

  it("maps /target and /out cwd onto the host directories and refuses others", async () => {
    const pwd = [node, "-e", "console.log(process.cwd())"];
    const t = await runner.exec({ argv: pwd, policy });
    expect(t.stdout.trim()).toBe(targetDir);
    const o = await runner.exec({ argv: pwd, cwd: "/out", policy });
    expect(o.stdout.trim()).toBe(outputDir);
    await expect(runner.exec({ argv: pwd, cwd: "/etc", policy })).rejects.toThrow(
      /only supports cwd/,
    );
  });

  it("pipes stdin to the child process", async () => {
    const result = await runner.exec({
      argv: [node, "-e", "process.stdin.pipe(process.stdout)"],
      stdin: "hello from stdin stream",
      policy,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello from stdin stream");
  });

  it("caps captured output", async () => {
    const small = new NoSandboxRunner({ maxOutputBytes: 1024 });
    const result = await small.exec({
      argv: [node, "-e", "process.stdout.write('x'.repeat(100000))"],
      policy,
    });
    expect(result.stdout.startsWith("x".repeat(1024))).toBe(true);
    expect(result.stdout).toContain("output truncated at 1024 bytes");
    expect(result.stdout.length).toBeLessThan(1200);
  });

  it("kills the whole process group on timeout (no orphaned grandchildren)", async () => {
    const marker = path.join(outputDir, "grandchild-survived");
    // The child spawns a detached-from-stdio grandchild that writes a marker after 2s.
    const grandchild = `setTimeout(()=>require("fs").writeFileSync(${JSON.stringify(marker)},"x"),2000)`;
    const script =
      `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(grandchild)}], { stdio: "ignore" });` +
      "setTimeout(() => {}, 60000);";
    const started = Date.now();
    const result = await runner.exec({
      argv: [node, "-e", script],
      policy: { ...policy, timeoutSec: 1 },
    });
    expect(result.killedBy).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(5000);
    await new Promise((r) => setTimeout(r, 2500));
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("terminates process on abort signal and sets killedBy=abort", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const result = await runner.exec({
      argv: [node, "-e", "setTimeout(() => {}, 10000)"],
      signal: controller.signal,
      policy: { ...policy, timeoutSec: 10 },
    });
    expect(result.killedBy).toBe("abort");
  });

  it("does not start at all when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runner.exec({
      argv: [node, "-e", "require('fs').writeFileSync('/should/not/run', 'x')"],
      signal: controller.signal,
      policy,
    });
    expect(result).toMatchObject({ exitCode: null, killedBy: "abort" });
  });
});
