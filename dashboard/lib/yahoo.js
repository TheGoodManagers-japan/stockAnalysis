// dashboard/lib/yahoo.js
// Yahoo Finance data layer (ESM) — ported from api/stocks.js + api/history.js

import YahooFinanceModule from "yahoo-finance2";
import { num } from "../engine/helpers.js";

const YahooFinance =
  YahooFinanceModule?.default ||
  YahooFinanceModule?.YahooFinance ||
  YahooFinanceModule;

if (typeof YahooFinance !== "function") {
  throw new Error(
    `yahoo-finance2: YahooFinance class not found. Export keys: ${Object.keys(
      YahooFinanceModule || {}
    ).join(", ")}`
  );
}

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

/* ======================== Error helpers ======================== */

function mkError(code, message, details = {}) {
  const e = new Error(message || code);
  e.name = "DataIntegrityError";
  e.code = code;
  e.details = details;
  return e;
}

function mkThrottleError(message, details = {}) {
  const e = new Error(message || "Yahoo Finance throttled this request");
  e.name = "YahooThrottleError";
  e.code = "YAHOO_THROTTLED";
  e.details = details;
  return e;
}

/* ======================== Retry logic ======================== */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wraps a promise with a hard timeout — rejects if it doesn't settle in `ms`. */
function withTimeout(promise, ms, label = "Yahoo call") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isThrottleError(err) {
  const msg = String(err?.message || "");
  return (
    /Too Many Requests/i.test(msg) ||
    /status\s*429/i.test(msg) ||
    /Unexpected token 'T'/i.test(msg) ||
    /crumb/i.test(msg) ||
    /timed out/i.test(msg) ||
    /fetch failed/i.test(msg) ||
    /terminated/i.test(msg) ||
    /ECONNRESET/i.test(msg) ||
    /ECONNREFUSED/i.test(msg) ||
    /socket hang up/i.test(msg)
  );
}

async function withRetry(fn, { retries = 4, baseMs = 500, timeoutMs = 30000, label = "" } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await withTimeout(fn(), timeoutMs, label || "Yahoo call");
    } catch (err) {
      lastErr = err;
      if (!isThrottleError(err) || i === retries) break;
      const wait = baseMs * Math.pow(2, i) + Math.random() * 300;
      await sleep(wait);
    }
  }
  throw lastErr;
}

/* ======================== Indicator calculations ======================== */
// Imported from canonical source — dashboard/engine/indicators.js
import {
  calculateMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollinger,
  calculateATR,
  calculateStochastic,
  calculateOBV,
  smaFromCloses as calculateSMA,
} from "../engine/indicators.js";

/* ======================== Yahoo date parser ======================== */

