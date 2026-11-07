import fs from "node:fs";
import path from "node:path";
import { SandboxPolicy, type SandboxExecRequest } from "@sdap/core";
import type { z } from "zod";
import { parseAllowlistEntry, type AllowlistRule } from "./egress-rules.js";
import { SandboxValidationError } from "./errors.js";

export type ParsedSandboxPolicy = z.output<typeof SandboxPolicy>;

const VALID_ENV_KEY_REGEX = /^[A-Z_][A-Z0-9_]*$/;

/** Env keys the runner owns; letting the policy set them would confuse proxy routing. */
const RESERVED_ENV_KEYS = new Set(["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"]);

/** Fixed container paths owned by the runner. Extra mounts may not shadow them. */
export const CONTAINER_TARGET_DIR = "/target";
export const CONTAINER_OUTPUT_DIR = "/out";
export const CONTAINER_TMP_DIR = "/tmp";

/** Kernel/pseudo filesystems inside the container that may never be mounted over. */
const RESERVED_CONTAINER_PREFIXES = ["/proc", "/sys", "/dev"];

/**
 * Characters that are syntactically meaningful in `docker run --mount`/`-v` specs
 * (`,` separates fields, `"` quotes them, `:` separates `-v` parts). Rejecting them
 * makes mount-option injection impossible regardless of the CLI's parser.
 */
