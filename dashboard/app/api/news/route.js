import { query } from "../../../lib/db.js";
import { NextResponse } from "next/server";

// GET /api/news?source=&sentiment=&impact=&ticker=&category=&page=1&limit=50
export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const source = searchParams.get("source");
  const sentiment = searchParams.get("sentiment");
  const impact = searchParams.get("impact");
  const ticker = searchParams.get("ticker");
  const category = searchParams.get("category");
  const analyzedOnly = searchParams.get("analyzed") !== "false";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));
  const offset = (page - 1) * limit;

  try {
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (analyzedOnly) {
      conditions.push("na.is_analyzed = TRUE");
    }
    if (source) {
      conditions.push(`na.source = $${paramIdx++}`);
      params.push(source);
    }
    if (sentiment) {
      conditions.push(`na.sentiment = $${paramIdx++}`);
      params.push(sentiment);
    }
    if (impact) {
      conditions.push(`na.impact_level = $${paramIdx++}`);
      params.push(impact);
    }
    if (category) {
      conditions.push(`na.news_category = $${paramIdx++}`);
      params.push(category);
    }
    if (ticker) {
      const tickerCode = /^\d{4}$/.test(ticker) ? `${ticker}.T` : ticker;
      conditions.push(
        `EXISTS (SELECT 1 FROM news_article_tickers nat WHERE nat.article_id = na.id AND nat.ticker_code = $${paramIdx++})`
      );
      params.push(tickerCode);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Count total
    const countResult = await query(
      `SELECT COUNT(*) as total FROM news_articles na ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    // Fetch articles with their tickers
    const articles = await query(
      `SELECT
         na.id, na.source, na.source_url, na.title, na.title_ja,
         na.category, na.published_at, na.fetched_at,
         na.is_analyzed, na.relevance_score, na.impact_level,
         na.sentiment, na.sentiment_score, na.news_category,
         na.ai_summary,
         COALESCE(
           (SELECT json_agg(json_build_object(
              'ticker_code', nat.ticker_code, 'is_primary', nat.is_primary
           )) FROM news_article_tickers nat WHERE nat.article_id = na.id),
           '[]'::json
         ) as tickers
       FROM news_articles na
       ${where}
       ORDER BY na.published_at DESC NULLS LAST
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );

    // Summary stats (for the current filter)
    const stats = await query(
      `SELECT
         COUNT(*) FILTER (WHERE na.published_at >= CURRENT_DATE) as today_count,
         COUNT(*) FILTER (WHERE na.sentiment = 'Bullish') as bullish_count,
         COUNT(*) FILTER (WHERE na.sentiment = 'Bearish') as bearish_count,
         COUNT(*) FILTER (WHERE na.sentiment = 'Neutral') as neutral_count,
         COUNT(*) FILTER (WHERE na.impact_level = 'high') as high_impact_count,
         COUNT(*) FILTER (WHERE na.is_analyzed = FALSE) as unanalyzed_count
       FROM news_articles na ${where}`,
      params
    );

    const response = NextResponse.json({
      success: true,
      articles: articles.rows,
      total,
      page,
      limit,
      stats: stats.rows[0] || {},
    });
    response.headers.set("Cache-Control", "public, max-age=120, stale-while-revalidate=600");
    return response;
  } catch (err) {
    console.error("[news] Error:", err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
