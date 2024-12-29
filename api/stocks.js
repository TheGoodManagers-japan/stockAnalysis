const yahooFinance = require("yahoo-finance2").default;
const axios = require("axios");

// Custom headers for Yahoo Finance requests
const customHeaders = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, Gecko) Chrome/91.0.4472.124 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
};

// Tickers and their sectors
const tickers = [
  { code: "4151.T", sector: "Pharmaceuticals" },
  { code: "4502.T", sector: "Pharmaceuticals" },
  { code: "9532.T", sector: "Gas" },
];

// Utility function to safely parse numbers
function toNumber(value) {
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

// Utility function to calculate the median of an array
function calculateMedian(arr) {
  if (arr.length === 0) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  } else {
    return sorted[middle];
  }
}

// Fetch stock data from Yahoo Finance with custom headers
async function fetchYahooFinanceData(ticker) {
  try {
    console.log(`Fetching data for ticker: ${ticker}`);

    // Fetch stock data using yahoo-finance2 with custom headers
    const data = await yahooFinance.quote(ticker, { headers: customHeaders });

    if (!data) {
      console.warn(`No Yahoo Finance data available for ${ticker}`);
      return null;
    }

    console.log(`Fetched Yahoo Finance data for ${ticker}:`, data);

    return {
      currentPrice: toNumber(data.regularMarketPrice),
      highPrice: toNumber(data.regularMarketDayHigh),
      lowPrice: toNumber(data.regularMarketDayLow),
      openPrice: toNumber(data.regularMarketOpen),
      prevClosePrice: toNumber(data.regularMarketPreviousClose),
      marketCap: toNumber(data.marketCap),
      peRatio: toNumber(data.trailingPE),
      pbRatio: toNumber(data.priceToBook),
      dividendYield: toNumber(data.dividendYield) * 100, // Convert to percentage
      fiftyTwoWeekHigh: toNumber(data.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: toNumber(data.fiftyTwoWeekLow),
      eps: toNumber(data.epsTrailingTwelveMonths),
    };
  } catch (error) {
    console.error(`Error fetching data for ${ticker}:`, error.message);
    return null;
  }
}

// Compute stock score with additional metrics
function computeScore(data) {
  const {
    peRatio,
    pbRatio,
    dividendYield,
    currentPrice,
    highPrice,
    lowPrice,
    fiftyTwoWeekHigh,
    fiftyTwoWeekLow,
  } = data;

  // Weighted scoring based on various metrics
  return (
    0.3 * (1 / (peRatio || 1)) + // Lower PE ratio is better
    0.2 * (1 / (pbRatio || 1)) + // Lower PB ratio is better
    0.2 * (dividendYield || 0) + // Higher dividend yield is better
    0.2 * ((fiftyTwoWeekHigh - fiftyTwoWeekLow) / (currentPrice || 1)) + // Volatility over the year
    0.1 * ((highPrice - lowPrice) / (currentPrice || 1)) // Daily volatility
  );
}

// Calculate stop-loss and target price
function calculateStopLossAndTarget(data) {
  const { currentPrice, highPrice, lowPrice } = data;

  if (currentPrice <= 0 || highPrice <= 0 || lowPrice <= 0) {
    return { stopLoss: 0, targetPrice: 0 };
  }

  const stopLoss = currentPrice * 0.9; // 10% below current price

  const targetPrice = currentPrice * 1.15; // Target price as 15% above current price

  return {
    stopLoss: Math.max(stopLoss, lowPrice * 0.95), // At least 5% below recent low
    targetPrice,
  };
}

module.exports = async (req, res) => {
  try {
    const { sectorResults, sectorMetrics } = await scanStocks();
    res.json({
      success: true,
      data: sectorResults,
      metrics: sectorMetrics,
    });
  } catch (error) {
    console.error("Error during stock scanning:", error.message);
    res.status(500).json({
      success: false,
      message: "An error occurred while scanning stocks.",
    });
  }
};
