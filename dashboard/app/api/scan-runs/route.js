import { query } from "../../../lib/db";
import { NextResponse } from "next/server";

// GET /api/scan-runs — list completed scan runs for the scan picker
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "30", 10), 100);

    const result = await query(
      `SELECT scan_id, started_at, finished_at, ticker_count, total_tickers,
              buy_count, error_count, status
       FROM scan_runs
       WHERE status = 'completed'
       ORDER BY started_at DESC
       LIMIT $1`,
      [limit]
    );

    return NextResponse.json({ success: true, runs: result.rows });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
