import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { promisify } from "node:util";
import type {
  SandboxExecRequest,
  SandboxExecResult,
  SandboxPolicy,
  SandboxRunner,
} from "@sdap/core";
import { EgressProxy } from "./proxy.js";
import { validateSandboxExecRequest, validateSandboxPolicy } from "./validation.js";

const execFileAsync = promisify(execFile);

export interface DockerSandboxRunnerOptions {
  dockerPath?: string;
  image?: string;
  runtime?: string;
  user?: string;
  pidsLimit?: number;
  seccompProfile?: string;
  proxyHost?: string;
  proxyPort?: number;
}

/**
 * Hardened sandbox runner backed by Docker (or Podman with Docker CLI compatibility).
 * When runtime is "runsc", provides gVisor kernel-level isolation (kind: "gvisor").
 * Otherwise provides Docker hardened container isolation (kind: "docker-hardened").
 */
export class DockerSandboxRunner implements SandboxRunner {
  readonly enforcing = true;
  readonly dockerPath: string;
  readonly image: string;
  readonly runtime?: string;
  readonly user: string;
  readonly pidsLimit: number;
  readonly seccompProfile?: string;
  readonly proxyHost: string;
  readonly proxyPort?: number;

  constructor(options: DockerSandboxRunnerOptions = {}) {
    this.dockerPath = options.dockerPath ?? "docker";
    this.image = options.image ?? "alpine:3.22";
    this.runtime = options.runtime;
    this.user = options.user ?? "65534:65534";
    this.pidsLimit = options.pidsLimit ?? 256;
    this.seccompProfile = options.seccompProfile;
    this.proxyHost = options.proxyHost ?? "host.docker.internal";
    this.proxyPort = options.proxyPort;
  }

  get kind(): string {
    return this.runtime === "runsc" ? "gvisor" : "docker-hardened";
  }

  /**
   * Verifies the Docker runtime is installed, daemon is reachable, and the
   * requested runtime (e.g. gVisor runsc) is available. If a policy is passed,
   * also validates that the policy configuration is sound and secure.
   */
  async preflight(policy?: SandboxPolicy): Promise<{ ok: boolean; message: string | null }> {
    if (policy) {
      try {
        validateSandboxPolicy(policy);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, message: msg };
      }
    }

