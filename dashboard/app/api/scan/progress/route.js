import { query } from "../../../../lib/db";
import { NextResponse } from "next/server";

// GET /api/scan/progress — lightweight progress check (no result rows)
export async function GET() {
  try {
    const result = await query(
      `SELECT scan_id, status, ticker_count, total_tickers, buy_count,
              error_count, current_ticker, started_at, finished_at
       FROM scan_runs ORDER BY started_at DESC LIMIT 1`
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
