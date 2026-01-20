// public/scripts/main.js
// ESM module used by both the browser and the /api/scan serverless function.
// - Browser: call window.scan.fetchStockAnalysis(tickers, myPortfolio)
// - Server:  /api/scan imports this file and calls fetchStockAnalysis({ ... })
//   (no Bubble calls are made on the server)
//
// NOTE: API base is fixed and DEBUG is always true per your request.

import { getComprehensiveMarketSentiment } from "./marketSentimentOrchestrator.js";

import { summarizeBlocks, analyzeDipEntry } from "./swingTradeEntryTiming.js";
import {
  getAdvancedFundamentalScore, // alias of getQualityScore
  getValuationScore,
  getNumericTier,
  classifyValueQuadrant,
} from "./techFundValAnalysis.js";
import { allTickers } from "./tickers.js";
import { analyzeSectorRotation } from "./sectorRotationMonitor.js";
import { buildSectorRotationDashboardBubbleEmbed } from "./buildSectorRotationDashboardBubbleEmbed.js";


// ANCHOR: LIQ_HELPERS
function formatKMB(n) {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
  if (a >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (a >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return String(Math.round(v));
}
function formatJPYKMB(n) {
  return "¥" + formatKMB(n);
}


/* -------------------------------------------
   0) Constants + tiny logging helper
------------------------------------------- */
const IS_BROWSER =
  typeof window !== "undefined" &&
  typeof document !== "undefined" &&
  !!(window.document && window.document.nodeType === 9);

// 👇 Stable project domain from Vercel → Settings → Domains
const PROJECT_BASE = "https://stock-analysis-chi.vercel.app";

const isoDay = (d) => new Date(d).toISOString().slice(0, 10);


// Use stable domain in browser, deployment URL on server (if available)
const API_BASE = IS_BROWSER
  ? PROJECT_BASE
  : process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : PROJECT_BASE;

const DEBUG = true;

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

function normalizeReason(reasonRaw) {
  if (!reasonRaw) return "unspecified";
  let r = String(reasonRaw).trim();
  // unify common prefixes and noisy details
  r = r.replace(/^(DIP|SPC|OXR|BPB|RRP)\s+(not ready:|guard veto:)\s*/i, "");
  r = r.replace(/\([^)]*\)/g, ""); // drop parentheticals
  r = r.replace(/\s{2,}/g, " ").trim();
  return r.toLowerCase();
}


function toFinite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}


/* -------------------------------------------
   1) Yahoo / API helpers
------------------------------------------- */

async function fetchSingleStockData(tickerObj) {
  const url = `${API_BASE}/api/stocks`;
  log(`POST ${url}`, { payload: { ticker: tickerObj } });

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker: tickerObj }),
  });

  // Always read body as text first for better error visibility
  const text = await response.text();

  if (!response.ok) {
    const snippet = text.slice(0, 300);
    throw new Error(
      `fetchSingleStockData: HTTP ${response.status} for ${tickerObj?.code} — ${snippet}`
    );
  }

  const data = safeJsonParse(text);
  if (!data) {
    throw new Error(
      `fetchSingleStockData: invalid JSON for ${tickerObj?.code}`
    );
  }

  if (!data.success) {
    throw new Error(
      `fetchSingleStockData: API error for ${tickerObj?.code}: ${
        data.error || "unknown error"
      }`
    );
  }

  log("stocks response OK", {
    code: tickerObj?.code,
    success: data?.success,
  });
  return data;
}

