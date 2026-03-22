// dashboard/lib/spaceFundSignals.js
// Analysis pipeline for Space Fund entry timing signals.
// Reuses getStockWithIndicators() + analyzeDipEntry() from the JPX scanner.

import { query } from "./db.js";
import { getStockWithIndicators } from "./stockData.js";
import { analyzeDipEntry } from "../engine/analysis/entry/index.js";
import { computeRegimeLabels } from "../engine/regime/regimeLabels.js";

/**
 * Ensure Space Fund US tickers exist in the `tickers` table
 * so getCachedHistory() can upsert into price_history without FK violations.
 */
async function ensureSpaceFundTickers(members) {
  for (const m of members) {
    await query(
      `INSERT INTO tickers (code, sector, short_name, currency, exchange)
       VALUES ($1, $2, $3, 'USD', 'US')
       ON CONFLICT (code) DO NOTHING`,
      [m.ticker_code, m.category || "Space", m.short_name || m.ticker_code]
    );
  }
}

/**
 * Sleep for ms milliseconds.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run entry timing analysis for all active space fund members.
 *
 * @param {object} opts
 * @param {string} [opts.source='cron'] - 'cron' | 'manual'
 * @param {Function} [opts.onProgress] - (ticker, index, total) callback
 * @returns {Promise<{ count: number, buyCount: number, errors: Array, results: Array }>}
 */
export async function analyzeSpaceFundSignals({ source = "cron", onProgress } = {}) {
  // 1. Fetch active members
  const membersResult = await query(
    `SELECT ticker_code, short_name, category, target_weight
     FROM space_fund_members WHERE is_active = TRUE
     ORDER BY target_weight DESC`
  );
  const members = membersResult.rows;
  if (!members.length) return { count: 0, buyCount: 0, errors: [], results: [] };

  // 2. Ensure tickers exist for FK
  await ensureSpaceFundTickers(members);

  const results = [];
  const errors = [];
  let buyCount = 0;

  // 3. Analyze each member
  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    const ticker = member.ticker_code;

    if (onProgress) onProgress(ticker, i + 1, members.length);

    try {
      // Fetch data + enrich with indicators (3yr history is enough for swing analysis)
      const { stock, dataForLevels, dataForGates } = await getStockWithIndicators(
        ticker,
        member.category || "Space",
        { historyYears: 3 }
      );

      // Compute regime from historical data
      const regimeLabels = computeRegimeLabels(stock.historicalData);
      const currentRegime = regimeLabels.length ? regimeLabels[regimeLabels.length - 1] : "RANGE";

      // Run entry analysis (no market context for US stocks)
      const entry = analyzeDipEntry(stock, dataForLevels, {
        dataForGates,
        sentiment: null,
        market: null,
      });

      // Compute R:R ratio
      let rrRatio = null;
      if (entry.stopLoss && entry.priceTarget && stock.currentPrice) {
        const risk = stock.currentPrice - entry.stopLoss;
        const reward = entry.priceTarget - stock.currentPrice;
        if (risk > 0) rrRatio = +(reward / risk).toFixed(2);
      }

      // Build details JSON for expandable UI
      const details = {
        shortName: stock.shortName,
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
        obv: stock.obv,
        obvMA20: stock.obvMA20,
        fiftyTwoWeekHigh: stock.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: stock.fiftyTwoWeekLow,
        limitBuyOrder: entry.limitBuyOrder,
        triggerKind: entry.reason?.split(":")[0]?.trim(),
        flipBarsAgo: entry.flipBarsAgo,
        goldenCrossBarsAgo: entry.goldenCrossBarsAgo,
        telemetrySummary: entry.telemetry
          ? {
              gates: entry.telemetry.gates,
              blocks: entry.telemetry.blocks,
            }
          : null,
      };

      // Upsert into DB
      await query(
        `INSERT INTO space_fund_signals
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
          null, // technical_score — could add later
          JSON.stringify(details),
          source,
        ]
      );

      const result = {
        ticker,
        isBuyNow: !!entry.buyNow,
        trigger: entry.buyNow ? entry.reason?.split(":")[0]?.trim() : null,
        currentPrice: stock.currentPrice,
        stopLoss: entry.stopLoss,
        priceTarget: entry.priceTarget,
        rrRatio,
      };

      if (entry.buyNow) buyCount++;
      results.push(result);
    } catch (err) {
      console.error(`[SF] Error analyzing ${ticker}:`, err.message);
      errors.push({ ticker, error: err.message });
    }

    // Throttle between tickers to avoid Yahoo rate limits
    if (i < members.length - 1) {
      await sleep(300 + Math.random() * 200);
    }
  }

  return { count: results.length, buyCount, errors, results };
}
