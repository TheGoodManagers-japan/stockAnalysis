import { query } from "../../../../lib/db.js";
import { generateDailyReport } from "../../../../lib/news/generateDailyReport.js";
import { NextResponse } from "next/server";

function todayJST() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

// GET /api/news/daily-report?date=YYYY-MM-DD — retrieve cached report
// GET /api/news/daily-report?list=true&days=30 — list recent reports
export async function GET(request) {
  const { searchParams } = new URL(request.url);

  // List mode: return recent reports
  if (searchParams.get("list") === "true") {
    const days = Math.min(Number(searchParams.get("days")) || 30, 180);
    try {
      const result = await query(
        `SELECT report_date, article_count, report_json, generated_at
         FROM daily_news_reports
         WHERE report_date >= CURRENT_DATE - $1::int
         ORDER BY report_date DESC`,
        [days]
      );
      return NextResponse.json({ success: true, reports: result.rows });
    } catch (err) {
      console.error("[daily-report] list error:", err);
      return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
  }

  // Single date mode
  const dateStr = searchParams.get("date") || todayJST();

  try {
    const cached = await query(
      `SELECT report_date, article_count, report_json, generated_at
       FROM daily_news_reports WHERE report_date = $1`,
      [dateStr]
    );

    if (cached.rows.length > 0) {
      const row = cached.rows[0];
      return NextResponse.json({
        success: true,
        report: row.report_json,
        article_count: row.article_count,
        generated_at: row.generated_at,
        report_date: row.report_date,
      });
    }

    return NextResponse.json({ success: true, empty: true });
  } catch (err) {
    console.error("[daily-report] GET error:", err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

// POST /api/news/daily-report — generate (or regenerate) daily report
export async function POST(request) {
  let dateStr = todayJST();
  try {
    const body = await request.json().catch(() => ({}));
    if (body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      dateStr = body.date;
    }
  } catch {}

  try {
    const result = await generateDailyReport(dateStr);

    if (result.empty) {
      return NextResponse.json({ success: true, empty: true, article_count: 0 });
    }

    return NextResponse.json({
      success: true,
      report: result.report,
      article_count: result.article_count,
      generated_at: result.generated_at,
      report_date: result.report_date,
    });
  } catch (err) {
    console.error("[daily-report] POST error:", err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
