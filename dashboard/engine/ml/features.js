// dashboard/engine/ml/features.js
// Shared feature extraction for ML models.
// Extracts normalized feature vectors from scan_results rows.

import { oneHot, safeNum, clamp, minMax } from "./normalization.js";
import { RETROACTIVE_FEATURE_DIM } from "./retroactiveFeatures.js";

// Canonical category lists for one-hot encoding
const TRIGGER_TYPES = ["DIP", "BREAKOUT", "RETEST", "RECLAIM", "INSIDE"];
const MARKET_REGIMES = ["STRONG_UP", "UP", "RANGE", "DOWN"];
const TIERS = [1, 2, 3];

// Feature dimension sizes
export const SIGNAL_QUALITY_FEATURES = 34;
export const RANKING_FEATURES = 48;

// Re-export for convenience
export { RETROACTIVE_FEATURE_DIM };

/**
 * Extract feature vector for signal quality model (Phase 1).
 * Input: a scan_results row (from DB query with other_data_json parsed).
 * Returns: Float64Array of length SIGNAL_QUALITY_FEATURES, or null if data insufficient.
 */
export function extractSignalQualityFeatures(row) {
  const od = row.other_data_json || {};
  const price = safeNum(row.current_price);
  if (!price) return null;

  const features = [];

  // 1. Scores (0-10 range, normalized to 0-1)
  features.push(safeNum(row.fundamental_score) / 10);     // [0]
  features.push(safeNum(row.valuation_score) / 10);        // [1]
  features.push(safeNum(row.technical_score) / 10);        // [2]

  // 2. Tier (one-hot 3)
  const tier = safeNum(row.tier, 2);
  features.push(...oneHot(tier, TIERS));                   // [3-5]

  // 3. Sentiment scores (1-7, normalize to 0-1)
  features.push(safeNum(row.short_term_score, 4) / 7);    // [6]
  features.push(safeNum(row.long_term_score, 4) / 7);     // [7]

  // 4. Sentiment confidence (already 0-1 ish)
  features.push(clamp(safeNum(row.short_term_conf, 0.5), 0, 1)); // [8]
  features.push(clamp(safeNum(row.long_term_conf, 0.5), 0, 1));  // [9]

  // 5. Trigger type (one-hot 5)
  features.push(...oneHot(row.trigger_type, TRIGGER_TYPES)); // [10-14]

  // 6. Market regime (one-hot 4)
  features.push(...oneHot(row.market_regime, MARKET_REGIMES)); // [15-18]

  // 7. Liquidity
  features.push(row.liq_pass ? 1 : 0);                    // [19]
  const adv = safeNum(row.liq_adv);
  features.push(adv > 0 ? clamp(Math.log10(adv) / 10, 0, 1) : 0); // [20]

  // 8. Value play score (0-100 → 0-1)
  features.push(safeNum(row.value_play_score) / 100);     // [21]

  // 9. Risk/reward ratio
  const stopLoss = safeNum(row.stop_loss);
  const priceTarget = safeNum(row.price_target);
  let rrRatio = 0;
  if (stopLoss && priceTarget && price > stopLoss) {
    rrRatio = (priceTarget - price) / (price - stopLoss);
  }
  features.push(clamp(rrRatio, 0, 10) / 10);              // [22]

  // 10. Timing features
  features.push(clamp(Math.log1p(safeNum(row.flip_bars_ago)) / 6, 0, 1));          // [23]
  features.push(clamp(Math.log1p(safeNum(row.golden_cross_bars_ago)) / 6, 0, 1));  // [24]

  // 11. Technical indicators from other_data_json
  features.push(safeNum(od.rsi14, 50) / 100);             // [25]
  const atrPct = safeNum(od.atr14) / (price || 1) * 100;
  features.push(clamp(atrPct, 0, 15) / 15);               // [26]

  // 12. MACD histogram (normalized relative to price)
  const macdHist = safeNum(od.macd) - safeNum(od.macdSignal || od.macd);
  features.push(clamp(macdHist / (price * 0.01 || 1), -5, 5) / 10 + 0.5); // [27]

  // 13. P/E z-score proxy (clip to reasonable range)
  features.push(clamp(safeNum(od.peRatio, 15), 0, 100) / 100); // [28]

  // 14. P/B z-score proxy
  features.push(clamp(safeNum(od.pbRatio, 1), 0, 10) / 10); // [29]

  // 15. Dividend yield
  features.push(clamp(safeNum(od.dividendYield, 0), 0, 10) / 10); // [30]

  // 16. Price position within 52-week range
  const hi52 = safeNum(od.fiftyTwoWeekHigh, price);
  const lo52 = safeNum(od.fiftyTwoWeekLow, price);
  features.push(minMax(price, lo52, hi52));                // [31]

  // 17. EV/EBITDA (value metric)
  features.push(clamp(safeNum(od.evToEbitda, 10), 0, 50) / 50); // [32]

  // 18. FCF yield
  features.push(clamp(safeNum(od.fcfYieldPct, 0), -20, 30) / 50 + 0.4); // [33]

  if (features.length !== SIGNAL_QUALITY_FEATURES) {
    console.warn(`[ML] Feature count mismatch: got ${features.length}, expected ${SIGNAL_QUALITY_FEATURES}`);
    return null;
  }

  return new Float64Array(features);
}

