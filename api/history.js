// /api/history.js

import yahooFinance from "yahoo-finance2";

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

    if (!data || !data.quotes || data.quotes.length === 0) {
      console.warn(`No historical data available for ticker: ${ticker}`);
      return [];
    }

    // Filter out any invalid quotes before mapping
    const validQuotes = data.quotes.filter(
      (quote) =>
        quote &&
        typeof quote.close === "number" &&
        !isNaN(quote.close) &&
        typeof quote.volume === "number" &&
        !isNaN(quote.volume)
    );

    console.log(
      `Filtered out ${data.quotes.length - validQuotes.length} invalid quotes`
    );

    return validQuotes.map((quote) => ({
      date: quote.date,
      open: quote.open || quote.close, // Fallback to close if open is missing
      high: quote.high || quote.close, // Fallback to close if high is missing
      low: quote.low || quote.close, // Fallback to close if low is missing
      close: quote.close,
      volume: quote.volume || 0, // Default to 0 if volume is missing
      price: quote.close,
    }));
  } catch (error) {
    console.error(
      `Error fetching historical data for ${ticker}:`,
      error.message
    );
    throw new Error(`Failed to fetch historical data: ${error.message}`);
  }
}

// API handler for historical data
const allowedOrigins = [
  "https://thegoodmanagers.com",
  "https://www.thegoodmanagers.com",
];

export default async function handler(req, res) {
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
