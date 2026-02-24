// dashboard/engine/ml/retroactiveFeatures.js
// Compute ML features retroactively from price_history + stock_snapshots.
// Used by Phase 1 (Signal Quality) and Phase 2 (Stock Ranker) training
// to generate training data from 3 years of historical OHLCV data.

import {
  calculateRSI,
  calculateRSISeries,
  calculateMACD,
  calculateEMA,
  calculateATR,
  calculateBollinger,
  calculateStochastic,
  calculateOBV,
  smaArr,
} from "../indicators.js";
import { clamp } from "./normalization.js";

export const RETROACTIVE_FEATURE_DIM = 40;

/**
 * Safely format a date value (Date object or string) to YYYY-MM-DD.
 */
export function toDateStr(d) {
  if (d instanceof Date) return d.toISOString().split("T")[0];
  return String(d).slice(0, 10); // handles "2023-02-13T00:00:00.000Z" and "2023-02-13"
}

// Minimum lookback days needed before we can compute features
const MIN_LOOKBACK = 200; // need MA200

/**
 * Compute full indicator series for a ticker's price history.
 * Returns arrays of indicators aligned to the price array indices.
 *
 * @param {Array<{date, open, high, low, close, volume}>} prices - sorted ASC
 * @returns {Object} indicator series (same length as prices)
 */
