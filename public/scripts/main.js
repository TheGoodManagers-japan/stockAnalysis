// main.js (ESM + isomorphic, env-aware)
//
// Exports:
//   - fetchStockAnalysis({ tickers, myPortfolio, onItem, mode })
//       * Server/API (or mode: "api"): returns { count, errors, results[] } (no Bubble calls)
//       * Browser with Bubble (or mode: "browser", no onItem): emits bubble_fn_result per item and calls bubble_fn_finish
//   - enrichForTechnicalScore(stock)
//
// Requires your API routes:
//   - /api/stocks  → returns { success, data: { code, sector, yahooData } } or { success:false, error, ... }
//   - /api/history → returns { success, data: [{ date, open, high, low, close, volume }, ...] }

import { getComprehensiveMarketSentiment } from "./marketSentimentOrchestrator.js";
import { analyzeSwingTradeEntry } from "./swingTradeEntryTiming.js";
import {
  getTechnicalScore,
  getAdvancedFundamentalScore,
  getValuationScore,
  getNumericTier,
} from "./techFundValAnalysis.js";
import { allTickers } from "./tickers.js";

/* ---------------------------------------------
   Env detection + base URL
--------------------------------------------- */
const IS_BROWSER = typeof window !== "undefined";
const HAS_BUBBLE =
  IS_BROWSER &&
  typeof bubble_fn_result === "function" &&
  typeof bubble_fn_finish === "function";

function apiBase() {
  if (IS_BROWSER) return "";
  const v = process.env.VERCEL_URL || process.env.NEXT_PUBLIC_VERCEL_URL;
  if (v) return `https://${v}`;
  // Fallback to your deployed domain if needed:
  return "https://stock-analysis-thegoodmanagers-japan-aymerics-projects-60f33831.vercel.app";
}

/* ---------------------------------------------
   Ticker normalization & resolution
--------------------------------------------- */
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
  return out;
}

/* ---------------------------------------------------------
   1) Yahoo / API helpers
--------------------------------------------------------- */

async function fetchSingleStockData(tickerObj) {
  const base = apiBase();
  // Ensure we have a code string
  const code =
    typeof tickerObj === "string"
      ? normalizeTicker(tickerObj)
      : normalizeTicker(tickerObj?.code || tickerObj?.ticker || "");

  const attempts = [
    // Preferred body (object with code + sector if available)
    {
      method: "POST",
      body: { ticker: { code, sector: tickerObj?.sector || "" } },
    },
    // Alternate simple body
    { method: "POST", body: { ticker: code } },
    // Fallback GET
    { method: "GET", query: `?ticker=${encodeURIComponent(code)}` },
  ];

  const errors = [];

  for (const a of attempts) {
    try {
      const url =
        a.method === "GET"
          ? `${base}/api/stocks${a.query || ""}`
          : `${base}/api/stocks`;

      const res = await fetch(url, {
        method: a.method,
        headers: { "Content-Type": "application/json" },
        ...(a.method !== "GET" ? { body: JSON.stringify(a.body) } : {}),
      });

      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }

      if (!res.ok) {
        errors.push(
          `HTTP ${res.status} ${res.statusText} — ${text.slice(0, 400)}`
        );
        continue;
      }
      if (!json || typeof json.success === "undefined") {
        errors.push(`Unexpected response: ${text.slice(0, 400)}`);
        continue;
      }
      if (!json.success) {
        // /api/stocks returns 200 with success:false for data issues — bubble up the reason
        return {
          success: false,
          error: json.error || "Unknown data error",
          code: json.code,
          details: json.details,
        };
      }
      return json; // { success:true, data:{ code, sector, yahooData } }
    } catch (e) {
      errors.push(`Network/parse error — ${String(e?.message || e)}`);
    }
  }

  return { success: false, error: errors.join(" | ") };
}

/***********************************************
 * 2) FETCH HISTORICAL DATA
 ***********************************************/
