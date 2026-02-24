import { query } from "../../../../lib/db.js";
import { NextResponse } from "next/server";
import { recordSpaceFundSignal } from "../../../../lib/signalTracker.js";

// GET /api/space-fund/transactions — list transactions with optional filters
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get("ticker");
    const month = searchParams.get("month");
    const limit = Math.min(Number(searchParams.get("limit")) || 100, 500);

    let sql = `SELECT * FROM space_fund_transactions WHERE 1=1`;
    const params = [];
    let idx = 1;

    if (ticker) {
      sql += ` AND ticker_code = $${idx}`;
      params.push(ticker.toUpperCase());
      idx++;
    }
    if (month) {
      sql += ` AND dca_month = $${idx}`;
      params.push(month);
      idx++;
    }

    sql += ` ORDER BY transaction_date DESC LIMIT $${idx}`;
    params.push(limit);

    const result = await query(sql, params);
    return NextResponse.json({ success: true, transactions: result.rows });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

// POST /api/space-fund/transactions — record a purchase or sale
export async function POST(request) {
  try {
    const body = await request.json();
    const {
      ticker_code,
      transaction_type,
      transaction_date,
      shares,
      price_per_share,
      currency,
      fees,
      notes,
      dca_month,
    } = body;

    if (!ticker_code || !shares || !price_per_share) {
      return NextResponse.json(
        { success: false, error: "ticker_code, shares, and price_per_share are required" },
        { status: 400 }
      );
    }

    const totalAmount = Number(shares) * Number(price_per_share) + Number(fees || 0);

    const result = await query(
      `INSERT INTO space_fund_transactions
       (ticker_code, transaction_type, transaction_date, shares, price_per_share, total_amount, currency, fees, notes, dca_month)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        ticker_code.toUpperCase(),
        transaction_type || "BUY",
        transaction_date || new Date().toISOString().split("T")[0],
        shares,
        price_per_share,
        totalAmount,
        currency || "USD",
        fees || 0,
        notes || null,
        dca_month || null,
      ]
    );

    // Record as paper trade for signal performance tracking
    await recordSpaceFundSignal(result.rows[0]).catch((err) =>
      console.error("Signal tracker: space fund record failed:", err.message)
    );

    return NextResponse.json({ success: true, transaction: result.rows[0] });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
