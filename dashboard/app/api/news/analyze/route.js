import { query } from "../../../../lib/db.js";
import { NextResponse } from "next/server";

const BATCH_SIZE = 50;

// POST /api/news/analyze  — process unanalyzed articles via Gemini
export async function POST(request) {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    return NextResponse.json(
      { success: false, error: "GEMINI_API_KEY not configured." },
      { status: 500 }
    );
  }

  let limit = BATCH_SIZE;
  let reanalyze = false;
  try {
    const body = await request.json().catch(() => ({}));
    if (body.limit && Number.isFinite(body.limit)) limit = Math.min(body.limit, 50);
    if (body.reanalyze) reanalyze = true;
  } catch {}

  try {
    // Re-analysis: reset articles that have zero ticker associations
    if (reanalyze) {
      await query(
        `UPDATE news_articles SET is_analyzed = FALSE
         WHERE is_analyzed = TRUE
           AND id NOT IN (SELECT DISTINCT article_id FROM news_article_tickers)`
      );
    }

    const unanalyzed = await query(
      `SELECT id, source, title, title_ja, body_text, category, published_at
       FROM news_articles
       WHERE is_analyzed = FALSE
       ORDER BY fetched_at ASC
       LIMIT $1`,
      [limit]
    );

    if (unanalyzed.rows.length === 0) {
      return NextResponse.json({ success: true, analyzed: 0, message: "No unanalyzed articles." });
    }

    let analyzed = 0;
    let errors = 0;

    // Process in small batches to stay within Gemini context limits
    const chunks = [];
    for (let i = 0; i < unanalyzed.rows.length; i += 5) {
      chunks.push(unanalyzed.rows.slice(i, i + 5));
    }

    for (const chunk of chunks) {
      try {
        const results = await analyzeWithGemini(chunk, geminiApiKey);

        for (let i = 0; i < chunk.length; i++) {
          const article = chunk[i];
          const analysis = results[i];
          if (!analysis) { errors++; continue; }

          await query(
            `UPDATE news_articles SET
               is_analyzed = TRUE,
               relevance_score = $2,
               impact_level = $3,
               sentiment = $4,
               sentiment_score = $5,
               news_category = $6,
               ai_summary = $7,
               analysis_json = $8,
               title = COALESCE(NULLIF($9, ''), title),
               analyzed_at = NOW()
             WHERE id = $1`,
            [
              article.id,
              analysis.relevance_score ?? 0.5,
              analysis.impact_level || "low",
              analysis.sentiment || "Neutral",
              analysis.sentiment_score ?? 0,
              analysis.news_category || "other",
              analysis.summary || null,
              JSON.stringify(analysis),
              analysis.title_en || null,
            ]
          );

          // Insert any additional tickers Gemini extracted
          if (Array.isArray(analysis.extracted_tickers)) {
            for (const t of analysis.extracted_tickers) {
              const code = /^\d{4}$/.test(t) ? `${t}.T` : t;
              if (!/^\d{4}\.T$/.test(code)) continue;
              await query(
                `INSERT INTO news_article_tickers (article_id, ticker_code, is_primary)
                 VALUES ($1, $2, FALSE)
                 ON CONFLICT (article_id, ticker_code) DO NOTHING`,
                [article.id, code]
              );
            }
          }

          // Insert inferred tickers (company name → code mappings from Gemini)
          if (Array.isArray(analysis.inferred_tickers)) {
            for (const item of analysis.inferred_tickers) {
              const raw = item.code || "";
              const code = /^\d{4}$/.test(raw) ? `${raw}.T` : raw;
              if (!/^\d{4}\.T$/.test(code)) continue;
              // Validate against our tickers table
              const exists = await query(
                `SELECT 1 FROM tickers WHERE code = $1`,
                [code]
              );
              if (exists.rows.length === 0) continue;
              await query(
                `INSERT INTO news_article_tickers (article_id, ticker_code, is_primary)
                 VALUES ($1, $2, FALSE)
                 ON CONFLICT (article_id, ticker_code) DO NOTHING`,
                [article.id, code]
              );
            }
          }

          analyzed++;
        }
      } catch (err) {
        console.error("[news/analyze] Gemini batch error:", err.message);
        errors += chunk.length;
      }
    }

    return NextResponse.json({ success: true, analyzed, errors });
  } catch (err) {
    console.error("[news/analyze] Error:", err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

async function analyzeWithGemini(articles, apiKey) {
  const articlesText = articles
    .map(
      (a, i) =>
        `[${i}] Title: "${a.title_ja || a.title}"\n` +
        `    Source: ${a.source}, Category: ${a.category || "N/A"}\n` +
        `    Date: ${a.published_at || "unknown"}\n` +
        (a.body_text ? `    Body: ${a.body_text.slice(0, 800)}\n` : "")
    )
    .join("\n");

  const prompt = `You are a Japanese stock market (JPX/TSE) news analyst. Analyze each article below and return a JSON array with one object per article, in the same order.

For each article return:
- "relevance_score": 0.0-1.0 (how relevant to Japanese stock trading decisions; 0 = irrelevant fluff, 1 = directly actionable)
- "impact_level": "high" | "medium" | "low" (high = earnings surprise, M&A, major guidance revision; medium = new product, management change, dividend; low = routine disclosure, market commentary)
- "sentiment": "Bullish" | "Bearish" | "Neutral"
- "sentiment_score": -1.0 to 1.0 (negative = bearish, positive = bullish)
- "news_category": one of ["earnings", "guidance", "M&A", "restructuring", "macro", "dividend", "buyback", "regulation", "product", "other"]
- "title_en": English translation of the article title (concise, preserve meaning and key terms)
- "summary": one-sentence English summary of the article
- "extracted_tickers": array of 4-digit Japanese stock codes explicitly mentioned in the text (e.g. ["7203", "6758"])
- "inferred_tickers": array of objects for companies discussed in the article, even if the stock code is not written. Identify the company by name and provide its 4-digit TSE/JPX stock code. Example: [{"company": "トヨタ自動車", "code": "7203"}, {"company": "ソニーグループ", "code": "6758"}]. Only include companies listed on TSE/JPX. If no specific company is discussed, return an empty array.

Articles:
${articlesText}`;

  const payload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            relevance_score: { type: "NUMBER" },
            impact_level: { type: "STRING", enum: ["high", "medium", "low"] },
            sentiment: { type: "STRING", enum: ["Bullish", "Bearish", "Neutral"] },
            sentiment_score: { type: "NUMBER" },
            news_category: {
              type: "STRING",
              enum: ["earnings", "guidance", "M&A", "restructuring", "macro", "dividend", "buyback", "regulation", "product", "other"],
            },
            title_en: { type: "STRING" },
            summary: { type: "STRING" },
            extracted_tickers: { type: "ARRAY", items: { type: "STRING" } },
            inferred_tickers: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  company: { type: "STRING" },
                  code: { type: "STRING" },
                },
                required: ["company", "code"],
              },
            },
          },
          required: ["relevance_score", "impact_level", "sentiment", "sentiment_score", "news_category", "title_en", "summary", "extracted_tickers", "inferred_tickers"],
        },
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
    throw new Error(`Gemini API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const result = await response.json();
  const raw = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Empty Gemini response");

  return JSON.parse(raw);
}
