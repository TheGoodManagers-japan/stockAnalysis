import { Suspense } from "react";
import { query } from "../lib/db";
import Link from "next/link";
import ReportHeader from "../components/dashboard/ReportHeader";
import PortfolioActionsSection from "../components/dashboard/PortfolioActionsSection";
import BuySignalsSection from "../components/dashboard/BuySignalsSection";
import ValuePlaysSection from "../components/dashboard/ValuePlaysSection";
import SpaceFundSection from "../components/dashboard/SpaceFundSection";
import WatchlistSection from "../components/dashboard/WatchlistSection";

export const dynamic = "force-dynamic";

// --- Data fetchers (all run in parallel) ---

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

    // Batch query: get latest price for ALL open holdings at once (fixes N+1)
    const tickerCodes = open.rows.map((h) => h.ticker_code);
    const [prices, realizedResult] = await Promise.all([
      query(
        `SELECT DISTINCT ON (ticker_code) ticker_code, current_price
         FROM stock_snapshots
         WHERE ticker_code = ANY($1)
         ORDER BY ticker_code, snapshot_date DESC`,
        [tickerCodes]
      ),
      query(
        `SELECT COALESCE(SUM(pnl_amount), 0) as total FROM portfolio_holdings WHERE status = 'closed'`
      ),
    ]);

    const priceMap = {};
    for (const p of prices.rows) {
      priceMap[p.ticker_code] = Number(p.current_price);
    }

    let totalCost = 0;
    let totalValue = 0;
    for (const h of open.rows) {
      const cost = Number(h.entry_price) * Number(h.shares);
      totalCost += cost;
      const price = priceMap[h.ticker_code] || Number(h.entry_price);
      totalValue += price * Number(h.shares);
    }

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

