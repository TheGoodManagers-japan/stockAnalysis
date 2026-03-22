import Anthropic from "@anthropic-ai/sdk";
import { query } from "./db.js";
import { AI_REVIEW_MODEL, AI_REVIEW_BATCH_SIZE, AI_REVIEW_BATCH_DELAY_MS } from "./constants.js";

const BATCH_SIZE = AI_REVIEW_BATCH_SIZE;
const BATCH_DELAY_MS = AI_REVIEW_BATCH_DELAY_MS;

/**
 * Perform AI review of buy signals for a given scan.
 * Calls Claude Sonnet to validate each buyNow=true signal with company info,
 * micro/macro news, sector context, fundamentals, and a confidence score.
 *
 * @param {string} scanId - UUID of the scan run
 * @param {object} [options]
 * @param {string} [options.tickerFilter] - single ticker to review
 * @param {number} [options.limit] - max signals to review
 * @returns {{ reviews: object[], errors: string[] }}
 */
export async function performAiReview(scanId, options = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const { tickerFilter, limit, force } = options;
  const errors = [];

  // 1. Get signals — when a specific ticker is requested, analyze it regardless of buy status
  let signalQuery = `
    SELECT sr.ticker_code, t.short_name, t.sector,
           sr.current_price, sr.tier, sr.buy_now_reason, sr.trigger_type,
           sr.short_term_score, sr.long_term_score,
           sr.stop_loss, sr.price_target, sr.market_regime,
           sr.fundamental_score, sr.valuation_score, sr.technical_score,
           sr.master_score,
           (sr.other_data_json->>'scoring_confidence')::numeric AS scoring_confidence,
           (sr.other_data_json->>'data_freshness') AS data_freshness,
           (sr.other_data_json->>'tier_trajectory') AS tier_trajectory,
           (sr.other_data_json->>'is_conflicted')::boolean AS is_conflicted,
           (sr.other_data_json->>'score_disagreement')::numeric AS score_disagreement
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

  // When a specific ticker is requested or force=true, always re-analyze (skip cache)
  const signalsToAnalyze = (tickerFilter || force)
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
        const newReviews = await callClaude(
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

      // Build scoring context line
      const scoringContext = [
        s.master_score != null ? `Master Score: ${s.master_score}/100` : null,
        s.scoring_confidence != null ? `Data Confidence: ${Math.round(Number(s.scoring_confidence) * 100)}%` : null,
        s.tier_trajectory && s.tier_trajectory !== "stable" ? `Trajectory: ${s.tier_trajectory}` : null,
        s.is_conflicted ? `SCORES CONFLICTED (disagreement: ${Number(s.score_disagreement || 0).toFixed(1)})` : null,
        s.data_freshness && s.data_freshness !== "fresh" ? `Data Freshness: ${s.data_freshness}` : null,
      ].filter(Boolean).join(" | ");

      return `
### ${s.ticker_code} — ${s.short_name || "Unknown"} (${s.sector || "Unknown sector"})
- Price: ¥${Number(s.current_price || 0).toLocaleString()} | Tier: ${s.tier} | Regime: ${s.market_regime || "N/A"}
- Trigger: ${s.trigger_type || "N/A"} | Reason: ${s.buy_now_reason || "N/A"}
- Scores: Fundamental ${s.fundamental_score || "N/A"}/10, Valuation ${s.valuation_score || "N/A"}/10, Technical ${s.technical_score || "N/A"}/10
- ST Score: ${s.short_term_score ?? "N/A"}, LT Score: ${s.long_term_score ?? "N/A"}
${scoringContext ? `- ${scoringContext}\n` : ""}- Stop: ¥${s.stop_loss ? Number(s.stop_loss).toLocaleString() : "N/A"} | Target: ¥${s.price_target ? Number(s.price_target).toLocaleString() : "N/A"}
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

CONFIDENCE CALIBRATION — use the FULL 0-100 range, do NOT cluster around 45:
- 15-30: Severe data gaps or multiple red flags. Example: No fundamentals AND bearish regime AND weak technicals.
- 35-50: More negatives than positives, but tradeable with tight risk management.
- 55-65: Balanced setup with identifiable edge. This is where most decent swing trades should fall.
- 70-80: Strong setup with clear catalyst and good risk/reward. Multiple factors aligned.
- 85-95: Exceptional alignment across technicals, fundamentals, and macro. Rare but real.

IMPORTANT: Differentiate your confidence scores between stocks. If you review 10 stocks, they should NOT all get the same confidence. Use the data to rank them relative to each other.

SCORING CONTEXT:
- Master Score (0-100): Composite of all scoring dimensions. >=70 = strong, >=50 = decent, <30 = weak.
- If "SCORES CONFLICTED" appears, investigate which scores disagree and why — but conflicted scores do NOT automatically mean CAUTION. A stock with great technicals (8/10) and weak fundamentals (2/10) can still be CONFIRMED for a swing trade if the technical setup is compelling.
- If "Trajectory: improving", fundamentals are trending better vs. 30+ days ago. If "deteriorating", they're worsening.
- If "Data Freshness: aging/stale", fundamental data may be outdated — weight technical signals more heavily.
- Data Confidence <40% means key metrics are missing — note it but don't let it override a strong technical setup.

VERDICT CRITERIA — for swing trades (5-30 day hold), technicals and risk/reward matter MORE than fundamentals:
- STRONG_BUY: R:R >= 2.5, strong technical trigger (DIP/BREAKOUT), supportive regime, no imminent earnings risk. Fundamentals are a bonus, not a requirement.
- CONFIRMED: Clear technical entry with R:R >= 1.5, and no major red flags. This should be your MOST COMMON verdict for stocks with valid buy signals. These stocks already passed the scanner's entry criteria.
- CAUTION: A specific, identifiable risk that could invalidate the trade within the hold period. Name the concern and what would resolve it. Example: "Earnings in 8 days — wait for results."
- AVOID: The trade setup is fundamentally broken — stop loss too wide, bearish regime, or company-specific crisis (fraud, delisting risk, etc.).
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

const REVIEW_TOOL = {
  name: "submit_reviews",
  description: "Submit structured stock reviews for all analyzed stocks.",
  input_schema: {
    type: "object",
    properties: {
      reviews: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ticker_code: { type: "string" },
            company_description: { type: "string" },
            news_summary: { type: "string" },
            macro_context: { type: "string" },
            earnings_status: { type: "string" },
            bull_points: { type: "array", items: { type: "string" } },
            bear_points: { type: "array", items: { type: "string" } },
            risk_reward_assessment: { type: "string" },
            key_catalyst: { type: "string" },
            watch_for: { type: "string" },
            verdict: { type: "string", enum: ["STRONG_BUY", "CONFIRMED", "CAUTION", "AVOID"] },
            verdict_reason: { type: "string" },
            confidence: { type: "integer" },
          },
          required: [
            "ticker_code", "company_description", "news_summary",
            "macro_context", "earnings_status", "bull_points", "bear_points",
            "risk_reward_assessment", "key_catalyst", "watch_for",
            "verdict", "verdict_reason", "confidence",
          ],
        },
      },
    },
    required: ["reviews"],
  },
};

async function callClaude(stockData, macroNews, sectorRotation, apiKey) {
  const prompt = buildPrompt(stockData, macroNews, sectorRotation);

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: AI_REVIEW_MODEL,
    max_tokens: 8192,
    temperature: 0.3,
    system: "You are a decisive Japanese stock market analyst. Analyze the provided stock data and call the submit_reviews tool with your structured analysis. Always use the tool — never respond with plain text.",
    tools: [REVIEW_TOOL],
    tool_choice: { type: "tool", name: "submit_reviews" },
    messages: [{ role: "user", content: prompt }],
  });

  // Extract the tool use result
  const toolBlock = response.content.find((b) => b.type === "tool_use");
  if (!toolBlock) {
    throw new Error("Claude did not return a tool_use block");
  }

  const result = toolBlock.input;
  if (!result?.reviews || !Array.isArray(result.reviews)) {
    throw new Error("Claude returned invalid review structure");
  }

  return result.reviews;
}
