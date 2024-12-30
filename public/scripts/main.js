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

async function getSentiments(tickerObj, openaikey) {
  const response = await fetch(
    "https://stock-analysis-thegoodmanagers-japan-aymerics-projects-60f33831.vercel.app/api/scrapt",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: tickerObj, openaiApiKey: openaikey }), // sending one ticker
    }
  );

  if (!response.ok) {
    const errorDetails = await response.text(); // Get response body for additional context
    throw new Error(
      `HTTP error! Status: ${response.status}, Details: ${errorDetails}`
    );
  }

  // Expecting server to return a JSON object like: { success: true, data: {...} }
  const data = await response.json();

  // Validate the response structure
  if (!data || typeof data !== "object" || !data.success) {
    throw new Error(
      "Unexpected response structure or missing 'success' field."
    );
  }

  return data; // Return the parsed response
} 



window.scan = {
  async fetchStockAnalysis(openaikey) {
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
        console.log(`Fetching sentiment scores for ${stock.ticker}`);
        try {
          // Fetch news articles and their sentiments
          const news = await getSentiments(stock.ticker, openaikey);

          // Check if news articles are fetched
          if (!news || news.length === 0) {
            console.error(
              `No news articles fetched for ${stock.ticker}. Aborting calculation.`
            );
            throw new Error("No news articles found.");
          }

          // Calculate the average sentiment score
          const sentimentScores = news
            .map((article) => article.sentimentScore)
            .filter((score) => score !== null);
          if (sentimentScores.length === 0) {
            console.error(
              `No valid sentiment scores available for ${stock.ticker}. Aborting calculation.`
            );
            throw new Error("No valid sentiment scores found.");
          }

          const sentiment =
            sentimentScores.reduce((sum, score) => sum + score, 0) /
            sentimentScores.length;

          console.log(
            `Average sentiment score for ${stock.ticker}: ${sentiment}`
          );

          if (sentiment === null || isNaN(sentiment)) {
            console.error(
              `Failed to calculate average sentiment for ${stock.ticker}. Aborting calculation.`
            );
            throw new Error("Average sentiment calculation failed.");
          }
        } catch (error) {
          console.error(
            `Error while fetching or processing sentiment for ${stock.ticker}:`,
            error.message
          );
          throw error; // Rethrow to ensure the error is propagated
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
        const prediction = predictions[29]; // Use the first prediction
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






const baseUrls = [
  "https://finance.yahoo.co.jp/quote/4151.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4502.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4503.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4506.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4507.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4519.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4523.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4568.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4578.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6479.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6501.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6503.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6504.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6506.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6526.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6594.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6645.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6674.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6701.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6702.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6723.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6724.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6752.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6753.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6758.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6762.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6770.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6841.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6857.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6861.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6902.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6920.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6952.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6954.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6971.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6976.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6981.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7735.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7751.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7752.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8035.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7201.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7202.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7203.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7205.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7211.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7261.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7267.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7269.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7270.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7272.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4543.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4902.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6146.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7731.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7733.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7741.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7762.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9432.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9433.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9434.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9613.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9984.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/5831.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7186.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8304.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8306.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8308.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8309.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8316.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8331.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8354.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8411.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8253.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8591.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8697.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8601.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8604.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8630.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8725.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8750.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8766.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8795.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/1332.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/2002.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/2269.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/2282.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/2501.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/2502.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/2503.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/2801.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/2802.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/2871.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/2914.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/3086.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/3092.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/3099.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/3382.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7453.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8233.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8252.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8267.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9843.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9983.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/2413.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/2432.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/3659.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4307.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4324.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4385.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4661.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4689.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4704.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4751.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4755.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6098.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6178.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7974.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9602.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9735.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9766.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/1605.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/3401.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/3402.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/3861.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/3405.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/3407.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4004.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4005.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4021.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4042.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4043.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4061.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4063.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4183.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4188.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4208.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4452.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4901.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/4911.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6988.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/5019.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/5020.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/5101.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/5108.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/5201.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/5214.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/5233.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/5301.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/5332.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/5333.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/5401.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/5406.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/5411.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/3436.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/5706.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/5711.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/5713.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/5714.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/5801.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/5802.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/5803.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/2768.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8001.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8002.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8015.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8031.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8053.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8058.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/1721.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/1801.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/1802.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/1803.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/1808.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/1812.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/1925.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/1928.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/1963.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/5631.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6103.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6113.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6273.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6301.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6302.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6305.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6326.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6361.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6367.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6471.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6472.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/6473.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7004.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7011.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7013.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7012.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7832.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7911.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7912.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/7951.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/3289.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8801.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8802.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8804.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/8830.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9001.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9005.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9007.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9008.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9009.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9020.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9021.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9022.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9064.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9147.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9101.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9104.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9107.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9201.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9202.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9301.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9501.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9502.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9503.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9531.Tnews?page=1&vip=off",
  "https://finance.yahoo.co.jp/quote/9532.Tnews?page=1&vip=off",
];




const generateUrls = (baseUrls, totalPages = 3) => {
  const urls = [];
  baseUrls.forEach((url) => {
    const base = url.split("&page=")[0]; // Strip off the page parameter
    for (let page = 1; page <= totalPages; page++) {
      urls.push(`${base}&page=${page}&vip=off`);
    }
  });
  return urls;
};

// Generate and print
const allUrls = generateUrls(baseUrls);
console.log(allUrls);
