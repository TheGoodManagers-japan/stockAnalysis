import { query } from "../../../lib/db.js";
import { logError } from "../../../lib/errorLog.js";
import { NextResponse } from "next/server";

// GET /api/errors?severity=&source=&acknowledged=false&limit=100&offset=0
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const severity = searchParams.get("severity");
    const source = searchParams.get("source");
    const acknowledged = searchParams.get("acknowledged");
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get("limit") || "100", 10)));
    const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10));

    const conditions = [];
    const params = [];
    let idx = 1;

    if (severity) {
      conditions.push(`severity = $${idx++}`);
      params.push(severity);
    }
    if (source) {
      conditions.push(`source ILIKE $${idx++}`);
      params.push(`%${source}%`);
    }
    if (acknowledged === "true") {
      conditions.push(`is_acknowledged = TRUE`);
    } else if (acknowledged === "false") {
      conditions.push(`is_acknowledged = FALSE`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const [errors, countResult, unackResult] = await Promise.all([
      query(
        `SELECT id, severity, source, message, stack, details_json, is_acknowledged, created_at
         FROM error_log ${where}
         ORDER BY created_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, limit, offset]
      ),
      query(
        `SELECT COUNT(*)::int AS total FROM error_log ${where}`,
        params
      ),
      query(
        `SELECT COUNT(*)::int AS count FROM error_log WHERE is_acknowledged = FALSE`
      ),
    ]);

    return NextResponse.json({
      success: true,
      errors: errors.rows,
      total: countResult.rows[0]?.total || 0,
      unacknowledgedCount: unackResult.rows[0]?.count || 0,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// POST /api/errors — log a new error
export async function POST(request) {
  try {
    const body = await request.json();
    const { source, message, severity = "error", stack = null, details = null } = body;

    if (!source || !message) {
      return NextResponse.json(
        { success: false, error: "source and message are required" },
        { status: 400 }
      );
    }

    await logError(source, message, { severity, stack, details });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// PATCH /api/errors — acknowledge/dismiss errors
export async function PATCH(request) {
  try {
    const body = await request.json();
    const { ids, acknowledged = true } = body;

    if (ids === "all") {
      await query(`UPDATE error_log SET is_acknowledged = $1`, [acknowledged]);
    } else if (Array.isArray(ids) && ids.length > 0) {
      await query(
        `UPDATE error_log SET is_acknowledged = $1 WHERE id = ANY($2::bigint[])`,
        [acknowledged, ids]
      );
    } else {
      return NextResponse.json(
        { success: false, error: "ids must be an array or 'all'" },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// DELETE /api/errors — clear all errors
export async function DELETE() {
  try {
    await query(`DELETE FROM error_log`);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
