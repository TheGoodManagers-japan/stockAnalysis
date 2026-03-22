import * as cheerio from "cheerio";
import { query } from "../db.js";

// Fetch active Space Fund member tickers from DB
async function getSpaceFundTickers() {
  try {
    const res = await query(
      `SELECT ticker_code, short_name FROM space_fund_members WHERE is_active = TRUE`
    );
    return res.rows.map((r) => ({
      code: r.ticker_code,
      name: r.short_name,
    }));
  } catch {
    // Fallback to hardcoded list if DB unavailable
    return [
      { code: "RKLB", name: "Rocket Lab" },
      { code: "PL", name: "Planet Labs" },
      { code: "LUNR", name: "Intuitive Machines" },
      { code: "RDW", name: "Redwire" },
      { code: "NVDA", name: "NVIDIA" },
      { code: "GOOGL", name: "Alphabet" },
      { code: "AVGO", name: "Broadcom" },
      { code: "LITE", name: "Lumentum" },
      { code: "COHR", name: "Coherent" },
    ];
  }
}

// Extract US ticker mentions from text by matching known Space Fund tickers
function extractTickers(text, knownTickers) {
  if (!text) return [];
  const upper = text.toUpperCase();
  const found = new Set();
  for (const t of knownTickers) {
    // Match ticker code as a whole word (e.g., "RKLB" but not "ARKLB")
    const re = new RegExp(`\\b${t.code}\\b`);
    if (re.test(upper)) found.add(t.code);
  }
  return [...found];
}

// Google News RSS searches for broad space industry news
const SPACE_INDUSTRY_FEEDS = [
  { query: "space industry stocks", category: "space_industry" },
  { query: "SpaceX launch satellite", category: "space_industry" },
  { query: "NASA contract commercial space", category: "space_industry" },
  { query: "satellite launch rocket stocks", category: "space_industry" },
];

// Parse RSS feed XML and return article objects
function parseRSSItems($, members, source, category, primaryTicker) {
  const items = [];

  $("item").each((_, el) => {
    const title = $(el).find("title").text().trim();
    const link = $(el).find("link").text().trim();
    const pubDate = $(el).find("pubDate").text().trim();
    const description = $(el).find("description").text().trim();

    if (!title || !link) return;

    const mentioned = extractTickers(title + " " + description, members);
    const tickers = primaryTicker
      ? [primaryTicker, ...mentioned.filter((t) => t !== primaryTicker)]
      : mentioned;

    const bodyText = description
      ? cheerio.load(description).text().trim().slice(0, 4000)
      : null;

    items.push({
      source,
      source_url: link,
      title,
      title_ja: null,
      body_text: bodyText,
      category,
      published_at: pubDate ? new Date(pubDate).toISOString() : null,
      tickers,
    });
  });

  return items;
}

export async function fetchArticles() {
  const members = await getSpaceFundTickers();
  const articles = [];
  const seenUrls = new Set();

  // 1. Per-ticker Yahoo Finance RSS feeds
  for (const member of members) {
    try {
      const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${member.code}&region=US&lang=en-US`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 StockAnalysis/1.0" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        console.warn(`[yahoo-us-rss] ${member.code}: HTTP ${res.status}`);
        continue;
      }

      const xml = await res.text();
      const $ = cheerio.load(xml, { xmlMode: true });
      const items = parseRSSItems($, members, "yahoo_us_rss", "us_stock", member.code);

      for (const item of items) {
        if (!seenUrls.has(item.source_url)) {
          seenUrls.add(item.source_url);
          articles.push(item);
        }
      }

      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.warn(`[yahoo-us-rss] ${member.code} failed:`, err.message);
    }
  }

  // 2. Space industry keyword searches via Google News RSS
  for (const feed of SPACE_INDUSTRY_FEEDS) {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(feed.query)}&hl=en-US&gl=US&ceid=US:en`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 StockAnalysis/1.0" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        console.warn(`[yahoo-us-rss] Google News "${feed.query}": HTTP ${res.status}`);
        continue;
      }

      const xml = await res.text();
      const $ = cheerio.load(xml, { xmlMode: true });
      const items = parseRSSItems($, members, "yahoo_us_rss", feed.category, null);

      for (const item of items) {
        if (!seenUrls.has(item.source_url)) {
          seenUrls.add(item.source_url);
          articles.push(item);
        }
      }

      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      console.warn(`[yahoo-us-rss] Google News "${feed.query}" failed:`, err.message);
    }
  }

  console.log(`[yahoo-us-rss] ${articles.length} articles (${seenUrls.size} unique)`);
  return articles;
}
