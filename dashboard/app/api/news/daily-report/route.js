import { query } from "../../../../lib/db.js";
import { NextResponse } from "next/server";

function todayJST() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

// GET /api/news/daily-report?date=YYYY-MM-DD — retrieve cached report
// GET /api/news/daily-report?list=true&days=30 — list recent reports
export async function GET(request) {
  const { searchParams } = new URL(request.url);

  // List mode: return recent reports
  if (searchParams.get("list") === "true") {
    const days = Math.min(Number(searchParams.get("days")) || 30, 180);
    try {
      const result = await query(
        `SELECT report_date, article_count, report_json, generated_at
         FROM daily_news_reports
         WHERE report_date >= CURRENT_DATE - $1::int
         ORDER BY report_date DESC`,
        [days]
      );
      return NextResponse.json({ success: true, reports: result.rows });
    } catch (err) {
      console.error("[daily-report] list error:", err);
      return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
  }

  // Single date mode
  const dateStr = searchParams.get("date") || todayJST();

  try {
    const cached = await query(
      `SELECT report_date, article_count, report_json, generated_at
       FROM daily_news_reports WHERE report_date = $1`,
      [dateStr]
    );

    if (cached.rows.length > 0) {
      const row = cached.rows[0];
      return NextResponse.json({
        success: true,
        report: row.report_json,
        article_count: row.article_count,
        generated_at: row.generated_at,
        report_date: row.report_date,
      });
    }

    return NextResponse.json({ success: true, empty: true });
  } catch (err) {
    console.error("[daily-report] GET error:", err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

// POST /api/news/daily-report — generate (or regenerate) daily report
export async function POST(request) {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    return NextResponse.json(
      { success: false, error: "GEMINI_API_KEY not configured." },
      { status: 500 }
    );
  }

  let dateStr = todayJST();
  try {
    const body = await request.json().catch(() => ({}));
    if (body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      dateStr = body.date;
    }
  } catch {}

  try {
    // 1. Gather all analyzed articles for the date
    const articlesRes = await query(
      `SELECT na.id, na.source, na.title, na.title_ja,
              na.sentiment, na.sentiment_score,
              na.impact_level, na.news_category, na.ai_summary, na.published_at,
              COALESCE(
                json_agg(json_build_object('ticker_code', nat.ticker_code))
                FILTER (WHERE nat.ticker_code IS NOT NULL), '[]'
              ) as tickers
       FROM news_articles na
       LEFT JOIN news_article_tickers nat ON nat.article_id = na.id
       WHERE na.is_analyzed = TRUE AND na.published_at::date = $1
       GROUP BY na.id
       ORDER BY CASE na.impact_level
                  WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3
                END,
                na.published_at DESC
       LIMIT 100`,
      [dateStr]
    );

    const articles = articlesRes.rows;

    if (articles.length === 0) {
      return NextResponse.json({ success: true, empty: true, article_count: 0 });
    }

    // 2. Fetch portfolio holdings for cross-reference
    let portfolioTickers = [];
    try {
      const ph = await query(
        `SELECT ticker_code FROM portfolio_holdings WHERE status = 'open'`
      );
      portfolioTickers = ph.rows.map((r) => r.ticker_code);
    } catch {}

    // 3. Build prompt
    const articlesText = articles
      .map((a, i) => {
        const tickers =
          typeof a.tickers === "string" ? JSON.parse(a.tickers) : a.tickers;
        const tickerCodes = tickers.map((t) => t.ticker_code).join(", ");
        return (
          `[${i + 1}] ${a.impact_level?.toUpperCase() || "LOW"} | ${a.sentiment || "Neutral"} (${a.sentiment_score ?? 0}) | ${a.news_category || "other"}\n` +
          `    "${a.ai_summary || a.title}"\n` +
          (tickerCodes ? `    Tickers: ${tickerCodes}\n` : "")
        );
      })
      .join("\n");

    const prompt = `You are a Japanese stock market (JPX/TSE) analyst writing a daily news briefing for a swing trader.
Given the following ${articles.length} analyzed articles from ${dateStr}, write a cohesive daily report in plain English.

ARTICLES (sorted by impact level):
${articlesText}

PORTFOLIO HOLDINGS (tickers currently held by the trader):
${portfolioTickers.length > 0 ? portfolioTickers.join(", ") : "None"}

Write the report with these sections:

1. "market_overview": 2-3 sentences summarizing the day's overall market tone. Mention the sentiment split (bullish vs bearish), dominant news categories, and any overarching themes. Be specific about what drove sentiment.

2. "high_impact_events": An array of the most important events. Each with:
   - "headline": one-line summary
   - "tickers": array of affected ticker codes (####.T format)
   - "sentiment": "Bullish" | "Bearish" | "Neutral"
   - "detail": 1-2 sentences explaining why this matters for a swing trader
   Only include high-impact articles. If none, return an empty array.

3. "sector_highlights": An array grouping notable news by sector. Each with:
   - "sector": sector name
   - "tone": "Bullish" | "Bearish" | "Mixed" | "Neutral"
   - "summary": 1-2 sentences about what happened in this sector
   Only include sectors with notable news.

4. "ticker_watch": An array for tickers that appeared in multiple articles or had significant news:
   - "ticker": ticker code (####.T)
   - "article_count": how many articles mention this ticker
   - "net_sentiment": "Bullish" | "Bearish" | "Neutral"
   - "note": one sentence explaining why this ticker deserves attention
   - "in_portfolio": true if this ticker is in the trader's portfolio
   Prioritize portfolio holdings. Max 10 tickers.

5. "trading_implications": 2-3 sentences about what today's news means for swing trading decisions. Be actionable — mention specific sectors, setups, or risks.

Be concise and direct. Write for an experienced trader who wants signal, not noise.`;

    // 4. Call Gemini
    const report = await callGemini(prompt, geminiApiKey);

    // 5. Cache in DB
    await query(
      `INSERT INTO daily_news_reports (report_date, article_count, report_json, generated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (report_date)
       DO UPDATE SET article_count = $2, report_json = $3, generated_at = NOW()`,
      [dateStr, articles.length, JSON.stringify(report)]
    );

    return NextResponse.json({
      success: true,
      report,
      article_count: articles.length,
      generated_at: new Date().toISOString(),
      report_date: dateStr,
    });
  } catch (err) {
    console.error("[daily-report] POST error:", err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

async function callGemini(prompt, apiKey) {
  const payload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          market_overview: { type: "STRING" },
          high_impact_events: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                headline: { type: "STRING" },
                tickers: { type: "ARRAY", items: { type: "STRING" } },
                sentiment: {
                  type: "STRING",
                  enum: ["Bullish", "Bearish", "Neutral"],
                },
                detail: { type: "STRING" },
              },
              required: ["headline", "tickers", "sentiment", "detail"],
            },
          },
          sector_highlights: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                sector: { type: "STRING" },
                tone: {
                  type: "STRING",
                  enum: ["Bullish", "Bearish", "Mixed", "Neutral"],
                },
                summary: { type: "STRING" },
              },
              required: ["sector", "tone", "summary"],
            },
          },
          ticker_watch: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                ticker: { type: "STRING" },
                article_count: { type: "INTEGER" },
                net_sentiment: { type: "STRING" },
                note: { type: "STRING" },
                in_portfolio: { type: "BOOLEAN" },
              },
              required: ["ticker", "note"],
            },
          },
          trading_implications: { type: "STRING" },
        },
        required: [
          "market_overview",
          "high_impact_events",
          "sector_highlights",
          "ticker_watch",
          "trading_implications",
        ],
      },
    },
  };

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Gemini API error ${response.status}: ${text.slice(0, 200)}`
    );
  }

  const result = await response.json();
  const raw = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Empty Gemini response");

  return JSON.parse(raw);
}
