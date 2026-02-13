import * as cheerio from "cheerio";

// Kabutan server-side news scraper
// Fetches the latest market news from kabutan.jp and extracts JP tickers

const NEWS_URL = "https://kabutan.jp/news/marketnews/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (base) => base + Math.floor(Math.random() * base * 0.5);

// Extract JP ticker codes (####.T) from HTML content
function extractTickers(html) {
  if (!html) return [];
  const out = new Set();
  const $ = cheerio.load(html);

  // Links like /stocks/7203 or ?code=7203
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const mPath = href.match(/\/stocks?\/(\d{4})(?:\/|$)/);
    if (mPath) out.add(`${mPath[1]}.T`);
    const mQuery = href.match(/[?&]code=(\d{4})(?:&|$)/);
    if (mQuery) out.add(`${mQuery[1]}.T`);
  });

  // Bracketed codes in text: ＜7203＞ <7203> [7203]
  const text = $.text()
    .replace(/[０-９]/g, (d) =>
      String.fromCharCode(d.charCodeAt(0) - 0xff10 + 0x30)
    );
  (text.match(/＜\s*(\d{4})\s*＞/g) || []).forEach((m) => {
    const code = (m.match(/(\d{4})/) || [])[1];
    if (code) out.add(`${code}.T`);
  });
  (text.match(/[<\[（(]\s*(\d{4})\s*[>\]）)]/g) || []).forEach((m) => {
    const code = (m.match(/(\d{4})/) || [])[1];
    if (code) out.add(`${code}.T`);
  });

  return [...out];
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "ja,en;q=0.5",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 403 || res.status === 429) {
    throw new Error(`BLOCKED:${res.status}`);
  }
  if (!res.ok) throw new Error(`Kabutan fetch failed: ${res.status} ${url}`);
  return res.text();
}

export async function fetchArticles({ maxArticles = 10 } = {}) {
  const articles = [];
  let blocked = false;

  // Fetch the news listing page
  const listHtml = await fetchPage(NEWS_URL);
  const $list = cheerio.load(listHtml);

  // Extract article links from the listing
  const links = [];
  $list('a[href*="/news/"]').each((_, el) => {
    const href = $list(el).attr("href") || "";
    if (!href.match(/\/news\/\d+/)) return;
    const url = href.startsWith("http") ? href : `https://kabutan.jp${href}`;
    const title = $list(el).text().trim();
    if (title && !links.some((l) => l.url === url)) {
      links.push({ url, title_ja: title });
    }
  });

  // Also extract tickers visible on the listing page itself
  const listingTickers = extractTickers(listHtml);

  // Fetch each article detail page (with safe pacing)
  for (const link of links.slice(0, maxArticles)) {
    if (blocked) break;

    try {
      await wait(jitter(1500)); // 1.5-2.25s between requests

      const detailHtml = await fetchPage(link.url);
      const $detail = cheerio.load(detailHtml);

      // Extract body text
      const bodyEl = $detail(".news-body, .article-body, #article-body, .newsDetail");
      const bodyText = bodyEl.length
        ? bodyEl
            .find("p")
            .map((_, p) => $detail(p).text().trim())
            .get()
            .filter(Boolean)
            .join(" ")
            .slice(0, 4000)
        : null;

      // Extract datetime
      const timeEl = $detail("time[datetime]");
      const datetime = timeEl.attr("datetime") || null;

      // Extract category
      const category =
        $detail(".news_category-factor, .category").first().text().trim() || null;

      // Extract tickers from the detail page
      const tickers = extractTickers(detailHtml);

      // Only include articles with JP tickers
      const jpTickers = tickers.filter((t) => /^\d{4}\.T$/.test(t));
      if (jpTickers.length === 0) continue;

      articles.push({
        source: "kabutan",
        source_url: link.url,
        title: link.title_ja,
        title_ja: link.title_ja,
        body_text: bodyText,
        category,
        published_at: datetime ? new Date(datetime).toISOString() : null,
        tickers: jpTickers,
      });
    } catch (err) {
      if (err.message?.startsWith("BLOCKED:")) {
        console.warn(`[kabutan] Blocked (${err.message}) — stopping early with ${articles.length} articles`);
        blocked = true;
      } else {
        console.warn(`[kabutan] Failed to fetch ${link.url}:`, err.message);
      }
    }
  }

  return articles;
}
