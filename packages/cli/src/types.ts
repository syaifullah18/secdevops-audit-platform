import type { Severity } from "@sdap/core";

export const EXIT_CODES = {
  /** All checks passed, gate passed, or command completed cleanly. */
  PASS: 0,
  /** Gate evaluation failed (confirmed findings at or above configured threshold). */
  GATE_FAILED: 1,
  /** Run failed, was cancelled, validator failed, or run state is invalid. */
  RUN_FAILED: 2,
  /** Usage or configuration error (invalid flags, missing arguments, bad threshold). */
  USAGE_ERROR: 3,
  /** Run wait operation timed out before reaching a terminal status. */
  TIMEOUT: 4,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export class CliError extends Error {
  readonly exitCode: ExitCode;

  constructor(message: string, exitCode: ExitCode = EXIT_CODES.USAGE_ERROR) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: NodeJS.ProcessEnv;
}

export interface GlobalOptions {
  apiUrl?: string;
  token?: string;
  project?: string;
  json?: boolean;
}

export interface FailOnThreshold {
  verdict: "confirmed";
  minSeverity: Severity;
}
