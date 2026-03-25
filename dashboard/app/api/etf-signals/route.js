import { NextResponse } from "next/server";
import { query } from "../../../lib/db.js";

/**
 * GET /api/etf-signals
 * Returns the latest ETF entry signals.
 */
export async function GET() {
  try {
    const latest = await query(
      `SELECT MAX(signal_date) as latest_date FROM global_etf_signals`
    );
    const latestDate = latest.rows[0]?.latest_date;
    if (!latestDate) {
      return NextResponse.json({ signals: [], signalDate: null });
    }

    const signals = await query(
      `SELECT * FROM global_etf_signals
       WHERE signal_date = $1
       ORDER BY is_buy_now DESC, rr_ratio DESC NULLS LAST, ticker_code`,
      [latestDate]
    );

    return NextResponse.json({
      signals: signals.rows,
      signalDate: latestDate,
      buyCount: signals.rows.filter((r) => r.is_buy_now).length,
    });
  } catch (err) {
    console.error("[API] GET /api/etf-signals error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/etf-signals
 * Trigger a fresh ETF signal scan.
 */
export async function POST() {
  try {
    const { analyzeGlobalETFSignals } = await import("../../../lib/etfSignals.js");
    const { count, buyCount, errors } = await analyzeGlobalETFSignals({ source: "manual" });
    return NextResponse.json({ ok: true, count, buyCount, errorCount: errors.length });
  } catch (err) {
    console.error("[API] POST /api/etf-signals error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
