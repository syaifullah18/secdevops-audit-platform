import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  SandboxExecRequest,
  SandboxExecResult,
  SandboxPolicy,
  SandboxRunner,
} from "@sdap/core";
import { SandboxExecutionError, SandboxValidationError } from "./errors.js";
import { BoundedOutput, DEFAULT_MAX_OUTPUT_BYTES } from "./output.js";
import {
  CONTAINER_TARGET_DIR,
  CONTAINER_TMP_DIR,
  hasControlCharacters,
  resolveHostMounts,
  validateSandboxExecRequest,
  validateSandboxPolicy,
  type ParsedSandboxPolicy,
  type ResolvedMount,
  type ResolvedMounts,
} from "./validation.js";

export interface DockerSandboxRunnerOptions {
  /** Docker-compatible CLI (docker, or podman's docker shim). */
  dockerPath?: string;
  /** Sandbox image. Must already be present locally (`--pull never`). */
  image?: string;
  /** OCI runtime, e.g. "runsc" for gVisor. Verified by a kernel probe before use. */
  runtime?: string;
  /** Non-root uid[:gid] inside the container. Root (0) is refused. */
  user?: string;
  pidsLimit?: number;
  /** Absolute path to a seccomp profile. If set but missing, preflight/exec fail closed. */
  seccompProfile?: string;
  tmpfsSizeMb?: number;
  /** Sidecar image built from deploy/sandbox/egress-proxy. */
  egressProxyImage?: string;
  /** Per-stream output cap (bytes). */
  maxOutputBytes?: number;
  /** Environment for the docker CLI itself (DOCKER_HOST etc.). Never reaches the container. */
  dockerEnv?: NodeJS.ProcessEnv;
}

export interface EgressAttachment {
  /** Per-run `--internal` network the sandbox is attached to. */
  network: string;
  /** e.g. http://10.89.1.2:3128 (the sidecar's address on the internal network). */
  proxyUrl: string;
}

const EGRESS_PROXY_PORT = 3128;
const LABEL = "io.sdap.sandbox=1";
const IMAGE_REF = /^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/;
const RUNTIME_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const USER_SPEC = /^([0-9]+)(?::([0-9]+))?$/;
const CLI_TIMEOUT_MS = 30_000;

/**
 * Hardened sandbox runner backed by Docker (or Podman via its Docker-compatible API).
 *
 * - `kind: "gvisor"` when `runtime: "runsc"`; exec refuses to run unless a probe has
 *   shown the container really runs on a non-host kernel (Podman's compat API silently
 *   ignores `--runtime`, so trusting the flag would make `kind` a lie).
 * - Egress: `--network none` for an empty allowlist; otherwise the container is attached
 *   only to a per-run `--internal` network whose sole other member is the allowlist
 *   proxy sidecar. Proxy env vars are a convenience; the network is the enforcement.
 */
export class DockerSandboxRunner implements SandboxRunner {
  readonly enforcing = true;
  readonly dockerPath: string;
  readonly image: string;
  readonly runtime?: string;
  readonly user: string;
  readonly pidsLimit: number;
  readonly seccompProfile?: string;
  readonly tmpfsSizeMb: number;
  readonly egressProxyImage: string;
  readonly maxOutputBytes: number;
  private readonly dockerEnv: NodeJS.ProcessEnv;
  private runtimeVerified: Promise<string | null> | null = null;

