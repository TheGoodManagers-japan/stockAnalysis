// Global regime scan — computes regime + momentum for index ETFs and macro instruments.
// Runs independently of the JPX scan. ~13 Yahoo calls per run (~6 seconds).

import { query } from "../../lib/db.js";
import { getCachedHistory } from "../../lib/cache.js";
import { ensureGlobalTickers } from "../../lib/ensureGlobalTickers.js";
import { computeRegimeLabels } from "../regime/regimeLabels.js";
import { calculateRSI } from "../indicators.js";
import { smaArr } from "../indicators.js";
import { GLOBAL_INDEX_ETFS, MACRO_TICKERS } from "../../data/globalTickers.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Compute n-day return from close array.
 * @param {number[]} closes
 * @param {number} n
 * @returns {number|null} percentage return
 */
function computeReturn(closes, n) {
  if (closes.length < n + 1) return null;
  const current = closes[closes.length - 1];
  const prev = closes[closes.length - 1 - n];
  if (!prev || prev === 0) return null;
  return +((current / prev - 1) * 100).toFixed(4);
}

/**
 * Compute a composite momentum score (0-100) from returns + RSI + MA structure.
 */
function computeMomentumScore({ ret5, ret10, ret20, rsi, aboveMA20, aboveMA50, aboveMA200 }) {
  let score = 50; // neutral baseline

  // Returns contribution (clamped to +-15 each)
  if (ret5 != null) score += Math.max(-15, Math.min(15, ret5 * 3));
  if (ret10 != null) score += Math.max(-10, Math.min(10, ret10 * 1.5));
  if (ret20 != null) score += Math.max(-5, Math.min(5, ret20 * 0.5));

  // RSI contribution
  if (rsi != null) {
    if (rsi > 70) score += 5;
    else if (rsi > 55) score += 3;
    else if (rsi < 30) score -= 5;
    else if (rsi < 45) score -= 3;
  }

  // MA structure contribution
  if (aboveMA20) score += 3;
  else score -= 3;
  if (aboveMA50) score += 2;
  else score -= 2;
  if (aboveMA200) score += 2;
  else score -= 2;

  return Math.max(0, Math.min(100, +score.toFixed(2)));
}

/**
 * Run the global regime scan for index ETFs + macro instruments.
 * Fetches OHLCV, computes regime, momentum, and stores snapshots.
 *
 * @param {object} [opts]
 * @param {Function} [opts.onProgress] - (ticker, index, total) callback
 * @returns {Promise<{ count: number, results: Array, errors: Array }>}
 */
export async function runGlobalRegimeScan({ onProgress } = {}) {
  const allTickers = [
    ...GLOBAL_INDEX_ETFS.map((t) => ({ ...t, tickerType: "index_etf" })),
    ...MACRO_TICKERS.map((t) => ({ ...t, tickerType: t.type, region: "GL" })),
  ];

  // Ensure all tickers exist in DB for FK compliance
  await ensureGlobalTickers(allTickers);

  const results = [];
  const errors = [];

  for (let i = 0; i < allTickers.length; i++) {
    const t = allTickers[i];
    if (onProgress) onProgress(t.code, i + 1, allTickers.length);

    try {
      // Fetch 3 years of history (cached)
      const history = await getCachedHistory(t.code, 3);

      if (!history || history.length < 30) {
        console.warn(`[GLOBAL] Skipping ${t.code}: insufficient history (${history?.length || 0} bars)`);
        errors.push({ ticker: t.code, error: "Insufficient history" });
        continue;
      }

      const closes = history.map((c) => Number(c.close));
      const currentPrice = closes[closes.length - 1];

      // Regime detection
      const regimeLabels = computeRegimeLabels(history);
      const regime = regimeLabels[regimeLabels.length - 1] || "RANGE";

      // Returns
      const ret5 = computeReturn(closes, 5);
      const ret10 = computeReturn(closes, 10);
      const ret20 = computeReturn(closes, 20);
      const ret60 = computeReturn(closes, 60);

      // RSI-14
      const rsi = calculateRSI(closes, 14);

      // MA structure
      const ma20arr = smaArr(closes, 20);
      const ma50arr = smaArr(closes, 50);
      const ma200arr = smaArr(closes, 200);
      const ma20 = ma20arr[ma20arr.length - 1];
      const ma50 = ma50arr[ma50arr.length - 1];
      const ma200 = ma200arr[ma200arr.length - 1];
      const aboveMA20 = Number.isFinite(ma20) && currentPrice > ma20;
      const aboveMA50 = Number.isFinite(ma50) && currentPrice > ma50;
      const aboveMA200 = Number.isFinite(ma200) && currentPrice > ma200;

      // Momentum score
      const momentumScore = computeMomentumScore({
        ret5, ret10, ret20, rsi, aboveMA20, aboveMA50, aboveMA200,
      });

      const result = {
        tickerCode: t.code,
        tickerName: t.name,
        tickerType: t.tickerType,
        region: t.region || null,
        currentPrice,
        regime,
        ret5, ret10, ret20, ret60,
        rsi: +rsi.toFixed(2),
        aboveMA20, aboveMA50, aboveMA200,
        momentumScore,
      };

      // Upsert into DB
      await query(
        `INSERT INTO global_regime_snapshots
           (scan_date, ticker_code, ticker_name, ticker_type, region,
            current_price, regime, ret_5d, ret_10d, ret_20d, ret_60d,
            rsi_14, above_ma20, above_ma50, above_ma200, momentum_score, details_json)
         VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT (scan_date, ticker_code) DO UPDATE SET
           ticker_name = EXCLUDED.ticker_name,
           ticker_type = EXCLUDED.ticker_type,
           region = EXCLUDED.region,
           current_price = EXCLUDED.current_price,
           regime = EXCLUDED.regime,
           ret_5d = EXCLUDED.ret_5d,
           ret_10d = EXCLUDED.ret_10d,
           ret_20d = EXCLUDED.ret_20d,
           ret_60d = EXCLUDED.ret_60d,
           rsi_14 = EXCLUDED.rsi_14,
           above_ma20 = EXCLUDED.above_ma20,
           above_ma50 = EXCLUDED.above_ma50,
           above_ma200 = EXCLUDED.above_ma200,
           momentum_score = EXCLUDED.momentum_score,
           details_json = EXCLUDED.details_json,
           created_at = NOW()`,
        [
          t.code, t.name, t.tickerType, t.region || null,
          currentPrice, regime, ret5, ret10, ret20, ret60,
          +rsi.toFixed(2), aboveMA20, aboveMA50, aboveMA200,
          momentumScore,
          JSON.stringify({ ma20, ma50, ma200 }),
        ]
      );

      results.push(result);
    } catch (err) {
      console.error(`[GLOBAL] Error processing ${t.code}:`, err.message);
      errors.push({ ticker: t.code, error: err.message });
    }

    // Throttle between tickers
    if (i < allTickers.length - 1) {
      await sleep(300 + Math.random() * 200);
    }
  }

  console.log(`[GLOBAL] Regime scan complete: ${results.length} processed, ${errors.length} errors`);
  return { count: results.length, results, errors };
}
