import * as cheerio from "cheerio";

// Yahoo Finance Japan RSS feeds for stock/business news
const FEEDS = [
  { url: "https://news.yahoo.co.jp/rss/topics/business.xml", category: "business" },
  { url: "https://news.yahoo.co.jp/rss/topics/economy.xml", category: "economy" },
  { url: "https://finance.yahoo.co.jp/news/rss/stock/biz", category: "stock" },
];

// Extract JP ticker codes (####) from text
function extractTickers(text) {
  if (!text) return [];
  const out = new Set();
  // Full-width bracket codes: ＜7203＞
  const fullWidth = text.replace(/[０-９]/g, d =>
    String.fromCharCode(d.charCodeAt(0) - 0xff10 + 0x30)
  );
  (fullWidth.match(/＜\s*(\d{4})\s*＞/g) || []).forEach(m => {
    const code = (m.match(/(\d{4})/) || [])[1];
    if (code) out.add(`${code}.T`);
  });
  // Half-width bracket codes: <7203> [7203] (7203)
  (text.match(/[<\[（(]\s*(\d{4})\s*[>\]）)]/g) || []).forEach(m => {
    const code = (m.match(/(\d{4})/) || [])[1];
    if (code) out.add(`${code}.T`);
  });
  return [...out];
}

export async function fetchArticles() {
  const articles = [];

  for (const feed of FEEDS) {
    try {
      const res = await fetch(feed.url, {
        headers: { "User-Agent": "Mozilla/5.0 StockAnalysis/1.0" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;

      const xml = await res.text();
      const $ = cheerio.load(xml, { xmlMode: true });

      $("item").each((_, el) => {
        const title = $(el).find("title").text().trim();
        const link = $(el).find("link").text().trim();
        const pubDate = $(el).find("pubDate").text().trim();
        const description = $(el).find("description").text().trim();

        if (!title || !link) return;

        const tickers = extractTickers(title + " " + description);
        const bodyText = description
          ? cheerio.load(description).text().trim().slice(0, 4000)
          : null;

        articles.push({
          source: "yahoo_rss",
          source_url: link,
          title,
          title_ja: title,
          body_text: bodyText,
          category: feed.category,
          published_at: pubDate ? new Date(pubDate).toISOString() : null,
          tickers,
        });
      });
    } catch (err) {
      console.warn(`[yahoo-rss] Failed to fetch ${feed.url}:`, err.message);
    }
  }

  return articles;
}
