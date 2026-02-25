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

    const fundamentals = snapshot.rows[0] || null;

    // Compute derived metrics for richer context
    const price = Number(signal.current_price) || 0;
    const stop = Number(signal.stop_loss) || 0;
    const target = Number(signal.price_target) || 0;
    const high52 = Number(fundamentals?.fifty_two_week_high) || 0;
    const low52 = Number(fundamentals?.fifty_two_week_low) || 0;

    const risk = Math.abs(price - stop);
    const reward = Math.abs(target - price);
    const riskRewardRatio = risk > 0 ? (reward / risk).toFixed(2) : null;
    const riskPct = price > 0 ? ((risk / price) * 100).toFixed(1) : null;
    const rewardPct = price > 0 ? ((reward / price) * 100).toFixed(1) : null;
    const pctFrom52High = high52 > 0 ? (((price - high52) / high52) * 100).toFixed(1) : null;
    const pctFrom52Low = low52 > 0 ? (((price - low52) / low52) * 100).toFixed(1) : null;
    const daysToEarnings = fundamentals?.next_earnings_date
      ? Math.ceil((new Date(fundamentals.next_earnings_date) - new Date()) / 86400000)
      : null;

    stockData.push({
      ...signal,
      recentNews: news.rows,
      fundamentals,
      computed: {
        riskRewardRatio,
        riskPct,
        rewardPct,
        pctFrom52High,
        pctFrom52Low,
        daysToEarnings,
      },
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
          `- [${n.impact_level}] ${n.title || n.title_ja} (${n.sentiment}, ${n.news_category})`
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
                  `  - [${n.news_category || "other"}] ${n.title || n.title_ja} (${n.sentiment}, impact: ${n.impact_level})`
              )
              .join("\n")
          : "  No recent news — neutral for swing trade timing.";

      const fundText = s.fundamentals
        ? `  P/E: ${s.fundamentals.pe_ratio || "N/A"}, P/B: ${s.fundamentals.pb_ratio || "N/A"}, ` +
          `Market Cap: ${s.fundamentals.market_cap ? Number(s.fundamentals.market_cap).toLocaleString() : "N/A"}, ` +
          `Div Yield: ${s.fundamentals.dividend_yield || "N/A"}%, ` +
          `EPS Growth: ${s.fundamentals.eps_growth_rate || "N/A"}%, ` +
          `D/E: ${s.fundamentals.debt_equity_ratio || "N/A"}, ` +
          `Next Earnings: ${s.fundamentals.next_earnings_date ? new Date(s.fundamentals.next_earnings_date).toLocaleDateString() : "N/A"}`
        : "  No fundamental data available.";

      const c = s.computed || {};
      const computedText = [
        `  Risk/Reward: ${c.riskRewardRatio || "N/A"}x (Risk: ${c.riskPct || "N/A"}% downside / Reward: ${c.rewardPct || "N/A"}% upside)`,
        `  52W Position: ${c.pctFrom52High || "N/A"}% from high, +${c.pctFrom52Low || "N/A"}% from low`,
        `  Days to Next Earnings: ${c.daysToEarnings != null ? c.daysToEarnings : "Unknown"}`,
      ].join("\n");

      return `
### ${s.ticker_code} — ${s.short_name || "Unknown"} (${s.sector || "Unknown sector"})
- Price: ¥${Number(s.current_price || 0).toLocaleString()} | Tier: ${s.tier} | Regime: ${s.market_regime || "N/A"}
- Trigger: ${s.trigger_type || "N/A"} | Reason: ${s.buy_now_reason || "N/A"}
- Scores: Fundamental ${s.fundamental_score || "N/A"}/10, Valuation ${s.valuation_score || "N/A"}/10
- ST Score: ${s.short_term_score ?? "N/A"}, LT Score: ${s.long_term_score ?? "N/A"}
- Stop: ¥${s.stop_loss ? Number(s.stop_loss).toLocaleString() : "N/A"} | Target: ¥${s.price_target ? Number(s.price_target).toLocaleString() : "N/A"}
**Computed Metrics:**
${computedText}
**Recent News (micro):**
${newsText}
**Fundamentals:**
${fundText}`;
    })
    .join("\n");

  return `You are a decisive Japanese stock market analyst reviewing swing trade buy signals.

CRITICAL RULES — follow these exactly:
- Do NOT hedge. Never say "mixed signals", "proceed with caution", "monitor closely", or "it depends". Be SPECIFIC.
- Every bull_point MUST cite a specific number, price level, ratio, or dated event from the data provided.
- Every bear_point MUST cite a specific number, price level, ratio, or dated event from the data provided.
- Absence of news is NEUTRAL, not negative. Do not penalize stocks for having no recent news.
- If a stock lacks fundamental data, say so directly — do not invent concerns.

CONFIDENCE CALIBRATION (follow strictly):
- 20-35: Data is missing or contradictory. Example: No fundamentals, unclear regime, no news.
- 40-55: Slight lean one way. Example: Decent fundamentals but earnings in 10 days with no guidance.
- 60-75: Clear directional evidence. Example: Strong technicals + good fundamentals + supportive sector, one minor risk.
- 80-90: Multiple factors strongly aligned. Example: Tier 1, UP/STRONG_UP regime, R:R >= 2.0, fund score >= 7, positive sector rotation.
- 91+: Extraordinary alignment across all dimensions. Rare.

VERDICT CRITERIA:
- STRONG_BUY: Tier 1-2, regime UP or STRONG_UP, R:R >= 2.0, fundamental score >= 7, no earnings within 14 days. Everything aligned — full position.
- CONFIRMED: At least 3 of 5 factors positive (technicals, fundamentals, news, macro, risk/reward). Good setup — standard position.
- CAUTION: You must name the ONE specific concern and what would RESOLVE it. Example: "Earnings in 8 days — wait for results or use half position."
- AVOID: At least 2 concrete red flags. Name them explicitly.
${macroSection}${sectorSection}
For each stock, provide ALL of the following:
1. **company_description**: 1 sentence — what the company does and its market position
2. **news_summary**: Impact of recent micro news on this stock. If no news, say "No recent news — neutral for swing trade timing"
3. **macro_context**: How current macro specifically affects THIS stock's sector. Name the transmission mechanism.
4. **earnings_status**: Fundamental health + next earnings risk. If earnings >30 days away, state that explicitly.
5. **bull_points**: Array of 2-4 specific bullish factors. Each MUST reference a number from the data.
6. **bear_points**: Array of 1-3 specific risks. Each MUST reference a number from the data.
7. **risk_reward_assessment**: 1 sentence evaluating the stop/target setup. Reference the R:R ratio.
8. **key_catalyst**: The single most important upcoming event or factor for this stock.
9. **watch_for**: What specific condition would UPGRADE or DOWNGRADE your verdict.
10. **verdict**: One of STRONG_BUY, CONFIRMED, CAUTION, AVOID
11. **verdict_reason**: 2-3 sentences. Sentence 1 = your verdict rationale. Sentence 2 = the biggest risk. Sentence 3 = what would change your mind.
12. **confidence**: 0-100 integer per the calibration above.

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
      bull_points: { type: "ARRAY", items: { type: "STRING" } },
      bear_points: { type: "ARRAY", items: { type: "STRING" } },
      risk_reward_assessment: { type: "STRING" },
      key_catalyst: { type: "STRING" },
      watch_for: { type: "STRING" },
      verdict: { type: "STRING", enum: ["STRONG_BUY", "CONFIRMED", "CAUTION", "AVOID"] },
      verdict_reason: { type: "STRING" },
      confidence: { type: "INTEGER" },
    },
    required: [
      "ticker_code",
      "company_description",
      "news_summary",
      "macro_context",
      "earnings_status",
      "bull_points",
      "bear_points",
      "risk_reward_assessment",
      "key_catalyst",
      "watch_for",
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
      maxOutputTokens: 8192,
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
