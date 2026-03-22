import { query } from "../../../../lib/db.js";
import { NextResponse } from "next/server";

// GET /api/news/ticker-context?tickers=1234.T,5678.T
// Returns news context (article count, sentiment, impact, watchlist status) for a list of tickers.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const tickersParam = searchParams.get("tickers");

    if (!tickersParam) {
      return NextResponse.json({ success: true, context: {} });
    }

    const tickers = tickersParam.split(",").filter(Boolean);
    if (tickers.length === 0) {
      return NextResponse.json({ success: true, context: {} });
    }

    const result = await query(
      `WITH recent_news AS (
         SELECT
           nat.ticker_code,
           COUNT(*) as article_count,
           ROUND(AVG(na.sentiment_score)::numeric, 2) as avg_sentiment,
           MAX(CASE na.impact_level WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END) as max_impact_num,
           MAX(na.impact_level) as max_impact,
           (array_agg(COALESCE(na.title, na.title_ja) ORDER BY na.published_at DESC))[1] as latest_headline,
           MAX(na.published_at) as latest_date
         FROM news_article_tickers nat
         JOIN news_articles na ON na.id = nat.article_id
         WHERE nat.ticker_code = ANY($1)
           AND na.is_analyzed = TRUE
           AND na.published_at >= NOW() - INTERVAL '7 days'
         GROUP BY nat.ticker_code
       ),
       watchlist_tickers AS (
         SELECT DISTINCT ticker_code
         FROM news_watchlist
         WHERE generated_at::date = CURRENT_DATE
       )
       SELECT
         rn.ticker_code,
         rn.article_count,
         rn.avg_sentiment,
         rn.max_impact,
         rn.latest_headline,
         rn.latest_date,
         CASE WHEN wt.ticker_code IS NOT NULL THEN true ELSE false END as on_watchlist
       FROM recent_news rn
       LEFT JOIN watchlist_tickers wt ON wt.ticker_code = rn.ticker_code`,
      [tickers]
    );

    // Build a map keyed by ticker_code
    const context = {};
    for (const row of result.rows) {
      context[row.ticker_code] = {
        article_count: Number(row.article_count),
        avg_sentiment: Number(row.avg_sentiment),
        max_impact: row.max_impact,
        latest_headline: row.latest_headline,
        latest_date: row.latest_date,
        on_watchlist: row.on_watchlist,
      };
    }

    const response = NextResponse.json({ success: true, context });
    response.headers.set("Cache-Control", "public, max-age=60");
    return response;
  } catch (err) {
    console.error("[news/ticker-context] Error:", err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
