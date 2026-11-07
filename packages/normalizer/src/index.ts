/**
 * @sdap/normalizer: maps security-audit-skill output to core findings, fingerprints,
 * dedup/merge and SLA. Owned by workstream WS3.
 */
export const PACKAGE_NAME = "@sdap/normalizer";

export * from "./verdict.js";
export * from "./salvage.js";
export * from "./schemas.js";
export * from "./attack-class.js";
export * from "./fingerprint.js";
export * from "./normalize.js";
export * from "./merge.js";
