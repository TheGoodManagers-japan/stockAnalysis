"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import NewsContextBadge from "../../components/ui/NewsContextBadge";
import { formatNum, formatSector, sentimentColor, scoreColor, VERDICT_CONFIG } from "../../lib/uiHelpers";

export default function SuggestionsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pulseExpanded, setPulseExpanded] = useState(true);

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
        <h2 className="mb-lg" style={{ color: "var(--text-heading)" }}>Daily Briefing</h2>
        <div style={{ padding: 40, textAlign: "center" }}><span className="spinner" /></div>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <h2 className="mb-lg" style={{ color: "var(--text-heading)" }}>Daily Briefing</h2>
        <div className="card">
          <p className="text-muted">
            No scan data available yet.{" "}
            <Link href="/scanner" style={{ color: "var(--accent-blue)", textDecoration: "none" }}>
              Run a scan
            </Link>{" "}
            to populate the daily briefing.
          </p>
        </div>
      </>
    );
  }

  const report = data.dailyReport;
  const newsCtx = data.newsContext || {};
  const meta = data.scanMeta;

  return (
    <>
      <h2 className="mb-lg" style={{ color: "var(--text-heading)" }}>Daily Briefing</h2>

      {/* Scan Freshness Banner */}
      {meta && (
        <div
          className="card mb-lg"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "10px 16px",
            borderLeft: `3px solid ${
              meta.ageDays <= 1 ? "var(--accent-green)"
                : meta.ageDays <= 3 ? "var(--accent-yellow)"
                : "var(--accent-red)"
            }`,
          }}
        >
          <div style={{ fontSize: "0.82rem", color: "var(--text-primary)" }}>
            <strong>Last scan:</strong>{" "}
            {meta.finishedAt
              ? new Date(meta.finishedAt).toLocaleDateString("en-US", {
                  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                })
              : "Unknown"}
            <span style={{
              marginLeft: 8,
              color: meta.ageDays <= 1 ? "var(--accent-green)"
                : meta.ageDays <= 3 ? "var(--accent-yellow)"
                : "var(--accent-red)",
              fontWeight: 600,
            }}>
              ({meta.ageDays === 0 ? "today" : `${meta.ageDays}d ago`})
            </span>
          </div>
          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", display: "flex", gap: 12 }}>
            <span>{meta.totalTickers || meta.tickerCount || "?"} tickers</span>
            <span>{meta.buyCount || 0} buy signals</span>
          </div>
          {meta.ageDays >= 3 && (
            <Link
              href="/scanner"
              style={{ marginLeft: "auto", fontSize: "0.78rem", color: "var(--accent-blue)", textDecoration: "none" }}
            >
              Run new scan &rarr;
            </Link>
          )}
        </div>
      )}

      {/* Market Pulse — daily report summary */}
      <div className="card mb-lg" style={{ borderLeft: "3px solid var(--accent-blue)" }}>
        <div
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: report ? "pointer" : "default" }}
          onClick={() => report && setPulseExpanded(!pulseExpanded)}
        >
          <div className="card-title" style={{ color: "var(--accent-blue)", marginBottom: 0 }}>
            Market Pulse
          </div>
          {report && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {report.high_impact_events?.length > 0 && (
                <span className="badge badge-sell" style={{ fontSize: "0.65rem" }}>
                  {report.high_impact_events.length} high-impact
                </span>
              )}
              <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
                {pulseExpanded ? "\u25B2" : "\u25BC"}
              </span>
            </div>
          )}
        </div>
        {report ? (
          pulseExpanded && (
            <div style={{ marginTop: 12 }}>
              {report.market_overview && (
                <p style={{ fontSize: "0.85rem", lineHeight: 1.6, color: "var(--text-primary)", marginBottom: 12 }}>
                  {report.market_overview}
                </p>
              )}
              {report.trading_implications && (
                <p style={{ fontSize: "0.82rem", lineHeight: 1.5, color: "var(--accent-yellow)", fontStyle: "italic" }}>
                  {report.trading_implications}
                </p>
              )}
              <div style={{ marginTop: 8 }}>
                <Link href="/news" style={{ fontSize: "0.78rem", color: "var(--accent-blue)", textDecoration: "none" }}>
                  View full report &rarr;
                </Link>
              </div>
            </div>
          )
        ) : (
          <p className="text-muted" style={{ marginTop: 8, fontSize: "0.82rem" }}>
            No daily report generated yet. Run the news analysis pipeline to generate market context.
          </p>
        )}
      </div>

      {/* News Catalysts — tickers with both news activity AND buy signals */}
      <div className="card mb-lg">
        <div className="card-title mb-md" style={{ color: "var(--accent-purple)" }}>
          News Catalysts
          <span className="text-muted" style={{ fontSize: "0.72rem", fontWeight: 400, marginLeft: 8 }}>
            News watchlist + scan signals
          </span>
        </div>
        {data.newsCatalysts?.length > 0 ? (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>News Score</th>
                  <th>Sentiment</th>
                  <th>Signal</th>
                  <th>Tier</th>
                  <th>Price</th>
                  <th>AI</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {data.newsCatalysts.map((c) => {
                  const sentLabel = c.avg_sentiment > 0.3 ? "Bullish" : c.avg_sentiment < -0.3 ? "Bearish" : "Neutral";
                  const verdict = c.ai_verdict ? VERDICT_CONFIG[c.ai_verdict] : null;
                  return (
                    <tr key={c.ticker_code} className={c.is_buy_now ? "buy-signal" : ""}>
                      <td>
                        <Link
                          href={`/scanner/${c.ticker_code}`}
                          style={{ color: "var(--accent-blue)", textDecoration: "none", fontWeight: 600 }}
                        >
                          {c.ticker_code}
                        </Link>
                        {c.short_name && (
                          <div className="text-muted" style={{ fontSize: "0.72rem" }}>{c.short_name}</div>
                        )}
                      </td>
                      <td className="text-mono" style={{ fontWeight: 600 }}>
                        {Number(c.news_score).toFixed(2)}
                        <div className="text-muted" style={{ fontSize: "0.68rem" }}>
                          {c.article_count} article{c.article_count !== 1 ? "s" : ""}
                        </div>
                      </td>
                      <td>
                        <span style={{ color: sentimentColor(sentLabel), fontSize: "0.82rem", fontWeight: 600 }}>
                          {sentLabel}
                        </span>
                      </td>
                      <td>
                        {c.is_buy_now ? (
                          <span className="badge badge-buy" style={{ fontSize: "0.7rem" }}>
                            {c.trigger_type || "BUY"}
                          </span>
                        ) : (
                          <span className="badge badge-neutral" style={{ fontSize: "0.7rem" }}>-</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge badge-tier-${c.tier || 3}`}>T{c.tier || "?"}</span>
                      </td>
                      <td className="text-mono">{formatNum(c.current_price)}</td>
                      <td>
                        {verdict ? (
                          <span
                            className="badge"
                            style={{ background: verdict.bg, color: verdict.color, border: `1px solid ${verdict.border}`, fontSize: "0.7rem" }}
                          >
                            {verdict.label}
                          </span>
                        ) : "-"}
                      </td>
                      <td style={{ fontSize: "0.78rem", maxWidth: 200, whiteSpace: "normal" }}>
                        {c.buy_now_reason || c.news_reason || "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted" style={{ fontSize: "0.82rem" }}>
            No news catalysts today. Run the news analysis pipeline to generate watchlist data.
          </p>
        )}
      </div>

      {/* Position Actions — urgent, shown after context */}
      <div className="card mb-lg">
        <div className="card-title mb-md" style={{ color: "var(--accent-orange)" }}>
          Position Actions
        </div>
        {data.positionActions.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.positionActions.map((pos) => {
              const posNews = newsCtx[pos.ticker_code];
              return (
                <div
                  key={pos.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr auto auto",
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
                  <div>
                    {posNews && posNews.article_count > 0 ? (
                      <NewsContextBadge
                        articleCount={posNews.article_count}
                        avgSentiment={posNews.avg_sentiment}
                        maxImpact={posNews.max_impact}
                        latestHeadline={posNews.latest_headline}
                        compact
                      />
                    ) : (
                      <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>-</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-muted" style={{ fontSize: "0.82rem" }}>
            No open positions. Add holdings via the{" "}
            <Link href="/portfolio" style={{ color: "var(--accent-blue)", textDecoration: "none" }}>Portfolio</Link>{" "}
            page to see trade management signals here.
          </p>
        )}
      </div>

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
                  <th>News</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {data.buyOpportunities.map((stock) => {
                  const stockNews = newsCtx[stock.ticker_code];
                  return (
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
                      <td>
                        <NewsContextBadge
                          articleCount={stockNews?.article_count}
                          avgSentiment={stockNews?.avg_sentiment}
                          maxImpact={stockNews?.max_impact}
                          latestHeadline={stockNews?.latest_headline}
                          compact
                        />
                      </td>
                      <td style={{ fontSize: "0.78rem", maxWidth: 250, whiteSpace: "normal" }}>
                        {stock.buy_now_reason || "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Top Rated Stocks — always has data from scan_results */}
      {data.topRated?.length > 0 && (
        <div className="card mb-lg">
          <div className="card-title mb-md" style={{ color: "var(--accent-blue)" }}>
            Top Rated Stocks
            <span className="text-muted" style={{ fontSize: "0.72rem", fontWeight: 400, marginLeft: 8 }}>
              Best tier + fundamental/valuation scores from latest scan
            </span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Sector</th>
                  <th>Price</th>
                  <th>Tier</th>
                  <th>Fund.</th>
                  <th>Val.</th>
                  <th>ST</th>
                  <th>LT</th>
                  <th>Regime</th>
                  <th>Signal</th>
                </tr>
              </thead>
              <tbody>
                {data.topRated.map((stock) => (
                  <tr key={stock.ticker_code} className={stock.is_buy_now ? "buy-signal" : ""}>
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
                    <td className="text-mono" style={{ color: scoreColor(stock.fundamental_score) }}>
                      {stock.fundamental_score != null ? Number(stock.fundamental_score).toFixed(1) : "-"}
                    </td>
                    <td className="text-mono" style={{ color: scoreColor(stock.valuation_score) }}>
                      {stock.valuation_score != null ? Number(stock.valuation_score).toFixed(1) : "-"}
                    </td>
                    <td className="text-mono">{stock.short_term_score ?? "-"}</td>
                    <td className="text-mono">{stock.long_term_score ?? "-"}</td>
                    <td className="text-muted" style={{ fontSize: "0.78rem" }}>{stock.market_regime || "-"}</td>
                    <td>
                      {stock.is_buy_now ? (
                        <span className="badge badge-buy" style={{ fontSize: "0.7rem" }}>
                          {stock.trigger_type || "BUY"}
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Watchlist Alerts */}
      <div className="card">
        <div className="card-title mb-md" style={{ color: "var(--accent-purple)" }}>
          Watchlist Alerts (High Predicted Upside)
        </div>
        {data.watchlistAlerts?.length > 0 ? (
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
        ) : (
          <p className="text-muted" style={{ fontSize: "0.82rem" }}>
            No ML prediction alerts. Run the ML training pipeline to generate price predictions.
          </p>
        )}
      </div>
    </>
  );
}
