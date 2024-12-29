const yahooFinance = require("yahoo-finance2").default;

// Custom headers for Yahoo Finance requests
const customHeaders = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, Gecko) Chrome/91.0.4472.124 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
};

// Fetch historical data for a ticker
async function fetchHistoricalData(ticker) {
  try {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const period1 = Math.floor(oneYearAgo.getTime() / 1000);

    console.log(`Fetching historical data for ticker: ${ticker}`);
    const data = await yahooFinance.chart(ticker, {
      period1,
      interval: "1d",
    });

    if (!data || !data.quotes || data.quotes.length === 0) {
      console.warn(`No historical data available for ticker: ${ticker}`);
      return [];
    }

    return data.quotes.map((quote) => ({
      date: quote.date,
      price: quote.close,
      volume: quote.volume,
    }));
  } catch (error) {
    console.error(
      `Error fetching historical data for ${ticker}:`,
      error.message
    );
    throw new Error("Failed to fetch historical data");
  }
}

// API handler for historical data
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

  const { ticker } = req.query;

  if (!ticker) {
    res.status(400).json({ success: false, message: "Ticker is required" });
    return;
  }

  try {
    const historicalData = await fetchHistoricalData(ticker);

    res.json({
      success: true,
      data: historicalData,
    });
  } catch (error) {
    console.error("Error fetching historical data:", error.message);
    res.status(500).json({
      success: false,
      message: "An error occurred while fetching historical data",
    });
  }
};
