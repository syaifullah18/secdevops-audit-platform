import type { Severity } from "@sdap/core";
import { SeverityBadge } from "./Badges.js";

export function SideBySideSeverity({
  originalSeverity,
  verifiedSeverity,
}: {
  originalSeverity: Severity | null;
  verifiedSeverity: Severity | null;
}) {
  return (
    <div
      className="side-by-side"
      style={{
        backgroundColor: "var(--surface-raised)",
        padding: "16px",
        borderRadius: "var(--radius)",
        border: "1px solid var(--border)",
      }}
      data-testid="side-by-side-severity"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <span
          style={{
            fontSize: "0.8rem",
            color: "var(--text-muted)",
            fontWeight: 600,
            textTransform: "uppercase",
          }}
        >
          Hunter Severity (Pre-Verification)
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <SeverityBadge severity={originalSeverity} />
          <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
            Initial candidate assessment
          </span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <span
          style={{
            fontSize: "0.8rem",
            color: "var(--text-muted)",
            fontWeight: 600,
            textTransform: "uppercase",
          }}
        >
          Verified Severity (Gate Authoritative)
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <SeverityBadge severity={verifiedSeverity} />
          <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
            Authoritative verified ranking
          </span>
        </div>
      </div>
    </div>
  );
}
