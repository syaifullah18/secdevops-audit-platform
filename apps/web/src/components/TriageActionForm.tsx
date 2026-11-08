import { useState, type FormEvent } from "react";
import {
  TRIAGE_TRANSITIONS,
  canTransition,
  type FindingStatus,
  type TriageRequest,
} from "@sdap/core";
import { StatusBadge } from "./Badges.js";
import { Icon } from "./Icon.js";
import { btn } from "./stitch.js";

const FIELD =
  "w-full rounded-md border border-outline-variant/60 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface disabled:opacity-60";
const LABEL = "text-xs font-medium text-on-surface-variant";
const HINT = "text-[11px] text-on-surface-variant";

const ALL_STATUSES: FindingStatus[] = [
  "new",
  "confirmed",
  "in_progress",
  "fixed",
  "accepted_risk",
  "false_positive",
];

export function TriageActionForm({
  currentStatus,
  currentOwner,
  onTriage,
  disabled = false,
}: {
  currentStatus: FindingStatus;
  currentOwner: string | null;
  onTriage: (req: TriageRequest) => Promise<void>;
  disabled?: boolean;
}) {
  const allowedTransitions = TRIAGE_TRANSITIONS[currentStatus] || [];
  const defaultTo = allowedTransitions[0] || currentStatus;

  const [to, setTo] = useState<FindingStatus>(defaultTo);
  const [reason, setReason] = useState("");
  const [owner, setOwner] = useState(currentOwner || "");
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!canTransition(currentStatus, to)) {
      setError(`Transition from ${currentStatus} to ${to} is not permitted.`);
      return;
    }

    if (to === "accepted_risk" && !expiresAt) {
      setError("An expiration date is strictly required for Accepted Risk.");
      return;
    }

    if (to === "false_positive" && !reason.trim()) {
      setError("A detailed justification reason is strictly required for False Positive.");
      return;
    }

    setSubmitting(true);
    try {
      const payload: TriageRequest = {
        to,
        reason: reason.trim() || null,
        owner: owner.trim() || null,
        expiresAt: to === "accepted_risk" && expiresAt ? new Date(expiresAt).toISOString() : null,
      };
      await onTriage(payload);
      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update triage state");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-outline-variant/60 bg-surface-container-lowest shadow-sm p-5 flex flex-col gap-4"
      data-testid="triage-action-form"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold font-headline">Triage Finding</h3>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-on-surface-variant">Current Status:</span>
          <StatusBadge status={currentStatus} />
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-sev-critical-border bg-sev-critical-bg text-sev-critical-ink px-3.5 py-2.5 text-xs"
        >
          {error}
        </div>
      )}

      {success && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-verified-border bg-verified-bg text-verified-ink px-3.5 py-2.5 text-xs"
        >
          <Icon name="check_circle" filled className="text-[16px]" />
          Triage state successfully updated!
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="triage-target-status" className={LABEL}>
          New Target Status
        </label>
        <select
          id="triage-target-status"
          value={to}
          onChange={(e) => setTo(e.target.value as FindingStatus)}
          className={FIELD}
          disabled={disabled || submitting}
          data-testid="target-status-select"
        >
          {ALL_STATUSES.map((status) => {
            const isAllowed = canTransition(currentStatus, status);
            return (
              <option key={status} value={status} disabled={!isAllowed}>
                {status.replace("_", " ")} {!isAllowed ? "(Disallowed)" : ""}
              </option>
            );
          })}
        </select>
        <span className={HINT}>
          Allowed transitions from {currentStatus}: {allowedTransitions.join(", ")}
        </span>
      </div>

      {to === "accepted_risk" && (
        <div className="flex flex-col gap-1.5" data-testid="expires-at-group">
          <label htmlFor="triage-expires-at" className={LABEL}>
            Risk Acceptance Expiration Date <span className="text-sev-critical-ink">*</span>
          </label>
          <input
            id="triage-expires-at"
            type="date"
            className={FIELD}
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            required
            disabled={disabled || submitting}
            min={new Date().toISOString().split("T")[0]}
          />
          <span className={HINT}>
            PRD requirement: accepted risk findings must specify an expiration date.
          </span>
        </div>
      )}

      {to === "false_positive" && (
        <div className="flex flex-col gap-1.5" data-testid="reason-required-group">
          <label htmlFor="triage-fp-reason" className={LABEL}>
            False Positive Justification Reason <span className="text-sev-critical-ink">*</span>
          </label>
          <textarea
            id="triage-fp-reason"
            className={FIELD}
            rows={3}
            placeholder="Explain why this finding is a false positive (e.g., unreachable code, sanitization in middleware)..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            disabled={disabled || submitting}
          />
        </div>
      )}

      {to !== "false_positive" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="triage-notes" className={LABEL}>
            Notes / Rationale (Optional)
          </label>
          <textarea
            id="triage-notes"
            className={FIELD}
            rows={2}
            placeholder="Add context or link to ticket/PR..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={disabled || submitting}
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="triage-assignee" className={LABEL}>
          Assign Owner (Optional)
        </label>
        <input
          id="triage-assignee"
          type="text"
          className={FIELD}
          placeholder="e.g. alex.dev@acme-corp.example"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          disabled={disabled || submitting}
        />
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          className={btn.primary}
          disabled={disabled || submitting || !canTransition(currentStatus, to)}
          data-testid="submit-triage-button"
        >
          {submitting ? "Applying..." : "Submit Triage Decision"}
        </button>
      </div>
    </form>
  );
}
