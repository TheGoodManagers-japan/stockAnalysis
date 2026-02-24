import { query } from "./db.js";
import { GEMINI_MODEL, AI_REVIEW_BATCH_SIZE, AI_REVIEW_BATCH_DELAY_MS } from "./constants.js";

const BATCH_SIZE = AI_REVIEW_BATCH_SIZE;
const BATCH_DELAY_MS = AI_REVIEW_BATCH_DELAY_MS;

/**
 * Perform AI review of buy signals for a given scan.
 * Calls Gemini to validate each buyNow=true signal with company info,
 * micro/macro news, sector context, fundamentals, and a confidence score.
 *
 * @param {string} scanId - UUID of the scan run
 * @param {object} [options]
 * @param {string} [options.tickerFilter] - single ticker to review
 * @param {number} [options.limit] - max signals to review
 * @returns {{ reviews: object[], errors: string[] }}
 */
export async function performAiReview(scanId, options = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const { tickerFilter, limit } = options;
  const errors = [];

  // 1. Get signals — when a specific ticker is requested, analyze it regardless of buy status
  let signalQuery = `
    SELECT sr.ticker_code, t.short_name, t.sector,
           sr.current_price, sr.tier, sr.buy_now_reason, sr.trigger_type,
           sr.short_term_score, sr.long_term_score,
           sr.stop_loss, sr.price_target, sr.market_regime,
           sr.fundamental_score, sr.valuation_score, sr.value_quadrant
    FROM scan_results sr
    LEFT JOIN tickers t ON t.code = sr.ticker_code
    WHERE sr.scan_id = $1`;
  const params = [scanId];

  if (tickerFilter) {
    signalQuery += ` AND sr.ticker_code = $2`;
    params.push(tickerFilter);
  } else {
    signalQuery += ` AND sr.is_buy_now = true`;
  }

  signalQuery += ` ORDER BY sr.tier ASC, sr.short_term_score ASC`;

  if (limit && !tickerFilter) {
    signalQuery += ` LIMIT $${params.length + 1}`;
    params.push(limit);
  }

  const buySignals = await query(signalQuery, params);

  if (buySignals.rows.length === 0) {
    return { reviews: [], errors: [] };
  }

  // 2. Check existing reviews
  const signalCodes = buySignals.rows.map((s) => s.ticker_code);
  const existingReviews = await query(
    `SELECT ticker_code, verdict, reason, confidence, full_analysis
     FROM ai_reviews
     WHERE scan_id = $1 AND ticker_code = ANY($2)`,
    [scanId, signalCodes]
  );

  const reviewMap = new Map();
  existingReviews.rows.forEach((r) => {
    reviewMap.set(r.ticker_code, {
      ...r.full_analysis,
      verdict: r.verdict,
      verdict_reason: r.reason,
      confidence: r.confidence,
    });
  });

  // When a specific ticker is requested, always re-analyze (skip cache)
  const signalsToAnalyze = tickerFilter
    ? buySignals.rows
    : buySignals.rows.filter((s) => !reviewMap.has(s.ticker_code));

  // 3. Gather macro context (shared across all signals)
  let macroNews = [];
  let sectorRotation = [];
  if (signalsToAnalyze.length > 0) {
    try {
      const macroResult = await query(
        `SELECT title, title_ja, sentiment, impact_level, news_category, ai_summary, published_at
         FROM news_articles
         WHERE is_analyzed = true
           AND (news_category = 'macro' OR impact_level = 'high')
           AND published_at > NOW() - INTERVAL '7 days'
         ORDER BY published_at DESC
         LIMIT 10`
      );
      macroNews = macroResult.rows;
    } catch {
      // non-fatal
    }

    try {
      const sectorResult = await query(
        `SELECT sector_id, composite_score, recommendation
         FROM sector_rotation_snapshots
         WHERE scan_date = CURRENT_DATE
         ORDER BY composite_score DESC`
      );
      sectorRotation = sectorResult.rows;
    } catch {
      // non-fatal
    }
  }

  // 4. Process in batches
  if (signalsToAnalyze.length > 0) {
    const chunks = [];
    for (let i = 0; i < signalsToAnalyze.length; i += BATCH_SIZE) {
      chunks.push(signalsToAnalyze.slice(i, i + BATCH_SIZE));
    }

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      try {
        const stockData = await gatherStockContext(chunk);
        const newReviews = await callGemini(
          stockData,
          macroNews,
          sectorRotation,
          apiKey
        );

        for (const rev of newReviews) {
          if (!rev.ticker_code) continue;
          await query(
            `INSERT INTO ai_reviews (scan_id, ticker_code, verdict, reason, confidence, full_analysis)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (scan_id, ticker_code) DO UPDATE SET
               verdict = EXCLUDED.verdict,
               reason = EXCLUDED.reason,
               confidence = EXCLUDED.confidence,
               full_analysis = EXCLUDED.full_analysis,
               created_at = NOW()`,
            [
              scanId,
              rev.ticker_code,
              rev.verdict,
              rev.verdict_reason,
              rev.confidence ?? null,
              JSON.stringify(rev),
            ]
          );
          reviewMap.set(rev.ticker_code, rev);
        }
      } catch (err) {
        console.error(
          `[ai-review] Batch ${ci + 1}/${chunks.length} failed:`,
          err.message
        );
        errors.push(
          `Batch ${ci + 1} failed: ${err.message}`
        );
      }

      // Delay between batches
      if (ci < chunks.length - 1) {
        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      }
    }
  }

  // 5. Build final response
  const reviews = buySignals.rows
    .map((s) => {
      const rev = reviewMap.get(s.ticker_code);
      if (!rev) return null;
      return {
        ...rev,
        ticker_code: s.ticker_code,
        short_name: s.short_name || s.ticker_code,
        sector: s.sector || null,
        current_price: s.current_price || null,
        tier: s.tier || null,
        stop_loss: s.stop_loss || null,
        price_target: s.price_target || null,
        market_regime: s.market_regime || null,
      };
    })
    .filter(Boolean);

  return { reviews, errors };
}

