/**
 * @sdap/sandbox: OS-enforced sandbox runners, egress proxying, and input validation.
 * Owned by workstream WS8.
 */

export const PACKAGE_NAME = "@sdap/sandbox";

export { SandboxError, SandboxValidationError, SandboxExecutionError } from "./errors.js";

export {
  validateSandboxPolicy,
  validateSandboxExecRequest,
  validateSafePath,
  hasControlCharacters,
  type ParsedSandboxPolicy,
} from "./validation.js";

export { EgressProxy, type EgressProxyOptions } from "./proxy.js";

export { NoSandboxRunner } from "./no-sandbox.js";

export { DockerSandboxRunner, type DockerSandboxRunnerOptions } from "./docker-runner.js";
