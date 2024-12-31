import { analyzeStock } from "./trainandpredict.js";


/***********************************************
 * 1) DETERMINE RISK
 ***********************************************/
function determineRisk(stock) {
  const priceRange = stock.highPrice - stock.lowPrice;
  const volatility = priceRange / stock.currentPrice;

  let riskLevel = "medium";
  if (volatility > 0.5 || stock.marketCap < 1e11) {
    riskLevel = "high";
  } else if (volatility < 0.2 && stock.marketCap > 5e11) {
    riskLevel = "low";
  }
  return riskLevel;
}

function calculateStopLossAndTarget(stock, prediction) {
  // 1) Determine Risk Tolerance
  const riskTolerance = determineRisk(stock);
  const riskMultipliers = {
    low: { stopLossFactor: 0.85, targetBoost: 0.95 },
    medium: { stopLossFactor: 0.9, targetBoost: 1.0 },
    high: { stopLossFactor: 1.0, targetBoost: 1.05 },
  };
  const riskFactor = riskMultipliers[riskTolerance];

  // 2) ATR (simplified)
  const priceRange = stock.highPrice - stock.lowPrice;
  const atr = priceRange / 14;

  // 3) Dynamic buffer: choose whichever is bigger:
  //    - 1.5 x ATR
  //    - 5% of current price
  //    (Lower than 10% if it's only for a few weeks.)
  const dynamicBuffer = Math.max(1.5 * atr, 0.05 * stock.currentPrice);

  // 4) Tentative rawStopLoss
  let rawStopLoss = stock.currentPrice - dynamicBuffer;

  /*******************************************************
   * 5) "Historical Floor" logic
   *    - If you want the stop to never go below either:
   *      (dailyLow minus a small negative buffer)
   *      or (fiftyTwoWeekLow minus a small negative buffer),
   *    - We might do something like:
   *******************************************************/
  // Slightly below daily low
  const dailyLowFloor = stock.lowPrice * 0.995; // e.g. 0.5% below daily low
  // Slightly below 52-week low
  const yearLowFloor = stock.fiftyTwoWeekLow * 0.995;
  // We'll pick whichever is higher (i.e. the "less deep" floor)
  let historicalFloor = Math.max(dailyLowFloor, yearLowFloor);

  // If that "floor" is above the currentPrice, clamp it
  if (historicalFloor > stock.currentPrice) {
    historicalFloor = stock.currentPrice * 0.98;
    // i.e. let's keep it just below current price
  }

  // 6) Combine rawStopLoss with historicalFloor
  //    We don't want to go *lower* than historicalFloor:
  rawStopLoss = Math.max(rawStopLoss, historicalFloor);

  /*******************************************************
   * 7) If we also want a short-term max Stop-Loss:
   *    e.g., don't risk more than 8% from currentPrice:
   *******************************************************/
  const maxStopLossPercent = 0.08;
  const maxStopLossPrice = stock.currentPrice * (1 - maxStopLossPercent);
  if (rawStopLoss < maxStopLossPrice) {
    rawStopLoss = maxStopLossPrice;
  }

  /*******************************************************
   * 8) Final clamp: ensure we don't exceed the current price.
   *    If rawStopLoss somehow ended up above currentPrice,
   *    set it to 1% below currentPrice, for example.
   *******************************************************/
  if (rawStopLoss >= stock.currentPrice) {
    rawStopLoss = stock.currentPrice * 0.99;
  }

  // At this point, rawStopLoss should be below current price.
  const stopLoss = parseFloat(rawStopLoss.toFixed(2));

  /*******************************************************
   * 9) Target Price Calculation
   *******************************************************/
  const rawGrowth = (prediction - stock.currentPrice) / stock.currentPrice;
  // For example, cap negative growth at -10%
  const growthPotential = Math.max(rawGrowth, -0.1);

  let targetPrice;
  if (growthPotential >= 0) {
    // Weighted average approach
    const confidenceWeight = 0.7;
    const metricsTarget = stock.currentPrice * (1 + growthPotential * 0.5);
    targetPrice =
      prediction * confidenceWeight + metricsTarget * (1 - confidenceWeight);
  } else {
    // Negative => reduce from current price
    targetPrice = stock.currentPrice * (1 + growthPotential);
  }

  // Dividend & Risk Factor
  const dividendBoost = 1 + Math.min(stock.dividendYield / 100, 0.03);
  targetPrice *= dividendBoost * riskFactor.targetBoost;

  return {
    stopLoss: parseFloat(stopLoss.toFixed(2)),
    targetPrice: parseFloat(targetPrice.toFixed(2)),
    riskTolerance,
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
