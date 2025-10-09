// /api/stocks.js
// /api/stocks.js

const yahooFinance = require("yahoo-finance2").default;

/* ───────────────── helpers ───────────────── */
function mkError(code, message, extra = {}) {
  const err = new Error(message);
  err.name = "DataIntegrityError";
  err.code = code;
  err.extra = extra;
  return err;
}

/* ───────────────── your function (unchanged logic) ───────────────── */
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

    const [quote, historicalPrices, dividendEvents, summary] = await Promise.all([
      yahooFinance.quote(ticker),
      yahooFinance.historical(ticker, {
        period1: oneYearAgo,
        period2: now,
        interval: "1d",
      }),
      yahooFinance.historical(ticker, {
        period1: fiveYearsAgo,
        period2: now,
        events: "dividends",
      }),
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
        ],
      }),
    ]);

    if (!Array.isArray(historicalPrices) || !historicalPrices.length) {
      throw mkError("NO_HISTORICAL", `No historical prices for ${ticker}`, { ticker });
    }
    if (!quote) {
      throw mkError("NO_QUOTE", `No quote for ${ticker}`, { ticker });
    }

    const toNumber = (val) => (isNaN(parseFloat(val)) ? 0 : parseFloat(val));
    const lastBar = historicalPrices[historicalPrices.length - 1] || {};
    const prevBar = historicalPrices[histororicalPrices.length - 2] || {};
    const safeDividendEvents = Array.isArray(dividendEvents) ? dividendEvents : [];

    // ---------- indicators ----------
    const calculateMA = (data, days) =>
      data.length < days ? 0 : data.slice(-days).reduce((a, v) => a + (v.close || 0), 0) / days;

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
      let gains = 0, losses = 0;
      for (let i = closes.length - period; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        if (d >= 0) gains += d;
        else losses -= d;
      }
      const avgG = gains / period, avgL = losses / period;
      const rs = avgL === 0 ? 100 : avgG / avgL;
      return 100 - 100 / (1 + rs);
    };

    const calculateMACD = (closes, fast = 12, slow = 26, signal = 9) => {
      if (closes.length < slow) return { macd: 0, signal: 0 };
      const emaFast = calculateEMA(closes, fast);
      const emaSlow = calculateEMA(closes, slow);
      const macdLine = emaFast.slice(emaFast.length - emaSlow.length).map((v, i) => v - emaSlow[i]);
      const sig = calculateEMA(macdLine, signal);
      return { macd: macdLine.pop() || 0, signal: sig.pop() || 0 };
    };

    const calculateBollinger = (closes, period = 20, m = 2) => {
      if (closes.length < period) return { upper: 0, lower: 0, mid: 0 };
      const recent = closes.slice(-period);
      const mid = recent.reduce((a, v) => a + v, 0) / period;
      const variance = recent.reduce((a, v) => a + Math.pow(v - mid, 2), 0) / period;
      const sd = Math.sqrt(variance);
      return { upper: mid + m * sd, lower: mid - m * sd, mid };
    };

    const calculateATR = (data, period = 14) => {
      if (data.length < period + 1) return 0;
      const rel = data.slice(-(period + 1));
      let sum = 0;
      for (let i = 1; i < rel.length; i++) {
        const c = rel[i], p = rel[i - 1];
        const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
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
        const cc = data[i].close, pc = data[i - 1].close, vol = data[i].volume || 0;
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
        const cc = historicalPrices[i].close, pc = historicalPrices[i - 1].close, vol = historicalPrices[i].volume || 0;
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
    const isH = summary?.incomeStatementHistory?.incomeStatementHistory?.[0] || {};
    const cfH = summary?.cashflowStatementHistory?.cashflowStatements?.[0] || {};
    const sd = summary?.summaryDetail || {};
    const pr = summary?.price || {};
    const qt = summary?.quoteType || {};

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

    const sharesOutstanding = toNumber(ks?.sharesOutstanding ?? quote?.sharesOutstanding);
    const totalAssets = toNumber(bsH?.totalAssets);
    const goodwill = toNumber(bsH?.goodWill) || 0;
    const intangibles = toNumber(bsH?.intangibleAssets) || 0;
    const equity = toNumber(bsH?.totalStockholderEquity);
    const tangibleBookValue = Math.max(0, equity - goodwill - intangibles);

    const repurchasesTTM = toNumber(cfH?.repurchaseOfStock);
    // const dividendsPaidTTM = toNumber(cfH?.dividendsPaid);

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
      prevClosePrice: toNumber(quote.regularMarketPreviousClose) || toNumber(prevBar.close),
      todayVolume: toNumber(quote.regularMarketVolume) || toNumber(lastBar.volume || 0),
      marketCap: toNumber(quote.marketCap),

      fiftyTwoWeekHigh: toNumber(quote.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: toNumber(quote.fiftyTwoWeekLow),

      peRatio: toNumber(quote.trailingPE ?? ks?.trailingPE ?? sd?.trailingPE),
      pbRatio: toNumber(quote.priceToBook ?? ks?.priceToBook ?? sd?.priceToBook),
      priceToSales: toNumber(sd?.priceToSalesTrailing12Months),

      dividendYield: toNumber(quote.dividendYield) * 100,

      dividendGrowth5yr: (() => {
        if (!Array.isArray(safeDividendEvents) || safeDividendEvents.length < 2) return 0;
        const first = safeDividendEvents[0];
        const last = safeDividendEvents[safeDividendEvents.length - 1];
        const dv0 = toNumber(first?.dividends);
        const dv1 = toNumber(last?.dividends);
        if (!dv0 || !dv1) return 0;
        const years = Math.max(1, (new Date(last.date) - new Date(first.date)) / (365.25 * 24 * 3600 * 1000));
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

      enterpriseValue,
      totalDebt,
      totalCash,
      freeCashflow,
      ebit,
      ebitda,
      sharesOutstanding,
      tangibleBookValue,

      evToEbit: (() => (ebit ? enterpriseValue / ebit : 0))(),
      evToEbitda: (() => (ebitda ? enterpriseValue / ebitda : 0))(),
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
      return v === undefined || v === null || v === 0;
    });
    if (missing.length) {
      throw mkError("MISSING_FIELDS", `Missing/zero fields: ${missing.join(", ")}`, {
        ticker,
        missingFields: missing,
        snapshot: yahooData,
        rawQuote: quote,
      });
    }

    return yahooData;
  } catch (err) {
    if (err && err.name === "DataIntegrityError") throw err;
    throw new Error(`fetchYahooFinanceData failed for ${ticker}: ${err.stack || err.message}`);
  }
}

/* ───────────────── CORS + route handler (“router”) ───────────────── */
// Only allow your public sites to call this API from the browser.
// (Add preview or other origins here if needed.)
const allowedOrigins = [
  "https://thegoodmanagers.com",
  "https://www.thegoodmanagers.com",
];

module.exports = async (req, res) => {
  const origin = req.headers.origin;

  // Dynamic CORS: reflect only if it’s one of your allowed sites
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin"); // proper caching with dynamic CORS
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    if (req.method !== "GET") {
      return res.status(405).json({ success: false, message: "Method Not Allowed" });
    }

    const { ticker, sector = "" } = req.query || {};
    if (!ticker) {
      return res.status(400).json({ success: false, message: "Ticker is required" });
    }

    const data = await fetchYahooFinanceData(String(ticker), String(sector));
    return res.status(200).json({ success: true, data });
  } catch (error) {
    // Ensure CORS headers are present even on errors
    if (allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
    const status = error?.name === "DataIntegrityError" ? 422 : 500;
    return res.status(status).json({
      success: false,
      error: error.message,
      code: error.code || undefined,
      extra: error.extra || undefined,
    });
  }
};
