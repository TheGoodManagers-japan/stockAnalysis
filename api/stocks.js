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

// Fetch stock data from Yahoo Finance with custom headers
async function fetchYahooFinanceData(ticker) {
  try {
    console.log(`Fetching data for ticker: ${ticker}`);
    const data = await yahooFinance.quote(ticker, { headers: customHeaders });

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
    console.error(`Error fetching data for ${ticker}:`, error.message);
    return null;
  }
}

// Main function to handle the API request
module.exports = async (req, res) => {
  // Add CORS headers to allow cross-origin requests
  res.setHeader("Access-Control-Allow-Origin", "https://thegoodmanagers.com"); // Replace with your frontend domain
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle OPTIONS preflight request
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  try {
    const sectorResults = [];

    // Fetch data for each ticker
    for (const { code, sector } of tickers) {
      const data = await fetchYahooFinanceData(code);
      if (data) {
        sectorResults.push({
          ticker: code,
          sector,
          ...data,
        });
      }
    }

    // Example metrics (you can calculate meaningful metrics here)
    const sectorMetrics = {
      averagePrice:
        sectorResults.reduce((sum, stock) => sum + stock.currentPrice, 0) /
        sectorResults.length,
    };

    // Send the response
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