export function computeIndicatorSeries(prices) {
  const closes = prices.map((p) => Number(p.close));
  const highs = prices.map((p) => Number(p.high || p.close));
  const lows = prices.map((p) => Number(p.low || p.close));
  const volumes = prices.map((p) => Number(p.volume || 0));
  const opens = prices.map((p) => Number(p.open || p.close));

  // RSI series (Wilder smoothing)
  const rsiSeries = calculateRSISeries(closes, 14);

  // MACD series — compute EMA12, EMA26, signal line for each point
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  // Align: ema12 starts at index 11, ema26 at index 25
  const macdLine = [];
  const macdSignalLine = [];
  const macdHist = new Array(closes.length).fill(0);
  if (ema12.length > 0 && ema26.length > 0) {
    const offset12 = closes.length - ema12.length;
    const offset26 = closes.length - ema26.length;
    for (let i = offset26; i < closes.length; i++) {
      const e12 = ema12[i - offset12];
      const e26 = ema26[i - offset26];
      if (e12 !== undefined && e26 !== undefined) {
        macdLine.push(e12 - e26);
      }
    }
    if (macdLine.length >= 9) {
      const sig = calculateEMA(macdLine, 9);
      const sigOffset = macdLine.length - sig.length;
      for (let i = 0; i < sig.length; i++) {
        const globalIdx = offset26 + sigOffset + i;
        macdHist[globalIdx] = macdLine[sigOffset + i] - sig[i];
      }
    }
  }

  // SMA series
  const ma5 = smaArr(closes, 5);
  const ma25 = smaArr(closes, 25);
  const ma50 = smaArr(closes, 50);
  const ma75 = smaArr(closes, 75);
  const ma200 = smaArr(closes, 200);

  // ATR series (rolling)
  const atrSeries = new Array(closes.length).fill(0);
  for (let i = 14; i < closes.length; i++) {
    const slice = prices.slice(i - 14, i + 1);
    atrSeries[i] = calculateATR(slice, 14);
  }

  // Bollinger bandwidth
  const bbWidth = new Array(closes.length).fill(0);
  for (let i = 19; i < closes.length; i++) {
    const bb = calculateBollinger(closes.slice(0, i + 1), 20, 2);
    bbWidth[i] = bb.mid > 0 ? (bb.upper - bb.lower) / bb.mid : 0;
  }

  // Stochastic %K and %D
  const stochK = new Array(closes.length).fill(50);
  const stochD = new Array(closes.length).fill(50);
  for (let i = 16; i < closes.length; i++) {
    const slice = prices.slice(i - 16, i + 1);
    const { k, d } = calculateStochastic(slice, 14, 3);
    stochK[i] = k;
    stochD[i] = d;
  }

  // Volume Z-score (20-day rolling)
  const volZ = new Array(closes.length).fill(0);
  for (let i = 19; i < closes.length; i++) {
    const slice = volumes.slice(i - 19, i + 1);
    const mean = slice.reduce((s, v) => s + v, 0) / 20;
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / 20) || 1;
    volZ[i] = (volumes[i] - mean) / std;
  }

  // Volume ratio (today / 20d avg)
  const smaVol20 = smaArr(volumes, 20);
  const volRatio = volumes.map((v, i) =>
    !isNaN(smaVol20[i]) && smaVol20[i] > 0 ? v / smaVol20[i] : 1
  );

  // Returns
  const ret5 = new Array(closes.length).fill(0);
  const ret20 = new Array(closes.length).fill(0);
  const ret60 = new Array(closes.length).fill(0);
  for (let i = 5; i < closes.length; i++) {
    ret5[i] = closes[i - 5] > 0 ? (closes[i] - closes[i - 5]) / closes[i - 5] * 100 : 0;
  }
  for (let i = 20; i < closes.length; i++) {
    ret20[i] = closes[i - 20] > 0 ? (closes[i] - closes[i - 20]) / closes[i - 20] * 100 : 0;
  }
  for (let i = 60; i < closes.length; i++) {
    ret60[i] = closes[i - 60] > 0 ? (closes[i] - closes[i - 60]) / closes[i - 60] * 100 : 0;
  }

  // 20-day volatility (std of daily returns)
  const vol20 = new Array(closes.length).fill(0);
  for (let i = 20; i < closes.length; i++) {
    const rets = [];
    for (let j = i - 19; j <= i; j++) {
      rets.push(closes[j - 1] > 0 ? (closes[j] - closes[j - 1]) / closes[j - 1] : 0);
    }
    const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
    vol20[i] = Math.sqrt(rets.reduce((s, v) => s + (v - mean) ** 2, 0) / rets.length);
  }

  // Gap % (open vs prev close)
  const gapPct = new Array(closes.length).fill(0);
  for (let i = 1; i < closes.length; i++) {
    gapPct[i] = closes[i - 1] > 0 ? (opens[i] - closes[i - 1]) / closes[i - 1] * 100 : 0;
  }

  // 52-week range position
  const range52w = new Array(closes.length).fill(0.5);
  for (let i = 249; i < closes.length; i++) {
    const hi = Math.max(...highs.slice(i - 249, i + 1));
    const lo = Math.min(...lows.slice(i - 249, i + 1));
    range52w[i] = hi > lo ? (closes[i] - lo) / (hi - lo) : 0.5;
  }

  // ─── New features (26-39) ──────────────────────────────────

  // ADX (Average Directional Index) — Wilder-smoothed
  const adx = new Array(closes.length).fill(0);
  {
    const period = 14;
    const dmPlus = new Array(closes.length).fill(0);
    const dmMinus = new Array(closes.length).fill(0);
    const tr = new Array(closes.length).fill(0);
    for (let i = 1; i < closes.length; i++) {
      const upMove = highs[i] - highs[i - 1];
      const downMove = lows[i - 1] - lows[i];
      dmPlus[i] = upMove > downMove && upMove > 0 ? upMove : 0;
      dmMinus[i] = downMove > upMove && downMove > 0 ? downMove : 0;
      tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    }
    // Wilder smoothing
    let smoothTR = 0, smoothDMp = 0, smoothDMm = 0;
    for (let i = 1; i <= period; i++) { smoothTR += tr[i]; smoothDMp += dmPlus[i]; smoothDMm += dmMinus[i]; }
    let prevDX = 0;
    for (let i = period; i < closes.length; i++) {
      if (i > period) {
        smoothTR = smoothTR - smoothTR / period + tr[i];
        smoothDMp = smoothDMp - smoothDMp / period + dmPlus[i];
        smoothDMm = smoothDMm - smoothDMm / period + dmMinus[i];
      }
      const diP = smoothTR > 0 ? (smoothDMp / smoothTR) * 100 : 0;
      const diM = smoothTR > 0 ? (smoothDMm / smoothTR) * 100 : 0;
      const dx = diP + diM > 0 ? Math.abs(diP - diM) / (diP + diM) * 100 : 0;
      if (i === period) { adx[i] = dx; prevDX = dx; }
      else { adx[i] = (prevDX * (period - 1) + dx) / period; prevDX = adx[i]; }
    }
  }

  // Hidden divergences (bullish/bearish) — lookback 20 bars
  const hiddenBullDiv = new Array(closes.length).fill(0);
  const hiddenBearDiv = new Array(closes.length).fill(0);
  for (let i = 20; i < closes.length; i++) {
    // Find local lows/highs in last 20 bars
    let priceLow1 = Infinity, priceLow2 = Infinity, rsiLow1 = 100, rsiLow2 = 100;
    let priceHigh1 = -Infinity, priceHigh2 = -Infinity, rsiHigh1 = 0, rsiHigh2 = 0;
    const mid = i - 10;
    for (let j = i - 19; j <= mid; j++) { if (lows[j] < priceLow1) { priceLow1 = lows[j]; rsiLow1 = rsiSeries[j] ?? 50; } if (highs[j] > priceHigh1) { priceHigh1 = highs[j]; rsiHigh1 = rsiSeries[j] ?? 50; } }
    for (let j = mid + 1; j <= i; j++) { if (lows[j] < priceLow2) { priceLow2 = lows[j]; rsiLow2 = rsiSeries[j] ?? 50; } if (highs[j] > priceHigh2) { priceHigh2 = highs[j]; rsiHigh2 = rsiSeries[j] ?? 50; } }
    // Bullish hidden: price higher low + RSI lower low
    if (priceLow2 > priceLow1 && rsiLow2 < rsiLow1 - 3) hiddenBullDiv[i] = 1;
    // Bearish hidden: price lower high + RSI higher high
    if (priceHigh2 < priceHigh1 && rsiHigh2 > rsiHigh1 + 3) hiddenBearDiv[i] = 1;
  }

  // Bollinger squeeze (BB width < 5% of mid)
  const bbSqueeze = bbWidth.map((w) => w < 0.05 ? 1 : 0);

  // Volatility compression (ATR < 70% of 60d ATR average)
  const volCompression = new Array(closes.length).fill(0);
  for (let i = 60; i < closes.length; i++) {
    const avgATR = atrSeries.slice(i - 59, i + 1).reduce((s, v) => s + v, 0) / 60;
    if (avgATR > 0 && atrSeries[i] < avgATR * 0.7) volCompression[i] = 1;
  }

  // Order flow imbalance — wick-based auction bias over 10 bars
  const orderFlowImbalance = new Array(closes.length).fill(0);
  for (let i = 10; i < closes.length; i++) {
    let bullish = 0, bearish = 0;
    for (let j = i - 9; j <= i; j++) {
      const body = Math.abs(closes[j] - opens[j]);
      const range = highs[j] - lows[j];
      if (range <= 0) continue;
      const upperWick = highs[j] - Math.max(closes[j], opens[j]);
      const lowerWick = Math.min(closes[j], opens[j]) - lows[j];
      // Bullish: close > open with small lower wick, or buyer exhaustion reversal
      if (closes[j] > opens[j]) bullish += body / range;
      else bearish += body / range;
      // Wick analysis: long lower wick = buying pressure
      if (lowerWick > body * 1.5) bullish += 0.5;
      if (upperWick > body * 1.5) bearish += 0.5;
    }
    const total = bullish + bearish;
    orderFlowImbalance[i] = total > 0 ? (bullish - bearish) / total : 0;
  }

  // Momentum persistence (% of last 10 bars with RSI > 55)
  const momPersistence = new Array(closes.length).fill(0.5);
  for (let i = 10; i < closes.length; i++) {
    let count = 0;
    for (let j = i - 9; j <= i; j++) {
      if ((rsiSeries[j] ?? 50) > 55) count++;
    }
    momPersistence[i] = count / 10;
  }

  // Trend efficiency — |net move| / sum(|daily moves|) over 20 bars
  const trendEfficiency = new Array(closes.length).fill(0.5);
  for (let i = 20; i < closes.length; i++) {
    const netMove = Math.abs(closes[i] - closes[i - 20]);
    let totalMove = 0;
    for (let j = i - 19; j <= i; j++) totalMove += Math.abs(closes[j] - closes[j - 1]);
    trendEfficiency[i] = totalMove > 0 ? netMove / totalMove : 0;
  }

  // Price position in 20d range
  const range20d = new Array(closes.length).fill(0.5);
  for (let i = 20; i < closes.length; i++) {
    const hi20 = Math.max(...highs.slice(i - 19, i + 1));
    const lo20 = Math.min(...lows.slice(i - 19, i + 1));
    range20d[i] = hi20 > lo20 ? (closes[i] - lo20) / (hi20 - lo20) : 0.5;
  }

  // Volume trend (5d avg > 20d avg)
  const smaVol5 = smaArr(volumes, 5);
  const volTrend = volumes.map((_, i) =>
    !isNaN(smaVol5[i]) && !isNaN(smaVol20[i]) && smaVol20[i] > 0
      ? smaVol5[i] > smaVol20[i] ? 1 : 0
      : 0
  );

  // Wyckoff spring — low pierces 20d support, close recovers, on above-avg volume
  const wyckoffSpring = new Array(closes.length).fill(0);
  for (let i = 21; i < closes.length; i++) {
    const lo20 = Math.min(...lows.slice(i - 20, i)); // support = prior 20d low
    if (lows[i] < lo20 && closes[i] > lo20 && volRatio[i] > 1.2) {
      wyckoffSpring[i] = 1;
    }
  }

  // Extension from MA20
  const ma20 = smaArr(closes, 20);
  const extensionMA20 = closes.map((c, i) =>
    !isNaN(ma20[i]) && ma20[i] > 0 ? (c - ma20[i]) / ma20[i] * 100 : 0
  );

  // Gap fill ratio — how much of today's gap was filled by the close
  const gapFillRatio = new Array(closes.length).fill(0.5);
  for (let i = 1; i < closes.length; i++) {
    const gap = opens[i] - closes[i - 1];
    if (Math.abs(gap) < closes[i - 1] * 0.001) { gapFillRatio[i] = 0.5; continue; }
    if (gap > 0) {
      // Gap up — fill = how much price came back down
      gapFillRatio[i] = clamp((opens[i] - lows[i]) / gap, 0, 1);
    } else {
      // Gap down — fill = how much price recovered
      gapFillRatio[i] = clamp((highs[i] - opens[i]) / Math.abs(gap), 0, 1);
    }
  }

  return {
    closes, highs, lows, volumes, opens,
    rsiSeries, macdHist,
    ma5, ma25, ma50, ma75, ma200,
    atrSeries, bbWidth, stochK, stochD,
    volZ, volRatio,
    ret5, ret20, ret60, vol20, gapPct, range52w,
    // New indicator series
    adx, hiddenBullDiv, hiddenBearDiv, bbSqueeze, volCompression,
    orderFlowImbalance, momPersistence, trendEfficiency,
    range20d, volTrend, wyckoffSpring, extensionMA20, gapFillRatio,
  };
}

