import { query } from "../../../../lib/db";
import { NextResponse } from "next/server";

// GET /api/reports/scan-diff?scanA=<uuid>&scanB=<uuid>
// Compare two scans side by side — what changed between them
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const scanA = searchParams.get("scanA");
    const scanB = searchParams.get("scanB");

    if (!scanA || !scanB) {
      return NextResponse.json(
        { success: false, error: "Both scanA and scanB are required" },
        { status: 400 }
      );
    }

    const result = await query(
      `SELECT
        COALESCE(a.ticker_code, b.ticker_code) as ticker_code,
        t.short_name, t.sector,
        a.is_buy_now as buy_a,       b.is_buy_now as buy_b,
        a.tier as tier_a,            b.tier as tier_b,
        a.market_regime as regime_a, b.market_regime as regime_b,
        a.trigger_type as trigger_a, b.trigger_type as trigger_b,
        a.fundamental_score as fund_a, b.fundamental_score as fund_b,
        a.valuation_score as val_a,    b.valuation_score as val_b,
        a.current_price as price_a,    b.current_price as price_b,
        a.short_term_score as st_a,    b.short_term_score as st_b,
        a.long_term_score as lt_a,     b.long_term_score as lt_b,
        a.buy_now_reason as reason_a,  b.buy_now_reason as reason_b
      FROM scan_results a
      FULL OUTER JOIN scan_results b
        ON a.ticker_code = b.ticker_code AND b.scan_id = $2
      LEFT JOIN tickers t
        ON t.code = COALESCE(a.ticker_code, b.ticker_code)
      WHERE (a.scan_id = $1 OR a.scan_id IS NULL)
        AND (b.scan_id = $2 OR b.scan_id IS NULL)`,
      [scanA, scanB]
    );

    const rows = result.rows;

    // Categorize changes
    const newBuys = [];
    const lostBuys = [];
    const tierChanges = [];
    const regimeShifts = [];
    const allChanges = [];

    for (const r of rows) {
      const changed =
        r.buy_a !== r.buy_b ||
        r.tier_a !== r.tier_b ||
        r.regime_a !== r.regime_b;

      if (!changed) continue;

      const change = {
        ticker: r.ticker_code,
        name: r.short_name,
        sector: r.sector,
        buyA: r.buy_a,
        buyB: r.buy_b,
        tierA: r.tier_a,
        tierB: r.tier_b,
        regimeA: r.regime_a,
        regimeB: r.regime_b,
        triggerA: r.trigger_a,
        triggerB: r.trigger_b,
        priceA: r.price_a ? Number(r.price_a) : null,
        priceB: r.price_b ? Number(r.price_b) : null,
        reasonB: r.reason_b,
      };

      allChanges.push(change);

      if (r.buy_b && !r.buy_a) newBuys.push(change);
      if (r.buy_a && !r.buy_b) lostBuys.push(change);
      if (r.tier_a != null && r.tier_b != null && r.tier_a !== r.tier_b)
        tierChanges.push(change);
      if (r.regime_a && r.regime_b && r.regime_a !== r.regime_b)
        regimeShifts.push(change);
    }

    return NextResponse.json({
      success: true,
      summary: {
        totalTickers: rows.length,
        totalChanges: allChanges.length,
        newBuys: newBuys.length,
        lostBuys: lostBuys.length,
        tierChanges: tierChanges.length,
        regimeShifts: regimeShifts.length,
      },
      newBuys,
      lostBuys,
      tierChanges,
      regimeShifts,
      allChanges,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
