import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import type { Finding } from "@sdap/core";
import { VerdictBadge, StatusBadge, AdvisoryBadge } from "../components/Badges.js";

export function ReviewQueueScreen() {
  const [items, setItems] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterClass, setFilterClass] = useState<string>("all");

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        setLoading(true);
        const queue = await api.getReviewQueue();
        if (mounted) {
          setItems(queue);
        }
      } catch (err: unknown) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to load review queue");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return <div data-testid="loading-indicator">Loading security review queue...</div>;
  }

  if (error) {
    return (
      <div role="alert" style={{ color: "var(--critical)" }}>
        Error loading review queue: {error}
      </div>
    );
  }

  const attackClasses = Array.from(new Set(items.map((i) => i.attackClass)));
  const filteredItems =
    filterClass === "all" ? items : items.filter((i) => i.attackClass === filterClass);

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: "24px" }}
      data-testid="review-queue-screen"
    >
      {/* Informational Banner */}
      <div
        className="card"
        style={{
          backgroundColor: "var(--purple-bg)",
          border: "1px solid var(--purple-border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
          <span style={{ fontSize: "1.2rem" }}>🔍</span>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--purple)" }}>
            Security Review Queue (Needs Validation)
          </h2>
        </div>
        <p style={{ fontSize: "0.9rem", color: "var(--text)", lineHeight: "1.5" }}>
          Items below are candidate leads identified by hunter agents where automatic proof could
          not be fully established.
          <strong>
            {" "}
            In accordance with PRD 5.4, items in the review queue never block a merge or fail a gate
            on their own.
          </strong>
          Security engineers can inspect the specific blockers and execute sandboxed validation or
          triage them.
        </p>
      </div>

      {/* Queue Metrics & Controls */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div style={{ fontSize: "0.95rem" }}>
          Showing <strong>{filteredItems.length}</strong> items awaiting verification
        </div>

        {attackClasses.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <label
              htmlFor="filter-class"
              style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}
            >
              Filter by Attack Class:
            </label>
            <select
              id="filter-class"
              className="form-select"
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value)}
              data-testid="filter-class-select"
            >
              <option value="all">All Classes ({items.length})</option>
              {attackClasses.map((ac) => (
                <option key={ac} value={ac}>
                  {ac} ({items.filter((i) => i.attackClass === ac).length})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Review Queue Items */}
      {filteredItems.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "40px 20px" }}>
          <h3 style={{ fontSize: "1.1rem", color: "var(--success)" }}>Queue is Clean! 🎉</h3>
          <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginTop: "6px" }}>
            No unvalidated candidate findings are currently pending security review.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className="card"
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
              data-testid={`queue-item-${item.id}`}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                  gap: "10px",
                }}
              >
                <div>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}
                  >
                    <VerdictBadge verdict={item.verdict} />
                    <StatusBadge status={item.status} />
                    <span className="badge badge-info">{item.attackClass}</span>
                    {item.triageSuggestion && <AdvisoryBadge />}
                  </div>

                  <h3 style={{ fontSize: "1.15rem", fontWeight: 700, marginTop: "6px" }}>
                    <Link to={`/findings/${item.id}`}>{item.title}</Link>
                  </h3>

                  <div
                    style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "2px" }}
                  >
                    Location:{" "}
                    <code>
                      {item.location.file}:{item.location.line}
                    </code>
                    {" · "}First seen: {new Date(item.firstSeen).toLocaleDateString()}
                  </div>
                </div>

                <Link
                  to={`/findings/${item.id}`}
                  className="btn btn-primary btn-sm"
                  data-testid={`review-finding-${item.id}`}
                >
                  Inspect & Triage
                </Link>
              </div>

              <p style={{ fontSize: "0.9rem", color: "var(--text)" }}>{item.description}</p>

              {/* Blockers Display */}
              <div
                style={{
                  backgroundColor: "var(--surface-raised)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  padding: "12px 14px",
                }}
                data-testid={`blockers-${item.id}`}
              >
                <div
                  style={{
                    fontSize: "0.8rem",
                    fontWeight: 700,
                    color: "var(--purple)",
                    textTransform: "uppercase",
                    marginBottom: "6px",
                  }}
                >
                  Resolution Blockers ({item.blockers.length}):
                </div>
                <ul style={{ paddingLeft: "18px", fontSize: "0.85rem", color: "var(--text)" }}>
                  {item.blockers.map((blocker, bIdx) => (
                    <li key={bIdx} style={{ marginBottom: "3px" }}>
                      {blocker}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
