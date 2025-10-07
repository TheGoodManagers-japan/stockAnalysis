// /api/stocks.js
const yahooFinance = require("yahoo-finance2").default; // add to package.json deps

module.exports = async (req, res) => {
  // CORS (optional)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!["GET", "POST"].includes(req.method)) {
    return res
      .status(405)
      .json({ success: false, error: "Method Not Allowed" });
  }

  // ---- helpers ----
  const normalizeTicker = (input) => {
    if (!input) return null;
    let s = String(input).trim().toUpperCase();
    if (!/\.T$/.test(s)) {
      s = s.replace(/\..*$/, "");
      s = `${s}.T`;
    }
    return s;
  };

  const mkError = (code, message, details = {}) => {
    const err = new Error(message);
    err.name = "DataIntegrityError";
    err.code = code;
    err.details = details;
    return err;
  };
  const toNumber = (val) => (isNaN(parseFloat(val)) ? 0 : parseFloat(val));
  const getDateYearsAgo = (years) => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - years);
    return d;
  };

  // ---- your function (tidied + safe fallbacks) ----
  async function fetchYahooFinanceData(ticker, sector = "") {
    try {
      const now = new Date();
      const oneYearAgo = getDateYearsAgo(1);
      const fiveYearsAgo = getDateYearsAgo(5);

      const [quote, historicalPrices, dividendEvents, summary] =
        await Promise.all([
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
              "summaryDetail",
            ],
          }),
        ]);

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

      // ---- indicators (same as yours) ----
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

      const closes = historicalPrices.map((d) => d.close || 0);
      const { macd, signal } = calculateMACD(closes);
      const yahooData = {
        currentPrice: toNumber(quote.regularMarketPrice),
        highPrice:
          toNumber(quote.regularMarketDayHigh) || toNumber(lastBar.high),
        lowPrice: toNumber(quote.regularMarketDayLow) || toNumber(lastBar.low),
        openPrice: toNumber(quote.regularMarketOpen) || toNumber(lastBar.open),
        prevClosePrice:
          toNumber(quote.regularMarketPreviousClose) || toNumber(prevBar.close),
        todayVolume:
          toNumber(quote.regularMarketVolume) || toNumber(lastBar.volume || 0), // fallback
        marketCap: toNumber(quote.marketCap),
        peRatio: toNumber(
          quote.trailingPE ??
            summary?.defaultKeyStatistics?.trailingPE ??
            summary?.summaryDetail?.trailingPE
        ),
        pbRatio: toNumber(
          quote.priceToBook ??
            summary?.defaultKeyStatistics?.priceToBook ??
            summary?.summaryDetail?.priceToBook
        ),
        priceToSales: toNumber(
          summary?.summaryDetail?.priceToSalesTrailing12Months
        ),
        dividendYield: toNumber(quote.dividendYield) * 100,
        dividendGrowth5yr:
          Array.isArray(safeDividendEvents) &&
          safeDividendEvents.length >= 2 &&
          safeDividendEvents[0].dividends
            ? (((safeDividendEvents.at(-1).dividends -
                safeDividendEvents[0].dividends) /
                safeDividendEvents[0].dividends) *
                100) /
              5
            : 0,
        fiftyTwoWeekHigh: toNumber(quote.fiftyTwoWeekHigh),
        fiftyTwoWeekLow: toNumber(quote.fiftyTwoWeekLow),
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
        bollingerMid: toNumber(calculateBollinger(closes).mid),
        bollingerUpper: toNumber(calculateBollinger(closes).upper),
        bollingerLower: toNumber(calculateBollinger(closes).lower),
        stochasticK: toNumber(calculateStochastic(historicalPrices).k),
        stochasticD: toNumber(calculateStochastic(historicalPrices).d),
        obv: toNumber(calculateOBV(historicalPrices)),
        atr14: toNumber(calculateATR(historicalPrices)),
        regularMarketTime: quote.regularMarketTime || null,
        exchange: quote.fullExchangeName || quote.exchange || null,
      };

      // Relaxed requireds (allow 0 for some indicators)
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
        throw mkError(
          "MISSING_FIELDS",
          `Missing/zero fields: ${missing.join(", ")}`,
          {
            ticker,
            missingFields: missing,
            snapshot: yahooData,
            rawQuote: quote,
          }
        );
      }

      return yahooData;
    } catch (err) {
      if (err && err.name === "DataIntegrityError") throw err;
      throw new Error(
        `fetchYahooFinanceData failed for ${ticker}: ${
          err.stack || err.message
        }`
      );
    }
  }

  try {
    // parse input
    let body = {};
    if (req.method === "POST") {
      const chunks = [];
      for await (const ch of req) chunks.push(ch);
      const raw = Buffer.concat(chunks).toString("utf8");
      body = raw ? JSON.parse(raw) : {};
    }
    const rawTicker =
      req.method === "GET"
        ? req.query?.ticker || req.query?.code || req.query?.t
        : body?.ticker?.code || body?.ticker || body?.code || body?.t;

    const rawSector =
      req.method === "GET"
        ? req.query?.sector || ""
        : body?.ticker?.sector || body?.sector || "";

    const code = normalizeTicker(rawTicker);
    if (!code)
      return res.status(400).json({ success: false, error: "Missing ticker" });

    const sector = typeof rawSector === "string" ? rawSector : "Unknown";

    const yahooData = await fetchYahooFinanceData(code, sector);

    // ✅ shape expected by main.js
    return res
      .status(200)
      .json({ success: true, data: { code, sector, yahooData } });
  } catch (err) {
    // Known data issues: return 200 with success:false so caller can show a useful message
    if (err && err.name === "DataIntegrityError") {
      console.error("DataIntegrityError:", err.code, err.message, err.details);
      return res
        .status(200)
        .json({
          success: false,
          error: err.message,
          code: err.code,
          details: err.details,
        });
    }
    // Unknown runtime error: still include details in JSON so the caller can print it
    console.error("stocks endpoint error:", err);
    return res
      .status(500)
      .json({ success: false, error: String(err?.message || err) });
  }
};
