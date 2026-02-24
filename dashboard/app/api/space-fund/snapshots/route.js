import { query } from "../../../../lib/db.js";
import { NextResponse } from "next/server";
import { fetchForexRate } from "../../../../lib/yahoo.js";
import YahooFinanceModule from "yahoo-finance2";

const YahooFinance =
  YahooFinanceModule?.default || YahooFinanceModule?.YahooFinance || YahooFinanceModule;
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GET /api/space-fund/snapshots — return snapshot history
export async function GET() {
  try {
    const result = await query(
      `SELECT * FROM space_fund_snapshots ORDER BY snapshot_date ASC`
    );
    return NextResponse.json({ success: true, snapshots: result.rows });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

// POST /api/space-fund/snapshots — take a snapshot of current fund state
export async function POST() {
  try {
    // 1. Get active members
    const membersRes = await query(
      `SELECT * FROM space_fund_members WHERE is_active = TRUE`
    );
    const members = membersRes.rows;

    // 2. Get holdings
    const holdingsRes = await query(
      `SELECT
         ticker_code,
         SUM(CASE WHEN transaction_type IN ('BUY', 'DCA_BUY') THEN shares ELSE -shares END) as total_shares,
         SUM(CASE WHEN transaction_type IN ('BUY', 'DCA_BUY') THEN total_amount ELSE 0 END) as total_bought,
         SUM(CASE WHEN transaction_type IN ('BUY', 'DCA_BUY') THEN shares ELSE 0 END) as shares_bought
       FROM space_fund_transactions
       GROUP BY ticker_code`
    );
    const holdingsMap = new Map();
    for (const h of holdingsRes.rows) {
      holdingsMap.set(h.ticker_code, {
        totalShares: Number(h.total_shares) || 0,
        totalBought: Number(h.total_bought) || 0,
        sharesBought: Number(h.shares_bought) || 0,
      });
    }

    // 3. Fetch prices
    const usdJpy = await fetchForexRate();
    let totalValueJPY = 0;
    let totalCostJPY = 0;
    const holdingsJson = [];

    for (const m of members) {
      let quote;
      try {
        quote = await yahooFinance.quote(m.ticker_code);
      } catch {
        quote = null;
      }
      await sleep(100 + Math.random() * 150);

      const currentPrice = quote?.regularMarketPrice || 0;
      const holding = holdingsMap.get(m.ticker_code) || { totalShares: 0, totalBought: 0, sharesBought: 0 };
      const avgCost = holding.sharesBought > 0 ? holding.totalBought / holding.sharesBought : 0;
      const toJPY = m.currency === "JPY" ? 1 : usdJpy;

      const valueJPY = holding.totalShares * currentPrice * toJPY;
      const costJPY = holding.totalShares * avgCost * toJPY;

      totalValueJPY += valueJPY;
      totalCostJPY += costJPY;

      holdingsJson.push({
        ticker: m.ticker_code,
        shares: holding.totalShares,
        avgCost,
        currentPrice,
        valueJPY: Math.round(valueJPY),
        costJPY: Math.round(costJPY),
        targetWeight: Number(m.target_weight),
      });
    }

    // Compute weights
    for (const h of holdingsJson) {
      h.currentWeight = totalValueJPY > 0 ? h.valueJPY / totalValueJPY : 0;
      h.drift = h.currentWeight - h.targetWeight;
    }

    const unrealizedPnl = totalValueJPY - totalCostJPY;
    const unrealizedPnlPct = totalCostJPY > 0 ? (unrealizedPnl / totalCostJPY) * 100 : 0;

    // 4. Upsert snapshot
    const result = await query(
      `INSERT INTO space_fund_snapshots
       (snapshot_date, total_value, total_cost, unrealized_pnl, unrealized_pnl_pct, usd_jpy_rate, holdings_json)
       VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6)
       ON CONFLICT (snapshot_date) DO UPDATE SET
         total_value = EXCLUDED.total_value,
         total_cost = EXCLUDED.total_cost,
         unrealized_pnl = EXCLUDED.unrealized_pnl,
         unrealized_pnl_pct = EXCLUDED.unrealized_pnl_pct,
         usd_jpy_rate = EXCLUDED.usd_jpy_rate,
         holdings_json = EXCLUDED.holdings_json
       RETURNING *`,
      [
        Math.round(totalValueJPY),
        Math.round(totalCostJPY),
        Math.round(unrealizedPnl),
        Number(unrealizedPnlPct.toFixed(4)),
        usdJpy,
        JSON.stringify(holdingsJson),
      ]
    );

    return NextResponse.json({ success: true, snapshot: result.rows[0] });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
