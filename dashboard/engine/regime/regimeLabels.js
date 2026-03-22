// dashboard/engine/regime/regimeLabels.js
// Regime detection functions
// ESM — no browser globals

// Re-export indicators used by orchestrator.js and other consumers
export { sma, smaArr, calculateATR as calcATR, calcADX14 } from "../indicators.js";
import { smaArr } from "../indicators.js";

/* ======================== Helpers ======================== */

const toISO = (d) => new Date(d).toISOString().slice(0, 10);

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
    // RANGE: require BOTH flat slope AND near MA25 (was OR)
    const flatish =
      Math.abs(slope) < 0.0002 &&
      (Number.isFinite(m25) && Math.abs(px - m25) <= a14);
    // STRONG_DOWN: below MA25, steep negative slope, MA25 < MA75
    const strongDown =
      !aboveMA && slope < -0.0002 && Number.isFinite(m75) && m25 < m75;

    if (strong) labels.push("STRONG_UP");
    else if (aboveMA && slope >= 0) labels.push("UP");
    else if (strongDown) labels.push("STRONG_DOWN");
    else if (flatish) labels.push("RANGE");
    else labels.push("DOWN");
  }

  // Regime hysteresis: require 3 consecutive bars of new label before switching
  if (labels.length >= 3) {
    for (let i = 2; i < labels.length; i++) {
      if (labels[i] !== labels[i - 1] && labels[i] !== labels[i - 2]) {
        // New label doesn't match either of the prior 2 bars — keep previous
        labels[i] = labels[i - 1];
      }
    }
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
