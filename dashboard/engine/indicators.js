// dashboard/engine/indicators.js
// Canonical technical indicator implementations — single source of truth.
// All analysis modules should import from here instead of defining their own.

/* ======================== SMA variants ======================== */

/** SMA over OHLCV candle array (field = "close" by default). Returns latest value. */
export function sma(data, n, field = "close") {
  if (!Array.isArray(data) || data.length < n) return 0;
  let s = 0;
  for (let i = data.length - n; i < data.length; i++) {
    s += Number(data[i]?.[field]) || 0;
  }
  return s / n;
}

/** SMA over plain number array. Returns latest value. */
export function smaFromCloses(closes, period) {
  if (!closes || closes.length < period) return 0;
  const s = closes.slice(-period).reduce((a, b) => a + b, 0);
  return s / period;
}

/** Full SMA series for a number array (returns NaN until window fills). */
export function smaArr(arr, p) {
  if (arr.length < p) return Array(arr.length).fill(NaN);
  const out = new Array(arr.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= p) sum -= arr[i - p];
    if (i >= p - 1) out[i] = sum / p;
  }
  return out;
}

/**
 * MA over OHLCV array using .close — returns 0 if insufficient data.
 * Alias for use in yahoo.js context where data = OHLCV array.
 */
export function calculateMA(data, days) {
  return data.length < days
    ? 0
    : data.slice(-days).reduce((a, v) => a + (v.close || 0), 0) / days;
}

/* ======================== EMA ======================== */

/** EMA over plain number array. Returns full EMA series. */
export function calculateEMA(prices, p) {
  if (prices.length < p) return [];
  const k = 2 / (p + 1);
  const out = [];
  let ema = prices.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p - 1; i < prices.length; i++) {
    if (i === p - 1) out.push(ema);
    else {
      ema = prices[i] * k + out[out.length - 1] * (1 - k);
      out.push(ema);
    }
  }
  return out;
}

/* ======================== RSI ======================== */

/** RSI over plain closes array. Returns single latest value (Wilder smoothing). */
export function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  // Seed with simple average over first `period` changes
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) avgGain += d;
    else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  // Wilder smoothing for remaining bars
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d >= 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** RSI series (full array) using Wilder smoothing. For deepMarketAnalysis. */
export function calculateRSISeries(prices, period = 14) {
  if (!prices || prices.length <= period) return [];
  const rsiArr = new Array(prices.length).fill(null);
  let avgGain = 0,
    avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change >= 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
  const rs0 = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsiArr[period] = 100 - 100 / (1 + rs0);
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = change >= 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiArr[i] = 100 - 100 / (1 + rs);
  }
  return rsiArr;
}

/** RSI from OHLCV candle array (convenience). Returns latest value. */
export function rsiFromData(data, len = 14) {
  if (!Array.isArray(data) || data.length < len + 1) return 50;
  const closes = data.map((d) => d.close ?? 0);
  return calculateRSI(closes, len);
}

/* ======================== MACD ======================== */

/** MACD(12,26,9) over closes. Returns { macd, signal }. */
export function calculateMACD(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow) return { macd: 0, signal: 0 };
  const emaFast = calculateEMA(closes, fast);
  const emaSlow = calculateEMA(closes, slow);
  const macdLine = emaFast
    .slice(emaFast.length - emaSlow.length)
    .map((v, i) => v - emaSlow[i]);
  const sig = calculateEMA(macdLine, signal);
  return { macd: macdLine.pop() || 0, signal: sig.pop() || 0 };
}

/* ======================== Bollinger Bands ======================== */

/** Bollinger Bands(20,2) over closes. Returns { upper, lower, mid }. */
export function calculateBollinger(closes, period = 20, m = 2) {
  if (closes.length < period) return { upper: 0, lower: 0, mid: 0 };
  const recent = closes.slice(-period);
  const mid = recent.reduce((a, v) => a + v, 0) / period;
  const variance =
    recent.reduce((a, v) => a + Math.pow(v - mid, 2), 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: mid + m * sd, lower: mid - m * sd, mid };
}

/* ======================== ATR ======================== */

