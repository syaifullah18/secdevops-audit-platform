import { DraftBadge } from "./Badges.js";

interface Remediation {
  strategy: string;
  codeChanges: Array<{ file: string; fixedCode: string }>;
}

export function FixDraftViewer({ remediation }: { remediation: Remediation | null }) {
  if (!remediation) {
    return (
      <div style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
        No automated fix draft available for this finding.
      </div>
    );
  }

  return (
    <div
      className="card"
      style={{
        border: "1px dashed var(--high-border)",
        backgroundColor: "var(--surface)",
      }}
      data-testid="fix-draft-viewer"
    >
      <div className="card-header" style={{ marginBottom: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <DraftBadge />
          <h3 style={{ fontSize: "1rem", fontWeight: 600 }}>Proposed Remediation Strategy</h3>
        </div>
      </div>

      <p style={{ fontSize: "0.9rem", marginBottom: "14px", lineHeight: "1.5" }}>
        {remediation.strategy}
      </p>

      {remediation.codeChanges.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <span
            style={{
              fontSize: "0.8rem",
              fontWeight: 600,
              color: "var(--text-muted)",
              textTransform: "uppercase",
            }}
          >
            Draft Code Changes (Human Verification Required)
          </span>
          {remediation.codeChanges.map((change, idx) => (
            <div
              key={idx}
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  backgroundColor: "var(--surface-raised)",
                  padding: "6px 12px",
                  fontSize: "0.8rem",
                  fontFamily: "var(--font-mono)",
                  borderBottom: "1px solid var(--border)",
                  color: "var(--text-muted)",
                }}
              >
                File: {change.file}
              </div>
              <pre className="code-block" style={{ margin: 0, borderRadius: 0, border: "none" }}>
                <code>{change.fixedCode}</code>
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
