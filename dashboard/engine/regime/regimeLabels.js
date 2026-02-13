// dashboard/engine/regime/regimeLabels.js
// Extracted from public/scripts/core/main.js — regime detection functions
// ESM — no browser globals

/* ======================== Helpers ======================== */

const toISO = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * Simple moving average over candle arrays (field = "close" by default).
 */
export function sma(data, n, field = "close") {
  if (!Array.isArray(data) || data.length < n) return 0;
  let s = 0;
  for (let i = data.length - n; i < data.length; i++) {
    s += Number(data[i]?.[field]) || 0;
  }
  return s / n;
}

/**
 * SMA series for an array of numbers (returns NaN until window fills).
 */
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

/* ======================== ATR(p) ======================== */

/**
 * Average True Range with safe fallbacks to 'close'.
 */
export function calcATR(data, p = 14) {
  if (!Array.isArray(data) || data.length < p + 1) return 0;
  const trs = [];
  for (let i = 1; i < data.length; i++) {
    const h = Number(data[i]?.high ?? data[i]?.close ?? 0);
    const l = Number(data[i]?.low ?? data[i]?.close ?? 0);
    const pc = Number(data[i - 1]?.close ?? 0);
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const slice = trs.slice(-p);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / p;
}

/* ======================== ADX(14) ======================== */

/**
 * ADX(14) (Wilder smoothing) with safe fallbacks.
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

/* ======================== Regime labels ======================== */

/**
 * Compute daily regime labels from candles.
 * - STRONG_UP: px>MA25 & MA25 slope > +0.02%/bar & MA25>MA75
 * - UP:        px>MA25 & slope >= 0
 * - RANGE:     |slope| < 0.02%/bar OR |px-MA25| <= ATR(14)
 * - DOWN:      otherwise
 */
export function computeRegimeLabels(candles) {
  if (!Array.isArray(candles) || candles.length < 30) {
    return Array.isArray(candles) ? candles.map(() => "RANGE") : [];
  }
  const closes = candles.map((c) => Number(c.close) || 0);
  const ma25 = smaArr(closes, 25);
  const ma75 = smaArr(closes, 75);

  // ATR(14) (simple Wilder-like)
  const atr = (() => {
    if (candles.length < 15) return candles.map(() => 0);
    const out = new Array(candles.length).fill(0);
    for (let i = 1; i < candles.length; i++) {
      const h = Number(candles[i].high ?? candles[i].close ?? 0);
      const l = Number(candles[i].low ?? candles[i].close ?? 0);
      const pc = Number(candles[i - 1].close ?? 0);
      const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
      if (i < 15) {
        const start = Math.max(1, i - 14);
        let sum = 0;
        for (let k = start; k <= i; k++) {
          const hk = Number(candles[k].high ?? candles[k].close ?? 0);
          const lk = Number(candles[k].low ?? candles[k].close ?? 0);
          const pck = Number(candles[k - 1]?.close ?? 0);
          const trk = Math.max(hk - lk, Math.abs(hk - pck), Math.abs(lk - pck));
          sum += trk;
        }
        out[i] = sum / Math.min(14, i);
      } else {
        out[i] = (out[i - 1] * 13 + tr) / 14;
      }
    }
    return out;
  })();

  const labels = [];
  for (let i = 0; i < candles.length; i++) {
    const px = closes[i];
    const m25 = ma25[i];
    const m75 = ma75[i];
    const a14 = atr[i] || 0;

    // MA25 slope over last 5 bars (%/bar)
    let slope = 0;
    if (i >= 5 && Number.isFinite(m25) && m25 > 0) {
      const prev = ma25[i - 5];
      if (Number.isFinite(prev) && prev > 0) slope = (m25 - prev) / prev / 5;
    }

    const aboveMA = Number.isFinite(m25) && px > m25;
    const strong =
      aboveMA && slope > 0.0002 && Number.isFinite(m75) && m25 > m75;
    const flatish =
      Math.abs(slope) < 0.0002 ||
      (Number.isFinite(m25) && Math.abs(px - m25) <= a14);

    if (strong) labels.push("STRONG_UP");
    else if (aboveMA && slope >= 0) labels.push("UP");
    else if (flatish) labels.push("RANGE");
    else labels.push("DOWN");
  }
  return labels;
}

/* ======================== Regime map ======================== */

export function buildRegimeMap(candles) {
  const labels = computeRegimeLabels(candles);
  const map = Object.create(null);
  for (let i = 0; i < candles.length; i++) {
    map[toISO(candles[i].date)] = labels[i];
  }
  return map;
}

export function regimeForDate(regimeMap, date) {
  // Try date, then walk back up to 5 days to find last known label
  let d = new Date(date);
  for (let k = 0; k < 6; k++) {
    const key = toISO(d);
    if (regimeMap[key]) return regimeMap[key];
    d.setDate(d.getDate() - 1);
  }
  return "RANGE";
}
