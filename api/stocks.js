const yahooFinance = require("yahoo-finance2").default;

yahooFinance.suppressNotices(["yahooSurvey", "ripHistorical"]); // suppress notices

function toNumber(value) {
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

function getDateYearsAgo(years) {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date;
}

function isFinancialSector(sector) {
  const financialSectors = [
    "Banking",
    "Securities",
    "Insurance",
    "Other Financial Services",
    "Real Estate",
  ];
  return financialSectors.some((s) => sector?.includes(s));
}

async function fetchYahooFinanceData(ticker, sector = "") {
  try {
    console.log(`Fetching data for ticker: ${ticker}`);

    const now = new Date();
    const oneYearAgo = getDateYearsAgo(1);
    const fiveYearsAgo = getDateYearsAgo(5);

    const [quote, historicalPrices, dividendGrowth, summary] =
      await Promise.all([
        yahooFinance.quote(ticker),
        yahooFinance.chart(ticker, {
          period1: oneYearAgo,
          period2: now,
          interval: "1d",
        }),
        yahooFinance.chart(ticker, {
          period1: fiveYearsAgo,
          period2: now,
          events: "div",
        }),
        yahooFinance.quoteSummary(ticker, {
          modules: [
            "financialData",
            "defaultKeyStatistics",
            "balanceSheetHistory",
            "incomeStatementHistory",
            "summaryDetail",
          ],
        }),
      ]);

    const historical = historicalPrices?.quotes || [];
    const dividends = dividendGrowth?.events?.dividends || {};

    if (!quote || !historical.length) {
      console.warn(`No Yahoo Finance data available for ${ticker}`);
      return null;
    }

    // ... keep all indicator calculations the same, just replace use of 'historicalPrices' with 'historical'

    // Replace: historicalPrices.map((d) => d.close);
    const closes = historical.map((d) => d.close);

    // Replace dividendGrowth logic with Object.values(dividends)
    const divs = Object.values(dividends).sort((a, b) => a.date - b.date);

    const dividendGrowth5yr =
      divs.length >= 2 && divs[0].amount
        ? ((divs[divs.length - 1].amount - divs[0].amount) / divs[0].amount) *
          100
        : 0;

    //... reuse rest of code from original (calculations, fallbacks, etc.)

    return yahooData;
  } catch (error) {
    console.error(
      `Error fetching data for ${ticker}:`,
      error.stack || error.message
    );
    return null;
  }
}

const allowedOrigins = [
  "https://thegoodmanagers.com",
  "https://www.thegoodmanagers.com",
];

module.exports = async (req, res) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ success: false, error: "Method not allowed" });
  }

  try {
    const { ticker } = req.body;
    if (!ticker || !ticker.code) {
      return res
        .status(400)
        .json({ success: false, error: "Missing or invalid 'ticker' in body" });
    }

    const yahooData = await fetchYahooFinanceData(ticker.code, ticker.sector);
    if (!yahooData) {
      return res
        .status(404)
        .json({
          success: false,
          error: `No data available for ticker ${ticker.code}`,
        });
    }

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
