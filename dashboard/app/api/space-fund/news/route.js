import { query } from "../../../../lib/db.js";
import { NextResponse } from "next/server";

// GET /api/space-fund/news — news articles mentioning space fund tickers
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get("limit")) || 30, 100);
    const page = Math.max(Number(searchParams.get("page")) || 1, 1);
    const offset = (page - 1) * limit;

    // Get active fund tickers
    const membersRes = await query(
      `SELECT ticker_code, short_name FROM space_fund_members WHERE is_active = TRUE`
    );
    const members = membersRes.rows;

    if (members.length === 0) {
      return NextResponse.json({
        success: true,
        articles: [],
        total: 0,
        page,
        limit,
      });
    }

    const tickers = members.map((m) => m.ticker_code);
    const names = members.map((m) => m.short_name).filter(Boolean);

    // Query articles that mention fund tickers (via news_article_tickers join)
    // OR articles whose title/summary contains the company name
    const tickerPlaceholders = tickers.map((_, i) => `$${i + 1}`).join(", ");

    let sql = `
      SELECT DISTINCT a.*, nat.ticker_code as matched_ticker
      FROM news_articles a
      LEFT JOIN news_article_tickers nat ON a.id = nat.article_id
      WHERE a.is_analyzed = TRUE
        AND (
          nat.ticker_code IN (${tickerPlaceholders})`;

    const params = [...tickers];
    let idx = tickers.length + 1;

    // Also match by company name in title/summary
    if (names.length > 0) {
      const nameConditions = names.map((name) => {
        params.push(`%${name}%`);
        return `a.title ILIKE $${idx++} OR a.ai_summary ILIKE $${idx - 1}`;
      });
      sql += ` OR ${nameConditions.join(" OR ")}`;
    }

    sql += `)
      ORDER BY a.published_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);

    const result = await query(sql, params);

    // Count total
    let countSql = `
      SELECT COUNT(DISTINCT a.id) as total
      FROM news_articles a
      LEFT JOIN news_article_tickers nat ON a.id = nat.article_id
      WHERE a.is_analyzed = TRUE
        AND (
          nat.ticker_code IN (${tickerPlaceholders})`;

    const countParams = [...tickers];
    let cidx = tickers.length + 1;

    if (names.length > 0) {
      const nameConditions = names.map((name) => {
        countParams.push(`%${name}%`);
        return `a.title ILIKE $${cidx++} OR a.ai_summary ILIKE $${cidx - 1}`;
      });
      countSql += ` OR ${nameConditions.join(" OR ")}`;
    }
    countSql += `)`;

    const countRes = await query(countSql, countParams);
    const total = Number(countRes.rows[0]?.total) || 0;

    return NextResponse.json({
      success: true,
      articles: result.rows,
      total,
      page,
      limit,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
