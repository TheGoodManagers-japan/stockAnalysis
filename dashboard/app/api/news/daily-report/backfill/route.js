import { query } from "../../../../../lib/db.js";
import { generateDailyReport } from "../../../../../lib/news/generateDailyReport.js";
import { NextResponse } from "next/server";

// GET /api/news/daily-report/backfill — check how many dates need reports
export async function GET() {
  try {
    const result = await query(
      `SELECT na.published_at::date as report_date, COUNT(*) as article_count
       FROM news_articles na
       WHERE na.is_analyzed = TRUE
         AND na.published_at::date NOT IN (SELECT report_date FROM daily_news_reports)
         AND na.published_at >= CURRENT_DATE - 90
       GROUP BY na.published_at::date
       ORDER BY report_date DESC`
    );

    return NextResponse.json({
      success: true,
      missingDates: result.rows.length,
      dates: result.rows.map((r) => ({
        date: r.report_date,
        articleCount: Number(r.article_count),
      })),
    });
  } catch (err) {
    console.error("[daily-report/backfill] check error:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// POST /api/news/daily-report/backfill — generate reports for missing dates
// Processes up to 5 dates per call to stay within Gemini quotas
export async function POST() {
  try {
    const result = await query(
      `SELECT na.published_at::date as report_date, COUNT(*) as article_count
       FROM news_articles na
       WHERE na.is_analyzed = TRUE
         AND na.published_at::date NOT IN (SELECT report_date FROM daily_news_reports)
         AND na.published_at >= CURRENT_DATE - 90
       GROUP BY na.published_at::date
       ORDER BY report_date DESC
       LIMIT 5`
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ success: true, generated: [], remaining: 0 });
    }

    const generated = [];
    const errors = [];

    for (const row of result.rows) {
      const dateStr = typeof row.report_date === "string"
        ? row.report_date.split("T")[0]
        : new Date(row.report_date).toISOString().split("T")[0];

      try {
        const report = await generateDailyReport(dateStr);
        if (!report.empty) {
          generated.push({ date: dateStr, articleCount: report.article_count });
        }
      } catch (err) {
        console.error(`[daily-report/backfill] failed for ${dateStr}:`, err.message);
        errors.push({ date: dateStr, error: err.message });
      }

      // Small delay between Gemini calls
      if (result.rows.indexOf(row) < result.rows.length - 1) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    // Count remaining
    const remainingResult = await query(
      `SELECT COUNT(DISTINCT na.published_at::date) as remaining
       FROM news_articles na
       WHERE na.is_analyzed = TRUE
         AND na.published_at::date NOT IN (SELECT report_date FROM daily_news_reports)
         AND na.published_at >= CURRENT_DATE - 90`
    );

    return NextResponse.json({
      success: true,
      generated,
      errors: errors.length > 0 ? errors : undefined,
      remaining: Number(remainingResult.rows[0].remaining),
    });
  } catch (err) {
    console.error("[daily-report/backfill] error:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
