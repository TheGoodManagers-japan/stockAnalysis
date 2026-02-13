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
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
