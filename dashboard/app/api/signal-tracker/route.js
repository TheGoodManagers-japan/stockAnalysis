import { query } from "../../../lib/db.js";
import { NextResponse } from "next/server";

// GET /api/signal-tracker — fetch signal trades with filters
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get("source");
    const status = searchParams.get("status");
    const triggerType = searchParams.get("triggerType");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const limit = Math.min(Number(searchParams.get("limit")) || 200, 1000);
    const offset = Number(searchParams.get("offset")) || 0;

    let sql = `SELECT st.*,
                      COALESCE(t.short_name, sfm.short_name) AS short_name,
                      COALESCE(t.sector, sfm.category) AS sector
               FROM signal_trades st
               LEFT JOIN tickers t ON t.code = st.ticker_code
               LEFT JOIN space_fund_members sfm ON sfm.ticker_code = st.ticker_code
               WHERE 1=1`;
    const params = [];
    let idx = 1;

    if (source) { sql += ` AND st.source = $${idx}`; params.push(source); idx++; }
    if (status) { sql += ` AND st.status = $${idx}`; params.push(status); idx++; }
    if (triggerType) { sql += ` AND st.trigger_type = $${idx}`; params.push(triggerType); idx++; }
    if (from) { sql += ` AND st.entry_date >= $${idx}`; params.push(from); idx++; }
    if (to) { sql += ` AND st.entry_date <= $${idx}`; params.push(to); idx++; }

    sql += ` ORDER BY st.entry_date DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);

    const result = await query(sql, params);

    // Total count for pagination
    let countSql = `SELECT COUNT(*) FROM signal_trades WHERE 1=1`;
    const countParams = [];
    let cidx = 1;
    if (source) { countSql += ` AND source = $${cidx}`; countParams.push(source); cidx++; }
    if (status) { countSql += ` AND status = $${cidx}`; countParams.push(status); cidx++; }
    if (triggerType) { countSql += ` AND trigger_type = $${cidx}`; countParams.push(triggerType); cidx++; }
    if (from) { countSql += ` AND entry_date >= $${cidx}`; countParams.push(from); cidx++; }
    if (to) { countSql += ` AND entry_date <= $${cidx}`; countParams.push(to); cidx++; }

    const countResult = await query(countSql, countParams);

    return NextResponse.json({
      success: true,
      trades: result.rows,
      total: Number(countResult.rows[0].count),
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
