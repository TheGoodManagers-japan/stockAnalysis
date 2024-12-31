import { analyzeStock } from "./trainandpredict.js";


/***********************************************
 * 1) DETERMINE RISK
 ***********************************************/
function determineRisk(stock) {
  // Calculate volatility
  const priceRange = stock.highPrice - stock.lowPrice;
  const volatility = priceRange / stock.currentPrice;

  // Classify based on volatility and market cap
  let riskLevel = "medium";
  if (volatility > 0.5 || stock.marketCap < 1e11) {
    riskLevel = "high"; // High risk for volatile or small-cap stocks
  } else if (volatility < 0.2 && stock.marketCap > 5e11) {
    riskLevel = "low"; // Low risk for stable, large-cap stocks
  }
  return riskLevel;
}

/***********************************************
 * 2) CALCULATE STOP-LOSS AND TARGET
 ***********************************************/
function calculateStopLossAndTarget(stock, prediction) {
  // Determine Risk Tolerance
  const riskTolerance = determineRisk(stock);
  const riskMultipliers = {
    low: { stopLossFactor: 0.85, targetBoost: 0.95 },
    medium: { stopLossFactor: 0.9, targetBoost: 1 },
    high: { stopLossFactor: 1, targetBoost: 1.05 },
  };
  const riskFactor = riskMultipliers[riskTolerance];

  /*********************************************
   * a) ATR Calculation (Mock/Simplified)
   *********************************************/
  const priceRange = stock.highPrice - stock.lowPrice;
  // Normally, ATR is computed over multiple days,
  // but here is a simplified approach:
  const atr = priceRange / 14;

  /*********************************************
   * b) Dynamic Stop-Loss (using a buffer)
   *********************************************/
  // Instead of computing separate 'atrBuffer' and 'percentageBuffer' 
  // and then mixing them in a confusing way, 
  // we calculate a single dynamic buffer:
  const dynamicBuffer = Math.max(
    1.5 * atr,            // 1.5 x ATR
    0.1 * stock.currentPrice // 10% buffer
  );

  // Tentative raw stop-loss
  let rawStopLoss = stock.currentPrice - dynamicBuffer;

  // Slight buffer above the recent low or 52-week low
  const historicalLow = Math.max(
    stock.lowPrice * 1.02,      // Slight buffer above recent low
    stock.fiftyTwoWeekLow * 1.05 // Slight buffer above 52-week low
  );

  // Decide how to incorporate the historical low. 
  // If we never want the stop-loss to go BELOW historicalLow:
  let stopLoss = Math.max(rawStopLoss, historicalLow);

  // Ensure non-negative (in case the computed stop-loss is < 0 for small stocks)
  stopLoss = Math.max(stopLoss, 0);

  /*********************************************
   * c) Predicted Growth & Target Price
   *********************************************/
  // Growth potential: difference between prediction & currentPrice 
  // as a % of currentPrice
  // We cap negative growth at -10% in this example.
  const rawGrowth = (prediction - stock.currentPrice) / stock.currentPrice;
  const growthPotential = Math.max(rawGrowth, -0.1);

  // Start with currentPrice as a base
  let targetPrice = stock.currentPrice;

  if (growthPotential >= 0) {
    // For positive growth: Weighted approach
    const confidenceWeight = 0.7;
    const metricsTarget = stock.currentPrice * (1 + growthPotential * 0.5); 
    // Weighted average of prediction & metricsTarget
    targetPrice =
      prediction * confidenceWeight + 
      metricsTarget * (1 - confidenceWeight);
  } else {
    // For negative growth: reduce target
    // If growthPotential = -0.1, this is effectively 90% of current price
    targetPrice = stock.currentPrice * (1 + growthPotential);
  }

  /*********************************************
   * d) Final Adjustments: Dividend & Risk Factor
   *********************************************/
  // Apply a small boost based on dividend yield (capped at 3%)
  const dividendBoost = 1 + Math.min(stock.dividendYield / 100, 0.03);

  // NOTE: If you want riskier stocks to have a smaller target,
  // you could invert the high-risk factor. However, 
  // currently your code does this:
  //   targetPrice *= riskFactor.targetBoost
  targetPrice *= (dividendBoost * riskFactor.targetBoost);

  // Convert results to two decimals
  return {
    stopLoss: parseFloat(stopLoss.toFixed(2)),
    targetPrice: parseFloat(targetPrice.toFixed(2)),
    riskTolerance
  };
}

/***********************************************
 * 3) COMPUTE SCORE
 ***********************************************/
function computeScore(stock, predictions) {
  // Weights for different factors
  const weights = {
    growthPotential: 0.4,
    valuation: 0.3,
    marketStability: 0.2,
    dividendBenefit: 0.05,
    historicalPerformance: 0.05,
  };

  // 30-day prediction
  const prediction = predictions[29];

  // Calculate growthPotential first 
  // (cap it between 0% and 50% for scoring):
  let growthPotential = (prediction - stock.currentPrice) / stock.currentPrice;
  if (growthPotential < 0) {
    // If negative, penalize more than just flooring to 0
    // but let's do that in two stages:
    // 1) Multiply by 0.5 to reduce the negative impact
    growthPotential *= 0.5;
  }

  // Next, we clamp to [–∞, 0.5], then floor if you want no negative in final:
  growthPotential = Math.min(growthPotential, 0.5);
  // If you do NOT want negative growth to be zeroed out, skip max(0, ...).
  // If you do want negative growth to be zeroed, then:
  // growthPotential = Math.max(growthPotential, 0);

  /*********************************************
   * a) Valuation Score
   *********************************************/
  let valuationScore = 1;
  if (stock.peRatio < 15) valuationScore *= 1.1;
  if (stock.peRatio > 30) valuationScore *= 0.9;
  if (stock.pbRatio < 1) valuationScore *= 1.2;
  if (stock.pbRatio > 3) valuationScore *= 0.8;
  
  // Optionally clamp valuationScore so it doesn’t get too big/small:
  // valuationScore = Math.max(0, Math.min(valuationScore, 2));

  /*********************************************
   * b) Market Stability
   *********************************************/
  const priceRange = stock.highPrice - stock.lowPrice;
  const volatility = priceRange / stock.currentPrice;
  const stabilityScore = 1 - Math.min(volatility, 0.5); 
  // Higher volatility => lower stabilityScore.

  /*********************************************
   * c) Dividend & Historical Perf
   *********************************************/
  const dividendBenefit = Math.min(stock.dividendYield / 100, 0.05);
  const historicalPerformance = 
    (stock.currentPrice - stock.fiftyTwoWeekLow) /
    (stock.fiftyTwoWeekHigh - stock.fiftyTwoWeekLow);

  /*********************************************
   * d) Combine All for Raw Score
   *********************************************/
  const rawScore =
    growthPotential * weights.growthPotential +
    valuationScore * weights.valuation +
    stabilityScore * weights.marketStability +
    dividendBenefit * weights.dividendBenefit +
    historicalPerformance * weights.historicalPerformance;

  // Finally clamp rawScore between 0 and 1
  const finalScore = Math.min(Math.max(rawScore, 0), 1);

  return finalScore;
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
        { code: "6479.T", sector: "Electric Machinery" },
        { code: "6501.T", sector: "Electric Machinery" },
        { code: "6503.T", sector: "Electric Machinery" },
        { code: "6504.T", sector: "Electric Machinery" },
        { code: "6506.T", sector: "Electric Machinery" },
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
