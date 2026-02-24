import { query } from "../../../../lib/db.js";
import { NextResponse } from "next/server";

// GET /api/signal-tracker/stats — aggregate performance statistics
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get("source");

    const params = source ? [source] : [];
    const sourceFilter = source ? "AND source = $1" : "";

    // Overall stats
    const overall = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status != 'OPEN') AS total_closed,
         COUNT(*) FILTER (WHERE status = 'OPEN') AS total_open,
         COUNT(*) FILTER (WHERE status = 'WIN') AS wins,
         COUNT(*) FILTER (WHERE status = 'LOSS') AS losses,
         COUNT(*) FILTER (WHERE status = 'EXPIRED') AS expired,
         ROUND(AVG(pnl_pct) FILTER (WHERE status != 'OPEN'), 2) AS avg_pnl_pct,
         ROUND(AVG(r_multiple) FILTER (WHERE status != 'OPEN'), 2) AS avg_r_multiple,
         ROUND(AVG(exit_date - entry_date) FILTER (WHERE status != 'OPEN'), 1) AS avg_holding_days,
         ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'WIN') /
           NULLIF(COUNT(*) FILTER (WHERE status != 'OPEN'), 0), 1) AS win_rate
       FROM signal_trades
       WHERE 1=1 ${sourceFilter}`,
      params
    );

    // By source breakdown
    const bySource = await query(
      `SELECT source,
         COUNT(*) FILTER (WHERE status != 'OPEN') AS closed,
         COUNT(*) FILTER (WHERE status = 'OPEN') AS open,
         COUNT(*) FILTER (WHERE status = 'WIN') AS wins,
         COUNT(*) FILTER (WHERE status = 'LOSS') AS losses,
         ROUND(AVG(pnl_pct) FILTER (WHERE status != 'OPEN'), 2) AS avg_pnl,
         ROUND(AVG(r_multiple) FILTER (WHERE status != 'OPEN'), 2) AS avg_r,
         ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'WIN') /
           NULLIF(COUNT(*) FILTER (WHERE status != 'OPEN'), 0), 1) AS win_rate
       FROM signal_trades
       GROUP BY source
       ORDER BY source`
    );

    // By trigger type
    const byTrigger = await query(
      `SELECT trigger_type, source,
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE status = 'WIN') AS wins,
         COUNT(*) FILTER (WHERE status = 'LOSS') AS losses,
         ROUND(AVG(pnl_pct) FILTER (WHERE status != 'OPEN'), 2) AS avg_pnl,
         ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'WIN') /
           NULLIF(COUNT(*) FILTER (WHERE status != 'OPEN'), 0), 1) AS win_rate
       FROM signal_trades
       WHERE status != 'OPEN'
       GROUP BY trigger_type, source
       ORDER BY win_rate DESC NULLS LAST`
    );

    // Monthly equity curve
    const monthlyCurve = await query(
      `SELECT
         TO_CHAR(exit_date, 'YYYY-MM') AS month,
         COUNT(*) AS trades,
         ROUND(SUM(pnl_pct), 2) AS total_pnl_pct,
         COUNT(*) FILTER (WHERE status = 'WIN') AS wins,
         COUNT(*) FILTER (WHERE status = 'LOSS' OR status = 'EXPIRED') AS losses
       FROM signal_trades
       WHERE status != 'OPEN' AND exit_date IS NOT NULL
       GROUP BY TO_CHAR(exit_date, 'YYYY-MM')
       ORDER BY month ASC`
    );

    return NextResponse.json({
      success: true,
      overall: overall.rows[0],
      bySource: bySource.rows,
      byTrigger: byTrigger.rows,
      monthlyCurve: monthlyCurve.rows,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
