// public/scripts/main.js
// ESM module used by both the browser and the /api/scan serverless function.
// - Browser: call window.scan.fetchStockAnalysis(tickers, myPortfolio)
// - Server:  /api/scan imports this file and calls fetchStockAnalysis({ ... })
//   (no Bubble calls are made on the server)
//
// NOTE: API base is fixed and DEBUG is always true per your request.

import { getComprehensiveMarketSentiment } from "./marketSentimentOrchestrator.js";
import { analyzeSwingTradeEntry } from "./swingTradeEntryTiming.js";
import {
  getTechnicalScore,
  getAdvancedFundamentalScore,
  getValuationScore,
  getNumericTier,
} from "./techFundValAnalysis.js";
import { allTickers } from "./tickers.js";

/* -------------------------------------------
   0) Constants + tiny logging helper
------------------------------------------- */
const API_BASE =
  "https://stock-analysis-thegoodmanagers-japan-aymerics-projects-60f33831.vercel.app";
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


/**
 * getTradeManagementSignal_V3
 *
 * STATUS LEGEND
 * - "Hold"            → Keep the position unchanged (no stop update unless you choose to persist a suggested one).
 * - "Protect Profit"  → Tighten/raise the stop (we return `updatedStopLoss`); you continue holding unless the stop is hit.
 * - "Sell Now"        → Exit immediately.
 * - "Scale Partial"   → Take partial profits (e.g., 50%) and keep trailing the remainder.
 *
 * DECISION SEQUENCE (top → bottom)
 *  1) SELL — stop-loss hit
 *  2) SELL — structural breakdown (close<MA25 + lower low + bearish context)
 *  3) SCALE/SELL — target reached (scale if context strong, else sell)
 *  4) PROTECT — R milestones: +1R (move to breakeven), +2R (start/continue trailing)
 *  5) HOLD — entry-kind aware holds (DIP/RETEST above MA25; BREAKOUT retest)
 *  6) PROTECT — bearish engulfing near resistance (tighten)
 *  7) HOLD/PROTECT — default structure-first (≥MA25 = HOLD; <MA25 = PROTECT)
 */
