async function fetchYahooFinanceData(ticker, sector = "") {
  // Small helper to throw typed errors you can inspect in the route handler
  const mkError = (code, message, details = {}) => {
    const err = new Error(message);
    err.name = "DataIntegrityError";
    err.code = code;
    err.details = details;
    return err;
  };

  // Helper to convert values to numbers, returning 0 for invalid inputs
  const toNumber = (val) => {
    const num = parseFloat(val);
    return isNaN(num) ? 0 : num;
  };

  // Helper to get dates in the past
  const getDateYearsAgo = (years) => {
    const date = new Date();
    date.setFullYear(date.getFullYear() - years);
    return date;
  };

  try {
    console.log(`Fetching all data for ticker: ${ticker}`);

    const now = new Date();
    const oneYearAgo = getDateYearsAgo(1);
    const fiveYearsAgo = getDateYearsAgo(5);

    // Fetch in parallel
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

    // --- SAFETY CHECKS (now throwing) ---
    if (!Array.isArray(historicalPrices) || !historicalPrices.length) {
      throw mkError("NO_HISTORICAL", `No historical prices for ${ticker}`, {
        ticker,
      });
    }
    if (!quote) {
      throw mkError("NO_QUOTE", `No quote for ${ticker}`, { ticker });
    }

    const safeDividendEvents = Array.isArray(dividendEvents)
      ? dividendEvents
      : [];
    const lastBar = historicalPrices[historicalPrices.length - 1] || {};
    const prevBar = historicalPrices[historicalPrices.length - 2] || {};

    // --- INDICATOR HELPERS (unchanged) ---
    function calculateMA(data, days) {
      if (data.length < days) return 0;
      const sum = data
        .slice(-days)
        .reduce((acc, val) => acc + (val.close || 0), 0);
      return sum / days;
    }

    function calculateEMA(prices, period) {
      if (prices.length < period) return [];
      const k = 2 / (period + 1);
      const result = [];
      let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
      for (let i = period - 1; i < prices.length; i++) {
        if (i === period - 1) result.push(ema);
        else {
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
        .map((v, i) => v - emaSlow[i]);
      const signalLine = calculateEMA(macdLine, signal);
      return { macd: macdLine.pop() || 0, signal: signalLine.pop() || 0 };
    }

    function calculateBollingerBands(closes, period = 20, multiplier = 2) {
      if (closes.length < period) return { upper: 0, lower: 0, mid: 0 };
      const recent = closes.slice(-period);
      const mid = recent.reduce((acc, v) => acc + v, 0) / period;
      const variance =
        recent.reduce((acc, v) => acc + Math.pow(v - mid, 2), 0) / period;
      const stdDev = Math.sqrt(variance);
      return {
        upper: mid + multiplier * stdDev,
        lower: mid - multiplier * stdDev,
        mid,
      };
    }

    function calculateATR(data, period = 14) {
      if (data.length < period + 1) return 0;
      const relevant = data.slice(-(period + 1));
      const trs = [];
      for (let i = 1; i < relevant.length; i++) {
        const c = relevant[i],
          p = relevant[i - 1];
        const tr = Math.max(
          c.high - c.low,
          Math.abs(c.high - p.close),
          Math.abs(c.low - p.close)
        );
        trs.push(tr);
      }
      return trs.reduce((s, v) => s + v, 0) / trs.length;
    }

    function calculateStochastic(data, kPeriod = 14, dPeriod = 3) {
      if (data.length < kPeriod + dPeriod - 1) return { k: 50, d: 50 };
      const kValues = [];
      for (let i = kPeriod - 1; i < data.length; i++) {
        const slice = data.slice(i - kPeriod + 1, i + 1);
        const high = Math.max(...slice.map((d) => d.high));
        const low = Math.min(...slice.map((d) => d.low));
        const close = data[i].close;
        const k = high !== low ? ((close - low) / (high - low)) * 100 : 50;
        kValues.push(k);
      }
      if (kValues.length < dPeriod) return { k: kValues.at(-1) || 50, d: 50 };
      const dValues = [];
      for (let i = dPeriod - 1; i < kValues.length; i++) {
        const sum = kValues
          .slice(i - dPeriod + 1, i + 1)
          .reduce((a, b) => a + b, 0);
        dValues.push(sum / dPeriod);
      }
      return { k: kValues.at(-1), d: dValues.at(-1) };
    }

    function calculateOBV(data) {
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
    }

    // --- INDICATORS ---
    const closes = historicalPrices.map((d) => d.close || 0);
    const movingAverage5d = calculateMA(historicalPrices, 5);
    const movingAverage25d = calculateMA(historicalPrices, 25);
    const movingAverage50d = calculateMA(historicalPrices, 50);
    const movingAverage75d = calculateMA(historicalPrices, 75);
    const movingAverage200d = calculateMA(historicalPrices, 200);
    const rsi = calculateRSI(closes);
    const { macd, signal } = calculateMACD(closes);
    const bollinger = calculateBollingerBands(closes);
    const atr = calculateATR(historicalPrices);
    const stochastic = calculateStochastic(historicalPrices);
    const obv = calculateOBV(historicalPrices);

    // --- TODAY'S H/L/V WITH FALLBACKS ---
    const currentPrice = toNumber(quote.regularMarketPrice);
    const todayHighPrimary = toNumber(quote.regularMarketDayHigh);
    const todayLowPrimary = toNumber(quote.regularMarketDayLow);
    const todayOpenPrimary = toNumber(quote.regularMarketOpen);
    const todayVolume = toNumber(quote.regularMarketVolume); // Now required

    const highPrice = todayHighPrimary || toNumber(lastBar.high);
    const lowPrice = todayLowPrimary || toNumber(lastBar.low);
    const openPrice = todayOpenPrimary || toNumber(lastBar.open);
    const prevClosePrice =
      toNumber(quote.regularMarketPreviousClose) || toNumber(prevBar.close);

    // --- Robust PE/PB fallbacks ---
    const peRatio = toNumber(
      quote.trailingPE ??
        summary?.defaultKeyStatistics?.trailingPE ??
        summary?.summaryDetail?.trailingPE
    );
    const pbRatio = toNumber(
      quote.priceToBook ??
        summary?.defaultKeyStatistics?.priceToBook ??
        summary?.summaryDetail?.priceToBook
    );

    const epsTrailing = toNumber(quote.epsTrailingTwelveMonths);
    const epsForward = toNumber(quote.epsForward);
    const epsGrowthRate = epsTrailing
      ? ((epsForward - epsTrailing) / Math.abs(epsTrailing)) * 100
      : 0;

    // --- FINAL DATA ---
    const yahooData = {
      currentPrice,
      highPrice,
      lowPrice,
      openPrice,
      prevClosePrice,
      todayVolume,

      marketCap: toNumber(quote.marketCap),
      peRatio,
      pbRatio,
      priceToSales: toNumber(
        summary?.summaryDetail?.priceToSalesTrailing12Months
      ),

      dividendYield: toNumber(quote.dividendYield) * 100,
      dividendGrowth5yr:
        safeDividendEvents.length >= 2 && safeDividendEvents[0].dividends
          ? (((safeDividendEvents[safeDividendEvents.length - 1].dividends -
              safeDividendEvents[0].dividends) /
              safeDividendEvents[0].dividends) *
              100) /
            5
          : 0,

      fiftyTwoWeekHigh: toNumber(quote.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: toNumber(quote.fiftyTwoWeekLow),

      epsTrailingTwelveMonths: epsTrailing,
      epsForward,
      epsGrowthRate,
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
      stochasticK: toNumber(stochastic.k),
      stochasticD: toNumber(stochastic.d),
      obv: toNumber(obv),
      atr14: toNumber(atr),

      regularMarketTime: quote.regularMarketTime || null,
      exchange: quote.fullExchangeName || quote.exchange || null,
    };

    // --- STRICT DATA INTEGRITY CHECK (now throws) ---
    const requiredFields = [
      "currentPrice",
      "highPrice",
      "lowPrice",
      "todayVolume", // Added volume to required fields
      "fiftyTwoWeekHigh",
      "fiftyTwoWeekLow",
      "movingAverage5d",
      "movingAverage25d",
      "movingAverage50d",
      "movingAverage75d",
      "movingAverage200d",
      "rsi14",
      "atr14",
      "stochasticK",
      "stochasticD",
      "obv",
    ];

    const missingFields = requiredFields
      .filter((field) => {
        const v = yahooData[field];
        return v === undefined || v === null || v === 0;
      })
      .filter((f) => !(f === "obv" && yahooData[f] === 0)); // OBV=0 allowed

    if (missingFields.length > 0) {
      throw mkError(
        "MISSING_FIELDS",
        `Missing/zero critical fields for ${ticker}: ${missingFields.join(
          ", "
        )}`,
        // Added raw quote object to error details for easier debugging
        { ticker, missingFields, snapshot: yahooData, rawQuote: quote }
      );
    }

    console.log(`✅ All critical data present for ${ticker}.`);
    return yahooData;
  } catch (error) {
    // Re-throw as DataIntegrityError if it's not already, so your route can handle uniformly
    if (error && error.name === "DataIntegrityError") {
      throw error;
    }
    throw new Error(
      `fetchYahooFinanceData failed for ${ticker}: ${
        error.stack || error.message
      }`
    );
  }
}
