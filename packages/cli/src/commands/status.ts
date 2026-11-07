import { ApiClient } from "../api-client.js";
import { CliError, EXIT_CODES, type Io } from "../types.js";

export interface StatusCommandOptions {
  runId?: string;
  apiUrl?: string;
  token?: string;
  json?: boolean;
}

export async function statusCommand(options: StatusCommandOptions, io: Io): Promise<number> {
  if (!options.runId) {
    throw new CliError("Missing required argument: <run-id>", EXIT_CODES.USAGE_ERROR);
  }

  const apiUrl = options.apiUrl || io.env.SDAP_API_URL;
  const token = options.token || io.env.SDAP_TOKEN;
  const client = new ApiClient({ baseUrl: apiUrl, token });

  const run = await client.getRun(options.runId);

  if (options.json) {
    io.stdout(JSON.stringify(run, null, 2));
    return EXIT_CODES.PASS;
  }

  const lines = [
    `Run ID:          ${run.id}`,
    `Project:         ${run.projectId}`,
    `Status:          ${run.status.toUpperCase()}`,
    `Mode:            ${run.mode}`,
    `Git Ref:         ${run.ref}`,
    `Commit SHA:      ${run.commitSha ?? "unresolved"}`,
    `Trigger:         ${run.trigger.kind}${run.trigger.actor ? ` (by ${run.trigger.actor})` : ""}`,
    `Created At:      ${run.createdAt}`,
    `Started At:      ${run.startedAt ?? "not started"}`,
    `Ended At:        ${run.endedAt ?? "in progress"}`,
    `Failure Reason:  ${run.failureReason ?? "none"}`,
    "",
    "Validators:",
    `  - findings:       ${run.validators.findings}`,
    `  - coverageLedger: ${run.validators.coverageLedger}`,
    "",
    "Phases:",
    ...run.phases.map(
      (p) =>
        `  - ${p.name.padEnd(14)}: ${p.status.padEnd(10)} (${p.slicesDone}/${p.sliceCount} slices completed)`,
    ),
    "",
    "Artifacts:",
    `  - Report:          ${run.artifacts.reportMd ?? "none"}`,
    `  - Findings JSON:   ${run.artifacts.findingsJson ?? "none"}`,
    `  - Coverage Ledger: ${run.artifacts.coverageLedgerJson ?? "none"}`,
  ];

  io.stdout(lines.join("\n"));
  return EXIT_CODES.PASS;
}
