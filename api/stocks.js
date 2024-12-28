const yahooFinance = require("yahoo-finance2").default;
const axios = require("axios");

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

// Fetch stock data from Yahoo Finance and 30-day prediction
async function fetchYahooFinanceData(ticker) {
  try {
    console.log(`Fetching data for ticker: ${ticker}`);
    const data = await yahooFinance.quote(ticker);

    if (!data) {
      console.warn(`No Yahoo Finance data available for ${ticker}`);
      return null;
    }

    console.log(`Fetched Yahoo Finance data for ${ticker}:`, data);

    // Call the prediction API for the ticker
    console.log(`Fetching predictions for ticker: ${ticker}`);
    const predictionResponse = await axios.get(
      `https://stock-analysis-thegoodmanagers-japan-aymerics-projects-60f33831.vercel.app/api/predict/${ticker}`
    );
    const predictions = predictionResponse.data.predictions || [];

    if (!predictions.length) {
      console.warn(`No predictions available for ${ticker}`);
    }

    console.log(`Fetched predictions for ${ticker}:`, predictions);

    // Extract the predicted price 30 days into the future
    const predictedPrice = predictions.length
      ? predictions[predictions.length - 1]
      : null;

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
      predictedPrice, // Add the predicted price
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
    predictedPrice,
  } = data;

  // Weighted scoring based on various metrics
  const futureFactor = predictedPrice
    ? 0.2 * ((predictedPrice - currentPrice) / currentPrice)
    : 0; // Consider predicted price change

  return (
    0.3 * (1 / (peRatio || 1)) + // Lower PE ratio is better
    0.2 * (1 / (pbRatio || 1)) + // Lower PB ratio is better
    0.2 * (dividendYield || 0) + // Higher dividend yield is better
    0.2 * ((fiftyTwoWeekHigh - fiftyTwoWeekLow) / (currentPrice || 1)) + // Volatility over the year
    0.1 * ((highPrice - lowPrice) / (currentPrice || 1)) + // Daily volatility
    futureFactor // Include future factor based on prediction
  );
}

// Calculate stop-loss and target price
function calculateStopLossAndTarget(data) {
  const { currentPrice, highPrice, lowPrice, predictedPrice } = data;

  if (currentPrice <= 0 || highPrice <= 0 || lowPrice <= 0) {
    return { stopLoss: 0, targetPrice: 0 };
  }

  const stopLoss = currentPrice * 0.9; // 10% below current price

  // Combine predicted price and recent highs to determine the target price
  const targetPrice = predictedPrice
    ? 0.7 * predictedPrice +
      0.3 * Math.min(highPrice * 1.1, currentPrice * 1.15)
    : currentPrice * 1.15; // Weighted blend of prediction and recent highs

  return {
    stopLoss: Math.max(stopLoss, lowPrice * 0.95), // At least 5% below recent low
    targetPrice,
  };
}

// Handle stock scanning
async function scanStocks() {
  const sectorResults = {};
  const logs = []; // Log all data for debugging

  for (const { code, sector } of tickers) {
    console.log(`Processing ticker: ${code} in sector: ${sector}`);
    const stockData = await fetchYahooFinanceData(code);
    if (!stockData) {
      console.warn(`Skipping ticker ${code} due to missing data.`);
      continue;
    }

    const score = computeScore(stockData);
    const { stopLoss, targetPrice } = calculateStopLossAndTarget(stockData);

    logs.push({ ticker: code, stockData, score, stopLoss, targetPrice });

    if (!sectorResults[sector]) {
      sectorResults[sector] = [];
    }

    sectorResults[sector].push({
      ticker: code,
      currentPrice: stockData.currentPrice,
      marketCap: stockData.marketCap,
      peRatio: stockData.peRatio,
      pbRatio: stockData.pbRatio,
      dividendYield: stockData.dividendYield,
      eps: stockData.eps,
      fiftyTwoWeekHigh: stockData.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: stockData.fiftyTwoWeekLow,
      predictedPrice: stockData.predictedPrice, // Include predicted price
      score,
      stopLoss,
      targetPrice,
    });
  }

  // Calculate average and median scores for each sector
  const sectorMetrics = {};
  Object.keys(sectorResults).forEach((sector) => {
    const scores = sectorResults[sector].map((result) => result.score);
    const averageScore =
      scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const medianScore = calculateMedian(scores);

    console.log(
      `Sector: ${sector}, Scores: ${scores}, Average: ${averageScore}, Median: ${medianScore}`
    );

    sectorMetrics[sector] = {
      averageScore,
      medianScore,
    };

    // Sort stocks by score within each sector
    sectorResults[sector].sort((a, b) => b.score - a.score);
    sectorResults[sector] = sectorResults[sector].slice(0, 10);
  });

  console.log("Sector Results:", JSON.stringify(sectorResults, null, 2));
  console.log("Sector Metrics:", JSON.stringify(sectorMetrics, null, 2));
  console.log("Logs:", JSON.stringify(logs, null, 2));

  return { sectorResults, sectorMetrics };
}

// Vercel Serverless API Handler
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
