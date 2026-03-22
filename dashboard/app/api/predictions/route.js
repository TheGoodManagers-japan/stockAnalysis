import { query } from "../../../lib/db";
import { NextResponse } from "next/server";

// GET /api/predictions?ticker=7203.T
// Without ticker: returns all latest predictions
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get("ticker");

    if (ticker) {
      const result = await query(
        `SELECT p.*, t.short_name, t.sector
         FROM predictions p
         LEFT JOIN tickers t ON t.code = p.ticker_code
         WHERE p.ticker_code = $1
         ORDER BY p.prediction_date DESC
         LIMIT 1`,
        [ticker]
      );

      return NextResponse.json({
        success: true,
        prediction: result.rows[0] || null,
      });
    }

    // All latest predictions (one per ticker, most recent date)
    const result = await query(
      `SELECT DISTINCT ON (p.ticker_code)
         p.*, t.short_name, t.sector
       FROM predictions p
       LEFT JOIN tickers t ON t.code = p.ticker_code
       ORDER BY p.ticker_code, p.prediction_date DESC`
    );

    const response = NextResponse.json({
      success: true,
      predictions: result.rows,
    });
    response.headers.set("Cache-Control", "public, max-age=120, stale-while-revalidate=600");
    return response;
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
