import { z } from "zod";
import type { ModelAdapter, ModelRef } from "./model.js";

/**
 * Sandbox contract. WS8 implements it (packages/sandbox); WS1 runs every agent CLI
 * and every piece of target code through it. Without an OS-enforced sandbox the
 * worker must not execute target code; such leads stay needs_validation.
 */
export const SandboxPolicy = z.object({
  /** Hostnames (optionally host:port) reachable from inside; everything else is blocked. */
  egressAllowlist: z.array(z.string().min(1)).default([]),
  /** Environment passed in; nothing is inherited from the worker process. */
  env: z.record(z.string(), z.string()).default({}),
  cpus: z.number().positive().default(2),
  memoryMb: z.number().int().positive().default(4096),
  timeoutSec: z.number().int().positive().default(3600),
  /** Mounted read-only at /target. */
  targetDir: z.string().min(1),
  /** Mounted read-write at /out; the only writable location besides a private tmp. */
  outputDir: z.string().min(1),
  /** Extra read-only mounts, e.g. the pinned skill at /skill. */
  readOnlyMounts: z
    .array(z.object({ hostPath: z.string().min(1), containerPath: z.string().min(1) }))
    .default([]),
});
export type SandboxPolicy = z.input<typeof SandboxPolicy>;

export interface SandboxExecRequest {
  /** argv; argv[0] is resolved inside the sandbox. No shell interpolation. */
  argv: readonly string[];
  /** Working directory inside the sandbox (default /target). */
  cwd?: string;
  stdin?: string;
  policy: SandboxPolicy;
  signal?: AbortSignal;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface SandboxExecResult {
  exitCode: number | null;
  /** Set when the process was killed (timeout, abort, OOM). */
  killedBy: "timeout" | "abort" | "oom" | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface SandboxRunner {
  /** e.g. "gvisor", "firecracker", "docker-hardened", "none". */
  readonly kind: string;
  /** True only when isolation is OS-enforced; "none" returns false. */
  readonly enforcing: boolean;
  /** Verifies the runtime is installed and the policy can be applied. */
  preflight(): Promise<{ ok: boolean; message: string | null }>;
  exec(req: SandboxExecRequest): Promise<SandboxExecResult>;
}

/**
 * Adapter registry. WS4 provides `createAdapterRegistry(config)` returning this;
 * the worker registers extra adapters (agent CLIs) at startup.
 */
export interface AdapterRegistry {
  register(adapter: ModelAdapter): void;
  get(id: string): ModelAdapter | undefined;
  /** Throws ModelAdapterError("unavailable") when the adapter is not registered. */
  resolve(ref: ModelRef): ModelAdapter;
  list(): ModelAdapter[];
}
