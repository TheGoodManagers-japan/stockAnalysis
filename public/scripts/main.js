// public/scripts/main.js
// ESM module used by both the browser (Bubble) and api/scan.js (server)

import { getComprehensiveMarketSentiment } from "./marketSentimentOrchestrator.js";
import { analyzeSwingTradeEntry } from "./swingTradeEntryTiming.js";
import {
  getTechnicalScore,
  getAdvancedFundamentalScore,
  getValuationScore,
  getNumericTier,
} from "./techFundValAnalysis.js";
import { allTickers } from "./tickers.js";

/* =========================
   API base (fixes 404s)
========================= */
const IS_BROWSER = typeof window !== "undefined";
const DEFAULT_API_BASE =
  "https://stock-analysis-thegoodmanagers-japan-aymerics-projects-60f33831.vercel.app";

function apiBase() {
  if (IS_BROWSER) {
    return window.SCAN_API_BASE || DEFAULT_API_BASE;
  }
  return (
    process.env.SCAN_API_BASE ||
    process.env.NEXT_PUBLIC_API_BASE ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : DEFAULT_API_BASE)
  );
}

/* =========================
   Ticker helpers
========================= */
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

/* =========================
   API calls
========================= */
async function fetchSingleStockData(tickerObj) {
  const code =
    typeof tickerObj === "string"
      ? normalizeTicker(tickerObj)
      : normalizeTicker(tickerObj?.code || tickerObj?.ticker || "");
  const sector = tickerObj?.sector || "";

  const url = `${apiBase()}/api/stocks`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: { code, sector } }),
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}
    if (!res.ok)
      throw new Error(`HTTP ${res.status} — ${(text || "").slice(0, 300)}`);
    if (!data || data.success === false) {
      throw new Error(data?.error || "Unknown /api/stocks error");
    }
    return data;
  } catch (err) {
    return { success: false, error: err?.message || String(err) };
  }
}

async function fetchHistoricalData(ticker) {
  const url = `${apiBase()}/api/history?ticker=${encodeURIComponent(ticker)}`;
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    if (!res.ok || !json?.success) {
      throw new Error(
        json?.error || `HTTP ${res.status} — ${(text || "").slice(0, 300)}`
      );
    }
    if (!Array.isArray(json.data)) return [];
    return json.data.map((d) => ({ ...d, date: new Date(d.date) }));
  } catch (err) {
    console.error(`history(${ticker}) failed:`, err);
    return [];
  }
}

/* =========================
   Light-weight enrich
========================= */
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
  if (!Number.isFinite(stock.movingAverage50d))
    stock.movingAverage50d = sma(closes, 50) || 0;
  if (!Number.isFinite(stock.movingAverage75d))
    stock.movingAverage75d = sma(closes, 75) || 0;
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
        stock.stochasticK = kVals.at(-1) ?? 50;
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
    stock.macd = macdLine.at(-1) ?? 0;
    stock.macdSignal = sig.at(-1) ?? 0;
  }

  if (!Number.isFinite(stock.currentPrice) && data.length) {
    stock.currentPrice = data.at(-1).close ?? 0;
  }

  return stock;
}

/* =========================
   Trade management (V2)
========================= */
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
    const t = historicalData.at(-1);
    const y = historicalData.at(-2);
    const bearEngulf =
      t.close < t.open &&
      y.close > y.open &&
      t.close < y.open &&
      t.open > y.close;
    if (bearEngulf) {
      return {
        status: "Sell Now",
        reason: "Trend Reversal: Bearish engulfing pattern appeared.",
      };
    }
  }

  return {
    status: "Hold",
    reason: "Uptrend remains intact. Price is above key support.",
  };
}