/**
 * Extract a 26-dim feature vector at a specific index.
 * Returns null if the index doesn't have enough lookback data.
 *
 * @param {Object} indicators - output of computeIndicatorSeries()
 * @param {number} idx - the index into the price array
 * @param {Object} snapshot - optional { pe_ratio, pb_ratio, dividend_yield } from stock_snapshots
 * @returns {Float64Array|null} 26-dim feature vector
 */
export function extractFeaturesAtIndex(indicators, idx, snapshot = null) {
  const {
    closes, ma5, ma25, ma50, ma75, ma200,
    rsiSeries, macdHist, atrSeries, bbWidth,
    stochK, stochD, volZ, volRatio,
    ret5, ret20, ret60, vol20, gapPct, range52w,
    adx, hiddenBullDiv, hiddenBearDiv, bbSqueeze, volCompression,
    orderFlowImbalance, momPersistence, trendEfficiency,
    range20d, volTrend, wyckoffSpring, extensionMA20, gapFillRatio,
  } = indicators;

  // Need at least MA200 lookback
  if (idx < MIN_LOOKBACK || isNaN(ma200[idx]) || !closes[idx]) return null;

  const price = closes[idx];
  if (price <= 0) return null;

  const features = new Float64Array(RETROACTIVE_FEATURE_DIM);

  // 0: RSI / 100
  features[0] = (rsiSeries[idx] ?? 50) / 100;

  // 1: MACD histogram / (price * 0.01) — clamped
  features[1] = clamp(macdHist[idx] / (price * 0.01 || 1), -5, 5) / 10 + 0.5;

  // 2: ATR% (ATR / price) — clamped
  features[2] = clamp(atrSeries[idx] / price, 0, 0.1) * 10;

  // 3: Bollinger bandwidth — clamped
  features[3] = clamp(bbWidth[idx], 0, 0.3) / 0.3;

  // 4: Stochastic %K / 100
  features[4] = (stochK[idx] ?? 50) / 100;

  // 5: Stochastic %D / 100
  features[5] = (stochD[idx] ?? 50) / 100;

  // 6: Volume Z-score (clamped)
  features[6] = clamp(volZ[idx], -3, 5) / 8 + 0.375;

  // 7: Price vs MA25 %
  const pvsMA25 = ma25[idx] > 0 ? (price - ma25[idx]) / ma25[idx] * 100 : 0;
  features[7] = clamp(pvsMA25, -30, 30) / 60 + 0.5;

  // 8: Price vs MA50 %
  const pvsMA50 = ma50[idx] > 0 ? (price - ma50[idx]) / ma50[idx] * 100 : 0;
  features[8] = clamp(pvsMA50, -30, 30) / 60 + 0.5;

  // 9: Price vs MA200 %
  const pvsMA200 = ma200[idx] > 0 ? (price - ma200[idx]) / ma200[idx] * 100 : 0;
  features[9] = clamp(pvsMA200, -50, 50) / 100 + 0.5;

  // 10: MA25 slope (5-day)
  const ma25slope = idx >= 5 && ma25[idx - 5] > 0
    ? (ma25[idx] - ma25[idx - 5]) / ma25[idx - 5] * 100
    : 0;
  features[10] = clamp(ma25slope, -10, 10) / 20 + 0.5;

  // 11: MA stack score (0-3)
  let maStack = 0;
  if (ma5[idx] > ma25[idx]) maStack++;
  if (ma25[idx] > ma50[idx]) maStack++;
  if (ma50[idx] > ma200[idx]) maStack++;
  features[11] = maStack / 3;

  // 12: Price in 52-week range
  features[12] = range52w[idx];

  // 13-15: Returns
  features[13] = clamp(ret5[idx], -20, 20) / 40 + 0.5;
  features[14] = clamp(ret20[idx], -30, 30) / 60 + 0.5;
  features[15] = clamp(ret60[idx], -50, 50) / 100 + 0.5;

  // 16: Volatility (20d)
  features[16] = clamp(vol20[idx], 0, 0.05) / 0.05;

  // 17: Volume ratio
  features[17] = clamp(volRatio[idx], 0, 5) / 5;

  // 18: Gap %
  features[18] = clamp(gapPct[idx], -5, 5) / 10 + 0.5;

  // 19-21: Market regime one-hot from MA stack
  // 0=DOWN (stack=0), 1=RANGE (stack=1), 2=UP (stack=2), 3=STRONG_UP (stack=3)
  features[19] = maStack === 0 ? 1 : 0; // DOWN
  features[20] = maStack === 1 || maStack === 2 ? 1 : 0; // RANGE/UP
  features[21] = maStack === 3 ? 1 : 0; // STRONG_UP

  // 22-24: Fundamental features from snapshot (or defaults)
  const pe = snapshot?.pe_ratio != null ? Number(snapshot.pe_ratio) : 0;
  const pb = snapshot?.pb_ratio != null ? Number(snapshot.pb_ratio) : 0;
  const divYield = snapshot?.dividend_yield != null ? Number(snapshot.dividend_yield) : 0;

  features[22] = clamp(pe, 0, 100) / 100;
  features[23] = clamp(pb, 0, 10) / 10;
  features[24] = clamp(divYield, 0, 0.1) / 0.1;

  // 25: Reserved
  features[25] = 0;

  // ─── New features (26-39) ──────────────────────────────────

  // 26: ADX (trend strength) / 50
  features[26] = clamp(adx[idx], 0, 50) / 50;

  // 27: Hidden bullish divergence (0/1)
  features[27] = hiddenBullDiv[idx];

  // 28: Hidden bearish divergence (0/1)
  features[28] = hiddenBearDiv[idx];

  // 29: Bollinger squeeze (0/1)
  features[29] = bbSqueeze[idx];

  // 30: Volatility compression (0/1)
  features[30] = volCompression[idx];

  // 31: Order flow imbalance (-1 to 1) → (0 to 1)
  features[31] = clamp(orderFlowImbalance[idx], -1, 1) / 2 + 0.5;

  // 32: Momentum persistence (0-1)
  features[32] = momPersistence[idx];

  // 33: Trend efficiency (0-1)
  features[33] = trendEfficiency[idx];

  // 34: Price position in 20d range (0-1)
  features[34] = range20d[idx];

  // 35: Volume trend (0/1)
  features[35] = volTrend[idx];

  // 36: Wyckoff spring (0/1)
  features[36] = wyckoffSpring[idx];

  // 37: Extension from MA20 — clipped ±15%
  features[37] = clamp(extensionMA20[idx], -15, 15) / 30 + 0.5;

  // 38: Gap fill ratio (0-1)
  features[38] = gapFillRatio[idx];

  // 39: Reserved
  features[39] = 0;

  return features;
}

