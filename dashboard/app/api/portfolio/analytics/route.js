import { query } from "../../../../lib/db";
import { NextResponse } from "next/server";

// GET /api/portfolio/analytics — portfolio performance metrics
export async function GET() {
  try {
    // Closed trades for performance metrics
    const closed = await query(
      `SELECT id, ticker_code, entry_date, entry_price, exit_price, shares,
              initial_stop, price_target, pnl_amount, pnl_pct, closed_at,
              entry_kind, exit_reason
       FROM portfolio_holdings
       WHERE status = 'closed'
       ORDER BY closed_at ASC`
    );

    // Open holdings for current exposure
    const open = await query(
      `SELECT ph.id, ph.ticker_code, ph.entry_price, ph.shares,
              ph.initial_stop, ph.current_stop, ph.price_target,
              ph.entry_date, ph.entry_kind,
              t.sector
       FROM portfolio_holdings ph
       LEFT JOIN tickers t ON t.code = ph.ticker_code
       WHERE ph.status = 'open'`
    );

    const trades = closed.rows;
    const openHoldings = open.rows;

    // --- Performance metrics ---
    const totalTrades = trades.length;
    const wins = trades.filter((t) => Number(t.pnl_pct) > 0);
    const losses = trades.filter((t) => Number(t.pnl_pct) <= 0);
    const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;

    // Average R-multiple (P&L / risk per trade)
    const rMultiples = trades
      .map((t) => {
        const risk = Math.abs(Number(t.entry_price) - Number(t.initial_stop || t.entry_price * 0.95));
        if (risk === 0) return 0;
        return (Number(t.exit_price) - Number(t.entry_price)) / risk;
      });
    const avgRMultiple = rMultiples.length > 0
      ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length
      : 0;

    // Expectancy = (winRate * avgWin) - (lossRate * avgLoss)
    const avgWinPct = wins.length > 0
      ? wins.reduce((a, t) => a + Number(t.pnl_pct), 0) / wins.length
      : 0;
    const avgLossPct = losses.length > 0
      ? Math.abs(losses.reduce((a, t) => a + Number(t.pnl_pct), 0) / losses.length)
      : 0;
    const expectancy = (winRate / 100) * avgWinPct - ((100 - winRate) / 100) * avgLossPct;

    // Profit factor
    const grossProfit = wins.reduce((a, t) => a + Number(t.pnl_amount || 0), 0);
    const grossLoss = Math.abs(losses.reduce((a, t) => a + Number(t.pnl_amount || 0), 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // Max drawdown (from cumulative P&L)
    let peak = 0;
    let maxDrawdown = 0;
    let cumPnl = 0;
    const equityCurve = [];
    for (const t of trades) {
      cumPnl += Number(t.pnl_amount || 0);
      if (cumPnl > peak) peak = cumPnl;
      const dd = peak > 0 ? ((peak - cumPnl) / peak) * 100 : 0;
      if (dd > maxDrawdown) maxDrawdown = dd;
      equityCurve.push({
        date: t.closed_at,
        pnl: cumPnl,
        ticker: t.ticker_code,
      });
    }

    // Monthly P&L breakdown
    const monthlyPnl = {};
    for (const t of trades) {
      if (!t.closed_at) continue;
      const month = String(t.closed_at).substring(0, 7); // YYYY-MM
      if (!monthlyPnl[month]) monthlyPnl[month] = 0;
      monthlyPnl[month] += Number(t.pnl_amount || 0);
    }

    // --- Risk metrics ---
    // Sector exposure (open positions)
    const sectorExposure = {};
    let totalExposure = 0;
    for (const h of openHoldings) {
      const sector = h.sector || "Unknown";
      const exposure = Number(h.entry_price) * Number(h.shares);
      sectorExposure[sector] = (sectorExposure[sector] || 0) + exposure;
      totalExposure += exposure;
    }

    // Concentration risk
    const positionSizes = openHoldings.map((h) => ({
      ticker: h.ticker_code,
      value: Number(h.entry_price) * Number(h.shares),
    }));
    positionSizes.sort((a, b) => b.value - a.value);
    const largestPct = totalExposure > 0 && positionSizes.length > 0
      ? (positionSizes[0].value / totalExposure) * 100
      : 0;

    // Portfolio heat (total risk if all stops hit)
    let totalHeat = 0;
    for (const h of openHoldings) {
      const stop = Number(h.current_stop || h.initial_stop || h.entry_price * 0.95);
      const risk = (Number(h.entry_price) - stop) * Number(h.shares);
      totalHeat += Math.max(0, risk);
    }

    return NextResponse.json({
      success: true,
      performance: {
        totalTrades,
        winCount: wins.length,
        lossCount: losses.length,
        winRate: Math.round(winRate * 100) / 100,
        avgRMultiple: Math.round(avgRMultiple * 100) / 100,
        expectancy: Math.round(expectancy * 100) / 100,
        profitFactor: profitFactor === Infinity ? "∞" : Math.round(profitFactor * 100) / 100,
        maxDrawdownPct: Math.round(maxDrawdown * 100) / 100,
        avgWinPct: Math.round(avgWinPct * 100) / 100,
        avgLossPct: Math.round(avgLossPct * 100) / 100,
        grossProfit: Math.round(grossProfit),
        grossLoss: Math.round(grossLoss),
        netPnl: Math.round(cumPnl),
      },
      equityCurve,
      monthlyPnl: Object.entries(monthlyPnl).map(([month, pnl]) => ({
        month,
        pnl: Math.round(pnl),
      })),
      risk: {
        sectorExposure: Object.entries(sectorExposure).map(([sector, value]) => ({
          sector,
          value: Math.round(value),
          pct: totalExposure > 0 ? Math.round((value / totalExposure) * 10000) / 100 : 0,
        })),
        totalExposure: Math.round(totalExposure),
        openPositions: openHoldings.length,
        largestPositionPct: Math.round(largestPct * 100) / 100,
        top3: positionSizes.slice(0, 3).map((p) => ({
          ticker: p.ticker,
          pct: totalExposure > 0 ? Math.round((p.value / totalExposure) * 10000) / 100 : 0,
        })),
        portfolioHeat: Math.round(totalHeat),
      },
      rMultiples,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
