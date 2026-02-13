import { query } from "../../../../lib/db";
import { NextResponse } from "next/server";

// GET /api/reports/signal-tracking?days=90&sector=all
// Track outcomes of buy signals: did price hit target, stop, or neither?
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = Math.min(parseInt(searchParams.get("days") || "90", 10), 365);
    const sector = searchParams.get("sector") || "all";

    const sectorClause = sector !== "all" ? `AND t.sector = $2` : "";
    const params = sector !== "all" ? [days, sector] : [days];

    const result = await query(
      `WITH buy_signals AS (
        SELECT DISTINCT ON (sr.ticker_code, sr.scan_date::date)
          sr.ticker_code, sr.scan_date, sr.trigger_type,
          sr.current_price as signal_price,
          sr.stop_loss, sr.price_target, sr.tier,
          sr.market_regime, t.sector, t.short_name
        FROM scan_results sr
        JOIN scan_runs s ON s.scan_id = sr.scan_id
        JOIN tickers t ON t.code = sr.ticker_code
        WHERE sr.is_buy_now = true
          AND s.status = 'completed'
          AND sr.scan_date >= NOW() - INTERVAL '1 day' * $1
          ${sectorClause}
        ORDER BY sr.ticker_code, sr.scan_date::date, sr.scan_date DESC
      ),
      outcomes AS (
        SELECT
          bs.*,
          (SELECT MAX(high) FROM price_history
           WHERE ticker_code = bs.ticker_code
             AND date > bs.scan_date::date
             AND date <= bs.scan_date::date + INTERVAL '30 days'
          ) as max_high_30d,
          (SELECT MIN(low) FROM price_history
           WHERE ticker_code = bs.ticker_code
             AND date > bs.scan_date::date
             AND date <= bs.scan_date::date + INTERVAL '30 days'
          ) as min_low_30d,
          (SELECT close FROM price_history
           WHERE ticker_code = bs.ticker_code
             AND date > bs.scan_date::date
           ORDER BY date DESC LIMIT 1
          ) as latest_close
        FROM buy_signals bs
      )
      SELECT *,
        CASE
          WHEN max_high_30d IS NOT NULL AND price_target IS NOT NULL
               AND max_high_30d >= price_target THEN 'target_hit'
          WHEN min_low_30d IS NOT NULL AND stop_loss IS NOT NULL
               AND min_low_30d <= stop_loss THEN 'stop_hit'
          WHEN latest_close IS NOT NULL AND latest_close > signal_price THEN 'open_profit'
          WHEN latest_close IS NOT NULL AND latest_close <= signal_price THEN 'open_loss'
          ELSE 'no_data'
        END as outcome
      FROM outcomes
      ORDER BY scan_date DESC`,
      params
    );

    const signals = result.rows.map((r) => ({
      ticker: r.ticker_code,
      name: r.short_name,
      sector: r.sector,
      scanDate: r.scan_date,
      triggerType: r.trigger_type,
      signalPrice: Number(r.signal_price),
      stopLoss: r.stop_loss ? Number(r.stop_loss) : null,
      priceTarget: r.price_target ? Number(r.price_target) : null,
      tier: r.tier,
      regime: r.market_regime,
      maxHigh30d: r.max_high_30d ? Number(r.max_high_30d) : null,
      minLow30d: r.min_low_30d ? Number(r.min_low_30d) : null,
      latestClose: r.latest_close ? Number(r.latest_close) : null,
      outcome: r.outcome,
    }));

    // Compute aggregates
    const resolved = signals.filter(
      (s) => s.outcome === "target_hit" || s.outcome === "stop_hit"
    );
    const targetHit = signals.filter((s) => s.outcome === "target_hit").length;
    const stopHit = signals.filter((s) => s.outcome === "stop_hit").length;
    const openProfit = signals.filter((s) => s.outcome === "open_profit").length;
    const openLoss = signals.filter((s) => s.outcome === "open_loss").length;
    const winRate =
      resolved.length > 0
        ? Math.round((targetHit / resolved.length) * 1000) / 10
        : null;

    // Breakdown by trigger type
    const byTrigger = {};
    for (const s of signals) {
      const t = s.triggerType || "UNKNOWN";
      if (!byTrigger[t]) byTrigger[t] = { total: 0, targetHit: 0, stopHit: 0 };
      byTrigger[t].total++;
      if (s.outcome === "target_hit") byTrigger[t].targetHit++;
      if (s.outcome === "stop_hit") byTrigger[t].stopHit++;
    }
    for (const t of Object.keys(byTrigger)) {
      const b = byTrigger[t];
      const res = b.targetHit + b.stopHit;
      b.winRate = res > 0 ? Math.round((b.targetHit / res) * 1000) / 10 : null;
    }

    // Breakdown by regime
    const byRegime = {};
    for (const s of signals) {
      const r = s.regime || "UNKNOWN";
      if (!byRegime[r]) byRegime[r] = { total: 0, targetHit: 0, stopHit: 0 };
      byRegime[r].total++;
      if (s.outcome === "target_hit") byRegime[r].targetHit++;
      if (s.outcome === "stop_hit") byRegime[r].stopHit++;
    }
    for (const r of Object.keys(byRegime)) {
      const b = byRegime[r];
      const res = b.targetHit + b.stopHit;
      b.winRate = res > 0 ? Math.round((b.targetHit / res) * 1000) / 10 : null;
    }

    // Breakdown by tier
    const byTier = {};
    for (const s of signals) {
      const t = String(s.tier || "?");
      if (!byTier[t]) byTier[t] = { total: 0, targetHit: 0, stopHit: 0 };
      byTier[t].total++;
      if (s.outcome === "target_hit") byTier[t].targetHit++;
      if (s.outcome === "stop_hit") byTier[t].stopHit++;
    }
    for (const t of Object.keys(byTier)) {
      const b = byTier[t];
      const res = b.targetHit + b.stopHit;
      b.winRate = res > 0 ? Math.round((b.targetHit / res) * 1000) / 10 : null;
    }

    return NextResponse.json({
      success: true,
      signals,
      aggregates: {
        total: signals.length,
        targetHit,
        stopHit,
        openProfit,
        openLoss,
        winRate,
        byTrigger,
        byRegime,
        byTier,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