const MOUNT_SPEC_METACHARS = /[,:"]/;

/** setTimeout overflows (fires immediately) above 2^31-1 ms. */
const MAX_TIMEOUT_SEC = Math.floor(0x7fffffff / 1000);
/** Docker refuses --memory below 6 MiB. */
const MIN_MEMORY_MB = 6;

/**
 * Checks whether a string contains ASCII control characters (0x00-0x1F or 0x7F).
 */
export function hasControlCharacters(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if ((code >= 0x00 && code <= 0x1f) || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function containsPathTraversal(p: string): boolean {
  return p.split(/[/\\]/).some((seg) => seg === ".." || seg === ".");
}

/**
 * Validates a host or container path for safety.
 * Must be absolute, free of `.`/`..` segments, control characters and mount-spec
 * metacharacters (`,`, `:`, `"`).
 */
export function validateSafePath(p: string, fieldName: string): void {
  if (!p || typeof p !== "string") {
    throw new SandboxValidationError(`${fieldName} must be a non-empty string`);
  }
  if (hasControlCharacters(p)) {
    throw new SandboxValidationError(`${fieldName} must not contain control characters`);
  }
  if (!path.posix.isAbsolute(p)) {
    throw new SandboxValidationError(`${fieldName} must be an absolute path, got: "${p}"`);
  }
  if (containsPathTraversal(p)) {
    throw new SandboxValidationError(
      `${fieldName} must not contain path traversal segments ("." or ".."), got: "${p}"`,
    );
  }
  if (MOUNT_SPEC_METACHARS.test(p)) {
    throw new SandboxValidationError(
      `${fieldName} must not contain mount-spec metacharacters (, : "), got: "${p}"`,
    );
  }
}

/** True when `child` equals `parent` or lies beneath it (POSIX, normalized inputs). */
export function isSameOrInside(child: string, parent: string): boolean {
  if (parent === "/") return true;
  const p = parent.endsWith("/") ? parent.slice(0, -1) : parent;
  return child === p || child.startsWith(`${p}/`);
}

function normalizeContainerPath(p: string): string {
  const n = path.posix.normalize(p);
  return n.length > 1 && n.endsWith("/") ? n.slice(0, -1) : n;
}

function validateContainerMountPath(p: string, field: string): string {
  validateSafePath(p, field);
  const n = normalizeContainerPath(p);
  if (n === "/") {
    throw new SandboxValidationError(`${field} cannot be "/"`);
  }
  for (const reserved of RESERVED_CONTAINER_PREFIXES) {
    if (isSameOrInside(n, reserved)) {
      throw new SandboxValidationError(`${field} cannot be under reserved path ${reserved}`);
    }
  }
  for (const owned of [CONTAINER_TARGET_DIR, CONTAINER_OUTPUT_DIR, CONTAINER_TMP_DIR]) {
    // Shadowing /target, /out or /tmp (or mounting over one of their parents) would
    // break the read-only/writable guarantees the runner advertises.
    if (n === owned || isSameOrInside(owned, n)) {
      throw new SandboxValidationError(`${field} cannot shadow runner-owned path ${owned}`);
    }
  }
  return n;
}

/**
 * Validates a SandboxPolicy according to WS8 security requirements and parses defaults.
 * Pure: does not touch the filesystem (see `resolveHostMounts` for that).
 */
export function validateSandboxPolicy(policy: SandboxPolicy): ParsedSandboxPolicy {
  if (!policy || typeof policy !== "object") {
    throw new SandboxValidationError("SandboxPolicy must be a valid object");
  }

  let parsed: ParsedSandboxPolicy;
  try {
    parsed = SandboxPolicy.parse(policy);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SandboxValidationError(`Invalid SandboxPolicy: ${msg}`);
  }

  validateSafePath(parsed.targetDir, "targetDir");
  validateSafePath(parsed.outputDir, "outputDir");

  const seenContainerPaths = new Set<string>();
  for (const [index, mount] of parsed.readOnlyMounts.entries()) {
    validateSafePath(mount.hostPath, `readOnlyMounts[${index}].hostPath`);
    const n = validateContainerMountPath(
      mount.containerPath,
      `readOnlyMounts[${index}].containerPath`,
    );
    if (seenContainerPaths.has(n)) {
      throw new SandboxValidationError(
        `readOnlyMounts[${index}].containerPath duplicates another mount: "${n}"`,
      );
    }
    seenContainerPaths.add(n);
  }

  for (const [key, value] of Object.entries(parsed.env)) {
    if (!VALID_ENV_KEY_REGEX.test(key)) {
      throw new SandboxValidationError(
        `Invalid environment variable name "${key}". Must match ^[A-Z_][A-Z0-9_]*$`,
      );
    }
    if (RESERVED_ENV_KEYS.has(key)) {
      throw new SandboxValidationError(
        `Environment variable "${key}" is reserved for the runner's egress proxy`,
      );
    }
    if (typeof value !== "string") {
      throw new SandboxValidationError(
        `Environment variable "${key}" value must be a string, got ${typeof value}`,
      );
    }
    if (hasControlCharacters(value)) {
      throw new SandboxValidationError(
        `Environment variable "${key}" value contains disallowed control characters`,
      );
    }
  }

  if (!Number.isFinite(parsed.cpus) || parsed.cpus <= 0) {
    throw new SandboxValidationError(
      `policy.cpus must be a positive finite number, got: ${parsed.cpus}`,
    );
  }
  if (!Number.isInteger(parsed.memoryMb) || parsed.memoryMb < MIN_MEMORY_MB) {
    throw new SandboxValidationError(
      `policy.memoryMb must be an integer >= ${MIN_MEMORY_MB}, got: ${parsed.memoryMb}`,
    );
  }
  if (
    !Number.isInteger(parsed.timeoutSec) ||
    parsed.timeoutSec <= 0 ||
    parsed.timeoutSec > MAX_TIMEOUT_SEC
  ) {
    throw new SandboxValidationError(
      `policy.timeoutSec must be an integer in [1, ${MAX_TIMEOUT_SEC}], got: ${parsed.timeoutSec}`,
    );
  }

  parseEgressAllowlist(parsed.egressAllowlist);

  return parsed;
}

/** Parses every allowlist entry, throwing SandboxValidationError on the first bad one. */
export function parseEgressAllowlist(entries: readonly string[]): AllowlistRule[] {
  return entries.map((entry, index) => {
    try {
      return parseAllowlistEntry(entry);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new SandboxValidationError(`egressAllowlist[${index}]: ${msg}`);
    }
  });
}

/**
 * Validates a SandboxExecRequest according to WS8 security requirements.
 */
export function validateSandboxExecRequest(req: SandboxExecRequest): ParsedSandboxPolicy {
  if (!req || typeof req !== "object") {
    throw new SandboxValidationError("SandboxExecRequest must be a valid object");
  }

  if (!Array.isArray(req.argv) || req.argv.length === 0) {
    throw new SandboxValidationError("req.argv must be a non-empty array of strings");
  }

  for (const [index, arg] of req.argv.entries()) {
    if (typeof arg !== "string") {
      throw new SandboxValidationError(`req.argv[${index}] must be a string, got ${typeof arg}`);
    }
    if (hasControlCharacters(arg)) {
      throw new SandboxValidationError(`req.argv[${index}] contains disallowed control characters`);
    }
  }
  if (req.argv[0] === "") {
    throw new SandboxValidationError("req.argv[0] must be a non-empty command");
  }

  if (req.cwd !== undefined) {
    validateSafePath(req.cwd, "req.cwd");
  }

  if (req.stdin !== undefined && typeof req.stdin !== "string") {
    throw new SandboxValidationError("req.stdin must be a string when provided");
  }

  return validateSandboxPolicy(req.policy);
}

// ---------------------------------------------------------------------------
// Host-side mount resolution (touches the filesystem)
// ---------------------------------------------------------------------------

export interface ResolvedMount {
  hostPath: string;
  containerPath: string;
  readOnly: boolean;
}

export interface ResolvedMounts {
  target: ResolvedMount;
  output: ResolvedMount;
  extra: ResolvedMount[];
  /** True when the runner created outputDir itself (and may therefore adjust its mode). */
  outputCreated: boolean;
}

/**
 * Host locations that must never be bind-mounted, nor be a parent/child of a bind mount:
 * kernel interfaces and the directories that hold container-engine sockets. A read-only
 * bind mount does not stop `connect(2)` on a unix socket, so exposing the Docker/Podman
 * socket would be a full host escape.
 */
export function sensitiveHostPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const paths = [
    "/proc",
    "/sys",
    "/dev",
    "/run",
    "/var/run",
    "/private/var/run",
    "/etc",
    "/private/etc",
    "/boot",
    "/root",
  ];
  const dockerHost = env.DOCKER_HOST;
  if (dockerHost?.startsWith("unix://")) {
    const sock = dockerHost.slice("unix://".length);
    paths.push(sock);
    try {
      paths.push(fs.realpathSync(sock));
    } catch {
      // socket path does not exist on this host
    }
  }
  return paths;
}

function realDir(p: string, field: string): string {
  let real: string;
  try {
    real = fs.realpathSync(p);
  } catch {
    throw new SandboxValidationError(`${field} does not exist: "${p}"`);
  }
  validateSafePath(real, `${field} (resolved)`);
  return real;
}

function assertNotSensitive(real: string, field: string, sensitive: readonly string[]): void {
  if (real === "/") {
    throw new SandboxValidationError(`${field} must not be the host root directory`);
  }
  for (const s of sensitive) {
    if (isSameOrInside(real, s) || isSameOrInside(s, real)) {
      throw new SandboxValidationError(
        `${field} resolves to "${real}", which overlaps sensitive host path "${s}"`,
      );
    }
  }
  const st = fs.statSync(real);
  if (!st.isDirectory() && !st.isFile()) {
    throw new SandboxValidationError(
      `${field} must be a regular file or directory (sockets/devices are refused)`,
    );
  }
}

/**
 * Resolves (realpath) and checks every host path in a validated policy:
 * - targetDir must exist and be a directory; outputDir is created if missing;
 * - symlinks are resolved before checks, so a link cannot smuggle in a sensitive path;
 * - outputDir and targetDir must not overlap (otherwise /target would be writable
 *   through /out, or /out would expose the target);
 * - no mount may be "/", a sensitive host path, or a parent of one.
 */
export function resolveHostMounts(
  policy: ParsedSandboxPolicy,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedMounts {
  const sensitive = sensitiveHostPaths(env);

  const targetReal = realDir(policy.targetDir, "targetDir");
  if (!fs.statSync(targetReal).isDirectory()) {
    throw new SandboxValidationError(`targetDir must be a directory: "${policy.targetDir}"`);
  }
  assertNotSensitive(targetReal, "targetDir", sensitive);

  let outputCreated = false;
  if (!fs.existsSync(policy.outputDir)) {
    fs.mkdirSync(policy.outputDir, { recursive: true, mode: 0o700 });
    outputCreated = true;
  }
  const outputReal = realDir(policy.outputDir, "outputDir");
  if (!fs.statSync(outputReal).isDirectory()) {
    throw new SandboxValidationError(`outputDir must be a directory: "${policy.outputDir}"`);
  }
  assertNotSensitive(outputReal, "outputDir", sensitive);

  if (isSameOrInside(outputReal, targetReal) || isSameOrInside(targetReal, outputReal)) {
    throw new SandboxValidationError(
      `outputDir ("${outputReal}") and targetDir ("${targetReal}") must not overlap`,
    );
  }

  const extra = policy.readOnlyMounts.map((m, i) => {
    const field = `readOnlyMounts[${i}].hostPath`;
    const real = realDir(m.hostPath, field);
    assertNotSensitive(real, field, sensitive);
    if (isSameOrInside(real, outputReal) || isSameOrInside(outputReal, real)) {
      // Not an escape (the mount is read-only) but it makes /out content visible under
      // a second path and is almost certainly a mistake.
      throw new SandboxValidationError(`${field} must not overlap outputDir`);
    }
    return {
      hostPath: real,
      containerPath: normalizeContainerPath(m.containerPath),
      readOnly: true,
    };
  });

  return {
    target: { hostPath: targetReal, containerPath: CONTAINER_TARGET_DIR, readOnly: true },
    output: { hostPath: outputReal, containerPath: CONTAINER_OUTPUT_DIR, readOnly: false },
    extra,
    outputCreated,
  };
}
