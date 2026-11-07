import { ApiClient } from "../api-client.js";
import { CliError, EXIT_CODES, type Io } from "../types.js";

export interface GateCommandOptions {
  project?: string;
  apiUrl?: string;
  token?: string;
  json?: boolean;
}

export async function gateCommand(options: GateCommandOptions, io: Io): Promise<number> {
  const project = options.project || io.env.SDAP_PROJECT;
  if (!project) {
    throw new CliError(
      "Missing required option: --project <id> (or SDAP_PROJECT environment variable)",
      EXIT_CODES.USAGE_ERROR,
    );
  }

  const apiUrl = options.apiUrl || io.env.SDAP_API_URL;
  const token = options.token || io.env.SDAP_TOKEN;
  const client = new ApiClient({ baseUrl: apiUrl, token });

  const gateResult = await client.getGate(project);

  if (options.json) {
    io.stdout(JSON.stringify(gateResult, null, 2));
  } else {
    io.stdout(`Gate evaluation for project "${project}": ${gateResult.pass ? "PASSED" : "FAILED"}`);
    io.stdout(`Policy Mode:  ${gateResult.mode}`);
    io.stdout(`Evaluated At: ${gateResult.evaluatedAt}`);

    if (gateResult.violations.length > 0) {
      io.stdout(`\nPolicy Violations (${gateResult.violations.length}):`);
      for (const v of gateResult.violations) {
        io.stdout(
          `  - [${v.severity.toUpperCase()}] Finding ${v.findingId} (fingerprint: ${v.fingerprint})`,
        );
      }
    } else {
      io.stdout("\nNo policy violations found.");
    }

    if (gateResult.excepted.length > 0) {
      io.stdout(`\nExcepted Findings (${gateResult.excepted.length}):`);
      for (const id of gateResult.excepted) {
        io.stdout(`  - Finding ${id}`);
      }
    }
  }

  return gateResult.pass ? EXIT_CODES.PASS : EXIT_CODES.GATE_FAILED;
}
