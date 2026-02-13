import { query } from "../../../../lib/db";
import { NextResponse } from "next/server";

// GET /api/portfolio/snapshots — equity curve data
export async function GET() {
  try {
    const snapshots = await query(
      `SELECT snapshot_date, total_value, total_cost, unrealized_pnl,
              realized_pnl, open_positions, sector_exposure
       FROM portfolio_snapshots
       ORDER BY snapshot_date ASC`
    );

    return NextResponse.json({
      success: true,
      snapshots: snapshots.rows,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

// POST /api/portfolio/snapshots — create daily snapshot (called by cron)
export async function POST() {
  try {
    // Get all open holdings
    const open = await query(
      `SELECT ph.ticker_code, ph.entry_price, ph.shares, ph.entry_date,
              t.sector
       FROM portfolio_holdings ph
       LEFT JOIN tickers t ON t.code = ph.ticker_code
       WHERE ph.status = 'open'`
    );

    // Get latest prices for open holdings
    const holdingsWithPrices = [];
    let totalValue = 0;
    let totalCost = 0;
    const sectorExposure = {};

    for (const h of open.rows) {
      // Get latest price from snapshots or price_history
      const priceResult = await query(
        `SELECT current_price FROM stock_snapshots
         WHERE ticker_code = $1
         ORDER BY snapshot_date DESC LIMIT 1`,
        [h.ticker_code]
      );

      const currentPrice = priceResult.rows.length > 0
        ? Number(priceResult.rows[0].current_price)
        : Number(h.entry_price); // fallback to entry price

      const value = currentPrice * Number(h.shares);
      const cost = Number(h.entry_price) * Number(h.shares);
      totalValue += value;
      totalCost += cost;

      const sector = h.sector || "Unknown";
      sectorExposure[sector] = (sectorExposure[sector] || 0) + value;

      holdingsWithPrices.push({
        ticker: h.ticker_code,
        currentPrice,
        entryPrice: Number(h.entry_price),
        shares: Number(h.shares),
        value,
        pnl: value - cost,
      });
    }

    // Get realized P&L (all closed trades)
    const realizedResult = await query(
      `SELECT COALESCE(SUM(pnl_amount), 0) as total
       FROM portfolio_holdings WHERE status = 'closed'`
    );
    const realizedPnl = Number(realizedResult.rows[0].total);

    // Upsert snapshot
    await query(
      `INSERT INTO portfolio_snapshots
       (snapshot_date, total_value, total_cost, unrealized_pnl, realized_pnl,
        open_positions, sector_exposure, holdings_json)
       VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (snapshot_date) DO UPDATE SET
         total_value = EXCLUDED.total_value,
         total_cost = EXCLUDED.total_cost,
         unrealized_pnl = EXCLUDED.unrealized_pnl,
         realized_pnl = EXCLUDED.realized_pnl,
         open_positions = EXCLUDED.open_positions,
         sector_exposure = EXCLUDED.sector_exposure,
         holdings_json = EXCLUDED.holdings_json`,
      [
        totalValue,
        totalCost,
        totalValue - totalCost,
        realizedPnl,
        open.rows.length,
        JSON.stringify(sectorExposure),
        JSON.stringify(holdingsWithPrices),
      ]
    );

    return NextResponse.json({
      success: true,
      snapshot: {
        date: new Date().toISOString().split("T")[0],
        totalValue: Math.round(totalValue),
        totalCost: Math.round(totalCost),
        unrealizedPnl: Math.round(totalValue - totalCost),
        realizedPnl: Math.round(realizedPnl),
        openPositions: open.rows.length,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
