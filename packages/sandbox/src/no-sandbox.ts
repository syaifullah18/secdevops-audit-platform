import { spawn } from "node:child_process";
import path from "node:path";
import type {
  SandboxExecRequest,
  SandboxExecResult,
  SandboxPolicy,
  SandboxRunner,
} from "@sdap/core";
import { SandboxValidationError } from "./errors.js";
import { BoundedOutput, DEFAULT_MAX_OUTPUT_BYTES } from "./output.js";
import {
  CONTAINER_OUTPUT_DIR,
  CONTAINER_TARGET_DIR,
  isSameOrInside,
  validateSandboxExecRequest,
  validateSandboxPolicy,
} from "./validation.js";

/** Fixed PATH used when policy.env does not set one; the host PATH is not inherited. */
export const DEFAULT_SYSTEM_PATH = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

/**
 * Runs commands directly on the host WITHOUT isolation. Local development only.
 *
 * `enforcing` is false: nothing here is OS-enforced. Network, filesystem writes, CPU,
 * memory and pids are NOT restricted. What it does do:
 * - env is exactly policy.env (+ a fixed PATH if absent); nothing inherited from the host;
 * - the container-style cwd (/target..., /out...) is mapped onto targetDir/outputDir;
 * - timeout/abort SIGKILL the whole process group, not just the direct child.
 */
export class NoSandboxRunner implements SandboxRunner {
  readonly kind = "none";
  readonly enforcing = false;

  constructor(private readonly options: { maxOutputBytes?: number } = {}) {}

  async preflight(policy?: SandboxPolicy): Promise<{ ok: boolean; message: string | null }> {
    if (policy) {
      try {
        validateSandboxPolicy(policy);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, message: msg };
      }
    }
    return {
      ok: true,
      message: "NoSandboxRunner is not enforcing: no network, filesystem or resource isolation",
    };
  }

  /** Maps a sandbox-style cwd onto the host directories; other paths are refused. */
  private hostCwd(cwd: string | undefined, targetDir: string, outputDir: string): string {
    const c = path.posix.normalize(cwd ?? CONTAINER_TARGET_DIR);
    if (isSameOrInside(c, CONTAINER_TARGET_DIR)) {
      return path.join(targetDir, path.posix.relative(CONTAINER_TARGET_DIR, c));
    }
    if (isSameOrInside(c, CONTAINER_OUTPUT_DIR)) {
      return path.join(outputDir, path.posix.relative(CONTAINER_OUTPUT_DIR, c));
    }
    throw new SandboxValidationError(
      `NoSandboxRunner only supports cwd under ${CONTAINER_TARGET_DIR} or ${CONTAINER_OUTPUT_DIR}, got: "${c}"`,
    );
  }

  async exec(req: SandboxExecRequest): Promise<SandboxExecResult> {
    const policy = validateSandboxExecRequest(req);
    const startTime = Date.now();
    const [command, ...args] = req.argv;
    if (req.signal?.aborted) {
      return { exitCode: null, killedBy: "abort", stdout: "", stderr: "", durationMs: 0 };
    }

    const env: NodeJS.ProcessEnv = { ...policy.env };
    env.PATH ??= DEFAULT_SYSTEM_PATH;
    const cwd = this.hostCwd(req.cwd, policy.targetDir, policy.outputDir);
    const maxBytes = this.options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

    return new Promise<SandboxExecResult>((resolve) => {
      const stdout = new BoundedOutput(maxBytes, req.onStdout);
      const stderr = new BoundedOutput(maxBytes, req.onStderr);
      let killedBy: SandboxExecResult["killedBy"] = null;
      let settled = false;

      const child = spawn(command as string, args, {
        cwd,
        env,
        stdio: "pipe",
        // Own process group so timeout/abort can kill grandchildren too.
        detached: true,
      });

      const kill = (reason: "timeout" | "abort") => {
        if (settled) return;
        killedBy ??= reason;
        try {
          if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      };
      const timer = setTimeout(() => kill("timeout"), policy.timeoutSec * 1000);
      const onAbort = () => kill("abort");
      req.signal?.addEventListener("abort", onAbort, { once: true });

      const finish = (exitCode: number | null, extraErr?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        req.signal?.removeEventListener("abort", onAbort);
        if (extraErr) stderr.push(Buffer.from(`\n${extraErr}`));
        resolve({
          exitCode,
          killedBy,
          stdout: stdout.value(),
          stderr: stderr.value(),
          durationMs: Date.now() - startTime,
        });
      };

      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.stdin.on("error", () => {
        // EPIPE when the process exits before consuming stdin.
      });
      if (req.stdin !== undefined) {
        child.stdin.end(req.stdin);
      } else {
        child.stdin.end();
      }

      child.on("error", (err) => finish(null, `Failed to start process: ${err.message}`));
      child.on("close", (code) => finish(code));
    });
  }
}
