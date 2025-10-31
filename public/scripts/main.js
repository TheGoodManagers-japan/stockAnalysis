// public/scripts/main.js
// ESM module used by both the browser and the /api/scan serverless function.
// - Browser: call window.scan.fetchStockAnalysis(tickers, myPortfolio)
// - Server:  /api/scan imports this file and calls fetchStockAnalysis({ ... })
//   (no Bubble calls are made on the server)
//
// NOTE: API base is fixed and DEBUG is always true per your request.

import { getComprehensiveMarketSentiment } from "./marketSentimentOrchestrator.js";

import {
  summarizeBlocks,
  analyseCrossing,
} from "./swingTradeEntryTiming.js";
import {
     getTechnicalScore,                 // noop (returns 0) in JP value-first file
     getAdvancedFundamentalScore,      // alias of getQualityScore
     getValuationScore,
     getNumericTier,
     classifyValueQuadrant,
   } from "./techFundValAnalysis.js";
import { allTickers } from "./tickers.js";

/* -------------------------------------------
   0) Constants + tiny logging helper
------------------------------------------- */
const API_BASE =
  "https://stock-analysis-rhkb3ohpx-aymerics-projects-60f33831.vercel.app";
const DEBUG = true;

const IS_BROWSER =
  typeof window !== "undefined" &&
  typeof document !== "undefined" &&
  !!(window.document && window.document.nodeType === 9);

function log(...args) {
  if (!DEBUG) return;
  const where = IS_BROWSER ? "BROWSER" : "SERVER";
  console.log(`[SCAN:${where}]`, ...args);
}
function warn(...args) {
  if (!DEBUG) return;
  const where = IS_BROWSER ? "BROWSER" : "SERVER";
  console.warn(`[SCAN:${where}]`, ...args);
}
function errorLog(...args) {
  const where = IS_BROWSER ? "BROWSER" : "SERVER";
  console.error(`[SCAN:${where}]`, ...args);
}

function inc(obj, key, by = 1) {
  if (!key && key !== 0) return;
  obj[key] = (obj[key] || 0) + by;
}
function sentiKey(ST, LT) {
  const st = Number.isFinite(ST) ? ST : 4;
  const lt = Number.isFinite(LT) ? LT : 4;
  return `LT${lt}-ST${st}`;
}
function normalizeReason(reasonRaw) {
  if (!reasonRaw) return "unspecified";
  let r = String(reasonRaw).trim();
  // unify common prefixes and noisy details
  r = r.replace(/^(DIP|SPC|OXR|BPB|RRP)\s+(not ready:|guard veto:)\s*/i, "");
  r = r.replace(/\([^)]*\)/g, ""); // drop parentheticals
  r = r.replace(/\s{2,}/g, " ").trim();
  return r.toLowerCase();
}


/* -------------------------------------------
   1) Yahoo / API helpers
------------------------------------------- */

async function fetchSingleStockData(tickerObj) {
  const url = `${API_BASE}/api/stocks`;
  log(`POST ${url}`, { payload: { ticker: tickerObj } });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: tickerObj }),
    });

    // read body as text first for better error visibility
    const text = await response.text();
    if (!response.ok) {
      const snippet = text.slice(0, 300);
      throw new Error(`HTTP ${response.status}  — ${snippet}`);
    }

    const data = safeJsonParse(text);
    log("stocks response OK", {
      code: tickerObj?.code,
      success: data?.success,
    });
    return data;
  } catch (err) {
    errorLog("fetchSingleStockData failed:", err?.message || err);
    return { success: false, error: String(err?.message || err) };
  }
}

async function fetchHistoricalData(ticker) {
  const url = `${API_BASE}/api/history?ticker=${encodeURIComponent(ticker)}`;
  log(`GET ${url}`);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const text = await response.text();
    if (!response.ok) {
      const snippet = text.slice(0, 300);
      throw new Error(`HTTP ${response.status}  — ${snippet}`);
    }

    const result = safeJsonParse(text);
    if (!result?.success) {
      throw new Error(result?.error || "history: success=false");
    }
    if (!Array.isArray(result?.data) || result.data.length === 0) {
      warn(`No historical data for ${ticker}.`);
      return [];
    }

    const mapped = result.data.map((item) => ({
      ...item,
      date: new Date(item.date),
    }));
    log(`history OK for ${ticker} — ${mapped.length} bars`);
    return mapped;
  } catch (err) {
    errorLog(`fetchHistoricalData failed for ${ticker}:`, err?.message || err);
    return [];
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}


/* ---- Helpers required by getTradeManagementSignal_V3 ---- */

// Built from your backtests (actual + rejected).
// If a combo isn't listed, we return 3 (neutral) by default.
const SENTIMENT_COMBO_SCORE = {
  "LT1-ST6": 100, "LT1-ST7": 98,  "LT1-ST2": 96,  "LT1-ST4": 94,  "LT1-ST5": 92,
  "LT4-ST2": 90,  "LT4-ST6": 89,  "LT4-ST4": 88,  "LT2-ST7": 87,  "LT2-ST4": 86,
  "LT2-ST6": 85,  "LT4-ST1": 84,  "LT4-ST7": 83,  "LT4-ST5": 82,  "LT3-ST1": 80,
  "LT3-ST4": 79,  "LT3-ST3": 78,  "LT3-ST5": 77,  "LT3-ST2": 76, 
  "LT5-ST7": 74,  "LT6-ST6": 72,  "LT6-ST4": 71,  "LT6-ST5": 70,  "LT7-ST5": 68,
  "LT7-ST4": 67,  "LT7-ST6": 66,  "LT7-ST3": 65,  "LT7-ST2": 64,  "LT7-ST7": 63,
  "LT5-ST2": 62,  "LT1-ST1": 61,  "LT2-ST1": 60,  "LT5-ST3": 59,  "LT5-ST4": 58,
  "LT5-ST1": 56,  "LT6-ST1": 55,  "LT6-ST3": 54,  "LT6-ST2": 53,  "LT5-ST6": 52,
  "LT4-ST3": 51,  "LT2-ST3": 45,  "LT1-ST3": 44,  "LT3-ST7": 40,  "LT3-ST6": 38,
  "LT2-ST5": 36
};

// Score → rank (1..5)
function rankFromScore(score) {
  if (score >= 90) return 1; // really good
  if (score >= 80) return 2; // good
  if (score >= 65) return 3; // neutral/ok
  if (score >= 50) return 4; // weak
  return 5;                  // avoid
}

export function getSentimentCombinationRank(ST, LT) {
  const key = `LT${Number(LT) || 0}-ST${Number(ST) || 0}`;
  const score = SENTIMENT_COMBO_SCORE[key];
  return score == null ? 3 : rankFromScore(score);
}

// usage:
// const rank = getSentimentCombinationRank(6, 1); // e.g. LT1-ST6 → 1


// Round a number safely
function round0(v) {
  return Math.round(Number(v) || 0);
}

// Last close from candle array
function lastClose(data) {
  return Number(data?.at?.(-1)?.close) || 0;
}

// Simple moving average over candle arrays (field = "close" by default)
function sma(data, n, field = "close") {
  if (!Array.isArray(data) || data.length < n) return 0;
  let s = 0;
  for (let i = data.length - n; i < data.length; i++) {
    s += Number(data[i]?.[field]) || 0;
  }
  return s / n;
}

