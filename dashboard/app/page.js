import { query } from "../lib/db";
import Link from "next/link";
import BuySignalReview from "../components/scanner/BuySignalReview";
import StockCard from "../components/scanner/StockCard";
import ErrorsCard from "../components/dashboard/ErrorsCard";

export const dynamic = "force-dynamic";

async function getLatestScan() {
  try {
    const scanResult = await query(
      `SELECT scan_id, started_at, finished_at, ticker_count, total_tickers, buy_count, error_count, errors, status
       FROM scan_runs ORDER BY started_at DESC LIMIT 1`
    );
    if (scanResult.rows.length === 0) return null;

    const scan = scanResult.rows[0];
    const topBuys = await query(
      `SELECT sr.ticker_code, sr.is_buy_now, sr.tier, sr.short_term_score, sr.long_term_score,
              sr.stop_loss, sr.price_target, sr.buy_now_reason, sr.trigger_type,
              sr.current_price, sr.market_regime,
              t.short_name, t.sector,
              ar.verdict, ar.reason AS verdict_reason, ar.full_analysis
       FROM scan_results sr
       LEFT JOIN tickers t ON t.code = sr.ticker_code
       LEFT JOIN ai_reviews ar ON ar.scan_id = sr.scan_id AND ar.ticker_code = sr.ticker_code
       WHERE sr.scan_id = $1 AND sr.is_buy_now = true
       ORDER BY sr.tier ASC, sr.short_term_score ASC
       LIMIT 10`,
      [scan.scan_id]
    );

    return { ...scan, topBuys: topBuys.rows };
  } catch {
    return null;
  }
}

async function getPortfolioSummary() {
  try {
    const open = await query(
      `SELECT ph.ticker_code, ph.entry_price, ph.shares, ph.current_stop, ph.initial_stop
       FROM portfolio_holdings ph WHERE ph.status = 'open'`
    );
    if (open.rows.length === 0) return null;

    let totalCost = 0;
    let totalValue = 0;
    for (const h of open.rows) {
      const cost = Number(h.entry_price) * Number(h.shares);
      totalCost += cost;
      // Get latest price
      const snap = await query(
        `SELECT current_price FROM stock_snapshots
         WHERE ticker_code = $1 ORDER BY snapshot_date DESC LIMIT 1`,
        [h.ticker_code]
      );
      const price = snap.rows.length > 0 ? Number(snap.rows[0].current_price) : Number(h.entry_price);
      totalValue += price * Number(h.shares);
    }

    const realizedResult = await query(
      `SELECT COALESCE(SUM(pnl_amount), 0) as total FROM portfolio_holdings WHERE status = 'closed'`
    );

    return {
      openCount: open.rows.length,
      totalCost: Math.round(totalCost),
      totalValue: Math.round(totalValue),
      unrealizedPnl: Math.round(totalValue - totalCost),
      unrealizedPct: totalCost > 0 ? Math.round(((totalValue - totalCost) / totalCost) * 10000) / 100 : 0,
      realizedPnl: Math.round(Number(realizedResult.rows[0].total)),
    };
  } catch {
    return null;
  }
}

async function getTopPredictions() {
  try {
    const result = await query(
      `SELECT DISTINCT ON (p.ticker_code)
         p.ticker_code, t.short_name, p.predicted_pct_change, p.confidence,
         p.current_price, p.predicted_max_30d
       FROM predictions p
       LEFT JOIN tickers t ON t.code = p.ticker_code
       WHERE p.predicted_pct_change > 0
       ORDER BY p.ticker_code, p.prediction_date DESC`
    );
    // Sort by predicted upside after dedup
    return result.rows
      .sort((a, b) => Number(b.predicted_pct_change) - Number(a.predicted_pct_change))
      .slice(0, 5);
  } catch {
    return [];
  }
}

async function getPositionActions() {
  try {
    const scanRun = await query(
      `SELECT scan_id FROM scan_runs WHERE status = 'completed' ORDER BY started_at DESC LIMIT 1`
    );
    if (scanRun.rows.length === 0) return [];

    const result = await query(
      `SELECT ph.ticker_code, sr.mgmt_signal_status, sr.mgmt_signal_reason, sr.current_price,
              ph.entry_price, ph.shares
       FROM portfolio_holdings ph
       LEFT JOIN scan_results sr ON sr.ticker_code = ph.ticker_code AND sr.scan_id = $1
       WHERE ph.status = 'open'
         AND sr.mgmt_signal_status IS NOT NULL
         AND sr.mgmt_signal_status != 'Hold'
       ORDER BY
         CASE sr.mgmt_signal_status
           WHEN 'Sell Now' THEN 1
           WHEN 'Scale Partial' THEN 2
           WHEN 'Protect Profit' THEN 3
           ELSE 4
         END ASC
       LIMIT 5`,
      [scanRun.rows[0].scan_id]
    );
    return result.rows;
  } catch {
    return [];
  }
}

