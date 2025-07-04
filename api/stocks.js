const yahooFinance = require("yahoo-finance2").default;

// Helper to safely convert values to numbers, defaulting to 0.
function toNumber(value) {
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

// Helper to get a date from a number of years ago.
function getDateYearsAgo(years) {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date;
}

// Helper to check if a stock is in a financial-related sector.
function isFinancialSector(sector) {
  const financialSectors = [
    "Banking",
    "Securities",
    "Insurance",
    "Other Financial Services",
    "Real Estate",
  ];
  return financialSectors.some((s) => sector?.includes(s));
}

/**
 * Main function to fetch all required data for a stock from Yahoo Finance
 * and calculate a suite of technical indicators.
 */
async function fetchYahooFinanceData(ticker, sector = "") {
  try {
    console.log(`Fetching all data for ticker: ${ticker}`);

    const now = new Date();
    const oneYearAgo = getDateYearsAgo(1);
    const fiveYearsAgo = getDateYearsAgo(5);

    // Fetch all data points in parallel for efficiency.
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

    // --- SAFETY CHECKS ---
    if (!Array.isArray(historicalPrices)) {
      console.error(
        `Error or invalid format for historicalPrices for ${ticker}.`
      );
      return null;
    }
    const safeDividendGrowth = Array.isArray(dividendEvents)
      ? dividendEvents
      : [];

    if (!quote || !historicalPrices.length) {
      console.warn(`No essential Yahoo Finance data available for ${ticker}`);
      return null;
    }

    // --- INDICATOR CALCULATION HELPERS ---
    function calculateMA(data, days) {
      if (data.length < days) return 0;
      const sum = data.slice(-days).reduce((acc, val) => acc + val.close, 0);
      return sum / days;
    }

    function calculateEMA(prices, period) {
      if (prices.length < period) return [];
      const k = 2 / (period + 1);
      const result = [];
      let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
      for (let i = period - 1; i < prices.length; i++) {
        if (i === period - 1) {
          result.push(ema);
        } else {
          ema = prices[i] * k + result[result.length - 1] * (1 - k);
          result.push(ema);
        }
      }
      return result;
    }

    function calculateRSI(closes, period = 14) {
      if (closes.length < period + 1) return 50;
      let gains = 0,
        losses = 0;
      for (let i = closes.length - period; i < closes.length; i++) {
        const delta = closes[i] - closes[i - 1];
        if (delta >= 0) gains += delta;
        else losses -= delta;
      }
      const avgGain = gains / period;
      const avgLoss = losses / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      return 100 - 100 / (1 + rs);
    }

    function calculateMACD(closes, fast = 12, slow = 26, signal = 9) {
      if (closes.length < slow) return { macd: 0, signal: 0 };
      const emaFast = calculateEMA(closes, fast);
      const emaSlow = calculateEMA(closes, slow);
      const macdLine = emaFast
        .slice(emaFast.length - emaSlow.length)
        .map((val, i) => val - emaSlow[i]);
      const signalLine = calculateEMA(macdLine, signal);
      return {
        macd: macdLine.pop() || 0,
        signal: signalLine.pop() || 0,
      };
    }

    function calculateBollingerBands(closes, period = 20, multiplier = 2) {
      if (closes.length < period) return { upper: 0, lower: 0, mid: 0 };
      const recent = closes.slice(-period);
      const mid = recent.reduce((acc, val) => acc + val, 0) / period;
      const variance =
        recent.reduce((acc, val) => acc + Math.pow(val - mid, 2), 0) / period;
      const stdDev = Math.sqrt(variance);
      return {
        upper: mid + multiplier * stdDev,
        lower: mid - multiplier * stdDev,
        mid: mid,
      };
    }

    function calculateATR(data, period = 14) {
      if (data.length < period + 1) return 0;
      const trs = [];
      const relevantData = data.slice(-(period + 1));
      for (let i = 1; i < relevantData.length; i++) {
        const current = relevantData[i];
        const previous = relevantData[i - 1];
        const tr = Math.max(
          current.high - current.low,
          Math.abs(current.high - previous.close),
          Math.abs(current.low - previous.close)
        );
        trs.push(tr);
      }
      return trs.reduce((sum, val) => sum + val, 0) / trs.length;
    }

    // --- DATA CALCULATION ---
    const closes = historicalPrices.map((d) => d.close);
    const movingAverage5d = calculateMA(historicalPrices, 5);
    const movingAverage25d = calculateMA(historicalPrices, 25);
    const movingAverage50d = calculateMA(historicalPrices, 50);
    const movingAverage75d = calculateMA(historicalPrices, 75);
    const movingAverage200d = calculateMA(historicalPrices, 200);
    const rsi = calculateRSI(closes);
    const { macd, signal } = calculateMACD(closes);
    const bollinger = calculateBollingerBands(closes);
    const atr = calculateATR(historicalPrices);

    const epsTrailing = toNumber(quote.epsTrailingTwelveMonths);
    const epsForward = toNumber(quote.epsForward);
    const epsGrowthRate = epsTrailing
      ? ((epsForward - epsTrailing) / Math.abs(epsTrailing)) * 100
      : 0;

    // --- FINAL DATA ASSEMBLY ---
    const yahooData = {
      currentPrice: toNumber(quote.regularMarketPrice),
      highPrice: toNumber(quote.regularMarketDayHigh),
      lowPrice: toNumber(quote.regularMarketDayLow),
      openPrice: toNumber(quote.regularMarketOpen),
      prevClosePrice: toNumber(quote.regularMarketPreviousClose),
      marketCap: toNumber(quote.marketCap),
      peRatio: toNumber(quote.trailingPE),
      pbRatio: toNumber(quote.priceToBook),
      priceToSales: toNumber(
        summary?.summaryDetail?.priceToSalesTrailing12Months
      ),
      dividendYield: toNumber(quote.dividendYield) * 100,
      dividendGrowth5yr:
        safeDividendGrowth.length >= 2 && safeDividendGrowth[0].dividends
          ? (((safeDividendGrowth[safeDividendGrowth.length - 1].dividends -
              safeDividendGrowth[0].dividends) /
              safeDividendGrowth[0].dividends) *
              100) /
            5
          : 0,
      fiftyTwoWeekHigh: toNumber(quote.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: toNumber(quote.fiftyTwoWeekLow),
      epsTrailingTwelveMonths: epsTrailing,
      epsForward: epsForward,
      epsGrowthRate: epsGrowthRate,
      debtEquityRatio: toNumber(summary?.financialData?.debtToEquity),
      movingAverage5d: toNumber(movingAverage5d),
      movingAverage25d: toNumber(movingAverage25d),
      movingAverage50d: toNumber(movingAverage50d),
      movingAverage75d: toNumber(movingAverage75d),
      movingAverage200d: toNumber(movingAverage200d),
      rsi14: toNumber(rsi),
      macd: toNumber(macd),
      macdSignal: toNumber(signal),
      bollingerMid: toNumber(bollinger.mid),
      bollingerUpper: toNumber(bollinger.upper),
      bollingerLower: toNumber(bollinger.lower),
      atr14: toNumber(atr),
    };

    // --- STRICT DATA INTEGRITY CHECK ---
    const requiredFields = [
      "currentPrice",
      "highPrice",
      "lowPrice",
      "marketCap",
      "peRatio",
      "pbRatio",
      "fiftyTwoWeekHigh",
      "fiftyTwoWeekLow",
      "movingAverage5d",
      "movingAverage25d",
      "movingAverage50d",
      "movingAverage75d",
      "movingAverage200d",
      "rsi14",
      "atr14",
    ];

    const missingFields = requiredFields.filter((field) => {
      const value = yahooData[field];
      return value === undefined || value === null || value === 0;
    });

    if (missingFields.length > 0) {
      console.warn(
        `⚠️ Disqualifying ${ticker} due to missing or zero-value critical data: ${missingFields.join(
          ", "
        )}`
      );
      return null; // Disqualify the stock
    }

    console.log(`✅ All critical data present for ${ticker}.`);
    return yahooData;
  } catch (error) {
    console.error(
      `Error in fetchYahooFinanceData for ${ticker}:`,
      error.stack || error.message
    );
    return null; // Return null on any failure
  }
}

// --- API ENDPOINT LOGIC ---
const allowedOrigins = [
  "https://thegoodmanagers.com",
  "https://www.thegoodmanagers.com",
];

module.exports = async (req, res) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ success: false, error: "Method not allowed" });
  }

  try {
    const { ticker } = req.body;
    if (!ticker || !ticker.code) {
      return res
        .status(400)
        .json({ success: false, error: "Missing or invalid 'ticker' in body" });
    }

    const yahooData = await fetchYahooFinanceData(ticker.code, ticker.sector);

    if (!yahooData) {
      return res
        .status(404)
        .json({
          success: false,
          error: `No data available for ticker ${ticker.code}`,
        });
    }

    return res.status(200).json({
      success: true,
      data: {
        code: ticker.code,
        sector: ticker.sector,
        yahooData,
      },
    });
  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