/**
 * Detect "entry-like" conditions at a given index.
 * Used by Phase 1 (Signal Quality) to generate retroactive training labels.
 * Returns true if the conditions suggest a potential swing entry point.
 */
export function isEntryLikeCondition(indicators, idx) {
  const { rsiSeries, closes, opens, ma25, stochK, bbWidth, adx, volRatio, volumes } = indicators;
  if (idx < MIN_LOOKBACK || !closes[idx]) return false;

  const rsi = rsiSeries[idx];
  const prevRsi = rsiSeries[idx - 1];
  const price = closes[idx];
  const prevPrice = closes[idx - 1];

  // Condition 1: RSI bounce — RSI was < 35 recently, now crossing back up
  const rsiBounce = prevRsi != null && rsi != null && prevRsi < 35 && rsi > prevRsi;

  // Condition 2: Price touching MA25 from below (support test)
  const ma25val = ma25[idx];
  const ma25prev = ma25[idx - 1];
  const priceNearMA25 = ma25val > 0 && Math.abs(price - ma25val) / ma25val < 0.02;
  const priceCrossingUp = prevPrice < ma25prev && price >= ma25val;

  // Condition 3: Stochastic oversold bounce
  const stochBounce = stochK[idx - 1] < 25 && stochK[idx] > stochK[idx - 1];

  // Condition 4: Volume surge bounce — volume > 2× avg + close > open after down day
  const volSurgeBounce = volRatio[idx] > 2.0 && closes[idx] > opens[idx] && closes[idx - 1] < opens[idx - 1];

  // Condition 5: Bollinger band touch — close near lower band + RSI < 40
  const bbTouch = bbWidth[idx] > 0 && rsi != null && rsi < 40 && priceNearMA25;

  // Condition 6: ADX trend pullback — ADX > 25 (trending) + RSI dips below 45 then recovers
  const adxPullback = adx[idx] > 25 && prevRsi != null && prevRsi < 45 && rsi > prevRsi && rsi > 45;

  return rsiBounce || priceCrossingUp || stochBounce || priceNearMA25 || volSurgeBounce || bbTouch || adxPullback;
}

