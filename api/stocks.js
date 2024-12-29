// /api/stocks.js (on your Vercel server, for instance)
const yahooFinance = require("yahoo-finance2").default;

function toNumber(value) {
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

async function fetchYahooFinanceData(ticker) {
  try {
    console.log(`Fetching data for ticker: ${ticker}`);
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
      dividendYield: toNumber(data.dividendYield) * 100,
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
  // 1) CORS
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  // 2) Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // 3) Only POST allowed
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ success: false, error: "Method not allowed" });
  }

  try {
    // 4) Expect { ticker: { code, sector } } in the request body
    const { ticker } = req.body;

    // 4a) Validate input
    if (!ticker || !ticker.code) {
      return res
        .status(400)
        .json({ success: false, error: "Missing or invalid 'ticker' in body" });
    }

    // 5) Fetch Yahoo data for that one ticker
    const yahooData = await fetchYahooFinanceData(ticker.code);
    if (!yahooData) {
      // If we got no data back, let's still respond with success=false or a data:null
      return res
        .status(200)
        .json({
          success: true,
          data: { code: ticker.code, sector: ticker.sector, yahooData: null },
        });
    }

    // 6) Send back the combined data
    return res.status(200).json({
      success: true,
      data: {
        code: ticker.code,
        sector: ticker.sector,
        yahooData,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
