import { query } from "../../../../lib/db";
import { NextResponse } from "next/server";

// GET /api/portfolio/journal?holding_id=1
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const holdingId = searchParams.get("holding_id");

    let result;
    if (holdingId) {
      result = await query(
        `SELECT tj.*, ph.ticker_code
         FROM trade_journal tj
         JOIN portfolio_holdings ph ON ph.id = tj.holding_id
         WHERE tj.holding_id = $1
         ORDER BY tj.entry_date DESC`,
        [holdingId]
      );
    } else {
      // Return recent entries across all holdings
      result = await query(
        `SELECT tj.*, ph.ticker_code
         FROM trade_journal tj
         JOIN portfolio_holdings ph ON ph.id = tj.holding_id
         ORDER BY tj.entry_date DESC
         LIMIT 50`
      );
    }

    return NextResponse.json({
      success: true,
      entries: result.rows,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

// POST /api/portfolio/journal — add journal entry
export async function POST(request) {
  try {
    const body = await request.json();
    const { holding_id, note_type, content, tags } = body;

    if (!holding_id || !content) {
      return NextResponse.json(
        { success: false, error: "holding_id and content are required" },
        { status: 400 }
      );
    }

    const result = await query(
      `INSERT INTO trade_journal (holding_id, note_type, content, tags)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [holding_id, note_type || "note", content, tags || []]
    );

    return NextResponse.json({
      success: true,
      entry: result.rows[0],
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
