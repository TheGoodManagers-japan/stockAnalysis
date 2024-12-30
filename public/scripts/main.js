import { analyzeStock } from "./trainandpredict.js";

// ------------------------------------------
// 1) Helper: stop-loss & target-price logic
// -----------------------------------------
function calculateStopLossAndTarget(stock, prediction) {
  // Determine Risk Tolerance
  const riskTolerance = determineRisk(stock);
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
  let stopLoss = stopLossBase * riskFactor.stopLossFactor;
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

  // Weighted Target Price with Risk
  let targetPrice =
    adjustedTarget * confidenceWeight +
    prediction * (1 - confidenceWeight) * riskFactor.targetBoost;
  if (priceGap > 0.02) targetPrice *= 1.05;

  // Adjust for Dividend
  const dividendBoost = 1 + Math.min(stock.dividendYield, 0.05); // Cap at 5%
  targetPrice *= dividendBoost;

  // Final Results
  return {
    stopLoss: parseFloat(stopLoss.toFixed(2)),
    targetPrice: parseFloat(targetPrice.toFixed(2)),
    riskTolerance,
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
  // Weights for each metric (adjust these as needed)
  const weights = {
    growthPotential: 0.4, // Growth potential based on predictions
    valuation: 0.25, // Based on PE and PB ratios
    marketStability: 0.2, // Based on volatility and market cap
    dividendBenefit: 0.1, // Higher for dividend-yielding stocks
    historicalPerformance: 0.05, // Based on 52-week high/low analysis
  };

  // Calculate Growth Potential
  const prediction = predictions[29]; // Use the 30th prediction
  const growthPotential = Math.max(
    0,
    (prediction - stock.currentPrice) / stock.currentPrice
  );

  // Evaluate Valuation
  let valuationScore = 1;
  if (stock.peRatio < 15) valuationScore *= 1.1; // Undervalued
  if (stock.peRatio > 30) valuationScore *= 0.9; // Overvalued
  if (stock.pbRatio < 1) valuationScore *= 1.2; // Undervalued on PB
  if (stock.pbRatio > 3) valuationScore *= 0.8; // Overvalued on PB

  // Assess Market Stability
  const priceRange = stock.highPrice - stock.lowPrice;
  const volatility = priceRange / stock.currentPrice;
  let stabilityScore = 1 - Math.min(volatility, 1); // Higher volatility reduces stability
  if (stock.marketCap > 5e11) stabilityScore *= 1.1; // Large-cap stability
  if (stock.marketCap < 1e11) stabilityScore *= 0.9; // Small-cap instability

  // Factor in Dividend Benefit
  const dividendBenefit = Math.min(stock.dividendYield, 0.05); // Cap at 5%

  // Analyze Historical Performance
  const historicalPerformance =
    (stock.currentPrice - stock.fiftyTwoWeekLow) /
    (stock.fiftyTwoWeekHigh - stock.fiftyTwoWeekLow);

  // Calculate Weighted Score
  const totalScore =
    growthPotential * weights.growthPotential +
    valuationScore * weights.valuation +
    stabilityScore * weights.marketStability +
    dividendBenefit * weights.dividendBenefit +
    historicalPerformance * weights.historicalPerformance;

  // Normalize score between 0 and 1
  return Math.min(Math.max(totalScore / 2, 0), 1); // Adjust the divisor (2) as needed for scaling
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