// --- Helpers ---

async function gatherStockContext(signals) {
  const stockData = [];
  for (const signal of signals) {
    // Micro news (last 14 days)
    const news = await query(
      `SELECT na.title, na.title_ja, na.sentiment, na.sentiment_score,
              na.impact_level, na.news_category, na.ai_summary, na.published_at
       FROM news_articles na
       JOIN news_article_tickers nat ON nat.article_id = na.id
       WHERE nat.ticker_code = $1
         AND na.published_at > NOW() - INTERVAL '14 days'
         AND na.is_analyzed = true
       ORDER BY na.published_at DESC
       LIMIT 5`,
      [signal.ticker_code]
    );

    // Fundamentals
    const snapshot = await query(
      `SELECT pe_ratio, pb_ratio, market_cap, dividend_yield,
              eps_trailing, eps_forward, eps_growth_rate,
              debt_equity_ratio, next_earnings_date,
              fifty_two_week_high, fifty_two_week_low
       FROM stock_snapshots
       WHERE ticker_code = $1
       ORDER BY snapshot_date DESC LIMIT 1`,
      [signal.ticker_code]
    );

    stockData.push({
      ...signal,
      recentNews: news.rows,
      fundamentals: snapshot.rows[0] || null,
    });
  }
  return stockData;
}

