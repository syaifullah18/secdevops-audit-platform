import { useState, type FormEvent } from "react";
import {
  TRIAGE_TRANSITIONS,
  canTransition,
  type FindingStatus,
  type TriageRequest,
} from "@sdap/core";
import { StatusBadge } from "./Badges.js";

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
      className="card"
      style={{ display: "flex", flexDirection: "column", gap: "14px" }}
      data-testid="triage-action-form"
    >
      <div className="card-header" style={{ marginBottom: "0px" }}>
        <h3 className="card-title">Triage Finding</h3>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Current Status:</span>
          <StatusBadge status={currentStatus} />
        </div>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            backgroundColor: "var(--critical-bg)",
            color: "var(--critical)",
            padding: "10px 14px",
            borderRadius: "var(--radius)",
            fontSize: "0.85rem",
            border: "1px solid var(--critical-border)",
          }}
        >
          {error}
        </div>
      )}

      {success && (
        <div
          role="status"
          style={{
            backgroundColor: "var(--success-bg)",
            color: "var(--success)",
            padding: "10px 14px",
            borderRadius: "var(--radius)",
            fontSize: "0.85rem",
            border: "1px solid var(--success-border)",
          }}
        >
          Triage state successfully updated!
        </div>
      )}

      <div className="form-group">
        <label htmlFor="triage-target-status" className="form-label">
          New Target Status
        </label>
        <select
          id="triage-target-status"
          value={to}
          onChange={(e) => setTo(e.target.value as FindingStatus)}
          className="form-select"
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
        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
          Allowed transitions from {currentStatus}: {allowedTransitions.join(", ")}
        </span>
      </div>

      {to === "accepted_risk" && (
        <div className="form-group" data-testid="expires-at-group">
          <label htmlFor="triage-expires-at" className="form-label">
            Risk Acceptance Expiration Date <span style={{ color: "var(--critical)" }}>*</span>
          </label>
          <input
            id="triage-expires-at"
            type="date"
            className="form-input"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            required
            disabled={disabled || submitting}
            min={new Date().toISOString().split("T")[0]}
          />
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            PRD requirement: accepted risk findings must specify an expiration date.
          </span>
        </div>
      )}

      {to === "false_positive" && (
        <div className="form-group" data-testid="reason-required-group">
          <label htmlFor="triage-fp-reason" className="form-label">
            False Positive Justification Reason <span style={{ color: "var(--critical)" }}>*</span>
          </label>
          <textarea
            id="triage-fp-reason"
            className="form-textarea"
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
        <div className="form-group">
          <label htmlFor="triage-notes" className="form-label">
            Notes / Rationale (Optional)
          </label>
          <textarea
            id="triage-notes"
            className="form-textarea"
            rows={2}
            placeholder="Add context or link to ticket/PR..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={disabled || submitting}
          />
        </div>
      )}

      <div className="form-group">
        <label htmlFor="triage-assignee" className="form-label">
          Assign Owner (Optional)
        </label>
        <input
          id="triage-assignee"
          type="text"
          className="form-input"
          placeholder="e.g. alex.dev@acme-corp.example"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          disabled={disabled || submitting}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={disabled || submitting || !canTransition(currentStatus, to)}
          data-testid="submit-triage-button"
        >
          {submitting ? "Applying..." : "Submit Triage Decision"}
        </button>
      </div>
    </form>
  );
}
