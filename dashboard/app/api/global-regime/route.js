import { NextResponse } from "next/server";
import { query } from "../../../lib/db.js";
import { computeMacroConfidenceModifier } from "../../../engine/global/macroConfidence.js";
import { MACRO_TICKERS } from "../../../data/globalTickers.js";

const macroCodeSet = new Set(MACRO_TICKERS.map((t) => t.code));

/**
 * GET /api/global-regime
 * Returns the latest global regime snapshots + macro confidence modifier.
 * Query params:
 *   ?date=YYYY-MM-DD  (defaults to latest available)
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");

    let snapshots;
    if (date) {
      snapshots = await query(
        `SELECT * FROM global_regime_snapshots WHERE scan_date = $1 ORDER BY ticker_type, ticker_code`,
        [date]
      );
    } else {
      // Get the most recent scan date
      const latest = await query(
        `SELECT MAX(scan_date) as latest_date FROM global_regime_snapshots`
      );
      const latestDate = latest.rows[0]?.latest_date;
      if (!latestDate) {
        return NextResponse.json({ snapshots: [], macro: null, scanDate: null });
      }
      snapshots = await query(
        `SELECT * FROM global_regime_snapshots WHERE scan_date = $1 ORDER BY ticker_type, ticker_code`,
        [latestDate]
      );
    }

    const rows = snapshots.rows;

    // Compute macro confidence from macro tickers
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

    return NextResponse.json({
      snapshots: rows,
      macro,
      scanDate: rows[0]?.scan_date || null,
    });
  } catch (err) {
    console.error("[API] GET /api/global-regime error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/global-regime
 * Trigger a fresh global regime scan.
 */
export async function POST() {
  try {
    const { runGlobalRegimeScan } = await import(
      "../../../engine/global/globalRegimeScan.js"
    );
    const { count, errors } = await runGlobalRegimeScan();
    return NextResponse.json({ ok: true, count, errorCount: errors.length });
  } catch (err) {
    console.error("[API] POST /api/global-regime error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
