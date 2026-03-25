// ETF entry timing signals — analyzes ~25 global ETFs for DIP/BREAKOUT signals.
// Direct clone of spaceFundSignals.js pattern.

import { query } from "./db.js";
import { logErrorFromCatch } from "./errorLog.js";
import { getStockWithIndicators } from "./stockData.js";
import { analyzeDipEntry } from "../engine/analysis/entry/index.js";
import { computeRegimeLabels } from "../engine/regime/regimeLabels.js";
import { ensureGlobalTickers } from "./ensureGlobalTickers.js";
import { GLOBAL_SCAN_ETFS } from "../data/globalTickers.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run entry timing analysis for all global ETFs.
 *
 * @param {object} opts
 * @param {string} [opts.source='cron'] - 'cron' | 'manual'
 * @param {Function} [opts.onProgress] - (ticker, index, total) callback
 * @returns {Promise<{ count: number, buyCount: number, errors: Array, results: Array }>}
 */
export async function analyzeGlobalETFSignals({ source = "cron", onProgress } = {}) {
  // Ensure all ETF tickers exist in tickers table
  await ensureGlobalTickers(GLOBAL_SCAN_ETFS);

  const results = [];
  const errors = [];
  let buyCount = 0;

  for (let i = 0; i < GLOBAL_SCAN_ETFS.length; i++) {
    const etf = GLOBAL_SCAN_ETFS[i];
    const ticker = etf.code;

    if (onProgress) onProgress(ticker, i + 1, GLOBAL_SCAN_ETFS.length);

    try {
      const { stock, dataForLevels, dataForGates } = await getStockWithIndicators(
        ticker,
        etf.region || "Global",
        { historyYears: 3 }
      );

      // Compute regime from historical data
      const regimeLabels = computeRegimeLabels(stock.historicalData);
      const currentRegime = regimeLabels.length ? regimeLabels[regimeLabels.length - 1] : "RANGE";

      // Run entry analysis
      const entry = analyzeDipEntry(stock, dataForLevels, {
        dataForGates,
        sentiment: null,
        market: null,
      });

      // R:R ratio
      let rrRatio = null;
      if (entry.stopLoss && entry.priceTarget && stock.currentPrice) {
        const risk = stock.currentPrice - entry.stopLoss;
        const reward = entry.priceTarget - stock.currentPrice;
        if (risk > 0) rrRatio = +(reward / risk).toFixed(2);
      }

      // Build details JSON
      const details = {
        shortName: stock.shortName || etf.name,
        region: etf.region,
        ma5: stock.movingAverage5d,
        ma25: stock.movingAverage25d,
        ma50: stock.movingAverage50d,
        ma200: stock.movingAverage200d,
        macd: stock.macd,
        macdSignal: stock.macdSignal,
        bollingerUpper: stock.bollingerUpper,
        bollingerMid: stock.bollingerMid,
        bollingerLower: stock.bollingerLower,
        stochasticK: stock.stochasticK,
        stochasticD: stock.stochasticD,
        atr14: stock.atr14,
        fiftyTwoWeekHigh: stock.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: stock.fiftyTwoWeekLow,
        limitBuyOrder: entry.limitBuyOrder,
        triggerKind: entry.reason?.split(":")[0]?.trim(),
        flipBarsAgo: entry.flipBarsAgo,
      };

      // Upsert into DB
      await query(
        `INSERT INTO global_etf_signals
           (ticker_code, signal_date, current_price, is_buy_now, trigger_type,
            buy_now_reason, stop_loss, price_target, rr_ratio, rsi_14,
            market_regime, technical_score, details_json, source)
         VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (ticker_code, signal_date) DO UPDATE SET
           current_price = EXCLUDED.current_price,
           is_buy_now = EXCLUDED.is_buy_now,
           trigger_type = EXCLUDED.trigger_type,
           buy_now_reason = EXCLUDED.buy_now_reason,
           stop_loss = EXCLUDED.stop_loss,
           price_target = EXCLUDED.price_target,
           rr_ratio = EXCLUDED.rr_ratio,
           rsi_14 = EXCLUDED.rsi_14,
           market_regime = EXCLUDED.market_regime,
           technical_score = EXCLUDED.technical_score,
           details_json = EXCLUDED.details_json,
           source = EXCLUDED.source,
           created_at = NOW()`,
        [
          ticker,
          stock.currentPrice,
          !!entry.buyNow,
          entry.buyNow ? (entry.reason?.split(":")[0]?.trim() || null) : null,
          entry.reason || null,
          entry.stopLoss || null,
          entry.priceTarget || null,
          rrRatio,
          stock.rsi14 || null,
          currentRegime,
          null,
          JSON.stringify(details),
          source,
        ]
      );

      const result = {
        ticker,
        name: etf.name,
        region: etf.region,
        isBuyNow: !!entry.buyNow,
        trigger: entry.buyNow ? entry.reason?.split(":")[0]?.trim() : null,
        currentPrice: stock.currentPrice,
        stopLoss: entry.stopLoss,
        priceTarget: entry.priceTarget,
        rrRatio,
        regime: currentRegime,
      };

      if (entry.buyNow) buyCount++;
      results.push(result);
    } catch (err) {
      console.error(`[ETF] Error analyzing ${ticker}:`, err.message);
      logErrorFromCatch("lib/etfSignals", err, { ticker });
      errors.push({ ticker, error: err.message });
    }

    // Throttle
    if (i < GLOBAL_SCAN_ETFS.length - 1) {
      await sleep(300 + Math.random() * 200);
    }
  }

  console.log(`[ETF] Signal scan complete: ${results.length} processed, ${buyCount} buys, ${errors.length} errors`);
  return { count: results.length, buyCount, errors, results };
}
