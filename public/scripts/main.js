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
        { code: "4502.T", sector: "Pharmaceuticals" },
        { code: "4503.T", sector: "Pharmaceuticals" },
        { code: "4506.T", sector: "Pharmaceuticals" },
        { code: "4507.T", sector: "Pharmaceuticals" },
        { code: "4519.T", sector: "Pharmaceuticals" },
        { code: "4523.T", sector: "Pharmaceuticals" },
        { code: "4568.T", sector: "Pharmaceuticals" },
        { code: "4578.T", sector: "Pharmaceuticals" },
        { code: "6479.T", sector: "Electric Machinery" },
        { code: "6501.T", sector: "Electric Machinery" },
        { code: "6503.T", sector: "Electric Machinery" },
        { code: "6504.T", sector: "Electric Machinery" },
        { code: "6506.T", sector: "Electric Machinery" },
        { code: "6526.T", sector: "Electric Machinery" },
        { code: "6594.T", sector: "Electric Machinery" },
        { code: "6645.T", sector: "Electric Machinery" },
        { code: "6674.T", sector: "Electric Machinery" },
        { code: "6701.T", sector: "Electric Machinery" },
        { code: "6702.T", sector: "Electric Machinery" },
        { code: "6723.T", sector: "Electric Machinery" },
        { code: "6724.T", sector: "Electric Machinery" },
        { code: "6752.T", sector: "Electric Machinery" },
        { code: "6753.T", sector: "Electric Machinery" },
        { code: "6758.T", sector: "Electric Machinery" },
        { code: "6762.T", sector: "Electric Machinery" },
        { code: "6770.T", sector: "Electric Machinery" },
        { code: "6841.T", sector: "Electric Machinery" },
        { code: "6857.T", sector: "Electric Machinery" },
        { code: "6861.T", sector: "Electric Machinery" },
        { code: "6902.T", sector: "Electric Machinery" },
        { code: "6920.T", sector: "Electric Machinery" },
        { code: "6952.T", sector: "Electric Machinery" },
        { code: "6954.T", sector: "Electric Machinery" },
        { code: "6971.T", sector: "Electric Machinery" },
        { code: "6976.T", sector: "Electric Machinery" },
        { code: "6981.T", sector: "Electric Machinery" },
        { code: "7735.T", sector: "Electric Machinery" },
        { code: "7751.T", sector: "Electric Machinery" },
        { code: "7752.T", sector: "Electric Machinery" },
        { code: "8035.T", sector: "Electric Machinery" },
        { code: "7201.T", sector: "Automobiles & Auto parts" },
        { code: "7202.T", sector: "Automobiles & Auto parts" },
        { code: "7203.T", sector: "Automobiles & Auto parts" },
        { code: "7205.T", sector: "Automobiles & Auto parts" },
        { code: "7211.T", sector: "Automobiles & Auto parts" },
        { code: "7261.T", sector: "Automobiles & Auto parts" },
        { code: "7267.T", sector: "Automobiles & Auto parts" },
        { code: "7269.T", sector: "Automobiles & Auto parts" },
        { code: "7270.T", sector: "Automobiles & Auto parts" },
        { code: "7272.T", sector: "Automobiles & Auto parts" },
        { code: "4543.T", sector: "Precision Instruments" },
        { code: "4902.T", sector: "Precision Instruments" },
        { code: "6146.T", sector: "Precision Instruments" },
        { code: "7731.T", sector: "Precision Instruments" },
        { code: "7733.T", sector: "Precision Instruments" },
        { code: "7741.T", sector: "Precision Instruments" },
        { code: "7762.T", sector: "Precision Instruments" },
        { code: "9432.T", sector: "Communications" },
        { code: "9433.T", sector: "Communications" },
        { code: "9434.T", sector: "Communications" },
        { code: "9613.T", sector: "Communications" },
        { code: "9984.T", sector: "Communications" },
        { code: "5831.T", sector: "Banking" },
        { code: "7186.T", sector: "Banking" },
        { code: "8304.T", sector: "Banking" },
        { code: "8306.T", sector: "Banking" },
        { code: "8308.T", sector: "Banking" },
        { code: "8309.T", sector: "Banking" },
        { code: "8316.T", sector: "Banking" },
        { code: "8331.T", sector: "Banking" },
        { code: "8354.T", sector: "Banking" },
        { code: "8411.T", sector: "Banking" },
        { code: "8253.T", sector: "Other Financial Services" },
        { code: "8591.T", sector: "Other Financial Services" },
        { code: "8697.T", sector: "Other Financial Services" },
        { code: "8601.T", sector: "Securities" },
        { code: "8604.T", sector: "Securities" },
        { code: "8630.T", sector: "Insurance" },
        { code: "8725.T", sector: "Insurance" },
        { code: "8750.T", sector: "Insurance" },
        { code: "8766.T", sector: "Insurance" },
        { code: "8795.T", sector: "Insurance" },
        { code: "1332.T", sector: "Fishery" },
        { code: "2002.T", sector: "Foods" },
        { code: "2269.T", sector: "Foods" },
        { code: "2282.T", sector: "Foods" },
        { code: "2501.T", sector: "Foods" },
        { code: "2502.T", sector: "Foods" },
        { code: "2503.T", sector: "Foods" },
        { code: "2801.T", sector: "Foods" },
        { code: "2802.T", sector: "Foods" },
        { code: "2871.T", sector: "Foods" },
        { code: "2914.T", sector: "Foods" },
        { code: "3086.T", sector: "Retail" },
        { code: "3092.T", sector: "Retail" },
        { code: "3099.T", sector: "Retail" },
        { code: "3382.T", sector: "Retail" },
        { code: "7453.T", sector: "Retail" },
        { code: "8233.T", sector: "Retail" },
        { code: "8252.T", sector: "Retail" },
        { code: "8267.T", sector: "Retail" },
        { code: "9843.T", sector: "Retail" },
        { code: "9983.T", sector: "Retail" },
        { code: "2413.T", sector: "Services" },
        { code: "2432.T", sector: "Services" },
        { code: "3659.T", sector: "Services" },
        { code: "4307.T", sector: "Services" },
        { code: "4324.T", sector: "Services" },
        { code: "4385.T", sector: "Services" },
        { code: "4661.T", sector: "Services" },
        { code: "4689.T", sector: "Services" },
        { code: "4704.T", sector: "Services" },
        { code: "4751.T", sector: "Services" },
        { code: "4755.T", sector: "Services" },
        { code: "6098.T", sector: "Services" },
        { code: "6178.T", sector: "Services" },
        { code: "9602.T", sector: "Services" },
        { code: "9735.T", sector: "Services" },
        { code: "9766.T", sector: "Services" },
        { code: "1605.T", sector: "Mining" },
        { code: "3401.T", sector: "Textiles & Apparel" },
        { code: "3402.T", sector: "Textiles & Apparel" },
        { code: "3861.T", sector: "Pulp & Paper" },
        { code: "3405.T", sector: "Chemicals" },
        { code: "3407.T", sector: "Chemicals" },
        { code: "4004.T", sector: "Chemicals" },
        { code: "4005.T", sector: "Chemicals" },
        { code: "4021.T", sector: "Chemicals" },
        { code: "4042.T", sector: "Chemicals" },
        { code: "4043.T", sector: "Chemicals" },
        { code: "4061.T", sector: "Chemicals" },
        { code: "4063.T", sector: "Chemicals" },
        { code: "4183.T", sector: "Chemicals" },
        { code: "4188.T", sector: "Chemicals" },
        { code: "4208.T", sector: "Chemicals" },
        { code: "4452.T", sector: "Chemicals" },
        { code: "4901.T", sector: "Chemicals" },
        { code: "4911.T", sector: "Chemicals" },
        { code: "6988.T", sector: "Chemicals" },
        { code: "5019.T", sector: "Petroleum" },
        { code: "5020.T", sector: "Petroleum" },
        { code: "5101.T", sector: "Rubber" },
        { code: "5108.T", sector: "Rubber" },
        { code: "5201.T", sector: "Glass & Ceramics" },
        { code: "5214.T", sector: "Glass & Ceramics" },
        { code: "5233.T", sector: "Glass & Ceramics" },
        { code: "5301.T", sector: "Glass & Ceramics" },
        { code: "5332.T", sector: "Glass & Ceramics" },
        { code: "5333.T", sector: "Glass & Ceramics" },
        { code: "5401.T", sector: "Steel" },
        { code: "5406.T", sector: "Steel" },
        { code: "5411.T", sector: "Steel" },
        { code: "3436.T", sector: "Nonferrous Metals" },
        { code: "5706.T", sector: "Nonferrous Metals" },
        { code: "5711.T", sector: "Nonferrous Metals" },
        { code: "5713.T", sector: "Nonferrous Metals" },
        { code: "5714.T", sector: "Nonferrous Metals" },
        { code: "5801.T", sector: "Nonferrous Metals" },
        { code: "5802.T", sector: "Nonferrous Metals" },
        { code: "5803.T", sector: "Nonferrous Metals" },
        { code: "2768.T", sector: "Trading Companies" },
        { code: "8001.T", sector: "Trading Companies" },
        { code: "8002.T", sector: "Trading Companies" },
        { code: "8015.T", sector: "Trading Companies" },
        { code: "8031.T", sector: "Trading Companies" },
        { code: "8053.T", sector: "Trading Companies" },
        { code: "8058.T", sector: "Trading Companies" },
        { code: "1721.T", sector: "Construction" },
        { code: "1801.T", sector: "Construction" },
        { code: "1802.T", sector: "Construction" },
        { code: "1803.T", sector: "Construction" },
        { code: "1808.T", sector: "Construction" },
        { code: "1812.T", sector: "Construction" },
        { code: "1925.T", sector: "Construction" },
        { code: "1928.T", sector: "Construction" },
        { code: "1963.T", sector: "Construction" },
        { code: "5631.T", sector: "Machinery" },
        { code: "6103.T", sector: "Machinery" },
        { code: "6113.T", sector: "Machinery" },
        { code: "6273.T", sector: "Machinery" },
        { code: "6301.T", sector: "Machinery" },
        { code: "6302.T", sector: "Machinery" },
        { code: "6305.T", sector: "Machinery" },
        { code: "6326.T", sector: "Machinery" },
        { code: "6361.T", sector: "Machinery" },
        { code: "6367.T", sector: "Machinery" },
        { code: "6471.T", sector: "Machinery" },
        { code: "6472.T", sector: "Machinery" },
        { code: "6473.T", sector: "Machinery" },
        { code: "7004.T", sector: "Machinery" },
        { code: "7011.T", sector: "Machinery" },
        { code: "7013.T", sector: "Machinery" },
        { code: "7012.T", sector: "Shipbuilding" },
        { code: "7832.T", sector: "Other Manufacturing" },
        { code: "7911.T", sector: "Other Manufacturing" },
        { code: "7912.T", sector: "Other Manufacturing" },
        { code: "7951.T", sector: "Other Manufacturing" },
        { code: "3289.T", sector: "Real Estate" },
        { code: "8801.T", sector: "Real Estate" },
        { code: "8802.T", sector: "Real Estate" },
        { code: "8804.T", sector: "Real Estate" },
        { code: "8830.T", sector: "Real Estate" },
        { code: "9001.T", sector: "Railway & Bus" },
        { code: "9005.T", sector: "Railway & Bus" },
        { code: "9007.T", sector: "Railway & Bus" },
        { code: "9008.T", sector: "Railway & Bus" },
        { code: "9009.T", sector: "Railway & Bus" },
        { code: "9020.T", sector: "Railway & Bus" },
        { code: "9021.T", sector: "Railway & Bus" },
        { code: "9022.T", sector: "Railway & Bus" },
        { code: "9064.T", sector: "Land Transport" },
        { code: "9147.T", sector: "Land Transport" },
        { code: "9101.T", sector: "Marine Transport" },
        { code: "9104.T", sector: "Marine Transport" },
        { code: "9107.T", sector: "Marine Transport" },
        { code: "9201.T", sector: "Air Transport" },
        { code: "9202.T", sector: "Air Transport" },
        { code: "9301.T", sector: "Warehousing" },
        { code: "9501.T", sector: "Electric Power" },
        { code: "9502.T", sector: "Electric Power" },
        { code: "9503.T", sector: "Electric Power" },
        { code: "9531.T", sector: "Gas" },
        { code: "9532.T", sector: "Gas" },
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

          // 6) Compute score
          stock.score = computeScore(stock);

          // 7) Send the processed ticker's data to Bubble
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

