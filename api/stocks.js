const yahooFinance = require("yahoo-finance2").default;
const puppeteer = require("puppeteer");

// Tickers and their sectors
const tickers = [
  { code: "4151.T", sector: "Pharmaceuticals" },
  { code: "4502.T", sector: "Pharmaceuticals" },
  { code: "4503.T", sector: "Pharmaceuticals" },
  { code: "4568.T", sector: "Pharmaceuticals" },
  { code: "4578.T", sector: "Pharmaceuticals" },
  { code: "6479.T", sector: "Electric Machinery" },
  { code: "6501.T", sector: "Electric Machinery" },
  { code: "6503.T", sector: "Electric Machinery" },
  { code: "6504.T", sector: "Electric Machinery" },
  { code: "2871.T", sector: "Foods" },
  { code: "2914.T", sector: "Foods" },
];

// Utility function to safely parse numbers
function toNumber(value) {
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

// Scrape news articles from Yahoo Finance
async function scrapeYahooFinanceNews(symbol) {
  const url = `https://finance.yahoo.com/quote/${symbol}/news`;
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Navigate to the stock's news page
    await page.goto(url, { waitUntil: "load", timeout: 0 });

    // Scrape news articles
    const newsArticles = await page.evaluate(() => {
      const articles = [];
      const items = document.querySelectorAll("li.js-stream-content");

      items.forEach((item) => {
        const titleElement = item.querySelector("h3");
        const linkElement = item.querySelector("a");
        const sourceElement = item.querySelector(".provider-name");
        const timestampElement = item.querySelector("time");

        if (titleElement && linkElement) {
          articles.push({
            title: titleElement.textContent.trim(),
            link: linkElement.href,
            source: sourceElement ? sourceElement.textContent.trim() : null,
            timestamp: timestampElement
              ? timestampElement.getAttribute("datetime")
              : null,
          });
        }
      });

      return articles;
    });

    return newsArticles;
  } catch (error) {
    console.error(`Error scraping Yahoo Finance news for ${symbol}:`, error);
    return [];
  } finally {
    await browser.close();
  }
}

// Fetch stock data and related news from Yahoo Finance
async function fetchYahooFinanceData(ticker) {
  try {
    // Fetch stock data using yahoo-finance2 library
    const data = await yahooFinance.quote(ticker);

    if (!data) {
      console.warn(`No Yahoo Finance data available for ${ticker}`);
      return null;
    }

    // Fetch related news
    const news = await scrapeYahooFinanceNews(ticker);

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
      news, // Include related news
    };
  } catch (error) {
    console.error(
      `Error fetching Yahoo Finance data for ${ticker}:`,
      error.message
    );
    return null;
  }
}

// Compute stock score with more metrics
function computeScore(data) {
  const {
    peRatio,
    pbRatio,
    dividendYield,
    currentPrice,
    highPrice,
    lowPrice,
    fiftyTwoWeekHigh,
    fiftyTwoWeekLow,
  } = data;

  // Weighted scoring based on various metrics
  return (
    0.3 * (1 / (peRatio || 1)) + // Lower PE ratio is better
    0.2 * (1 / (pbRatio || 1)) + // Lower PB ratio is better
    0.2 * (dividendYield || 0) + // Higher dividend yield is better
    0.2 * ((fiftyTwoWeekHigh - fiftyTwoWeekLow) / (currentPrice || 1)) + // Volatility over the year
    0.1 * ((highPrice - lowPrice) / (currentPrice || 1)) // Daily volatility
  );
}

// Calculate stop-loss and target price
function calculateStopLossAndTarget(data) {
  const { currentPrice, highPrice, lowPrice } = data;

  if (currentPrice <= 0 || highPrice <= 0 || lowPrice <= 0) {
    return { stopLoss: 0, targetPrice: 0 };
  }

  const stopLoss = currentPrice * 0.9; // 10% below current price
  const targetPrice = currentPrice * 1.15; // 15% above current price

  return {
    stopLoss: Math.max(stopLoss, lowPrice * 0.95), // At least 5% below recent low
    targetPrice: Math.min(targetPrice, highPrice * 1.1), // 10% above recent high
  };
}

// Handle stock scanning
async function scanStocks() {
  const sectorResults = {};

  for (const { code, sector } of tickers) {
    const stockData = await fetchYahooFinanceData(code);
    if (!stockData) {
      console.warn(`Skipping ticker ${code} due to missing data.`);
      continue;
    }

    const score = computeScore(stockData);
    const { stopLoss, targetPrice } = calculateStopLossAndTarget(stockData);

    if (!sectorResults[sector]) {
      sectorResults[sector] = [];
    }

    sectorResults[sector].push({
      ticker: code,
      currentPrice: stockData.currentPrice,
      marketCap: stockData.marketCap,
      peRatio: stockData.peRatio,
      pbRatio: stockData.pbRatio,
      dividendYield: stockData.dividendYield,
      eps: stockData.eps,
      fiftyTwoWeekHigh: stockData.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: stockData.fiftyTwoWeekLow,
      score,
      stopLoss,
      targetPrice,
      news: stockData.news, // Include related news
    });
  }

  // Sort stocks by score within each sector
  Object.keys(sectorResults).forEach((sector) => {
    sectorResults[sector].sort((a, b) => b.score - a.score);
    sectorResults[sector] = sectorResults[sector].slice(0, 10);
  });

  return sectorResults;
}

// Vercel Serverless API Handler
module.exports = async (req, res) => {
  try {
    const results = await scanStocks();
    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    console.error("Error during stock scanning:", error.message);
    res.status(500).json({
      success: false,
      message: "An error occurred while scanning stocks.",
    });
  }
};
