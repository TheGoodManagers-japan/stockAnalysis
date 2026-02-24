import { query } from "../../../../lib/db.js";
import { NextResponse } from "next/server";
import { fetchForexRate } from "../../../../lib/yahoo.js";
import YahooFinanceModule from "yahoo-finance2";

const YahooFinance =
  YahooFinanceModule?.default || YahooFinanceModule?.YahooFinance || YahooFinanceModule;
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Spike detection thresholds
const SPIKE_SMA_THRESHOLD = 15; // % above 20-day SMA
const SPIKE_RSI_THRESHOLD = 70;
const SPIKE_52WK_THRESHOLD = 5; // % within 52-week high

function detectSpike(currentPrice, fiftyDayAvg, rsi, fiftyTwoWeekHigh) {
  const warnings = [];

  // Check 1: Price vs moving average (use 50-day as proxy since quote gives fiftyDayAverage)
  if (fiftyDayAvg > 0) {
    const deviation = ((currentPrice - fiftyDayAvg) / fiftyDayAvg) * 100;
    if (deviation > SPIKE_SMA_THRESHOLD) {
      warnings.push({
        type: "SPIKE_SMA",
        severity: deviation > 25 ? "danger" : "warning",
        message: `${deviation.toFixed(1)}% above 50-day avg`,
        value: deviation,
      });
    }
  }

  // Check 2: RSI overbought
  if (rsi > SPIKE_RSI_THRESHOLD) {
    warnings.push({
      type: "SPIKE_RSI",
      severity: rsi > 80 ? "danger" : "warning",
      message: `RSI ${rsi.toFixed(0)} (overbought)`,
      value: rsi,
    });
  }

  // Check 3: Near 52-week high
  if (fiftyTwoWeekHigh > 0) {
    const distFromHigh = ((fiftyTwoWeekHigh - currentPrice) / fiftyTwoWeekHigh) * 100;
    if (distFromHigh < SPIKE_52WK_THRESHOLD) {
      warnings.push({
        type: "SPIKE_52WK",
        severity: distFromHigh < 2 ? "danger" : "warning",
        message: `Within ${distFromHigh.toFixed(1)}% of 52-week high`,
        value: distFromHigh,
      });
    }
  }

  return {
    isSpiked: warnings.length > 0,
    warnings,
    overallSeverity: warnings.some((w) => w.severity === "danger")
      ? "danger"
      : warnings.length > 0
        ? "warning"
        : "ok",
  };
}

// GET /api/space-fund/dca-plan?budget=100000
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const budget = Number(searchParams.get("budget")) || 100000;

    // 1. Fetch active members
    const membersRes = await query(
      `SELECT * FROM space_fund_members WHERE is_active = TRUE ORDER BY target_weight DESC`
    );
    const members = membersRes.rows;

    if (members.length === 0) {
      return NextResponse.json({
        success: true,
        plan: [],
        budget,
        totalAllocated: 0,
        residual: budget,
      });
    }

    // 2. Fetch forex rate
    const usdJpy = await fetchForexRate();

    // 3. Fetch quotes for each member
    const plan = [];
    let totalAllocatedJPY = 0;

    for (const m of members) {
      let quote;
      try {
        quote = await yahooFinance.quote(m.ticker_code);
      } catch {
        quote = null;
      }
      await sleep(100 + Math.random() * 150);

      const currentPrice = quote?.regularMarketPrice || 0;
      if (!currentPrice) {
        plan.push({
          ticker: m.ticker_code,
          shortName: m.short_name,
          currency: m.currency,
          exchange: m.exchange,
          category: m.category,
          targetWeight: Number(m.target_weight),
          rawAllocationJPY: budget * Number(m.target_weight),
          currentPrice: 0,
          shares: 0,
          actualAmountLocal: 0,
          actualAmountJPY: 0,
          spike: { isSpiked: false, warnings: [], overallSeverity: "ok" },
          error: "Could not fetch price",
        });
        continue;
      }

      const spike = detectSpike(
        currentPrice,
        quote?.fiftyDayAverage || 0,
        quote?.fiftyDayAverageChangePercent != null
          ? 50 // no RSI from quote, will be computed below
          : 50,
        quote?.fiftyTwoWeekHigh || 0
      );

      // Try to get RSI from historical data for more accurate spike detection
      // For now use a simplified heuristic from 50-day change
      const fiftyDayChange = quote?.fiftyDayAverageChangePercent || 0;
      const estimatedRSI = Math.min(100, Math.max(0, 50 + fiftyDayChange * 100));
      if (estimatedRSI > SPIKE_RSI_THRESHOLD && !spike.warnings.some((w) => w.type === "SPIKE_RSI")) {
        spike.warnings.push({
          type: "SPIKE_RSI",
          severity: estimatedRSI > 80 ? "danger" : "warning",
          message: `Est. RSI ~${estimatedRSI.toFixed(0)} (overbought)`,
          value: estimatedRSI,
        });
        spike.isSpiked = true;
        if (estimatedRSI > 80) spike.overallSeverity = "danger";
        else if (spike.overallSeverity !== "danger") spike.overallSeverity = "warning";
      }

      const targetWeight = Number(m.target_weight);
      const rawAllocationJPY = budget * targetWeight;

      let priceInJPY;
      if (m.currency === "JPY") {
        priceInJPY = currentPrice;
      } else {
        priceInJPY = currentPrice * usdJpy;
      }

      let shares, actualAmountLocal;
      if (m.exchange === "JPX") {
        // JP stocks: round down to nearest 100-share lot
        const rawShares = rawAllocationJPY / priceInJPY;
        shares = Math.floor(rawShares / 100) * 100;
        actualAmountLocal = shares * currentPrice; // JPY
      } else {
        // US stocks: fractional shares
        const rawShares = rawAllocationJPY / priceInJPY;
        shares = Math.round(rawShares * 10000) / 10000;
        actualAmountLocal = shares * currentPrice; // USD
      }

      const actualAmountJPY = m.currency === "JPY"
        ? actualAmountLocal
        : actualAmountLocal * usdJpy;

      totalAllocatedJPY += actualAmountJPY;

      plan.push({
        ticker: m.ticker_code,
        shortName: m.short_name,
        currency: m.currency,
        exchange: m.exchange,
        category: m.category,
        targetWeight,
        rawAllocationJPY,
        currentPrice,
        shares,
        actualAmountLocal,
        actualAmountJPY,
        spike,
      });
    }

    return NextResponse.json({
      success: true,
      budget,
      usdJpyRate: usdJpy,
      totalAllocated: Math.round(totalAllocatedJPY),
      residual: Math.round(budget - totalAllocatedJPY),
      plan,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
