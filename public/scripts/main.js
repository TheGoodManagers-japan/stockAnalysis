/***********************************************
 * 0) HELPER FUNCTIONS FOR VOLATILITY & ATR
 ***********************************************/
/**
 * Calculate the standard deviation of daily log returns.
 * @param {Array} historicalData - array of daily objects [{ date, open, high, low, close, ...}, ...].
 * @returns {number} stdDev - the standard deviation of daily log returns.
 */
function calculateHistoricalVolatility(historicalData) {
  if (!historicalData || historicalData.length < 2) return 0;

  const logReturns = [];
  for (let i = 1; i < historicalData.length; i++) {
    const prevClose = historicalData[i - 1].close;
    const currClose = historicalData[i].close;
    if (prevClose > 0 && currClose > 0) {
      logReturns.push(Math.log(currClose / prevClose));
    }
  }

  const mean =
    logReturns.reduce((acc, val) => acc + val, 0) / (logReturns.length || 1);
  const variance =
    logReturns.reduce((acc, val) => acc + (val - mean) ** 2, 0) /
    (logReturns.length || 1);

  return Math.sqrt(variance);
}

/**
 * Calculate a more accurate ATR (Average True Range) over a given period (default 14 days).
 * @param {Array} historicalData - array of daily data: [{ high, low, close }, ...].
 * @param {number} period
 */
function calculateATR(historicalData, period = 14) {
  if (!historicalData || historicalData.length < period + 1) return 0;

  const trueRanges = [];
  for (let i = 1; i < historicalData.length; i++) {
    const { high, low, close } = historicalData[i];
    const prevClose = historicalData[i - 1].close;

    const range1 = high - low;
    const range2 = Math.abs(high - prevClose);
    const range3 = Math.abs(low - prevClose);

    trueRanges.push(Math.max(range1, range2, range3));
  }

  // Simple moving average of the last `period` true ranges
  let atrSum = 0;
  for (let i = trueRanges.length - period; i < trueRanges.length; i++) {
    atrSum += trueRanges[i];
  }
  const atr = atrSum / period;
  return atr;
}

/***********************************************
 * 1) DETERMINE RISK (Revised)
 ***********************************************/
function determineRisk(stock) {
  const volatility = calculateHistoricalVolatility(stock.historicalData);

  let riskLevel = "medium";
  if (volatility > 0.02 || stock.marketCap < 1e11) {
    riskLevel = "high";
  } else if (volatility < 0.01 && stock.marketCap > 5e11) {
    riskLevel = "low";
  }
  return riskLevel;
}

/***********************************************
 * 2) CALCULATE STOP LOSS & TARGET (Revised)
 ***********************************************/