function parseYahooDate(d) {
  if (!d) return null;
  if (typeof d === "object" && "raw" in d) {
    const t = Number(d.raw);
    if (!Number.isFinite(t)) return null;
    return new Date(t * 1000);
  }
  if (d instanceof Date) return d;
  if (typeof d === "string" || typeof d === "number") {
    const dt = new Date(d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  return null;
}

/* ======================== Main fetch ======================== */

/**
 * Fetches quote, historical prices, dividends, and summary from Yahoo Finance,
 * computes all technical indicators, and returns a clean data object.
 *
 * @param {string} ticker  - Yahoo Finance symbol (e.g. "AAPL", "7203.T")
 * @param {string} sector  - Sector label passed through to the output
 * @returns {Promise<object>}
 */
export async function fetchYahooFinanceData(ticker, sector = "") {
  try {
    const now = new Date();

    const getDateYearsAgo = (years) => {
      const d = new Date();
      d.setFullYear(d.getFullYear() - years);
      return d;
    };

    const oneYearAgo = getDateYearsAgo(1);
    const fiveYearsAgo = getDateYearsAgo(5);

    // Sequential calls + jitter to reduce throttling
    // Each call has a 30s timeout to prevent hung connections from stalling the scan
    const quote = await withRetry(() => yahooFinance.quote(ticker), { label: `quote(${ticker})` });
    await sleep(150 + Math.random() * 200);

    const chartResult = await withRetry(
      () => yahooFinance.chart(ticker, { period1: oneYearAgo, period2: now, interval: "1d" }),
      { label: `chart(${ticker})`, timeoutMs: 45000 }
    );
    // Filter out partial candles (e.g. today's bar with null close on weekends/off-hours)
    const historicalPrices = (chartResult?.quotes || []).filter(
      (q) => q && typeof q.close === "number" && !Number.isNaN(q.close)
    );
    await sleep(150 + Math.random() * 200);

    let dividendEvents = [];
    try {
      dividendEvents = await withRetry(
        () => yahooFinance.chart(ticker, { period1: fiveYearsAgo, period2: now, interval: "1d" }),
        { label: `dividends(${ticker})` }
      );
      // Extract dividend events from chart result
      dividendEvents = (dividendEvents?.events?.dividends || []).map((d) => ({
        date: d.date,
        dividends: d.amount,
      }));
    } catch {
      dividendEvents = [];
    }
    await sleep(150 + Math.random() * 200);

    const summary = await withRetry(
      () => yahooFinance.quoteSummary(ticker, {
        modules: [
          "financialData",
          "defaultKeyStatistics",
          "balanceSheetHistory",
          "incomeStatementHistory",
          "cashflowStatementHistory",
          "summaryDetail",
          "price",
          "quoteType",
          "calendarEvents",
        ],
      }),
      { label: `summary(${ticker})`, timeoutMs: 45000 }
    );

    if (!Array.isArray(historicalPrices) || !historicalPrices.length) {
      throw mkError("NO_HISTORICAL", `No historical prices for ${ticker}`, {
        ticker,
      });
    }
    if (!quote) {
      throw mkError("NO_QUOTE", `No quote for ${ticker}`, { ticker });
    }

    const lastBar = historicalPrices[historicalPrices.length - 1] || {};
    const prevBar = historicalPrices[historicalPrices.length - 2] || {};
    const safeDividendEvents = Array.isArray(dividendEvents)
      ? dividendEvents
      : [];

    // ---------- core series ----------
    const closes = historicalPrices.map((d) => d.close || 0);
    const { macd, signal } = calculateMACD(closes);
    const bb = calculateBollinger(closes);
    const stoch = calculateStochastic(historicalPrices);
    const obvRaw = calculateOBV(historicalPrices);

    // OBV series for MA20
    const obvSeries = [];
    if (historicalPrices.length >= 2) {
      let obvAcc = 0;
      obvSeries.push(0);
      for (let i = 1; i < historicalPrices.length; i++) {
        const cc = historicalPrices[i].close,
          pc = historicalPrices[i - 1].close,
          vol = historicalPrices[i].volume || 0;
        if (cc > pc) obvAcc += vol;
        else if (cc < pc) obvAcc -= vol;
        obvSeries.push(obvAcc);
      }
    }
    const obvMA20 = calculateSMA(obvSeries, 20);

    // ---------- Yahoo summary shortcuts ----------
    const fd = summary?.financialData || {};
    const ks = summary?.defaultKeyStatistics || {};
    const bsH = summary?.balanceSheetHistory?.balanceSheetStatements?.[0] || {};
    const isH =
      summary?.incomeStatementHistory?.incomeStatementHistory?.[0] || {};
    const cfH =
      summary?.cashflowStatementHistory?.cashflowStatements?.[0] || {};
    const sd = summary?.summaryDetail || {};
    const pr = summary?.price || {};
    const qt = summary?.quoteType || {};
    const ce = summary?.calendarEvents || {};

    // ---------- raw pulls ----------
    const currency = (pr?.currency || quote?.currency || "").toUpperCase();
    const symbol = pr?.symbol || quote?.symbol || ticker;
    const shortName = pr?.shortName || qt?.longName || quote?.shortName || "";

    const enterpriseValue = num(ks?.enterpriseValue);
    const totalDebt = num(fd?.totalDebt);
    const totalCash = num(fd?.totalCash);
    const freeCashflow = num(fd?.freeCashflow);
    const ebitda = num(fd?.ebitda);
    const ebit = num(isH?.ebit ?? isH?.operatingIncome);

    const sharesOutstanding = num(
      ks?.sharesOutstanding ?? quote?.sharesOutstanding
    );
    const goodwill = num(bsH?.goodWill) || 0;
    const intangibles = num(bsH?.intangibleAssets) || 0;
    const equity = num(bsH?.totalStockholderEquity);
    const tangibleBookValue = Math.max(0, equity - goodwill - intangibles);

    const repurchasesTTM = num(cfH?.repurchaseOfStock);

    // ---------- earnings dates ----------
    const earningsBlock = ce.earnings || {};
    const earningsDatesRaw = Array.isArray(earningsBlock.earningsDate)
      ? earningsBlock.earningsDate
      : Array.isArray(ce.earningsDate)
        ? ce.earningsDate
        : [];

    const earningsDates = earningsDatesRaw.map(parseYahooDate).filter(Boolean);
    const futureEarningsDates = earningsDates.filter((d) => d >= now);

    let nextEarningsDate = null;
    if (futureEarningsDates.length)
      nextEarningsDate = futureEarningsDates.sort((a, b) => a - b)[0];
    else if (earningsDates.length)
      nextEarningsDate = earningsDates.sort((a, b) => b - a)[0];

    const nextEarningsDateIso = nextEarningsDate
      ? nextEarningsDate.toISOString()
      : null;

    const nextEarningsDateFmt = (() => {
      const first = earningsDatesRaw[0];
      return first && typeof first === "object" && first.fmt ? first.fmt : null;
    })();

    // ---------- assemble output ----------
    const yahooData = {
      symbol,
      currency,
      sector,
      shortName,

      currentPrice: num(quote.regularMarketPrice),
      highPrice: num(quote.regularMarketDayHigh) || num(lastBar.high),
      lowPrice: num(quote.regularMarketDayLow) || num(lastBar.low),
      openPrice: num(quote.regularMarketOpen) || num(lastBar.open),
      prevClosePrice:
        num(quote.regularMarketPreviousClose) || num(prevBar.close),
      todayVolume:
        num(quote.regularMarketVolume) || num(lastBar.volume || 0),
      marketCap: num(quote.marketCap),

      fiftyTwoWeekHigh: num(quote.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: num(quote.fiftyTwoWeekLow),

      peRatio: num(quote.trailingPE ?? ks?.trailingPE ?? sd?.trailingPE),
      pbRatio: num(
        quote.priceToBook ?? ks?.priceToBook ?? sd?.priceToBook
      ),
      priceToSales: num(sd?.priceToSalesTrailing12Months),

      dividendYield: num(quote.dividendYield) * 100,

      dividendGrowth5yr: (() => {
        if (!Array.isArray(safeDividendEvents) || safeDividendEvents.length < 2)
          return 0;
        const first = safeDividendEvents[0];
        const last = safeDividendEvents[safeDividendEvents.length - 1];
        const dv0 = num(first?.dividends);
        const dv1 = num(last?.dividends);
        if (!dv0 || !dv1) return 0;
        const years = Math.max(
          1,
          (new Date(last.date) - new Date(first.date)) /
          (365.25 * 24 * 3600 * 1000)
        );
        const cagr = Math.pow(dv1 / dv0, 1 / years) - 1;
        return cagr * 100;
      })(),

      epsTrailingTwelveMonths: num(quote.epsTrailingTwelveMonths),
      epsForward: num(quote.epsForward),
      epsGrowthRate: (() => {
        const t = num(quote.epsTrailingTwelveMonths);
        const f = num(quote.epsForward);
        return t ? ((f - t) / Math.abs(t)) * 100 : 0;
      })(),

      debtEquityRatio: num(summary?.financialData?.debtToEquity),

      movingAverage5d: num(calculateMA(historicalPrices, 5)),
      movingAverage20d: num(calculateMA(historicalPrices, 20)),
      movingAverage25d: num(calculateMA(historicalPrices, 25)),
      movingAverage50d: num(calculateMA(historicalPrices, 50)),
      movingAverage75d: num(calculateMA(historicalPrices, 75)),
      movingAverage200d: num(calculateMA(historicalPrices, 200)),
      rsi14: num(calculateRSI(closes)),
      macd: num(macd),
      macdSignal: num(signal),
      bollingerMid: num(bb.mid),
      bollingerUpper: num(bb.upper),
      bollingerLower: num(bb.lower),
      stochasticK: num(stoch.k),
      stochasticD: num(stoch.d),
      obv: num(obvRaw),
      obvMA20: num(obvMA20),
      atr14: num(calculateATR(historicalPrices)),

      nextEarningsDateIso,
      nextEarningsDateFmt,

      enterpriseValue,
      totalDebt,
      totalCash,
      freeCashflow,
      ebit,
      ebitda,
      sharesOutstanding,
      tangibleBookValue,

      evToEbit: (() => {
        const denom = ebit || 0;
        return denom ? enterpriseValue / denom : 0;
      })(),
      evToEbitda: (() => {
        const denom = ebitda || 0;
        return denom ? enterpriseValue / denom : 0;
      })(),
      fcfYieldPct: (() => {
        const mc = num(quote.marketCap);
        return mc > 0 && freeCashflow ? (freeCashflow / mc) * 100 : 0;
      })(),
      buybackYieldPct: (() => {
        const mc = num(quote.marketCap);
        const buybacks = repurchasesTTM;
        if (!mc || !buybacks) return 0;
        return (-buybacks / mc) * 100;
      })(),
      shareholderYieldPct: 0,
      ptbv: (() => {
        const sh = sharesOutstanding || 0;
        if (!sh || !tangibleBookValue) return 0;
        const tbps = tangibleBookValue / sh;
        return tbps > 0 ? (num(quote.regularMarketPrice) || 0) / tbps : 0;
      })(),
    };

    yahooData.shareholderYieldPct =
      num(yahooData.dividendYield) + num(yahooData.buybackYieldPct);

    // Validate required fields (0 is valid, only undefined/null/NaN fail)
    const required = [
      "currentPrice",
      "highPrice",
      "lowPrice",
      "fiftyTwoWeekHigh",
      "fiftyTwoWeekLow",
      "movingAverage5d",
      "movingAverage20d",
      "movingAverage25d",
      "movingAverage50d",
      "movingAverage75d",
      "movingAverage200d",
      "rsi14",
      "atr14",
      "stochasticK",
      "stochasticD",
    ];

    const missing = required.filter((f) => {
      const v = yahooData[f];
      return v === undefined || v === null || !Number.isFinite(v);
    });

    if (missing.length) {
      throw mkError("MISSING_FIELDS", `Missing fields: ${missing.join(", ")}`, {
        ticker,
        missingFields: missing,
        snapshot: yahooData,
        rawQuote: quote,
      });
    }

    return yahooData;
  } catch (err) {
    if (isThrottleError(err)) {
      throw mkThrottleError(`Yahoo Finance throttled/blocked: ${ticker}`, {
        ticker,
        originalMessage: String(err?.message || ""),
      });
    }

    if (err && err.name === "DataIntegrityError") throw err;

    throw new Error(
      `fetchYahooFinanceData failed for ${ticker}: ${err.stack || err.message}`
    );
  }
}

/* ======================== Forex ======================== */

/**
 * Fetches a forex rate from Yahoo Finance (e.g. USDJPY=X).
 * @param {string} pair - Yahoo Finance forex symbol (default 'USDJPY=X')
 * @returns {Promise<number>}
 */
export async function fetchForexRate(pair = "USDJPY=X") {
  try {
    const quote = await withRetry(() => yahooFinance.quote(pair), { label: `forex(${pair})` });
    return quote?.regularMarketPrice || 150;
  } catch {
    return 150; // fallback
  }
}

/* ======================== Historical data ======================== */

/**
 * Fetches daily OHLCV data for the given number of years.
 *
 * @param {string} ticker - Yahoo Finance symbol
 * @param {number} years  - How many years of history (default 10)
 * @returns {Promise<Array<{date: Date, open: number, high: number, low: number, close: number, volume: number, price: number}>>}
 */
export async function fetchHistoricalData(ticker, years = 10) {
  try {
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - years);
    const today = new Date();

    const data = await withRetry(
      () => yahooFinance.chart(ticker, { period1: startDate, period2: today, interval: "1d" }),
      { label: `chart(${ticker})`, timeoutMs: 45000 }
    );

    if (!data || !data.quotes || data.quotes.length === 0) {
      return [];
    }

    const validQuotes = data.quotes.filter(
      (q) =>
        q &&
        typeof q.close === "number" &&
        !Number.isNaN(q.close) &&
        typeof q.volume === "number" &&
        !Number.isNaN(q.volume)
    );

    return validQuotes.map((q) => ({
      date: q.date,
      open: q.open || q.close,
      high: q.high || q.close,
      low: q.low || q.close,
      close: q.close,
      volume: q.volume || 0,
      price: q.close,
    }));
  } catch (err) {
    if (isThrottleError(err)) {
      throw mkThrottleError(`Yahoo Finance throttled/blocked: ${ticker}`, {
        ticker,
        originalMessage: String(err?.message || ""),
      });
    }
    throw new Error(`Failed to fetch historical data: ${err.message}`);
  }
}
