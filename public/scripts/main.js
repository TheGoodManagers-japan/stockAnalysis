import { analyzeStock } from "./trainandpredict.js";

// ------------------------------------------
// 1) Helper: stop-loss & target-price logic
// -----------------------------------------
function calculateStopLossAndTarget(stock, prediction, sentimentScore) {
  // Validate Sentiment Score
  const sentimentWeight = Math.max(0, Math.min(sentimentScore, 1));
  const sentimentImpact = sentimentWeight ** 2;

  // Determine Risk Tolerance
  const riskTolerance = determineRisk(stock, sentimentScore);
  const riskMultipliers = {
    low: { stopLossFactor: 0.8, targetBoost: 0.9 },
    medium: { stopLossFactor: 1, targetBoost: 1 },
    high: { stopLossFactor: 1.2, targetBoost: 1.1 },
  };
  const riskFactor = riskMultipliers[riskTolerance];

  // Volatility and Confidence
  const priceRange = stock.highPrice - stock.lowPrice;
  const volatilityFactor = priceRange / stock.currentPrice;
  const confidenceWeight = Math.max(0.5, 1 - volatilityFactor);

  // Price Gap Analysis
  const priceGap =
    (stock.openPrice - stock.prevClosePrice) / stock.prevClosePrice;

  // Stop-Loss Calculation
  const stopLossBase = Math.max(
    stock.currentPrice * 0.9,
    stock.lowPrice * 1.05,
    stock.fiftyTwoWeekLow * 1.1,
    stock.prevClosePrice * 0.95
  );
  let stopLoss =
    stopLossBase * riskFactor.stopLossFactor * (1 - sentimentImpact * 0.1);
  if (priceGap < -0.02) stopLoss *= 0.95;

  // Metrics-Based Target Price
  const metricsTarget = Math.max(
    stock.currentPrice * 1.2,
    stock.fiftyTwoWeekHigh * 0.95,
    stock.currentPrice + priceRange * 1.1,
    stock.currentPrice + stock.eps * 10
  );

  // PE and PB Adjustment
  let adjustedTarget = metricsTarget;
  if (stock.peRatio < 15) adjustedTarget *= 0.95;
  if (stock.peRatio > 30) adjustedTarget *= 1.1;
  if (stock.pbRatio < 1) adjustedTarget *= 1.05;

  // Weighted Target Price with Sentiment and Risk
  let targetPrice =
    (adjustedTarget * confidenceWeight * (1 - sentimentImpact * 0.2) +
      prediction * (1 - confidenceWeight) * (1 + sentimentImpact * 0.2)) *
    riskFactor.targetBoost;
  if (priceGap > 0.02) targetPrice *= 1.05;

  // Adjust for Dividend
  const dividendBoost =
    stock.dividendYield > 0.03 ? 1 + stock.dividendYield : 1;
  targetPrice *= dividendBoost;

  // Final Results
  return {
    stopLoss: parseFloat(stopLoss.toFixed(2)),
    targetPrice: parseFloat(targetPrice.toFixed(2)),
    riskTolerance,
  };
}


function determineRisk(stock, sentimentScore) {
  // Calculate volatility
  const priceRange = stock.highPrice - stock.lowPrice;
  const volatility = priceRange / stock.currentPrice;

  // Classify based on volatility
  let riskLevel = "medium";
  if (volatility > 0.5 || stock.marketCap < 1e11 || sentimentScore < 0.4) {
    riskLevel = "high"; // High risk for volatile, small-cap, or low-sentiment stocks
  } else if (
    volatility < 0.2 &&
    stock.marketCap > 5e11 &&
    sentimentScore > 0.7
  ) {
    riskLevel = "low"; // Low risk for stable, large-cap, high-sentiment stocks
  }
  return riskLevel;
}

function computeScore(stock, predictions) {
  // Example approach: let’s just return the number of predictions
  return predictions.length;
}

// ------------------------------------------
// 3) Function to POST a single ticker to /api/stocks
// ------------------------------------------
async function fetchSingleStockData(tickerObj) {
  try {
    const response = await fetch(
      "https://stock-analysis-thegoodmanagers-japan-aymerics-projects-60f33831.vercel.app/api/stocks",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: tickerObj }), // sending one ticker
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    // Server should return { success: true, data: { code, sector, yahooData: {...} } }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Fetch Error:", error.message);
    return { success: false, error: error.message };
  }
}

