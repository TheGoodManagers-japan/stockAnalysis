import { query } from "../../../../lib/db";
import { NextResponse } from "next/server";
import { analyzeSpaceFundSignals } from "../../../../lib/spaceFundSignals.js";

export const dynamic = "force-dynamic";

// GET /api/space-fund/signals — fetch latest signals
export async function GET() {
  try {
    const result = await query(
      `SELECT s.*, m.short_name, m.category, m.target_weight, m.currency, m.exchange
       FROM space_fund_signals s
       JOIN space_fund_members m ON m.ticker_code = s.ticker_code
       WHERE s.signal_date = (
         SELECT MAX(signal_date) FROM space_fund_signals
       )
       ORDER BY s.is_buy_now DESC, s.rr_ratio DESC NULLS LAST`
    );

    if (!result.rows.length) {
      return NextResponse.json({
        success: true,
        signalDate: null,
        signals: [],
        summary: { buyCount: 0, waitCount: 0, source: null, lastUpdated: null },
      });
    }

    const signalDate = result.rows[0].signal_date;
    const signals = result.rows.map((r) => ({
      ticker_code: r.ticker_code,
      short_name: r.short_name,
      category: r.category,
      target_weight: Number(r.target_weight),
      currency: r.currency,
      current_price: Number(r.current_price),
      is_buy_now: r.is_buy_now,
      trigger_type: r.trigger_type,
      buy_now_reason: r.buy_now_reason,
      stop_loss: r.stop_loss ? Number(r.stop_loss) : null,
      price_target: r.price_target ? Number(r.price_target) : null,
      rr_ratio: r.rr_ratio ? Number(r.rr_ratio) : null,
      rsi_14: r.rsi_14 ? Number(r.rsi_14) : null,
      market_regime: r.market_regime,
      technical_score: r.technical_score ? Number(r.technical_score) : null,
      details_json: r.details_json,
      source: r.source,
      created_at: r.created_at,
    }));

    const buyCount = signals.filter((s) => s.is_buy_now).length;
    return NextResponse.json({
      success: true,
      signalDate,
      signals,
      summary: {
        buyCount,
        waitCount: signals.length - buyCount,
        source: signals[0]?.source,
        lastUpdated: signals[0]?.created_at,
      },
    });
  } catch (err) {
    console.error("[SF Signals GET]", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// POST /api/space-fund/signals — run analysis (manual trigger)
export async function POST() {
  try {
    const result = await analyzeSpaceFundSignals({ source: "manual" });

    return NextResponse.json({
      success: true,
      count: result.count,
      buyCount: result.buyCount,
      errors: result.errors,
    });
  } catch (err) {
    console.error("[SF Signals POST]", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
