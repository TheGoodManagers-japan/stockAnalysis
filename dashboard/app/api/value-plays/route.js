import { NextResponse } from "next/server";
import { query } from "../../../lib/db.js";
import { GEMINI_MODEL } from "../../../lib/constants.js";

export const dynamic = "force-dynamic";

// GET /api/value-plays — get value play candidates from latest (or specific) scan
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedScanId = searchParams.get("scanId");

    // Find the scan to query
    const scanRun = requestedScanId
      ? await query(`SELECT * FROM scan_runs WHERE scan_id = $1`, [requestedScanId])
      : await query(
          `SELECT * FROM scan_runs WHERE status = 'completed' ORDER BY started_at DESC LIMIT 1`
        );

    if (scanRun.rows.length === 0) {
      return NextResponse.json({ success: true, scan: null, results: [] });
    }

    const scan = scanRun.rows[0];

    const results = await query(
      `SELECT sr.*, t.short_name, t.sector
       FROM scan_results sr
       LEFT JOIN tickers t ON t.code = sr.ticker_code
       WHERE sr.scan_id = $1
         AND sr.is_value_candidate = true
       ORDER BY sr.value_play_score DESC NULLS LAST, sr.ticker_code ASC`,
      [scan.scan_id]
    );

    return NextResponse.json({
      success: true,
      scan: {
        scan_id: scan.scan_id,
        started_at: scan.started_at,
        finished_at: scan.finished_at,
        status: scan.status,
        total_tickers: scan.total_tickers,
      },
      count: results.rows.length,
      results: results.rows,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

// POST /api/value-plays — AI deep-dive analysis for a single value play
export async function POST(request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "GEMINI_API_KEY not configured" },
        { status: 500 }
      );
    }

    const { ticker } = await request.json();
    if (!ticker) {
      return NextResponse.json(
        { success: false, error: "ticker is required" },
        { status: 400 }
      );
    }

    // Get the stock's value play data from latest scan
    const result = await query(
      `SELECT sr.*, t.short_name, t.sector
       FROM scan_results sr
       LEFT JOIN tickers t ON t.code = sr.ticker_code
       WHERE sr.ticker_code = $1 AND sr.is_value_candidate = true
       ORDER BY sr.scan_date DESC LIMIT 1`,
      [ticker]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Value play not found" },
        { status: 404 }
      );
    }

    const stock = result.rows[0];
    const vp = stock.value_play_json || {};
    const metrics = vp.metrics || {};

    // Get recent news for this ticker
    let recentNews = [];
    try {
      const newsRes = await query(
        `SELECT na.title, na.title_ja, na.sentiment, na.impact_level,
                na.news_category, na.ai_summary, na.published_at
         FROM news_articles na
         JOIN news_article_tickers nat ON nat.article_id = na.id
         WHERE nat.ticker_code = $1
           AND na.published_at > NOW() - INTERVAL '30 days'
           AND na.is_analyzed = true
         ORDER BY na.published_at DESC
         LIMIT 8`,
        [ticker]
      );
      recentNews = newsRes.rows;
    } catch {
      // non-fatal
    }

    // Get fundamentals from snapshot
    let fundamentals = null;
    try {
      const snapRes = await query(
        `SELECT pe_ratio, pb_ratio, market_cap, dividend_yield,
                eps_trailing, eps_forward, eps_growth_rate,
                debt_equity_ratio, next_earnings_date,
                fifty_two_week_high, fifty_two_week_low
         FROM stock_snapshots
         WHERE ticker_code = $1
         ORDER BY snapshot_date DESC LIMIT 1`,
        [ticker]
      );
      fundamentals = snapRes.rows[0] || null;
    } catch {
      // non-fatal
    }

    // Get sector rotation data
    let sectorRotation = null;
    try {
      const secRes = await query(
        `SELECT composite_score, recommendation
         FROM sector_rotation_snapshots
         WHERE sector_id = $1 AND scan_date = CURRENT_DATE`,
        [stock.sector]
      );
      sectorRotation = secRes.rows[0] || null;
    } catch {
      // non-fatal
    }

    // Build prompt
    const newsText = recentNews.length > 0
      ? recentNews.map((n) =>
          `- [${n.news_category || "other"}] ${n.title_ja || n.title} (${n.sentiment}, impact: ${n.impact_level})`
        ).join("\n")
      : "No recent news found.";

    const fundText = fundamentals
      ? `P/E: ${fundamentals.pe_ratio || "N/A"}, P/B: ${fundamentals.pb_ratio || "N/A"}, ` +
        `Market Cap: ${fundamentals.market_cap ? Number(fundamentals.market_cap).toLocaleString() : "N/A"}, ` +
        `Div Yield: ${fundamentals.dividend_yield || "N/A"}%, ` +
        `EPS Growth: ${fundamentals.eps_growth_rate || "N/A"}%, ` +
        `D/E: ${fundamentals.debt_equity_ratio || "N/A"}, ` +
        `Next Earnings: ${fundamentals.next_earnings_date ? new Date(fundamentals.next_earnings_date).toLocaleDateString() : "N/A"}`
      : "No snapshot data.";

    const sectorText = sectorRotation
      ? `Sector score: ${sectorRotation.composite_score}/100, ${sectorRotation.recommendation}`
      : "No sector rotation data.";

    const prompt = `You are a Japanese stock market value investing analyst. Analyze this value play candidate in depth.

STOCK: ${ticker} - ${stock.short_name || "Unknown"} (${stock.sector || "Unknown sector"})
Price: ¥${Number(stock.current_price || 0).toLocaleString()}
Market Regime: ${stock.market_regime || "N/A"}

VALUE PLAY ANALYSIS (algorithmic):
- Score: ${stock.value_play_score}/100 (Grade ${stock.value_play_grade})
- Classification: ${stock.value_play_class}
- Pillars: Intrinsic ${vp.pillars?.intrinsicValue || 0}/25, Quality ${vp.pillars?.quality || 0}/25, Safety ${vp.pillars?.safetyMargin || 0}/25, Catalyst ${vp.pillars?.catalyst || 0}/25
- Algo Thesis: ${vp.thesis || "N/A"}
- Algo Risks: ${(vp.risks || []).join(", ") || "None identified"}

KEY METRICS:
- PE: ${metrics.peRatio || "N/A"}x, PB: ${metrics.pbRatio || "N/A"}x, EV/EBITDA: ${metrics.evToEbitda || "N/A"}x
- FCF Yield: ${metrics.fcfYield || "N/A"}%, Dividend: ${metrics.dividendYield || "N/A"}%, Div Growth 5yr: ${metrics.dividendGrowth5yr || "N/A"}%
- D/E: ${metrics.debtEquity || "N/A"}x, Implied ROE: ${metrics.impliedROE || "N/A"}%
- Graham Number Discount: ${metrics.grahamDiscount || "N/A"}%, Net Cash Ratio: ${metrics.netCashRatio || "N/A"}%
- Shareholder Yield: ${metrics.shareholderYield || "N/A"}%

FUNDAMENTALS:
${fundText}

SECTOR: ${sectorText}

RECENT NEWS (last 30 days):
${newsText}

Provide a deep-dive analysis with:
1. **company_overview**: What does this company do? Key business segments, competitive position in Japan.
2. **value_thesis**: Why is this stock undervalued? Be specific about which metrics stand out and why.
3. **risk_assessment**: Key risks for this value thesis - what could go wrong? Sector headwinds, governance, cyclicality.
4. **catalyst_analysis**: What could unlock the value? Corporate actions, earnings improvement, sector tailwinds, TSE reforms.
5. **news_impact**: How do recent news and macro conditions affect this stock?
6. **recommendation**: One of "STRONG_BUY", "BUY", "HOLD", "AVOID"
7. **recommendation_reason**: 2-3 sentence summary of your recommendation.
8. **confidence**: 0-100 integer.
9. **fair_value_estimate**: Your estimated fair value range as a string (e.g. "¥2,800-3,200")
10. **time_horizon**: Recommended holding period (e.g. "12-18 months")`;

    const RESPONSE_SCHEMA = {
      type: "OBJECT",
      properties: {
        company_overview: { type: "STRING" },
        value_thesis: { type: "STRING" },
        risk_assessment: { type: "STRING" },
        catalyst_analysis: { type: "STRING" },
        news_impact: { type: "STRING" },
        recommendation: { type: "STRING", enum: ["STRONG_BUY", "BUY", "HOLD", "AVOID"] },
        recommendation_reason: { type: "STRING" },
        confidence: { type: "INTEGER" },
        fair_value_estimate: { type: "STRING" },
        time_horizon: { type: "STRING" },
      },
      required: [
        "company_overview", "value_thesis", "risk_assessment",
        "catalyst_analysis", "news_impact", "recommendation",
        "recommendation_reason", "confidence", "fair_value_estimate",
        "time_horizon",
      ],
    };

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Gemini API error ${response.status}: ${text.slice(0, 200)}`);
    }

    const geminiResult = await response.json();
    const raw = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) throw new Error("Empty Gemini response");

    const analysis = JSON.parse(raw);

    return NextResponse.json({
      success: true,
      ticker,
      analysis,
    });
  } catch (err) {
    console.error("Value play AI analysis error:", err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
