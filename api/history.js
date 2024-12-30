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


    console.log(data);
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
// Allowed domains
const allowedOrigins = [
  "https://thegoodmanagers.com",
  "https://www.thegoodmanagers.com",
];

module.exports = async (req, res) => {
  // 1) Grab the incoming request’s origin
  const origin = req.headers.origin;

  // 2) If it’s in our list of allowed origins, set CORS headers dynamically
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  // 3) Other standard CORS headers
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  // (Optional) This ensures proxies & CDNs handle dynamic origins
  // so that they don’t reuse cached responses across different origins.
  res.setHeader("Vary", "Origin");

  // 4) Handle preflight (OPTIONS) requests
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ... your existing logic here ...
  try {
    // example: if you do something like fetch data, then return JSON
    res.status(200).json({ success: true, message: "Hello, CORS!" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
