import type { TriageSuggestion } from "@sdap/core";
import { AdvisoryBadge } from "./Badges.js";

export function System1AdvisoryView({ suggestion }: { suggestion: TriageSuggestion | null }) {
  if (!suggestion) return null;

  return (
    <div
      className="card"
      style={{
        border: "1px dashed var(--purple-border)",
        backgroundColor: "var(--purple-bg)",
      }}
      data-testid="system1-advisory"
    >
      <div className="card-header" style={{ marginBottom: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <AdvisoryBadge />
          <h3 style={{ fontSize: "1rem", color: "var(--purple)", fontWeight: 600 }}>
            System 1 (Jev) Triage Recommendation
          </h3>
        </div>
        <span style={{ fontSize: "0.8rem", color: "var(--purple)" }}>
          {suggestion.model.adapter}/{suggestion.model.model}
        </span>
      </div>

      <p style={{ fontSize: "0.85rem", color: "var(--text)", marginBottom: "14px" }}>
        Advisory guidance generated via fast probabilistic classifier. Does not block merges or
        close findings.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "12px",
        }}
      >
        {suggestion.severityBand && (
          <div style={{ backgroundColor: "var(--surface)", padding: "10px", borderRadius: "6px" }}>
            <div
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color: "var(--text-muted)",
                marginBottom: "4px",
              }}
            >
              PREDICTED SEVERITY
            </div>
            {Object.entries(suggestion.severityBand).map(([sev, prob]) => (
              <div
                key={sev}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "0.85rem",
                  padding: "2px 0",
                }}
              >
                <span style={{ textTransform: "capitalize" }}>{sev}</span>
                <span style={{ fontWeight: 600 }}>{(prob * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        )}

        {suggestion.ownerCandidates && suggestion.ownerCandidates.length > 0 && (
          <div style={{ backgroundColor: "var(--surface)", padding: "10px", borderRadius: "6px" }}>
            <div
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color: "var(--text-muted)",
                marginBottom: "4px",
              }}
            >
              RECOMMENDED OWNERS
            </div>
            {suggestion.ownerCandidates.map((cand) => (
              <div
                key={cand.owner}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "0.85rem",
                  padding: "2px 0",
                }}
              >
                <span
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {cand.owner}
                </span>
                <span style={{ fontWeight: 600 }}>{(cand.probability * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        )}

        {suggestion.falsePositiveProbability !== undefined && (
          <div style={{ backgroundColor: "var(--surface)", padding: "10px", borderRadius: "6px" }}>
            <div
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color: "var(--text-muted)",
                marginBottom: "4px",
              }}
            >
              FALSE POSITIVE RISK
            </div>
            <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--text)" }}>
              {(suggestion.falsePositiveProbability * 100).toFixed(1)}%
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              Calibrated confidence
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