async function getSentimentScore(stockSymbol, apiKey) {
  try {
    // Finnhub API endpoint
    const url = `https://finnhub.io/api/v1/news-sentiment?symbol=${stockSymbol}&token=${apiKey}`;

    // Fetch data from Finnhub
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    // Parse the JSON response
    const data = await response.json();

    // Extract relevant sentiment score (e.g., "sentimentScore")
    const sentimentScore = data.sentiment?.bullishPercent || 0;

    console.log(`Sentiment Score for ${stockSymbol}: ${sentimentScore}`);
    return sentimentScore; // Return the score (0 to 1)
  } catch (error) {
    console.error("Error fetching sentiment score:", error.message);
    return null; // Return null if an error occurs
  }
}


window.scan = {
  async fetchStockAnalysis(finnhubApiKey) {
    try {
      // (A) Define the tickers on the client side
      const tickers = [{ code: "4151.T", sector: "Pharmaceuticals" }];

      // (B) We'll accumulate final refined stocks by sector
      const groupedBySector = {};

      // (C) Loop through each ticker, fetch data, run analysis
      for (const tickerObj of tickers) {
        console.log(`\n--- Fetching data for ${tickerObj.code} ---`);

        // 1) Fetch Yahoo data from the server
        const result = await fetchSingleStockData(tickerObj);
        if (!result.success) {
          console.error("Error fetching stock analysis:", result.error);
          throw new Error("Failed to fetch Yahoo data."); // Abort processing for this stock
        }

        // 2) Deconstruct the server response
        const { code, sector, yahooData } = result.data;
        if (
          !yahooData ||
          !yahooData.currentPrice ||
          !yahooData.highPrice ||
          !yahooData.lowPrice
        ) {
          console.error(
            `Incomplete Yahoo data for ${code}. Aborting calculation.`
          );
          throw new Error("Critical Yahoo data is missing.");
        }

        // 3) Build a local 'stock' object with all fields you need
        const stock = {
          ticker: code,
          sector,
          currentPrice: yahooData.currentPrice,
          highPrice: yahooData.highPrice,
          lowPrice: yahooData.lowPrice,
          openPrice: yahooData.openPrice,
          prevClosePrice: yahooData.prevClosePrice,
          marketCap: yahooData.marketCap,
          peRatio: yahooData.peRatio,
          pbRatio: yahooData.pbRatio,
          dividendYield: yahooData.dividendYield,
          fiftyTwoWeekHigh: yahooData.fiftyTwoWeekHigh,
          fiftyTwoWeekLow: yahooData.fiftyTwoWeekLow,
          eps: yahooData.eps,
        };

        // 4) Fetch sentiment score using the provided helper function
        console.log(`Fetching sentiment score for ${stock.ticker}`);
        const sentiment = await getSentimentScore(stock.ticker, finnhubApiKey);
        if (sentiment === null) {
          console.error(
            `Failed to fetch sentiment for ${stock.ticker}. Aborting calculation.`
          );
          throw new Error("Sentiment score fetching failed.");
        }

        // 5) Run your ML/predictive analysis
        console.log(`Analyzing stock: ${stock.ticker}`);
        const predictions = await analyzeStock(stock.ticker);
        if (!predictions || predictions.length === 0) {
          console.error(
            `No predictions available for ${stock.ticker}. Aborting calculation.`
          );
          throw new Error("Failed to generate predictions.");
        }

        // 6) Merge predictions data
        const prediction = predictions[0]; // Use the first prediction
        stock.predictions = predictions;
        stock.predictedGrowth =
          (prediction - stock.currentPrice) / stock.currentPrice;

        // 7) Calculate stop loss & target price
        const { stopLoss, targetPrice } = calculateStopLossAndTarget(
          stock,
          prediction,
          sentiment
        );
        if (stopLoss === null || targetPrice === null) {
          console.error(
            `Failed to calculate stop loss or target price for ${stock.ticker}.`
          );
          throw new Error("Stop loss or target price calculation failed.");
        }

        stock.stopLoss = stopLoss;
        stock.targetPrice = targetPrice;

        // 8) Compute your "score"
        stock.score = computeScore(stock, predictions);

        // 9) Add this refined stock to the grouping by sector
        if (!groupedBySector[stock.sector]) {
          groupedBySector[stock.sector] = [];
        }
        groupedBySector[stock.sector].push(stock);

        console.log(`Updated stock data for ${stock.ticker}:`, stock);
      }

      // (D) Finally, log the grouped data so you see everything
      console.log("\nFinal grouped data by sector:", groupedBySector);
    } catch (error) {
      console.error("Error in fetchStockAnalysis:", error.message);
      throw new Error("Analysis aborted due to errors."); // Stop processing entirely
    }
  },
};
