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

  // 3) Dynamic buffer
  const dynamicBuffer = Math.max(1.5 * atr, 0.05 * stock.currentPrice);

  // 4) Tentative rawStopLoss
  let rawStopLoss = stock.currentPrice - dynamicBuffer;

  // 5) Historical Floor logic
  const dailyLowFloor = stock.lowPrice * 0.995;
  const yearLowFloor = stock.fiftyTwoWeekLow * 0.995;
  let historicalFloor = Math.max(dailyLowFloor, yearLowFloor);
  if (historicalFloor > stock.currentPrice) {
    historicalFloor = stock.currentPrice * 0.98;
  }

  // 6) Combine rawStopLoss with historicalFloor
  rawStopLoss = Math.max(rawStopLoss, historicalFloor);

  // 7) Short-term max stop-loss (clamp to max 8% below current)
  const maxStopLossPrice = stock.currentPrice * (1 - 0.08);
  if (rawStopLoss < maxStopLossPrice) {
    rawStopLoss = maxStopLossPrice;
  }

  // 8) Final clamp: ensure not above currentPrice
  if (rawStopLoss >= stock.currentPrice) {
    rawStopLoss = stock.currentPrice * 0.99;
  }

  const stopLoss = parseFloat(rawStopLoss.toFixed(2));

  // 9) Target Price Calculation
  const rawGrowth = (prediction - stock.currentPrice) / stock.currentPrice;
  // Example: cap negative growth at -10%
  const growthPotential = Math.max(rawGrowth, -0.1);

  let targetPrice;
  if (growthPotential >= 0) {
    // Weighted approach
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
 * COMPUTE SCORE - using the computed targetPrice
 ***********************************************/
function computeScore(stock) {
  // Weights
  const weights = {
    growthPotential: 0.4,
    valuation: 0.3,
    marketStability: 0.2,
    dividendBenefit: 0.05,
    historicalPerformance: 0.05,
  };

  // Growth Potential
  let growthPotential =
    (stock.targetPrice - stock.currentPrice) / stock.currentPrice;

  // If negative => entire score = 0 (hard rule)
  if (growthPotential < 0) {
    return 0;
  }

  // If not negative, proceed
  growthPotential = Math.min(growthPotential, 0.5); // clamp

  // Valuation
  let valuationScore = 1;
  if (stock.peRatio < 15) valuationScore *= 1.1;
  if (stock.peRatio > 30) valuationScore *= 0.9;
  if (stock.pbRatio < 1) valuationScore *= 1.2;
  if (stock.pbRatio > 3) valuationScore *= 0.8;

  // Market Stability
  const priceRange = stock.highPrice - stock.lowPrice;
  const volatility = priceRange / stock.currentPrice;
  const stabilityScore = 1 - Math.min(volatility, 0.5);

  // Dividend
  const dividendBenefit = Math.min(stock.dividendYield / 100, 0.05);

  // Historical Performance
  const historicalPerformance =
    (stock.currentPrice - stock.fiftyTwoWeekLow) /
    (stock.fiftyTwoWeekHigh - stock.fiftyTwoWeekLow);

  // Weighted Sum
  const rawScore =
    growthPotential * weights.growthPotential +
    valuationScore * weights.valuation +
    stabilityScore * weights.marketStability +
    dividendBenefit * weights.dividendBenefit +
    historicalPerformance * weights.historicalPerformance;

  // Clamp [0..1]
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
        { code: "7974.T", sector: "Services" },
      ];

      // (B) Initialize lists for outputs
      const sectors = [];
      const tickersList = [];
      const currentPrices = [];
      const highPrices = [];
      const lowPrices = [];
      const openPrices = [];
      const prevClosePrices = [];
      const marketCaps = [];
      const peRatios = [];
      const pbRatios = [];
      const dividendYields = [];
      const fiftyTwoWeekHighs = [];
      const fiftyTwoWeekLows = [];
      const epsList = [];
      const predictionsList = [];
      const stopLosses = [];
      const targetPrices = [];
      const scores = [];

      // (C) Loop through each ticker, fetch data, run analysis
      for (const tickerObj of tickers) {
        console.log(`\n--- Fetching data for ${tickerObj.code} ---`);

        // 1) Fetch Yahoo data from the server
        const result = await fetchSingleStockData(tickerObj);
        if (!result.success) {
          console.error("Error fetching stock analysis:", result.error);
          throw new Error("Failed to fetch Yahoo data.");
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

        // Add to the full list of sectors
        sectors.push(sector);

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
        if (!predictions || predictions.length <= 29) {
          console.error(
            `Insufficient predictions available for ${stock.ticker}. Aborting calculation.`
          );
          throw new Error("Failed to generate sufficient predictions.");
        }

        // Extract the 29th prediction
        const prediction = predictions[29];
        stock.predictions = predictions;

        // 5) Calculate stop loss & target price
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

        // 6) Compute score
        stock.score = computeScore(stock);

        // 7) Add stock data to respective lists
        tickersList.push(stock.ticker);
        currentPrices.push(stock.currentPrice);
        highPrices.push(stock.highPrice);
        lowPrices.push(stock.lowPrice);
        openPrices.push(stock.openPrice);
        prevClosePrices.push(stock.prevClosePrice);
        marketCaps.push(stock.marketCap);
        peRatios.push(stock.peRatio);
        pbRatios.push(stock.pbRatio);
        dividendYields.push(stock.dividendYield);
        fiftyTwoWeekHighs.push(stock.fiftyTwoWeekHigh);
        fiftyTwoWeekLows.push(stock.fiftyTwoWeekLow);
        epsList.push(stock.eps);
        predictionsList.push(prediction); // Only the 29th prediction is sent
        stopLosses.push(stock.stopLoss);
        targetPrices.push(stock.targetPrice);
        scores.push(stock.score);

        console.log(`Updated stock data for ${stock.ticker}:`, stock);
      }

      // (D) Send data to Bubble
      bubble_fn_result({
        outputlist1: sectors, // All sectors in order of stocks
        outputlist2: tickersList,
        outputlist3: currentPrices,
        outputlist4: highPrices,
        outputlist5: lowPrices,
        outputlist6: openPrices,
        outputlist7: prevClosePrices,
        outputlist8: marketCaps,
        outputlist9: peRatios,
        outputlist10: pbRatios,
        outputlist11: dividendYields,
        outputlist12: fiftyTwoWeekHighs,
        outputlist13: fiftyTwoWeekLows,
        outputlist14: epsList,
        outputlist15: predictionsList, // Only the 29th prediction
        outputlist16: stopLosses,
        outputlist17: targetPrices,
        outputlist18: scores,
      });

      console.log("\nData sent to Bubble successfully.");
    } catch (error) {
      console.error("Error in fetchStockAnalysis:", error.message);
      throw new Error("Analysis aborted due to errors.");
    }
  },
};
