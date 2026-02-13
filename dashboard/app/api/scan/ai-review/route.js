import { query } from "../../../../lib/db.js";
import { performAiReview } from "../../../../lib/ai-review.js";
import { NextResponse } from "next/server";

// GET /api/scan/ai-review — AI-powered review of buy signals
// supports ?ticker=XXXX for individual analysis
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const targetTicker = searchParams.get("ticker");

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { success: false, error: "GEMINI_API_KEY not configured" },
        { status: 500 }
      );
    }

    // Get latest completed scan
    const scanRun = await query(
      `SELECT scan_id FROM scan_runs
       WHERE status = 'completed'
       ORDER BY started_at DESC LIMIT 1`
    );

    if (scanRun.rows.length === 0) {
      return NextResponse.json({
        success: true,
        reviews: [],
        message: "No completed scans found",
      });
    }

    const result = await performAiReview(scanRun.rows[0].scan_id, {
      tickerFilter: targetTicker || undefined,
    });

    return NextResponse.json({
      success: true,
      reviews: result.reviews,
    });
  } catch (err) {
    console.error("AI review error:", err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
