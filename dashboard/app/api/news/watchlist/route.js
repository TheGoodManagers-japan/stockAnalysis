import { query } from "../../../../lib/db.js";
import { NextResponse } from "next/server";

// GET /api/news/watchlist — returns current news-driven watchlist candidates
export async function GET() {
  try {
    // Score tickers by aggregating their recent news signals (last 7 days)
    const watchlist = await query(
      `WITH ticker_news AS (
         SELECT
           nat.ticker_code,
           COUNT(*) as article_count,
           AVG(na.sentiment_score) as avg_sentiment,
           MAX(CASE na.impact_level WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END) as max_impact_num,
           MAX(na.impact_level) as max_impact,
           COUNT(DISTINCT na.source) as sources_count,
           COUNT(*) FILTER (WHERE na.published_at >= NOW() - INTERVAL '24 hours') as recent_count,
           (array_agg(na.ai_summary ORDER BY na.published_at DESC))[1] as latest_summary,
           json_agg(json_build_object(
             'id', na.id,
             'title', COALESCE(na.title, na.title_ja),
             'source', na.source,
             'sentiment', na.sentiment,
             'impact_level', na.impact_level,
             'published_at', na.published_at
           ) ORDER BY na.published_at DESC) as articles
         FROM news_article_tickers nat
         JOIN news_articles na ON na.id = nat.article_id
         WHERE na.is_analyzed = TRUE
           AND na.published_at >= NOW() - INTERVAL '7 days'
           AND na.relevance_score >= 0.3
         GROUP BY nat.ticker_code
         HAVING AVG(na.sentiment_score) >= -0.1
       )
       SELECT
         tn.ticker_code,
         t.short_name,
         t.sector,
         tn.article_count,
         ROUND(tn.avg_sentiment::numeric, 2) as avg_sentiment,
         tn.max_impact,
         tn.sources_count,
         tn.latest_summary as top_reason,
         -- Composite score: sentiment 35%, impact 30%, volume 15%, recency 10%, cross-source 10%
         ROUND((
           (LEAST(tn.avg_sentiment, 1.0) * 0.35) +
           (tn.max_impact_num / 3.0 * 0.30) +
           (LEAST(tn.article_count / 5.0, 1.0) * 0.15) +
           (CASE WHEN tn.article_count > 0 THEN tn.recent_count::float / tn.article_count ELSE 0 END * 0.10) +
           (LEAST(tn.sources_count / 2.0, 1.0) * 0.10)
         )::numeric, 3) as composite_score,
         tn.articles as articles_json,
         scan.is_buy_now,
         scan.tier,
         scan.market_regime
       FROM ticker_news tn
       LEFT JOIN tickers t ON t.code = tn.ticker_code
       LEFT JOIN LATERAL (
         SELECT sr.is_buy_now, sr.tier, sr.market_regime
         FROM scan_results sr
         WHERE sr.ticker_code = tn.ticker_code
           AND sr.scan_id = (
             SELECT scan_id FROM scan_runs
             WHERE status = 'completed'
             ORDER BY started_at DESC LIMIT 1
           )
         LIMIT 1
       ) scan ON true
       ORDER BY composite_score DESC
       LIMIT 20`
    );

    return NextResponse.json({
      success: true,
      watchlist: watchlist.rows,
    });
  } catch (err) {
    console.error("[news/watchlist] Error:", err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

// POST /api/news/watchlist — persist current watchlist snapshot
export async function POST() {
  try {
    // Get the current watchlist using the same scoring logic
    const response = await GET();
    const data = await response.json();
    if (!data.success || !data.watchlist?.length) {
      return NextResponse.json({ success: true, saved: 0 });
    }

    let saved = 0;
    for (const item of data.watchlist) {
      await query(
        `INSERT INTO news_watchlist
           (ticker_code, composite_score, article_count, avg_sentiment, max_impact, sources_count, top_reason, articles_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (ticker_code, (generated_at::date)) DO UPDATE SET
           composite_score = EXCLUDED.composite_score,
           article_count = EXCLUDED.article_count,
           avg_sentiment = EXCLUDED.avg_sentiment,
           max_impact = EXCLUDED.max_impact,
           sources_count = EXCLUDED.sources_count,
           top_reason = EXCLUDED.top_reason,
           articles_json = EXCLUDED.articles_json`,
        [
          item.ticker_code,
          item.composite_score,
          item.article_count,
          item.avg_sentiment,
          item.max_impact,
          item.sources_count,
          item.top_reason,
          JSON.stringify(item.articles_json),
        ]
      );
      saved++;
    }

    return NextResponse.json({ success: true, saved });
  } catch (err) {
    console.error("[news/watchlist] POST Error:", err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
