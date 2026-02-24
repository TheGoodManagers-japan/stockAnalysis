import { query } from "../../../lib/db.js";
import { NextResponse } from "next/server";
import { fetchForexRate } from "../../../lib/yahoo.js";
import YahooFinanceModule from "yahoo-finance2";

const YahooFinance =
  YahooFinanceModule?.default || YahooFinanceModule?.YahooFinance || YahooFinanceModule;
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function safeQuote(ticker) {
  try {
    const q = await yahooFinance.quote(ticker);
    return q;
  } catch {
    return null;
  }
}

// GET /api/space-fund — fund overview with live prices
export async function GET() {
  try {
    // 1. Get all active members
    const membersRes = await query(
      `SELECT * FROM space_fund_members WHERE is_active = TRUE ORDER BY target_weight DESC`
    );
    const members = membersRes.rows;

    if (members.length === 0) {
      return NextResponse.json({
        success: true,
        fund: { totalValue: 0, totalCost: 0, unrealizedPnl: 0, unrealizedPnlPct: 0, memberCount: 0 },
        members: [],
      });
    }

    // 2. Get aggregated holdings per ticker (from transactions)
    const holdingsRes = await query(
      `SELECT
         ticker_code,
         SUM(CASE WHEN transaction_type IN ('BUY', 'DCA_BUY') THEN shares ELSE -shares END) as total_shares,
         SUM(CASE WHEN transaction_type IN ('BUY', 'DCA_BUY') THEN total_amount ELSE 0 END) as total_bought,
         SUM(CASE WHEN transaction_type = 'SELL' THEN total_amount ELSE 0 END) as total_sold,
         SUM(CASE WHEN transaction_type IN ('BUY', 'DCA_BUY') THEN shares ELSE 0 END) as shares_bought
       FROM space_fund_transactions
       GROUP BY ticker_code`
    );

    const holdingsMap = new Map();
    for (const h of holdingsRes.rows) {
      holdingsMap.set(h.ticker_code, {
        totalShares: Number(h.total_shares) || 0,
        totalBought: Number(h.total_bought) || 0,
        totalSold: Number(h.total_sold) || 0,
        sharesBought: Number(h.shares_bought) || 0,
      });
    }

    // 3. Fetch live prices + forex rate
    const usdJpy = await fetchForexRate();

    const enrichedMembers = [];
    let totalValueJPY = 0;
    let totalCostJPY = 0;

    for (const m of members) {
      const quote = await safeQuote(m.ticker_code);
      await sleep(100 + Math.random() * 150);

      const currentPrice = quote?.regularMarketPrice || 0;
      const holding = holdingsMap.get(m.ticker_code) || { totalShares: 0, totalBought: 0, totalSold: 0, sharesBought: 0 };

      const avgCost = holding.sharesBought > 0
        ? holding.totalBought / holding.sharesBought
        : 0;

      const currentValueLocal = holding.totalShares * currentPrice;
      const costBasisLocal = holding.totalShares * avgCost;
      const pnlLocal = currentValueLocal - costBasisLocal;
      const pnlPct = costBasisLocal > 0 ? (pnlLocal / costBasisLocal) * 100 : 0;

      const toJPY = m.currency === "JPY" ? 1 : usdJpy;
      const currentValueJPY = currentValueLocal * toJPY;
      const costBasisJPY = costBasisLocal * toJPY;

      totalValueJPY += currentValueJPY;
      totalCostJPY += costBasisJPY;

      enrichedMembers.push({
        ...m,
        target_weight: Number(m.target_weight),
        currentPrice,
        shares: holding.totalShares,
        avgCost,
        currentValueLocal,
        costBasisLocal,
        pnlLocal,
        pnlPct,
        currentValueJPY,
        costBasisJPY,
        fiftyTwoWeekHigh: quote?.fiftyTwoWeekHigh || 0,
        fiftyTwoWeekLow: quote?.fiftyTwoWeekLow || 0,
      });
    }

    // 4. Compute weights and drift
    for (const m of enrichedMembers) {
      m.currentWeight = totalValueJPY > 0 ? m.currentValueJPY / totalValueJPY : 0;
      m.drift = m.currentWeight - m.target_weight;
    }

    const unrealizedPnl = totalValueJPY - totalCostJPY;
    const unrealizedPnlPct = totalCostJPY > 0 ? (unrealizedPnl / totalCostJPY) * 100 : 0;

    return NextResponse.json({
      success: true,
      fund: {
        totalValue: Math.round(totalValueJPY),
        totalCost: Math.round(totalCostJPY),
        unrealizedPnl: Math.round(unrealizedPnl),
        unrealizedPnlPct: Number(unrealizedPnlPct.toFixed(2)),
        memberCount: members.length,
        usdJpyRate: usdJpy,
      },
      members: enrichedMembers,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
