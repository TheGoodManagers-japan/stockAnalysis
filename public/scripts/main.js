import { analyzeStock } from "./trainandpredict.js";


function calculateStopLossAndTarget(stock, prediction) {
  // ATR-based Volatility Adjustment (Mock ATR Calculation for Example)
  const priceRange = stock.highPrice - stock.lowPrice;
  const atr = priceRange / 14; // Simplified ATR (replace with actual ATR calculation if available)

  // Dynamic Stop-Loss Buffer (1.5x ATR or 5-10% buffer)
  const atrBuffer = stock.currentPrice - 1.5 * atr;
  const percentageBuffer = stock.currentPrice * 0.1; // 10% default buffer
  const bufferPrice = Math.max(
    atrBuffer,
    stock.currentPrice - percentageBuffer
  );

  // Incorporate Historical Lows
  const historicalLow = Math.max(
    stock.lowPrice * 1.02, // Slight buffer above recent low
    stock.fiftyTwoWeekLow * 1.05 // Slight buffer above 52-week low
  );

  // Final Stop-Loss Calculation
  const stopLoss = Math.max(bufferPrice, historicalLow);

  // Predicted Growth and Target Price Adjustment
  const growthPotential = Math.max(
    (prediction - stock.currentPrice) / stock.currentPrice,
    -0.1 // Cap negative growth at -10%
  );

  let targetPrice = stock.currentPrice;
  if (growthPotential >= 0) {
    // Positive Growth: Base on prediction and metrics
    const confidenceWeight = 0.7;
    const metricsTarget = stock.currentPrice * (1 + growthPotential * 0.5); // Conservative growth estimate
    targetPrice =
      prediction * confidenceWeight + metricsTarget * (1 - confidenceWeight);
  } else {
    // Negative Growth: Adjust downwards
    targetPrice *= 1 + growthPotential;
  }

  // Final Adjustments
  const dividendBoost = 1 + Math.min(stock.dividendYield / 100, 0.03); // Cap at 3%
  targetPrice *= dividendBoost;

  return {
    stopLoss: parseFloat(stopLoss.toFixed(2)),
    targetPrice: parseFloat(targetPrice.toFixed(2)),
  };
}





function determineRisk(stock) {
  // Calculate volatility
  const priceRange = stock.highPrice - stock.lowPrice;
  const volatility = priceRange / stock.currentPrice;

  // Classify based on volatility
  let riskLevel = "medium";
  if (volatility > 0.5 || stock.marketCap < 1e11) {
    riskLevel = "high"; // High risk for volatile or small-cap stocks
  } else if (volatility < 0.2 && stock.marketCap > 5e11) {
    riskLevel = "low"; // Low risk for stable, large-cap stocks
  }
  return riskLevel;
}

function computeScore(stock, predictions) {
  const weights = {
    growthPotential: 0.4,
    valuation: 0.3,
    marketStability: 0.2,
    dividendBenefit: 0.05,
    historicalPerformance: 0.05,
  };

  const prediction = predictions[29];
  const growthPotential = Math.max(
    0,
    Math.min((prediction - stock.currentPrice) / stock.currentPrice, 0.5) // Cap growth at 50%
  );

  let valuationScore = 1;
  if (stock.peRatio < 15) valuationScore *= 1.1;
  if (stock.peRatio > 30) valuationScore *= 0.9;
  if (stock.pbRatio < 1) valuationScore *= 1.2;
  if (stock.pbRatio > 3) valuationScore *= 0.8;

  const priceRange = stock.highPrice - stock.lowPrice;
  const volatility = priceRange / stock.currentPrice;
  const stabilityScore = 1 - Math.min(volatility, 0.5);

  const dividendBenefit = Math.min(stock.dividendYield / 100, 0.05);
  const historicalPerformance =
    (stock.currentPrice - stock.fiftyTwoWeekLow) /
    (stock.fiftyTwoWeekHigh - stock.fiftyTwoWeekLow);

  const rawScore =
    growthPotential * weights.growthPotential +
    valuationScore * weights.valuation +
    stabilityScore * weights.marketStability +
    dividendBenefit * weights.dividendBenefit +
    historicalPerformance * weights.historicalPerformance;

  return Math.min(Math.max(rawScore, 0), 1);
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

window.scan = {
  async fetchStockAnalysis() {
    try {
      // (A) Define the tickers on the client side
      const tickers = [
        { code: "4151.T", sector: "Pharmaceuticals" },
        { code: "4502.T", sector: "Pharmaceuticals" },
        { code: "4503.T", sector: "Pharmaceuticals" },
        { code: "4506.T", sector: "Pharmaceuticals" },
        { code: "4507.T", sector: "Pharmaceuticals" },
        { code: "4519.T", sector: "Pharmaceuticals" },
        { code: "4523.T", sector: "Pharmaceuticals" },
        { code: "4568.T", sector: "Pharmaceuticals" },
        { code: "4578.T", sector: "Pharmaceuticals" },
      ];

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

        // 4) Run your ML/predictive analysis
        console.log(`Analyzing stock: ${stock.ticker}`);
        const predictions = await analyzeStock(stock.ticker);
        if (!predictions || predictions.length === 0) {
          console.error(
            `No predictions available for ${stock.ticker}. Aborting calculation.`
          );
          throw new Error("Failed to generate predictions.");
        }

        // 5) Merge predictions data
        const prediction = predictions[29]; // Use the 30th prediction
        stock.predictions = predictions;
        stock.predictedGrowth =
          (prediction - stock.currentPrice) / stock.currentPrice;

        // 6) Calculate stop loss & target price
        const { stopLoss, targetPrice } = calculateStopLossAndTarget(
          stock,
          prediction
        );
        if (stopLoss === null || targetPrice === null) {
          console.error(
            `Failed to calculate stop loss or target price for ${stock.ticker}.`
          );
          throw new Error("Stop loss or target price calculation failed.");
        }

        stock.stopLoss = stopLoss;
        stock.targetPrice = targetPrice;

        // 7) Compute your "score"
        stock.score = computeScore(stock, predictions);

        // 8) Add this refined stock to the grouping by sector
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
