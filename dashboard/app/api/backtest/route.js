import { query } from "../../../lib/db";
import { NextResponse } from "next/server";

// GET /api/backtest — fetch all backtest runs
export async function GET() {
  try {
    const result = await query(
      `SELECT * FROM backtest_runs ORDER BY run_date DESC LIMIT 20`
    );
    return NextResponse.json({ success: true, runs: result.rows });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

// POST /api/backtest — run a new backtest (placeholder)
export async function POST(request) {
  try {
    const body = await request.json();
    const { mode = "balanced" } = body;

    // TODO: Import and run the actual backtest engine
    // For now, create a placeholder run
    const result = await query(
      `INSERT INTO backtest_runs (config_json, status)
       VALUES ($1, 'pending')
       RETURNING *`,
      [JSON.stringify({ mode })]
    );

    return NextResponse.json({ success: true, run: result.rows[0] });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
