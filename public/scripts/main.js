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
function computeScore(stock, sector) {
  // Refined Weights
  const weights = {
    valuation: 0.35,
    marketStability: 0.25,
    dividendBenefit: 0.2,
    historicalPerformance: 0.2,
  };

  // Sector-Based Adjustments
  const sectorMultipliers = {
    Pharmaceuticals: { valuation: 1.1, stability: 0.9, dividend: 1.0 },
    "Electric Machinery": { valuation: 1.0, stability: 1.0, dividend: 1.0 },
    Automobiles: { valuation: 1.2, stability: 0.8, dividend: 0.9 },
    "Precision Instruments": { valuation: 1.0, stability: 1.1, dividend: 1.0 },
    Communications: { valuation: 0.9, stability: 1.1, dividend: 1.1 },
    Banking: { valuation: 1.3, stability: 0.8, dividend: 1.2 },
    "Other Financial Services": {
      valuation: 1.2,
      stability: 0.9,
      dividend: 1.1,
    },
    Securities: { valuation: 1.0, stability: 0.8, dividend: 1.2 },
    Insurance: { valuation: 1.1, stability: 0.9, dividend: 1.3 },
    Fishery: { valuation: 1.0, stability: 1.0, dividend: 1.0 },
    Foods: { valuation: 1.0, stability: 1.2, dividend: 1.2 },
    Retail: { valuation: 1.1, stability: 1.0, dividend: 1.0 },
    Services: { valuation: 1.0, stability: 1.0, dividend: 1.0 },
    Mining: { valuation: 1.2, stability: 0.8, dividend: 0.9 },
    "Textiles & Apparel": { valuation: 1.0, stability: 1.0, dividend: 1.0 },
    "Pulp & Paper": { valuation: 1.1, stability: 0.9, dividend: 1.0 },
    Chemicals: { valuation: 1.1, stability: 0.9, dividend: 1.0 },
    Petroleum: { valuation: 1.2, stability: 0.8, dividend: 0.9 },
    Rubber: { valuation: 1.0, stability: 0.9, dividend: 1.0 },
    "Glass & Ceramics": { valuation: 1.0, stability: 0.9, dividend: 1.0 },
    Steel: { valuation: 1.1, stability: 0.8, dividend: 1.0 },
    "Nonferrous Metals": { valuation: 1.0, stability: 0.8, dividend: 1.0 },
    "Trading Companies": { valuation: 1.1, stability: 1.0, dividend: 1.0 },
    Construction: { valuation: 1.0, stability: 1.0, dividend: 1.0 },
    Machinery: { valuation: 1.1, stability: 1.0, dividend: 1.0 },
    Shipbuilding: { valuation: 1.2, stability: 0.7, dividend: 0.9 },
    "Other Manufacturing": { valuation: 1.0, stability: 1.0, dividend: 1.0 },
    "Real Estate": { valuation: 1.1, stability: 0.9, dividend: 1.0 },
    "Railway & Bus": { valuation: 1.0, stability: 1.2, dividend: 1.1 },
    "Land Transport": { valuation: 1.0, stability: 1.2, dividend: 1.1 },
    "Marine Transport": { valuation: 1.1, stability: 0.8, dividend: 1.0 },
    "Air Transport": { valuation: 1.2, stability: 0.8, dividend: 0.9 },
    Warehousing: { valuation: 1.0, stability: 1.0, dividend: 1.0 },
    "Electric Power": { valuation: 1.0, stability: 1.2, dividend: 1.3 },
    Gas: { valuation: 1.0, stability: 1.2, dividend: 1.3 },
  };

  const sectorMultiplier = sectorMultipliers[sector] || {
    valuation: 1.0,
    stability: 1.0,
    dividend: 1.0,
  };


  // 1. Valuation Score (Encourages low P/E and P/B ratios)
  let valuationScore = 1;
  if (stock.peRatio < 15) valuationScore *= 1.1;
  else if (stock.peRatio >= 15 && stock.peRatio <= 25)
    valuationScore *= 1; // Neutral range
  else valuationScore *= 0.8; // Penalize high P/E ratios

  if (stock.pbRatio < 1) valuationScore *= 1.2; // Very favorable
  else if (stock.pbRatio >= 1 && stock.pbRatio <= 3)
    valuationScore *= 1; // Neutral range
  else valuationScore *= 0.8; // Penalize high P/B ratios

  valuationScore *= sectorMultiplier.valuation; // Apply sector adjustment

  // Scale to [0.5, 1.2] for better distribution
  valuationScore = Math.min(Math.max(valuationScore, 0.5), 1.2);

  // 2. Market Stability (Encourages lower volatility)
  const priceRange = stock.highPrice - stock.lowPrice;
  const volatility = priceRange / stock.currentPrice; // Relative volatility
  const stabilityScore = Math.max(1 - volatility, 0.5); // Higher stability = closer to 1; clamp at 0.5
  const adjustedStabilityScore = stabilityScore * sectorMultiplier.stability;

  // 3. Dividend Benefit (Rewards higher yields, capped at 5%)
  const dividendBenefit = Math.min(stock.dividendYield / 100, 0.05); // Normalize to a max of 5%
  const adjustedDividendBenefit = dividendBenefit * sectorMultiplier.dividend;

  // 4. Historical Performance (Encourages stocks closer to their highs)
  const range = stock.fiftyTwoWeekHigh - stock.fiftyTwoWeekLow;
  const positionInRange = (stock.currentPrice - stock.fiftyTwoWeekLow) / range; // Closer to 1 is better
  const historicalPerformance = Math.min(Math.max(positionInRange, 0), 1); // Clamp between 0 and 1

  // Weighted Sum of Scores
  const rawScore =
    valuationScore * weights.valuation +
    adjustedStabilityScore * weights.marketStability +
    adjustedDividendBenefit * weights.dividendBenefit +
    historicalPerformance * weights.historicalPerformance;

  // Clamp final score between 0 and 1
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
    console.log("data :",data)
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
        
      ];


      // (B) Loop through each ticker, fetch data, run analysis
      for (const tickerObj of tickers) {
        console.log(`\n--- Fetching data for ${tickerObj.code} ---`);

        try {
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

          // 6) Compute growth potential
          const growthPotential =
            ((stock.targetPrice - stock.currentPrice) / stock.currentPrice) *
            100; // Express as percentage

          // 7) Compute score
          stock.score = computeScore(stock, stock.sector);

          // 8) Calculate the final weighted score
          const weights = {
            metrics: 0.7, // 70% weight to metrics score
            growth: 0.3,  // 30% weight to growth potential
          };
          const finalScore =
            weights.metrics * stock.score +
            weights.growth * (growthPotential / 100); // Convert growth to a decimal

          // 9) Send the processed ticker's data to Bubble
          bubble_fn_result({
            outputlist1: [stock.ticker],
            outputlist2: [stock.sector],
            outputlist3: [stock.currentPrice],
            outputlist4: [stock.highPrice],
            outputlist5: [stock.lowPrice],
            outputlist6: [stock.openPrice],
            outputlist7: [stock.prevClosePrice],
            outputlist8: [stock.marketCap],
            outputlist9: [stock.peRatio],
            outputlist10: [stock.pbRatio],
            outputlist11: [stock.dividendYield],
            outputlist12: [stock.fiftyTwoWeekHigh],
            outputlist13: [stock.fiftyTwoWeekLow],
            outputlist14: [stock.eps],
            outputlist15: [prediction],
            outputlist16: [stock.stopLoss],
            outputlist17: [stock.targetPrice],
            outputlist18: [stock.score],
            outputlist19: [growthPotential.toFixed(2)], // Growth Potential as a percentage
            outputlist20: [finalScore.toFixed(2)],     // Final Weighted Score
          });

          console.log(`Ticker ${stock.ticker} data sent to Bubble.`);
        } catch (error) {
          console.error(
            `Error processing ticker ${tickerObj.code}:`,
            error.message
          );
        }
      }
    } catch (error) {
      console.error("Error in fetchStockAnalysis:", error.message);
      throw new Error("Analysis aborted due to errors.");
    }
  },
};



