import { query } from "../../../../lib/db";
import { NextResponse } from "next/server";

// GET /api/reports/insights?days=90
// Auto-generated improvement suggestions based on signal performance data
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = Math.min(parseInt(searchParams.get("days") || "90", 10), 365);

    const insights = [];

    // 1. Win rate by trigger type x regime combination
    const comboResult = await query(
      `WITH buy_signals AS (
        SELECT DISTINCT ON (sr.ticker_code, sr.scan_date::date)
          sr.ticker_code, sr.scan_date, sr.trigger_type,
          sr.current_price as signal_price,
          sr.stop_loss, sr.price_target, sr.market_regime
        FROM scan_results sr
        JOIN scan_runs s ON s.scan_id = sr.scan_id
        WHERE sr.is_buy_now = true
          AND s.status = 'completed'
          AND sr.scan_date >= NOW() - INTERVAL '1 day' * $1
        ORDER BY sr.ticker_code, sr.scan_date::date, sr.scan_date DESC
      ),
      with_outcome AS (
        SELECT bs.*,
          CASE
            WHEN (SELECT MAX(high) FROM price_history
                  WHERE ticker_code = bs.ticker_code
                    AND date > bs.scan_date::date
                    AND date <= bs.scan_date::date + INTERVAL '30 days'
                 ) >= bs.price_target THEN 'target_hit'
            WHEN (SELECT MIN(low) FROM price_history
                  WHERE ticker_code = bs.ticker_code
                    AND date > bs.scan_date::date
                    AND date <= bs.scan_date::date + INTERVAL '30 days'
                 ) <= bs.stop_loss THEN 'stop_hit'
            ELSE 'open'
          END as outcome
        FROM buy_signals bs
        WHERE bs.price_target IS NOT NULL AND bs.stop_loss IS NOT NULL
      )
      SELECT
        trigger_type, market_regime,
        COUNT(*) as total,
        SUM(CASE WHEN outcome = 'target_hit' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN outcome = 'stop_hit' THEN 1 ELSE 0 END) as losses
      FROM with_outcome
      WHERE outcome IN ('target_hit', 'stop_hit')
      GROUP BY trigger_type, market_regime
      HAVING COUNT(*) >= 3
      ORDER BY ROUND(SUM(CASE WHEN outcome = 'target_hit' THEN 1 ELSE 0 END)::numeric
                     / COUNT(*) * 100, 1) ASC`,
      [days]
    );

    for (const r of comboResult.rows) {
      const total = Number(r.total);
      const wins = Number(r.wins);
      const losses = Number(r.losses);
      const winRate = Math.round((wins / total) * 1000) / 10;
      const trigger = r.trigger_type || "UNKNOWN";
      const regime = r.market_regime || "UNKNOWN";

      if (winRate < 40 && total >= 5) {
        insights.push({
          type: "weak_combo",
          severity: "high",
          title: `Weak ${trigger} signals in ${regime} regime`,
          description: `${trigger} entries when regime is ${regime} had ${winRate}% win rate over the last ${days} days (${wins} of ${total} resolved signals hit target). Consider filtering these out or adding stricter entry criteria.`,
          data: { trigger, regime, winRate, total, wins, losses },
        });
      } else if (winRate >= 65 && total >= 5) {
        insights.push({
          type: "strong_combo",
          severity: "low",
          title: `Strong ${trigger} signals in ${regime} regime`,
          description: `${trigger} entries when regime is ${regime} had ${winRate}% win rate (${wins}/${total}). These are among your most reliable signals.`,
          data: { trigger, regime, winRate, total, wins, losses },
        });
      }
    }

    // 2. Signal stability issues
    const stabilityResult = await query(
      `WITH daily_signals AS (
        SELECT DISTINCT ON (sr.ticker_code, sr.scan_date::date)
          sr.ticker_code, sr.scan_date::date as scan_day, sr.is_buy_now
        FROM scan_results sr
        JOIN scan_runs s ON s.scan_id = sr.scan_id
        WHERE s.status = 'completed'
          AND sr.scan_date >= NOW() - INTERVAL '30 days'
        ORDER BY sr.ticker_code, sr.scan_date::date, sr.scan_date DESC
      ),
      with_prev AS (
        SELECT *,
          LAG(is_buy_now) OVER (PARTITION BY ticker_code ORDER BY scan_day) as prev_buy
        FROM daily_signals
      )
      SELECT
        COUNT(DISTINCT ticker_code) FILTER (
          WHERE prev_buy IS NOT NULL AND is_buy_now != prev_buy
        ) as flipping_tickers,
        COUNT(*) FILTER (
          WHERE prev_buy IS NOT NULL AND is_buy_now != prev_buy
        ) as total_flips
      FROM with_prev`,
      []
    );

    const flips = stabilityResult.rows[0];
    if (flips && Number(flips.total_flips) > 10) {
      insights.push({
        type: "stability",
        severity: "medium",
        title: "Signal instability detected",
        description: `${flips.flipping_tickers} tickers changed buy/no-buy status between consecutive scans (${flips.total_flips} total flips in the last 30 days). Check the Signal Stability tab for details — frequent flip-flopping suggests borderline thresholds.`,
        data: {
          flippingTickers: Number(flips.flipping_tickers),
          totalFlips: Number(flips.total_flips),
        },
      });
    }

    // 3. Near-miss opportunities — stocks that were close to triggering, then ran up
    // Uses a reference scan from ~7 days ago so prices had time to develop.
    // On the first scan (or first week), no reference scan exists → no false positives.
    const nearMissResult = await query(
      `WITH reference_scan AS (
        SELECT scan_id FROM scan_runs
        WHERE status = 'completed'
          AND started_at::date <= CURRENT_DATE - 7
        ORDER BY started_at DESC LIMIT 1
      ),
      recent_nobuy AS (
        SELECT sr.ticker_code, sr.current_price, sr.scan_date,
               sr.tier, sr.market_regime,
               sr.buy_now_reason, t.short_name, t.sector
        FROM scan_results sr
        JOIN reference_scan rs ON sr.scan_id = rs.scan_id
        JOIN tickers t ON t.code = sr.ticker_code
        WHERE sr.is_buy_now = false
          AND sr.tier <= 2
      ),
      price_moves AS (
        SELECT
          rn.*,
          (SELECT MAX(high) FROM price_history
           WHERE ticker_code = rn.ticker_code
             AND date > rn.scan_date::date) as max_price_after
        FROM recent_nobuy rn
      )
      SELECT *, ROUND((max_price_after - current_price) / NULLIF(current_price, 0) * 100, 1) as pct_move
      FROM price_moves
      WHERE max_price_after > current_price * 1.05
      ORDER BY pct_move DESC
      LIMIT 10`,
      []
    );

    const nearMisses = nearMissResult.rows.map((r) => ({
      ticker: r.ticker_code,
      name: r.short_name,
      sector: r.sector,
      priceAtScan: Number(r.current_price),
      maxPrice7d: Number(r.max_price_after),
      pctMove: Number(r.pct_move),
      tier: r.tier,
      regime: r.market_regime,
      reason: r.buy_now_reason,
    }));

    if (nearMisses.length > 0) {
      insights.push({
        type: "near_miss",
        severity: "medium",
        title: `${nearMisses.length} near-miss opportunities`,
        description: `${nearMisses.length} Tier 1-2 stocks that didn't trigger a buy signal but moved up 5%+ after the scan. These could indicate overly strict entry criteria.`,
        data: { count: nearMisses.length },
      });
    }

    // Sort: high severity first
    const severityOrder = { high: 0, medium: 1, low: 2 };
    insights.sort(
      (a, b) => (severityOrder[a.severity] ?? 1) - (severityOrder[b.severity] ?? 1)
    );

    return NextResponse.json({
      success: true,
      insights,
      nearMisses,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
