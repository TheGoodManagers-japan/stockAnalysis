// dashboard/lib/yahoo.js
// Yahoo Finance data layer (ESM) — ported from api/stocks.js + api/history.js

import YahooFinanceModule from "yahoo-finance2";

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

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

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

function isThrottleError(err) {
  const msg = String(err?.message || "");
  return (
    /Too Many Requests/i.test(msg) ||
    /status\s*429/i.test(msg) ||
    /Unexpected token 'T'/i.test(msg) ||
    /crumb/i.test(msg)
  );
}

async function withRetry(fn, { retries = 4, baseMs = 500 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
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

const calculateMA = (data, days) =>
  data.length < days
    ? 0
    : data.slice(-days).reduce((a, v) => a + (v.close || 0), 0) / days;

const calculateEMA = (prices, p) => {
  if (prices.length < p) return [];
  const k = 2 / (p + 1);
  const out = [];
  let ema = prices.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p - 1; i < prices.length; i++) {
    if (i === p - 1) out.push(ema);
    else {
      ema = prices[i] * k + out[out.length - 1] * (1 - k);
      out.push(ema);
    }
  }
  return out;
};

const calculateRSI = (closes, period = 14) => {
  if (closes.length < period + 1) return 50;
  let gains = 0,
    losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  const avgG = gains / period,
    avgL = losses / period;
  const rs = avgL === 0 ? 100 : avgG / avgL;
  return 100 - 100 / (1 + rs);
};

const calculateMACD = (closes, fast = 12, slow = 26, signal = 9) => {
  if (closes.length < slow) return { macd: 0, signal: 0 };
  const emaFast = calculateEMA(closes, fast);
  const emaSlow = calculateEMA(closes, slow);
  const macdLine = emaFast
    .slice(emaFast.length - emaSlow.length)
    .map((v, i) => v - emaSlow[i]);
  const sig = calculateEMA(macdLine, signal);
  return { macd: macdLine.pop() || 0, signal: sig.pop() || 0 };
};

const calculateBollinger = (closes, period = 20, m = 2) => {
  if (closes.length < period) return { upper: 0, lower: 0, mid: 0 };
  const recent = closes.slice(-period);
  const mid = recent.reduce((a, v) => a + v, 0) / period;
  const variance =
    recent.reduce((a, v) => a + Math.pow(v - mid, 2), 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: mid + m * sd, lower: mid - m * sd, mid };
};

const calculateATR = (data, period = 14) => {
  if (data.length < period + 1) return 0;
  const rel = data.slice(-(period + 1));
  let sum = 0;
  for (let i = 1; i < rel.length; i++) {
    const c = rel[i],
      p = rel[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low - p.close)
    );
    sum += tr;
  }
  return sum / period;
};

const calculateStochastic = (data, kP = 14, dP = 3) => {
  if (data.length < kP + dP - 1) return { k: 50, d: 50 };
  const kVals = [];
  for (let i = kP - 1; i < data.length; i++) {
    const slice = data.slice(i - kP + 1, i + 1);
    const hi = Math.max(...slice.map((d) => d.high));
    const lo = Math.min(...slice.map((d) => d.low));
    const cl = data[i].close;
    kVals.push(hi !== lo ? ((cl - lo) / (hi - lo)) * 100 : 50);
  }
  if (kVals.length < dP) return { k: kVals.at(-1) || 50, d: 50 };
  const dVals = [];
  for (let i = dP - 1; i < kVals.length; i++) {
    const sum = kVals.slice(i - dP + 1, i + 1).reduce((a, b) => a + b, 0);
    dVals.push(sum / dP);
  }
  return { k: kVals.at(-1), d: dVals.at(-1) };
};

const calculateOBV = (data) => {
  if (data.length < 2) return 0;
  let obv = 0;
  for (let i = 1; i < data.length; i++) {
    const cc = data[i].close,
      pc = data[i - 1].close,
      vol = data[i].volume || 0;
    if (cc > pc) obv += vol;
    else if (cc < pc) obv -= vol;
  }
  return obv;
};

