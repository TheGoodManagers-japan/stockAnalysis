// dashboard/engine/scoring/enrichForTechnicalScore.js
// Lightweight technical enrichment — mutates and returns the stock object.
// ESM — no browser globals

import {
  smaFromCloses,
  calculateRSI,
  calculateMACD,
  calculateBollinger,
  calculateATR,
  calculateStochastic,
  calculateOBV,
} from "../indicators.js";

/**
 * enrichForTechnicalScore  —  fill in any missing technical indicator fields
 * on a stock object using its `.historicalData` array.
 *
 * Mutates `stock` in place and returns it for convenience.
 */
export function enrichForTechnicalScore(stock) {
  const data = Array.isArray(stock.historicalData) ? stock.historicalData : [];
  if (data.length < 2) return stock;

  const closes = data.map((d) => d.close ?? 0);

  if (!Number.isFinite(stock.movingAverage5d))
    stock.movingAverage5d = smaFromCloses(closes, 5) || 0;
  if (!Number.isFinite(stock.movingAverage25d))
    stock.movingAverage25d = smaFromCloses(closes, 25) || 0;
  if (!Number.isFinite(stock.movingAverage75d))
    stock.movingAverage75d = smaFromCloses(closes, 75) || 0;
  if (!Number.isFinite(stock.movingAverage50d))
    stock.movingAverage50d = smaFromCloses(closes, 50) || 0;
  if (!Number.isFinite(stock.movingAverage200d))
    stock.movingAverage200d = smaFromCloses(closes, 200) || 0;

  // OBV + MA20
  if (!Number.isFinite(stock.obv)) stock.obv = calculateOBV(data);
  if (!Number.isFinite(stock.obvMA20)) {
    // Build OBV series for MA20
    const obvSeries = [0];
    let obv = 0;
    for (let i = 1; i < data.length; i++) {
      const dir = Math.sign((data[i].close ?? 0) - (data[i - 1].close ?? 0));
      obv += dir * (data[i].volume || 0);
      obvSeries.push(obv);
    }
    if (obvSeries.length >= 20) {
      stock.obvMA20 = smaFromCloses(obvSeries, 20);
    }
  }

  // Bollinger(20)
  if (
    !Number.isFinite(stock.bollingerMid) ||
    !Number.isFinite(stock.bollingerUpper) ||
    !Number.isFinite(stock.bollingerLower)
  ) {
    const bb = calculateBollinger(closes);
    if (bb.mid) {
      stock.bollingerMid = bb.mid;
      stock.bollingerUpper = bb.upper;
      stock.bollingerLower = bb.lower;
    }
  }

  // ATR14
  if (!Number.isFinite(stock.atr14)) {
    stock.atr14 = calculateATR(data) || 0;
  }

  // Stochastic(14,3)
  if (
    !Number.isFinite(stock.stochasticK) ||
    !Number.isFinite(stock.stochasticD)
  ) {
    const stoch = calculateStochastic(data);
    if (!Number.isFinite(stock.stochasticK)) stock.stochasticK = stoch.k;
    if (!Number.isFinite(stock.stochasticD)) stock.stochasticD = stoch.d;
  }

  // RSI14
  if (!Number.isFinite(stock.rsi14)) {
    stock.rsi14 = calculateRSI(closes);
  }

  // MACD(12,26,9)
  if (!Number.isFinite(stock.macd) || !Number.isFinite(stock.macdSignal)) {
    const macdResult = calculateMACD(closes);
    stock.macd = macdResult.macd;
    stock.macdSignal = macdResult.signal;
  }

  if (!Number.isFinite(stock.currentPrice) && data.length) {
    stock.currentPrice = data[data.length - 1].close ?? 0;
  }

  return stock;
}

/**
 * computeTechnicalScore — returns a 0-10 technical score based on
 * momentum, trend, volatility, and volume indicators.
 *
 * Call AFTER enrichForTechnicalScore() so all indicators are populated.
 *
 * @param {Object} stock
 * @param {Object} [opts]
 * @param {boolean} [opts.withConfidence] - If true, returns { score, confidence }
 * @returns {number|{score: number, confidence: number}}
 */
