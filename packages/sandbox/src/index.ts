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
  parseEgressAllowlist,
  resolveHostMounts,
  sensitiveHostPaths,
  type ParsedSandboxPolicy,
  type ResolvedMount,
  type ResolvedMounts,
} from "./validation.js";

export {
  parseAllowlistEntry,
  matchAllowlist,
  classifyAddress,
  addressPermitted,
  type AllowlistRule,
  type AddressClass,
} from "./egress-rules.js";

export { EgressProxy, type EgressProxyOptions, type LookupFn } from "./proxy.js";

export { NoSandboxRunner, DEFAULT_SYSTEM_PATH } from "./no-sandbox.js";

export {
  DockerSandboxRunner,
  type DockerSandboxRunnerOptions,
  type EgressAttachment,
} from "./docker-runner.js";