const calculateSMA = (arr, p) => {
  if (!arr || arr.length < p) return 0;
  const s = arr.slice(-p).reduce((a, b) => a + b, 0);
  return s / p;
};

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
    const quote = await withRetry(() => yahooFinance.quote(ticker));
    await sleep(150 + Math.random() * 200);

    const historicalPrices = await withRetry(() =>
      yahooFinance.historical(ticker, {
        period1: oneYearAgo,
        period2: now,
        interval: "1d",
      })
    );
    await sleep(150 + Math.random() * 200);

    const dividendEvents = await withRetry(() =>
      yahooFinance.historical(ticker, {
        period1: fiveYearsAgo,
        period2: now,
        events: "dividends",
      })
    );
    await sleep(150 + Math.random() * 200);

    const summary = await withRetry(() =>
      yahooFinance.quoteSummary(ticker, {
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
      })
    );

    if (!Array.isArray(historicalPrices) || !historicalPrices.length) {
      throw mkError("NO_HISTORICAL", `No historical prices for ${ticker}`, {
        ticker,
      });
    }
    if (!quote) {
      throw mkError("NO_QUOTE", `No quote for ${ticker}`, { ticker });
    }

    const toNumber = (val) => (isNaN(parseFloat(val)) ? 0 : parseFloat(val));
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

    const enterpriseValue = toNumber(ks?.enterpriseValue);
    const totalDebt = toNumber(fd?.totalDebt);
    const totalCash = toNumber(fd?.totalCash);
    const freeCashflow = toNumber(fd?.freeCashflow);
    const ebitda = toNumber(fd?.ebitda);
    const ebit = toNumber(isH?.ebit ?? isH?.operatingIncome);

    const sharesOutstanding = toNumber(
      ks?.sharesOutstanding ?? quote?.sharesOutstanding
    );
    const goodwill = toNumber(bsH?.goodWill) || 0;
    const intangibles = toNumber(bsH?.intangibleAssets) || 0;
    const equity = toNumber(bsH?.totalStockholderEquity);
    const tangibleBookValue = Math.max(0, equity - goodwill - intangibles);

    const repurchasesTTM = toNumber(cfH?.repurchaseOfStock);

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

      currentPrice: toNumber(quote.regularMarketPrice),
      highPrice: toNumber(quote.regularMarketDayHigh) || toNumber(lastBar.high),
      lowPrice: toNumber(quote.regularMarketDayLow) || toNumber(lastBar.low),
      openPrice: toNumber(quote.regularMarketOpen) || toNumber(lastBar.open),
      prevClosePrice:
        toNumber(quote.regularMarketPreviousClose) || toNumber(prevBar.close),
      todayVolume:
        toNumber(quote.regularMarketVolume) || toNumber(lastBar.volume || 0),
      marketCap: toNumber(quote.marketCap),

      fiftyTwoWeekHigh: toNumber(quote.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: toNumber(quote.fiftyTwoWeekLow),

      peRatio: toNumber(quote.trailingPE ?? ks?.trailingPE ?? sd?.trailingPE),
      pbRatio: toNumber(
        quote.priceToBook ?? ks?.priceToBook ?? sd?.priceToBook
      ),
      priceToSales: toNumber(sd?.priceToSalesTrailing12Months),

      dividendYield: toNumber(quote.dividendYield) * 100,

      dividendGrowth5yr: (() => {
        if (!Array.isArray(safeDividendEvents) || safeDividendEvents.length < 2)
          return 0;
        const first = safeDividendEvents[0];
        const last = safeDividendEvents[safeDividendEvents.length - 1];
        const dv0 = toNumber(first?.dividends);
        const dv1 = toNumber(last?.dividends);
        if (!dv0 || !dv1) return 0;
        const years = Math.max(
          1,
          (new Date(last.date) - new Date(first.date)) /
          (365.25 * 24 * 3600 * 1000)
        );
        const cagr = Math.pow(dv1 / dv0, 1 / years) - 1;
        return cagr * 100;
      })(),

      epsTrailingTwelveMonths: toNumber(quote.epsTrailingTwelveMonths),
      epsForward: toNumber(quote.epsForward),
      epsGrowthRate: (() => {
        const t = toNumber(quote.epsTrailingTwelveMonths);
        const f = toNumber(quote.epsForward);
        return t ? ((f - t) / Math.abs(t)) * 100 : 0;
      })(),

      debtEquityRatio: toNumber(summary?.financialData?.debtToEquity),

      movingAverage5d: toNumber(calculateMA(historicalPrices, 5)),
      movingAverage20d: toNumber(calculateMA(historicalPrices, 20)),
      movingAverage25d: toNumber(calculateMA(historicalPrices, 25)),
      movingAverage50d: toNumber(calculateMA(historicalPrices, 50)),
      movingAverage75d: toNumber(calculateMA(historicalPrices, 75)),
      movingAverage200d: toNumber(calculateMA(historicalPrices, 200)),
      rsi14: toNumber(calculateRSI(closes)),
      macd: toNumber(macd),
      macdSignal: toNumber(signal),
      bollingerMid: toNumber(bb.mid),
      bollingerUpper: toNumber(bb.upper),
      bollingerLower: toNumber(bb.lower),
      stochasticK: toNumber(stoch.k),
      stochasticD: toNumber(stoch.d),
      obv: toNumber(obvRaw),
      obvMA20: toNumber(obvMA20),
      atr14: toNumber(calculateATR(historicalPrices)),

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
        const mc = toNumber(quote.marketCap);
        return mc > 0 && freeCashflow ? (freeCashflow / mc) * 100 : 0;
      })(),
      buybackYieldPct: (() => {
        const mc = toNumber(quote.marketCap);
        const buybacks = repurchasesTTM;
        if (!mc || !buybacks) return 0;
        return (-buybacks / mc) * 100;
      })(),
      shareholderYieldPct: 0,
      ptbv: (() => {
        const sh = sharesOutstanding || 0;
        if (!sh || !tangibleBookValue) return 0;
        const tbps = tangibleBookValue / sh;
        return tbps > 0 ? (toNumber(quote.regularMarketPrice) || 0) / tbps : 0;
      })(),
    };

    yahooData.shareholderYieldPct =
      toNumber(yahooData.dividendYield) + toNumber(yahooData.buybackYieldPct);

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

/* ======================== Historical data ======================== */

/**
 * Fetches daily OHLCV data for the given number of years.
 *
 * @param {string} ticker - Yahoo Finance symbol
 * @param {number} years  - How many years of history (default 3)
 * @returns {Promise<Array<{date: Date, open: number, high: number, low: number, close: number, volume: number, price: number}>>}
 */
export async function fetchHistoricalData(ticker, years = 3) {
  try {
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - years);
    const today = new Date();

    const data = await withRetry(() =>
      yahooFinance.chart(ticker, {
        period1: startDate,
        period2: today,
        interval: "1d",
      })
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
