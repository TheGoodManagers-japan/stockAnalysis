import { query } from "../../../lib/db";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { fetchStockAnalysis } from "../../../engine/orchestrator.js";
import { saveScanResult, cacheStockSnapshot, getCachedHistory, updatePercentiles } from "../../../lib/cache.js";
import { allTickers } from "../../../data/tickers.js";
import { analyzeSectorRotation, sectorPoolsJP } from "../../../engine/sector/sectorRotationMonitor.js";
import { validateTickerArray } from "../../../lib/validate.js";
import { SCAN_TIMEOUT_MS, STALE_SCAN_MINUTES } from "../../../lib/constants.js";
import { recordScannerSignal, recordValuePlaySignal, resolveOpenSignals } from "../../../lib/signalTracker.js";
import { logErrorFromCatch } from "../../../lib/errorLog.js";

/**
 * Ensure benchmark + sector pool tickers exist in the tickers table.
 * Without this, getCachedHistory fails on FK constraint for tickers
 * like 1306.T (TOPIX ETF) that aren't in the main scan universe.
 */
async function ensureSectorTickers() {
  const needed = new Set(["1306.T"]); // benchmark
  for (const members of Object.values(sectorPoolsJP)) {
    for (const m of members) {
      const t = m.ticker.endsWith(".T") ? m.ticker : `${m.ticker}.T`;
      needed.add(t);
    }
  }
  for (const code of needed) {
    await query(
      `INSERT INTO tickers (code, sector, short_name)
       VALUES ($1, 'benchmark', $2)
       ON CONFLICT (code) DO NOTHING`,
      [code, code]
    );
  }
}

// In-memory fast-path guard (DB is source of truth)
let activeScanId = null;


