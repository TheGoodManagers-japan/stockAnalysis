// public/scripts/main.js
// ESM module shared by browser and /api/scan
// - Named export: fetchStockAnalysis({ tickers, myPortfolio, onItem })
// - Browser adapter: window.scan.fetchStockAnalysis(tickerList, myPortfolio)
//   (adapter wires bubble_fn_result / bubble_fn_finish; core never calls them)
//
// Imports
import { getComprehensiveMarketSentiment } from "./marketSentimentOrchestrator.js";
import { analyzeSwingTradeEntry } from "./swingTradeEntryTiming.js";
import {
  getTechnicalScore,
  getAdvancedFundamentalScore,
  getValuationScore,
  getNumericTier,
} from "./techFundValAnalysis.js";
import { allTickers } from "./tickers.js";

/* ---------------------------------------------------------
   0) Debug / env helpers
--------------------------------------------------------- */

const IS_BROWSER = typeof window !== "undefined";

const DEBUG =
  (IS_BROWSER ? !!window.SCAN_DEBUG : !!process.env.SCAN_DEBUG) ||
  (typeof process !== "undefined" && process.env?.NODE_ENV !== "production");

const log = (...args) => {
  if (DEBUG) console.log("[scan]", ...args);
};
const warn = (...args) => {
  if (DEBUG) console.warn("[scan]", ...args);
};
const err = (...args) => {
  console.error("[scan]", ...args);
};

// Default to the known-working Vercel deployment.
// You can override at runtime:
//   Browser: window.SCAN_API_BASE = "https://example.com"
//   Server : SCAN_API_BASE=https://example.com
const DEFAULT_API_BASE =
  "https://stock-analysis-thegoodmanagers-japan-aymerics-projects-60f33831.vercel.app";

function apiBase() {
  const fromBrowser = IS_BROWSER ? window.SCAN_API_BASE : null;
  const fromEnv =
    (typeof process !== "undefined" && process.env?.SCAN_API_BASE) ||
    (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_BASE) ||
    (typeof process !== "undefined" && process.env?.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : null);

  const base = fromBrowser || fromEnv || DEFAULT_API_BASE;
  return String(base).replace(/\/+$/, ""); // trim trailing slash
}

log("API base:", apiBase());

/* ---------------------------------------------------------
   1) Yahoo / API helpers
--------------------------------------------------------- */

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
    log("resolveTickers → using full allTickers list:", allTickers.length);
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
    "resolveTickers → resolved:",
    out.map((t) => t.code)
  );
  return out;
}

async function fetchSingleStockData(tickerObj) {
  const code =
    typeof tickerObj === "string"
      ? normalizeTicker(tickerObj)
      : normalizeTicker(tickerObj?.code || tickerObj?.ticker || "");
  const sector = tickerObj?.sector || "";

  const url = `${apiBase()}/api/stocks`;
  const payload = { ticker: { code, sector } };

  log("POST /api/stocks →", url, payload);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    log("POST /api/stocks status:", res.status, res.statusText);
    if (DEBUG) log("POST /api/stocks body:", text?.slice(0, 400));

    // Try JSON parse (some hosts return HTML on error)
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }

    if (!res.ok) {
      // Fallback: try legacy GET shape if POST isn't supported on that host
      if (res.status === 404 || res.status === 405) {
        const getUrl = `${apiBase()}/api/stocks?ticker=${encodeURIComponent(
          code
        )}`;
        log("Fallback GET /api/stocks →", getUrl);

        const gRes = await fetch(getUrl, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });
        const gText = await gRes.text();
        log("GET /api/stocks status:", gRes.status, gRes.statusText);
        if (DEBUG) log("GET /api/stocks body:", gText?.slice(0, 400));

        let gData = null;
        try {
          gData = JSON.parse(gText);
        } catch {
          gData = null;
        }
        if (!gRes.ok || !gData || gData.success === false) {
          throw new Error(
            `HTTP ${gRes.status}  — ${gText?.slice(0, 300) || "no body"}`
          );
        }
        return gData;
      }

      throw new Error(
        `HTTP ${res.status} — ${text?.slice(0, 300) || "no body"}`
      );
    }

    if (!data || data.success === false) {
      throw new Error(data?.error || "Unknown /api/stocks error");
    }

    return data;
  } catch (e) {
    err("fetchSingleStockData error:", e?.message || e);
    return { success: false, error: e?.message || String(e) };
  }
}

/***********************************************
 * 2) FETCH HISTORICAL DATA
 ***********************************************/
