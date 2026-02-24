import { query } from "../../../../lib/db.js";
import { NextResponse } from "next/server";

// GET /api/space-fund/members — list all members
export async function GET() {
  try {
    const result = await query(
      `SELECT * FROM space_fund_members ORDER BY is_active DESC, target_weight DESC`
    );
    return NextResponse.json({ success: true, members: result.rows });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

// POST /api/space-fund/members — add a new member
export async function POST(request) {
  try {
    const body = await request.json();
    const { ticker_code, short_name, currency, exchange, target_weight, category } = body;

    if (!ticker_code || target_weight == null) {
      return NextResponse.json(
        { success: false, error: "ticker_code and target_weight are required" },
        { status: 400 }
      );
    }

    const result = await query(
      `INSERT INTO space_fund_members (ticker_code, short_name, currency, exchange, target_weight, category)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (ticker_code) DO UPDATE SET
         short_name = EXCLUDED.short_name,
         currency = EXCLUDED.currency,
         exchange = EXCLUDED.exchange,
         target_weight = EXCLUDED.target_weight,
         category = EXCLUDED.category,
         is_active = TRUE,
         updated_at = NOW()
       RETURNING *`,
      [
        ticker_code.toUpperCase(),
        short_name || null,
        currency || "USD",
        exchange || "US",
        target_weight,
        category || null,
      ]
    );

    return NextResponse.json({ success: true, member: result.rows[0] });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

// PATCH /api/space-fund/members — update a member
export async function PATCH(request) {
  try {
    const body = await request.json();
    const { ticker_code, ...updates } = body;

    if (!ticker_code) {
      return NextResponse.json(
        { success: false, error: "ticker_code is required" },
        { status: 400 }
      );
    }

    const allowed = ["short_name", "target_weight", "category", "is_active", "currency", "exchange"];
    const fields = [];
    const values = [];
    let idx = 1;

    for (const key of allowed) {
      if (updates[key] !== undefined) {
        fields.push(`${key} = $${idx}`);
        values.push(updates[key]);
        idx++;
      }
    }

    if (fields.length === 0) {
      return NextResponse.json(
        { success: false, error: "No valid fields to update" },
        { status: 400 }
      );
    }

    fields.push(`updated_at = NOW()`);
    values.push(ticker_code.toUpperCase());

    const result = await query(
      `UPDATE space_fund_members SET ${fields.join(", ")} WHERE ticker_code = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Member not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, member: result.rows[0] });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

// DELETE /api/space-fund/members — soft-delete (deactivate) a member
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker_code = searchParams.get("ticker");

    if (!ticker_code) {
      return NextResponse.json(
        { success: false, error: "ticker query param is required" },
        { status: 400 }
      );
    }

    const result = await query(
      `UPDATE space_fund_members SET is_active = FALSE, updated_at = NOW()
       WHERE ticker_code = $1 RETURNING *`,
      [ticker_code.toUpperCase()]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Member not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, member: result.rows[0] });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
