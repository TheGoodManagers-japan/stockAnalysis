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

/** RSI over plain closes array. Returns single latest value. */
export function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0,
    losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  const avgG = gains / period,
    avgL = losses / period;
  const rs = avgL === 0 ? 100 : avgG / avgL;
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

/** ATR over OHLCV candle array. Returns single latest value. */
export function calculateATR(data, period = 14) {
  if (!Array.isArray(data) || data.length < period + 1) return 0;
  const trs = [];
  for (let i = 1; i < data.length; i++) {
    const h = Number(data[i]?.high ?? data[i]?.close ?? 0);
    const l = Number(data[i]?.low ?? data[i]?.close ?? 0);
    const pc = Number(data[i - 1]?.close ?? 0);
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
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