async function fetchHistoricalData(ticker) {
  const url = `${apiBase()}/api/history?ticker=${encodeURIComponent(ticker)}`;
  log("GET /api/history →", url);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    const text = await res.text();
    log("GET /api/history status:", res.status, res.statusText);
    if (DEBUG) log("GET /api/history body:", text?.slice(0, 400));

    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    if (!res.ok || !json?.success) {
      throw new Error(
        json?.error || `HTTP ${res.status} — ${text?.slice(0, 300)}`
      );
    }

    const out = Array.isArray(json.data)
      ? json.data.map((item) => ({
          ...item,
          date: new Date(item.date),
        }))
      : [];

    log(`history(${ticker}) → ${out.length} bars`);
    return out;
  } catch (e) {
    err(`history(${ticker}) failed:`, e?.message || e);
    return [];
  }
}

/***********************************************
 * 3) Trade Management Signal (V2)
 ***********************************************/
function getTradeManagementSignal_V2(stock, trade, historicalData) {
  const { currentPrice, movingAverage25d, macd, macdSignal } = stock;
  const { entryPrice, stopLoss, priceTarget } = trade;

  if (currentPrice >= priceTarget) {
    return {
      status: "Sell Now",
      reason: `Take Profit: Price reached target of ¥${priceTarget}.`,
    };
  }
  if (currentPrice <= stopLoss) {
    return {
      status: "Sell Now",
      reason: `Stop-Loss: Price hit stop-loss at ¥${stopLoss}.`,
    };
  }

  const isProfitable = currentPrice > entryPrice;
  if (isProfitable) {
    const hasMacdBearishCross = macd < macdSignal;
    if (hasMacdBearishCross) {
      return {
        status: "Protect Profit",
        reason:
          "Warning: Momentum (MACD) has turned bearish. Consider taking profits.",
      };
    }

    const below25dMA = currentPrice < movingAverage25d;
    if (below25dMA) {
      return {
        status: "Protect Profit",
        reason:
          "Warning: Price broke below 25-day MA support. Consider taking profits.",
      };
    }
  }

  if (historicalData.length >= 2) {
    const today = historicalData[historicalData.length - 1];
    const yesterday = historicalData[historicalData.length - 2];
    const isBearishEngulfing =
      today.close < today.open &&
      yesterday.close > yesterday.open &&
      today.close < yesterday.open &&
      today.open > yesterday.close;

    if (isBearishEngulfing) {
      return {
        status: "Sell Now",
        reason: "Trend Reversal: Strong bearish engulfing pattern appeared.",
      };
    }
  }

  return {
    status: "Hold",
    reason: "Uptrend remains intact. Price is above key support.",
  };
}

/***********************************************
 * 4) Enrich for Technical Score (lightweight)
 ***********************************************/
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

  // OBV + rolling MA20
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

  // MACD (12,26,9)
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

/* ---------------------------------------------------------
   5) Main scan — exportable for server & browser
--------------------------------------------------------- */

/**
 * Core scanner (no Bubble calls).
 * Usage A (object): fetchStockAnalysis({ tickers, myPortfolio, onItem })
 * Usage B (arrays): fetchStockAnalysis(tickerList, myPortfolio)
 *
 * @param {Object|Array} arg1
 * @param {Array=} arg2
 * @returns {Promise<{count:number, errors:string[]}>}
 */
