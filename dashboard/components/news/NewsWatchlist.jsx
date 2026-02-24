"use client";

import Link from "next/link";

export default function NewsWatchlist({ watchlist }) {
  return (
    <div className="card" style={{ position: "sticky", top: 80, alignSelf: "start" }}>
      <div className="card-title mb-md" style={{ color: "var(--accent-purple)" }}>
        News Watchlist
      </div>
      {watchlist.length === 0 ? (
        <p className="text-muted" style={{ fontSize: "0.82rem" }}>
          No watchlist candidates yet. Ingest and analyze news to generate signals.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {watchlist.map(w => (
            <div
              key={w.ticker_code}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 8,
                alignItems: "center",
                padding: "8px 0",
                borderBottom: "1px solid var(--border-primary)",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <Link
                    href={`/scanner/${w.ticker_code}`}
                    style={{ color: "var(--accent-blue)", textDecoration: "none", fontWeight: 600, fontFamily: "var(--font-mono)" }}
                  >
                    {w.ticker_code.replace(".T", "")}
                  </Link>
                  {w.max_impact === "high" && (
                    <span className="badge badge-sell" style={{ fontSize: "0.6rem" }}>HIGH IMPACT</span>
                  )}
                  {w.is_buy_now && (
                    <span className="badge badge-buy" style={{ fontSize: "0.6rem" }}>BUY</span>
                  )}
                  {w.tier && (
                    <span className={`badge badge-tier-${w.tier}`} style={{ fontSize: "0.58rem" }}>
                      T{w.tier}
                    </span>
                  )}
                </div>
                {w.short_name && (
                  <div className="text-muted" style={{ fontSize: "0.72rem" }}>{w.short_name}</div>
                )}
                <div className="text-muted" style={{ fontSize: "0.7rem", marginTop: 2, display: "flex", gap: 6, alignItems: "center" }}>
                  <span>{w.article_count} article{w.article_count !== 1 ? "s" : ""} · {w.sources_count} source{w.sources_count !== 1 ? "s" : ""}</span>
                  {w.market_regime && (
                    <span className={`badge ${
                      w.market_regime === "STRONG_UP" || w.market_regime === "UP"
                        ? "badge-buy"
                        : w.market_regime === "DOWN" ? "badge-sell" : "badge-neutral"
                    }`} style={{ fontSize: "0.55rem", padding: "0 4px" }}>
                      {w.market_regime}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{
                  fontSize: "1rem",
                  fontWeight: 700,
                  fontFamily: "var(--font-mono)",
                  color: w.avg_sentiment > 0.3 ? "var(--accent-green)" : w.avg_sentiment < -0.3 ? "var(--accent-red)" : "var(--text-primary)",
                }}>
                  {Number(w.composite_score).toFixed(2)}
                </div>
                <span className={`badge ${w.max_impact === "high" ? "badge-sell" : w.max_impact === "medium" ? "badge-hold" : "badge-neutral"}`} style={{ fontSize: "0.6rem" }}>
                  {w.max_impact}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