async function fetchHistoricalData(ticker) {
  const url = `${API_BASE}/api/history?ticker=${encodeURIComponent(ticker)}`;
  log(`GET ${url}`);

  const response = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  const text = await response.text();

  if (!response.ok) {
    const snippet = text.slice(0, 300);
    throw new Error(
      `fetchHistoricalData: HTTP ${response.status} for ${ticker} — ${snippet}`
    );
  }

  const result = safeJsonParse(text);
  if (!result) {
    throw new Error(`fetchHistoricalData: invalid JSON for ${ticker}`);
  }

  if (!result.success) {
    throw new Error(
      `fetchHistoricalData: API error for ${ticker}: ${
        result.error || "history: success=false"
      }`
    );
  }

  if (!Array.isArray(result.data) || result.data.length === 0) {
    // Empty history is not tradable, treat as hard failure so upstream catch()
    // can record it in errors[] and skip polluted math.
    throw new Error(`fetchHistoricalData: no historical data for ${ticker}`);
  }

  const mapped = result.data.map((item) => ({
    ...item,
    date: new Date(item.date),
  }));
  log(`history OK for ${ticker} — ${mapped.length} bars`);
  return mapped;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

/**
 * Fetch sector rotation + build Bubble HTML embed.
 * - Safe to call from browser or server
 * - Does NOT call bubble_fn_sector itself (we do that in the browser adapter)
 */

// ---- Regime helpers (match backtest) ----
const DEFAULT_REGIME_TICKER = "1306.T"; // Nikkei 225 ETF proxy


export async function fetchSectorRotationEmbed({
  regimeTicker = DEFAULT_REGIME_TICKER, // use same benchmark as your scan
  title = "JP Sector Rotation (Swing Dashboard)",
} = {}) {
  // sectorRotationMonitor should internally know the sector pools + weights
  // These options are safe even if your function ignores unknown keys.
const sectorRotationResult = await analyzeSectorRotation({
  benchmarkTicker: regimeTicker,
  swingBars: 8,
  weightMode: "auto",
  concurrency: 6,
  breadthMode: "equal",
});


  const { bubbleHtmlCode } = buildSectorRotationDashboardBubbleEmbed(
    sectorRotationResult,
    {
      title,
      defaultView: "cards",
      showExplainPanel: true,
    }
  );

  return { sectorRotationResult, bubbleHtmlCode };
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
    const h = Number(data[i]?.high ?? data[i]?.close ?? 0);
    const l = Number(data[i]?.low ?? data[i]?.close ?? 0);
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

// Last swing low (simple pivot scan on recent window)
function lastSwingLow(data) {
  if (!Array.isArray(data) || data.length < 5) return 0;
  const w = data.slice(-40);
  for (let i = w.length - 3; i >= 2; i--) {
    const l = Number(w[i]?.low ?? w[i]?.close ?? 0);
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
    const li = Number(w[i]?.low ?? w[i]?.close ?? Infinity);
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
  return Math.max(...win.map((d) => Number(d?.high ?? d?.close ?? 0)));
}

// Structural trailing stop: behind last swing low and/or under MA25
function trailingStructStop(historicalData, ma25, atr) {
  const swing = lastSwingLow(historicalData);
  const bySwing = swing - 0.5 * atr;
  const byMA = ma25 > 0 ? ma25 - 0.6 * atr : -Infinity;
  return Math.max(bySwing, byMA);
}


function inferTickFromPrice(p) {
  if (p >= 5000) return 1;
  if (p >= 1000) return 0.5;
  if (p >= 100) return 0.1;
  if (p >= 10) return 0.05;
  return 0.01;
}
function toTick(v, priceRefOrStock) {
  const p =
    typeof priceRefOrStock === "number"
      ? priceRefOrStock
      : Number(priceRefOrStock?.currentPrice) || Number(v) || 0;
  const tick =
    Number(priceRefOrStock?.tickSize) || inferTickFromPrice(p) || 0.1;
  const q = Math.round((Number(v) || 0) / tick);
  return Number((q * tick).toFixed(6));
}




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
 * (Long commentary preserved as in your version. Not repeating it here.)
 */
function scanAnalytics(stock, historicalData) {
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
  const ma = (arr, p) =>
    arr.length >= p ? arr.slice(-p).reduce((a, b) => a + b, 0) / p : NaN;

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
const deep = (ctx && typeof ctx === "object" ? ctx.deep : null) || {};
const iReg =
  (deep && typeof deep === "object" ? deep.intermediateRegime : null) || null;
const bearishContext =
  sentiment >= 6 ||
  ml <= -1.5 ||
  (iReg &&
    iReg.type === "TRENDING" &&
    Array.isArray(iReg.characteristics) &&
    iReg.characteristics.includes("DOWNTREND"));


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

  // 4b) No-progress creep
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

  // 7) DEFAULT — structure-first, conservative for entries below MA25
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
 * @returns {Promise<{count:number, errors:string[], summary:Object}>}
 */
export async function fetchStockAnalysis({
  tickers = [],
  myPortfolio = [],
  onItem,
  regimeTicker = DEFAULT_REGIME_TICKER,
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
  const baseTickers =
    Array.isArray(tickers) && tickers.length > 0
      ? tickers
      : allTickers.map((t) => t.code); // seed with full universe when none were passed

  const mergedRawTickers = [
    ...baseTickers,
    ...myPortfolio.map((p) => p?.ticker).filter(Boolean),
  ];

  // Dedup + normalize via resolveTickers
  const filteredTickers = resolveTickers(mergedRawTickers);
  log(
    "Resolved merged tickers:",
    filteredTickers.map((t) => t.code)
  );
  let count = 0;

  // --- Market context series (same ticker as regime by default) ---
  let marketLevels = null;
  let marketGates = null;

  try {
    const marketHist = await fetchHistoricalData(regimeTicker); // reuse 1306.T history

    // Try to get today's open/high/low/current so we can build a synthetic "today" candle
    // (same as you do for each stock)
    let marketSnap = null;
    try {
      const snapRes = await fetchSingleStockData({
        code: regimeTicker,
        sector: "Market",
      });
      marketSnap = snapRes?.data?.yahooData || null;
    } catch (e) {
      warn(
        `Market snapshot failed for ${regimeTicker} (ok to ignore): ${
          e?.message || e
        }`
      );
    }

    const marketSeries = [...marketHist];

    // Append synthetic today candle if we have a snapshot and history doesn't already contain today
    if (marketSnap) {
      const today = new Date();
      const last = marketSeries.at(-1);

      const sameDay =
        last?.date &&
        last.date.getFullYear() === today.getFullYear() &&
        last.date.getMonth() === today.getMonth() &&
        last.date.getDate() === today.getDate();

      if (!sameDay) {
        const o =
          Number(marketSnap.openPrice) ||
          Number(last?.close) ||
          Number(marketSnap.currentPrice) ||
          0;
        const c = Number(marketSnap.currentPrice) || o;
        const h = Math.max(o, c, Number(marketSnap.highPrice) || -Infinity);
        const l = Math.min(o, c, Number(marketSnap.lowPrice) || Infinity);
        const vol = Number.isFinite(marketSnap.todayVolume)
          ? Number(marketSnap.todayVolume)
          : undefined;

        marketSeries.push({
          date: today,
          open: o,
          high: h,
          low: l,
          close: c,
          volume: vol,
        });
      }
    }



    marketLevels = marketSeries;
    marketGates =
      marketSeries.length > 1 ? marketSeries.slice(0, -1) : marketSeries;


    log(`Market context ready from ${regimeTicker}`, {
      barsLevels: marketLevels.length,
      barsGates: marketGates.length,
      lastDate: marketLevels.at(-1)?.date,
    });
  } catch (e) {
    warn(
      `Market context disabled: failed to load ${regimeTicker} — ${
        e?.message || e
      }`
    );
  }

  for (const tickerObj of filteredTickers) {
    log(`\n--- Fetching data for ${tickerObj.code} ---`);

    try {
      // 1) fundamentals/technicals snapshot
      const result = await fetchSingleStockData(tickerObj);
      if (!result?.success) {
        const msg = result?.error || "Yahoo data error: success=false";
        throw new Error(msg);
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
        // 👇 NEW
        nextEarningsDateIso: yahooData.nextEarningsDateIso ?? null,
        nextEarningsDateFmt: yahooData.nextEarningsDateFmt ?? null,
      };

      // 3) history + enrichment
      const historicalData = await fetchHistoricalData(stock.ticker);
      stock.historicalData = historicalData || [];

      // append synthetic "today" candle if needed
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
          const vol =
            Number.isFinite(stock.todayVolume) && stock.todayVolume > 0
              ? Number(stock.todayVolume)
              : Number.isFinite(last?.volume) && last.volume > 0
              ? Number(last.volume)
              : undefined; // leave undefined so indicators can skip it gracefully

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


      const dataForLevels = stock.historicalData; // includes today (synthetic)
      const dataForGates = stock.historicalData.slice(0, -1); // completed bars only

      enrichForTechnicalScore(stock);

      // 4) scores (value-first JP)
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

      // derive score
      const ST = stock.shortTermScore;
      const LT = stock.longTermScore;

      // 6) entry timing
      log("Running swing entry timing…");
      const finalSignal = analyzeDipEntry({ ...stock }, dataForLevels, {
        debug: true,
        dataForGates,
        sentiment: { ST, LT },
        market:
          marketLevels && marketGates
            ? {
                ticker: regimeTicker,
                dataForLevels: marketLevels,
                dataForGates: marketGates,
              }
            : null,
      });

      // ANCHOR: LIQ_CAPTURE
      const liq = finalSignal?.liquidity || null;
      stock._liquidity = liq; // keep on stock for any downstream use

      // capture MA stacking flip “bars ago” for downstream/UI
      const flipBarsAgo = Number.isFinite(finalSignal?.flipBarsAgo)
        ? finalSignal.flipBarsAgo
        : null;
      stock.flipBarsAgo = flipBarsAgo;

      // capture last GOLDEN CROSS (25>75) “bars ago”
      const goldenCrossBarsAgo = Number.isFinite(
        finalSignal?.goldenCrossBarsAgo
      )
        ? finalSignal.goldenCrossBarsAgo
        : null;
      stock.goldenCrossBarsAgo = goldenCrossBarsAgo;

      const analytics = scanAnalytics(stock, dataForLevels);

      // Pick the date we want the regime for: last *completed* bar if available,
      // otherwise fall back to the latest bar we have.
      const regimeDate =
        (dataForGates?.length ? dataForGates.at(-1)?.date : null) ||
        stock.historicalData.at(-1)?.date;

      const dayRegime = regimeMap
        ? regimeForDate(regimeMap, regimeDate)
        : "RANGE";

      stock.marketRegime = dayRegime;
      stock._scoreAnalytics = analytics;

      // collect detailed telemetry per item
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

        // merge numeric distros
        const d = finalSignal.telemetry?.distros || {};
        for (const key of Object.keys(distro)) {
          if (Array.isArray(d[key])) distro[key].push(...d[key]);
        }
      }

      log("Swing entry timing done");

      stock.isBuyNow = finalSignal.buyNow;
      stock.buyNowReason = finalSignal.reason;
      stock.limitBuyOrder = Number.isFinite(finalSignal?.limitBuyOrder)
        ? finalSignal.limitBuyOrder
        : null;


      // tier aggregation
      const tierKey = String(Number.isFinite(stock.tier) ? stock.tier : "na");
      inc(summary.tiers.byTier, tierKey);
      if (stock.isBuyNow) inc(summary.tiers.buyByTier, tierKey);

      // summary update
      summary.totals.count += 1;
      if (stock.isBuyNow) {
        summary.totals.buyNow += 1;
        inc(summary.reasons.buy, normalizeReason(stock.buyNowReason));
      } else {
        summary.totals.noBuy += 1;
        inc(summary.reasons.noBuy, normalizeReason(finalSignal.reason));
      }

      // Normalize + mirror stop/target logic — CANONICAL: stopLoss, priceTarget (no fallbacks)
      const suggestedSL = Number(finalSignal.stopLoss);
      const suggestedTP = Number(finalSignal.priceTarget);

      stock.trigger = finalSignal.trigger ?? null;

      const portfolioEntry = myPortfolio.find(
        (p) => normalizeTicker(p?.ticker) === normalizeTicker(stock.ticker)
      );

      if (portfolioEntry) {
        const curStop = Number(portfolioEntry?.trade?.stopLoss);
        const curTarget = Number(portfolioEntry?.trade?.priceTarget);

        // STOP: only tighten (raise)
        const newStop = Number.isFinite(suggestedSL)
          ? Math.max(curStop, toTick(suggestedSL, stock))
          : curStop;

        // TARGET: only keep or raise
        const newTarget = Number.isFinite(suggestedTP)
          ? Number.isFinite(curTarget)
            ? Math.max(curTarget, toTick(suggestedTP, stock))
            : toTick(suggestedTP, stock)
          : curTarget;

        stock.stopLoss = Number.isFinite(newStop) ? newStop : undefined;
        stock.priceTarget = Number.isFinite(newTarget) ? newTarget : undefined;
      } else {
        if (Number.isFinite(suggestedSL)) {
          stock.stopLoss = toTick(suggestedSL, stock);
        }
        if (Number.isFinite(suggestedTP)) {
          stock.priceTarget = toTick(suggestedTP, stock);
        }
      }

      // 7) trade management if held
      if (portfolioEntry) {
        const entryKind = extractEntryKindFromReason(finalSignal?.reason); // DIP / RETEST / RECLAIM / INSIDE / BREAKOUT

        // parse possible entryDate from portfolio
        let entryDate = null;
        const rawED = portfolioEntry?.trade?.entryDate;
        if (rawED) {
          const d = new Date(rawED);
          if (!Number.isNaN(d.getTime())) entryDate = d;
        }

        // compute barsSinceEntry on COMPLETED bars only (dataForGates)
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
            // helps V3 compute R progress correctly even if stopLoss was trailed
            initialStop:
              portfolioEntry.trade.initialStop ?? portfolioEntry.trade.stopLoss,
          },
          historicalData,
          {
            entryKind,
            sentimentScore: stock.shortTermScore,
            entryDate,
            barsSinceEntry,
            deep: horizons?.deep || {}, // ensure object, not undefined
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

        // If V3 suggests a tighter stop, surface it (canonical: stopLoss only)
        if (Number.isFinite(mgmt.updatedStopLoss)) {
          const proposed = Math.round(mgmt.updatedStopLoss);
          const current = Number(stock.stopLoss) || 0;
          if (proposed > current) {
            stock.stopLoss = proposed;
          }
        }
        // Don't lower target here
      } else {
        stock.managementSignalStatus = null;
        stock.managementSignalReason = null;
      }

      // 🔍 DEBUG: log what we're about to send to Bubble for earnings date
      log("Earnings date for Bubble payload", {
        ticker: stock.ticker,
        nextEarningsDateIso: stock.nextEarningsDateIso,
        nextEarningsDateFmt: stock.nextEarningsDateFmt,
      });

      // 8) Bubble-friendly payload
      const stockObject = {
        _api_c2_ticker: stock.ticker,
        _api_c2_sector: stock.sector,
        _api_c2_currentPrice: stock.currentPrice,
        _api_c2_shortTermScore: stock.shortTermScore,
        _api_c2_longTermScore: stock.longTermScore,
        _api_c2_stopLoss: stock.stopLoss,
        _api_c2_priceTarget: stock.priceTarget,
        _api_c2_limitBuyOrder: stock.limitBuyOrder,
        // 👇 NEW (ISO is best for Bubble date parsing)
        _api_c2_nextEarningsDateIso: stock.nextEarningsDateIso,
        _api_c2_nextEarningsDateFmt: stock.nextEarningsDateFmt,
        // ANCHOR: LIQ_BUBBLE_FIELDS_MIN
        _api_c2_liqPass: liq ? !!liq.pass : null,

        // Numbers (no formatting)
        _api_c2_liqAdv: (() => {
          const v = toFinite(liq?.metrics?.adv); // ADV in JPY
          return Number.isFinite(v) ? v : null;
        })(),
        _api_c2_liqVol: (() => {
          const v = toFinite(liq?.metrics?.avVol); // Avg volume (shares)
          return Number.isFinite(v) ? v : null;
        })(),

        _api_c2_tier: stock.tier,
        _api_c2_isBuyNow: stock.isBuyNow,
        _api_c2_flipBarsAgo: stock.flipBarsAgo,
        _api_c2_goldenCrossBarsAgo: stock.goldenCrossBarsAgo,
        _api_c2_buyNowReason: stock.buyNowReason,
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
      // hard fail for this ticker, move on
      errorLog(`❌ Error processing ${tickerObj.code}:`, err?.message || err);
      errors.push(`Ticker ${tickerObj.code}: ${err?.message || err}`);
    }
  }

  log("Scan complete", { count, errorsCount: errors.length });

  // derive buy-rate by tier
  const tierRows = Object.keys(summary.tiers.byTier)
    .map((tier) => {
      const tot = summary.tiers.byTier[tier] || 0;
      const buys = summary.tiers.buyByTier[tier] || 0;
      const buyRate = tot ? Math.round((buys / tot) * 10000) / 100 : 0;
      return {
        tier,
        total: tot,
        buys,
        buyRatePct: buyRate,
      };
    })
    .sort((a, b) => b.buyRatePct - a.buyRatePct || b.total - a.total);

  // top reasons (take top 10 each)
  function topK(obj, k = 10) {
    return Object.entries(obj)
      .map(([reason, cnt]) => ({
        reason,
        count: cnt,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, k);
  }

  // session-level block breakdowns & histograms
  const blocksTop = summarizeBlocks(teleList); // [{code,count,examples,ctxSample}]
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
    tierTable: tierRows,
    topReasons: {
      buy: topK(summary.reasons.buy, 10),
      noBuy: topK(summary.reasons.noBuy, 10),
    },
    debug: {
      blocksTop, // grouped “why blocked” with examples
      slopeBuckets: histo.slopeBuckets,
      rrShortfallBins: rrShortBins,
      headroomSample: histo.headroom.slice(0, 50),
      distMA25Sample: histo.distMA25.slice(0, 50),
      distroSample: Object.fromEntries(
        Object.entries(distro).map(([k, arr]) => [k, arr.slice(0, 100)])
      ),
    },
  };

  summaryOut.totals.buyRatePct = summaryOut.totals.count
    ? Math.round((summaryOut.totals.buyNow / summaryOut.totals.count) * 10000) /
      100
    : 0;

  log("SESSION SUMMARY", summaryOut);

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

      // ✅ 0) Sector rotation embed FIRST (before scanning)
      try {
        const { bubbleHtmlCode } = await fetchSectorRotationEmbed({
          regimeTicker: DEFAULT_REGIME_TICKER,
          title: "JP Sector Rotation (Swing Dashboard)",
        });

        if (typeof bubble_fn_sector === "function") {
          bubble_fn_sector(bubbleHtmlCode); // <-- this is your “bubbleEmbed”
          log("bubble_fn_sector OK (sector embed sent)");
        } else {
          warn(
            "bubble_fn_sector is not defined. Add a JavaScript-to-Bubble element named 'sector' (bubble_fn_sector).",
          );
        }
      } catch (e) {
        warn(
          "Sector rotation embed failed (continuing scan):",
          e?.message || e,
        );
        // optional: clear/notify bubble UI
        try {
          if (typeof bubble_fn_sector === "function") bubble_fn_sector("");
        } catch (_) {}
      }

      // ✅ 1) Proceed with normal scan (unchanged)
      try {
        await fetchStockAnalysis({
          tickers: tickerList,
          myPortfolio,
          onItem: (obj) => {
            try {
              bubble_fn_result(obj);
              log("bubble_fn_result OK for", obj?._api_c2_ticker);
            } catch (e) {
              errorLog("bubble_fn_result not available or failed:", e);
            }
          },
        });
      } finally {
        try {
          bubble_fn_finish();
          log("bubble_fn_finish called");
        } catch (e) {
          errorLog("bubble_fn_finish not available or failed:", e);
        }
      }
    },
  };
}

