const yahooFinance = require("yahoo-finance2").default;

async function fetchHistoricalData(ticker, years = 3) {
  try {
    // Calculate the start date by subtracting the desired number of years from today.
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - years);
    const today = new Date();

    console.log(
      `Fetching historical data for ticker: ${ticker} from ${startDate.toISOString()} to ${today.toISOString()}`
    );

    const data = await yahooFinance.chart(ticker, {
      period1: startDate,
      period2: today,
      interval: "1d",
    });

    // Uncomment the following line to inspect the full shape of the returned object
    // console.log(JSON.stringify(data, null, 2));

    if (!data || !data.quotes || data.quotes.length === 0) {
      console.warn(`No historical data available for ticker: ${ticker}`);
      return [];
    }

    // Log the "quotes" array to check if it contains what you expect
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

  try {
    // Extract ticker and optional years parameter from query.
    const { ticker, years } = req.query;
    if (!ticker) {
      return res
        .status(400)
        .json({ success: false, message: "Ticker is required" });
    }

    // Parse years, defaulting to 3 if not provided.
    const numYears = years ? parseInt(years, 10) : 3;

    // Fetch historical data for the extended period.
    const data = await fetchHistoricalData(ticker, numYears);

    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No historical data available for ${ticker}`,
      });
    }

    console.log(
      `Fetched historical data for ${ticker} over ${numYears} years.`
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error in API handler:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};
