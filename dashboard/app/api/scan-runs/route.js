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

// DELETE /api/scan-runs?scanId=<UUID> — delete a scan run and its results
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const scanId = searchParams.get("scanId");

    if (!scanId) {
      return NextResponse.json(
        { success: false, error: "scanId query param is required" },
        { status: 400 }
      );
    }

    // Delete all dependents, then scan_runs
    await query(`DELETE FROM predictions WHERE scan_id = $1`, [scanId]).catch(() => {});
    await query(`DELETE FROM ai_reviews WHERE scan_id = $1`, [scanId]).catch(() => {});
    await query(`DELETE FROM scan_results WHERE scan_id = $1`, [scanId]);
    const result = await query(
      `DELETE FROM scan_runs WHERE scan_id = $1 RETURNING scan_id`,
      [scanId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Scan not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, deletedScanId: scanId });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
