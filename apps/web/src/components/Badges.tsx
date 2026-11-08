import type { Severity, Verdict, FindingStatus } from "@sdap/core";
import { Pill, severityTone, type Tone } from "./stitch.js";

export function SeverityBadge({ severity }: { severity: Severity | null }) {
  if (!severity) return <Pill tone="neutral">None</Pill>;
  return (
    <Pill tone={severityTone(severity)} className="capitalize">
      {severity}
    </Pill>
  );
}

const VERDICT_TONE: Record<Verdict, Tone> = {
  confirmed: "verified",
  needs_validation: "medium",
  rejected: "neutral",
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <Pill tone={VERDICT_TONE[verdict]} icon={verdict === "confirmed" ? "verified" : undefined}>
      {verdict.replace("_", " ")}
    </Pill>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  confirmed: "critical",
  in_progress: "medium",
  fixed: "verified",
  accepted_risk: "low",
  false_positive: "neutral",
  new: "high",
};

export function StatusBadge({ status }: { status: FindingStatus }) {
  return <Pill tone={STATUS_TONE[status] ?? "neutral"}>{status.replace("_", " ")}</Pill>;
}

/** System 1 (Jev) output is advisory only; it never fails a gate. */
export function AdvisoryBadge() {
  return (
    <Pill
      tone="advisory"
      icon="auto_awesome"
      title="System 1 (Jev) suggestion is non-binding advisory only"
      className="uppercase tracking-wide"
    >
      <span role="status">System 1 · Advisory</span>
    </Pill>
  );
}

export function DraftBadge() {
  return (
    <Pill
      tone="advisory"
      icon="edit_note"
      title="Remediation is a generative draft requiring human review"
    >
      <span role="status">Draft · Human Review Only</span>
    </Pill>
  );
}
