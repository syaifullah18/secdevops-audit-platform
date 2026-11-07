import { spawn } from "node:child_process";
import type {
  SandboxExecRequest,
  SandboxExecResult,
  SandboxPolicy,
  SandboxRunner,
} from "@sdap/core";
import { validateSandboxExecRequest, validateSandboxPolicy } from "./validation.js";

const DEFAULT_SYSTEM_PATH = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin";

/**
 * Runner that executes commands directly on the host without OS isolation.
 * Used for local development only. Because enforcing is false, the orchestrator
 * keeps execution-dependent leads as needs_validation.
 */
export class NoSandboxRunner implements SandboxRunner {
  readonly kind = "none";
  readonly enforcing = false;

  async preflight(policy?: SandboxPolicy): Promise<{ ok: boolean; message: string | null }> {
    if (policy) {
      try {
        validateSandboxPolicy(policy);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, message: msg };
      }
    }
    return { ok: true, message: null };
  }

  async exec(req: SandboxExecRequest): Promise<SandboxExecResult> {
    const policy = validateSandboxExecRequest(req);

    const startTime = Date.now();
    const command = req.argv[0];
    const args = req.argv.slice(1);

    if (!command) {
      return {
        exitCode: 1,
        killedBy: null,
        stdout: "",
        stderr: "No command specified in argv",
        durationMs: 0,
      };
    }

    // Sanitize environment: strictly policy.env, with minimal PATH if not provided
    const sanitizedEnv: NodeJS.ProcessEnv = {
      ...policy.env,
    };
    if (!sanitizedEnv.PATH) {
      sanitizedEnv.PATH = process.env.PATH || DEFAULT_SYSTEM_PATH;
    }

    const workingDir = req.cwd ?? policy.targetDir;

    return new Promise<SandboxExecResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let killedBy: "timeout" | "abort" | "oom" | null = null;
      let exitCode: number | null = null;
      let timeoutHandle: NodeJS.Timeout | null = null;

      const child = spawn(command, args, {
        cwd: workingDir,
        env: sanitizedEnv,
        stdio: "pipe",
      });

      // Handle stdin
      if (req.stdin !== undefined) {
        child.stdin.write(req.stdin);
        child.stdin.end();
      } else {
        child.stdin.end();
      }

      // Handle stdout
      child.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stdout += text;
        req.onStdout?.(text);
      });

      // Handle stderr
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stderr += text;
        req.onStderr?.(text);
      });

      // Handle timeout
      const timeoutMs = policy.timeoutSec * 1000;
      timeoutHandle = setTimeout(() => {
        killedBy = "timeout";
        try {
          child.kill("SIGKILL");
        } catch {
          // Process might already be dead
        }
      }, timeoutMs);

      // Handle abort signal
      const onAbort = () => {
        killedBy = "abort";
        try {
          child.kill("SIGKILL");
        } catch {
          // Process might already be dead
        }
      };

      if (req.signal) {
        if (req.signal.aborted) {
          onAbort();
        } else {
          req.signal.addEventListener("abort", onAbort, { once: true });
        }
      }

      child.on("error", (err: Error) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        if (req.signal) {
          req.signal.removeEventListener("abort", onAbort);
        }
        stderr += `\nFailed to start process: ${err.message}`;
        resolve({
          exitCode: 1,
          killedBy,
          stdout,
          stderr,
          durationMs: Date.now() - startTime,
        });
      });

      child.on("close", (code: number | null) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        if (req.signal) {
          req.signal.removeEventListener("abort", onAbort);
        }
        exitCode = code;
        resolve({
          exitCode,
          killedBy,
          stdout,
          stderr,
          durationMs: Date.now() - startTime,
        });
      });
    });
  }
}