function buildPrompt(stockData, macroNews, sectorRotation) {
  // Macro context section
  let macroSection = "";
  if (macroNews.length > 0) {
    const macroLines = macroNews
      .map(
        (n) =>
          `- [${n.impact_level}] ${n.title_ja || n.title} (${n.sentiment}, ${n.news_category})`
      )
      .join("\n");
    macroSection = `\nMACRO MARKET CONTEXT (last 7 days):\n${macroLines}\n`;
  } else {
    macroSection = "\nMACRO MARKET CONTEXT: No significant macro news in last 7 days.\n";
  }

  // Sector rotation section
  let sectorSection = "";
  if (sectorRotation.length > 0) {
    const sectorMap = new Map(
      sectorRotation.map((s) => [s.sector_id, s])
    );
    const relevantSectors = new Set(stockData.map((s) => s.sector).filter(Boolean));
    const sectorLines = [...relevantSectors]
      .map((sec) => {
        const rot = sectorMap.get(sec);
        if (!rot) return `- ${sec}: No rotation data available`;
        return `- ${sec}: Composite ${rot.composite_score}/100, Recommendation: ${rot.recommendation}`;
      })
      .join("\n");
    sectorSection = `\nSECTOR ROTATION STATUS:\n${sectorLines}\n`;
  }

  // Per-stock summaries
  const stockSummaries = stockData
    .map((s) => {
      const newsText =
        s.recentNews.length > 0
          ? s.recentNews
              .map(
                (n) =>
                  `  - [${n.news_category || "other"}] ${n.title_ja || n.title} (${n.sentiment}, impact: ${n.impact_level})`
              )
              .join("\n")
          : "  No recent news found.";

      const fundText = s.fundamentals
        ? `  P/E: ${s.fundamentals.pe_ratio || "N/A"}, P/B: ${s.fundamentals.pb_ratio || "N/A"}, ` +
          `Market Cap: ${s.fundamentals.market_cap ? Number(s.fundamentals.market_cap).toLocaleString() : "N/A"}, ` +
          `Div Yield: ${s.fundamentals.dividend_yield || "N/A"}%, ` +
          `EPS Growth: ${s.fundamentals.eps_growth_rate || "N/A"}%, ` +
          `D/E: ${s.fundamentals.debt_equity_ratio || "N/A"}, ` +
          `Next Earnings: ${s.fundamentals.next_earnings_date ? new Date(s.fundamentals.next_earnings_date).toLocaleDateString() : "N/A"}`
        : "  No fundamental data available.";

      return `
### ${s.ticker_code} — ${s.short_name || "Unknown"} (${s.sector || "Unknown sector"})
- Price: ¥${Number(s.current_price || 0).toLocaleString()} | Tier: ${s.tier} | Regime: ${s.market_regime || "N/A"}
- Trigger: ${s.trigger_type || "N/A"} | Reason: ${s.buy_now_reason || "N/A"}
- Scores: Fundamental ${s.fundamental_score || "N/A"}/10, Valuation ${s.valuation_score || "N/A"}/10
- ST Score: ${s.short_term_score ?? "N/A"}, LT Score: ${s.long_term_score ?? "N/A"}
- Stop: ¥${s.stop_loss ? Number(s.stop_loss).toLocaleString() : "N/A"} | Target: ¥${s.price_target ? Number(s.price_target).toLocaleString() : "N/A"}
**Recent News (micro):**
${newsText}
**Fundamentals:**
${fundText}`;
    })
    .join("\n");

  return `You are a Japanese stock market analyst reviewing swing trade buy signals for JPX-listed stocks.
${macroSection}${sectorSection}
For each stock below, provide:
1. **company_description**: A brief 1-sentence description of what the company does
2. **news_summary**: Summary of recent micro news impact on this specific stock (or "No recent news" if none)
3. **macro_context**: How current macro conditions (BOJ policy, USD/JPY, global risk appetite, sector trends) affect this stock's sector and business. Reference the macro news and sector rotation data above.
4. **earnings_status**: Assessment of fundamentals/earnings outlook
5. **verdict**: One of "CONFIRMED", "CAUTION", or "AVOID"
6. **verdict_reason**: 1-2 sentence explanation of your verdict
7. **confidence**: 0-100 integer. 0 = pure guess/no data, 50 = mixed signals, 80+ = strong conviction with aligned technical+fundamental+news signals.

Criteria for verdicts:
- CONFIRMED: Technical signal aligns with fundamentals, no red flags in news, macro is supportive — safe to buy
- CAUTION: Some concerns (upcoming earnings, mixed news, high valuation, adverse macro) — proceed with smaller position
- AVOID: Red flags found (bad news, deteriorating fundamentals, earnings risk, governance issues, hostile macro)

Stocks to review:
${stockSummaries}`;
}

const RESPONSE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      ticker_code: { type: "STRING" },
      company_description: { type: "STRING" },
      news_summary: { type: "STRING" },
      macro_context: { type: "STRING" },
      earnings_status: { type: "STRING" },
      verdict: { type: "STRING", enum: ["CONFIRMED", "CAUTION", "AVOID"] },
      verdict_reason: { type: "STRING" },
      confidence: { type: "INTEGER" },
    },
    required: [
      "ticker_code",
      "company_description",
      "news_summary",
      "macro_context",
      "earnings_status",
      "verdict",
      "verdict_reason",
      "confidence",
    ],
  },
};

async function callGemini(stockData, macroNews, sectorRotation, apiKey) {
  const prompt = buildPrompt(stockData, macroNews, sectorRotation);

  const payload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
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
