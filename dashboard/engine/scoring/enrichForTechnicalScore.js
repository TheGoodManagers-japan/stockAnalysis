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
 */
export function computeTechnicalScore(stock) {
  const f = (v) => (Number.isFinite(v) ? v : null);
  const price = f(stock.currentPrice);
  if (!price || price <= 0) return 0;

  let total = 0;
  let maxPts = 0;

  // --- 1) Trend alignment (0-3 pts) ---
  // Price vs key MAs: above = bullish
  maxPts += 3;
  const ma25 = f(stock.movingAverage25d);
  const ma75 = f(stock.movingAverage75d);
  const ma200 = f(stock.movingAverage200d);
  if (ma25 && price > ma25) total += 1;
  if (ma75 && price > ma75) total += 1;
  if (ma200 && price > ma200) total += 1;

  // --- 2) MA structure (0-1 pt) ---
  // Golden cross: MA25 > MA75
  maxPts += 1;
  if (ma25 && ma75 && ma25 > ma75) total += 1;

  // --- 3) RSI (0-2 pts) ---
  maxPts += 2;
  const rsi = f(stock.rsi14);
  if (rsi != null) {
    if (rsi >= 40 && rsi <= 60) total += 2;        // healthy mid-range
    else if (rsi >= 30 && rsi <= 70) total += 1;    // acceptable
    // oversold (<30) or overbought (>70) = 0
  }

  // --- 4) MACD (0-1.5 pts) ---
  maxPts += 1.5;
  const macd = f(stock.macd);
  const macdSig = f(stock.macdSignal);
  if (macd != null && macdSig != null) {
    if (macd > macdSig) total += 1;                 // bullish crossover
    if (macd > 0) total += 0.5;                     // above zero line
  }

  // --- 5) Stochastic (0-1 pt) ---
  maxPts += 1;
  const stochK = f(stock.stochasticK);
  if (stochK != null) {
    if (stochK >= 20 && stochK <= 80) total += 1;   // not extreme
  }

  // --- 6) Bollinger position (0-1 pt) ---
  maxPts += 1;
  const bbUpper = f(stock.bollingerUpper);
  const bbLower = f(stock.bollingerLower);
  const bbMid = f(stock.bollingerMid);
  if (bbUpper && bbLower && bbMid) {
    if (price >= bbLower && price <= bbUpper) {
      total += price >= bbMid ? 0.5 : 1;            // above mid = ok, below mid = better entry
    }
  }

  // --- 7) Volatility control (0-0.5 pts) ---
  maxPts += 0.5;
  const atr = f(stock.atr14);
  if (atr != null && price > 0) {
    const atrPct = atr / price;
    if (atrPct < 0.03) total += 0.5;                // low volatility
    else if (atrPct < 0.05) total += 0.25;
  }

  // Normalize to 0-10
  if (maxPts === 0) return 0;
  return Math.round((total / maxPts) * 100) / 10;   // one decimal, 0.0-10.0
}
