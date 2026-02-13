import { query } from "../../../lib/db";
import { NextResponse } from "next/server";

// GET /api/history-scan?ticker=7203.T&days=30
// Returns historical scan results for a ticker over time
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get("ticker");
    const days = parseInt(searchParams.get("days") || "60", 10);

    if (!ticker) {
      return NextResponse.json(
        { success: false, error: "ticker parameter is required" },
        { status: 400 }
      );
    }

    const results = await query(
      `SELECT
         sr.scan_date,
         sr.current_price,
         sr.tier,
         sr.fundamental_score,
         sr.valuation_score,
         sr.short_term_score,
         sr.long_term_score,
         sr.is_buy_now,
         sr.market_regime,
         sr.stop_loss,
         sr.price_target,
         sr.trigger_type,
         sr.buy_now_reason,
         sr.mgmt_signal_status
       FROM scan_results sr
       JOIN scan_runs s ON s.scan_id = sr.scan_id
       WHERE sr.ticker_code = $1
         AND s.status = 'completed'
         AND sr.scan_date >= NOW() - INTERVAL '1 day' * $2
       ORDER BY sr.scan_date ASC`,
      [ticker, days]
    );

    return NextResponse.json({
      success: true,
      ticker,
      history: results.rows,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