async function getPositionActions() {
  try {
    const scanRun = await query(
      `SELECT scan_id FROM scan_runs WHERE status = 'completed' ORDER BY started_at DESC LIMIT 1`
    );
    if (scanRun.rows.length === 0) return [];

    const result = await query(
      `SELECT ph.ticker_code, t.short_name, sr.mgmt_signal_status, sr.mgmt_signal_reason, sr.current_price,
              ph.entry_price, ph.shares
       FROM portfolio_holdings ph
       LEFT JOIN scan_results sr ON sr.ticker_code = ph.ticker_code AND sr.scan_id = $1
       LEFT JOIN tickers t ON t.code = ph.ticker_code
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
    return result.rows
      .sort((a, b) => Number(b.predicted_pct_change) - Number(a.predicted_pct_change))
      .slice(0, 5);
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

async function getValuePlays() {
  try {
    const scanRun = await query(
      `SELECT scan_id FROM scan_runs WHERE status = 'completed' ORDER BY started_at DESC LIMIT 1`
    );
    if (scanRun.rows.length === 0) return [];

    const result = await query(
      `SELECT sr.ticker_code, sr.current_price, sr.value_play_score, sr.value_play_grade,
              sr.value_play_class, sr.tier,
              t.short_name, t.sector
       FROM scan_results sr
       LEFT JOIN tickers t ON t.code = sr.ticker_code
       WHERE sr.scan_id = $1 AND sr.is_value_candidate = true
       ORDER BY sr.value_play_score DESC NULLS LAST
       LIMIT 5`,
      [scanRun.rows[0].scan_id]
    );
    return result.rows;
  } catch {
    return [];
  }
}

async function getSpaceFundSummary() {
  try {
    const snapshot = await query(
      `SELECT total_value, total_cost, unrealized_pnl, unrealized_pnl_pct, snapshot_date, holdings_json
       FROM space_fund_snapshots ORDER BY snapshot_date DESC LIMIT 1`
    );
    if (snapshot.rows.length === 0) return null;

    const s = snapshot.rows[0];
    const holdings = s.holdings_json || [];
    const driftAlerts = Array.isArray(holdings)
      ? holdings.filter(h => Math.abs(h.drift || 0) > 0.05).length
      : 0;

    return {
      totalValue: Math.round(Number(s.total_value)),
      totalCost: Math.round(Number(s.total_cost)),
      unrealizedPnl: Math.round(Number(s.unrealized_pnl)),
      unrealizedPnlPct: Number(s.unrealized_pnl_pct),
      driftAlerts,
      snapshotDate: s.snapshot_date,
    };
  } catch {
    return null;
  }
}

async function getWatchlistUpdates() {
  try {
    const result = await query(
      `WITH ticker_news AS (
         SELECT
           nat.ticker_code,
           COUNT(*) as article_count,
           AVG(na.sentiment_score) as avg_sentiment,
           MAX(na.impact_level) as max_impact,
           COUNT(DISTINCT na.source) as sources_count,
           COUNT(*) FILTER (WHERE na.published_at >= NOW() - INTERVAL '24 hours') as recent_count
         FROM news_article_tickers nat
         JOIN news_articles na ON na.id = nat.article_id
         WHERE na.is_analyzed = TRUE
           AND na.published_at >= NOW() - INTERVAL '7 days'
           AND na.relevance_score >= 0.3
         GROUP BY nat.ticker_code
         HAVING AVG(na.sentiment_score) >= -0.1
       )
       SELECT
         tn.ticker_code,
         t.short_name,
         tn.article_count,
         ROUND(tn.avg_sentiment::numeric, 2) as avg_sentiment,
         tn.max_impact,
         ROUND((
           (LEAST(tn.avg_sentiment, 1.0) * 0.35) +
           (CASE tn.max_impact WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END / 3.0 * 0.30) +
           (LEAST(tn.article_count / 5.0, 1.0) * 0.15) +
           (CASE WHEN tn.article_count > 0 THEN tn.recent_count::float / tn.article_count ELSE 0 END * 0.10) +
           (LEAST(tn.sources_count / 2.0, 1.0) * 0.10)
         )::numeric, 3) as composite_score
       FROM ticker_news tn
       LEFT JOIN tickers t ON t.code = tn.ticker_code
       ORDER BY composite_score DESC
       LIMIT 5`
    );
    return result.rows;
  } catch {
    return [];
  }
}

// --- Suspense-streamed async sections ---

function SectionSkeleton() {
  return (
    <div className="card" style={{ marginBottom: 14, padding: 24, textAlign: "center" }}>
      <span className="spinner" />
    </div>
  );
}

async function ValuePlaysBlock() {
  const valuePlays = await getValuePlays();
  return <ValuePlaysSection valuePlays={valuePlays} />;
}

async function SpaceFundBlock() {
  const spaceFund = await getSpaceFundSummary();
  return <SpaceFundSection spaceFund={spaceFund} />;
}

async function PredictionsBlock() {
  const predictions = await getTopPredictions();
  if (predictions.length === 0) return null;
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ color: "var(--text-heading)", fontSize: "0.92rem", fontWeight: 600, margin: 0 }}>
          Top Predicted Upside (30d)
        </h3>
      </div>
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
  );
}

async function NewsBlock() {
  const latestNews = await getLatestNews();
  if (latestNews.length === 0) return null;
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ color: "var(--text-heading)", fontSize: "0.92rem", fontWeight: 600, margin: 0 }}>
          News Highlights
        </h3>
        <Link href="/news" style={{ color: "var(--accent-blue)", textDecoration: "none", fontSize: "0.78rem" }}>
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
                  {n.title || n.title_ja}
                </div>
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
                  className={`badge ${n.sentiment === "Bullish" ? "badge-buy" : n.sentiment === "Bearish" ? "badge-sell" : "badge-neutral"}`}
                >
                  {n.sentiment}
                </span>
                <span
                  className={`badge ${n.impact_level === "high" ? "badge-sell" : n.impact_level === "medium" ? "badge-hold" : "badge-neutral"}`}
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
  );
}

async function WatchlistBlock() {
  const watchlist = await getWatchlistUpdates();
  return <WatchlistSection watchlist={watchlist} />;
}

// --- Page component ---

export default async function HomePage() {
  // Critical path: only await the 3 most important queries
  const [scan, portfolio, actions] = await Promise.all([
    getLatestScan(),
    getPortfolioSummary(),
    getPositionActions(),
  ]);

  if (!scan) {
    return (
      <>
        <ReportHeader scan={null} portfolio={null} buyCount={0} valuePlayCount={0} actionCount={0} />
        <div className="card">
          <p className="text-muted">
            No scan results yet. Click &quot;Run Scan&quot; to analyze the JPX stock universe.
          </p>
        </div>
      </>
    );
  }

  const buyCount = scan.topBuys?.length || scan.buy_count || 0;
  const actionCount = actions.length;

  return (
    <>
      <ReportHeader
        scan={scan}
        portfolio={portfolio}
        buyCount={buyCount}
        valuePlayCount={0}
        actionCount={actionCount}
      />

      {/* Portfolio Actions (urgent — shown first) */}
      <PortfolioActionsSection actions={actions} />

      {/* New Buy Signals */}
      <BuySignalsSection buySignals={scan.topBuys} />

      {/* Streamed sections — render independently as data arrives */}
      <Suspense fallback={<SectionSkeleton />}>
        <ValuePlaysBlock />
      </Suspense>

      <Suspense fallback={<SectionSkeleton />}>
        <SpaceFundBlock />
      </Suspense>

      <Suspense fallback={<SectionSkeleton />}>
        <PredictionsBlock />
      </Suspense>

      <Suspense fallback={<SectionSkeleton />}>
        <NewsBlock />
      </Suspense>

      <Suspense fallback={<SectionSkeleton />}>
        <WatchlistBlock />
      </Suspense>
    </>
  );
}
