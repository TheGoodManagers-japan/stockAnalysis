// /api/history.js  (yahoo-finance2 v3 + retry + robust CORS + 429)

// /api/history.js

const YahooFinanceModule = require("yahoo-finance2");
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

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
});


/* --------------------------- CORS helpers --------------------------- */

const allowedOrigins = new Set([
  "https://thegoodmanagers.com",
  "https://www.thegoodmanagers.com",
]);

function getHeader(req, name) {
  const key = String(name).toLowerCase();
  // Node-style (req.headers is an object)
  const v1 = req?.headers?.[key];
  if (typeof v1 === "string") return v1;
  // Some frameworks can give arrays
  if (Array.isArray(v1)) return v1[0];
  // Edge-style (req.headers is a Headers instance)
  const v2 = req?.headers?.get?.(name) || req?.headers?.get?.(key);
  return typeof v2 === "string" ? v2 : undefined;
}

function applyCors(req, res) {
  const origin = getHeader(req, "origin");

  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");

  // Echo requested headers to satisfy real preflights (Authorization, X-* etc)
  const reqHeaders =
    getHeader(req, "access-control-request-headers") || "Content-Type";
  res.setHeader("Access-Control-Allow-Headers", reqHeaders);

  res.setHeader("Access-Control-Max-Age", "600");
}

/* ------------------------ Throttle + retry helpers ------------------------ */

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

/* ------------------------ Business logic ------------------------ */

async function fetchHistoricalData(ticker, years = 3) {
  try {
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - years);
    const today = new Date();

    console.log(
      `Fetching historical data for ticker: ${ticker} from ${startDate.toISOString()} to ${today.toISOString()}`
    );

    const data = await withRetry(() =>
      yahooFinance.chart(ticker, {
        period1: startDate,
        period2: today,
        interval: "1d",
      })
    );

    if (!data || !data.quotes || data.quotes.length === 0) {
      console.warn(`No historical data available for ticker: ${ticker}`);
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

    console.log(
      `Filtered out ${data.quotes.length - validQuotes.length} invalid quotes`
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

/* --------------------------- Serverless handler --------------------------- */

module.exports = async (req, res) => {
  applyCors(req, res);

  // Preflight must return the CORS headers too (applyCors already ran)
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res
      .status(405)
      .json({ success: false, message: "Method Not Allowed" });
  }

  try {
    const ticker = String(req.query?.ticker || "").trim();
    const yearsRaw = req.query?.years;

    if (!ticker) {
      return res
        .status(400)
        .json({ success: false, message: "Ticker is required" });
    }

    const numYears = yearsRaw ? parseInt(yearsRaw, 10) : 3;

    const data = await fetchHistoricalData(ticker, numYears);

    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No historical data available for ${ticker}`,
      });
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
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

    return res.status(500).json({ success: false, error: error.message });
  }
};
