import { parseArgs } from "node:util";
import { gateCommand } from "./commands/gate.js";
import { reportCommand } from "./commands/report.js";
import { runCommand } from "./commands/run.js";
import { statusCommand } from "./commands/status.js";
import { CliError, EXIT_CODES, type Io } from "./types.js";

export const defaultIo: Io = {
  stdout: (text: string) => process.stdout.write(text.endsWith("\n") ? text : `${text}\n`),
  stderr: (text: string) => process.stderr.write(text.endsWith("\n") ? text : `${text}\n`),
  env: process.env,
};

function getHelpText(): string {
  return `sdap - SecDevOps Audit Platform CLI for CI pipelines

USAGE:
  sdap <command> [options]

COMMANDS:
  run       Trigger an audit run, optionally wait for completion, and enforce gates.
  status    Check the status and phase progress of an audit run.
  report    Retrieve audit reports in Markdown or JSON format.
  gate      Evaluate the policy gate for a project against open confirmed findings.
  help      Show help for sdap or a specific command.

GLOBAL OPTIONS:
  --api-url <url>   SDAP API base URL (env: SDAP_API_URL, default: http://localhost:3000)
  --token <token>   SDAP API bearer token (env: SDAP_TOKEN)
  -h, --help        Show this help message
  -v, --version     Show version information

COMMAND USAGE:
  sdap run --project <id> [--mode focused|incremental|full] [--ref <git-ref>]
           [--repeat N] [--paths a,b] [--wait] [--timeout 3600]
           [--fail-on confirmed:<severity>] [--json]

  sdap status <run-id> [--json]

  sdap report <run-id> [--format md|json] [--out <file>]

  sdap gate --project <id> [--json]

EXIT CODES:
  0   Success / pass / gate satisfied
  1   Gate failed (confirmed findings at or above configured threshold)
  2   Run failed, cancelled, validator failed, or invalid state
  3   Usage or configuration error (invalid flags, bad arguments)
  4   Operation timed out
`;
}

export async function runCli(args: string[], customIo?: Partial<Io>): Promise<number> {
  const io: Io = {
    stdout: customIo?.stdout ?? defaultIo.stdout,
    stderr: customIo?.stderr ?? defaultIo.stderr,
    env: customIo?.env ?? defaultIo.env,
  };

  if (args.length === 0) {
    io.stderr(getHelpText());
    return EXIT_CODES.USAGE_ERROR;
  }

  const [command, ...subArgs] = args;

  if (command === "--help" || command === "-h" || command === "help") {
    io.stdout(getHelpText());
    return EXIT_CODES.PASS;
  }

  if (command === "--version" || command === "-v" || command === "version") {
    io.stdout("sdap 0.0.0");
    return EXIT_CODES.PASS;
  }

  try {
    switch (command) {
      case "run": {
        const parsed = parseArgs({
          args: subArgs,
          options: {
            project: { type: "string", short: "p" },
            mode: { type: "string", short: "m" },
            ref: { type: "string" },
            repeat: { type: "string" },
            paths: { type: "string" },
            wait: { type: "boolean", default: false },
            timeout: { type: "string" },
            "fail-on": { type: "string" },
            "api-url": { type: "string" },
            token: { type: "string" },
            json: { type: "boolean", default: false },
            "poll-interval": { type: "string" },
            help: { type: "boolean", short: "h" },
          },
          allowPositionals: true,
          strict: true,
        });

        if (parsed.values.help) {
          io.stdout(
            "Usage: sdap run --project <id> [--mode focused|incremental|full] [--ref <git-ref>] [--repeat N] [--paths a,b] [--wait] [--timeout 3600] [--fail-on confirmed:high] [--json]",
          );
          return EXIT_CODES.PASS;
        }

        return await runCommand(
          {
            project: parsed.values.project,
            mode: parsed.values.mode,
            ref: parsed.values.ref,
            repeat: parsed.values.repeat,
            paths: parsed.values.paths,
            wait: parsed.values.wait,
            timeout: parsed.values.timeout,
            failOn: parsed.values["fail-on"],
            apiUrl: parsed.values["api-url"],
            token: parsed.values.token,
            json: parsed.values.json,
            pollInterval: parsed.values["poll-interval"],
          },
          io,
        );
      }

      case "status": {
        const parsed = parseArgs({
          args: subArgs,
          options: {
            "api-url": { type: "string" },
            token: { type: "string" },
            json: { type: "boolean", default: false },
            help: { type: "boolean", short: "h" },
          },
          allowPositionals: true,
          strict: true,
        });

        if (parsed.values.help) {
          io.stdout("Usage: sdap status <run-id> [--json]");
          return EXIT_CODES.PASS;
        }

        const runId = parsed.positionals[0];
        return await statusCommand(
          {
            runId,
            apiUrl: parsed.values["api-url"],
            token: parsed.values.token,
            json: parsed.values.json,
          },
          io,
        );
      }

      case "report": {
        const parsed = parseArgs({
          args: subArgs,
          options: {
            format: { type: "string" },
            out: { type: "string" },
            "api-url": { type: "string" },
            token: { type: "string" },
            help: { type: "boolean", short: "h" },
          },
          allowPositionals: true,
          strict: true,
        });

        if (parsed.values.help) {
          io.stdout("Usage: sdap report <run-id> [--format md|json] [--out <file>]");
          return EXIT_CODES.PASS;
        }

        const runId = parsed.positionals[0];
        return await reportCommand(
          {
            runId,
            format: parsed.values.format,
            out: parsed.values.out,
            apiUrl: parsed.values["api-url"],
            token: parsed.values.token,
          },
          io,
        );
      }

      case "gate": {
        const parsed = parseArgs({
          args: subArgs,
          options: {
            project: { type: "string", short: "p" },
            "api-url": { type: "string" },
            token: { type: "string" },
            json: { type: "boolean", default: false },
            help: { type: "boolean", short: "h" },
          },
          allowPositionals: true,
          strict: true,
        });

        if (parsed.values.help) {
          io.stdout("Usage: sdap gate --project <id> [--json]");
          return EXIT_CODES.PASS;
        }

        return await gateCommand(
          {
            project: parsed.values.project,
            apiUrl: parsed.values["api-url"],
            token: parsed.values.token,
            json: parsed.values.json,
          },
          io,
        );
      }

      default: {
        io.stderr(`Error: Unknown command "${command}".\n\nRun "sdap --help" for usage.`);
        return EXIT_CODES.USAGE_ERROR;
      }
    }
  } catch (err) {
    if (err instanceof CliError) {
      io.stderr(`Error: ${err.message}`);
      return err.exitCode;
    }

    if (err instanceof TypeError && err.message.includes("Unknown option")) {
      io.stderr(`Error: ${err.message}`);
      return EXIT_CODES.USAGE_ERROR;
    }

    const message = err instanceof Error ? err.message : String(err);
    io.stderr(`Error: ${message}`);
    return EXIT_CODES.RUN_FAILED;
  }
}
