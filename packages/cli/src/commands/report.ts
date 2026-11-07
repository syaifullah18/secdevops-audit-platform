import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ApiClient } from "../api-client.js";
import { CliError, EXIT_CODES, type Io } from "../types.js";

export interface ReportCommandOptions {
  runId?: string;
  format?: string;
  out?: string;
  apiUrl?: string;
  token?: string;
}

export async function reportCommand(options: ReportCommandOptions, io: Io): Promise<number> {
  if (!options.runId) {
    throw new CliError("Missing required argument: <run-id>", EXIT_CODES.USAGE_ERROR);
  }

  const rawFormat = options.format ?? "md";
  if (rawFormat !== "md" && rawFormat !== "json") {
    throw new CliError(
      `Invalid --format: "${rawFormat}". Supported formats are "md" and "json".`,
      EXIT_CODES.USAGE_ERROR,
    );
  }
  const format: "md" | "json" = rawFormat;

  const apiUrl = options.apiUrl || io.env.SDAP_API_URL;
  const token = options.token || io.env.SDAP_TOKEN;
  const client = new ApiClient({ baseUrl: apiUrl, token });

  const result = await client.getReport(options.runId, format);
  const outputText = typeof result === "string" ? result : JSON.stringify(result, null, 2);

  if (options.out) {
    const resolvedPath = path.resolve(options.out);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, outputText, "utf-8");
    io.stderr(`Report written to ${resolvedPath}`);
  } else {
    io.stdout(outputText);
  }

  return EXIT_CODES.PASS;
}
