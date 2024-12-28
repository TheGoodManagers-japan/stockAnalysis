const yahooFinance = require("yahoo-finance2").default;

// Tickers and their sectors
const tickers = [{ code: "4151.T", sector: "Pharmaceuticals" }];

// Utility function to safely parse numbers
function toNumber(value) {
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

// Fetch stock data from Yahoo Finance
async function fetchYahooFinanceData(ticker) {
  try {
    // Fetch stock data using yahoo-finance2 library
    const data = await yahooFinance.quote(ticker);

    if (!data) {
      console.warn(`No Yahoo Finance data available for ${ticker}`);
      return null;
    }

    return {
      currentPrice: toNumber(data.regularMarketPrice),
      highPrice: toNumber(data.regularMarketDayHigh),
      lowPrice: toNumber(data.regularMarketDayLow),
      openPrice: toNumber(data.regularMarketOpen),
      prevClosePrice: toNumber(data.regularMarketPreviousClose),
    };
  } catch (error) {
    console.error(
      `Error fetching Yahoo Finance data for ${ticker}:`,
      error.message
    );
    return null;
  }
}

// Compute stock score
function computeScore(data) {
  const { currentPrice, highPrice, lowPrice, prevClosePrice } = data;

  return (
    0.3 * (1 / (currentPrice || 1)) +
    0.2 * ((highPrice - lowPrice) / (currentPrice || 1)) +
    0.2 * ((currentPrice - prevClosePrice) / (prevClosePrice || 1)) +
    0.3 * ((highPrice - currentPrice) / (currentPrice || 1))
  );
}

// Calculate stop-loss and target price
function calculateStopLossAndTarget(data) {
  const { currentPrice, highPrice, lowPrice } = data;

  if (currentPrice <= 0 || highPrice <= 0 || lowPrice <= 0) {
    return { stopLoss: 0, targetPrice: 0 };
  }

  const stopLoss = currentPrice * 0.9; // 10% below current price
  const targetPrice = currentPrice * 1.15; // 15% above current price

  return {
    stopLoss: Math.max(stopLoss, lowPrice * 0.95), // At least 5% below recent low
    targetPrice: Math.min(targetPrice, highPrice * 1.1), // 10% above recent high
  };
}

// Handle stock scanning
async function scanStocks() {
  const sectorResults = {};

  for (const { code, sector } of tickers) {
    const stockData = await fetchYahooFinanceData(code);
    if (!stockData) {
      console.warn(`Skipping ticker ${code} due to missing data.`);
      continue;
    }

    const score = computeScore(stockData);
    const { stopLoss, targetPrice } = calculateStopLossAndTarget(stockData);

    if (!sectorResults[sector]) {
      sectorResults[sector] = [];
    }

    sectorResults[sector].push({
      ticker: code,
      score,
      stopLoss,
      targetPrice,
    });
  }

  // Sort stocks by score within each sector
  Object.keys(sectorResults).forEach((sector) => {
    sectorResults[sector].sort((a, b) => b.score - a.score);
    sectorResults[sector] = sectorResults[sector].slice(0, 10);
  });

  return sectorResults;
}

// Vercel Serverless API Handler
module.exports = async (req, res) => {
  try {
    const results = await scanStocks();
    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    console.error("Error during stock scanning:", error.message);
    res.status(500).json({
      success: false,
      message: "An error occurred while scanning stocks.",
    });
  }
};
