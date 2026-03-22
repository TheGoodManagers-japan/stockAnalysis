import { query } from "../../../../lib/db.js";
import { NextResponse } from "next/server";
import { createHash } from "crypto";

import { fetchArticles as fetchYahoo } from "../../../../lib/news/yahoo-rss.js";
import { fetchArticles as fetchJQuants } from "../../../../lib/news/jquants-batch.js";
import { fetchArticles as fetchNikkei } from "../../../../lib/news/nikkei.js";
import { fetchArticles as fetchMinkabu } from "../../../../lib/news/minkabu.js";
import { fetchArticles as fetchReuters } from "../../../../lib/news/reuters.js";
import { fetchArticles as fetchKabutan } from "../../../../lib/news/kabutan.js";
import { fetchArticles as fetchYahooUS } from "../../../../lib/news/yahoo-us-rss.js";

const FETCHERS = {
  kabutan: fetchKabutan,
  yahoo_rss: fetchYahoo,
  jquants: fetchJQuants,
  nikkei: fetchNikkei,
  minkabu: fetchMinkabu,
  reuters: fetchReuters,
  yahoo_us_rss: fetchYahooUS,
};

async function insertArticles(articles) {
  let inserted = 0;
  let duplicates = 0;

  for (const art of articles) {
    const source = art.source || "unknown";
    const sourceUrl = art.source_url || null;
    const title = art.title_ja || art.title || "";
    if (!title) continue;

    const hashInput = `${source}:${sourceUrl || title}`;
    const contentHash = createHash("sha256").update(hashInput).digest("hex");

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
        art.published_at || null,
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
    const tickers = Array.isArray(art.tickers) ? art.tickers : [];
    for (let i = 0; i < tickers.length; i++) {
      const code = tickers[i];
      if (!code) continue;
      const tickerCode = /^\d{4}$/.test(code) ? `${code}.T` : code;
      if (!/^\d{4}\.T$/.test(tickerCode) && !/^[A-Z]{1,5}$/.test(tickerCode)) continue;
      await query(
        `INSERT INTO news_article_tickers (article_id, ticker_code, is_primary)
         VALUES ($1, $2, $3)
         ON CONFLICT (article_id, ticker_code) DO NOTHING`,
        [articleId, tickerCode, i === 0]
      );
    }
  }

  return { inserted, duplicates };
}

// POST /api/news/fetch?source=all|yahoo_rss|jquants|nikkei|minkabu|reuters
export async function POST(request) {
  const { searchParams } = new URL(request.url);
  const sourceParam = searchParams.get("source") || "all";

  const sourcesToFetch = sourceParam === "all"
    ? Object.keys(FETCHERS)
    : sourceParam.split(",").map(s => s.trim()).filter(s => FETCHERS[s]);

  if (sourcesToFetch.length === 0) {
    return NextResponse.json(
      { success: false, error: `Unknown source: ${sourceParam}. Available: ${Object.keys(FETCHERS).join(", ")}` },
      { status: 400 }
    );
  }

  const results = {};
  let totalInserted = 0;
  let totalDuplicates = 0;
  const errors = [];

  for (const src of sourcesToFetch) {
    try {
      console.log(`[news/fetch] Fetching from ${src}...`);
      const articles = await FETCHERS[src]();
      const { inserted, duplicates } = await insertArticles(articles);
      results[src] = { fetched: articles.length, inserted, duplicates };
      totalInserted += inserted;
      totalDuplicates += duplicates;
      console.log(`[news/fetch] ${src}: ${articles.length} fetched, ${inserted} new, ${duplicates} duplicates`);
    } catch (err) {
      console.error(`[news/fetch] ${src} error:`, err.message);
      results[src] = { error: err.message };
      errors.push(`${src}: ${err.message}`);
    }
  }

  return NextResponse.json({
    success: true,
    results,
    totalInserted,
    totalDuplicates,
    errors: errors.length > 0 ? errors : undefined,
  });
}