/**
 * Compute forward return for labeling.
 * @param {number[]} closes - full close price array
 * @param {number} idx - current index
 * @param {number} horizon - number of days forward
 * @returns {number|null} percentage return, or null if not enough data
 */
export function computeForwardReturn(closes, idx, horizon) {
  if (idx + horizon >= closes.length) return null;
  const current = closes[idx];
  if (current <= 0) return null;

  // Max price in the forward window
  const futureSlice = closes.slice(idx + 1, idx + 1 + horizon);
  const maxPrice = Math.max(...futureSlice);
  return ((maxPrice - current) / current) * 100;
}

/**
 * Check if a hypothetical entry would have hit target before stop.
 * Returns 1.0 (win), 0.0 (loss), or 0.5 (expired neutral).
 */
export function labelEntryOutcome(closes, highs, lows, idx, targetPct = 5, stopPct = 3, horizon = 30) {
  if (idx + horizon >= closes.length) return null;
  const entryPrice = closes[idx];
  if (entryPrice <= 0) return null;

  const target = entryPrice * (1 + targetPct / 100);
  const stop = entryPrice * (1 - stopPct / 100);

  for (let i = idx + 1; i <= Math.min(idx + horizon, closes.length - 1); i++) {
    if (highs[i] >= target) return 1.0; // target hit first
    if (lows[i] <= stop) return 0.0; // stop hit first
  }

  // Expired — neither target nor stop hit, filter out during training
  return null;
}

/**
 * Build a snapshot lookup map from stock_snapshots query results.
 * @param {Array} snapshotRows - rows from stock_snapshots, sorted by date
 * @returns {Map<string, Object>} date string → snapshot row
 */
export function buildSnapshotMap(snapshotRows) {
  const map = new Map();
  for (const row of snapshotRows) {
    const dateStr = toDateStr(row.snapshot_date);
    map.set(dateStr, row);
  }
  return map;
}

/**
 * Find the nearest snapshot for a given date (ASOF lookup).
 */
export function findNearestSnapshot(snapshotMap, dateStr, maxDaysBack = 30) {
  const target = new Date(dateStr);
  for (let d = 0; d <= maxDaysBack; d++) {
    const checkDate = new Date(target);
    checkDate.setDate(checkDate.getDate() - d);
    const key = checkDate.toISOString().split("T")[0];
    if (snapshotMap.has(key)) return snapshotMap.get(key);
  }
  return null;
}
