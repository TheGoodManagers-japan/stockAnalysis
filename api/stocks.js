// /api/stocks.js

const yahooFinance = require("yahoo-finance2").default;

/* ---------- tiny error helper to match your fetch code ---------- */
function mkError(code, message, details = {}) {
  const e = new Error(message || code);
  e.name = "DataIntegrityError";
  e.code = code;
  e.details = details;
  return e;
}

/* ---------- throttle error helper (so we can return 429) ---------- */
function mkThrottleError(message, details = {}) {
  const e = new Error(message || "Yahoo Finance throttled this request");
  e.name = "YahooThrottleError";
  e.code = "YAHOO_THROTTLED";
  e.details = details;
  return e;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isThrottleError(err) {
  const msg = String(err?.message || "");
  // Common patterns from yahoo-finance2 / undici when Yahoo returns plain-text "Too Many Requests"
  return (
    /Too Many Requests/i.test(msg) ||
    /status\s*429/i.test(msg) ||
    /Unexpected token 'T'/i.test(msg) || // because body starts with "Too Many Requests"
    /crumb/i.test(msg) // crumb/cookie flow can also be throttled
  );
}

async function withRetry(fn, { retries = 4, baseMs = 500 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      // only retry on throttle-like errors
      if (!isThrottleError(err) || i === retries) break;

      const wait = baseMs * Math.pow(2, i) + Math.random() * 300;
      await sleep(wait);
    }
  }
  throw lastErr;
}

/* ---------- your function (enriched fundamentals + value metrics) ---------- */
async function fetchYahooFinanceData(ticker, sector = "") {
  try {
    const now = new Date();

    const getDateYearsAgo = (years) => {
      const d = new Date();
      d.setFullYear(d.getFullYear() - years);
      return d;
    };

    const oneYearAgo = getDateYearsAgo(1);
    const fiveYearsAgo = getDateYearsAgo(5);

    // IMPORTANT:
    // Your old code did 4 Yahoo calls in parallel (Promise.all).
    // Even for one ticker, that’s a burst and can trigger throttling.
    // We run them sequentially + small jitter between calls.

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

    // DEBUG: high-level summary info
    console.log(
      "[stocks] quoteSummary keys for",
      ticker,
      Object.keys(summary || {})
    );
    console.log(
      "[stocks] raw calendarEvents for",
      ticker,
      JSON.stringify(summary?.calendarEvents || {}, null, 2)
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

    // ---------- indicators ----------
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

    console.log(
      "[stocks] parsed calendarEvents for",
      ticker,
      JSON.stringify(ce, null, 2)
    );

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

    // Normalize Yahoo date formats (raw seconds, Date, string…)
    const parseYahooDate = (d) => {
      if (!d) return null;
      if (typeof d === "object" && "raw" in d) {
        const t = Number(d.raw);
        if (!Number.isFinite(t)) return null;
        return new Date(t * 1000); // Yahoo raw is in seconds
      }
      if (d instanceof Date) return d;
      if (typeof d === "string" || typeof d === "number") {
        const dt = new Date(d);
        return Number.isNaN(dt.getTime()) ? null : dt;
      }
      return null;
    };

    // calendarEvents.earnings.earningsDate is the usual shape
    const earningsBlock = ce.earnings || {};
    const earningsDatesRaw = Array.isArray(earningsBlock.earningsDate)
      ? earningsBlock.earningsDate
      : Array.isArray(ce.earningsDate)
      ? ce.earningsDate
      : [];

    console.log(
      "[stocks] earningsBlock for",
      ticker,
      JSON.stringify(earningsBlock, null, 2)
    );
    console.log(
      "[stocks] earningsDatesRaw for",
      ticker,
      JSON.stringify(earningsDatesRaw, null, 2)
    );

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

    console.log("[stocks] nextEarnings debug for", ticker, {
      nextEarningsDateIso,
      nextEarningsDateFmt,
    });

    // ---------- price/volume ----------
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

      regularMarketTime: quote.regularMarketTime || null,
      exchange: quote.fullExchangeName || quote.exchange || null,

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
        const buybacks = repurchasesTTM; // typically negative
        if (!mc || !buybacks) return 0;
        return (-buybacks / mc) * 100;
      })(),
      shareholderYieldPct: 0, // fill below
      ptbv: (() => {
        const sh = sharesOutstanding || 0;
        if (!sh || !tangibleBookValue) return 0;
        const tbps = tangibleBookValue / sh;
        return tbps > 0 ? (toNumber(quote.regularMarketPrice) || 0) / tbps : 0;
      })(),
    };

    yahooData.shareholderYieldPct =
      toNumber(yahooData.dividendYield) + toNumber(yahooData.buybackYieldPct);

    // ✅ FIX: Don't treat 0 as "missing". Only fail if undefined/null/not-finite.
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
    // Convert Yahoo throttling into a special error we can map to HTTP 429
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

/* --------------------------- Serverless handler --------------------------- */

const allowedOrigins = new Set([
  "https://thegoodmanagers.com",
  "https://www.thegoodmanagers.com",
  // add your Bubble test / preview domain(s) here if needed
]);

function applyCors(req, res) {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );

  const reqHeaders =
    req.headers["access-control-request-headers"] || "Content-Type";
  res.setHeader("Access-Control-Allow-Headers", reqHeaders);
  res.setHeader("Access-Control-Max-Age", "600");
}

module.exports = async (req, res) => {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ success: false, message: "Method Not Allowed" });
  }

  try {
    const body = req.body || {};
    const tickerObj = body.ticker || body || {};
    const code = String(tickerObj.code || tickerObj.ticker || "").trim();
    const sector = String(tickerObj.sector || "").trim();

    console.log("[stocks] request", new Date().toISOString(), "ticker:", code);

    if (!code) {
      return res
        .status(400)
        .json({ success: false, message: "ticker.code is required" });
    }

    const yahooData = await fetchYahooFinanceData(code, sector);

    return res.status(200).json({
      success: true,
      data: { code, sector, yahooData },
    });
  } catch (error) {
    // ✅ If Yahoo throttled/blocked, return 429 so Bubble can retry later
    if (
      error?.name === "YahooThrottleError" ||
      error?.code === "YAHOO_THROTTLED"
    ) {
      return res.status(429).json({
        success: false,
        message: error?.message || "Yahoo Finance throttled this request",
        code: error?.code,
        details: error?.details,
      });
    }

    const status = error?.name === "DataIntegrityError" ? 422 : 500;
    return res.status(status).json({
      success: false,
      message: error?.message || "stocks handler error",
      code: error?.code || undefined,
      details: error?.details || undefined,
    });
  }
};