  constructor(options: DockerSandboxRunnerOptions = {}) {
    this.dockerPath = options.dockerPath ?? "docker";
    this.image = options.image ?? "alpine:3.22";
    this.runtime = options.runtime;
    this.user = options.user ?? "65534:65534";
    this.pidsLimit = options.pidsLimit ?? 256;
    this.seccompProfile = options.seccompProfile;
    this.tmpfsSizeMb = options.tmpfsSizeMb ?? 64;
    this.egressProxyImage = options.egressProxyImage ?? "sdap-egress-proxy:latest";
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.dockerEnv = options.dockerEnv ?? process.env;

    // Values that end up as docker CLI arguments: refuse anything that could be parsed as
    // an option (leading "-") or carry whitespace/control characters.
    for (const [field, value] of [
      ["image", this.image],
      ["egressProxyImage", this.egressProxyImage],
    ] as const) {
      if (!IMAGE_REF.test(value)) {
        throw new SandboxValidationError(`${field} is not a valid image reference: "${value}"`);
      }
    }
    if (this.runtime !== undefined && !RUNTIME_NAME.test(this.runtime)) {
      throw new SandboxValidationError(`runtime is not a valid name: "${this.runtime}"`);
    }
    const userMatch = USER_SPEC.exec(this.user);
    if (!userMatch || Number(userMatch[1]) === 0) {
      throw new SandboxValidationError(
        `user must be a numeric non-root uid[:gid], got: "${this.user}"`,
      );
    }
    for (const [field, value] of [
      ["pidsLimit", this.pidsLimit],
      ["tmpfsSizeMb", this.tmpfsSizeMb],
      ["maxOutputBytes", this.maxOutputBytes],
    ] as const) {
      if (!Number.isInteger(value) || value <= 0) {
        throw new SandboxValidationError(`${field} must be a positive integer, got: ${value}`);
      }
    }
    if (this.seccompProfile !== undefined) {
      if (
        !path.isAbsolute(this.seccompProfile) ||
        hasControlCharacters(this.seccompProfile) ||
        this.seccompProfile.includes(",")
      ) {
        throw new SandboxValidationError("seccompProfile must be an absolute path");
      }
    }
  }

  get kind(): string {
    return this.runtime === "runsc" ? "gvisor" : "docker-hardened";
  }

