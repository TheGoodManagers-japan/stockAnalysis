import * as cheerio from "cheerio";

// Nikkei public RSS / headline scraping
const RSS_URL = "https://assets.nikkei.com/press/rss/nikkei_stock.rdf";
const FALLBACK_URL = "https://www.nikkei.com/markets/kabu/";

function extractTickers(text) {
  if (!text) return [];
  const out = new Set();
  const normalized = (text || "").replace(/[０-９]/g, d =>
    String.fromCharCode(d.charCodeAt(0) - 0xff10 + 0x30)
  );
  (normalized.match(/＜\s*(\d{4})\s*＞/g) || []).forEach(m => {
    const code = (m.match(/(\d{4})/) || [])[1];
    if (code) out.add(`${code}.T`);
  });
  (normalized.match(/[<\[（(]\s*(\d{4})\s*[>\]）)]/g) || []).forEach(m => {
    const code = (m.match(/(\d{4})/) || [])[1];
    if (code) out.add(`${code}.T`);
  });
  return [...out];
}

async function fetchRSS() {
  const res = await fetch(RSS_URL, {
    headers: { "User-Agent": "Mozilla/5.0 StockAnalysis/1.0" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;

  const xml = await res.text();
  const $ = cheerio.load(xml, { xmlMode: true });
  const articles = [];

  $("item").each((_, el) => {
    const title = $(el).find("title").text().trim();
    const link = $(el).find("link").text().trim();
    const pubDate = $(el).find("dc\\:date, pubDate").text().trim();
    const description = $(el).find("description").text().trim();

    if (!title || !link) return;

    articles.push({
      source: "nikkei",
      source_url: link,
      title,
      title_ja: title,
      body_text: description ? cheerio.load(description).text().trim().slice(0, 4000) : null,
      category: "market",
      published_at: pubDate ? new Date(pubDate).toISOString() : null,
      tickers: extractTickers(title + " " + description),
    });
  });

  return articles;
}

async function fetchHTML() {
  const res = await fetch(FALLBACK_URL, {
    headers: { "User-Agent": "Mozilla/5.0 StockAnalysis/1.0" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];

  const html = await res.text();
  const $ = cheerio.load(html);
  const articles = [];

  // Nikkei market headlines are typically in article/a tags
  $("article a, .m-miM09_item a, .m-articleList_item a").each((_, el) => {
    const href = $(el).attr("href");
    const title = $(el).text().trim();
    if (!title || !href || title.length < 8) return;

    const link = href.startsWith("http") ? href : `https://www.nikkei.com${href}`;

    articles.push({
      source: "nikkei",
      source_url: link,
      title,
      title_ja: title,
      body_text: null,
      category: "market",
      published_at: new Date().toISOString(),
      tickers: extractTickers(title),
    });
  });

  return articles;
}

export async function fetchArticles() {
  try {
    const rssArticles = await fetchRSS();
    if (rssArticles && rssArticles.length > 0) return rssArticles;
  } catch (err) {
    console.warn("[nikkei] RSS failed, trying HTML fallback:", err.message);
  }

  try {
    return await fetchHTML();
  } catch (err) {
    console.warn("[nikkei] HTML fallback also failed:", err.message);
    return [];
  }
}
