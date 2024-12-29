const yahooFinance = require("yahoo-finance2").default;

// Custom headers for Yahoo Finance requests
const customHeaders = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, Gecko) Chrome/91.0.4472.124 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
};

// Utility function to safely parse numbers
function toNumber(value) {
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

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

const allowedOrigins = [
  "https://thegoodmanagers.com",
  "https://www.thegoodmanagers.com",
];

module.exports = async (req, res) => {
  // Set CORS if origin is allowed
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  // Handle preflight (OPTIONS)
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ success: false, error: "Method not allowed" });
  }

  try {
    // The client should send { "ticker": { code, sector } }
    const { ticker } = req.body;

    // Validate input
    if (!ticker || !ticker.code) {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid 'ticker' object in request body",
      });
    }

    // Fetch from Yahoo
    const yahooData = await fetchYahooFinanceData(ticker.code);

    // Return the combined response
    const responseData = {
      code: ticker.code,
      sector: ticker.sector,
      yahooData,
    };

    res.status(200).json({ success: true, data: responseData });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
};