  private docker(args: string[], timeout = CLI_TIMEOUT_MS): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        this.dockerPath,
        args,
        { timeout, env: this.dockerEnv, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            reject(
              new SandboxExecutionError(
                `${this.dockerPath} ${args[0] ?? ""} failed: ${String(stderr || err.message).trim()}`,
              ),
            );
          } else {
            resolve(stdout);
          }
        },
      );
    });
  }

  private async imagePresent(image: string): Promise<boolean> {
    try {
      await this.docker(["image", "inspect", "--format", "{{.Id}}", image]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * With a custom runtime, run a probe container and compare its kernel release with the
   * daemon's. Identical => the runtime was not applied (e.g. Podman compat ignoring
   * `--runtime`) and we must not claim stronger isolation than we have.
   * Resolves to null on success, or an error message.
   */
  private verifyRuntime(): Promise<string | null> {
    if (!this.runtime) return Promise.resolve(null);
    this.runtimeVerified ??= (async () => {
      try {
        const probe = (runtime?: string) =>
          this.docker([
            "run",
            "--rm",
            "--pull",
            "never",
            "--network",
            "none",
            ...(runtime ? ["--runtime", runtime] : []),
            "--user",
            this.user,
            this.image,
            "uname",
            "-r",
          ]).then((s) => s.trim());
        // Engine-agnostic: compare against a container on the engine's default runtime,
        // which shares the host kernel.
        const hostKernel = await probe();
        const probeKernel = await probe(this.runtime);
        if (!probeKernel || probeKernel === hostKernel) {
          return (
            `runtime "${this.runtime}" was requested but the probe container ran on the host ` +
            `kernel (${hostKernel}); the engine ignored or lacks the runtime`
          );
        }
        return null;
      } catch (err) {
        return `runtime "${this.runtime}" probe failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    })();
    const result = this.runtimeVerified;
    // Cache success only, so a transient engine error does not stick forever.
    void result.then((err) => {
      if (err !== null && this.runtimeVerified === result) this.runtimeVerified = null;
    });
    return result;
  }

  /**
   * Verifies the CLI/daemon, images, seccomp profile and (for gVisor) that the runtime is
   * really applied. If a policy is passed it is validated, and the egress proxy image is
   * required when the policy allows egress.
   */
  async preflight(policy?: SandboxPolicy): Promise<{ ok: boolean; message: string | null }> {
    let parsed: ParsedSandboxPolicy | undefined;
    if (policy) {
      try {
        parsed = validateSandboxPolicy(policy);
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    }
    if (this.seccompProfile && !fs.existsSync(this.seccompProfile)) {
      return { ok: false, message: `seccomp profile not found: ${this.seccompProfile}` };
    }
    try {
      await this.docker(["info"], 10_000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `Docker daemon unreachable or docker CLI failed: ${msg}` };
    }
    if (!(await this.imagePresent(this.image))) {
      return { ok: false, message: `sandbox image not present locally: ${this.image}` };
    }
    const runtimeError = await this.verifyRuntime();
    if (runtimeError) {
      return { ok: false, message: runtimeError };
    }
    if (!(await this.imagePresent(this.egressProxyImage))) {
      const msg =
        `egress proxy image not present: ${this.egressProxyImage} ` +
        `(docker build -t ${this.egressProxyImage} deploy/sandbox/egress-proxy)`;
      if (!parsed || parsed.egressAllowlist.length > 0) {
        // Without a policy we cannot know whether egress will be needed; report but pass,
        // exec will fail closed if it is.
        return parsed ? { ok: false, message: msg } : { ok: true, message: msg };
      }
    }
    return { ok: true, message: null };
  }

  /**
   * Constructs the `docker run` argument array. Pure; exposed for unit tests.
   */
  buildDockerArgv(
    req: SandboxExecRequest,
    policy: ParsedSandboxPolicy,
    mounts: ResolvedMounts,
    containerName: string,
    egress?: EgressAttachment,
  ): string[] {
    const mountArg = (m: ResolvedMount) =>
      `type=bind,source=${m.hostPath},target=${m.containerPath}${m.readOnly ? ",readonly" : ""}`;

    const argv: string[] = [
      "run",
      "--name",
      containerName,
      "--label",
      LABEL,
      "--pull",
      "never",
      "--init",
      "--hostname",
      "sandbox",
      "--ipc",
      "private",
      "--read-only",
      "--tmpfs",
      `${CONTAINER_TMP_DIR}:rw,noexec,nosuid,nodev,size=${this.tmpfsSizeMb}m`,
      "--mount",
      mountArg(mounts.target),
      "--mount",
      mountArg(mounts.output),
    ];
    for (const m of mounts.extra) {
      argv.push("--mount", mountArg(m));
    }

    argv.push("--cap-drop", "ALL");
    argv.push("--security-opt", "no-new-privileges");
    if (this.seccompProfile) {
      argv.push("--security-opt", `seccomp=${this.seccompProfile}`);
    }

    argv.push("--pids-limit", String(this.pidsLimit));
    argv.push("--cpus", String(policy.cpus));
    argv.push("--memory", `${policy.memoryMb}m`);
    // Equal to --memory: no swap, so the memory limit is a real limit.
    argv.push("--memory-swap", `${policy.memoryMb}m`);
    argv.push("--user", this.user);
    if (this.runtime) {
      argv.push("--runtime", this.runtime);
    }
    argv.push("--workdir", req.cwd ?? CONTAINER_TARGET_DIR);

    if (egress) {
      argv.push("--network", egress.network);
    } else {
      argv.push("--network", "none");
    }

    // Environment strictly from policy.env; always KEY=value (a bare KEY would make the
    // docker CLI copy the value from its own environment).
    for (const [key, value] of Object.entries(policy.env)) {
      argv.push("--env", `${key}=${value}`);
    }
    if (egress) {
      for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"]) {
        argv.push("--env", `${key}=${egress.proxyUrl}`);
        argv.push("--env", `${key.toLowerCase()}=${egress.proxyUrl}`);
      }
      argv.push("--env", "NO_PROXY=", "--env", "no_proxy=");
    }

    if (req.stdin !== undefined) {
      argv.push("--interactive");
    }

    argv.push(this.image);
    argv.push(...req.argv);
    return argv;
  }

  private async removeContainer(name: string, retries = 3): Promise<void> {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        await this.docker(["rm", "-f", name], 15_000);
        return;
      } catch {
        if (attempt < retries - 1) {
          await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
        }
      }
    }
  }

  private async removeNetwork(network: string, retries = 5): Promise<void> {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        await this.docker(["network", "rm", network], 15_000);
        return;
      } catch {
        try {
          const inspectOut = await this.docker(
            [
              "network",
              "inspect",
              "--format",
              "{{range $k, $v := .Containers}}{{$k}} {{end}}",
              network,
            ],
            5_000,
          );
          const lingering = inspectOut.trim().split(/\s+/).filter(Boolean);
          for (const c of lingering) {
            await this.docker(["network", "disconnect", "-f", network, c], 5_000).catch(
              () => undefined,
            );
          }
        } catch {
          // Ignore inspect error
        }
        if (attempt < retries - 1) {
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        }
      }
    }
  }

  async exec(req: SandboxExecRequest): Promise<SandboxExecResult> {
    const policy = validateSandboxExecRequest(req);
    const startTime = Date.now();
    if (req.signal?.aborted) {
      return { exitCode: null, killedBy: "abort", stdout: "", stderr: "", durationMs: 0 };
    }

    if (this.seccompProfile && !fs.existsSync(this.seccompProfile)) {
      throw new SandboxExecutionError(`seccomp profile not found: ${this.seccompProfile}`);
    }
    const runtimeError = await this.verifyRuntime();
    if (runtimeError) {
      throw new SandboxExecutionError(runtimeError);
    }

    const mounts = resolveHostMounts(policy, this.dockerEnv);
    if (mounts.outputCreated) {
      // A directory we just created ourselves: open it up so the unprivileged sandbox uid
      // can write. Pre-existing directories are never chmod-ed; the caller owns their mode.
      fs.chmodSync(mounts.output.hostPath, 0o777);
    }

    const id = randomUUID();
    const containerName = `sdap-sbx-${id}`;
    const cleanups: (() => Promise<unknown>)[] = [];

    try {
      let egress: EgressAttachment | undefined;
      if (policy.egressAllowlist.length > 0) {
        egress = await this.startEgressSidecar(id, policy.egressAllowlist, cleanups, req.signal);
      }
      if (req.signal?.aborted) {
        return {
          exitCode: null,
          killedBy: "abort",
          stdout: "",
          stderr: "",
          durationMs: Date.now() - startTime,
        };
      }
      const argv = this.buildDockerArgv(req, policy, mounts, containerName, egress);
      return await this.runContainer(argv, containerName, policy, req, startTime);
    } catch (err) {
      if (req.signal?.aborted) {
        return {
          exitCode: null,
          killedBy: "abort",
          stdout: "",
          stderr: "",
          durationMs: Date.now() - startTime,
        };
      }
      throw err;
    } finally {
      await this.removeContainer(containerName);
      for (const cleanup of cleanups.slice().reverse()) {
        await cleanup().catch(() => undefined);
      }
    }
  }

  /**
   * Creates the per-run internal network and the allowlist proxy sidecar attached to it
   * and to the engine's default (egress-capable) network.
   */
  private async startEgressSidecar(
    id: string,
    allowlist: readonly string[],
    cleanups: (() => Promise<unknown>)[],
    signal?: AbortSignal,
  ): Promise<EgressAttachment> {
    if (!(await this.imagePresent(this.egressProxyImage))) {
      throw new SandboxExecutionError(
        `egress proxy image not present: ${this.egressProxyImage}; ` +
          `build it with: docker build -t ${this.egressProxyImage} deploy/sandbox/egress-proxy`,
      );
    }
    const network = `sdap-net-${id}`;
    const proxyName = `sdap-egress-${id}`;

    await this.docker(["network", "create", "--internal", "--label", LABEL, network]);
    cleanups.push(() => this.removeNetwork(network));

    await this.docker([
      "create",
      "--name",
      proxyName,
      "--label",
      LABEL,
      "--pull",
      "never",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--pids-limit",
      "64",
      "--memory",
      "128m",
      "--memory-swap",
      "128m",
      "--cpus",
      "0.5",
      // Lets an operator allowlist the host (e.g. a local model gateway) on Linux Docker,
      // where this name is not defined by default. Still subject to the allowlist.
      "--add-host",
      "host.docker.internal:host-gateway",
      "--env",
      `ALLOWLIST=${allowlist.join(",")}`,
      "--env",
      `PORT=${EGRESS_PROXY_PORT}`,
      "--env",
      "HOST=0.0.0.0",
      this.egressProxyImage,
    ]);
    cleanups.push(() => this.removeContainer(proxyName));

    // Start on the default network first and wait until it is listening: the sidecar
    // snapshots its resolvers at startup, and attaching the internal network rewrites
    // resolv.conf to a resolver that cannot answer external names.
    await this.docker(["start", proxyName]);
    const deadline = Date.now() + 15_000;
    for (;;) {
      if (signal?.aborted) {
        throw new SandboxExecutionError("execution aborted while waiting for egress proxy");
      }
      const logs = await this.docker(["logs", proxyName]).catch(() => "");
      if (logs.includes("Listening on")) break;
      const state = (
        await this.docker(["inspect", "--format", "{{.State.Status}}", proxyName]).catch(() => "")
      ).trim();
      if (state === "exited" || state === "dead" || Date.now() > deadline) {
        throw new SandboxExecutionError(
          `egress proxy sidecar failed to start (state=${state || "unknown"}): ${logs.trim()}`,
        );
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    await this.docker(["network", "connect", network, proxyName]);

    const networksJson = await this.docker([
      "inspect",
      "--format",
      "{{json .NetworkSettings.Networks}}",
      proxyName,
    ]);
    const networks = JSON.parse(networksJson) as Record<string, { IPAddress?: string }>;
    const ip = networks[network]?.IPAddress;
    if (!ip) {
      throw new SandboxExecutionError(
        `could not determine egress proxy address on network ${network}`,
      );
    }
    return { network, proxyUrl: `http://${ip}:${EGRESS_PROXY_PORT}` };
  }

  private runContainer(
    argv: string[],
    containerName: string,
    policy: ParsedSandboxPolicy,
    req: SandboxExecRequest,
    startTime: number,
  ): Promise<SandboxExecResult> {
    return new Promise((resolve) => {
      const stdout = new BoundedOutput(this.maxOutputBytes, req.onStdout);
      const stderr = new BoundedOutput(this.maxOutputBytes, req.onStderr);
      let killedBy: SandboxExecResult["killedBy"] = null;
      let settled = false;

      const child = spawn(this.dockerPath, argv, { stdio: "pipe", env: this.dockerEnv });

      const kill = (reason: "timeout" | "abort") => {
        if (settled) return;
        killedBy ??= reason;
        child.kill("SIGKILL");
      };
      const timer = setTimeout(() => kill("timeout"), policy.timeoutSec * 1000);
      const onAbort = () => kill("abort");
      req.signal?.addEventListener("abort", onAbort, { once: true });

      const finish = async (exitCode: number | null, extraErr?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        req.signal?.removeEventListener("abort", onAbort);
        if (extraErr) stderr.push(Buffer.from(`\n${extraErr}`));
        if (killedBy === null && exitCode === 137) {
          const oom = await this.docker(
            ["inspect", "--format", "{{.State.OOMKilled}}", containerName],
            5_000,
          ).catch(() => "");
          if (oom.trim() === "true") killedBy = "oom";
        }
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
        // EPIPE when the container exits before consuming stdin.
      });
      if (req.stdin !== undefined) {
        child.stdin.end(req.stdin);
      } else {
        child.stdin.end();
      }

      child.on("error", (err) => {
        void finish(null, `Docker process execution failed: ${err.message}`);
      });
      child.on("close", (code) => {
        void finish(code);
      });
    });
  }
}
