import path from "node:path";
import { SandboxPolicy, type SandboxExecRequest } from "@sdap/core";
import { SandboxValidationError } from "./errors.js";

const VALID_ENV_KEY_REGEX = /^[A-Z_][A-Z0-9_]*$/;

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
  const parts = p.split(/[/\\]/);
  return parts.includes("..");
}

/**
 * Validates a host or container path for safety.
 * Must be absolute and must not contain relative escaping segments ('..').
 */
export function validateSafePath(p: string, fieldName: string): void {
  if (!p || typeof p !== "string") {
    throw new SandboxValidationError(`${fieldName} must be a non-empty string`);
  }
  if (!path.isAbsolute(p)) {
    throw new SandboxValidationError(`${fieldName} must be an absolute path, got: "${p}"`);
  }
  if (containsPathTraversal(p)) {
    throw new SandboxValidationError(
      `${fieldName} must not contain path traversal segments (".."), got: "${p}"`,
    );
  }
  if (hasControlCharacters(p)) {
    throw new SandboxValidationError(
      `${fieldName} must not contain control characters, got: "${p}"`,
    );
  }
}

export type ParsedSandboxPolicy = z.output<typeof SandboxPolicy>;
import type { z } from "zod";

/**
 * Validates a SandboxPolicy according to WS8 security requirements and parses defaults.
 */
export function validateSandboxPolicy(policy: SandboxPolicy): ParsedSandboxPolicy {
  if (!policy || typeof policy !== "object") {
    throw new SandboxValidationError("SandboxPolicy must be a valid object");
  }

  // First validate against Core Zod schema
  let parsed: ParsedSandboxPolicy;
  try {
    parsed = SandboxPolicy.parse(policy);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SandboxValidationError(`Invalid SandboxPolicy: ${msg}`);
  }

  // Validate targetDir and outputDir
  validateSafePath(parsed.targetDir, "targetDir");
  validateSafePath(parsed.outputDir, "outputDir");

  // Validate readOnlyMounts
  for (const [index, mount] of parsed.readOnlyMounts.entries()) {
    validateSafePath(mount.hostPath, `readOnlyMounts[${index}].hostPath`);
    validateSafePath(mount.containerPath, `readOnlyMounts[${index}].containerPath`);

    // Check reserved mount locations
    const normalizedContainer = path.posix.normalize(mount.containerPath);
    if (
      normalizedContainer === "/" ||
      normalizedContainer === "/proc" ||
      normalizedContainer === "/sys" ||
      normalizedContainer === "/dev"
    ) {
      throw new SandboxValidationError(
        `readOnlyMounts[${index}].containerPath cannot be a reserved system path: "${mount.containerPath}"`,
      );
    }
  }

  // Validate env keys and values
  for (const [key, value] of Object.entries(parsed.env)) {
    if (!VALID_ENV_KEY_REGEX.test(key)) {
      throw new SandboxValidationError(
        `Invalid environment variable name "${key}". Must match ^[A-Z_][A-Z0-9_]*$`,
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

  // Validate resource limits
  if (parsed.cpus <= 0 || !Number.isFinite(parsed.cpus)) {
    throw new SandboxValidationError(
      `policy.cpus must be a positive finite number, got: ${parsed.cpus}`,
    );
  }
  if (parsed.memoryMb <= 0 || !Number.isInteger(parsed.memoryMb)) {
    throw new SandboxValidationError(
      `policy.memoryMb must be a positive integer, got: ${parsed.memoryMb}`,
    );
  }
  if (parsed.timeoutSec <= 0 || !Number.isInteger(parsed.timeoutSec)) {
    throw new SandboxValidationError(
      `policy.timeoutSec must be a positive integer, got: ${parsed.timeoutSec}`,
    );
  }

  // Validate egressAllowlist entries
  for (const [index, entry] of parsed.egressAllowlist.entries()) {
    if (hasControlCharacters(entry) || /\s/.test(entry)) {
      throw new SandboxValidationError(
        `egressAllowlist[${index}] contains whitespace or control characters: "${entry}"`,
      );
    }
  }

  return parsed;
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

  if (req.cwd !== undefined) {
    validateSafePath(req.cwd, "req.cwd");
  }

  return validateSandboxPolicy(req.policy);
}