// POST /api/scan — kick off a scan in the background, return immediately
export async function POST(request) {
  try {
    // Fast-path: in-memory guard
    if (activeScanId) {
      return NextResponse.json(
        { success: false, error: "Scan already running", scanId: activeScanId },
        { status: 409 }
      );
    }

    // DB-based lock: check for any recent running scan
    const running = await query(
      `SELECT scan_id FROM scan_runs
       WHERE status = 'running'
         AND started_at > NOW() - INTERVAL '${STALE_SCAN_MINUTES} minutes'
       LIMIT 1`
    );
    if (running.rows.length > 0) {
      activeScanId = running.rows[0].scan_id;
      return NextResponse.json(
        { success: false, error: "Scan already running", scanId: running.rows[0].scan_id },
        { status: 409 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const rawTickers = body.tickers || [];

    // Validate tickers if provided
    if (rawTickers.length > 0) {
      const v = validateTickerArray(rawTickers);
      if (!v.valid) {
        return NextResponse.json(
          { success: false, error: v.error },
          { status: 400 }
        );
      }
    }
    const requestedTickers = rawTickers;

    // Fetch open portfolio holdings for trade management signals
    const portfolioResult = await query(
      `SELECT ticker_code, entry_price, initial_stop, current_stop,
              price_target, entry_date, entry_kind
       FROM portfolio_holdings
       WHERE status = 'open'`
    );
    const myPortfolio = portfolioResult.rows.map((row) => ({
      ticker: row.ticker_code,
      trade: {
        entryPrice: Number(row.entry_price),
        stopLoss: Number(row.current_stop || row.initial_stop),
        priceTarget: row.price_target ? Number(row.price_target) : undefined,
        entryDate: row.entry_date,
        initialStop: row.initial_stop ? Number(row.initial_stop) : undefined,
      },
    }));

    // Calculate total tickers for progress tracking
    const totalTickers =
      requestedTickers.length > 0 ? requestedTickers.length : allTickers.length;

    // Create scan run record with total_tickers
    const scanRun = await query(
      `INSERT INTO scan_runs (ticker_count, total_tickers, status)
       VALUES (0, $1, 'running') RETURNING scan_id`,
      [totalTickers]
    );
    const scanId = scanRun.rows[0].scan_id;
    activeScanId = scanId;

    // Fire-and-forget: start scan in background
    (async () => {
      // Timeout guard: auto-fail if scan runs too long
      const timeoutTimer = setTimeout(async () => {
        console.error(`Scan ${scanId} timed out after 30 minutes`);
        await query(
          `UPDATE scan_runs
           SET status = 'failed', finished_at = NOW(),
               errors = $2, current_ticker = NULL
           WHERE scan_id = $1 AND status = 'running'`,
          [scanId, JSON.stringify(["Scan timed out after 30 minutes"])]
        ).catch(() => {});
        activeScanId = null;
      }, SCAN_TIMEOUT_MS);

      try {
        let buyCount = 0;

        const { count, errors, summary, results: scanResults } = await fetchStockAnalysis({
          tickers: requestedTickers,
          myPortfolio,
          onProgress: async ({
            stock,
            processed,
            total,
            currentTicker,
            buyCount: runningBuyCount,
          }) => {
            // Save this result to DB immediately
            stock.triggerType = stock.trigger || null;
            await saveScanResult(scanId, stock);
            await cacheStockSnapshot(stock.ticker, stock);

            // Record paper trades for signal performance tracking
            await recordScannerSignal(scanId, stock);
            await recordValuePlaySignal(scanId, stock);

            buyCount = runningBuyCount;

            // Update scan_runs with incremental progress
            await query(
              `UPDATE scan_runs
               SET ticker_count = $2,
                   buy_count = $3,
                   current_ticker = $4,
                   total_tickers = $5
               WHERE scan_id = $1`,
              [scanId, processed, buyCount, currentTicker, total]
            );
          },
        });

        // Batch-update percentile data (computed post-loop by orchestrator)
        if (Array.isArray(scanResults) && scanResults.length > 0) {
          try {
            await updatePercentiles(scanId, scanResults);
          } catch (pctErr) {
            console.warn("Percentile update failed (non-fatal):", pctErr?.message);
            await logErrorFromCatch("api/scan", pctErr, { step: "percentileUpdate", scanId });
          }
        }

        // Final update: mark as completed
        await query(
          `UPDATE scan_runs
           SET finished_at = NOW(),
               ticker_count = $2,
               buy_count = $3,
               error_count = $4,
               errors = $5,
               status = 'completed',
               summary_json = $6,
               current_ticker = NULL
           WHERE scan_id = $1`,
          [
            scanId,
            count,
            buyCount,
            errors.length,
            JSON.stringify(errors),
            JSON.stringify(summary),
          ]
        );

        // Invalidate cached pages so they show fresh scan data
        revalidatePath("/");
        revalidatePath("/scanner");
        revalidatePath("/value-plays");
        revalidatePath("/sectors");

        // Run sector rotation analysis using cached history data
        try {
          await ensureSectorTickers();

          const sectorDbFetch = (url) => {
            const u = new URL(url, "http://localhost");
            const ticker = u.searchParams.get("ticker");
            const years = parseInt(u.searchParams.get("years") || "3", 10);
            return getCachedHistory(ticker, years).then((data) => ({
              ok: true,
              json: async () => data,
            }));
          };

          const sectorResult = await analyzeSectorRotation({
            fetchFn: sectorDbFetch,
            concurrency: 4,
          });

          for (const sector of sectorResult.ranked) {
            const recommendation =
              (sector.score ?? 0) >= 70
                ? "Overweight"
                : (sector.score ?? 0) <= 35
                ? "Avoid"
                : "Neutral";

            await query(
              `INSERT INTO sector_rotation_snapshots (
                 scan_date, sector_id, composite_score,
                 rs_5, rs_10, rs_20, rs_60,
                 accel_swing, breadth_5, breadth_10, breadth_20,
                 recommendation, details_json
               ) VALUES (
                 CURRENT_DATE, $1, $2,
                 $3, $4, $5, $6,
                 $7, $8, $9, $10,
                 $11, $12
               )
               ON CONFLICT (scan_date, sector_id) DO UPDATE SET
                 composite_score = EXCLUDED.composite_score,
                 rs_5 = EXCLUDED.rs_5,
                 rs_10 = EXCLUDED.rs_10,
                 rs_20 = EXCLUDED.rs_20,
                 rs_60 = EXCLUDED.rs_60,
                 accel_swing = EXCLUDED.accel_swing,
                 breadth_5 = EXCLUDED.breadth_5,
                 breadth_10 = EXCLUDED.breadth_10,
                 breadth_20 = EXCLUDED.breadth_20,
                 recommendation = EXCLUDED.recommendation,
                 details_json = EXCLUDED.details_json`,
              [
                sector.sector,
                sector.score ?? null,
                sector.rs5 ?? null,
                sector.rs10 ?? null,
                sector.rs20 ?? null,
                sector.rs60 ?? null,
                sector.accelSwing ?? null,
                sector.breadth20EW ?? sector.breadth20 ?? null,
                sector.breadth50EW ?? sector.breadth50 ?? null,
                sector.breadth200EW ?? sector.breadth200 ?? null,
                recommendation,
                JSON.stringify({
                  leaders: sector.leaders || [],
                  momentum:
                    (sector.accelSwing ?? 0) > 0 ? "Accelerating" : "Decelerating",
                }),
              ]
            );
          }
          console.log(`Sector rotation: ${sectorResult.ranked.length} sectors saved`);
        } catch (sectorErr) {
          console.error("Sector rotation analysis failed:", sectorErr);
          await logErrorFromCatch("api/scan", sectorErr, { step: "sectorRotation", scanId });
        }

        // Auto-trigger AI review for all buy signals
        try {
          const { performAiReview } = await import("../../../lib/ai-review.js");
          const reviewResult = await performAiReview(scanId);
          console.log(`AI review: ${reviewResult.reviews.length} reviews completed, ${reviewResult.errors.length} errors`);
        } catch (aiErr) {
          console.error("AI review auto-trigger failed:", aiErr);
          await logErrorFromCatch("api/scan", aiErr, { step: "aiReview", scanId });
        }

        // Auto-persist news watchlist snapshot (non-fatal, no new API calls)
        try {
          const base = process.env.NEXT_PUBLIC_URL || `http://localhost:${process.env.PORT || 3002}`;
          const wlRes = await fetch(`${base}/api/news/watchlist`, { method: "POST" });
          const wlData = await wlRes.json();
          console.log(`News watchlist snapshot: ${wlData.saved || 0} entries saved`);
        } catch (wlErr) {
          console.error("News watchlist auto-persist failed:", wlErr);
          await logErrorFromCatch("api/scan", wlErr, { step: "newsWatchlist", scanId });
        }

        // Resolve open signal trades using snapshot prices (has high/low)
        try {
          const latestPrices = await query(
            `SELECT ticker_code, current_price, high_price, low_price
             FROM stock_snapshots
             WHERE snapshot_date = CURRENT_DATE`
          );
          const priceMap = new Map();
          for (const row of latestPrices.rows) {
            const close = Number(row.current_price);
            priceMap.set(row.ticker_code, {
              high: Number(row.high_price) || close,
              low: Number(row.low_price) || close,
              close,
            });
          }
          const resolveResult = await resolveOpenSignals((ticker) => priceMap.get(ticker) || null);
          console.log(`Signal tracker: resolved ${resolveResult.resolved} trades, ${resolveResult.errors.length} errors`);
        } catch (sigErr) {
          console.error("Signal tracker resolve failed:", sigErr);
          await logErrorFromCatch("api/scan", sigErr, { step: "signalResolve", scanId });
        }
      } catch (err) {
        console.error("Background scan failed:", err);
        await logErrorFromCatch("api/scan", err, { step: "backgroundScan", scanId });
        await query(
          `UPDATE scan_runs
           SET status = 'failed',
               finished_at = NOW(),
               errors = $2,
               current_ticker = NULL
           WHERE scan_id = $1`,
          [scanId, JSON.stringify([err.message])]
        ).catch(() => {});
      } finally {
        clearTimeout(timeoutTimer);
        activeScanId = null;
      }
    })();

    // Return immediately
    return NextResponse.json({
      success: true,
      scanId,
      totalTickers,
      status: "running",
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

// DELETE /api/scan — force-clear stuck scans
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const scanId = searchParams.get("scanId");

    if (scanId) {
      await query(
        `UPDATE scan_runs SET status = 'failed', finished_at = NOW(),
         errors = $2, current_ticker = NULL
         WHERE scan_id = $1 AND status = 'running'`,
        [scanId, JSON.stringify(["Manually cancelled"])]
      );
    } else {
      await query(
        `UPDATE scan_runs SET status = 'failed', finished_at = NOW(),
         errors = '["Manually cancelled"]', current_ticker = NULL
         WHERE status = 'running'`
      );
    }
    activeScanId = null;
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

// GET /api/scan — get scan results (latest by default, or specific scan via ?scanId=)
export async function GET(request) {
  try {
    // Auto-cleanup stale scans that have been running > 45 minutes
    await query(
      `UPDATE scan_runs SET status = 'failed', finished_at = NOW(),
       errors = '["Stale scan auto-failed"]', current_ticker = NULL
       WHERE status = 'running'
         AND started_at < NOW() - INTERVAL '${STALE_SCAN_MINUTES} minutes'`
    ).catch(() => {});

    const { searchParams } = new URL(request.url);
    const requestedScanId = searchParams.get("scanId");
    const progressOnly = searchParams.get("progress") === "true";

    const scanRun = requestedScanId
      ? await query(`SELECT * FROM scan_runs WHERE scan_id = $1`, [requestedScanId])
      : await query(`SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 1`);
    if (scanRun.rows.length === 0) {
      return NextResponse.json({ success: true, scan: null, results: [] });
    }

    const scan = scanRun.rows[0];

    // Progress-only mode: return scan metadata + count without full results
    if (progressOnly) {
      const countResult = await query(
        `SELECT COUNT(*)::int AS result_count FROM scan_results WHERE scan_id = $1`,
        [scan.scan_id]
      );
      return NextResponse.json({
        success: true,
        scan,
        resultCount: countResult.rows[0]?.result_count || 0,
      });
    }

    const results = await query(
      `SELECT sr.ticker_code, sr.current_price, sr.fundamental_score, sr.valuation_score,
              sr.technical_score, sr.tier, sr.is_buy_now, sr.buy_now_reason, sr.trigger_type,
              sr.stop_loss, sr.price_target, sr.short_term_score, sr.long_term_score,
              sr.market_regime, sr.scan_date, sr.scan_id,
              sr.master_score,
              sr.liq_pass,
              (sr.other_data_json->>'ml_signal_confidence')::numeric AS ml_signal_confidence,
              (sr.other_data_json->>'scoring_confidence')::numeric AS scoring_confidence,
              (sr.other_data_json->>'data_freshness') AS data_freshness,
              (sr.other_data_json->>'tier_trajectory') AS tier_trajectory,
              (sr.other_data_json->>'is_conflicted')::boolean AS is_conflicted,
              (sr.other_data_json->>'score_disagreement')::numeric AS score_disagreement,
              (sr.other_data_json->>'fundPctile')::int AS fund_pctile,
              (sr.other_data_json->>'valPctile')::int AS val_pctile,
              (sr.other_data_json->>'techPctile')::int AS tech_pctile,
              t.short_name, t.sector,
              ar.verdict AS ai_verdict, ar.reason AS ai_reason,
              ar.confidence AS ai_confidence, ar.full_analysis AS ai_full_analysis
       FROM scan_results sr
       LEFT JOIN tickers t ON t.code = sr.ticker_code
       LEFT JOIN ai_reviews ar ON ar.scan_id = sr.scan_id AND ar.ticker_code = sr.ticker_code
       WHERE sr.scan_id = $1
       ORDER BY sr.master_score DESC NULLS LAST, sr.is_buy_now DESC, sr.tier ASC`,
      [scan.scan_id]
    );

    const response = NextResponse.json({
      success: true,
      scan,
      results: results.rows,
    });
    // Cache completed scan results; don't cache running scans
    if (scan.status === "completed") {
      response.headers.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    } else {
      response.headers.set("Cache-Control", "no-store");
    }
    return response;
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