/**
 * Extract feature vector for stock ranking model (Phase 2).
 * Superset of signal quality features + additional context.
 */
export function extractRankingFeatures(row) {
  const base = extractSignalQualityFeatures(row);
  if (!base) return null;

  const od = row.other_data_json || {};
  const analytics = row.analytics_json || {};
  const extra = [];

  // 34. Is buy now
  extra.push(row.is_buy_now ? 1 : 0);                     // [34]

  // 35-37. Sector rotation (if available, else neutral)
  extra.push(clamp(safeNum(row._sector_composite, 0), -2, 2) / 4 + 0.5); // [35]
  extra.push(clamp(safeNum(row._sector_breadth_5, 50), 0, 100) / 100);   // [36]
  // Sector recommendation one-hot (OVERWEIGHT/NEUTRAL/UNDERWEIGHT)
  const sectorRec = row._sector_recommendation || "NEUTRAL";
  extra.push(...oneHot(sectorRec, ["OVERWEIGHT", "NEUTRAL", "UNDERWEIGHT"])); // [37-39]

  // 40. Volume Z-score
  extra.push(clamp(safeNum(analytics.volZ, 0), -3, 5) / 8 + 0.375); // [40]

  // 41. Price vs MA25 %
  extra.push(clamp(safeNum(analytics.pxVsMA25Pct, 0), -30, 30) / 60 + 0.5); // [41]

  // 42. MA stack score (0-3)
  extra.push(safeNum(analytics.maStackScore, 0) / 3);     // [42]

  // 43. Gap %
  extra.push(clamp(safeNum(analytics.gapPct, 0), -10, 10) / 20 + 0.5); // [43]

  // 44. News sentiment (-1 to 1 → 0-1)
  extra.push(clamp(safeNum(row._news_sentiment, 0), -1, 1) / 2 + 0.5); // [44]

  // 45. News article count (log-scaled)
  extra.push(clamp(Math.log1p(safeNum(row._news_count, 0)) / 4, 0, 1)); // [45]

  // 46. EPS growth rate
  extra.push(clamp(safeNum(od.epsGrowthRate, 0), -50, 100) / 150 + 1 / 3); // [46]

  // 47. Shareholder yield
  extra.push(clamp(safeNum(od.shareholderYieldPct, 0), -10, 20) / 30 + 1 / 3); // [47]

  const allFeatures = new Float64Array(RANKING_FEATURES);
  allFeatures.set(base);
  allFeatures.set(new Float64Array(extra), SIGNAL_QUALITY_FEATURES);

  return allFeatures;
}

/**
 * Compute normalization stats from a batch of feature vectors.
 * Returns { means: Float64Array, stds: Float64Array } for z-score normalization.
 */
export function computeNormStats(featureVectors) {
  if (!featureVectors.length) return null;
  const dim = featureVectors[0].length;
  const n = featureVectors.length;

  const means = new Float64Array(dim);
  const stds = new Float64Array(dim);

  // Compute means
  for (const vec of featureVectors) {
    for (let i = 0; i < dim; i++) means[i] += vec[i];
  }
  for (let i = 0; i < dim; i++) means[i] /= n;

  // Compute stds
  for (const vec of featureVectors) {
    for (let i = 0; i < dim; i++) stds[i] += (vec[i] - means[i]) ** 2;
  }
  for (let i = 0; i < dim; i++) {
    stds[i] = Math.sqrt(stds[i] / n) || 1; // avoid division by zero
  }

  return {
    means: Array.from(means),
    stds: Array.from(stds),
  };
}

