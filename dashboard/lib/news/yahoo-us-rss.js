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

export async function fetchArticles() {
  const members = await getSpaceFundTickers();
  const articles = [];

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

      $("item").each((_, el) => {
        const title = $(el).find("title").text().trim();
        const link = $(el).find("link").text().trim();
        const pubDate = $(el).find("pubDate").text().trim();
        const description = $(el).find("description").text().trim();

        if (!title || !link) return;

        // Primary ticker is the one we queried for; also scan for other mentions
        const otherMentions = extractTickers(title + " " + description, members);
        const tickers = [member.code, ...otherMentions.filter((t) => t !== member.code)];

        const bodyText = description
          ? cheerio.load(description).text().trim().slice(0, 4000)
          : null;

        articles.push({
          source: "yahoo_us_rss",
          source_url: link,
          title,
          title_ja: null,
          body_text: bodyText,
          category: "us_stock",
          published_at: pubDate ? new Date(pubDate).toISOString() : null,
          tickers,
        });
      });

      // Small delay between tickers to be polite
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.warn(`[yahoo-us-rss] ${member.code} failed:`, err.message);
    }
  }

  return articles;
}
