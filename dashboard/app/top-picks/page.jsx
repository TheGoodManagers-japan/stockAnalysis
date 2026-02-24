"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function TopPicksPage() {
  const [rankings, setRankings] = useState([]);
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all"); // all | buy | tier1

  useEffect(() => {
    fetchRankings();
  }, [selectedDate]);

  async function fetchRankings() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (selectedDate) params.set("date", selectedDate);
      const res = await fetch(`/api/ml/rankings?${params}`);
      const data = await res.json();
      setRankings(data.rankings || []);
      if (data.dates?.length && !selectedDate) {
        setDates(data.dates);
      }
    } catch {
      setRankings([]);
    } finally {
      setLoading(false);
    }
  }

  const filtered = rankings.filter((r) => {
    if (filter === "buy") return r.is_buy_now;
    if (filter === "tier1") return r.tier === 1;
    return true;
  });

  const fmt = (n) => (n != null ? `¥${Math.round(Number(n)).toLocaleString()}` : "-");

  return (
    <>
      <div className="flex-between mb-lg" style={{ flexWrap: "wrap", gap: 12 }}>
        <h2 style={{ color: "var(--text-heading)", margin: 0 }}>ML Top Picks</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{
              background: "var(--bg-secondary)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-primary)",
              borderRadius: 6,
              padding: "6px 10px",
              fontSize: "0.82rem",
            }}
          >
            <option value="all">All Stocks</option>
            <option value="buy">Buy Signals Only</option>
            <option value="tier1">Tier 1 Only</option>
          </select>
          {dates.length > 0 && (
            <select
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={{
                background: "var(--bg-secondary)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-primary)",
                borderRadius: 6,
                padding: "6px 10px",
                fontSize: "0.82rem",
              }}
            >
              <option value="">Latest</option>
              {dates.map((d) => (
                <option key={d} value={String(d).split("T")[0]}>
                  {String(d).split("T")[0]}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {rankings.length > 0 && (
        <div className="card mb-md" style={{ padding: "12px 16px" }}>
          <div style={{ display: "flex", gap: 24, fontSize: "0.82rem", color: "var(--text-secondary)" }}>
            <span>Ranking date: <strong>{String(rankings[0].ranking_date).split("T")[0]}</strong></span>
            <span>Model v{rankings[0].model_version}</span>
            <span>{filtered.length} stocks shown</span>
          </div>
        </div>
      )}

      {loading ? (
        <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
          Loading rankings...
        </div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
          No rankings available yet. Run ML training first.
        </div>
      ) : (
        <div className="card" style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-primary)" }}>
                <th style={thStyle}>#</th>
                <th style={{ ...thStyle, textAlign: "left" }}>Ticker</th>
                <th style={{ ...thStyle, textAlign: "left" }}>Name</th>
                <th style={thStyle}>Predicted Return</th>
                <th style={thStyle}>Price</th>
                <th style={thStyle}>Tier</th>
                <th style={thStyle}>Signal</th>
                <th style={thStyle}>Regime</th>
                <th style={thStyle}>Fund</th>
                <th style={thStyle}>Val</th>
                <th style={thStyle}>Tech</th>
                <th style={thStyle}>ST</th>
                <th style={thStyle}>Target</th>
                <th style={thStyle}>Stop</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const retVal = Number(r.predicted_return_10d);
                const retColor =
                  retVal > 5 ? "var(--accent-green)" :
                  retVal > 2 ? "#66bb6a" :
                  retVal > 0 ? "var(--text-primary)" :
                  retVal > -2 ? "var(--accent-yellow)" :
                  "var(--accent-red)";
                return (
                  <tr
                    key={r.ticker_code}
                    style={{
                      borderBottom: "1px solid var(--border-primary)",
                      cursor: "pointer",
                    }}
                    onClick={() => window.location.href = `/scanner/${encodeURIComponent(r.ticker_code)}`}
                  >
                    <td style={{ ...tdStyle, fontWeight: 600, color: "var(--text-muted)" }}>
                      {r.rank_position}
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>
                      <Link
                        href={`/scanner/${encodeURIComponent(r.ticker_code)}`}
                        style={{ color: "var(--accent-blue)", textDecoration: "none" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.ticker_code}
                      </Link>
                    </td>
                    <td style={{ ...tdStyle, color: "var(--text-secondary)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.short_name || "-"}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700, color: retColor }}>
                      {retVal >= 0 ? "+" : ""}{retVal.toFixed(2)}%
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--font-mono)" }}>
                      {fmt(r.current_price)}
                    </td>
                    <td style={tdStyle}>
                      {r.tier && <span className={`badge badge-tier-${r.tier}`}>T{r.tier}</span>}
                    </td>
                    <td style={tdStyle}>
                      {r.is_buy_now ? (
                        <span className="badge badge-buy">{r.trigger_type || "BUY"}</span>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span className={`badge ${
                        r.market_regime === "STRONG_UP" || r.market_regime === "UP" ? "badge-buy" :
                        r.market_regime === "DOWN" ? "badge-sell" : "badge-neutral"
                      }`} style={{ fontSize: "0.7rem" }}>
                        {r.market_regime || "-"}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--font-mono)" }}>
                      {r.fundamental_score != null ? Number(r.fundamental_score).toFixed(1) : "-"}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--font-mono)" }}>
                      {r.valuation_score != null ? Number(r.valuation_score).toFixed(1) : "-"}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--font-mono)" }}>
                      {r.technical_score != null ? Number(r.technical_score).toFixed(1) : "-"}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      {r.short_term_score ?? "-"}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--accent-green)", fontSize: "0.78rem" }}>
                      {fmt(r.price_target)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--accent-red)", fontSize: "0.78rem" }}>
                      {fmt(r.stop_loss)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const thStyle = {
  padding: "10px 8px",
  textAlign: "center",
  fontSize: "0.75rem",
  color: "var(--text-muted)",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  whiteSpace: "nowrap",
};

const tdStyle = {
  padding: "10px 8px",
  textAlign: "center",
  whiteSpace: "nowrap",
};
