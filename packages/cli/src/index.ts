/**
 * @sdap/cli: sdap CLI for CI pipelines: trigger runs, wait, and fail on policy.
 * Owned by workstream WS6.
 */

export const PACKAGE_NAME = "@sdap/cli";

export * from "./types.js";
export * from "./api-client.js";
export * from "./cli.js";
export * from "./commands/run.js";
export * from "./commands/status.js";
export * from "./commands/report.js";
export * from "./commands/gate.js";
