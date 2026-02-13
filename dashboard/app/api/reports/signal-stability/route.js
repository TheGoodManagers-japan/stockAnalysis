import { query } from "../../../../lib/db";
import { NextResponse } from "next/server";

// GET /api/reports/signal-stability?days=30
// Detect signal flip-flopping: tickers that switch buy/no-buy frequently
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = Math.min(parseInt(searchParams.get("days") || "30", 10), 180);

    const result = await query(
      `WITH daily_signals AS (
        SELECT DISTINCT ON (sr.ticker_code, sr.scan_date::date)
          sr.ticker_code, sr.scan_date::date as scan_day,
          sr.is_buy_now, sr.tier, sr.market_regime, sr.trigger_type,
          t.sector, t.short_name
        FROM scan_results sr
        JOIN scan_runs s ON s.scan_id = sr.scan_id
        JOIN tickers t ON t.code = sr.ticker_code
        WHERE s.status = 'completed'
          AND sr.scan_date >= NOW() - INTERVAL '1 day' * $1
        ORDER BY sr.ticker_code, sr.scan_date::date, sr.scan_date DESC
      ),
      with_prev AS (
        SELECT *,
          LAG(is_buy_now) OVER (PARTITION BY ticker_code ORDER BY scan_day) as prev_buy
        FROM daily_signals
      ),
      transitions AS (
        SELECT
          ticker_code, short_name, sector,
          COUNT(*) as scan_count,
          SUM(CASE WHEN is_buy_now THEN 1 ELSE 0 END) as buy_days,
          SUM(CASE WHEN prev_buy IS NOT NULL AND is_buy_now != prev_buy THEN 1 ELSE 0 END) as flip_count
        FROM with_prev
        GROUP BY ticker_code, short_name, sector
        HAVING COUNT(*) >= 3
      )
      SELECT *,
        ROUND(buy_days::numeric / NULLIF(scan_count, 0) * 100, 1) as buy_pct,
        ROUND(flip_count::numeric / NULLIF(scan_count - 1, 0) * 100, 1) as instability_pct
      FROM transitions
      ORDER BY flip_count DESC, instability_pct DESC`,
      [days]
    );

    const tickers = result.rows.map((r) => ({
      ticker: r.ticker_code,
      name: r.short_name,
      sector: r.sector,
      scanCount: Number(r.scan_count),
      buyDays: Number(r.buy_days),
      flipCount: Number(r.flip_count),
      buyPct: r.buy_pct ? Number(r.buy_pct) : 0,
      instabilityPct: r.instability_pct ? Number(r.instability_pct) : 0,
    }));

    // Aggregate stats
    const totalTickers = tickers.length;
    const unstable = tickers.filter((t) => t.flipCount >= 3);
    const stable = tickers.filter((t) => t.flipCount === 0);

    return NextResponse.json({
      success: true,
      tickers,
      summary: {
        totalTickers,
        unstableCount: unstable.length,
        stableCount: stable.length,
        avgFlipCount:
          totalTickers > 0
            ? Math.round(
                (tickers.reduce((s, t) => s + t.flipCount, 0) / totalTickers) * 10
              ) / 10
            : 0,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
