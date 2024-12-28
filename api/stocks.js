const axios = require("axios");
const Bottleneck = require("bottleneck");

// Use environment variables for the API key
const API_KEY = process.env.ALPHA_VANTAGE_API_KEY;

// Tickers and their sectors
const tickers = [
  { code: "4151.T", sector: "Pharmaceuticals" },
  { code: "4502.T", sector: "Pharmaceuticals" },
  { code: "4503.T", sector: "Pharmaceuticals" },
  { code: "7203.T", sector: "Automobiles" },
  { code: "6758.T", sector: "Electronics" },
  { code: "9984.T", sector: "Technology" },
];

// Bottleneck to handle rate limits
const limiter = new Bottleneck({
  minTime: 15000, // Alpha Vantage free-tier allows 1 request every 15 seconds
  maxConcurrent: 1,
});

// Utility function to safely parse numbers
function toNumber(value) {
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

// Fetch stock data from Alpha Vantage
async function fetchAlphaVantageData(ticker) {
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${ticker}&apikey=${API_KEY}`;
  try {
    const response = await limiter.schedule(() => axios.get(url));
    const timeSeries = response.data["Time Series (Daily)"];

    if (!timeSeries) {
      console.warn(`No Alpha Vantage data available for ${ticker}`);
      return null;
    }

    const latestDate = Object.keys(timeSeries)[0];
    const latestData = timeSeries[latestDate];

    const previousDate = Object.keys(timeSeries)[1];
    const previousData = timeSeries[previousDate];

    return {
      currentPrice: toNumber(latestData["4. close"]),
      highPrice: toNumber(latestData["2. high"]),
      lowPrice: toNumber(latestData["3. low"]),
      openPrice: toNumber(latestData["1. open"]),
      prevClosePrice: toNumber(previousData["4. close"]),
    };
  } catch (error) {
    console.error(
      `Error fetching Alpha Vantage data for ${ticker}:`,
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
    const stockData = await fetchAlphaVantageData(code);
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
