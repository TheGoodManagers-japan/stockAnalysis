import { query } from "../../../lib/db";
import { NextResponse } from "next/server";

// GET /api/suggestions — daily actionable briefing
export async function GET() {
  try {
    // Get latest completed scan ID
    const scanRun = await query(
      `SELECT scan_id FROM scan_runs
       WHERE status = 'completed'
       ORDER BY started_at DESC LIMIT 1`
    );

    if (scanRun.rows.length === 0) {
      return NextResponse.json({
        success: true,
        buyOpportunities: [],
        positionActions: [],
        watchlistAlerts: [],
      });
    }

    const scanId = scanRun.rows[0].scan_id;

    // 1. Top buy opportunities (buy signals sorted by tier + prediction upside)
    const buyOpportunities = await query(
      `SELECT
         sr.ticker_code, t.short_name, t.sector,
         sr.current_price, sr.tier, sr.buy_now_reason, sr.trigger_type,
         sr.short_term_score, sr.long_term_score,
         sr.stop_loss, sr.price_target, sr.limit_buy_order,
         sr.market_regime,
         p.predicted_max_30d, p.predicted_pct_change, p.confidence as pred_confidence
       FROM scan_results sr
       LEFT JOIN tickers t ON t.code = sr.ticker_code
       LEFT JOIN LATERAL (
         SELECT predicted_max_30d, predicted_pct_change, confidence
         FROM predictions
         WHERE ticker_code = sr.ticker_code
         ORDER BY prediction_date DESC LIMIT 1
       ) p ON true
       WHERE sr.scan_id = $1 AND sr.is_buy_now = true
       ORDER BY sr.tier ASC, p.predicted_pct_change DESC NULLS LAST, sr.short_term_score ASC
       LIMIT 10`,
      [scanId]
    );

    // 2. Position actions (open positions with management signals)
    const positionActions = await query(
      `SELECT
         ph.id, ph.ticker_code, t.short_name, t.sector,
         ph.entry_price, ph.shares, ph.current_stop, ph.initial_stop, ph.price_target,
         ph.entry_date, ph.entry_kind,
         sr.current_price, sr.mgmt_signal_status, sr.mgmt_signal_reason,
         sr.short_term_score, sr.long_term_score, sr.market_regime,
         p.predicted_max_30d, p.predicted_pct_change
       FROM portfolio_holdings ph
       LEFT JOIN tickers t ON t.code = ph.ticker_code
       LEFT JOIN LATERAL (
         SELECT current_price, mgmt_signal_status, mgmt_signal_reason,
                short_term_score, long_term_score, market_regime
         FROM scan_results
         WHERE ticker_code = ph.ticker_code AND scan_id = $1
         LIMIT 1
       ) sr ON true
       LEFT JOIN LATERAL (
         SELECT predicted_max_30d, predicted_pct_change
         FROM predictions
         WHERE ticker_code = ph.ticker_code
         ORDER BY prediction_date DESC LIMIT 1
       ) p ON true
       WHERE ph.status = 'open'
       ORDER BY
         CASE sr.mgmt_signal_status
           WHEN 'Sell Now' THEN 1
           WHEN 'Scale Partial' THEN 2
           WHEN 'Protect Profit' THEN 3
           ELSE 4
         END ASC`,
      [scanId]
    );

    // 3. Watchlist alerts (high prediction upside stocks not currently buy signals)
    const watchlistAlerts = await query(
      `SELECT
         p.ticker_code, t.short_name, t.sector,
         p.predicted_max_30d, p.predicted_pct_change, p.confidence, p.current_price,
         sr.tier, sr.short_term_score, sr.long_term_score, sr.market_regime,
         sr.is_buy_now, sr.buy_now_reason
       FROM predictions p
       LEFT JOIN tickers t ON t.code = p.ticker_code
       LEFT JOIN LATERAL (
         SELECT tier, short_term_score, long_term_score, market_regime, is_buy_now, buy_now_reason
         FROM scan_results
         WHERE ticker_code = p.ticker_code AND scan_id = $1
         LIMIT 1
       ) sr ON true
       WHERE p.prediction_date = (SELECT MAX(prediction_date) FROM predictions)
         AND p.predicted_pct_change >= 10
         AND (sr.is_buy_now IS NULL OR sr.is_buy_now = false)
         AND p.ticker_code NOT IN (
           SELECT ticker_code FROM portfolio_holdings WHERE status = 'open'
         )
       ORDER BY p.predicted_pct_change DESC
       LIMIT 10`,
      [scanId]
    );

    // 4. News catalysts — tickers on news watchlist that also have buy signals
    const newsCatalysts = await query(
      `SELECT
         nw.ticker_code, t.short_name, t.sector,
         nw.composite_score as news_score, nw.avg_sentiment, nw.max_impact,
         nw.article_count, nw.top_reason as news_reason,
         sr.is_buy_now, sr.trigger_type, sr.tier, sr.current_price,
         sr.buy_now_reason, sr.stop_loss, sr.price_target, sr.market_regime,
         ar.verdict as ai_verdict, ar.reason as ai_reason, ar.confidence as ai_confidence
       FROM news_watchlist nw
       JOIN scan_results sr ON sr.ticker_code = nw.ticker_code AND sr.scan_id = $1
       LEFT JOIN tickers t ON t.code = nw.ticker_code
       LEFT JOIN ai_reviews ar ON ar.ticker_code = nw.ticker_code AND ar.scan_id = $1
       WHERE nw.generated_at::date = CURRENT_DATE
       ORDER BY sr.is_buy_now DESC, nw.composite_score DESC
       LIMIT 15`,
      [scanId]
    );

    // 5. News context for all relevant tickers (buy opps + positions)
    const allTickers = [
      ...buyOpportunities.rows.map((r) => r.ticker_code),
      ...positionActions.rows.map((r) => r.ticker_code),
    ];
    let newsContext = {};
    if (allTickers.length > 0) {
      const uniqueTickers = [...new Set(allTickers)];
      const newsCtxResult = await query(
        `SELECT
           nat.ticker_code,
           COUNT(*) as article_count,
           ROUND(AVG(na.sentiment_score)::numeric, 2) as avg_sentiment,
           MAX(na.impact_level) as max_impact,
           (array_agg(COALESCE(na.title_ja, na.title) ORDER BY na.published_at DESC))[1] as latest_headline
         FROM news_article_tickers nat
         JOIN news_articles na ON na.id = nat.article_id
         WHERE nat.ticker_code = ANY($1)
           AND na.is_analyzed = TRUE
           AND na.published_at >= NOW() - INTERVAL '7 days'
         GROUP BY nat.ticker_code`,
        [uniqueTickers]
      );
      for (const row of newsCtxResult.rows) {
        newsContext[row.ticker_code] = {
          article_count: Number(row.article_count),
          avg_sentiment: Number(row.avg_sentiment),
          max_impact: row.max_impact,
          latest_headline: row.latest_headline,
        };
      }
    }

    // 6. Daily report (cached, if available for today)
    const dailyReportResult = await query(
      `SELECT report_json, article_count
       FROM daily_news_reports
       WHERE report_date = CURRENT_DATE
       LIMIT 1`
    );
    const dailyReport = dailyReportResult.rows.length > 0
      ? dailyReportResult.rows[0].report_json
      : null;

    // Compute unrealized P&L for position actions
    const enrichedPositions = positionActions.rows.map((pos) => {
      const currentPrice = Number(pos.current_price || pos.entry_price);
      const entryPrice = Number(pos.entry_price);
      const shares = Number(pos.shares);
      const unrealizedPnl = (currentPrice - entryPrice) * shares;
      const unrealizedPct = ((currentPrice - entryPrice) / entryPrice) * 100;
      const stop = Number(pos.current_stop || pos.initial_stop);
      const stopDistance = stop > 0 ? ((currentPrice - stop) / currentPrice) * 100 : null;
      const targetDistance = pos.price_target
        ? ((Number(pos.price_target) - currentPrice) / currentPrice) * 100
        : null;

      return {
        ...pos,
        currentPrice,
        unrealizedPnl: Math.round(unrealizedPnl),
        unrealizedPct: Math.round(unrealizedPct * 100) / 100,
        stopDistancePct: stopDistance ? Math.round(stopDistance * 100) / 100 : null,
        targetDistancePct: targetDistance ? Math.round(targetDistance * 100) / 100 : null,
      };
    });

    return NextResponse.json({
      success: true,
      scanId,
      buyOpportunities: buyOpportunities.rows,
      positionActions: enrichedPositions,
      watchlistAlerts: watchlistAlerts.rows,
      newsCatalysts: newsCatalysts.rows,
      newsContext,
      dailyReport,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
