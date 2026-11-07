import { AuditMode, type Severity, type Run } from "@sdap/core";
import { ApiClient } from "../api-client.js";
import { CliError, EXIT_CODES, type Io } from "../types.js";

export interface RunCommandOptions {
  project?: string;
  mode?: string;
  ref?: string;
  repeat?: string | number;
  paths?: string;
  wait?: boolean;
  timeout?: string | number;
  failOn?: string;
  apiUrl?: string;
  token?: string;
  json?: boolean;
  pollInterval?: string | number;
}

export function parseFailOn(failOn: string): Severity {
  const match = /^confirmed:(informational|low|medium|high|critical)$/.exec(failOn.trim());
  if (!match || !match[1]) {
    throw new CliError(
      `Invalid --fail-on: "${failOn}". Only "confirmed:<severity>" is accepted (e.g. "confirmed:high"). Only confirmed findings may fail a gate.`,
      EXIT_CODES.USAGE_ERROR,
    );
  }
  return match[1] as Severity;
}

export async function runCommand(options: RunCommandOptions, io: Io): Promise<number> {
  const project = options.project || io.env.SDAP_PROJECT;
  if (!project) {
    throw new CliError(
      "Missing required option: --project <id> (or SDAP_PROJECT environment variable)",
      EXIT_CODES.USAGE_ERROR,
    );
  }

  const rawMode = options.mode ?? "focused";
  const modeParsed = AuditMode.safeParse(rawMode);
  if (!modeParsed.success) {
    throw new CliError(
      `Invalid --mode: "${rawMode}". Must be "focused", "incremental", or "full".`,
      EXIT_CODES.USAGE_ERROR,
    );
  }
  const mode = modeParsed.data;

  const ref = options.ref ?? "HEAD";

  let repeat = 1;
  if (options.repeat !== undefined) {
    const r = typeof options.repeat === "number" ? options.repeat : parseInt(options.repeat, 10);
    if (isNaN(r) || r < 1 || r > 10) {
      throw new CliError(
        `Invalid --repeat: "${options.repeat}". Must be an integer between 1 and 10.`,
        EXIT_CODES.USAGE_ERROR,
      );
    }
    repeat = r;
  }

  let timeoutSec = 3600;
  if (options.timeout !== undefined) {
    const t = typeof options.timeout === "number" ? options.timeout : parseInt(options.timeout, 10);
    if (isNaN(t) || t <= 0) {
      throw new CliError(
        `Invalid --timeout: "${options.timeout}". Must be a positive integer in seconds.`,
        EXIT_CODES.USAGE_ERROR,
      );
    }
    timeoutSec = t;
  }

  let minSeverity: Severity | undefined;
  if (options.failOn) {
    minSeverity = parseFailOn(options.failOn);
  }

  let pollIntervalMs = 1000;
  if (options.pollInterval !== undefined) {
    const p =
      typeof options.pollInterval === "number"
        ? options.pollInterval
        : parseInt(options.pollInterval, 10);
    if (!isNaN(p) && p > 0) {
      pollIntervalMs = p;
    }
  }

  const pathList = options.paths
    ? options.paths
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)
    : [];

  const apiUrl = options.apiUrl || io.env.SDAP_API_URL;
  const token = options.token || io.env.SDAP_TOKEN;
  const client = new ApiClient({ baseUrl: apiUrl, token });

  const initialRun = await client.createRun({
    projectId: project,
    mode,
    repeat,
    ref,
    scope: { paths: pathList },
    trigger: { kind: "ci", ref: null },
  });

  if (!options.wait) {
    if (options.json) {
      io.stdout(JSON.stringify(initialRun, null, 2));
    } else {
      io.stdout(
        `Run ${initialRun.id} created for project "${project}" (mode: ${initialRun.mode}, status: ${initialRun.status})`,
      );
    }
    return EXIT_CODES.PASS;
  }

  // With --wait: stream phase progress to stderr and poll until completion
  io.stderr(`Run ${initialRun.id} started. Waiting for completion (timeout: ${timeoutSec}s)...`);

  const startTime = Date.now();
  const phaseLogMap = new Map<string, string>();

  const streamPhases = (r: Run) => {
    for (const phase of r.phases) {
      const desc = `${phase.status} (${phase.slicesDone}/${phase.sliceCount} slices)`;
      const prev = phaseLogMap.get(phase.name);
      if (prev !== desc) {
        phaseLogMap.set(phase.name, desc);
        io.stderr(`[phase] ${phase.name}: ${desc}`);
      }
    }
  };

  let currentRun = initialRun;
  streamPhases(currentRun);

  while (currentRun.status === "queued" || currentRun.status === "running") {
    const elapsedSec = (Date.now() - startTime) / 1000;
    if (elapsedSec >= timeoutSec) {
      io.stderr(`Error: Run ${currentRun.id} timed out after ${timeoutSec}s.`);
      return EXIT_CODES.TIMEOUT;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    currentRun = await client.getRun(currentRun.id);
    streamPhases(currentRun);
  }

  // Check validator health
  if (
    currentRun.validators.findings === "failed" ||
    currentRun.validators.coverageLedger === "failed"
  ) {
    io.stderr(
      `Run ${currentRun.id} validator failed: findings=${currentRun.validators.findings}, coverageLedger=${currentRun.validators.coverageLedger}`,
    );
    return EXIT_CODES.RUN_FAILED;
  }

  // Check terminal status
  if (currentRun.status === "failed" || currentRun.status === "cancelled") {
    io.stderr(
      `Run ${currentRun.id} ${currentRun.status}: ${currentRun.failureReason ?? "unknown error"}`,
    );
    return EXIT_CODES.RUN_FAILED;
  }

  if (currentRun.failureReason) {
    io.stderr(`Run ${currentRun.id} failed: ${currentRun.failureReason}`);
    return EXIT_CODES.RUN_FAILED;
  }

  // Succeeded: check --fail-on if specified
  if (minSeverity) {
    const check = await client.checkConfirmedThreshold(project, minSeverity);
    if (check.failed) {
      io.stderr(
        `Gate failed: ${check.violations.length} confirmed finding(s) at or above ${minSeverity} found:`,
      );
      for (const v of check.violations) {
        io.stderr(
          `  - [${v.severity.toUpperCase()}] Finding ${v.findingId}${v.fingerprint ? ` (${v.fingerprint})` : ""}`,
        );
      }
      if (options.json) {
        io.stdout(
          JSON.stringify(
            {
              run: currentRun,
              gate: {
                pass: false,
                threshold: `confirmed:${minSeverity}`,
                violations: check.violations,
              },
            },
            null,
            2,
          ),
        );
      }
      return EXIT_CODES.GATE_FAILED;
    }
    io.stderr(`Gate passed: no confirmed findings at or above ${minSeverity}.`);
  }

  if (options.json) {
    io.stdout(JSON.stringify(currentRun, null, 2));
  } else {
    io.stdout(`Run ${currentRun.id} completed successfully (status: ${currentRun.status}).`);
  }

  return EXIT_CODES.PASS;
}