    try {
      const { stdout } = await execFileAsync(this.dockerPath, ["info"], {
        timeout: 5000,
        env: process.env,
      });

      if (this.runtime === "runsc") {
        // Check if runsc is listed in available runtimes
        if (!stdout.includes("runsc")) {
          return {
            ok: false,
            message: "gVisor runtime (runsc) is not registered in Docker/Podman daemon",
          };
        }
      }

      return { ok: true, message: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        message: `Docker daemon unreachable or docker CLI failed: ${msg}`,
      };
    }
  }

  /**
   * Constructs the docker run command-line argument array.
   * Exposed for deterministic unit testing of argv construction.
   */
  buildDockerArgv(req: SandboxExecRequest, containerName: string, proxyPort?: number): string[] {
    const policy = req.policy;
    const realTargetDir = fs.existsSync(policy.targetDir)
      ? fs.realpathSync(policy.targetDir)
      : policy.targetDir;
    const realOutputDir = fs.existsSync(policy.outputDir)
      ? fs.realpathSync(policy.outputDir)
      : policy.outputDir;

    const argv: string[] = [
      "run",
      "--name",
      containerName,
      "--init",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=64m",
      "-v",
      `${realTargetDir}:/target:ro`,
      "-v",
      `${realOutputDir}:/out:rw`,
    ];

    // Read-only extra mounts
    if (policy.readOnlyMounts) {
      for (const mount of policy.readOnlyMounts) {
        const realHostPath = fs.existsSync(mount.hostPath)
          ? fs.realpathSync(mount.hostPath)
          : mount.hostPath;
        argv.push("-v", `${realHostPath}:${mount.containerPath}:ro`);
      }
    }

    // Security options
    argv.push("--cap-drop", "ALL");
    argv.push("--security-opt", "no-new-privileges");
    if (this.seccompProfile && fs.existsSync(this.seccompProfile)) {
      argv.push("--security-opt", `seccomp=${this.seccompProfile}`);
    }

    // Resource limits
    argv.push("--pids-limit", String(this.pidsLimit));
    argv.push("--cpus", String(policy.cpus ?? 2));
    argv.push("--memory", `${policy.memoryMb ?? 4096}m`);

    // Non-root user
    argv.push("--user", this.user);

    // OCI runtime (e.g. runsc for gVisor)
    if (this.runtime) {
      argv.push("--runtime", this.runtime);
    }

    // Working directory
    argv.push("-w", req.cwd ?? "/target");

    // Network & Egress proxy configuration
    if (proxyPort !== undefined) {
      argv.push("--add-host", `${this.proxyHost}:host-gateway`);
      argv.push("-e", `HTTP_PROXY=http://${this.proxyHost}:${proxyPort}`);
      argv.push("-e", `HTTPS_PROXY=http://${this.proxyHost}:${proxyPort}`);
      argv.push("-e", `ALL_PROXY=http://${this.proxyHost}:${proxyPort}`);
      argv.push("-e", `http_proxy=http://${this.proxyHost}:${proxyPort}`);
      argv.push("-e", `https_proxy=http://${this.proxyHost}:${proxyPort}`);
      argv.push("-e", `all_proxy=http://${this.proxyHost}:${proxyPort}`);
      argv.push("-e", "NO_PROXY=");
      argv.push("-e", "no_proxy=");
    } else {
      argv.push("--network", "none");
    }

    // Environment variables strictly from policy.env
    if (policy.env) {
      for (const [key, value] of Object.entries(policy.env)) {
        argv.push("-e", `${key}=${value}`);
      }
    }

    // Interactive flag if stdin is provided
    if (req.stdin !== undefined) {
      argv.push("-i");
    }

    // Container image
    argv.push(this.image);

    // Command argv
    argv.push(...req.argv);

    return argv;
  }

  async exec(req: SandboxExecRequest): Promise<SandboxExecResult> {
    const policy = validateSandboxExecRequest(req);

    const startTime = Date.now();
    const containerName = `sdap-sandbox-${randomUUID()}`;

    // Ensure outputDir exists on host and is writeable by the container user
    if (!fs.existsSync(policy.outputDir)) {
      fs.mkdirSync(policy.outputDir, { recursive: true });
    }
    try {
      fs.chmodSync(policy.outputDir, 0o777);
    } catch {
      // Best-effort chmod
    }

    let egressProxy: EgressProxy | null = null;
    let proxyPort: number | undefined;

    // Start egress proxy if egress allowlist is non-empty
    if (policy.egressAllowlist && policy.egressAllowlist.length > 0) {
      egressProxy = new EgressProxy({
        allowlist: policy.egressAllowlist,
        host: "0.0.0.0",
        port: this.proxyPort,
      });
      const addr = await egressProxy.start();
      proxyPort = addr.port;
    }

    const dockerArgv = this.buildDockerArgv(req, containerName, proxyPort);

    let stdout = "";
    let stderr = "";
    let killedBy: "timeout" | "abort" | "oom" | null = null;
    let exitCode: number | null = null;
    let timeoutHandle: NodeJS.Timeout | null = null;

    try {
      const child = spawn(this.dockerPath, dockerArgv, {
        stdio: "pipe",
        env: process.env,
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

      // Timeout management
      const timeoutMs = policy.timeoutSec * 1000;
      timeoutHandle = setTimeout(() => {
        killedBy = "timeout";
        try {
          execFile(
            this.dockerPath,
            ["kill", containerName],
            {
              env: process.env,
            },
            () => {},
          );
          child.kill("SIGKILL");
        } catch {
          // Process might already be dead
        }
      }, timeoutMs);

      // Abort signal management
      const onAbort = () => {
        killedBy = "abort";
        try {
          execFile(
            this.dockerPath,
            ["kill", containerName],
            {
              env: process.env,
            },
            () => {},
          );
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

      await new Promise<void>((resolve) => {
        child.on("error", (err: Error) => {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
          if (req.signal) {
            req.signal.removeEventListener("abort", onAbort);
          }
          stderr += `\nDocker process execution failed: ${err.message}`;
          exitCode = 1;
          resolve();
        });

        child.on("close", (code: number | null) => {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
          if (req.signal) {
            req.signal.removeEventListener("abort", onAbort);
          }
          exitCode = code;
          resolve();
        });
      });

      // Inspect container for OOM if exit code was 137 (SIGKILL) and not killed by timeout/abort
      if (killedBy === null && exitCode === 137) {
        try {
          const { stdout: inspectOut } = await execFileAsync(
            this.dockerPath,
            ["inspect", containerName, "--format", "{{.State.OOMKilled}}"],
            { timeout: 3000, env: process.env },
          );
          if (inspectOut.trim() === "true") {
            killedBy = "oom";
          }
        } catch {
          // Container may already be gone
        }
      }
    } finally {
      // Clean up container
      try {
        await execFileAsync(this.dockerPath, ["rm", "-f", containerName], {
          timeout: 5000,
          env: process.env,
        });
      } catch {
        // Container cleanup best effort
      }

      // Stop egress proxy
      if (egressProxy) {
        try {
          await egressProxy.stop();
        } catch {
          // Proxy stop best effort
        }
      }
    }

    return {
      exitCode,
      killedBy,
      stdout,
      stderr,
      durationMs: Date.now() - startTime,
    };
  }
}