export async function fetchStockAnalysis(arg1 = {}, arg2 = []) {
  // Normalize arguments
  let tickers = [];
  let myPortfolio = [];
  let onItem = undefined;

  if (Array.isArray(arg1)) {
    tickers = arg1;
    myPortfolio = Array.isArray(arg2) ? arg2 : [];
  } else {
    const opts = arg1 || {};
    tickers = Array.isArray(opts.tickers) ? opts.tickers : [];
    myPortfolio = Array.isArray(opts.myPortfolio) ? opts.myPortfolio : [];
    onItem = typeof opts.onItem === "function" ? opts.onItem : undefined;
  }

  // emit helper
  const emit = typeof onItem === "function" ? onItem : () => {};

  const errors = [];
  const filteredTickers = resolveTickers(tickers);

  log("fetchStockAnalysis start:", {
    requested: Array.isArray(tickers) ? tickers.length : 0,
    resolved: filteredTickers.length,
  });

  let count = 0;

  for (const tObj of filteredTickers) {
    log(`\n--- Fetching data for ${tObj.code} ---`);
    try {
      // 1) Fetch Yahoo + derived (server builds part of this)
      const result = await fetchSingleStockData(tObj);
      if (!result?.success) {
        const m = result?.error || "Unknown /api/stocks failure";
        err(`stock fetch failed for ${tObj.code}:`, m);
        throw new Error(`Yahoo data error: ${m}`);
      }

      const { code, sector, yahooData } = result.data || {};
      if (!yahooData) {
        throw new Error("Yahoo data is completely missing.");
      }

      // Minimal validation of criticals that our scoring expects
      const critical = ["currentPrice", "highPrice", "lowPrice"];
      const missingCritical = critical.filter(
        (k) => yahooData[k] === undefined || yahooData[k] === null
      );
      if (missingCritical.length) {
        throw new Error(
          `Missing critical fields: ${missingCritical.join(", ")}`
        );
      }

      // 2) Build stock object
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
        // technicals (may be missing & enriched later)
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

      // 3) Historical + enrichment
      const historicalData = await fetchHistoricalData(stock.ticker);
      stock.historicalData = historicalData || [];
      enrichForTechnicalScore(stock);

      // 4) Scores
      stock.technicalScore = getTechnicalScore(stock);
      stock.fundamentalScore = getAdvancedFundamentalScore(stock);
      stock.valuationScore = getValuationScore(stock);
      stock.tier = getNumericTier(stock);

      // 5) Market sentiment horizons
      const horizons = getComprehensiveMarketSentiment(
        stock,
        historicalData || []
      );
      stock.shortTermScore = horizons.shortTerm.score;
      stock.longTermScore = horizons.longTerm.score;
      stock.shortTermBias = horizons.shortTerm.label;
      stock.longTermBias = horizons.longTerm.label;
      stock.shortTermConf = horizons.shortTerm.confidence;
      stock.longTermConf = horizons.longTerm.confidence;

      // 6) Entry timing
      log("Running analyzeSwingTradeEntry...");
      const finalSignal = analyzeSwingTradeEntry(stock, historicalData || []);
      log("analyzeSwingTradeEntry →", finalSignal);

      stock.isBuyNow = finalSignal.buyNow;
      stock.buyNowReason = finalSignal.reason;
      stock.smartStopLoss = finalSignal.smartStopLoss ?? finalSignal.stopLoss;
      stock.smartPriceTarget =
        finalSignal.smartPriceTarget ?? finalSignal.priceTarget;

      // 7) Trade management (if in portfolio)
      const portfolioEntry = myPortfolio.find(
        (p) => normalizeTicker(p.ticker) === stock.ticker
      );
      if (portfolioEntry?.trade) {
        const managementSignal = getTradeManagementSignal_V2(
          stock,
          portfolioEntry.trade,
          historicalData || []
        );
        stock.managementSignalStatus = managementSignal.status;
        stock.managementSignalReason = managementSignal.reason;
      } else {
        stock.managementSignalStatus = null;
        stock.managementSignalReason = null;
      }

      // 8) Output object (Bubble-friendly keys kept)
      const outObj = {
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
        _api_c2_tier: stock.tier,
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

      log(`✓ Emitting ${stock.ticker}`, {
        tier: stock.tier,
        buyNow: stock.isBuyNow,
        short: stock.shortTermScore,
        long: stock.longTermScore,
      });

      emit(outObj);
      count += 1;
    } catch (e) {
      const message = e?.message || String(e);
      err(`✗ ${tObj.code} failed:`, message);
      errors.push(`Ticker ${tObj.code}: ${message}`);
    }
  }

  log("fetchStockAnalysis done:", { count, errorsCount: errors.length });
  return { count, errors };
}

/* ---------------------------------------------------------
   6) Browser adapter (Bubble wiring only here)
--------------------------------------------------------- */
if (IS_BROWSER) {
  window.scan = window.scan || {};

  // Allow overriding the API base at runtime
  window.scan.setApiBase = function setApiBase(base) {
    window.SCAN_API_BASE = base;
    log("API base overridden:", apiBase());
  };

  /**
   * Original browser API:
   * @param {string[]} tickerList - like ["7203","6758"]
   * @param {Array} myPortfolio   - e.g. [{ ticker:"7203.T", trade:{ entryPrice, stopLoss, priceTarget } }]
   */
  window.scan.fetchStockAnalysis = async function (
    tickerList = [],
    myPortfolio = []
  ) {
    log("Browser call: window.scan.fetchStockAnalysis()", {
      tickers: tickerList.length,
      portfolio: myPortfolio.length,
    });

    try {
      await fetchStockAnalysis({
        tickers: tickerList,
        myPortfolio,
        onItem: (obj) => {
          try {
            // Provided by Bubble runtime
            bubble_fn_result(obj);
          } catch (e) {
            err("bubble_fn_result not available or failed:", e);
          }
        },
      });
    } finally {
      try {
        // Provided by Bubble runtime
        bubble_fn_finish();
      } catch (e) {
        err("bubble_fn_finish not available or failed:", e);
      }
    }
  };
}