/** ATR over OHLCV candle array. Returns single latest value (Wilder smoothing). */
export function calculateATR(data, period = 14) {
  if (!Array.isArray(data) || data.length < period + 1) return 0;
  // Compute true ranges
  const trs = [];
  for (let i = 1; i < data.length; i++) {
    const h = Number(data[i]?.high ?? data[i]?.close ?? 0);
    const l = Number(data[i]?.low ?? data[i]?.close ?? 0);
    const pc = Number(data[i - 1]?.close ?? 0);
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  if (trs.length < period) return 0;
  // Seed with simple average of first `period` TRs
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  // Wilder smoothing for remaining
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

/* ======================== Stochastic ======================== */

/** Stochastic %K/%D. Returns { k, d }. */
export function calculateStochastic(data, kP = 14, dP = 3) {
  if (data.length < kP + dP - 1) return { k: 50, d: 50 };
  const kVals = [];
  for (let i = kP - 1; i < data.length; i++) {
    const slice = data.slice(i - kP + 1, i + 1);
    const hi = Math.max(...slice.map((d) => d.high));
    const lo = Math.min(...slice.map((d) => d.low));
    const cl = data[i].close;
    kVals.push(hi !== lo ? ((cl - lo) / (hi - lo)) * 100 : 50);
  }
  if (kVals.length < dP) return { k: kVals.at(-1) || 50, d: 50 };
  const dVals = [];
  for (let i = dP - 1; i < kVals.length; i++) {
    const sum = kVals.slice(i - dP + 1, i + 1).reduce((a, b) => a + b, 0);
    dVals.push(sum / dP);
  }
  return { k: kVals.at(-1), d: dVals.at(-1) };
}

/* ======================== OBV ======================== */

/** On-Balance Volume. Returns latest cumulative OBV value. */
export function calculateOBV(data) {
  if (data.length < 2) return 0;
  let obv = 0;
  for (let i = 1; i < data.length; i++) {
    const cc = data[i].close,
      pc = data[i - 1].close,
      vol = data[i].volume || 0;
    if (cc > pc) obv += vol;
    else if (cc < pc) obv -= vol;
  }
  return obv;
}

/** On-Balance Volume series. Returns full OBV array. */
export function calculateOBVSeries(data) {
  if (!data || data.length < 2) return [];
  const out = [0];
  let obv = 0;
  for (let i = 1; i < data.length; i++) {
    const cc = data[i].close,
      pc = data[i - 1].close,
      vol = data[i].volume || 0;
    if (cc > pc) obv += vol;
    else if (cc < pc) obv -= vol;
    out.push(obv);
  }
  return out;
}

/* ======================== ADX(14) ======================== */

/**
 * ADX(14) (Wilder smoothing) with safe fallbacks.
 * Canonical implementation — all modules should import from here.
 */
export function calcADX14(data) {
  if (!Array.isArray(data) || data.length < 16) return 0;

  const plusDM = [];
  const minusDM = [];
  const tr = [];

  for (let i = 1; i < data.length; i++) {
    const h = Number(data[i]?.high ?? data[i]?.close ?? 0);
    const l = Number(data[i]?.low ?? data[i]?.close ?? 0);
    const pc = Number(data[i - 1]?.close ?? 0);
    const ph = Number(data[i - 1]?.high ?? data[i - 1]?.close ?? 0);
    const pl = Number(data[i - 1]?.low ?? data[i - 1]?.close ?? 0);

    const up = h - ph;
    const down = pl - l;

    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }

  const p = 14;

  const smooth = (arr, period) => {
    if (arr.length < period) return [];
    let s = arr.slice(0, period).reduce((a, b) => a + b, 0);
    const out = [s];
    for (let i = period; i < arr.length; i++) {
      s = out[out.length - 1] - out[out.length - 1] / period + arr[i];
      out.push(s);
    }
    return out;
  };

  const smTR = smooth(tr, p);
  const smP = smooth(plusDM, p);
  const smM = smooth(minusDM, p);
  if (!smTR.length) return 0;

  const plusDI = smTR.map((v, i) => 100 * ((smP[i] || 0) / (v || 1)));
  const minusDI = smTR.map((v, i) => 100 * ((smM[i] || 0) / (v || 1)));
  const dx = plusDI.map((pdi, i) => {
    const mdi = minusDI[i] || 0;
    const denom = Math.max(1e-8, pdi + mdi);
    return 100 * (Math.abs(pdi - mdi) / denom);
  });

  const smDX = smooth(dx, p).map((v) => v / p);
  return smDX.at(-1) || 0;
}

/* ======================== Divergence Detection ======================== */

/**
 * Detect bullish/bearish divergence between price and an indicator.
 * @param {number[]} prices - Price array (closes or highs/lows)
 * @param {number[]} indicator - Indicator array (RSI, MACD histogram, OBV)
 * @param {number} lookback - Bars to look back (default 20)
 * @returns {{ bullish: boolean, bearish: boolean }}
 */
export function detectDivergence(prices, indicator, lookback = 20) {
  if (!prices || !indicator || prices.length < lookback || indicator.length < lookback) {
    return { bullish: false, bearish: false };
  }

  const len = Math.min(prices.length, indicator.length);
  const start = len - lookback;

  // Find pivot lows and highs
  const pivotLows = [];
  const pivotHighs = [];
  for (let i = start + 1; i < len - 1; i++) {
    if (prices[i] < prices[i - 1] && prices[i] < prices[i + 1]) {
      pivotLows.push(i);
    }
    if (prices[i] > prices[i - 1] && prices[i] > prices[i + 1]) {
      pivotHighs.push(i);
    }
  }

  let bullish = false;
  let bearish = false;

  // Bullish: price lower low + indicator higher low
  if (pivotLows.length >= 2) {
    const recent = pivotLows[pivotLows.length - 1];
    const prior = pivotLows[pivotLows.length - 2];
    if (prices[recent] <= prices[prior] && indicator[recent] > indicator[prior]) {
      bullish = true;
    }
  }

  // Bearish: price higher high + indicator lower high
  if (pivotHighs.length >= 2) {
    const recent = pivotHighs[pivotHighs.length - 1];
    const prior = pivotHighs[pivotHighs.length - 2];
    if (prices[recent] >= prices[prior] && indicator[recent] < indicator[prior]) {
      bearish = true;
    }
  }

  return { bullish, bearish };
}
