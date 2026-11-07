import type { Severity, Verdict, FindingStatus } from "@sdap/core";

export function SeverityBadge({ severity }: { severity: Severity | null }) {
  if (!severity) {
    return <span className="badge badge-info">None</span>;
  }
  return <span className={`badge badge-${severity}`}>{severity}</span>;
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <span className={`badge badge-${verdict}`}>{verdict.replace("_", " ")}</span>;
}

export function StatusBadge({ status }: { status: FindingStatus }) {
  let badgeClass = "badge-info";
  if (status === "confirmed") badgeClass = "badge-critical";
  else if (status === "in_progress") badgeClass = "badge-medium";
  else if (status === "fixed") badgeClass = "badge-success";
  else if (status === "accepted_risk") badgeClass = "badge-low";
  else if (status === "false_positive") badgeClass = "badge-info";
  else if (status === "new") badgeClass = "badge-high";

  return <span className={`badge ${badgeClass}`}>{status.replace("_", " ")}</span>;
}

export function AdvisoryBadge() {
  return (
    <span
      className="badge-advisory"
      title="System 1 (Jev) suggestion is non-binding advisory only"
      role="status"
    >
      System 1 · Advisory
    </span>
  );
}

export function DraftBadge() {
  return (
    <span
      className="badge-draft"
      title="Remediation is a generative draft requiring human review"
      role="status"
    >
      Draft · Human Review Only
    </span>
  );
}