function calculateStopLossAndTarget(stock, prediction) {
  console.log(`\n📊 Calculating Stop Loss & Target for ${stock.ticker}`);

  // 1) Determine Risk Tolerance
  const riskTolerance = determineRisk(stock);
  console.log(`🛡️ Risk Tolerance: ${riskTolerance}`);

  const riskMultipliers = {
    low: { stopLossFactor: 0.85, targetBoost: 0.95 },
    medium: { stopLossFactor: 0.9, targetBoost: 1.0 },
    high: { stopLossFactor: 1.0, targetBoost: 1.05 },
  };
  const riskFactor = riskMultipliers[riskTolerance];
  console.log("📐 Risk Factor:", riskFactor);

  // 2) Calculate ATR
  console.log(`Historical data ${stock.historicalData}`);
  const atr = calculateATR(stock.historicalData, 14);
  console.log("📈 ATR (14-day):", atr);

  // 3) Dynamic buffer
  const dynamicBuffer = Math.max(1.5 * atr, 0.05 * stock.currentPrice);
  console.log("🧮 Dynamic Buffer:", dynamicBuffer);

  // 4) Tentative rawStopLoss
  let rawStopLoss = stock.currentPrice - dynamicBuffer;
  console.log("🔧 Initial rawStopLoss:", rawStopLoss);

  // 5) Historical Floor logic
  const dailyLowFloor = stock.lowPrice * 0.995;
  const yearLowFloor = stock.fiftyTwoWeekLow * 0.995;
  let historicalFloor = Math.max(dailyLowFloor, yearLowFloor);
  if (historicalFloor > stock.currentPrice) {
    historicalFloor = stock.currentPrice * 0.98;
    console.log(
      "⚠️ Adjusted historicalFloor (was above current price):",
      historicalFloor
    );
  }
  rawStopLoss = Math.max(rawStopLoss, historicalFloor);
  console.log("🧱 Floor-adjusted rawStopLoss:", rawStopLoss);

  // 6) Clamp: short-term max stop-loss (8%)
  const maxStopLossPrice = stock.currentPrice * (1 - 0.08);
  if (rawStopLoss < maxStopLossPrice) {
    rawStopLoss = maxStopLossPrice;
    console.log("📉 Clamped to 8% max loss:", rawStopLoss);
  }

  // 7) Ensure not above currentPrice
  if (rawStopLoss >= stock.currentPrice) {
    rawStopLoss = stock.currentPrice * 0.99;
    console.log("🔒 Stop loss was >= current price. Adjusted to:", rawStopLoss);
  }

  const stopLoss = parseFloat(rawStopLoss.toFixed(2));
  console.log("✅ Final Stop Loss:", stopLoss);

  // 8) Target Price Calculation
  const rawGrowth = (prediction - stock.currentPrice) / stock.currentPrice;
  const growthPotential = Math.max(rawGrowth, -0.1);
  console.log("📊 Growth Potential:", (growthPotential * 100).toFixed(2) + "%");

  let targetPrice;
  if (growthPotential >= 0) {
    const confidenceWeight = 0.7;
    const metricsTarget = stock.currentPrice * (1 + growthPotential * 0.5);
    targetPrice =
      prediction * confidenceWeight + metricsTarget * (1 - confidenceWeight);
    console.log("🎯 Positive growth — blended target price:", targetPrice);
  } else {
    targetPrice = stock.currentPrice * (1 + growthPotential);
    console.log("📉 Negative growth — reduced target price:", targetPrice);
  }

  // 9) Apply Dividend & Risk Boost
  const dividendBoost = 1 + Math.min(stock.dividendYield / 100, 0.03);
  targetPrice *= dividendBoost * riskFactor.targetBoost;
  console.log("💰 Dividend Boost:", dividendBoost);
  console.log("🚀 Risk-Adjusted Target Boost:", riskFactor.targetBoost);
  console.log("✅ Final Target Price:", parseFloat(targetPrice.toFixed(2)));

  return {
    stopLoss: parseFloat(stopLoss.toFixed(2)),
    targetPrice: parseFloat(targetPrice.toFixed(2)),
    riskTolerance,
  };
}

/***********************************************
 * 3) COMPUTE SCORE (Optional Improvements)
 ***********************************************/
function computeScore(stock, sector) {
  const weights = {
    valuation: 0.35,
    marketStability: 0.25,
    dividendBenefit: 0.2,
    historicalPerformance: 0.2,
  };

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

  // 1) Valuation Score
  let valuationScore = 1;
  if (stock.peRatio < 15) valuationScore *= 1.1;
  else if (stock.peRatio >= 15 && stock.peRatio <= 25) valuationScore *= 1;
  else valuationScore *= 0.8;

  if (stock.pbRatio < 1) valuationScore *= 1.2;
  else if (stock.pbRatio >= 1 && stock.pbRatio <= 3) valuationScore *= 1;
  else valuationScore *= 0.8;

  valuationScore *= sectorMultiplier.valuation;
  valuationScore = Math.min(Math.max(valuationScore, 0.5), 1.2);

  // 2) Market Stability (volatility)
  const volatility = calculateHistoricalVolatility(stock.historicalData);
  const maxVol = 0.03;
  const stabilityRaw = 1 - Math.min(volatility / maxVol, 1);
  const stabilityScore = 0.5 + 0.5 * stabilityRaw;
  const adjustedStabilityScore = stabilityScore * sectorMultiplier.stability;

  // 3) Dividend Benefit
  const dividendBenefit = Math.min(stock.dividendYield / 100, 0.05);
  const adjustedDividendBenefit = dividendBenefit * sectorMultiplier.dividend;

  // 4) Historical Performance
  const range = stock.fiftyTwoWeekHigh - stock.fiftyTwoWeekLow;
  const positionInRange =
    range > 0 ? (stock.currentPrice - stock.fiftyTwoWeekLow) / range : 0;
  const historicalPerformance = Math.min(Math.max(positionInRange, 0), 1);

  // Weighted Sum
  const rawScore =
    valuationScore * weights.valuation +
    adjustedStabilityScore * weights.marketStability +
    adjustedDividendBenefit * weights.dividendBenefit +
    historicalPerformance * weights.historicalPerformance;

  const finalScore = Math.min(Math.max(rawScore, 0), 1);

  return finalScore;
}

