import { NextResponse } from "next/server";
import { query } from "../../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);
    const date = searchParams.get("date"); // optional: YYYY-MM-DD

    const dateFilter = date
      ? `AND r.ranking_date = $2`
      : `AND r.ranking_date = (SELECT MAX(ranking_date) FROM ml_rankings)`;

    const params = [limit];
    if (date) params.push(date);

    const result = await query(
      `SELECT r.ticker_code, r.ranking_date, r.predicted_return_10d,
              r.rank_position, r.model_version,
              t.short_name, t.sector,
              sr.current_price, sr.tier, sr.is_buy_now, sr.trigger_type,
              sr.fundamental_score, sr.valuation_score, sr.technical_score,
              sr.market_regime, sr.short_term_score, sr.long_term_score,
              sr.stop_loss, sr.price_target
       FROM ml_rankings r
       LEFT JOIN tickers t ON t.code = r.ticker_code
       LEFT JOIN LATERAL (
         SELECT * FROM scan_results
         WHERE ticker_code = r.ticker_code
         ORDER BY scan_date DESC LIMIT 1
       ) sr ON true
       WHERE r.rank_position IS NOT NULL
         ${dateFilter}
       ORDER BY r.rank_position ASC
       LIMIT $1`,
      params
    );

    // Also fetch available dates for the date picker
    const datesResult = await query(
      `SELECT DISTINCT ranking_date
       FROM ml_rankings
       ORDER BY ranking_date DESC
       LIMIT 30`
    );

    return NextResponse.json({
      rankings: result.rows,
      dates: datesResult.rows.map((r) => r.ranking_date),
      count: result.rows.length,
    });
  } catch (err) {
    console.error("[API] ML rankings error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
