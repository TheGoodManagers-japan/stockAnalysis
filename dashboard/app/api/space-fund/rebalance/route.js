import { query } from "../../../../lib/db.js";
import { NextResponse } from "next/server";
import { fetchForexRate } from "../../../../lib/yahoo.js";
import YahooFinanceModule from "yahoo-finance2";

const YahooFinance =
  YahooFinanceModule?.default || YahooFinanceModule?.YahooFinance || YahooFinanceModule;
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DRIFT_THRESHOLD = 5.0; // percentage points

// GET /api/space-fund/rebalance — compute drift and suggest trades
export async function GET() {
  try {
    // 1. Get active members
    const membersRes = await query(
      `SELECT * FROM space_fund_members WHERE is_active = TRUE ORDER BY target_weight DESC`
    );
    const members = membersRes.rows;

    // 2. Get holdings
    const holdingsRes = await query(
      `SELECT
         ticker_code,
         SUM(CASE WHEN transaction_type IN ('BUY', 'DCA_BUY') THEN shares ELSE -shares END) as total_shares
       FROM space_fund_transactions
       GROUP BY ticker_code`
    );
    const holdingsMap = new Map();
    for (const h of holdingsRes.rows) {
      holdingsMap.set(h.ticker_code, Number(h.total_shares) || 0);
    }

    // 3. Fetch prices + forex rate
    const usdJpy = await fetchForexRate();

    let totalValueJPY = 0;
    const memberData = [];

    for (const m of members) {
      let quote;
      try {
        quote = await yahooFinance.quote(m.ticker_code);
      } catch {
        quote = null;
      }
      await sleep(100 + Math.random() * 150);

      const currentPrice = quote?.regularMarketPrice || 0;
      const shares = holdingsMap.get(m.ticker_code) || 0;
      const toJPY = m.currency === "JPY" ? 1 : usdJpy;
      const valueJPY = shares * currentPrice * toJPY;
      totalValueJPY += valueJPY;

      memberData.push({
        ticker: m.ticker_code,
        shortName: m.short_name,
        currency: m.currency,
        exchange: m.exchange,
        category: m.category,
        targetWeight: Number(m.target_weight),
        shares,
        currentPrice,
        valueJPY,
        toJPY,
      });
    }

    // 4. Compute drift and suggested trades
    const actions = memberData.map((m) => {
      const currentWeightPct = totalValueJPY > 0 ? (m.valueJPY / totalValueJPY) * 100 : 0;
      const targetWeightPct = m.targetWeight * 100;
      const drift = currentWeightPct - targetWeightPct;

      const targetValueJPY = totalValueJPY * m.targetWeight;
      const valueAdjustmentJPY = targetValueJPY - m.valueJPY;
      const valueAdjustmentLocal = valueAdjustmentJPY / m.toJPY;

      let sharesAdjustment = 0;
      if (m.currentPrice > 0) {
        if (m.exchange === "JPX") {
          sharesAdjustment = Math.round(valueAdjustmentLocal / m.currentPrice / 100) * 100;
        } else {
          sharesAdjustment = Math.round((valueAdjustmentLocal / m.currentPrice) * 10000) / 10000;
        }
      }

      return {
        ticker: m.ticker,
        shortName: m.shortName,
        currency: m.currency,
        exchange: m.exchange,
        category: m.category,
        shares: m.shares,
        currentPrice: m.currentPrice,
        valueJPY: Math.round(m.valueJPY),
        currentWeightPct: Number(currentWeightPct.toFixed(2)),
        targetWeightPct: Number(targetWeightPct.toFixed(2)),
        drift: Number(drift.toFixed(2)),
        needsRebalance: Math.abs(drift) > DRIFT_THRESHOLD,
        action: sharesAdjustment > 0 ? "BUY" : sharesAdjustment < 0 ? "SELL" : "HOLD",
        sharesAdjustment: Math.abs(sharesAdjustment),
        valueAdjustmentJPY: Math.round(Math.abs(valueAdjustmentJPY)),
      };
    });

    actions.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));

    return NextResponse.json({
      success: true,
      totalValueJPY: Math.round(totalValueJPY),
      usdJpyRate: usdJpy,
      driftThreshold: DRIFT_THRESHOLD,
      rebalanceNeeded: actions.some((a) => a.needsRebalance),
      actions,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