export function computeTechnicalScore(stock, opts) {
  const f = (v) => (Number.isFinite(v) ? v : null);
  const price = f(stock.currentPrice);
  if (!price || price <= 0) {
    return opts?.withConfidence ? { score: 0, confidence: 0 } : 0;
  }

  let total = 0;
  let maxPts = 0;
  let availGroups = 0;
  const totalGroups = 8;

  // --- 1) Trend alignment (0-3 pts) ---
  maxPts += 3;
  const ma25 = f(stock.movingAverage25d);
  const ma75 = f(stock.movingAverage75d);
  const ma200 = f(stock.movingAverage200d);
  if (ma25 || ma75 || ma200) availGroups++;
  if (ma25 && price > ma25) total += 1;
  if (ma75 && price > ma75) total += 1;
  if (ma200 && price > ma200) total += 1;

  // --- 2) MA structure (0-1 pt) ---
  maxPts += 1;
  if (ma25 && ma75) { availGroups++; }
  if (ma25 && ma75 && ma25 > ma75) total += 1;

  // --- 3) RSI (0-2 pts) — reward pullback zone (room to run) ---
  maxPts += 2;
  const rsi = f(stock.rsi14);
  if (rsi != null) {
    availGroups++;
    if (rsi >= 30 && rsi <= 50) total += 2;      // pullback zone, ideal entry
    else if (rsi > 50 && rsi <= 65) total += 1;   // moderate, still OK
    else if (rsi > 65 && rsi <= 70) total += 0.5; // getting warm but not overbought
    // >70 overbought = 0 pts
  }

  // --- 4) MACD (0-1.5 pts) ---
  maxPts += 1.5;
  const macd = f(stock.macd);
  const macdSig = f(stock.macdSignal);
  if (macd != null && macdSig != null) {
    availGroups++;
    if (macd > macdSig) total += 1;
    if (macd > 0) total += 0.5;
  }

  // --- 5) Stochastic (0-1 pt) — reward oversold/crossover ---
  maxPts += 1;
  const stochK = f(stock.stochasticK);
  const stochD = f(stock.stochasticD);
  if (stochK != null) {
    availGroups++;
    if (stochK < 30 || (stochK >= 20 && stochK <= 40 && stochD != null && stochK > stochD)) {
      total += 1;   // oversold or bullish crossover in oversold zone
    } else if (stochK >= 30 && stochK <= 50) {
      total += 0.5;  // low-mid range, still favorable
    }
  }

  // --- 6) Bollinger position (0-1 pt) ---
  maxPts += 1;
  const bbUpper = f(stock.bollingerUpper);
  const bbLower = f(stock.bollingerLower);
  const bbMid = f(stock.bollingerMid);
  if (bbUpper && bbLower && bbMid) {
    availGroups++;
    if (price >= bbLower && price <= bbUpper) {
      total += price >= bbMid ? 0.5 : 1;
    }
  }

  // --- 7) Volatility control (0-0.5 pts) ---
  maxPts += 0.5;
  const atr = f(stock.atr14);
  if (atr != null && price > 0) {
    availGroups++;
    const atrPct = atr / price;
    if (atrPct < 0.03) total += 0.5;
    else if (atrPct < 0.05) total += 0.25;
  }

  // --- 8) OBV confirmation (0-1 pt) ---
  maxPts += 1;
  const obv = f(stock.obv);
  const obvMA20 = f(stock.obvMA20);
  if (obv != null && obvMA20 != null) {
    availGroups++;
    if (obv > obvMA20) total += 1;           // volume confirming uptrend
    else if (obv > obvMA20 * 0.95) total += 0.5; // roughly flat
  }

  // Normalize to 0-10
  if (maxPts === 0) {
    return opts?.withConfidence ? { score: 0, confidence: 0 } : 0;
  }
  const score = Math.round((total / maxPts) * 100) / 10;
  if (!opts?.withConfidence) return score;

  const confidence = Math.round((availGroups / totalGroups) * 100) / 100;
  return { score, confidence };
}