async function getLatestNews() {
  try {
    const result = await query(
      `SELECT na.id, na.source, na.source_url, na.title, na.title_ja,
              na.published_at, na.sentiment, na.sentiment_score,
              na.impact_level, na.news_category, na.ai_summary,
              COALESCE(
                (SELECT json_agg(json_build_object('ticker_code', nat.ticker_code))
                 FROM news_article_tickers nat WHERE nat.article_id = na.id),
                '[]'::json
              ) as tickers
       FROM news_articles na
       WHERE na.is_analyzed = TRUE AND na.impact_level IN ('high', 'medium')
       ORDER BY na.published_at DESC
       LIMIT 5`
    );
    return result.rows;
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const [scan, portfolio, predictions, actions, latestNews] = await Promise.all([
    getLatestScan(),
    getPortfolioSummary(),
    getTopPredictions(),
    getPositionActions(),
    getLatestNews(),
  ]);

  return (
    <>
      <h2 className="mb-lg" style={{ color: "var(--text-heading)" }}>
        Dashboard
      </h2>

      {!scan ? (
        <div className="card">
          <p className="text-muted">
            No scan results yet. Click &quot;Run Scan&quot; to analyze the JPX stock
            universe.
          </p>
        </div>
      ) : (
        <>
          {/* Scan summary cards */}
          <div className="grid-4 mb-lg">
            <div className="card">
              <div className="card-subtitle">Status</div>
              <div
                style={{
                  fontSize: "1.4rem",
                  fontWeight: 700,
                  color: scan.status === "completed" ? "var(--accent-green)"
                    : scan.status === "failed" ? "var(--accent-red, #ef4444)"
                      : "var(--accent-yellow)",
                }}
              >
                {scan.status === "completed" ? "Complete"
                  : scan.status === "failed" ? "Failed"
                    : scan.total_tickers ? `Running ${Math.round((scan.ticker_count / scan.total_tickers) * 100)}%`
                      : "Running"}
              </div>
              <div className="card-subtitle" style={{ marginTop: 4 }}>
                {scan.started_at ? new Date(scan.started_at).toLocaleString("ja-JP") : ""}
              </div>
            </div>

            <div className="card">
              <div className="card-subtitle">Stocks Scanned</div>
              <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--text-heading)" }}>
                {scan.ticker_count || 0}
              </div>
            </div>

            <div className="card">
              <div className="card-subtitle">Buy Signals</div>
              <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--accent-green)" }}>
                {scan.buy_count || 0}
              </div>
            </div>

            <ErrorsCard
              errorCount={scan.error_count || 0}
              errors={scan.errors || []}
            />
          </div>

          {/* Portfolio Summary + Actions row */}
          <div className="grid-2 mb-lg">
            {/* Portfolio Summary */}
            <div className="card">
              <div className="card-title mb-md">Portfolio Summary</div>
              {portfolio ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <div className="card-subtitle">Open Positions</div>
                    <div style={{ fontSize: "1.2rem", fontWeight: 600, color: "var(--text-heading)" }}>
                      {portfolio.openCount}
                    </div>
                  </div>
                  <div>
                    <div className="card-subtitle">Total Value</div>
                    <div className="text-mono" style={{ fontSize: "1.2rem", fontWeight: 600 }}>
                      {portfolio.totalValue.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="card-subtitle">Unrealized P&L</div>
                    <div
                      className="text-mono"
                      style={{
                        fontSize: "1.2rem",
                        fontWeight: 600,
                        color: portfolio.unrealizedPnl >= 0 ? "var(--accent-green)" : "var(--accent-red)",
                      }}
                    >
                      {portfolio.unrealizedPnl >= 0 ? "+" : ""}
                      {portfolio.unrealizedPnl.toLocaleString()} ({portfolio.unrealizedPct}%)
                    </div>
                  </div>
                  <div>
                    <div className="card-subtitle">Realized P&L</div>
                    <div
                      className="text-mono"
                      style={{
                        fontSize: "1.2rem",
                        fontWeight: 600,
                        color: portfolio.realizedPnl >= 0 ? "var(--accent-green)" : "var(--accent-red)",
                      }}
                    >
                      {portfolio.realizedPnl >= 0 ? "+" : ""}
                      {portfolio.realizedPnl.toLocaleString()}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-muted">No open positions.</p>
              )}
            </div>

            {/* Position Actions */}
            <div className="card">
              <div className="card-title mb-md">Position Actions</div>
              {actions.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {actions.map((a) => (
                    <div
                      key={a.ticker_code}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "6px 0",
                        borderBottom: "1px solid var(--border-primary)",
                      }}
                    >
                      <Link
                        href={`/scanner/${a.ticker_code}`}
                        style={{ color: "var(--accent-blue)", textDecoration: "none", fontWeight: 600 }}
                      >
                        {a.ticker_code}
                      </Link>
                      <span
                        className={`badge ${a.mgmt_signal_status === "Sell Now"
                            ? "badge-sell"
                            : a.mgmt_signal_status === "Protect Profit"
                              ? "badge-buy"
                              : "badge-neutral"
                          }`}
                      >
                        {a.mgmt_signal_status}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted">All positions holding steady.</p>
              )}
            </div>
          </div>

          {/* Prediction Highlights */}
          {predictions.length > 0 && (
            <div className="card mb-lg">
              <div className="card-title mb-md">Top Predicted Upside (30d)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {predictions.map((p) => (
                  <div className="prediction-card" key={p.ticker_code}>
                    <div className="prediction-card-info">
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Link
                          href={`/scanner/${p.ticker_code}`}
                          className="stock-card-ticker"
                        >
                          {p.ticker_code}
                        </Link>
                        <span className="text-muted" style={{ fontSize: "0.78rem" }}>
                          {p.short_name || ""}
                        </span>
                      </div>
                      <div className="prediction-card-prices">
                        <span>Now: <span className="text-mono">{Number(p.current_price).toLocaleString()}</span></span>
                        <span>Target: <span className="text-mono text-green">{Number(p.predicted_max_30d).toLocaleString()}</span></span>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                      <div className="prediction-card-upside">
                        +{Number(p.predicted_pct_change).toFixed(1)}%
                      </div>
                      <div
                        style={{
                          width: 60,
                          height: 6,
                          background: "var(--bg-tertiary)",
                          borderRadius: 3,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${Number(p.confidence) * 100}%`,
                            height: "100%",
                            background: "var(--accent-blue)",
                            borderRadius: 3,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Latest News */}
          {latestNews.length > 0 && (
            <div className="card mb-lg">
              <div className="card-header">
                <div className="card-title">Latest News</div>
                <Link href="/news" style={{ color: "var(--accent-blue)", textDecoration: "none", fontSize: "0.82rem" }}>
                  View all →
                </Link>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {latestNews.map((n) => {
                  const tickers = typeof n.tickers === "string" ? JSON.parse(n.tickers) : n.tickers || [];
                  return (
                    <div
                      key={n.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "start",
                        gap: 12,
                        padding: "8px 0",
                        borderBottom: "1px solid var(--border-primary)",
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3 }}>
                          <span className="badge badge-source" data-source={n.source} style={{ fontSize: "0.62rem" }}>
                            {n.source}
                          </span>
                          <span className="text-muted" style={{ fontSize: "0.7rem" }}>
                            {n.published_at ? new Date(n.published_at).toLocaleDateString("ja-JP") : ""}
                          </span>
                        </div>
                        <div style={{ fontSize: "0.85rem", fontWeight: 500, marginBottom: 2 }}>
                          {n.title_ja || n.title}
                        </div>
                        {n.ai_summary && (
                          <div className="text-muted" style={{ fontSize: "0.75rem" }}>{n.ai_summary}</div>
                        )}
                        {tickers.length > 0 && (
                          <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                            {tickers.slice(0, 5).map((t) => (
                              <Link
                                key={t.ticker_code}
                                href={`/scanner/${t.ticker_code}`}
                                style={{
                                  fontSize: "0.72rem",
                                  fontFamily: "var(--font-mono)",
                                  color: "var(--accent-blue)",
                                  textDecoration: "none",
                                  background: "rgba(59, 130, 246, 0.1)",
                                  padding: "1px 5px",
                                  borderRadius: 3,
                                }}
                              >
                                {t.ticker_code.replace(".T", "")}
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <span
                          className={`badge ${n.sentiment === "Bullish" ? "badge-buy" : n.sentiment === "Bearish" ? "badge-sell" : "badge-neutral"
                            }`}
                        >
                          {n.sentiment}
                        </span>
                        <span
                          className={`badge ${n.impact_level === "high" ? "badge-sell" : n.impact_level === "medium" ? "badge-hold" : "badge-neutral"
                            }`}
                          style={{ fontSize: "0.65rem" }}
                        >
                          {n.impact_level}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Top buy signals */}
          {scan.topBuys && scan.topBuys.length > 0 && (
            <div className="mb-lg">
              <div className="flex-between mb-md">
                <h3 style={{ color: "var(--text-heading)", fontSize: "1.05rem", fontWeight: 600 }}>
                  Top Buy Signals
                </h3>
                <Link href="/scanner" style={{ color: "var(--accent-blue)", textDecoration: "none", fontSize: "0.82rem" }}>
                  View all →
                </Link>
              </div>
              <div className="stock-card-grid">
                {scan.topBuys.map((s) => (
                  <StockCard
                    key={s.ticker_code}
                    stock={s}
                    initialReview={s.verdict ? { verdict: s.verdict, verdict_reason: s.verdict_reason } : null}
                  />
                ))}
              </div>
            </div>
          )}

          {/* AI Buy Signal Review */}
          {scan.topBuys && scan.topBuys.length > 0 && (
            <div className="mb-lg">
              <BuySignalReview />
            </div>
          )}
        </>
      )}
    </>
  );
}
