import { SEVERITY_RANK, type Severity } from "@sdap/core";

/** Sort findings most severe first; unknown severities last. */
export const bySeverityDesc = (a: Severity | null, b: Severity | null): number =>
  (b === null ? -1 : SEVERITY_RANK[b]) - (a === null ? -1 : SEVERITY_RANK[a]);