// Average True Range with safe fallbacks to 'close'
function calcATR(data, p = 14) {
  if (!Array.isArray(data) || data.length < p + 1) return 0;
  const trs = [];
  for (let i = 1; i < data.length; i++) {
    const h  = Number(data[i]?.high ?? data[i]?.close ?? 0);
    const l  = Number(data[i]?.low  ?? data[i]?.close ?? 0);
    const pc = Number(data[i - 1]?.close ?? 0);
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const slice = trs.slice(-p);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / p;
}

// ADX(14) (Wilder smoothing) with safe fallbacks
function calcADX14(data) {
  if (!Array.isArray(data) || data.length < 16) return 0;

  const plusDM = [];
  const minusDM = [];
  const tr = [];

  for (let i = 1; i < data.length; i++) {
    const h  = Number(data[i]?.high ?? data[i]?.close ?? 0);
    const l  = Number(data[i]?.low  ?? data[i]?.close ?? 0);
    const pc = Number(data[i - 1]?.close ?? 0);
    const ph = Number(data[i - 1]?.high  ?? data[i - 1]?.close ?? 0);
    const pl = Number(data[i - 1]?.low   ?? data[i - 1]?.close ?? 0);

    const up   = h - ph;
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
  const smP  = smooth(plusDM, p);
  const smM  = smooth(minusDM, p);
  if (!smTR.length) return 0;

  const plusDI  = smTR.map((v, i) => 100 * ((smP[i] || 0) / (v || 1)));
  const minusDI = smTR.map((v, i) => 100 * ((smM[i] || 0) / (v || 1)));
  const dx = plusDI.map((pdi, i) => {
    const mdi = minusDI[i] || 0;
    const denom = Math.max(1e-8, pdi + mdi);
    return 100 * (Math.abs(pdi - mdi) / denom);
  });

  const smDX = smooth(dx, p).map(v => v / p);
  return smDX.at(-1) || 0;
}

// Last swing low (simple pivot scan on recent window)
function lastSwingLow(data) {
  if (!Array.isArray(data) || data.length < 5) return 0;
  const w = data.slice(-40);
  for (let i = w.length - 3; i >= 2; i--) {
    const l  = Number(w[i]?.low  ?? w[i]?.close ?? 0);
    const l0 = Number(w[i - 1]?.low ?? w[i - 1]?.close ?? 0);
    const l1 = Number(w[i + 1]?.low ?? w[i + 1]?.close ?? 0);
    if (l < l0 && l < l1) return l;
  }
  return Number(w.at(-1)?.low ?? w.at(-1)?.close ?? 0);
}

// Did price make a new lower low vs prior swing lows (recent window)?
function madeLowerLow(data) {
  if (!Array.isArray(data) || data.length < 4) return false;
  const w = data.slice(-6);
  let prevSwing = Infinity;
  for (let i = 1; i < w.length - 1; i++) {
    const li  = Number(w[i]?.low  ?? w[i]?.close ?? Infinity);
    const lim = Number(w[i - 1]?.low ?? w[i - 1]?.close ?? Infinity);
    const lip = Number(w[i + 1]?.low ?? w[i + 1]?.close ?? Infinity);
    if (li < lim && li < lip) prevSwing = Math.min(prevSwing, li);
  }
  const lastLow = Number(w.at(-1)?.low ?? w.at(-1)?.close ?? Infinity);
  return lastLow < prevSwing;
}

// Proximity helper (within pct of level)
function near(px, lvl, pct) {
  const a = Number(px);
  const b = Number(lvl);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return false;
  return Math.abs(a - b) / b <= pct;
}

// Recent pivot high (looks back ~20 bars excluding the last 2)
function recentPivotHigh(data) {
  if (!Array.isArray(data) || data.length < 12) return 0;
  const win = data.slice(-22, -2);
  if (!win.length) return 0;
  return Math.max(...win.map(d => Number(d?.high ?? d?.close ?? 0)));
}

// Structural trailing stop: behind last swing low and/or under MA25
function trailingStructStop(historicalData, ma25, atr) {
  const swing = lastSwingLow(historicalData);
  const bySwing = swing - 0.5 * atr;
  const byMA    = (ma25 > 0 ? ma25 - 0.6 * atr : -Infinity);
  return Math.max(bySwing, byMA);
}

// Put this near your other helpers:
function clampStopLoss(px, atr, proposed, floorStop = 0) {
  const n = v => Number.isFinite(v) ? v : 0;
  const _px = n(px), _atr = Math.max(n(atr), _px * 0.005, 1e-6);
  const minBuffer = Math.max(_px * 0.002, 0.2 * _atr, 1); // ~0.2 ATR, ≥ ¥1
  // never lower than current floor stop, never at/above market
  let s = Math.max(n(proposed), n(floorStop));
  s = Math.min(s, _px - minBuffer);
  if (!Number.isFinite(s) || s <= 0) s = Math.max(1, n(floorStop)); // last resort
  return Math.round(s);
}

// ---- Regime helpers (match backtest) ----
const DEFAULT_REGIME_TICKER = "1306.T"; // Nikkei 225 ETF proxy
const toISO = (d) => new Date(d).toISOString().slice(0, 10);

function smaArr(arr, p) {
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
 * Compute daily regime labels from candles.
 * - STRONG_UP: px>MA25 & MA25 slope > +0.02%/bar & MA25>MA75
 * - UP:        px>MA25 & slope >= 0
 * - RANGE:     |slope| < 0.02%/bar OR |px-MA25| <= ATR(14)
 * - DOWN:      otherwise
 */
function computeRegimeLabels(candles) {
  if (!Array.isArray(candles) || candles.length < 30) {
    return candles.map(() => "RANGE");
  }
  const closes = candles.map(c => Number(c.close) || 0);
  const ma25 = smaArr(closes, 25);
  const ma75 = smaArr(closes, 75);

  // ATR(14) (simple Wilder-like)
  const atr = (() => {
    if (candles.length < 15) return candles.map(() => 0);
    const out = new Array(candles.length).fill(0);
    for (let i = 1; i < candles.length; i++) {
      const h = Number(candles[i].high ?? candles[i].close ?? 0);
      const l = Number(candles[i].low  ?? candles[i].close ?? 0);
      const pc = Number(candles[i - 1].close ?? 0);
      const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
      if (i < 15) {
        const start = Math.max(1, i - 14);
        let sum = 0;
        for (let k = start; k <= i; k++) {
          const hk = Number(candles[k].high ?? candles[k].close ?? 0);
          const lk = Number(candles[k].low  ?? candles[k].close ?? 0);
          const pck= Number(candles[k - 1]?.close ?? 0);
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
    const px  = closes[i];
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
    const strong  = aboveMA && slope > 0.0002 && Number.isFinite(m75) && m25 > m75;
    const flatish = Math.abs(slope) < 0.0002 || (Number.isFinite(m25) && Math.abs(px - m25) <= a14);

    if (strong) labels.push("STRONG_UP");
    else if (aboveMA && slope >= 0) labels.push("UP");
    else if (flatish) labels.push("RANGE");
    else labels.push("DOWN");
  }
  return labels;
}

function buildRegimeMap(candles) {
  const labels = computeRegimeLabels(candles);
  const map = Object.create(null);
  for (let i = 0; i < candles.length; i++) {
    map[toISO(candles[i].date)] = labels[i];
  }
  return map;
}

function regimeForDate(regimeMap, date) {
  // Try date, then walk back up to 5 days to find last known label
  let d = new Date(date);
  for (let k = 0; k < 6; k++) {
    const key = toISO(d);
    if (regimeMap[key]) return regimeMap[key];
    d.setDate(d.getDate() - 1);
  }
  return "RANGE";
}




/**
 * getTradeManagementSignal_V3 — entry-aware, completed-bars logic
 *
 * What this does:
 * - Uses COMPLETED bars for structure checks (MA25, pivot, patterns). Today’s synthetic/incomplete bar is ignored.
 * - Is ENTRY-AWARE for MA25: if price was already < MA25 at entry, we don’t “punish” later simply for still being < MA25.
 * - Trails/tightens stops with a clamp that never sets stop ≥ market and never loosens below current stop.
 * - Uses ATR/structure (swing low & MA25) for protective stops, with sensible live buffers to avoid hugging price.
 *
 * STATUS LEGEND
 * - "Hold"            → Keep position unchanged (you may persist a suggested stop if present).
 * - "Protect Profit"  → Tighten/raise the stop (we return `updatedStopLoss`); keep holding unless stop is hit.
 * - "Sell Now"        → Exit immediately.
 * - "Scale Partial"   → Take partial profits (e.g., 50%) and trail the remainder.
 *
 * DECISION SEQUENCE (top → bottom)
 *  1) SELL — hard stop hit (px <= stop).
 *  2) SELL — structural breakdown on COMPLETED bars:
 *       last completed close < MA25(completed) AND a new lower low AND bearish context (e.g., senti ≥6, ML weak, short-term downtrend).
 *  3) SCALE/SELL — target reached:
 *       If context strong (senti ≤3, trend OK, not extended, ADX>~25), "Scale Partial" (tighten stop via structure/MA).
 *       Else "Sell Now".
 *  4) PROTECT — R milestones (based on ORIGINAL risk: entry − initialStop):
 *       • ≥ +2R → trail using max(entry + 1.2R, structure/MA stop).
 *       • ≥ +1R → move stop to breakeven.
 *  5) PROTECT — NO PROGRESS (entry-aware, completed bars):
 *       After ≥5 completed bars since entry, if price has NOT touched +0.5R, and progress isn’t clearly negative,
 *       creep stop toward breakeven conservatively using structure/MA with a wider live buffer.
 *  6) HOLD — entry-kind aware (completed bars):
 *       • DIP/RETEST and close ≥ MA25(completed) with non-bearish sentiment (≤4) → Hold.
 *       • BREAKOUT retest holding prior pivot zone on completed bars → Hold.
 *  7) PROTECT — bearish engulfing near resistance:
 *       If near 52-week high and bearish engulfing on completed bars → tighten to structure/MA stop.
 *  8) DEFAULT — structure-first on COMPLETED bars:
 *       • If close ≥ MA25(completed) → Hold (allow normal volatility).
 *       • Else (close < MA25(completed)):
 *            - If price was already < MA25 at entry → Hold (don’t penalize post-entry).
 *            - Otherwise → Protect Profit (tighten to structure/MA stop).
 *
 * Notes:
 * - MA25(completed) = MA using completed bars only; live MA may differ slightly.
 * - `updatedStopLoss` is only returned when tightening (never lowers your current stop).
 * - ADX is computed if not provided; context signals (sentiment/ML/regime) are optional but improve decisions.
 */

// --- Simple scan-time analytics (mirror of backtest bits) ---
function scanAnalytics(stock, historicalData) {
  const data = Array.isArray(historicalData) ? historicalData : [];
  const n = data.length;
  if (!n) return { rsi: null, atrPct: null, volZ: null, gapPct: null, pxVsMA25Pct: null, maStackScore: 0, pxAboveMA25: false, pxAboveMA75: false };

  const close = Number(stock.currentPrice) || Number(data.at(-1)?.close) || 0;
  const prevC = n > 1 ? Number(data[n - 2]?.close) || close : close;
  const ma = (arr, p) => (arr.length >= p ? arr.slice(-p).reduce((a,b)=>a+b,0)/p : NaN);

  const closes = data.map(d=>Number(d.close)||0);
  const vols   = data.map(d=>Number(d.volume)||0);

  // RSI14 (use enriched if present)
  const rsi = Number.isFinite(stock.rsi14) ? stock.rsi14 : (function rsi14(cs){
    if (cs.length < 15) return NaN;
    let g=0,l=0;
    for (let i=cs.length-14;i<cs.length;i++){
      const d=cs[i]-cs[i-1];
      if (d>=0) g+=d; else l-=d;
    }
    const rs = l===0?Infinity:g/l;
    return 100 - 100/(1+rs);
  })(closes);

  // ATR pct (use enriched if present)
  const atrAbs = Number.isFinite(stock.atr14) ? stock.atr14 : calcATR(data,14);
  const atrPct = close ? (atrAbs/close)*100 : 0;

  // Volume Z over 20
  const v20 = vols.slice(-20);
  let volZ = null;
  if (v20.length === 20) {
    const m = v20.reduce((a,b)=>a+b,0)/20;
    const sd = Math.sqrt(v20.reduce((a,b)=>a+(b-m)*(b-m),0)/20);
    volZ = sd>0 ? (vols.at(-1)-m)/sd : 0;
  }

  const gapPct = prevC ? ((close - prevC)/prevC)*100 : 0;

  const ma25 = Number.isFinite(stock.movingAverage25d) ? stock.movingAverage25d : sma(data,25);
  const ma75 = Number.isFinite(stock.movingAverage75d) ? stock.movingAverage75d : sma(data,75);
  const m5   = Number.isFinite(stock.movingAverage5d)  ? stock.movingAverage5d  : sma(data,5);

  const pxVsMA25Pct = Number.isFinite(ma25) && ma25>0 ? ((close - ma25)/ma25)*100 : NaN;

  let maStackScore = 0;
  if (Number.isFinite(m5)  && Number.isFinite(ma25) && m5  > ma25) maStackScore+=1;
  if (Number.isFinite(ma25)&& Number.isFinite(ma75) && ma25> ma75) maStackScore+=1;
  if (Number.isFinite(ma25)&& close>ma25) maStackScore+=1;

  return {
    rsi: Number.isFinite(rsi) ? +rsi.toFixed(2) : null,
    atrPct: Number.isFinite(atrPct) ? +atrPct.toFixed(2) : null,
    volZ: Number.isFinite(volZ) ? +volZ.toFixed(2) : null,
    gapPct: Number.isFinite(gapPct) ? +gapPct.toFixed(2) : null,
    pxVsMA25Pct: Number.isFinite(pxVsMA25Pct) ? +pxVsMA25Pct.toFixed(2) : null,
    maStackScore,
    pxAboveMA25: Number.isFinite(ma25) ? close>ma25 : false,
    pxAboveMA75: Number.isFinite(ma75) ? close>ma75 : false,
  };
}

// --- Same scoring rules you used in backtest.computeScore ---
function computeScanScore({ analytics, regime="RANGE", crossType, crossLag, ST, LT }) {
  let s = 0;
  // Regime: DOWN>UP (STRONG_UP/RANGE neutral) — if you don’t have regime here, this will usually add 0
  if (regime === "DOWN") s += 2;
  else if (regime === "UP") s += 1;

  const lag = Number.isFinite(crossLag) ? crossLag : null;
  if (crossType === "WEEKLY" || crossType === "BOTH") {
    if (lag !== null && lag >= 2) s += 2;
  } else if (crossType === "DAILY") {
    if (lag !== null && lag >= 4) s += 1;
  }

  // Sentiment zones (LT 3–5 bullish; ST 6–7 pullback)
  if (Number.isFinite(LT) && LT >= 3 && LT <= 5) s += 1;
  if (Number.isFinite(ST) && ST >= 6 && ST <= 7) s += 1;

  // Analytics
  const a = analytics || {};
  if (Number.isFinite(a.gapPct) && a.gapPct > 0) s += 1;
  if (Number.isFinite(a.rsi) && a.rsi >= 60) s += 1;
  if (Number.isFinite(a.pxVsMA25Pct) && a.pxVsMA25Pct <= 4) s += 1;
  if (Number.isFinite(a.pxVsMA25Pct) && a.pxVsMA25Pct > 6) s -= 1;

  return s;
}



export function getTradeManagementSignal_V3(
  stock,
  trade,
  historicalData,
  ctx = {}
) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  function clampStopLoss(px, atr, proposed, floorStop = 0) {
    const _px = n(px);
    const _atr = Math.max(n(atr), _px * 0.005, 1e-6);
    const minBuffer = Math.max(_px * 0.002, 0.2 * _atr, 1);
    let s = Math.max(n(proposed), n(floorStop));
    s = Math.min(s, _px - minBuffer);
    if (!Number.isFinite(s) || s <= 0) s = Math.max(1, n(floorStop));
    return Math.round(s);
  }

  const px = n(stock.currentPrice);
  const entry = n(trade.entryPrice);
  const stop = n(trade.stopLoss);
  const target = n(trade.priceTarget);

  const ma25 = n(stock.movingAverage25d) || sma(historicalData, 25);
  const atr = Math.max(
    n(stock.atr14),
    calcATR(historicalData, 14),
    px * 0.005,
    1e-6
  );

  const sentiment = n(ctx.sentimentScore) || 4;
  const ml = n(ctx.deep?.mlScore);
  const adx = Number.isFinite(ctx.adx) ? ctx.adx : calcADX14(historicalData);
  const isExtended = !!ctx.isExtended;

  const initialStop = Number.isFinite(trade.initialStop)
    ? trade.initialStop
    : stop;
  const riskPerShare = Math.max(0.01, entry - initialStop);
  const progressR = (px - entry) / riskPerShare;

  function maAtIndex(data, p, idx) {
    if (!Array.isArray(data) || idx == null) return 0;
    if (idx + 1 < p) return 0;
    let s = 0;
    for (let i = idx - p + 1; i <= idx; i++) s += n(data[i]?.close);
    return s / p;
  }

  let entryIdx = null;
  if (ctx?.entryDate instanceof Date && Array.isArray(historicalData)) {
    for (let i = historicalData.length - 1; i >= 0; i--) {
      const d =
        historicalData[i]?.date instanceof Date
          ? historicalData[i].date
          : new Date(historicalData[i]?.date);
      if (d <= ctx.entryDate) {
        entryIdx = i;
        break;
      }
    }
  } else if (Number.isFinite(ctx?.barsSinceEntry)) {
    entryIdx = Math.max(0, historicalData.length - 2 - ctx.barsSinceEntry);
  }

  const ma25AtEntry = Number.isFinite(entryIdx)
    ? maAtIndex(historicalData, 25, entryIdx)
    : 0;
  const entryCloseApprox = Number.isFinite(entryIdx)
    ? n(historicalData[entryIdx]?.close) || entry
    : entry;

  const nowBelowMA25 = lastClose(historicalData) < ma25 && ma25 > 0;
  const entryWasAbove = ma25AtEntry > 0 && entryCloseApprox >= ma25AtEntry;
  const crossedDownPostEntry = entryWasAbove && nowBelowMA25;
  const belowSinceEntry = !entryWasAbove && nowBelowMA25;

  // 1) Hard stop
  if (px <= stop)
    return {
      status: "Sell Now",
      reason: `Stop-loss hit at ¥${Math.round(stop)}.`,
    };

  // 2) Structural breakdown
  const bearishContext =
    sentiment >= 6 ||
    ml <= -1.5 ||
    (ctx.deep?.shortTermRegime?.type === "TRENDING" &&
      ctx.deep?.shortTermRegime?.characteristics?.includes?.("DOWNTREND"));

  if (nowBelowMA25 && madeLowerLow(historicalData) && bearishContext) {
    return {
      status: "Sell Now",
      reason: "Trend break: close < MA25 with lower low and bearish context.",
    };
  }

  // 3) Target reached
  const strengthOK =
    sentiment <= 3 &&
    (ml >= 1 || ctx.deep?.longTermRegime?.type === "TRENDING") &&
    !isExtended &&
    (adx ? adx > 25 : true);

  if (px >= target) {
    if (strengthOK) {
      const proposed = Math.max(
        stop,
        trailingStructStop(historicalData, ma25, atr)
      );
      const newSL = clampStopLoss(px, atr, proposed, stop);
      return {
        status: "Scale Partial",
        reason: `Target reached (¥${Math.round(
          target
        )}). Context strong — scale 50% and trail the rest. New stop: ¥${newSL}.`,
        updatedStopLoss: newSL,
        suggest: { takeProfitPct: 50 },
      };
    }
    return {
      status: "Sell Now",
      reason: `Take profit at target (¥${Math.round(
        target
      )}). Context not strong enough to extend.`,
    };
  }

  // 4) R milestones
  if (progressR >= 2) {
    const proposed = Math.max(
      stop,
      entry + 1.2 * riskPerShare,
      trailingStructStop(historicalData, ma25, atr)
    );
    const newSL = clampStopLoss(px, atr, proposed, stop);
    return {
      status: "Protect Profit",
      reason: `Up ≥ +2R. Trail with structure/MA25. New stop: ¥${newSL}.`,
      updatedStopLoss: newSL,
    };
  }
  if (progressR >= 1) {
    const proposed = Math.max(stop, entry); // to breakeven
    const newSL = clampStopLoss(px, atr, proposed, stop);
    return {
      status: "Protect Profit",
      reason: `Up ≥ +1R. Move stop to breakeven at ¥${newSL}.`,
      updatedStopLoss: newSL,
    };
  }

  // 4b) No-progress creep (unchanged from prior)
  {
    const NP_BARS = 5;
    const NEED_TOUCH_R = 0.5;
    const halfRLevel = entry + NEED_TOUCH_R * riskPerShare;

    let barsSinceEntry = ctx?.barsSinceEntry ?? null;
    if (
      barsSinceEntry == null &&
      ctx?.entryDate instanceof Date &&
      Array.isArray(historicalData)
    ) {
      const completed = historicalData.slice(0, -1);
      barsSinceEntry = completed.reduce((acc, b) => {
        const d = b?.date instanceof Date ? b.date : new Date(b?.date);
        return acc + (d > ctx.entryDate ? 1 : 0);
      }, 0);
    }

    let win = Array.isArray(historicalData)
      ? historicalData.slice(-NP_BARS - 1, -1)
      : [];
    if (ctx?.entryDate instanceof Date && Array.isArray(historicalData)) {
      const afterEntry = historicalData.filter((b) => {
        const d = b?.date instanceof Date ? b.date : new Date(b?.date);
        return d > ctx.entryDate;
      });
      if (afterEntry.length) win = afterEntry.slice(0, -1);
    }

    const touchedHalfR = (win || []).some(
      (b) => n(b?.high ?? b?.close) >= halfRLevel
    );
    const enoughBars = (barsSinceEntry ?? 0) >= NP_BARS;
    const clearlyRed = progressR < -0.1;

    if (
      enoughBars &&
      !touchedHalfR &&
      progressR < NEED_TOUCH_R &&
      !clearlyRed
    ) {
      const structural = trailingStructStop(historicalData, ma25, atr);
      const creepTarget = Math.min(entry - 0.2 * riskPerShare, entry - 0.01); // ≤ breakeven
      let proposed = Math.max(stop, structural, creepTarget);

      const _atr = Math.max(atr, px * 0.005, 1e-6);
      const creepBuffer = Math.max(px * 0.003, 0.5 * _atr, 1);
      let newSL = Math.max(proposed, stop);
      newSL = Math.min(newSL, px - creepBuffer);
      if (!Number.isFinite(newSL) || newSL <= 0) newSL = stop;

      if (newSL > stop) {
        return {
          status: "Protect Profit",
          reason:
            (barsSinceEntry != null
              ? `No progress since entry (${barsSinceEntry} bars, no +${NEED_TOUCH_R}R touch). `
              : `No progress for ${NP_BARS}+ bars (no +${NEED_TOUCH_R}R touch). `) +
            `Creep stop toward breakeven conservatively. New stop: ¥${Math.round(
              newSL
            )}.`,
          updatedStopLoss: Math.round(newSL),
        };
      }
    }
  }

  // 5) Entry-kind aware holds
  const entryKind = (ctx.entryKind || "").toUpperCase();
  const aboveMA25 = px >= ma25 || ma25 === 0;

  if (
    (entryKind === "DIP" || entryKind === "RETEST") &&
    aboveMA25 &&
    sentiment <= 4
  ) {
    return {
      status: "Hold",
      reason:
        "Healthy pullback above MA25 after DIP/RETEST entry; sentiment not bearish.",
    };
  }
  if (entryKind === "BREAKOUT") {
    const pivot = recentPivotHigh(historicalData);
    const nearPivot = pivot > 0 && Math.abs(px - pivot) <= 1.3 * atr;
    const heldZone =
      pivot > 0 && n(historicalData.at(-1)?.low) >= pivot - 0.6 * atr;
    if (pivot && nearPivot && heldZone) {
      return {
        status: "Hold",
        reason: "Breakout retest holding prior pivot zone.",
      };
    }
  }

  // 6) Bearish engulf near resistance
  const last = historicalData?.at?.(-1) || {};
  const prev = historicalData?.at?.(-2) || {};
  const bearishEngulf =
    n(last.close) < n(last.open) &&
    n(prev.close) > n(prev.open) &&
    n(last.close) < n(prev.open) &&
    n(last.open) > n(prev.close);
  const near52wHigh = near(px, n(stock.fiftyTwoWeekHigh), 0.02);

  if (near52wHigh && bearishEngulf) {
    const proposed = Math.max(
      stop,
      trailingStructStop(historicalData, ma25, atr)
    );
    const newSL = clampStopLoss(px, atr, proposed, stop);
    return {
      status: "Protect Profit",
      reason: `Bearish engulfing near resistance — tighten stop to ¥${newSL}.`,
      updatedStopLoss: newSL,
    };
  }

  // 7) DEFAULT — structure-first, now *conservative* for entries below MA25
  if (px >= ma25 || ma25 === 0) {
    return {
      status: "Hold",
      reason: "Uptrend structure intact (≥ MA25). Allow normal volatility.",
    };
  } else {
    // Cap: before +1R we never raise stop to/above breakeven.
    const allowedMaxStop = progressR >= 1 ? Infinity : entry - 0.01;

    // If we were ABOVE MA25 at entry and crossed down → protect.
    if (crossedDownPostEntry) {
      const proposed = Math.max(
        stop,
        trailingStructStop(historicalData, ma25, atr)
      );
      let newSL = clampStopLoss(px, atr, proposed, stop);
      newSL = Math.min(newSL, allowedMaxStop);
      if (newSL > stop) {
        return {
          status: "Protect Profit",
          reason: `Lost MA25 post-entry — tighten to structure/MA stop at ¥${newSL}.`,
          updatedStopLoss: newSL,
        };
      }
      return {
        status: "Hold",
        reason:
          "Lost MA25 post-entry, but structural stop ≤ current stop. Hold.",
      };
    }

    // If we were already BELOW MA25 at entry → be conservative:
    // Only tighten if (a) progress ≥ +0.5R OR (b) a completed-bar reclaim has occurred.
    const completedReclaim = !nowBelowMA25; // means last completed close ≥ MA25
    if (!completedReclaim && progressR < 0.5) {
      return {
        status: "Hold",
        reason:
          "Below MA25 since entry — no tighten until +0.5R progress or a completed MA25 reclaim.",
      };
    }

    const proposed = Math.max(
      stop,
      trailingStructStop(historicalData, ma25, atr)
    );
    let newSL = clampStopLoss(px, atr, proposed, stop);
    newSL = Math.min(newSL, allowedMaxStop); // don’t creep to breakeven before +1R
    if (newSL > stop) {
      return {
        status: "Protect Profit",
        reason: `Below MA25 since entry but conditions met (progress/reclaim) — tighten to structure/MA stop at ¥${newSL}.`,
        updatedStopLoss: newSL,
      };
    }
    return {
      status: "Hold",
      reason:
        "Below MA25 since entry — conditions not met to tighten yet. Hold.",
    };
  }
}









/* -------------------------------------------
   3) Lightweight technical enrichment
------------------------------------------- */
export function enrichForTechnicalScore(stock) {
  const data = Array.isArray(stock.historicalData) ? stock.historicalData : [];
  if (data.length < 2) return stock;

  const closes = data.map((d) => d.close ?? 0);
  const sma = (arr, p) =>
    arr.length >= p ? arr.slice(-p).reduce((a, b) => a + b, 0) / p : NaN;

  if (!Number.isFinite(stock.movingAverage5d))
    stock.movingAverage5d = sma(closes, 5) || 0;
  if (!Number.isFinite(stock.movingAverage25d))
    stock.movingAverage25d = sma(closes, 25) || 0;
  if (!Number.isFinite(stock.movingAverage75d))
    stock.movingAverage75d = sma(closes, 75) || 0;
  if (!Number.isFinite(stock.movingAverage50d))
    stock.movingAverage50d = sma(closes, 50) || 0;
  if (!Number.isFinite(stock.movingAverage200d))
    stock.movingAverage200d = sma(closes, 200) || 0;

  // OBV + MA20
  let obv = 0;
  const win = [0];
  for (let i = 1; i < data.length; i++) {
    const dir = Math.sign((data[i].close ?? 0) - (data[i - 1].close ?? 0));
    obv += dir * (data[i].volume || 0);
    win.push(obv);
    if (win.length > 20) win.shift();
  }
  if (!Number.isFinite(stock.obv)) stock.obv = obv;
  if (!Number.isFinite(stock.obvMA20) && win.length === 20) {
    stock.obvMA20 = win.reduce((a, b) => a + b, 0) / 20;
  }

  // Bollinger(20)
  if (
    !Number.isFinite(stock.bollingerMid) ||
    !Number.isFinite(stock.bollingerUpper) ||
    !Number.isFinite(stock.bollingerLower)
  ) {
    const p = 20;
    if (closes.length >= p) {
      const recent = closes.slice(-p);
      const mid = recent.reduce((a, b) => a + b, 0) / p;
      const variance = recent.reduce((a, b) => a + (b - mid) ** 2, 0) / p;
      const sd = Math.sqrt(variance);
      stock.bollingerMid = mid;
      stock.bollingerUpper = mid + 2 * sd;
      stock.bollingerLower = mid - 2 * sd;
    }
  }

  // ATR14
  if (!Number.isFinite(stock.atr14) && data.length >= 15) {
    const slice = data.slice(-15);
    let sumTR = 0;
    for (let i = 1; i < slice.length; i++) {
      const c = slice[i],
        p = slice[i - 1];
      const tr = Math.max(
        (c.high ?? c.close) - (c.low ?? c.close),
        Math.abs((c.high ?? c.close) - (p.close ?? c.close)),
        Math.abs((c.low ?? c.close) - (p.close ?? c.close))
      );
      sumTR += tr;
    }
    stock.atr14 = sumTR / 14;
  }

  // Stochastic(14,3)
  if (
    !Number.isFinite(stock.stochasticK) ||
    !Number.isFinite(stock.stochasticD)
  ) {
    const kP = 14,
      dP = 3;
    if (data.length >= kP) {
      const idx = data.length - 1;
      const kVals = [];
      for (let j = dP - 1; j >= 0; j--) {
        const end = idx - j;
        if (end - kP + 1 < 0) continue;
        let hi = -Infinity,
          lo = Infinity;
        for (let i = end - kP + 1; i <= end; i++) {
          hi = Math.max(hi, data[i].high ?? data[i].close);
          lo = Math.min(lo, data[i].low ?? data[i].close);
        }
        const cl = data[end].close ?? 0;
        kVals.push(hi !== lo ? ((cl - lo) / (hi - lo)) * 100 : 50);
      }
      if (!Number.isFinite(stock.stochasticK))
        stock.stochasticK = kVals[kVals.length - 1] ?? 50;
      if (!Number.isFinite(stock.stochasticD)) {
        stock.stochasticD = kVals.length
          ? kVals.reduce((a, b) => a + b, 0) / kVals.length
          : 50;
      }
    }
  }

  // RSI14
  if (!Number.isFinite(stock.rsi14) && closes.length >= 15) {
    let gains = 0,
      losses = 0;
    for (let i = closes.length - 14; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gains += d;
      else losses -= d;
    }
    const avgG = gains / 14,
      avgL = losses / 14;
    const rs = avgL === 0 ? 100 : avgG / avgL;
    stock.rsi14 = 100 - 100 / (1 + rs);
  }

  // MACD(12,26,9)
  if (
    (!Number.isFinite(stock.macd) || !Number.isFinite(stock.macdSignal)) &&
    closes.length >= 26
  ) {
    const ema = (arr, p) => {
      const k = 2 / (p + 1);
      let e = arr.slice(0, p).reduce((a, b) => a + b, 0) / p;
      const out = [e];
      for (let i = p; i < arr.length; i++) {
        e = arr[i] * k + out[out.length - 1] * (1 - k);
        out.push(e);
      }
      return out;
    };
    const ema12 = ema(closes, 12);
    const ema26 = ema(closes, 26);
    const macdLine = ema12
      .slice(ema12.length - ema26.length)
      .map((v, i) => v - ema26[i]);
    const sig = ema(macdLine, 9);
    stock.macd = macdLine[macdLine.length - 1] ?? 0;
    stock.macdSignal = sig[sig.length - 1] ?? 0;
  }

  if (!Number.isFinite(stock.currentPrice) && data.length) {
    stock.currentPrice = data[data.length - 1].close ?? 0;
  }

  return stock;
}

/* -------------------------------------------
   4) Ticker normalization & resolution
------------------------------------------- */

function normalizeTicker(input) {
  if (!input) return null;
  let s = String(input).trim().toUpperCase();
  if (!/\.T$/.test(s)) {
    s = s.replace(/\..*$/, "");
    s = `${s}.T`;
  }
  return s;
}

const allByCode = new Map(allTickers.map((t) => [t.code.toUpperCase(), t]));

function resolveTickers(tickers) {
  if (!Array.isArray(tickers) || tickers.length === 0) {
    log("No tickers passed; scanning default allTickers list");
    return [...allTickers];
  }
  const out = [];
  const seen = new Set();
  for (const raw of tickers) {
    const code = normalizeTicker(raw);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const found = allByCode.get(code);
    out.push(found || { code, sector: "Unknown" });
  }
  log(
    "Resolved tickers:",
    out.map((x) => x.code)
  );
  return out;
}


function extractEntryKindFromReason(reason = "") {
  // reason examples from your entry engine:
  // "DIP ENTRY: ...", "RETEST ENTRY: ...", "MA25 RECLAIM: ...", "INSIDE CONTINUATION: ...", "BREAKOUT: ..."
  const head = String(reason).toUpperCase();
  if (head.startsWith("DIP")) return "DIP";
  if (head.startsWith("RETEST")) return "RETEST";
  if (head.startsWith("MA25 RECLAIM")) return "RECLAIM";
  if (head.startsWith("INSIDE")) return "INSIDE";
  if (head.startsWith("BREAKOUT")) return "BREAKOUT";
  return ""; // unknown/neutral
}


/* -------------------------------------------
   5) Main scan — exportable for server & browser
------------------------------------------- */

/**
 * @param {Object} opts
 * @param {string[]} [opts.tickers=[]]   e.g. ["7203","6758"] (no .T needed)
 * @param {Array} [opts.myPortfolio=[]]  e.g. [{ ticker:"7203.T", trade:{ entryPrice, stopLoss, priceTarget } }]
 * @param {Function} [opts.onItem]       callback per stockObject
 * @returns {Promise<{count:number, errors:string[]}>}
 */
export async function fetchStockAnalysis({
  tickers = [],
  myPortfolio = [],
  onItem,
  regimeTicker = DEFAULT_REGIME_TICKER, // ← add this
} = {}) {
  // Fetch regime reference once
  let regimeMap = null;
  try {
    const ref = await fetchHistoricalData(regimeTicker);
    if (Array.isArray(ref) && ref.length) {
      regimeMap = buildRegimeMap(ref);
      log(`Regime ready from ${regimeTicker} (${ref.length} bars)`);
    } else {
      warn(`Regime disabled: no candles for ${regimeTicker}`);
    }
  } catch (e) {
    warn(
      `Regime disabled: failed to load ${regimeTicker} — ${String(
        e?.message || e
      )}`
    );
  }

  log("Starting scan", { IS_BROWSER, API_BASE });
  const emit = typeof onItem === "function" ? onItem : () => {};
  const errors = [];

  // collect detailed telemetry per item
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
    bySenti: Object.create(null),
    buyBySenti: Object.create(null),
    reasons: {
      buy: Object.create(null),
      noBuy: Object.create(null),
    },
    // NEW: tiers
    tiers: {
      byTier: Object.create(null), // tier -> total scans
      buyByTier: Object.create(null), // tier -> buyNow true
    },
  };

  // Merge requested tickers + any tickers present in the portfolio
  // AFTER:
  const baseTickers =
    Array.isArray(tickers) && tickers.length > 0
      ? tickers
      : allTickers.map((t) => t.code); // seed with full universe when none were passed

  const mergedRawTickers = [
    ...baseTickers,
    ...myPortfolio.map((p) => p?.ticker).filter(Boolean),
  ];
  // Dedup + normalize via resolveTickers (keeps unknowns as {code, sector:"Unknown"})
  const filteredTickers = resolveTickers(mergedRawTickers);
  log(
    "Resolved merged tickers:",
    filteredTickers.map((t) => t.code)
  );
  let count = 0;

  for (const tickerObj of filteredTickers) {
    log(`\n--- Fetching data for ${tickerObj.code} ---`);

    try {
      // 1) fetch fundamentals/technicals snapshot
      const result = await fetchSingleStockData(tickerObj);
      if (!result?.success) {
        const msg = result?.error || "Unknown /api/stocks failure";
        throw new Error(`Yahoo data error: ${msg}`);
      }

      const { code, sector, yahooData } = result.data || {};
      if (!yahooData) throw new Error("Yahoo data missing in payload");

      // quick validation logging
      const critical = ["currentPrice", "highPrice", "lowPrice"];
      const missingCritical = critical.filter((k) => !yahooData[k]);
      if (missingCritical.length) {
        throw new Error(
          `Critical fields missing: ${missingCritical.join(", ")}`
        );
      }
      log(`Yahoo OK for ${code}`);

      // 2) build stock
      const stock = {
        ticker: code,
        sector,
        symbol: yahooData.symbol,
        currency: yahooData.currency,
        shortName: yahooData.shortName,
        currentPrice: yahooData.currentPrice,
        highPrice: yahooData.highPrice,
        lowPrice: yahooData.lowPrice,
        openPrice: yahooData.openPrice,
        prevClosePrice: yahooData.prevClosePrice,
        marketCap: yahooData.marketCap,
        peRatio: yahooData.peRatio,
        pbRatio: yahooData.pbRatio,
        dividendYield: yahooData.dividendYield,
        dividendGrowth5yr: yahooData.dividendGrowth5yr,
        fiftyTwoWeekHigh: yahooData.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: yahooData.fiftyTwoWeekLow,
        epsTrailingTwelveMonths: yahooData.epsTrailingTwelveMonths,
        epsForward: yahooData.epsForward,
        epsGrowthRate: yahooData.epsGrowthRate,
        debtEquityRatio: yahooData.debtEquityRatio,
        movingAverage50d: yahooData.movingAverage50d,
        movingAverage200d: yahooData.movingAverage200d,
        // tech (may be enriched)
        rsi14: yahooData.rsi14,
        macd: yahooData.macd,
        macdSignal: yahooData.macdSignal,
        bollingerMid: yahooData.bollingerMid,
        bollingerUpper: yahooData.bollingerUpper,
        todayVolume: yahooData.todayVolume,
        bollingerLower: yahooData.bollingerLower,
        stochasticK: yahooData.stochasticK,
        stochasticD: yahooData.stochasticD,
        obv: yahooData.obv,
        obvMA20: yahooData.obvMA20,
        atr14: yahooData.atr14,
        enterpriseValue: yahooData.enterpriseValue,
        totalDebt: yahooData.totalDebt,
        totalCash: yahooData.totalCash,
        freeCashflow: yahooData.freeCashflow,
        ebit: yahooData.ebit,
        ebitda: yahooData.ebitda,
        sharesOutstanding: yahooData.sharesOutstanding,
        tangibleBookValue: yahooData.tangibleBookValue,
        evToEbit: yahooData.evToEbit,
        evToEbitda: yahooData.evToEbitda,
        fcfYieldPct: yahooData.fcfYieldPct,
        buybackYieldPct: yahooData.buybackYieldPct,
        shareholderYieldPct: yahooData.shareholderYieldPct,
        ptbv: yahooData.ptbv,
      };

      // 3) history + enrichment
      const historicalData = await fetchHistoricalData(stock.ticker);
      stock.historicalData = historicalData || [];

      // 👇 append synthetic “today” candle if needed (do this FIRST)
      {
        const today = new Date();
        const last = stock.historicalData.at(-1);
        const sameDay =
          last?.date &&
          last.date.getFullYear() === today.getFullYear() &&
          last.date.getMonth() === today.getMonth() &&
          last.date.getDate() === today.getDate();

        if (!sameDay) {
          const o =
            Number(stock.openPrice) ||
            Number(last?.close) ||
            Number(stock.currentPrice);
          const c = Number(stock.currentPrice) || o;
          const h = Math.max(o, c, Number(stock.highPrice) || -Infinity);
          const l = Math.min(o, c, Number(stock.lowPrice) || Infinity);
          const vol = Number(stock.todayVolume) || Number(last?.volume) || 0; // avoid hard zero if you can

          stock.historicalData.push({
            date: today,
            open: o,
            high: h,
            low: l,
            close: c,
            volume: vol,
          });
        }
      }

      // NOW split the views
      const lastIsToday =
        stock.historicalData.length &&
        stock.historicalData.at(-1)?.date?.toDateString?.() ===
          new Date().toDateString();

      const dataForGates = lastIsToday
        ? stock.historicalData.slice(0, -1)
        : stock.historicalData; // completed bars only
      const dataForLevels = stock.historicalData; // includes today

      enrichForTechnicalScore(stock);

      // 4) scores

      // 4) scores (value-first JP)
      // Technicals don’t drive valuation/tier now; keep 0 to be explicit
      stock.technicalScore = 0;
      stock.fundamentalScore = getAdvancedFundamentalScore(stock); // 0..10
      stock.valuationScore = getValuationScore(stock); // 0..10
      stock.tier = getNumericTier(
        {
          technicalScore: stock.technicalScore,
          fundamentalScore: stock.fundamentalScore,
          valuationScore: stock.valuationScore,
          // tiny guards used by getNumericTier anti-trap tweaks:
          debtEquityRatio: stock.debtEquityRatio,
          epsTrailingTwelveMonths: stock.epsTrailingTwelveMonths,
        },
        { mode: "value_only" }
      );
      const quad = classifyValueQuadrant(stock);
      stock.valueQuadrant = quad.label; // "Great & Cheap", etc.
      stock.valueVerdict = quad.verdict; // short text summary

      // 5) sentiment horizons
      const horizons = getComprehensiveMarketSentiment(stock, historicalData);
      stock.shortTermScore = horizons.shortTerm.score;
      stock.longTermScore = horizons.longTerm.score;
      stock.shortTermBias = horizons.shortTerm.label;
      stock.longTermBias = horizons.longTerm.label;
      stock.shortTermConf = horizons.shortTerm.confidence;
      stock.longTermConf = horizons.longTerm.confidence;


      // 6) entry timing
      log("Running swing entry timing…");
      const finalSignal = analyseCrossing(
        { ...stock }, // live px
        dataForLevels, // for RR/headroom etc.
        { debug: true, dataForGates } // hand the completed-bars view to the analyzer
      );

      // --- score (same inputs you used in backtest) ---
      // --- score (same inputs you used in backtest) ---
const ST = stock.shortTermScore;
const LT = stock.longTermScore;

// derive crossType/lag from the analyzer if present
let crossType = null, crossLag = null;
const cm = finalSignal?.meta?.cross || {};
if (cm?.selected) {
  crossType = cm.selected; // "WEEKLY" | "DAILY" | "BOTH"
  crossLag =
    Number.isFinite(cm?.weekly?.barsAgo) && (crossType === "WEEKLY" || crossType === "BOTH")
      ? cm.weekly.barsAgo
      : Number.isFinite(cm?.daily?.barsAgo) && (crossType === "DAILY" || crossType === "BOTH")
      ? cm.daily.barsAgo
      : null;
} else if (cm?.weekly || cm?.daily) {
  crossType = cm.weekly && cm.daily ? "BOTH" : cm.weekly ? "WEEKLY" : "DAILY";
  crossLag = Math.min(
    Number.isFinite(cm.weekly?.barsAgo) ? cm.weekly.barsAgo : Infinity,
    Number.isFinite(cm.daily?.barsAgo) ? cm.daily.barsAgo : Infinity
  );
  if (!Number.isFinite(crossLag)) crossLag = null;
}

const analytics = scanAnalytics(stock, dataForLevels);

// Pick the date we want the regime for: last *completed* bar if available,
// otherwise fall back to the latest bar we have.
const regimeDate =
  (dataForGates?.length ? dataForGates.at(-1)?.date : null) ||
  stock.historicalData.at(-1)?.date;

const dayRegime = regimeMap ? regimeForDate(regimeMap, regimeDate) : "RANGE";

const score = computeScanScore({
  analytics,
  regime: dayRegime,
  crossType,
  crossLag,
  ST,
  LT,
});

// keep on the stock for Bubble/UI
stock.sentimentComboRank = score;
stock.marketRegime = dayRegime;
stock._scoreAnalytics = analytics;
stock._scoreCross = { crossType, crossLag };

      // keep detailed telemetry for session-level diagnostics
      if (finalSignal?.telemetry) {
        teleList.push(finalSignal.telemetry);
        // merge histograms
        const t = finalSignal.telemetry?.histos || {};
        for (const [k, v] of Object.entries(t.slopeBuckets || {})) {
          histo.slopeBuckets[k] = (histo.slopeBuckets[k] || 0) + v;
        }
        if (Array.isArray(t.rrShortfall))
          histo.rrShortfall.push(...t.rrShortfall);
        if (Array.isArray(t.headroom)) histo.headroom.push(...t.headroom);
        if (Array.isArray(t.distMA25)) histo.distMA25.push(...t.distMA25);
        // NEW: merge numeric distros
        const d = finalSignal.telemetry?.distros || {};
        for (const key of Object.keys(distro)) {
          if (Array.isArray(d[key])) distro[key].push(...d[key]);
        }
      }

      log("Swing entry timing done");

      stock.isBuyNow = finalSignal.buyNow;
      stock.buyNowReason = finalSignal.reason;

      // NEW: tier aggregation
      const tierKey = String(Number.isFinite(stock.tier) ? stock.tier : "na");
      inc(summary.tiers.byTier, tierKey);
      if (stock.isBuyNow) inc(summary.tiers.buyByTier, tierKey);

      // NEW: summary update
      summary.totals.count += 1;
      const k = sentiKey(stock.shortTermScore, stock.longTermScore);
      inc(summary.bySenti, k);
      if (stock.isBuyNow) {
        summary.totals.buyNow += 1;
        inc(summary.buyBySenti, k);
        inc(summary.reasons.buy, normalizeReason(stock.buyNowReason));
      } else {
        summary.totals.noBuy += 1;
        inc(summary.reasons.noBuy, normalizeReason(finalSignal.reason));
      }

      // Normalize + mirror (handles both buyNow true/false)
      // Normalize suggested values from entry engine (for NEW entries)
      const suggestedSL = finalSignal.smartStopLoss ?? finalSignal.stopLoss;
      const suggestedTP =
        finalSignal.smartPriceTarget ?? finalSignal.priceTarget;

      // Always keep trigger for UI insight
      stock.trigger = finalSignal.trigger ?? null;

      // IMPORTANT: if the ticker is already in portfolio, do NOT loosen stop/target
      const portfolioEntry = myPortfolio.find((p) => p.ticker === stock.ticker);

      if (portfolioEntry) {
        const curStop = Number(portfolioEntry?.trade?.stopLoss);
        const curTarget = Number(
          portfolioEntry?.trade?.priceTarget ??
            portfolioEntry?.trade?.targetPrice
        );

        // STOP: only tighten upward; if no suggestion, keep current
        const tightenedStop = Number.isFinite(suggestedSL)
          ? Math.max(curStop, Math.round(suggestedSL))
          : curStop;

        // TARGET: only keep or raise; never reduce
        const keptOrRaisedTarget = Number.isFinite(suggestedTP)
          ? Number.isFinite(curTarget)
            ? Math.max(curTarget, Math.round(suggestedTP))
            : Math.round(suggestedTP)
          : curTarget;

        stock.smartStopLoss = tightenedStop;
        stock.stopLoss = tightenedStop;

        stock.smartPriceTarget = keptOrRaisedTarget;
        stock.targetPrice = keptOrRaisedTarget;
        stock.priceTarget = keptOrRaisedTarget;
      } else {
        // Not held: free to use analyzer suggestions as-is
        if (Number.isFinite(suggestedSL)) {
          stock.smartStopLoss = Math.round(suggestedSL);
          stock.stopLoss = stock.smartStopLoss;
        }
        if (Number.isFinite(suggestedTP)) {
          stock.smartPriceTarget = Math.round(suggestedTP);
          stock.targetPrice = stock.smartPriceTarget;
          stock.priceTarget = stock.smartPriceTarget;
        }
      }

      // 7) trade management if held
      if (portfolioEntry) {
        // Try to infer entry kind from your entry engine's reason text, if present
        const entryKind = extractEntryKindFromReason(finalSignal?.reason); // DIP / RETEST / RECLAIM / INSIDE / BREAKOUT
        // --- NEW: safely parse purchase date (entryDate) if provided ---
        // Expecting ISO string (e.g., "2025-10-07") or anything Date can parse.
        let entryDate = null;
        const rawED = portfolioEntry?.trade?.entryDate;
        if (rawED) {
          const d = new Date(rawED);
          if (!Number.isNaN(d.getTime())) entryDate = d;
        }

        // --- NEW: compute barsSinceEntry on COMPLETED bars only (dataForGates) ---
        // We count trading bars whose date > entryDate.
        let barsSinceEntry = null;
        if (entryDate && Array.isArray(dataForGates) && dataForGates.length) {
          const lastCompleted = dataForGates;
          barsSinceEntry = lastCompleted.reduce((acc, b) => {
            const bd = b?.date instanceof Date ? b.date : new Date(b?.date);
            return acc + (bd > entryDate ? 1 : 0);
          }, 0);
        }

        const mgmt = getTradeManagementSignal_V3(
          stock,
          {
            ...portfolioEntry.trade,
            // helps V3 compute R progress correctly even if stopLoss has been trailed
            initialStop:
              portfolioEntry.trade.initialStop ?? portfolioEntry.trade.stopLoss,
          },
          historicalData,
          {
            entryKind, // optional but helpful
            sentimentScore: stock.shortTermScore, // your 1..7 short-term score
            entryDate, // NEW: pass purchase date
            barsSinceEntry, // NEW: pass computed bars since entry (completed bars)
            // deep is optional; if your orchestrator exposes it, pass it:
            // deep: horizons.deep,
            // ADX is optional; V3 computes fallback if omitted
            isExtended:
              Number.isFinite(stock.bollingerMid) && stock.bollingerMid > 0
                ? (stock.currentPrice - stock.bollingerMid) /
                    stock.bollingerMid >
                  0.15
                : false,
          }
        );

        stock.managementSignalStatus = mgmt.status;
        stock.managementSignalReason = mgmt.reason;

        // If V3 suggests a tighter stop, surface it (without overwriting your portfolio by force)
        if (Number.isFinite(mgmt.updatedStopLoss)) {
          const proposed = Math.round(mgmt.updatedStopLoss);
          const current = Number(stock.stopLoss) || 0;
          // Only accept if it tightens (raises) versus current displayed stop
          if (proposed > current) {
            stock.managementUpdatedStop = proposed;
            stock.smartStopLoss = proposed;
            stock.stopLoss = proposed;
          }
        }
        // NOTE: do not lower target here; leave target untouched by management
      } else {
        stock.managementSignalStatus = null;
        stock.managementSignalReason = null;
      }

      // 8) Bubble-friendly payload
      const stockObject = {
        _api_c2_ticker: stock.ticker,
        _api_c2_sector: stock.sector,
        _api_c2_currentPrice: stock.currentPrice,
        _api_c2_shortTermScore: stock.shortTermScore,
        _api_c2_longTermScore: stock.longTermScore,
        _api_c2_prediction: stock.prediction,
        _api_c2_stopLoss: stock.stopLoss,
        _api_c2_targetPrice: stock.targetPrice,
        _api_c2_growthPotential: stock.growthPotential,
        _api_c2_score: stock.score,
        _api_c2_trigger: stock.trigger,
        _api_c2_finalScore: stock.finalScore,
        _api_c2_tier: stock.tier,
        _api_c2_smartStopLoss: stock.smartStopLoss,
        _api_c2_smartPriceTarget: stock.smartPriceTarget,
        _api_c2_limitOrder: stock.limitOrder,
        _api_c2_isBuyNow: stock.isBuyNow,
        _api_c2_buyNowReason: stock.buyNowReason,
        _api_c2_sentimentComboRank: stock.sentimentComboRank,
        _api_c2_managementSignalStatus: stock.managementSignalStatus,
        _api_c2_managementSignalReason: stock.managementSignalReason,
        _api_c2_otherData: JSON.stringify({
          highPrice: stock.highPrice,
          lowPrice: stock.lowPrice,
          openPrice: stock.openPrice,
          prevClosePrice: stock.prevClosePrice,
          marketCap: stock.marketCap,
          peRatio: stock.peRatio,
          pbRatio: stock.pbRatio,
          dividendYield: stock.dividendYield,
          dividendGrowth5yr: stock.dividendGrowth5yr,
          fiftyTwoWeekHigh: stock.fiftyTwoWeekHigh,
          fiftyTwoWeekLow: stock.fiftyTwoWeekLow,
          epsTrailingTwelveMonths: stock.epsTrailingTwelveMonths,
          epsForward: stock.epsForward,
          epsGrowthRate: stock.epsGrowthRate,
          debtEquityRatio: stock.debtEquityRatio,
          movingAverage50d: stock.movingAverage50d,
          movingAverage200d: stock.movingAverage200d,
          rsi14: stock.rsi14,
          macd: stock.macd,
          macdSignal: stock.macdSignal,
          bollingerMid: stock.bollingerMid,
          bollingerUpper: stock.bollingerUpper,
          bollingerLower: stock.bollingerLower,
          stochasticK: stock.stochasticK,
          stochasticD: stock.stochasticD,
          obv: stock.obv,
          atr14: stock.atr14,
          technicalScore: stock.technicalScore,
          fundamentalScore: stock.fundamentalScore,
          valuationScore: stock.valuationScore,
        }),
      };

      // emit per item (Bubble in browser; array collector on server)
      emit(stockObject);
      log(`📤 Emitted ${stock.ticker}`);
      count += 1;
    } catch (err) {
      errorLog(`❌ Error processing ${tickerObj.code}:`, err?.message || err);
      errors.push(`Ticker ${tickerObj.code}: ${err?.message || err}`);
    }
  }

  log("Scan complete", { count, errorsCount: errors.length });

  // NEW: derive buy-rate by tier
  const tierRows = Object.keys(summary.tiers.byTier)
    .map((tier) => {
      const tot = summary.tiers.byTier[tier] || 0;
      const buys = summary.tiers.buyByTier[tier] || 0;
      const buyRate = tot ? Math.round((buys / tot) * 10000) / 100 : 0;
      return { tier, total: tot, buys, buyRatePct: buyRate };
    })
    .sort((a, b) => b.buyRatePct - a.buyRatePct || b.total - a.total);

  // derive buy-rate by sentiment combo
  const sentiRows = Object.keys(summary.bySenti)
    .map((key) => {
      const tot = summary.bySenti[key] || 0;
      const buys = summary.buyBySenti[key] || 0;
      const buyRate = tot ? Math.round((buys / tot) * 10000) / 100 : 0;
      return { combo: key, total: tot, buys, buyRatePct: buyRate };
    })
    .sort((a, b) => b.buyRatePct - a.buyRatePct || b.total - a.total);

  // top reasons (take top 10 each)
  function topK(obj, k = 10) {
    return Object.entries(obj)
      .map(([reason, cnt]) => ({ reason, count: cnt }))
      .sort((a, b) => b.count - a.count)
      .slice(0, k);
  }

  // session-level block breakdowns & histograms
  const blocksTop = summarizeBlocks(teleList); // [{code,count,examples,ctxSample}]
  // optional: RR shortfall binning for a quick “how far off” view
  const rrShortBins = histo.rrShortfall.reduce((m, r) => {
    const s = Number(r.short) || 0;
    const key =
      s <= 0.05
        ? "≤0.05"
        : s <= 0.1
        ? "0.05..0.10"
        : s <= 0.25
        ? "0.10..0.25"
        : ">0.25";
    m[key] = (m[key] || 0) + 1;
    return m;
  }, {});

  const summaryOut = {
    ...summary,
    sentiTable: sentiRows,
    tierTable: tierRows,
    topReasons: {
      buy: topK(summary.reasons.buy, 10),
      noBuy: topK(summary.reasons.noBuy, 10),
    },
    // NEW: detailed diagnostics (compact)
    debug: {
      blocksTop, // grouped “why blocked” with examples
      slopeBuckets: histo.slopeBuckets,
      rrShortfallBins: rrShortBins,
      headroomSample: histo.headroom.slice(0, 50), // keep small samples in console
      distMA25Sample: histo.distMA25.slice(0, 50),
      distroSample: Object.fromEntries(
        Object.entries(distro).map(([k, arr]) => [k, arr.slice(0, 100)])
      ),
    },
  };
  // after building summaryOut:
  summaryOut.totals.buyRatePct = summaryOut.totals.count
    ? Math.round((summaryOut.totals.buyNow / summaryOut.totals.count) * 10000) /
      100
    : 0;

  // console snapshot
  // single, complete object in console
  log("SESSION SUMMARY", summaryOut);

  // expose
  return { count, errors, summary: summaryOut };
}

/* -------------------------------------------
   6) Browser adapter (Bubble)
------------------------------------------- */
if (IS_BROWSER) {
  window.scan = {
    /**
     * @param {string[]} tickerList e.g. ["7203","6758"]
     * @param {Array} myPortfolio   e.g. [{ ticker:"7203.T", trade:{ entryPrice, stopLoss, priceTarget } }]
     */
    async fetchStockAnalysis(tickerList = [], myPortfolio = []) {
      log("window.scan.fetchStockAnalysis called", {
        tickerList,
        myPortfolioLen: myPortfolio.length,
      });
      try {
        await fetchStockAnalysis({
          tickers: tickerList,
          myPortfolio,
          onItem: (obj) => {
            try {
              // Provided by Bubble runtime
              bubble_fn_result(obj);
              log("bubble_fn_result OK for", obj?._api_c2_ticker);
            } catch (e) {
              errorLog("bubble_fn_result not available or failed:", e);
            }
          },
        });
      } finally {
        try {
          // Provided by Bubble runtime
          bubble_fn_finish();
          log("bubble_fn_finish called");
        } catch (e) {
          errorLog("bubble_fn_finish not available or failed:", e);
        }
      }
    },
  };
}
