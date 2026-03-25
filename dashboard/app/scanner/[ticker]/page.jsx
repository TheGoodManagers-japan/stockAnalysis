import { query } from "../../../lib/db";
import Link from "next/link";
import StockDetailTabs from "./StockDetailTabs";
import { formatNum, masterScoreColor } from "../../../lib/uiHelpers";

export const dynamic = "force-dynamic";

async function getStockDetail(tickerCode) {
  try {
    const [scanResult, history, snapshot, news, prediction, recentNews, aiReview] = await Promise.all([
      query(
        `SELECT sr.*, t.short_name, t.sector,
                sr.master_score,
                (sr.other_data_json->>'scoring_confidence')::numeric AS scoring_confidence,
                (sr.other_data_json->>'data_freshness') AS data_freshness,
                (sr.other_data_json->>'tier_trajectory') AS tier_trajectory,
                (sr.other_data_json->>'is_conflicted')::boolean AS is_conflicted,
                (sr.other_data_json->>'score_disagreement')::numeric AS score_disagreement,
                (sr.other_data_json->>'fundPctile')::int AS fund_pctile,
                (sr.other_data_json->>'valPctile')::int AS val_pctile,
                (sr.other_data_json->>'techPctile')::int AS tech_pctile,
                (sr.other_data_json->>'catalyst_score')::numeric AS catalyst_score,
                (sr.other_data_json->>'catalyst_reason') AS catalyst_reason
         FROM scan_results sr
         JOIN tickers t ON t.code = sr.ticker_code
         WHERE sr.ticker_code = $1
         ORDER BY sr.scan_date DESC LIMIT 1`,
        [tickerCode]
      ),
      query(
        `SELECT date, open, high, low, close, volume
         FROM price_history WHERE ticker_code = $1
         ORDER BY date DESC LIMIT 250`,
        [tickerCode]
      ),
      query(
        `SELECT * FROM stock_snapshots
         WHERE ticker_code = $1
         ORDER BY snapshot_date DESC LIMIT 1`,
        [tickerCode]
      ),
      query(
        `SELECT * FROM news_analysis_cache
         WHERE ticker_code = $1
         ORDER BY analysis_date DESC LIMIT 1`,
        [tickerCode]
      ),
      query(
        `SELECT * FROM predictions
         WHERE ticker_code = $1
         ORDER BY prediction_date DESC LIMIT 1`,
        [tickerCode]
      ).catch(() => ({ rows: [] })),
      query(
        `SELECT na.id, na.source, na.source_url, na.title, na.title_ja,
                na.published_at, na.sentiment, na.sentiment_score,
                na.impact_level, na.news_category, na.ai_summary
         FROM news_articles na
         JOIN news_article_tickers nat ON nat.article_id = na.id
         WHERE nat.ticker_code = $1 AND na.is_analyzed = TRUE
         ORDER BY na.published_at DESC
         LIMIT 10`,
        [tickerCode]
      ).catch(() => ({ rows: [] })),
      query(
        `SELECT verdict, reason as verdict_reason, confidence, full_analysis
         FROM ai_reviews
         WHERE ticker_code = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [tickerCode]
      ).catch(() => ({ rows: [] })),
    ]);

    return {
      scan: scanResult.rows[0] || null,
      history: history.rows.reverse(),
      snapshot: snapshot.rows[0] || null,
      news: news.rows[0] || null,
      prediction: prediction.rows[0] || null,
      recentNews: recentNews.rows || [],
      aiReview: aiReview.rows[0] || null,
    };
  } catch {
    return { scan: null, history: [], snapshot: null, news: null, prediction: null, recentNews: [], aiReview: null };
  }
}

export default async function StockDetailPage({ params, searchParams }) {
  const { ticker } = await params;
  const sp = await searchParams;
  const tickerCode = decodeURIComponent(ticker);
  const defaultView = sp?.view === "value-play" ? "value-play" : "swing-trade";
  const { scan, history, snapshot, news, prediction, recentNews, aiReview } = await getStockDetail(tickerCode);

  return (
    <>
      <div className="mb-md">
        <Link
          href="/scanner"
          style={{ color: "var(--accent-blue)", textDecoration: "none", fontSize: "0.85rem" }}
        >
          ← Back to Scanner
        </Link>
      </div>

      {/* Header */}
      <div className="flex-between mb-lg" style={{ flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ color: "var(--text-heading)", marginBottom: 4 }}>
            {tickerCode}
            {scan?.short_name && (
              <span style={{ fontWeight: 400, color: "var(--text-secondary)", marginLeft: 12, fontSize: "1rem" }}>
                {scan.short_name}
              </span>
            )}
          </h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {scan?.sector && <span className="badge badge-neutral">{scan.sector.replace(/_/g, " ")}</span>}
            {scan?.tier && (
              <span className={`badge badge-tier-${scan.tier}`}>
                Tier {scan.tier}
                {scan.tier_trajectory && scan.tier_trajectory !== "stable" && (
                  <span style={{ marginLeft: 4, fontSize: "0.7rem" }}>
                    {scan.tier_trajectory === "improving" ? "\u25B2" : "\u25BC"}
                  </span>
                )}
              </span>
            )}
            {scan?.is_buy_now && <span className="badge badge-buy">BUY</span>}
            {scan?.market_regime && (
              <span
                className={`badge ${
                  scan.market_regime === "STRONG_UP" || scan.market_regime === "UP"
                    ? "badge-buy"
                    : scan.market_regime === "DOWN"
                    ? "badge-sell"
                    : "badge-neutral"
                }`}
              >
                {scan.market_regime}
              </span>
            )}
            {scan?.is_conflicted && (
              <span className="badge badge-sell" style={{ fontSize: "0.65rem" }}>
                CONFLICTED
              </span>
            )}
            {scan?.data_freshness && scan.data_freshness !== "fresh" && (
              <span className="badge badge-neutral" style={{ fontSize: "0.65rem", color: scan.data_freshness === "stale" ? "var(--accent-red)" : "var(--accent-yellow)" }}>
                {scan.data_freshness.toUpperCase()} DATA
              </span>
            )}
          </div>
        </div>
        <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 16 }}>
          {scan?.master_score != null && (
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                border: `3px solid ${masterScoreColor(scan.master_score)}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
                background: "var(--bg-tertiary)",
              }}
              title={`Master Score: ${scan.master_score}/100`}
            >
              <span style={{ fontSize: "1.2rem", fontWeight: 800, fontFamily: "var(--font-mono)", color: masterScoreColor(scan.master_score) }}>
                {scan.master_score}
              </span>
              <span style={{ fontSize: "0.5rem", color: "var(--text-muted)" }}>SCORE</span>
            </div>
          )}
          <div>
            <div
              style={{
                fontSize: "1.8rem",
                fontWeight: 700,
                fontFamily: "var(--font-mono)",
                color: "var(--text-heading)",
              }}
            >
              {formatNum(scan?.current_price)}
            </div>
            <div className="text-muted" style={{ fontSize: "0.8rem" }}>JPY</div>
          </div>
        </div>
      </div>

      {/* Tab-switched content */}
      <StockDetailTabs
        defaultView={defaultView}
        scan={scan}
        history={history}
        snapshot={snapshot}
        news={news}
        prediction={prediction}
        recentNews={recentNews}
        aiReview={aiReview}
        tickerCode={tickerCode}
        valuePlayData={scan?.value_play_json || null}
        hasValuePlay={!!scan?.is_value_candidate}
      />
    </>
  );
}
