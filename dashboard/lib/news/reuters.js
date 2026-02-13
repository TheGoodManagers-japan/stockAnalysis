import * as cheerio from "cheerio";

// Reuters Japan — markets/companies section
const NEWS_URL = "https://jp.reuters.com/markets/japan/";

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
  // Reuters sometimes uses .T notation inline: 7203.T
  (text.match(/\b(\d{4})\.T\b/g) || []).forEach(m => out.add(m));
  return [...out];
}

export async function fetchArticles() {
  try {
    const res = await fetch(NEWS_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(`[reuters] HTTP ${res.status}`);
      return [];
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const articles = [];

    // Reuters uses data-testid or media-story patterns
    $("a[href*='/article/'], a[href*='/markets/'], h3 a").each((_, el) => {
      const href = $(el).attr("href");
      const title = $(el).text().trim();
      if (!title || !href || title.length < 10) return;

      const link = href.startsWith("http") ? href : `https://jp.reuters.com${href}`;
      if (articles.some(a => a.source_url === link)) return;

      articles.push({
        source: "reuters",
        source_url: link,
        title,
        title_ja: title,
        body_text: null,
        category: "market",
        published_at: new Date().toISOString(),
        tickers: extractTickers(title),
      });
    });

    return articles.slice(0, 30);
  } catch (err) {
    console.warn("[reuters] Fetch failed:", err.message);
    return [];
  }
}