/* =========================
   Main: two modes
   - Browser: bubble_fn_result / bubble_fn_finish
   - Server: no Bubble calls
   Overloads:
     fetchStockAnalysis(tickerList, myPortfolio, isFromBrowser)
     fetchStockAnalysis({ tickers, myPortfolio, isFromBrowser, onItem })
========================= */
export async function fetchStockAnalysis(a, b, c) {
  // Normalize args
  let tickers = [];
  let myPortfolio = [];
  let isFromBrowser = false;
  let onItem = null;

  if (Array.isArray(a)) {
    tickers = a;
    myPortfolio = Array.isArray(b) ? b : [];
    isFromBrowser = !!c;
  } else {
    const opts = a || {};
    tickers = Array.isArray(opts.tickers) ? opts.tickers : [];
    myPortfolio = Array.isArray(opts.myPortfolio) ? opts.myPortfolio : [];
    isFromBrowser = !!opts.isFromBrowser;
    onItem = typeof opts.onItem === "function" ? opts.onItem : null;
  }

  const emit = (obj) => {
    if (onItem) {
      try {
        onItem(obj);
      } catch (e) {
        console.error("onItem failed:", e);
      }
    }
    if (isFromBrowser && typeof bubble_fn_result === "function") {
      try {
        bubble_fn_result(obj);
      } catch (e) {
        console.error("bubble_fn_result failed:", e);
      }
    }
  };

  const errors = [];
  const filteredTickers = resolveTickers(tickers);
  let count = 0;

  for (const tObj of filteredTickers) {
    console.log(`\n--- Fetching data for ${tObj.code} ---`);
    try {
      const res = await fetchSingleStockData(tObj);
      if (!res.success) throw new Error(`Yahoo data error: ${res.error}`);

      const { code, sector, yahooData } = res.data || {};
      if (!yahooData) throw new Error("Yahoo data is missing.");

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

      const historicalData = await fetchHistoricalData(stock.ticker);
      stock.historicalData = historicalData;
      enrichForTechnicalScore(stock);

      stock.technicalScore = getTechnicalScore(stock);
      stock.fundamentalScore = getAdvancedFundamentalScore(stock);
      stock.valuationScore = getValuationScore(stock);
      stock.tier = getNumericTier(stock);

      const horizons = getComprehensiveMarketSentiment(stock, historicalData);
      stock.shortTermScore = horizons.shortTerm.score;
      stock.longTermScore = horizons.longTerm.score;
      stock.shortTermBias = horizons.shortTerm.label;
      stock.longTermBias = horizons.longTerm.label;
      stock.shortTermConf = horizons.shortTerm.confidence;
      stock.longTermConf = horizons.longTerm.confidence;

      const finalSignal = analyzeSwingTradeEntry(stock, historicalData);
      stock.isBuyNow = finalSignal.buyNow;
      stock.buyNowReason = finalSignal.reason;
      stock.smartStopLoss = finalSignal.smartStopLoss ?? finalSignal.stopLoss;
      stock.smartPriceTarget =
        finalSignal.smartPriceTarget ?? finalSignal.priceTarget;

      const portfolioEntry = myPortfolio.find((p) => p.ticker === stock.ticker);
      if (portfolioEntry) {
        const management = getTradeManagementSignal_V2(
          stock,
          portfolioEntry.trade,
          historicalData
        );
        stock.managementSignalStatus = management.status;
        stock.managementSignalReason = management.reason;
      } else {
        stock.managementSignalStatus = null;
        stock.managementSignalReason = null;
      }

      const outObj = {
        _api_c2_ticker: stock.ticker,
        _api_c2_sector: stock.sector,
        _api_c2_currentPrice: stock.currentPrice,
        _api_c2_shortTermScore: stock.shortTermScore,
        _api_c2_longTermScore: stock.longTermScore,
        _api_c2_tier: stock.tier,
        _api_c2_smartStopLoss: stock.smartStopLoss,
        _api_c2_smartPriceTarget: stock.smartPriceTarget,
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

      emit(outObj);
      count += 1;
    } catch (err) {
      console.error(`❌ Error processing ${tObj.code}:`, err?.message || err);
      errors.push(`Ticker ${tObj.code}: ${err?.message || String(err)}`);
    }
  }

  if (isFromBrowser && typeof bubble_fn_finish === "function") {
    try {
      bubble_fn_finish();
    } catch (e) {
      console.error("bubble_fn_finish failed:", e);
    }
  }

  return { count, errors };
}

/* =========================
   Browser adapter for Bubble
========================= */
if (IS_BROWSER) {
  window.scan = window.scan || {};
  window.scan.fetchStockAnalysis = async (
    tickerList = [],
    myPortfolio = []
  ) => {
    return fetchStockAnalysis(tickerList, myPortfolio, true);
  };
}
