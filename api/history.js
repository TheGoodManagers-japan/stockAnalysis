const yahooFinance = require("yahoo-finance2").default;

async function fetchHistoricalData(ticker) {
  try {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const today = new Date();

    console.log(`Fetching historical data for ticker: ${ticker}`);

    const data = await yahooFinance.chart(ticker, {
      period1: oneYearAgo,
      period2: today,
      interval: "1d",
    });

    // Uncomment this to see the full shape of the returned object
    // console.log(JSON.stringify(data, null, 2));

    if (!data || !data.quotes || data.quotes.length === 0) {
      console.warn(`No historical data available for ticker: ${ticker}`);
      return [];
    }

    // Log out the "quotes" array to see if it contains what you expect
    console.log(data.quotes);

    return data.quotes.map((quote) => ({
      date: quote.date,
      open: quote.open,
      high: quote.high,
      low: quote.low,
      close: quote.close,
      volume: quote.volume,
      price: quote.close,
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

  // 4) Handle preflight (OPTIONS) requests
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Fetch historical data
  try {
    const { ticker } = req.query; // Ensure `ticker` is provided in the request query
    if (!ticker) {
      return res
        .status(400)
        .json({ success: false, message: "Ticker is required" });
    }

    const data = await fetchHistoricalData(ticker); // Use your fetchHistoricalData function

    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No historical data available for ${ticker}`,
      });
    }

    // Return the fetched data
    console.log(`HERE: ${data}`);
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error in API handler:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};