window.scanCurrentPrice = {
  async fetchCurrentPrices(tickers) {
    try {
      // (A) Initialize output lists
      const outputlist1 = []; // Tickers
      const outputlist2 = []; // Current Prices

      // (B) Loop through each ticker, fetch data, and prepare the outputs
      for (const ticker of tickers) {
        console.log(`\n--- Fetching current price for ${ticker} ---`);

        try {
          // Fetch Yahoo data from the server
          const result = await fetchSingleStockData({ code: ticker });
          if (!result.success) {
            console.error("Error fetching stock data:", result.error);
            throw new Error("Failed to fetch Yahoo data.");
          }

          // Deconstruct the server response
          const { code, yahooData } = result.data;
          if (!yahooData || !yahooData.currentPrice) {
            console.error(
              `Incomplete Yahoo data for ${code}. Skipping this ticker.`
            );
            continue;
          }

          // Add to the output lists
          outputlist1.push(code); // Ticker
          outputlist2.push(yahooData.currentPrice); // Current Price

          console.log(
            `Ticker ${code}: Current Price fetched: ${yahooData.currentPrice}`
          );
        } catch (error) {
          console.error(`Error processing ticker ${ticker}:`, error.message);
        }
      }

      // (C) Send the final outputs to Bubble
      bubble_fn_currentPrice({
        outputlist1: outputlist1,
        outputlist2: outputlist2,
      });

      console.log("\nFinal output lists sent to Bubble:", {
        outputlist1,
        outputlist2,
      });
    } catch (error) {
      console.error("Error in fetchCurrentPrices:", error.message);
      throw new Error("Process aborted due to errors.");
    }
  },
};
