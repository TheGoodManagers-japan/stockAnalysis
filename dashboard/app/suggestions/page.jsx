"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

function formatNum(v) {
  if (v == null) return "-";
  return Number(v).toLocaleString();
}

export default function SuggestionsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSuggestions() {
      try {
        const res = await fetch("/api/suggestions");
        const json = await res.json();
        if (json.success) setData(json);
      } catch (err) {
        console.error("Failed to fetch suggestions:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchSuggestions();
  }, []);

  if (loading) {
    return (
      <>
        <h2 className="mb-lg" style={{ color: "var(--text-heading)" }}>Daily Suggestions</h2>
        <div style={{ padding: 40, textAlign: "center" }}><span className="spinner" /></div>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <h2 className="mb-lg" style={{ color: "var(--text-heading)" }}>Daily Suggestions</h2>
        <div className="card"><p className="text-muted">No data available. Run a scan first.</p></div>
      </>
    );
  }

  return (
    <>
      <h2 className="mb-lg" style={{ color: "var(--text-heading)" }}>Daily Suggestions</h2>

      {/* Position Actions — urgent, shown first */}
      {data.positionActions.length > 0 && (
        <div className="card mb-lg">
          <div className="card-title mb-md" style={{ color: "var(--accent-orange)" }}>
            Position Actions
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.positionActions.map((pos) => (
              <div
                key={pos.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr auto",
                  gap: 12,
                  alignItems: "center",
                  padding: 12,
                  background: "var(--bg-tertiary)",
                  borderRadius: "var(--radius-md)",
                  borderLeft: `3px solid ${
                    pos.mgmt_signal_status === "Sell Now"
                      ? "var(--accent-red)"
                      : pos.mgmt_signal_status === "Protect Profit"
                      ? "var(--accent-yellow)"
                      : "var(--accent-green)"
                  }`,
                }}
              >
                <div>
                  <Link
                    href={`/scanner/${pos.ticker_code}`}
                    style={{ color: "var(--accent-blue)", textDecoration: "none", fontWeight: 600, fontSize: "1rem" }}
                  >
                    {pos.ticker_code}
                  </Link>
                  {pos.short_name && (
                    <div className="text-muted" style={{ fontSize: "0.75rem" }}>{pos.short_name}</div>
                  )}
                </div>
                <div>
                  <div className="text-muted" style={{ fontSize: "0.72rem" }}>Unrealized P&L</div>
                  <div
                    className="text-mono"
                    style={{
                      fontWeight: 600,
                      color: pos.unrealizedPnl >= 0 ? "var(--accent-green)" : "var(--accent-red)",
                    }}
                  >
                    {pos.unrealizedPnl >= 0 ? "+" : ""}
                    {formatNum(pos.unrealizedPnl)} ({pos.unrealizedPct}%)
                  </div>
                </div>
                <div>
                  <div className="text-muted" style={{ fontSize: "0.72rem" }}>Signal</div>
                  <span
                    className={`badge ${
                      pos.mgmt_signal_status === "Sell Now"
                        ? "badge-sell"
                        : pos.mgmt_signal_status === "Protect Profit"
                        ? "badge-buy"
                        : "badge-neutral"
                    }`}
                  >
                    {pos.mgmt_signal_status}
                  </span>
                </div>
                <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", maxWidth: 200 }}>
                  {pos.mgmt_signal_reason || ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Buy Opportunities */}
      <div className="card mb-lg">
        <div className="card-title mb-md" style={{ color: "var(--accent-green)" }}>
          Buy Opportunities
        </div>
        {data.buyOpportunities.length === 0 ? (
          <p className="text-muted">No buy signals in the latest scan.</p>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Sector</th>
                  <th>Price</th>
                  <th>Tier</th>
                  <th>Signal</th>
                  <th>Stop</th>
                  <th>Target</th>
                  <th>Pred. Upside</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {data.buyOpportunities.map((stock) => (
                  <tr key={stock.ticker_code}>
                    <td>
                      <Link
                        href={`/scanner/${stock.ticker_code}`}
                        style={{ color: "var(--accent-blue)", textDecoration: "none", fontWeight: 600 }}
                      >
                        {stock.ticker_code}
                      </Link>
                      {stock.short_name && (
                        <div className="text-muted" style={{ fontSize: "0.72rem" }}>{stock.short_name}</div>
                      )}
                    </td>
                    <td className="text-muted" style={{ fontSize: "0.78rem" }}>
                      {stock.sector ? stock.sector.replace(/_/g, " ") : "-"}
                    </td>
                    <td className="text-mono">{formatNum(stock.current_price)}</td>
                    <td>
                      <span className={`badge badge-tier-${stock.tier || 3}`}>T{stock.tier || "?"}</span>
                    </td>
                    <td>
                      <span className="badge badge-neutral" style={{ fontSize: "0.7rem" }}>
                        {stock.trigger_type || "BUY"}
                      </span>
                    </td>
                    <td className="text-mono text-red">{formatNum(stock.stop_loss)}</td>
                    <td className="text-mono text-green">{formatNum(stock.price_target)}</td>
                    <td className="text-mono" style={{ color: "var(--accent-blue)" }}>
                      {stock.predicted_pct_change
                        ? `+${Number(stock.predicted_pct_change).toFixed(1)}%`
                        : "-"}
                    </td>
                    <td style={{ fontSize: "0.78rem", maxWidth: 250, whiteSpace: "normal" }}>
                      {stock.buy_now_reason || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Watchlist Alerts */}
      {data.watchlistAlerts.length > 0 && (
        <div className="card">
          <div className="card-title mb-md" style={{ color: "var(--accent-purple)" }}>
            Watchlist Alerts (High Predicted Upside)
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Sector</th>
                  <th>Price</th>
                  <th>Predicted Max</th>
                  <th>Upside</th>
                  <th>Confidence</th>
                  <th>Tier</th>
                  <th>Regime</th>
                </tr>
              </thead>
              <tbody>
                {data.watchlistAlerts.map((stock) => (
                  <tr key={stock.ticker_code}>
                    <td>
                      <Link
                        href={`/scanner/${stock.ticker_code}`}
                        style={{ color: "var(--accent-blue)", textDecoration: "none", fontWeight: 600 }}
                      >
                        {stock.ticker_code}
                      </Link>
                      {stock.short_name && (
                        <div className="text-muted" style={{ fontSize: "0.72rem" }}>{stock.short_name}</div>
                      )}
                    </td>
                    <td className="text-muted" style={{ fontSize: "0.78rem" }}>
                      {stock.sector ? stock.sector.replace(/_/g, " ") : "-"}
                    </td>
                    <td className="text-mono">{formatNum(stock.current_price)}</td>
                    <td className="text-mono text-green">{formatNum(stock.predicted_max_30d)}</td>
                    <td className="text-mono" style={{ color: "var(--accent-green)", fontWeight: 600 }}>
                      +{Number(stock.predicted_pct_change).toFixed(1)}%
                    </td>
                    <td>
                      <div
                        style={{
                          width: 50,
                          height: 6,
                          background: "var(--bg-tertiary)",
                          borderRadius: 3,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${Number(stock.confidence) * 100}%`,
                            height: "100%",
                            background: "var(--accent-blue)",
                            borderRadius: 3,
                          }}
                        />
                      </div>
                    </td>
                    <td>
                      {stock.tier ? (
                        <span className={`badge badge-tier-${stock.tier}`}>T{stock.tier}</span>
                      ) : "-"}
                    </td>
                    <td className="text-muted">{stock.market_regime || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