function getTradeManagementSignal_V3(stock, trade, historicalData, ctx = {}) {
  const n = v => Number.isFinite(v) ? v : 0;

  // --- Inputs & fallbacks -----------------------------------------------------
  const px     = n(stock.currentPrice);
  const entry  = n(trade.entryPrice);
  const stop   = n(trade.stopLoss);
  const target = n(trade.priceTarget);

  // Use provided MA/ATR if present; otherwise compute from history.
  const ma25 = n(stock.movingAverage25d) || sma(historicalData, 25);
  const atr  = Math.max(n(stock.atr14), calcATR(historicalData, 14), px * 0.005, 1e-6);

  // Context (short-term sentiment 1..7; lower = more bullish)
  const sentiment = n(ctx.sentimentScore) || 4;
  const ml        = n(ctx.deep?.mlScore); // optional
  // ADX fallback so caller doesn't have to pass it
  const adx       = Number.isFinite(ctx.adx) ? ctx.adx : calcADX14(historicalData);
  const isExtended = !!ctx.isExtended;

  // R progress uses ORIGINAL risk (initialStop). If missing, fall back to current stop.
  const initialStop   = Number.isFinite(trade.initialStop) ? trade.initialStop : stop;
  const riskPerShare  = Math.max(0.01, entry - initialStop);
  const progressR     = (px - entry) / riskPerShare;

  // --- 1) SELL — hard exit: stop-loss hit ------------------------------------
  if (px <= stop) {
    // SELL: protective stop already touched
    return { status: "Sell Now", reason: `Stop-loss hit at ¥${round0(stop)}.` };
  }

  // --- 2) SELL — structural breakdown ----------------------------------------
  // Definition: close < MA25 + NEW lower low + bearish context
  const brokeMA25 = lastClose(historicalData) < ma25 && ma25 > 0;
  const bearishContext =
    sentiment >= 6 || ml <= -1.5 ||
    (ctx.deep?.shortTermRegime?.type === "TRENDING" &&
     ctx.deep?.shortTermRegime?.characteristics?.includes?.("DOWNTREND"));
  if (brokeMA25 && madeLowerLow(historicalData) && bearishContext) {
    // SELL: thesis broken (trend + context confirm)
    return { status: "Sell Now", reason: "Trend break: close < MA25 with lower low and bearish context." };
  }

  // --- 3) SCALE/SELL — reached target ----------------------------------------
  // Strong context → SCALE (e.g., 50%) + trail the rest; weak context → SELL
  const strengthOK =
    (sentiment <= 3) &&
    (ml >= 1 || ctx.deep?.longTermRegime?.type === "TRENDING") &&
    (!isExtended) &&
    (adx ? adx > 25 : true);

  if (px >= target) {
    if (strengthOK) {
      // SCALE: take partial profits; continue with tighter structure/MA trailing
      return {
        status: "Scale Partial",
        reason: `Target reached (¥${round0(target)}). Context strong — scale 50% and trail the rest.`,
        updatedStopLoss: Math.max(stop, trailingStructStop(historicalData, ma25, atr)),
        suggest: { takeProfitPct: 50 }
      };
    } else {
      // SELL: take the win; context not supportive to extend
      return { status: "Sell Now", reason: `Take profit at target (¥${round0(target)}). Context not strong enough to extend.` };
    }
  }

  // --- 4) PROTECT — R milestones ---------------------------------------------
  // +2R → trail using max(entry + 1.2R, structure/MA stop)
  if (progressR >= 2) {
    return {
      status: "Protect Profit",
      reason: `Up ≥ +2R. Trail with structure/MA25 to lock gains.`,
      updatedStopLoss: Math.max(
        stop,
        entry + 1.2 * riskPerShare,
        trailingStructStop(historicalData, ma25, atr)
      )
    };
  }
  // +1R → raise stop to breakeven
  if (progressR >= 1) {
    return {
      status: "Protect Profit",
      reason: "Up ≥ +1R. Move stop to breakeven.",
      updatedStopLoss: Math.max(stop, entry)
    };
  }

  // --- 5) HOLD — entry-kind aware keeps --------------------------------------
  const entryKind = (ctx.entryKind || "").toUpperCase();
  const aboveMA25 = px >= ma25 || ma25 === 0;

  // DIP / RETEST: if above MA25 and sentiment not bearish → HOLD
  if ((entryKind === "DIP" || entryKind === "RETEST") && aboveMA25 && sentiment <= 4) {
    // HOLD: pullback thesis intact (above MA25; ST not bearish)
    return { status: "Hold", reason: "Healthy pullback above MA25 after DIP/RETEST entry; sentiment not bearish." };
  }

  // BREAKOUT: retest within ~1.3×ATR that holds prior pivot zone → HOLD
  if (entryKind === "BREAKOUT") {
    const pivot     = recentPivotHigh(historicalData);
    const nearPivot = pivot > 0 && Math.abs(px - pivot) <= 1.3 * atr;
    const heldZone  = pivot > 0 && n(historicalData.at(-1)?.low) >= pivot - 0.6 * atr;
    if (pivot && nearPivot && heldZone) {
      // HOLD: retest behaving well
      return { status: "Hold", reason: "Breakout retest holding prior pivot zone." };
    }
  }

  // --- 6) PROTECT — bearish engulf near resistance ---------------------------
  const last = historicalData?.at?.(-1) || {};
  const prev = historicalData?.at?.(-2) || {};
  const bearishEngulf =
    n(last.close) < n(last.open) &&
    n(prev.close) > n(prev.open) &&
    n(last.close) < n(prev.open) &&
    n(last.open) > n(prev.close);
  const near52wHigh = near(px, n(stock.fiftyTwoWeekHigh), 0.02);

  if (near52wHigh && bearishEngulf) {
    // PROTECT: tighten when reversal signal appears at resistance
    return {
      status: "Protect Profit",
      reason: "Bearish engulfing near resistance — tighten stop.",
      updatedStopLoss: Math.max(stop, trailingStructStop(historicalData, ma25, atr))
    };
  }

  // --- 7) DEFAULT — structure-first ------------------------------------------
  if (aboveMA25) {
    // HOLD: trend structure intact
    return { status: "Hold", reason: "Uptrend structure intact (≥ MA25). Allow normal volatility." };
  } else {
    // PROTECT: slipped below MA25 but no full breakdown signal
    return {
      status: "Protect Profit",
      reason: "Lost MA25 but no full breakdown — tighten to structure/MA stop.",
      updatedStopLoss: Math.max(stop, trailingStructStop(historicalData, ma25, atr))
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
} = {}) {
  log("Starting scan", { IS_BROWSER, API_BASE });
  const emit = typeof onItem === "function" ? onItem : () => {};
  const errors = [];

  const filteredTickers = resolveTickers(tickers);
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
        bollingerLower: yahooData.bollingerLower,
        stochasticK: yahooData.stochasticK,
        stochasticD: yahooData.stochasticD,
        obv: yahooData.obv,
        atr14: yahooData.atr14,
      };

      // 3) history + enrichment
      const historicalData = await fetchHistoricalData(stock.ticker);
      stock.historicalData = historicalData || [];
      enrichForTechnicalScore(stock);

      // 4) scores
      stock.technicalScore = getTechnicalScore(stock);
      stock.fundamentalScore = getAdvancedFundamentalScore(stock);
      stock.valuationScore = getValuationScore(stock);
      stock.tier = getNumericTier(stock);

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
      const finalSignal = analyzeSwingTradeEntry(stock, historicalData);
      log("Swing entry timing done");

      stock.isBuyNow = finalSignal.buyNow;
      stock.buyNowReason = finalSignal.reason;

      // Normalize + mirror (handles both buyNow true/false)
      const normSL = finalSignal.smartStopLoss ?? finalSignal.stopLoss;
      const normTP = finalSignal.smartPriceTarget ?? finalSignal.priceTarget;

      // “Smart” fields
      stock.smartStopLoss = normSL;
      stock.smartPriceTarget = normTP;

      // Plain fields used by the API payload
      stock.stopLoss = normSL;
      stock.targetPrice = normTP; // NOTE: your payload uses targetPrice key
      stock.priceTarget = normTP; // optional legacy alias (harmless)

      // 7) trade management if held
      // 7) trade management if held
      const portfolioEntry = myPortfolio.find((p) => p.ticker === stock.ticker);
      if (portfolioEntry) {
        // Try to infer entry kind from your entry engine's reason text, if present
        const entryKind = extractEntryKindFromReason(finalSignal?.reason); // DIP / RETEST / RECLAIM / INSIDE / BREAKOUT

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
          stock.managementUpdatedStop = Math.round(mgmt.updatedStopLoss);
          // optionally reflect it in the "smart" fields shown in Bubble:
          stock.smartStopLoss = stock.managementUpdatedStop;
          stock.stopLoss = stock.managementUpdatedStop; // if you want UI to show the tightened stop
        }
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
        _api_c2_finalScore: stock.finalScore,
        _api_c2_tier: getNumericTier(stock),
        _api_c2_smartStopLoss: stock.smartStopLoss,
        _api_c2_smartPriceTarget: stock.smartPriceTarget,
        _api_c2_limitOrder: stock.limitOrder,
        _api_c2_isBuyNow: stock.isBuyNow,
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
      errorLog(`❌ Error processing ${tickerObj.code}:`, err?.message || err);
      errors.push(`Ticker ${tickerObj.code}: ${err?.message || err}`);
    }
  }

  log("Scan complete", { count, errorsCount: errors.length });
  return { count, errors };
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