async function fetchHistoricalData(ticker) {
  const base = apiBase();
  try {
    const code = normalizeTicker(ticker);
    const apiUrl = `${base}/api/history?ticker=${encodeURIComponent(code)}`;

    const res = await fetch(apiUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} — ${text.slice(0, 400)}`);
    }
    if (!json?.success) {
      throw new Error(json?.error || "Unknown history API error");
    }

    const rows = Array.isArray(json.data) ? json.data : [];
    if (!rows.length) return [];

    return rows.map((item) => ({
      ...item,
      date: new Date(item.date),
    }));
  } catch (error) {
    console.error(`Error fetching historical data for ${ticker}:`, error);
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

  if (currentPrice > entryPrice) {
    if (macd < macdSignal) {
      return {
        status: "Protect Profit",
        reason:
          "Warning: Momentum (MACD) has turned bearish. Consider taking profits.",
      };
    }
    if (currentPrice < movingAverage25d) {
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
 * @param {Object}   opts
 * @param {string[]} [opts.tickers]        - e.g. ["7203","6758.T"]
 * @param {Array}    [opts.myPortfolio=[]] - e.g. [{ ticker:"7203.T", trade:{ entryPrice, stopLoss, priceTarget } }]
 * @param {Function} [opts.onItem]         - optional per-item callback
 * @param {"auto"|"browser"|"api"} [opts.mode="auto"] - force behavior if needed
 * @returns {Promise<{count:number, errors:string[], results:any[]}>}
 */
export async function fetchStockAnalysis({
  tickers = [],
  myPortfolio = [],
  onItem,
  mode = "auto",
} = {}) {
  const filteredTickers = resolveTickers(tickers);

  const results = [];
  const useBubble =
    (mode === "browser" || (mode === "auto" && HAS_BUBBLE)) && !onItem;

  // decide how to emit items
  const emit = onItem
    ? onItem
    : useBubble
    ? (obj) => {
        try {
          bubble_fn_result(obj);
        } catch (e) {
          console.error("bubble_fn_result failed:", e);
        }
      }
    : (obj) => results.push(obj);

  const errors = [];
  let count = 0;

  try {
    for (const tickerObj of filteredTickers) {
      console.log(`\n--- Fetching data for ${tickerObj.code} ---`);
      try {
        // 1) Yahoo data
        const result = await fetchSingleStockData(tickerObj);
        if (!result.success) {
          throw new Error(
            `Yahoo data error: ${result.error || "Unknown error"}`
          );
        }

        const { code, sector, yahooData } = result.data;
        if (!yahooData) {
          throw new Error("Yahoo data is completely missing.");
        }

        // Validate some critical fields (defensive)
        const critical = ["currentPrice", "highPrice", "lowPrice"];
        const missingCritical = critical.filter(
          (f) => !yahooData[f] && yahooData[f] !== 0
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
        const horizons = getComprehensiveMarketSentiment(stock, historicalData);
        stock.shortTermScore = horizons.shortTerm.score;
        stock.longTermScore = horizons.longTerm.score;
        stock.shortTermBias = horizons.shortTerm.label;
        stock.longTermBias = horizons.longTerm.label;
        stock.shortTermConf = horizons.shortTerm.confidence;
        stock.longTermConf = horizons.longTerm.confidence;

        // 6) Entry timing
        const finalSignal = analyzeSwingTradeEntry(stock, historicalData);
        stock.isBuyNow = finalSignal.buyNow;
        stock.buyNowReason = finalSignal.reason;
        stock.smartStopLoss = finalSignal.smartStopLoss ?? finalSignal.stopLoss;
        stock.smartPriceTarget =
          finalSignal.smartPriceTarget ?? finalSignal.priceTarget;

        // 7) Trade management if in portfolio
        const portfolioEntry = myPortfolio.find(
          (p) => p.ticker === stock.ticker
        );
        if (portfolioEntry) {
          const managementSignal = getTradeManagementSignal_V2(
            stock,
            portfolioEntry.trade,
            historicalData
          );
          stock.managementSignalStatus = managementSignal.status;
          stock.managementSignalReason = managementSignal.reason;
        } else {
          stock.managementSignalStatus = null;
          stock.managementSignalReason = null;
        }

        // 8) Output object (Bubble-friendly)
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

        emit(stockObject);
        count += 1;
      } catch (error) {
        console.error(
          `❌ Error processing ticker ${tickerObj.code}:`,
          error.message
        );
        errors.push(`Ticker ${tickerObj.code}: ${error.message}`);
      }
    }
  } finally {
    if (useBubble) {
      try {
        bubble_fn_finish();
      } catch (e) {
        console.error("bubble_fn_finish failed:", e);
      }
    }
  }

  // Always return (on browser Bubble path, results will likely be empty by design)
  return { count, errors, results };
}

/* ---------------------------------------------------------
   6) Optional browser adapter (keeps old window.scan API)
--------------------------------------------------------- */
if (IS_BROWSER) {
  window.scan = {
    async fetchStockAnalysis(tickerList = [], myPortfolio = []) {
      // No onItem => auto Bubble emit
      return fetchStockAnalysis({
        tickers: tickerList,
        myPortfolio,
        mode: "browser",
      });
    },
  };
}