/***********************************************
 * 4) FETCH SINGLE STOCK DATA
 ***********************************************/
async function fetchSingleStockData(tickerObj) {
  try {
    const response = await fetch(
      "https://stock-analysis-thegoodmanagers-japan-aymerics-projects-60f33831.vercel.app/api/stocks",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: tickerObj }),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();
    console.log("data :", data);
    return data;
  } catch (error) {
    console.error("Fetch Error:", error.message);
    return { success: false, error: error.message };
  }
}

/***********************************************
 * 5) FETCH HISTORICAL DATA
 ***********************************************/
async function fetchHistoricalData(ticker) {
  try {
    const apiUrl = `https://stock-analysis-thegoodmanagers-japan-aymerics-projects-60f33831.vercel.app/api/history?ticker=${ticker}`;
    console.log(`Fetching historical data from: ${apiUrl}`);

    const response = await fetch(apiUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    console.log(`Response: ${response}`);
    const result = await response.json();
    console.log(`Response body:`, result);

    if (!response.ok || !result.success) {
      throw new Error(result.error || `HTTP error! Status: ${response.status}`);
    }

    if (!result.data || result.data.length === 0) {
      console.warn(`No historical data available for ${ticker}.`);
      return [];
    }

    console.log(`Historical data for ${ticker} fetched successfully.`);
    return result.data.map((item) => ({
      ...item,
      date: new Date(item.date),
      // e.g. { close, high, low, volume } expected
    }));
  } catch (error) {
    console.error(`Error fetching historical data for ${ticker}:`, error);
    return [];
  }
}

/***********************************************
 * 6) SCAN LOGIC (Main Workflow)
 ***********************************************/
window.scan = {
  async fetchStockAnalysis() {
    try {
      const tickers = [
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

      for (const tickerObj of tickers) {
        console.log(`\n--- Fetching data for ${tickerObj.code} ---`);

        try {
          // 1) Fetch Yahoo data
          const result = await fetchSingleStockData(tickerObj);
          if (!result.success) {
            console.error("Error fetching stock analysis:", result.error);
            throw new Error("Failed to fetch Yahoo data.");
          }

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

          // 2) Build stock object
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

          // 3) Fetch historical data for ATR/volatility
          const historicalData = await fetchHistoricalData(stock.ticker);
          stock.historicalData = historicalData || [];

          // 4) Analyze with ML for next 30 days
          console.log(`Analyzing stock: ${stock.ticker}`);
          const predictions = await analyzeStock(stock.ticker);
          if (!predictions || predictions.length <= 29) {
            console.error(
              `Insufficient predictions for ${stock.ticker}. Aborting.`
            );
            throw new Error("Failed to generate sufficient predictions.");
          }

          // 5) Use the 30th day (index 29)
          const prediction = predictions[29];
          stock.predictions = predictions;

          // 6) Calculate Stop Loss & Target
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

          // 7) Compute growth potential
          const growthPotential =
            ((stock.targetPrice - stock.currentPrice) / stock.currentPrice) *
            100;

          // 8) Compute fundamental/technical score
          stock.score = computeScore(stock, stock.sector);

          // 9) Combine them => finalScore
          const weights = { metrics: 0.7, growth: 0.3 };
          const finalScore =
            weights.metrics * stock.score +
            weights.growth * (growthPotential / 100);

          stock.prediction = prediction;
          stock.growthPotential = parseFloat(growthPotential.toFixed(2));
          stock.finalScore = parseFloat(finalScore.toFixed(2));

          // 10) Send data in Bubble key format
          const stockObject = {
            _api_c2_ticker: stock.ticker,
            _api_c2_sector: stock.sector,
            _api_c2_currentPrice: stock.currentPrice,
            _api_c2_highPrice: stock.highPrice,
            _api_c2_lowPrice: stock.lowPrice,
            _api_c2_openPrice: stock.openPrice,
            _api_c2_prevClosePrice: stock.prevClosePrice,
            _api_c2_marketCap: stock.marketCap,
            _api_c2_peRatio: stock.peRatio,
            _api_c2_pbRatio: stock.pbRatio,
            _api_c2_dividendYield: stock.dividendYield,
            _api_c2_fiftyTwoWeekHigh: stock.fiftyTwoWeekHigh,
            _api_c2_fiftyTwoWeekLow: stock.fiftyTwoWeekLow,
            _api_c2_eps: stock.eps,
            _api_c2_prediction: stock.prediction,
            _api_c2_stopLoss: stock.stopLoss,
            _api_c2_targetPrice: stock.targetPrice,
            _api_c2_score: stock.score,
            _api_c2_growthPotential: stock.growthPotential,
            _api_c2_finalScore: stock.finalScore,
          };

          console.log(`📤 Sending ${stock.ticker} to Bubble:`, stockObject);
          bubble_fn_result(stockObject);
        } catch (error) {
          console.error(
            `❌ Error processing ticker ${tickerObj.code}:`,
            error.message
          );
        }
      }
    } catch (error) {
      console.error("❌ Error in fetchStockAnalysis:", error.message);
      throw new Error("Analysis aborted due to errors.");
    }
  },
};

/***********************************************
 * 7) SCAN CURRENT PRICE (Unchanged)
 ***********************************************/
window.scanCurrentPrice = {
  async fetchCurrentPrices(tickers) {
    try {
      const outputlist1 = [];
      const outputlist2 = [];

      for (const ticker of tickers) {
        console.log(`\n--- Fetching current price for ${ticker} ---`);
        try {
          const result = await fetchSingleStockData({ code: ticker });
          if (!result.success) {
            console.error("Error fetching stock data:", result.error);
            throw new Error("Failed to fetch Yahoo data.");
          }

          const { code, yahooData } = result.data;
          if (!yahooData || !yahooData.currentPrice) {
            console.error(
              `Incomplete Yahoo data for ${code}. Skipping this ticker.`
            );
            continue;
          }

          outputlist1.push(code);
          outputlist2.push(yahooData.currentPrice);

          console.log(
            `Ticker ${code}: Current Price fetched: ${yahooData.currentPrice}`
          );
        } catch (error) {
          console.error(`Error processing ticker ${ticker}:`, error.message);
        }
      }

      bubble_fn_currentPrice({
        outputlist1,
        outputlist2,
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

/***********************************************
 * 8) TRAIN & PREDICT (With DAILY Clamping)
 ***********************************************/

// If you want daily clamping, swap out predictNext30DaysWithVolume with the code below.

const customHeaders = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, Gecko) Chrome/91.0.4472.124 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
};

const limiter = new Bottleneck({ minTime: 200, maxConcurrent: 5 });

function prepareDataWithVolume(data, sequenceLength = 30) {
  const inputs = [];
  const outputs = [];

  for (let i = 0; i < data.length - sequenceLength; i++) {
    const inputSequence = data.slice(i, i + sequenceLength).map((item) => ({
      price: item.price,
      volume: item.volume,
    }));
    const output = data[i + sequenceLength].price;
    inputs.push(inputSequence);
    outputs.push(output);
  }

  const prices = data.map((item) => item.price);
  const volumes = data.map((item) => item.volume);
  const minMaxData = {
    minPrice: Math.min(...prices),
    maxPrice: Math.max(...prices),
    minVolume: Math.min(...volumes),
    maxVolume: Math.max(...volumes),
  };

  const normalize = (value, min, max) => (value - min) / (max - min);

  const normalizedInputs = inputs.map((seq) =>
    seq.map(({ price, volume }) => [
      normalize(price, minMaxData.minPrice, minMaxData.maxPrice),
      normalize(volume, minMaxData.minVolume, minMaxData.maxVolume),
    ])
  );
  const normalizedOutputs = outputs.map((price) =>
    normalize(price, minMaxData.minPrice, minMaxData.maxPrice)
  );

  const inputTensor = tf.tensor3d(normalizedInputs, [
    normalizedInputs.length,
    sequenceLength,
    2,
  ]);
  const outputTensor = tf.tensor2d(normalizedOutputs, [
    normalizedOutputs.length,
    1,
  ]);

  return { inputTensor, outputTensor, minMaxData };
}

async function trainModelWithVolume(data) {
  const sequenceLength = 30;
  const { inputTensor, outputTensor, minMaxData } = prepareDataWithVolume(
    data,
    sequenceLength
  );

  const model = tf.sequential();
  model.add(
    tf.layers.lstm({
      units: 64,
      inputShape: [sequenceLength, 2],
      returnSequences: false,
    })
  );
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.dense({ units: 1 }));
  model.compile({ optimizer: tf.train.adam(), loss: "meanSquaredError" });

  console.log(`Training model...`);
  await model.fit(inputTensor, outputTensor, {
    epochs: 50,
    batchSize: 32,
    validationSplit: 0.2,
  });
  console.log(`Model training completed.`);

  return { model, minMaxData };
}

/**
 * PREDICT THE NEXT 30 DAYS (DAILY CLAMP)
 * ---------------------------------------
 * This approach clamps daily changes to ±6% from the previous day's price.
 * Adjust the percentage to your preference.
 */
async function predictNext30DaysWithVolume(modelObj, latestData) {
  const { model, minMaxData } = modelObj;
  const { minPrice, maxPrice, minVolume, maxVolume } = minMaxData;

  const normalize = (value, min, max) => (value - min) / (max - min);
  const denormalize = (value, min, max) => value * (max - min) + min;

  // We'll start from the last real close in 'latestData'
  const lastRealClose = latestData[latestData.length - 1].close;

  // Prepare the initial input
  let currentInput = latestData.map((item) => [
    normalize(item.price, minPrice, maxPrice),
    normalize(item.volume, minVolume, maxVolume),
  ]);

  const predictions = [];
  let prevDayPrice = lastRealClose; // used for daily clamp

  for (let day = 0; day < 30; day++) {
    const inputTensor = tf.tensor3d([currentInput], [1, 30, 2]);
    const [predictedNormPrice] = model.predict(inputTensor).dataSync();
    let predictedPrice = denormalize(predictedNormPrice, minPrice, maxPrice);

    // DAILY CLAMP EXAMPLE: ±6% from previous day
    const maxUpside = prevDayPrice * 1.06;
    const maxDownside = prevDayPrice * 0.94;
    if (predictedPrice > maxUpside) {
      predictedPrice = maxUpside;
    } else if (predictedPrice < maxDownside) {
      predictedPrice = maxDownside;
    }

    predictions.push(predictedPrice);

    // Slide the window for next day
    currentInput = [
      ...currentInput.slice(1),
      [
        normalize(predictedPrice, minPrice, maxPrice),
        currentInput[currentInput.length - 1][1],
      ],
    ];
    prevDayPrice = predictedPrice; // update for tomorrow's clamp
  }

  console.log(
    `Predicted prices (daily-clamped) for the next 30 days:`,
    predictions
  );
  return predictions;
}

export async function analyzeStock(ticker) {
  try {
    const historicalData = await fetchHistoricalData(ticker);

    if (historicalData.length < 30) {
      throw new Error(`Not enough data to train the model for ${ticker}.`);
    }

    const modelObj = await trainModelWithVolume(historicalData);

    // Use the last 30 real days as input
    const latestData = historicalData.slice(-30);

    // Predict 30 days with daily clamp
    const predictions = await predictNext30DaysWithVolume(modelObj, latestData);

    console.log(`Predicted prices for ${ticker}:`, predictions);
    return predictions;
  } catch (error) {
    console.error(`Error analyzing stock for ${ticker}:`, error.message);
    return [];
  }
}