/**
 * Apply z-score normalization to a feature vector using pre-computed stats.
 */
export function applyNormalization(features, normStats) {
  if (!normStats) return features;
  const { means, stds } = normStats;
  const out = new Float64Array(features.length);
  for (let i = 0; i < features.length; i++) {
    out[i] = (features[i] - means[i]) / (stds[i] || 1);
  }
  return out;
}

/**
 * Extract 26-dim retroactive feature vector from a live scan result.
 * Maps scan_results fields (other_data_json, analytics_json) to the same
 * feature space used by retroactive training from price_history.
 *
 * This ensures training features match inference features exactly.
 *
 * @param {Object} row - scan_results-shaped object with other_data_json parsed
 * @returns {Float64Array|null} 26-dim feature vector, or null if data insufficient
 */
export function extractRetroactiveFeatures(row) {
  const od = row.other_data_json || {};
  const analytics = row.analytics_json || {};
  const price = safeNum(row.current_price);
  if (!price) return null;

  const features = new Float64Array(RETROACTIVE_FEATURE_DIM);

  // 0: RSI / 100
  features[0] = safeNum(od.rsi14, 50) / 100;

  // 1: MACD histogram / (price * 0.01) — clamped, same normalization as retroactive
  const macdHist = safeNum(od.macd) - safeNum(od.macdSignal || od.macd);
  features[1] = clamp(macdHist / (price * 0.01 || 1), -5, 5) / 10 + 0.5;

  // 2: ATR% (ATR / price) — clamped
  const atrPct = safeNum(od.atr14) / price;
  features[2] = clamp(atrPct, 0, 0.1) * 10;

  // 3: Bollinger bandwidth — clamped
  const bbUpper = safeNum(od.bollingerUpper, price * 1.05);
  const bbLower = safeNum(od.bollingerLower, price * 0.95);
  const bbMid = safeNum(od.bollingerMid, price);
  const bbWidth = bbMid > 0 ? (bbUpper - bbLower) / bbMid : 0;
  features[3] = clamp(bbWidth, 0, 0.3) / 0.3;

  // 4: Stochastic %K / 100
  features[4] = safeNum(od.stochasticK, 50) / 100;

  // 5: Stochastic %D / 100
  features[5] = safeNum(od.stochasticD, 50) / 100;

  // 6: Volume Z-score (clamped)
  features[6] = clamp(safeNum(analytics.volZ, 0), -3, 5) / 8 + 0.375;

  // 7: Price vs MA25 %
  const ma25 = safeNum(od.movingAverage25d, 0);
  const pvsMA25 = ma25 > 0 ? (price - ma25) / ma25 * 100 : safeNum(analytics.pxVsMA25Pct, 0);
  features[7] = clamp(pvsMA25, -30, 30) / 60 + 0.5;

  // 8: Price vs MA50 %
  const ma50 = safeNum(od.movingAverage50d, 0);
  const pvsMA50 = ma50 > 0 ? (price - ma50) / ma50 * 100 : 0;
  features[8] = clamp(pvsMA50, -30, 30) / 60 + 0.5;

  // 9: Price vs MA200 %
  const ma200 = safeNum(od.movingAverage200d, 0);
  const pvsMA200 = ma200 > 0 ? (price - ma200) / ma200 * 100 : 0;
  features[9] = clamp(pvsMA200, -50, 50) / 100 + 0.5;

  // 10: MA25 slope (5-day) — use analytics if available, else approximate from regime
  features[10] = clamp(safeNum(analytics.ma25Slope, 0), -10, 10) / 20 + 0.5;

  // 11: MA stack score (0-3)
  let maStack = safeNum(analytics.maStackScore, -1);
  if (maStack < 0) {
    // Compute from available MAs
    const ma5 = safeNum(od.movingAverage5d, 0);
    maStack = 0;
    if (ma5 > 0 && ma25 > 0 && ma5 > ma25) maStack++;
    if (ma25 > 0 && ma50 > 0 && ma25 > ma50) maStack++;
    if (ma50 > 0 && ma200 > 0 && ma50 > ma200) maStack++;
  }
  features[11] = maStack / 3;

  // 12: Price in 52-week range
  const hi52 = safeNum(od.fiftyTwoWeekHigh, price);
  const lo52 = safeNum(od.fiftyTwoWeekLow, price);
  features[12] = minMax(price, lo52, hi52);

  // 13-15: Returns (5d, 20d, 60d)
  features[13] = clamp(safeNum(analytics.ret5d || od.return5d, 0), -20, 20) / 40 + 0.5;
  features[14] = clamp(safeNum(analytics.ret20d || od.return20d, 0), -30, 30) / 60 + 0.5;
  features[15] = clamp(safeNum(analytics.ret60d || od.return60d, 0), -50, 50) / 100 + 0.5;

  // 16: Volatility (20d)
  features[16] = clamp(safeNum(analytics.vol20d || od.volatility20d, 0), 0, 0.05) / 0.05;

  // 17: Volume ratio
  features[17] = clamp(safeNum(analytics.volRatio || od.volumeRatio, 1), 0, 5) / 5;

  // 18: Gap %
  features[18] = clamp(safeNum(analytics.gapPct || od.gapPct, 0), -5, 5) / 10 + 0.5;

  // 19-21: Market regime one-hot from MA stack
  features[19] = maStack === 0 ? 1 : 0; // DOWN
  features[20] = maStack === 1 || maStack === 2 ? 1 : 0; // RANGE/UP
  features[21] = maStack === 3 ? 1 : 0; // STRONG_UP

  // 22-24: Fundamental features
  features[22] = clamp(safeNum(od.peRatio, 0), 0, 100) / 100;
  features[23] = clamp(safeNum(od.pbRatio, 0), 0, 10) / 10;
  features[24] = clamp(safeNum(od.dividendYield, 0), 0, 0.1) / 0.1;

  // 25: Reserved
  features[25] = 0;

  // ─── New features (26-39) — inference parity with retroactive training ───

  // Deep analysis data (if available from scan)
  const deep = od.deepAnalysis || analytics.deep || {};

  // 26: ADX (trend strength) / 50
  features[26] = clamp(safeNum(od.adx || deep.trendStrength, 20), 0, 50) / 50;

  // 27: Hidden bullish divergence (0/1)
  features[27] = deep.bullishHidden || od.hiddenBullDiv ? 1 : 0;

  // 28: Hidden bearish divergence (0/1)
  features[28] = deep.bearishHidden || od.hiddenBearDiv ? 1 : 0;

  // 29: Bollinger squeeze (0/1)
  features[29] = bbWidth < 0.05 ? 1 : 0;

  // 30: Volatility compression (0/1)
  features[30] = deep.compression || od.volCompression ? 1 : 0;

  // 31: Order flow imbalance (-1 to 1) → (0 to 1)
  features[31] = clamp(safeNum(deep.imbalance || od.orderFlowImbalance, 0), -1, 1) / 2 + 0.5;

  // 32: Momentum persistence (0-1)
  features[32] = clamp(safeNum(deep.persistentStrength || od.momPersistence, 0.5), 0, 1);

  // 33: Trend efficiency (0-1)
  features[33] = clamp(safeNum(deep.trendEfficiency || od.trendEfficiency, 0.5), 0, 1);

  // 34: Price position in 20d range (0-1)
  features[34] = clamp(safeNum(analytics.range20dPos || od.range20dPos, 0.5), 0, 1);

  // 35: Volume trend (0/1) — 5d vol avg > 20d vol avg
  const volRatio = safeNum(analytics.volRatio || od.volumeRatio, 1);
  features[35] = volRatio > 1.0 ? 1 : 0;

  // 36: Wyckoff spring (0/1)
  features[36] = deep.wyckoffSpring || od.wyckoffSpring ? 1 : 0;

  // 37: Extension from MA20 — clipped ±15%
  const ma20 = safeNum(od.movingAverage20d || od.movingAverage25d, 0);
  const extMA20 = ma20 > 0 ? (price - ma20) / ma20 * 100 : 0;
  features[37] = clamp(extMA20, -15, 15) / 30 + 0.5;

  // 38: Gap fill ratio (0-1)
  features[38] = clamp(safeNum(analytics.gapFillRatio || od.gapFillRatio, 0.5), 0, 1);

  // 39: Reserved
  features[39] = 0;

  return features;
}
