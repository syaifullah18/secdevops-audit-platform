/**
 * Errors thrown by @sdap/sandbox components.
 */

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxError";
  }
}

export class SandboxValidationError extends SandboxError {
  constructor(message: string) {
    super(message);
    this.name = "SandboxValidationError";
  }
}

export class SandboxExecutionError extends SandboxError {
  readonly exitCode: number | null;

  constructor(message: string, exitCode: number | null = null) {
    super(message);
    this.name = "SandboxExecutionError";
    this.exitCode = exitCode;
  }
}
