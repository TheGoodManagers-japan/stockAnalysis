import { query } from "../../../../lib/db";
import { NextResponse } from "next/server";

// GET /api/scan/progress?market=JP — lightweight progress check (no result rows)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const market = searchParams.get("market");

    const result = await query(
      market
        ? `SELECT scan_id, status, ticker_count, total_tickers, buy_count,
                  error_count, current_ticker, started_at, finished_at, market
           FROM scan_runs WHERE market = $1 ORDER BY started_at DESC LIMIT 1`
        : `SELECT scan_id, status, ticker_count, total_tickers, buy_count,
                  error_count, current_ticker, started_at, finished_at, market
           FROM scan_runs ORDER BY started_at DESC LIMIT 1`,
      market ? [market] : []
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ success: true, scan: null });
    }

    return NextResponse.json({
      success: true,
      scan: result.rows[0],
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
