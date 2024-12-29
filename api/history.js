const yahooFinance = require("yahoo-finance2").default;

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
  // Always set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "https://thegoodmanagers.com");
  // or res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Return early for OPTIONS preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Normal logic from here on
  const { ticker } = req.query;
  if (!ticker) {
    return res
      .status(400)
      .json({ success: false, message: "Ticker is required" });
  }

  try {
    const data = await fetchHistoricalData(ticker);
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error fetching historical data:", error.message);
    res.status(500).json({
      success: false,
      message: "An error occurred while fetching historical data",
    });
  }
};

