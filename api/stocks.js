const yahooFinance = require("yahoo-finance2").default;

function toNumber(value) {
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

function getDateYearsAgo(years) {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date;
}

async function fetchYahooFinanceData(ticker) {
  try {
    console.log(`Fetching data for ticker: ${ticker}`);

    const now = new Date();
    const oneYearAgo = getDateYearsAgo(1);
    const fiveYearsAgo = getDateYearsAgo(5);

    const [quote, historicalPrices, dividendGrowth, summary] =
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
        yahooFinance.quoteSummary(ticker, { modules: ["financialData"] }),
      ]);

    if (!quote || !historicalPrices.length) {
      console.warn(`No Yahoo Finance data available for ${ticker}`);
      return null;
    }

    function calculateMA(data, days) {
      if (data.length < days) return 0;
      const sum = data.slice(-days).reduce((acc, val) => acc + val.close, 0);
      return sum / days;
    }

    function calculateEMA(prices, period) {
      const k = 2 / (period + 1);
      let ema = prices[0];
      const result = [ema];
      for (let i = 1; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
        result.push(ema);
      }
      return result;
    }

    function calculateRSI(closes, period = 14) {
      if (closes.length < period + 1) return 0;
      let gains = 0,
        losses = 0;
      for (let i = 1; i <= period; i++) {
        const delta = closes[i] - closes[i - 1];
        if (delta >= 0) gains += delta;
        else losses -= delta;
      }
      gains /= period;
      losses /= period;
      for (let i = period + 1; i < closes.length; i++) {
        const delta = closes[i] - closes[i - 1];
        if (delta >= 0) {
          gains = (gains * (period - 1) + delta) / period;
          losses = (losses * (period - 1)) / period;
        } else {
          gains = (gains * (period - 1)) / period;
          losses = (losses * (period - 1) - delta) / period;
        }
      }
      const rs = losses === 0 ? 100 : gains / losses;
      return 100 - 100 / (1 + rs);
    }

    function calculateMACD(closes) {
      if (closes.length < 26) return { macd: 0, signal: 0 };
      const ema12 = calculateEMA(closes.slice(-26), 12);
      const ema26 = calculateEMA(closes.slice(-26), 26);
      const macdLine = ema12.map((val, i) => val - (ema26[i] || 0));
      const signalLine = calculateEMA(macdLine, 9);
      return {
        macd: macdLine[macdLine.length - 1],
        signal: signalLine[signalLine.length - 1],
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

    function calculateStochasticOscillator(data, period = 14, smoothK = 3) {
      if (data.length < period + smoothK) return { k: 0, d: 0 };
      const recent = data.slice(-period);
      const highs = recent.map((d) => d.high);
      const lows = recent.map((d) => d.low);
      const closes = recent.map((d) => d.close);
      const highestHigh = Math.max(...highs);
      const lowestLow = Math.min(...lows);
      const lastClose = closes[closes.length - 1];
      const k = ((lastClose - lowestLow) / (highestHigh - lowestLow)) * 100;
      const kValues = data
        .slice(-(period + smoothK))
        .map((d, i, arr) => {
          const slice = arr.slice(i, i + period);
          const high = Math.max(...slice.map((d) => d.high));
          const low = Math.min(...slice.map((d) => d.low));
          return ((d.close - low) / (high - low)) * 100;
        })
        .slice(0, smoothK);
      const d = kValues.reduce((acc, val) => acc + val, 0) / smoothK;
      return { k, d };
    }

    function calculateOBV(data) {
      if (data.length < 2) return 0;
      let obv = 0;
      for (let i = 1; i < data.length; i++) {
        const change = data[i].close - data[i - 1].close;
        if (change > 0) obv += data[i].volume;
        else if (change < 0) obv -= data[i].volume;
      }
      return obv;
    }

    function calculateATR(data, period = 14) {
      if (data.length < period + 1) return 0;
      const trs = data.slice(-period).map((d, i) => {
        const prevClose =
          i > 0 ? data[data.length - period + i - 1].close : d.close;
        return Math.max(
          d.high - d.low,
          Math.abs(d.high - prevClose),
          Math.abs(d.low - prevClose)
        );
      });
      return trs.reduce((sum, val) => sum + val, 0) / period;
    }

    const closes = historicalPrices.map((d) => d.close);
    const movingAverage50d = calculateMA(historicalPrices, 50);
    const movingAverage200d = calculateMA(historicalPrices, 200);
    const rsi = calculateRSI(closes);
    const { macd, signal } = calculateMACD(closes);
    const bollinger = calculateBollingerBands(closes);
    const stochastic = calculateStochasticOscillator(historicalPrices);
    const obv = calculateOBV(historicalPrices);
    const atr = calculateATR(historicalPrices);

    const epsTrailing = toNumber(quote.epsTrailingTwelveMonths);
    const epsForward = toNumber(quote.epsForward);
    const epsGrowthRate =
      epsTrailing && epsForward
        ? ((epsForward - epsTrailing) / Math.abs(epsTrailing)) * 100
        : 0;
    const debtEquityRatio = toNumber(summary?.financialData?.debtToEquity);

    return {
      currentPrice: toNumber(quote.regularMarketPrice),
      highPrice: toNumber(quote.regularMarketDayHigh),
      lowPrice: toNumber(quote.regularMarketDayLow),
      openPrice: toNumber(quote.regularMarketOpen),
      prevClosePrice: toNumber(quote.regularMarketPreviousClose),
      marketCap: toNumber(quote.marketCap),
      peRatio: toNumber(quote.trailingPE),
      pbRatio: toNumber(quote.priceToBook),
      dividendYield: toNumber(quote.dividendYield) * 100,
      dividendGrowth5yr: toNumber(
        dividendGrowth.length >= 2 && dividendGrowth[0].dividends
          ? ((dividendGrowth[dividendGrowth.length - 1].dividends -
              dividendGrowth[0].dividends) /
              dividendGrowth[0].dividends) *
              100
          : 0
      ),
      fiftyTwoWeekHigh: toNumber(quote.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: toNumber(quote.fiftyTwoWeekLow),
      epsTrailingTwelveMonths: epsTrailing,
      epsForward: epsForward,
      epsGrowthRate: epsGrowthRate,
      debtEquityRatio: debtEquityRatio,
      beta: toNumber(quote.beta),
      movingAverage50d: toNumber(movingAverage50d),
      movingAverage200d: toNumber(movingAverage200d),
      rsi14: toNumber(rsi),
      macd: toNumber(macd),
      macdSignal: toNumber(signal),
      bollingerMid: toNumber(bollinger.mid),
      bollingerUpper: toNumber(bollinger.upper),
      bollingerLower: toNumber(bollinger.lower),
      stochasticK: toNumber(stochastic.k),
      stochasticD: toNumber(stochastic.d),
      obv: toNumber(obv),
      atr14: toNumber(atr),
    };
  } catch (error) {
    console.error(
      `Error fetching data for ${ticker}:`,
      error.stack || error.message
    );
    return null;
  }
}

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

    const yahooData = await fetchYahooFinanceData(ticker.code);
    return res.status(200).json({
      success: true,
      data: {
        code: ticker.code,
        sector: ticker.sector,
        yahooData,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
