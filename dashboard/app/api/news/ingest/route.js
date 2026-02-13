import { query } from "../../../../lib/db.js";
import { NextResponse } from "next/server";
import { createHash } from "crypto";

function corsHeaders(request) {
  const origin = request.headers.get("origin") || "";
  const allowed = [
    "https://s.kabutan.jp",
    "https://kabutan.jp",
    "http://localhost:3000",
  ];
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export async function OPTIONS(request) {
  return new NextResponse(null, { status: 200, headers: corsHeaders(request) });
}

// POST /api/news/ingest
// Body: { news: [{ title_ja, url, category, datetime, body_text, tickers, source }] }
export async function POST(request) {
  const headers = corsHeaders(request);

  try {
    const body = await request.json();
    const articles = Array.isArray(body.news) ? body.news : [];

    if (articles.length === 0) {
      return NextResponse.json(
        { success: false, error: "No articles provided." },
        { status: 400, headers }
      );
    }

    let inserted = 0;
    let duplicates = 0;

    for (const art of articles) {
      const source = art.source || "kabutan";
      const sourceUrl = art.url || art.source_url || null;
      const title = art.title_ja || art.title || "";
      if (!title) continue;

      const hashInput = `${source}:${sourceUrl || title}`;
      const contentHash = createHash("sha256")
        .update(hashInput)
        .digest("hex");

      const publishedAt =
        art.article_datetime || art.datetime || art.published_at || null;

      // Insert article (skip duplicates via content_hash)
      const result = await query(
        `INSERT INTO news_articles
           (source, source_url, title, title_ja, body_text, category, published_at, content_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (content_hash) DO NOTHING
         RETURNING id`,
        [
          source,
          sourceUrl,
          title,
          art.title_ja || null,
          art.body_text || null,
          art.category || null,
          publishedAt,
          contentHash,
        ]
      );

      if (result.rows.length === 0) {
        duplicates++;
        continue;
      }

      inserted++;
      const articleId = result.rows[0].id;

      // Insert ticker associations
      const tickers = Array.isArray(art.tickers)
        ? art.tickers
        : art.ticker
          ? [art.ticker]
          : [];

      for (let i = 0; i < tickers.length; i++) {
        const code = tickers[i];
        if (!code) continue;
        const tickerCode = /^\d{4}$/.test(code) ? `${code}.T` : code;
        await query(
          `INSERT INTO news_article_tickers (article_id, ticker_code, is_primary)
           VALUES ($1, $2, $3)
           ON CONFLICT (article_id, ticker_code) DO NOTHING`,
          [articleId, tickerCode, i === 0]
        );
      }
    }

    return NextResponse.json({ success: true, inserted, duplicates }, { headers });
  } catch (err) {
    console.error("[news/ingest] Error:", err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500, headers }
    );
  }
}
