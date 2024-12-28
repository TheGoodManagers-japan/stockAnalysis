const yahooFinance = require("yahoo-finance2").default;

// Tickers and their sectors
const tickers = [
  { code: "4151.T", sector: "Pharmaceuticals" },
  { code: "4502.T", sector: "Pharmaceuticals" },
  { code: "4503.T", sector: "Pharmaceuticals" },
  { code: "4506.T", sector: "Pharmaceuticals" },
  { code: "4507.T", sector: "Pharmaceuticals" },
  { code: "4519.T", sector: "Pharmaceuticals" },
  { code: "4523.T", sector: "Pharmaceuticals" },
  { code: "4568.T", sector: "Pharmaceuticals" },
  { code: "4578.T", sector: "Pharmaceuticals" },
  { code: "6479.T", sector: "Electric Machinery" },
  { code: "6501.T", sector: "Electric Machinery" },
  { code: "6503.T", sector: "Electric Machinery" },
  { code: "6504.T", sector: "Electric Machinery" },
  { code: "6506.T", sector: "Electric Machinery" },
  { code: "6526.T", sector: "Electric Machinery" },
  { code: "6594.T", sector: "Electric Machinery" },
  { code: "6645.T", sector: "Electric Machinery" },
  { code: "6674.T", sector: "Electric Machinery" },
  { code: "6701.T", sector: "Electric Machinery" },
  { code: "6702.T", sector: "Electric Machinery" },
  { code: "6723.T", sector: "Electric Machinery" },
  { code: "6724.T", sector: "Electric Machinery" },
  { code: "6752.T", sector: "Electric Machinery" },
  { code: "6753.T", sector: "Electric Machinery" },
  { code: "6758.T", sector: "Electric Machinery" },
  { code: "6762.T", sector: "Electric Machinery" },
  { code: "6770.T", sector: "Electric Machinery" },
  { code: "6841.T", sector: "Electric Machinery" },
  { code: "6857.T", sector: "Electric Machinery" },
  { code: "6861.T", sector: "Electric Machinery" },
  { code: "6902.T", sector: "Electric Machinery" },
  { code: "6920.T", sector: "Electric Machinery" },
  { code: "6952.T", sector: "Electric Machinery" },
  { code: "6954.T", sector: "Electric Machinery" },
  { code: "6971.T", sector: "Electric Machinery" },
  { code: "6976.T", sector: "Electric Machinery" },
  { code: "6981.T", sector: "Electric Machinery" },
  { code: "7735.T", sector: "Electric Machinery" },
  { code: "7751.T", sector: "Electric Machinery" },
  { code: "7752.T", sector: "Electric Machinery" },
  { code: "8035.T", sector: "Electric Machinery" },
  { code: "7201.T", sector: "Automobiles & Auto parts" },
  { code: "7202.T", sector: "Automobiles & Auto parts" },
  { code: "7203.T", sector: "Automobiles & Auto parts" },
  { code: "7205.T", sector: "Automobiles & Auto parts" },
  { code: "7211.T", sector: "Automobiles & Auto parts" },
  { code: "7261.T", sector: "Automobiles & Auto parts" },
  { code: "7267.T", sector: "Automobiles & Auto parts" },
  { code: "7269.T", sector: "Automobiles & Auto parts" },
  { code: "7270.T", sector: "Automobiles & Auto parts" },
  { code: "7272.T", sector: "Automobiles & Auto parts" },
  { code: "4543.T", sector: "Precision Instruments" },
  { code: "4902.T", sector: "Precision Instruments" },
  { code: "6146.T", sector: "Precision Instruments" },
  { code: "7731.T", sector: "Precision Instruments" },
  { code: "7733.T", sector: "Precision Instruments" },
  { code: "7741.T", sector: "Precision Instruments" },
  { code: "7762.T", sector: "Precision Instruments" },
  { code: "9432.T", sector: "Communications" },
  { code: "9433.T", sector: "Communications" },
  { code: "9434.T", sector: "Communications" },
  { code: "9613.T", sector: "Communications" },
  { code: "9984.T", sector: "Communications" },
  { code: "5831.T", sector: "Banking" },
  { code: "7186.T", sector: "Banking" },
  { code: "8304.T", sector: "Banking" },
  { code: "8306.T", sector: "Banking" },
  { code: "8308.T", sector: "Banking" },
  { code: "8309.T", sector: "Banking" },
  { code: "8316.T", sector: "Banking" },
  { code: "8331.T", sector: "Banking" },
  { code: "8354.T", sector: "Banking" },
  { code: "8411.T", sector: "Banking" },
  { code: "8253.T", sector: "Other Financial Services" },
  { code: "8591.T", sector: "Other Financial Services" },
  { code: "8697.T", sector: "Other Financial Services" },
  { code: "8601.T", sector: "Securities" },
  { code: "8604.T", sector: "Securities" },
  { code: "8630.T", sector: "Insurance" },
  { code: "8725.T", sector: "Insurance" },
  { code: "8750.T", sector: "Insurance" },
  { code: "8766.T", sector: "Insurance" },
  { code: "8795.T", sector: "Insurance" },
  { code: "1332.T", sector: "Fishery" },
  { code: "2002.T", sector: "Foods" },
  { code: "2269.T", sector: "Foods" },
  { code: "2282.T", sector: "Foods" },
  { code: "2501.T", sector: "Foods" },
  { code: "2502.T", sector: "Foods" },
  { code: "2503.T", sector: "Foods" },
  { code: "2801.T", sector: "Foods" },
  { code: "2802.T", sector: "Foods" },
  { code: "2871.T", sector: "Foods" },
  { code: "2914.T", sector: "Foods" },
];

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
      marketCap: toNumber(data.marketCap),
      peRatio: toNumber(data.trailingPE),
      pbRatio: toNumber(data.priceToBook),
      dividendYield: toNumber(data.dividendYield) * 100, // Convert to percentage
      fiftyTwoWeekHigh: toNumber(data.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: toNumber(data.fiftyTwoWeekLow),
      eps: toNumber(data.epsTrailingTwelveMonths),
    };
  } catch (error) {
    console.error(
      `Error fetching Yahoo Finance data for ${ticker}:`,
      error.message
    );
    return null;
  }
}

// Compute stock score with more metrics
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
      currentPrice: stockData.currentPrice,
      marketCap: stockData.marketCap,
      peRatio: stockData.peRatio,
      pbRatio: stockData.pbRatio,
      dividendYield: stockData.dividendYield,
      eps: stockData.eps,
      fiftyTwoWeekHigh: stockData.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: stockData.fiftyTwoWeekLow,
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
