import { NextResponse } from "next/server";
import { query } from "../../../../lib/db.js";
import { computeAllocationAlerts } from "../../../../engine/global/allocationAlerts.js";
import { computeMacroConfidenceModifier } from "../../../../engine/global/macroConfidence.js";
import { MACRO_TICKERS } from "../../../../data/globalTickers.js";

const macroCodeSet = new Set(MACRO_TICKERS.map((t) => t.code));

/**
 * GET /api/global-regime/alerts
 * Compute allocation alerts from the latest global regime snapshots.
 */
export async function GET() {
  try {
    const latest = await query(
      `SELECT MAX(scan_date) as latest_date FROM global_regime_snapshots`
    );
    const latestDate = latest.rows[0]?.latest_date;
    if (!latestDate) {
      return NextResponse.json({ alerts: [], scanDate: null });
    }

    const snapshots = await query(
      `SELECT * FROM global_regime_snapshots WHERE scan_date = $1`,
      [latestDate]
    );

    const rows = snapshots.rows;
    const macroResults = rows
      .filter((r) => macroCodeSet.has(r.ticker_code))
      .map((r) => ({
        tickerCode: r.ticker_code,
        regime: r.regime,
        ret5: Number(r.ret_5d),
        ret20: Number(r.ret_20d),
        momentumScore: Number(r.momentum_score),
      }));
    const macro = computeMacroConfidenceModifier(macroResults);
    const alerts = computeAllocationAlerts(rows, macro);

    return NextResponse.json({ alerts, scanDate: latestDate });
  } catch (err) {
    console.error("[API] GET /api/global-regime/alerts error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
