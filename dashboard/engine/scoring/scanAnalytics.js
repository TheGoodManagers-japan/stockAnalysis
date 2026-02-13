// dashboard/engine/scoring/scanAnalytics.js
// Extracted from public/scripts/core/main.js (lines ~502-586)
// Per-stock analytics collection + summary/histogram/distro structures for scan telemetry.
// ESM — no browser globals

import { calcATR, sma } from "../regime/regimeLabels.js";

/* ======================== Per-stock scan analytics ======================== */

/**
 * Compute lightweight analytics for a single stock + its historical data.
 * Returns { rsi, atrPct, volZ, gapPct, pxVsMA25Pct, maStackScore, pxAboveMA25, pxAboveMA75 }.
 */
export function scanAnalytics(stock, historicalData) {
  const data = Array.isArray(historicalData) ? historicalData : [];
  const n = data.length;
  if (!n)
    return {
      rsi: null,
      atrPct: null,
      volZ: null,
      gapPct: null,
      pxVsMA25Pct: null,
      maStackScore: 0,
      pxAboveMA25: false,
      pxAboveMA75: false,
    };

  const close = Number(stock.currentPrice) || Number(data.at(-1)?.close) || 0;
  const prevC = n > 1 ? Number(data[n - 2]?.close) || close : close;

  const closes = data.map((d) => Number(d.close) || 0);
  const vols = data.map((d) => Number(d.volume) || 0);

  // RSI14 (use enriched if present)
  const rsi = Number.isFinite(stock.rsi14)
    ? stock.rsi14
    : (function rsi14(cs) {
        if (cs.length < 15) return NaN;
        let g = 0,
          l = 0;
        for (let i = cs.length - 14; i < cs.length; i++) {
          const d = cs[i] - cs[i - 1];
          if (d >= 0) g += d;
          else l -= d;
        }
        const rs = l === 0 ? Infinity : g / l;
        return 100 - 100 / (1 + rs);
      })(closes);

  // ATR pct (use enriched if present)
  const atrAbs = Number.isFinite(stock.atr14) ? stock.atr14 : calcATR(data, 14);
  const atrPct = close ? (atrAbs / close) * 100 : 0;

  // Volume Z over 20
  const v20 = vols.slice(-20);
  let volZ = null;
  if (v20.length === 20) {
    const m = v20.reduce((a, b) => a + b, 0) / 20;
    const sd = Math.sqrt(v20.reduce((a, b) => a + (b - m) * (b - m), 0) / 20);
    volZ = sd > 0 ? (vols.at(-1) - m) / sd : 0;
  }

  const gapPct = prevC ? ((close - prevC) / prevC) * 100 : 0;

  const ma25 = Number.isFinite(stock.movingAverage25d)
    ? stock.movingAverage25d
    : sma(data, 25);
  const ma75 = Number.isFinite(stock.movingAverage75d)
    ? stock.movingAverage75d
    : sma(data, 75);
  const m5 = Number.isFinite(stock.movingAverage5d)
    ? stock.movingAverage5d
    : sma(data, 5);

  const pxVsMA25Pct =
    Number.isFinite(ma25) && ma25 > 0 ? ((close - ma25) / ma25) * 100 : NaN;

  let maStackScore = 0;
  if (Number.isFinite(m5) && Number.isFinite(ma25) && m5 > ma25)
    maStackScore += 1;
  if (Number.isFinite(ma25) && Number.isFinite(ma75) && ma25 > ma75)
    maStackScore += 1;
  if (Number.isFinite(ma25) && close > ma25) maStackScore += 1;

  return {
    rsi: Number.isFinite(rsi) ? +rsi.toFixed(2) : null,
    atrPct: Number.isFinite(atrPct) ? +atrPct.toFixed(2) : null,
    volZ: Number.isFinite(volZ) ? +volZ.toFixed(2) : null,
    gapPct: Number.isFinite(gapPct) ? +gapPct.toFixed(2) : null,
    pxVsMA25Pct: Number.isFinite(pxVsMA25Pct) ? +pxVsMA25Pct.toFixed(2) : null,
    maStackScore,
    pxAboveMA25: Number.isFinite(ma25) ? close > ma25 : false,
    pxAboveMA75: Number.isFinite(ma75) ? close > ma75 : false,
  };
}

/* ======================== Session-level collection structures ======================== */

/**
 * Create the empty telemetry/histogram/distro accumulation objects
 * used during a full scan session.
 */
export function createScanCollectors() {
  const teleList = [];

  const histo = {
    slopeBuckets: Object.create(null),
    rrShortfall: [],
    headroom: [],
    distMA25: [],
  };

  const distro = {
    slopePctVals: [],
    slopeEpsNeeded: [],
    slopeEpsNeededPct: [],
    priceRedBodyATR: [],
    priceDistMA25ATR: [],
    structureMarginPct: [],
    dipV20ratio: [],
    dipBodyPct: [],
    dipRangePctATR: [],
    dipCloseDeltaATR: [],
    dipPullbackPct: [],
    dipPullbackATR: [],
    dipRecoveryPct: [],
    rsiSample: [],
  };

  const summary = {
    totals: { count: 0, buyNow: 0, noBuy: 0 },
    reasons: {
      buy: Object.create(null),
      noBuy: Object.create(null),
    },
    tiers: {
      byTier: Object.create(null),
      buyByTier: Object.create(null),
    },
  };

  return { teleList, histo, distro, summary };
}

/**
 * Merge a single item's telemetry into the session-level collectors.
 */
export function mergeTelemetry(collectors, telemetry) {
  if (!telemetry) return;

  collectors.teleList.push(telemetry);

  // merge histograms
  const t = telemetry?.histos || {};
  for (const [k, v] of Object.entries(t.slopeBuckets || {})) {
    collectors.histo.slopeBuckets[k] =
      (collectors.histo.slopeBuckets[k] || 0) + v;
  }
  if (Array.isArray(t.rrShortfall))
    collectors.histo.rrShortfall.push(...t.rrShortfall);
  if (Array.isArray(t.headroom))
    collectors.histo.headroom.push(...t.headroom);
  if (Array.isArray(t.distMA25))
    collectors.histo.distMA25.push(...t.distMA25);

  // merge numeric distros
  const d = telemetry?.distros || {};
  for (const key of Object.keys(collectors.distro)) {
    if (Array.isArray(d[key])) collectors.distro[key].push(...d[key]);
  }
}
