"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import styles from "./InsightsSection.module.css";

function formatNum(v) {
  if (v == null) return "-";
  return Number(v).toLocaleString();
}

export default function InsightsSection({ days }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    async function fetchData() {
      try {
        const res = await fetch(`/api/reports/insights?days=${days}`);
        const json = await res.json();
        if (json.success) setData(json);
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [days]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center" }}><span className="spinner" /></div>;
  }

  if (!data) {
    return <div className="card text-muted">No insights data available. Run scans to accumulate data.</div>;
  }

  return (
    <div>
      {/* Improvement Insights */}
      {data.insights.length === 0 ? (
        <div className="card text-muted" style={{ textAlign: "center", padding: 40 }}>
          Not enough data to generate insights yet. Keep running daily scans!
        </div>
      ) : (
        <div className="mb-lg">
          <div className="card-title mb-md" style={{ color: "var(--text-heading)" }}>
            Improvement Suggestions ({data.insights.length})
          </div>
          {data.insights.map((insight, i) => (
            <div key={i} className={`${styles.insightCard} ${styles[insight.severity === "high" ? "severityHigh" : insight.severity === "low" ? "severityLow" : ""] || ""}`}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div className={styles.title}>{insight.title}</div>
                <span className={`${styles.severityBadge} ${styles[insight.severity] || ""}`}>
                  {insight.severity}
                </span>
              </div>
              <div className={styles.desc}>{insight.description}</div>
              {insight.data?.winRate != null && (
                <div style={{ marginTop: 8, display: "flex", gap: 16, fontSize: "0.78rem" }}>
                  <span style={{ color: "var(--text-muted)" }}>
                    Win Rate: <strong style={{ color: insight.data.winRate >= 50 ? "var(--accent-green)" : "var(--accent-red)" }}>
                      {insight.data.winRate}%
                    </strong>
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>
                    Signals: <strong>{insight.data.total}</strong>
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Near Misses */}
      {data.nearMisses && data.nearMisses.length > 0 && (
        <div className="card">
          <div className="card-title mb-md">
            Near Misses — Missed Opportunities
          </div>
          <div className="text-muted" style={{ fontSize: "0.8rem", marginBottom: 12 }}>
            Tier 1-2 stocks that didn't trigger a buy signal but moved up 5%+ in the past week.
            These may indicate overly strict entry criteria for certain setups.
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Sector</th>
                  <th>Tier</th>
                  <th>Regime</th>
                  <th>Price at Scan</th>
                  <th>Max Price (7d)</th>
                  <th>Missed Move</th>
                  <th>Why No Signal</th>
                </tr>
              </thead>
              <tbody>
                {data.nearMisses.map((m) => (
                  <tr key={m.ticker}>
                    <td>
                      <Link
                        href={`/scanner/${m.ticker}`}
                        style={{ color: "var(--accent-blue)", textDecoration: "none", fontWeight: 600 }}
                      >
                        {m.ticker}
                      </Link>
                      {m.name && (
                        <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                          {m.name}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: "0.78rem" }}>
                      {m.sector ? m.sector.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "-"}
                    </td>
                    <td><span className={`badge badge-tier-${m.tier || 3}`}>T{m.tier || "?"}</span></td>
                    <td>
                      <span className={`badge ${
                        m.regime === "STRONG_UP" || m.regime === "UP" ? "badge-buy"
                        : m.regime === "DOWN" ? "badge-sell" : "badge-neutral"
                      }`}>{m.regime || "-"}</span>
                    </td>
                    <td className="text-mono">{formatNum(m.priceAtScan)}</td>
                    <td className="text-mono">{formatNum(m.maxPrice7d)}</td>
                    <td>
                      <span style={{ color: "var(--accent-green)", fontWeight: 600 }}>
                        +{m.pctMove}%
                      </span>
                    </td>
                    <td style={{ fontSize: "0.78rem", maxWidth: 200, whiteSpace: "normal" }}>
                      {m.reason || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
