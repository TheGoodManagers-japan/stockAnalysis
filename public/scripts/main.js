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


function computeScore(stock, sector) {
  // Input validation
  if (!stock || typeof stock !== 'object') {
    console.error('Invalid stock data provided');
    return 0;
  }

  if (!sector || typeof sector !== 'string') {
    console.warn('Invalid sector provided, using default multipliers');
    sector = '';
  }

  // Configuration constants
  const CONFIG = {
    // Component weights
    WEIGHTS: {
      valuation: 0.25,
      marketStability: 0.2,
      dividendBenefit: 0.15,
      historicalPerformance: 0.15,
      momentum: 0.15,
      volatilityRisk: 0.1,
    },
    // Thresholds for scoring calculations
    THRESHOLDS: {
      maxPE: 25,          // PE ratio above which score becomes 0
      maxPB: 3,           // PB ratio above which score becomes 0
      volatilityBase: 0.1, // Base volatility for normalization
      maxDividendYield: 6, // Max dividend yield for scoring
      dividendGrowthCap: 10, // Cap for dividend growth rate
      highATR: 0.04,      // High ATR threshold
      mediumATR: 0.02,    // Medium ATR threshold
    }
  };

  // Sector-specific multipliers for different scoring components
  const SECTOR_MULTIPLIERS = {
    // Default values
    DEFAULT: { valuation: 1.0, stability: 1.0, dividend: 1.0, growth: 1.0 },
    
    // Financial sectors - often trade at lower valuations, dividends important
    "Banking": { valuation: 1.2, stability: 0.9, dividend: 1.3, growth: 0.9 },
    "Other Financial Services": { valuation: 1.2, stability: 0.8, dividend: 1.1, growth: 1.1 },
    "Securities": { valuation: 1.3, stability: 0.7, dividend: 1.0, growth: 1.2 },
    "Insurance": { valuation: 1.3, stability: 0.9, dividend: 1.2, growth: 0.9 },
    
    // Technology and healthcare - growth focused, valuations often higher
    "Pharmaceuticals": { valuation: 0.9, stability: 0.9, dividend: 0.9, growth: 1.2 },
    "Precision Instruments": { valuation: 0.9, stability: 0.8, dividend: 0.8, growth: 1.2 },
    "Communications": { valuation: 0.9, stability: 1.0, dividend: 0.9, growth: 1.1 },
    "Electric Machinery": { valuation: 0.9, stability: 0.9, dividend: 0.9, growth: 1.1 },
    
    // Consumer staples - stability focused
    "Foods": { valuation: 1.1, stability: 1.2, dividend: 1.1, growth: 0.9 },
    "Retail": { valuation: 1.0, stability: 1.0, dividend: 1.0, growth: 1.0 },
    "Fishery": { valuation: 1.0, stability: 1.1, dividend: 1.0, growth: 0.9 },
    
    // Services and consumer discretionary
    "Services": { valuation: 1.0, stability: 0.9, dividend: 0.9, growth: 1.1 },
    "Automobiles & Auto parts": { valuation: 1.1, stability: 0.8, dividend: 1.0, growth: 1.0 },
    
    // Manufacturing sectors
    "Steel": { valuation: 1.2, stability: 0.8, dividend: 1.1, growth: 0.9 },
    "Nonferrous Metals": { valuation: 1.2, stability: 0.8, dividend: 1.1, growth: 0.9 },
    "Chemicals": { valuation: 1.1, stability: 0.9, dividend: 1.0, growth: 1.0 },
    "Petroleum": { valuation: 1.2, stability: 0.8, dividend: 1.3, growth: 0.8 },
    "Rubber": { valuation: 1.1, stability: 0.9, dividend: 1.0, growth: 0.9 },
    "Glass & Ceramics": { valuation: 1.1, stability: 0.9, dividend: 1.0, growth: 0.9 },
    "Machinery": { valuation: 1.1, stability: 0.9, dividend: 1.0, growth: 1.0 },
    "Shipbuilding": { valuation: 1.1, stability: 0.8, dividend: 1.0, growth: 0.9 },
    "Other Manufacturing": { valuation: 1.1, stability: 0.9, dividend: 1.0, growth: 1.0 },
    
    // Utilities - income focused
    "Electric Power": { valuation: 1.2, stability: 1.2, dividend: 1.3, growth: 0.7 },
    "Gas": { valuation: 1.2, stability: 1.2, dividend: 1.3, growth: 0.7 },
    
    // Transport
    "Railway & Bus": { valuation: 1.1, stability: 1.1, dividend: 1.1, growth: 0.9 },
    "Land Transport": { valuation: 1.1, stability: 1.0, dividend: 1.0, growth: 0.9 },
    "Marine Transport": { valuation: 1.1, stability: 0.8, dividend: 1.0, growth: 0.9 },
    "Air Transport": { valuation: 1.0, stability: 0.7, dividend: 0.9, growth: 1.0 },
    "Warehousing": { valuation: 1.1, stability: 1.0, dividend: 1.1, growth: 0.9 },
    
    // Real estate and construction
    "Real Estate": { valuation: 1.2, stability: 0.9, dividend: 1.2, growth: 0.9 },
    "Construction": { valuation: 1.1, stability: 0.8, dividend: 1.0, growth: 0.9 },
    
    // Others
    "Trading Companies": { valuation: 1.1, stability: 0.9, dividend: 1.1, growth: 1.0 },
    "Mining": { valuation: 1.2, stability: 0.7, dividend: 1.2, growth: 0.8 },
    "Textiles & Apparel": { valuation: 1.1, stability: 0.9, dividend: 1.0, growth: 0.9 },
    "Pulp & Paper": { valuation: 1.1, stability: 0.9, dividend: 1.1, growth: 0.8 }
  };

  // Get sector multipliers or use defaults if sector not found
  const sectorMultiplier = SECTOR_MULTIPLIERS[sector] || SECTOR_MULTIPLIERS.DEFAULT;

  // Helper functions for score calculations
  const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max);
  
  const getValueWithDefault = (value, defaultValue = 0.5) => {
    return value !== undefined && !isNaN(value) ? value : defaultValue;
  };

  /**
   * Calculate valuation score based on PE and PB ratios
   */
  function calculateValuationScore() {
    const peRatio = getValueWithDefault(stock.peRatio);
    const pbRatio = getValueWithDefault(stock.pbRatio);
    
    const peScore = peRatio > 0 
      ? clamp((CONFIG.THRESHOLDS.maxPE - peRatio) / CONFIG.THRESHOLDS.maxPE) 
      : 0.5;
      
    const pbScore = pbRatio > 0 
      ? clamp((CONFIG.THRESHOLDS.maxPB - pbRatio) / CONFIG.THRESHOLDS.maxPB) 
      : 0.5;
    
    return ((peScore + pbScore) / 2) * sectorMultiplier.valuation;
  }

  /**
   * Calculate stability score based on historical volatility
   */
  function calculateStabilityScore() {
    const volatility = calculateHistoricalVolatility(stock.historicalData);
    const normalizedVol = clamp(volatility / CONFIG.THRESHOLDS.volatilityBase, 0, 1);
    return (1 - normalizedVol) * sectorMultiplier.stability;
  }

  /**
   * Calculate dividend benefit score based on yield and growth
   */
  function calculateDividendScore() {
    const dividendYield = getValueWithDefault(stock.dividendYield, 0);
    const dividendGrowth = getValueWithDefault(stock.dividendGrowth5yr);
    
    const yieldScore = clamp(dividendYield / CONFIG.THRESHOLDS.maxDividendYield);
    const growthScore = clamp(dividendGrowth / CONFIG.THRESHOLDS.dividendGrowthCap);
    
    return (yieldScore * 0.7 + growthScore * 0.3) * sectorMultiplier.dividend;
  }

  /**
   * Calculate historical performance score based on 52-week range position
   */
  function calculateHistoricalPerformanceScore() {
    const high = getValueWithDefault(stock.fiftyTwoWeekHigh);
    const low = getValueWithDefault(stock.fiftyTwoWeekLow);
    const current = getValueWithDefault(stock.currentPrice);
    
    const range = high - low;
    const position = range > 0 ? (current - low) / range : 0.5;
    
    // Apply the growth multiplier to historical performance
    return position * sectorMultiplier.growth;
  }

  /**
   * Calculate momentum score based on technical indicators
   */
  function calculateMomentumScore() {
    let score = 0;
    let divisor = 0;
    
    // RSI component
    if (stock.rsi14 !== undefined) {
      score += clamp((stock.rsi14 - 30) / 40) * 0.5;
      divisor += 0.5;
    }
    
    // MACD component
    if (stock.macd !== undefined && stock.macdSignal !== undefined) {
      score += (stock.macd > stock.macdSignal ? 0.3 : 0) * 0.3;
      divisor += 0.3;
    }
    
    // Stochastic component
    if (stock.stochasticK !== undefined) {
      score += clamp(stock.stochasticK / 100) * 0.2;
      divisor += 0.2;
    }
    
    return divisor > 0 ? clamp(score / divisor) : 0.5;
  }

  /**
   * Calculate volatility risk score based on ATR and Bollinger Bands
   */
  function calculateVolatilityRiskScore() {
    let score = 1;
    
    // ATR component
    if (stock.atr14 !== undefined && stock.currentPrice > 0) {
      const atrRatio = stock.atr14 / stock.currentPrice;
      if (atrRatio > CONFIG.THRESHOLDS.highATR) {
        score -= 0.3;
      } else if (atrRatio > CONFIG.THRESHOLDS.mediumATR) {
        score -= 0.15;
      }
    }
    
    // Bollinger Band component
    if (stock.bollingerUpper !== undefined && stock.bollingerLower !== undefined && 
        stock.currentPrice !== undefined) {
      if (stock.currentPrice > stock.bollingerUpper || 
          stock.currentPrice < stock.bollingerLower) {
        score -= 0.1;
      }
    }
    
    return clamp(score, 0.5);
  }

  /**
   * Calculate historical volatility from price data
   */
  function calculateHistoricalVolatility(historicalData) {
    if (!historicalData || !Array.isArray(historicalData) || historicalData.length < 2) {
      return 0.15; // Default volatility if no data available
    }
    
    try {
      const prices = historicalData.map(d => d.close || d.price || 0);
      const returns = [];
      
      for (let i = 1; i < prices.length; i++) {
        if (prices[i-1] > 0) {
          returns.push((prices[i] - prices[i-1]) / prices[i-1]);
        }
      }
      
      if (returns.length === 0) return 0.15;
      
      const meanReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
      const squaredDifferences = returns.map(ret => Math.pow(ret - meanReturn, 2));
      const variance = squaredDifferences.reduce((sum, diff) => sum + diff, 0) / returns.length;
      
      return Math.sqrt(variance) * Math.sqrt(252); // Annualized volatility
    } catch (e) {
      console.error('Error calculating volatility:', e);
      return 0.15;
    }
  }

  // Calculate individual component scores
  const valuationScore = calculateValuationScore();
  const stabilityScore = calculateStabilityScore();
  const dividendScore = calculateDividendScore();
  const historicalPerformanceScore = calculateHistoricalPerformanceScore();
  const momentumScore = calculateMomentumScore();
  const volatilityRiskScore = calculateVolatilityRiskScore();

  // Calculate final weighted score
  const rawScore =
    valuationScore * CONFIG.WEIGHTS.valuation +
    stabilityScore * CONFIG.WEIGHTS.marketStability +
    dividendScore * CONFIG.WEIGHTS.dividendBenefit +
    historicalPerformanceScore * CONFIG.WEIGHTS.historicalPerformance +
    momentumScore * CONFIG.WEIGHTS.momentum +
    volatilityRiskScore * CONFIG.WEIGHTS.volatilityRisk;

  // Return final clamped score
  return clamp(rawScore);
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

/**
 *  getTechnicalScoreV2(stock [, customWeights])
 *  ------------------------------------------------
 *  • Returns { score: Number, bullish: Number, bearish: Number, tags: String[] }
 *  • `score` is logistic-normalised to ­-50 … +50   (0 ⇒ neutral)
 *  • Pass a `customWeights` object if you want to tweak the defaults on the fly:
 *      { trend: 3, momentum: 2.5, volatility: 1.3, special: 1.7 }
 */
/**
 * getTechnicalScore(stock [, customWeights])
 * ------------------------------------------
 * • Numeric output only   →   –50 … +50  (0 = neutral)
 * • Sector-agnostic, momentum/trend/volatility blend with safety guards
 * • Pass an optional { trend, momentum, volatility, special } override
 */
function getTechnicalScore(stock, customWeights = {}) {
  const n = v => (Number.isFinite(v) ? v : 0);           // safe number
  /* ---------- pull metrics ---------- */
  const {
    currentPrice           = 0,
    movingAverage50d       = 0,
    movingAverage200d      = 0,
    rsi14                  = 50,
    macd                   = 0,
    macdSignal             = 0,
    bollingerMid           = currentPrice,
    bollingerUpper         = currentPrice * 1.1,
    bollingerLower         = currentPrice * 0.9,
    stochasticK            = 50,
    stochasticD            = 50,
    atr14                  = currentPrice * 0.02,
    obv                    = 0,
    obvMA20                = 0          // supply if available
  } = stock;

  /* ---------- weights ---------- */
  const W = {
    trend      : 2.5,
    momentum   : 2.0,
    volatility : 1.5,
    special    : 1.5,
    ...customWeights
  };

  /* ---------- helpers ---------- */
  const pctDiff = (a, b) => Math.abs(a - b) / (Math.abs(b) || 1e-6);

  /* ---------- scoring ---------- */
  let bull = 0, bear = 0;

  /* --- TREND ---------------------------------------------------------- */
  const gc  = movingAverage50d > movingAverage200d &&
              pctDiff(movingAverage50d, movingAverage200d) < 0.05;
  const dc  = movingAverage50d < movingAverage200d &&
              pctDiff(movingAverage50d, movingAverage200d) < 0.05;
  const sbt = movingAverage50d > movingAverage200d * 1.05;
  const sbr = movingAverage50d < movingAverage200d * 0.95;
  const mbt = movingAverage50d > movingAverage200d && !gc && !sbt;
  const mbr = movingAverage50d < movingAverage200d && !dc && !sbr;

  if (sbt) bull += W.trend * 1.3;        else if (mbt) bull += W.trend;
  if (gc)  bull += W.special * 2;
  if (sbr) bear += W.trend * 1.3;        else if (mbr) bear += W.trend;
  if (dc)  bear += W.special * 2;

  /* --- MOMENTUM ------------------------------------------------------- */
  const macdBase = Math.max(Math.abs(macd), 1e-4);
  const macdCross= Math.abs(macd - macdSignal) < macdBase * 0.1;
  const macdDiv  = Math.abs(macd - macdSignal) > macdBase * 0.25;

  if (macd > macdSignal) {
    bull += W.momentum * 0.8;
    if (macdDiv) bull += W.momentum * 0.4;
  } else {
    bear += W.momentum * 0.8;
    if (macdDiv) bear += W.momentum * 0.4;
  }
  if (macdCross && macd > 0) bull += W.special * 0.8;
  if (macdCross && macd < 0) bear += W.special * 0.8;

  if (rsi14 >= 70)            bear += W.special;
  else if (rsi14 <= 30)       bull += W.special;
  else if (rsi14 >= 55)       bull += W.momentum * 0.7;
  else if (rsi14 <= 45)       bear += W.momentum * 0.7;

  if (stochasticK > stochasticD) {
    bull += W.momentum * 0.6;
    if (stochasticK <= 20) bull += W.special * 0.8;
  } else {
    bear += W.momentum * 0.6;
    if (stochasticK >= 80) bear += W.special * 0.8;
  }

  if (obvMA20) {
    if (obv > obvMA20)  bull += W.momentum * 0.5;
    else if (obv < obvMA20) bear += W.momentum * 0.5;
  }

  /* --- PRICE ACTION / VOLATILITY ------------------------------------- */
  const mid = Math.max(bollingerMid, 1e-6);
  const bandW = (bollingerUpper - bollingerLower) / mid;
  const upperBreak = currentPrice > bollingerUpper;
  const lowerBreak = currentPrice < bollingerLower;

  if (upperBreak)       bull += W.volatility * 0.9;
  else if (currentPrice > bollingerMid) bull += W.volatility * 0.6;

  if (lowerBreak)       bear += W.volatility * 0.9;
  else if (currentPrice < bollingerMid) bear += W.volatility * 0.6;

  if (bandW < 0.05 && mbt) bull += W.special * 0.7;
  if (bandW < 0.05 && mbr) bear += W.special * 0.7;

  if (bandW > 0.08 && sbt) bull += W.volatility * 0.4;
  if (bandW > 0.08 && sbr) bear += W.volatility * 0.4;

  /* --- ATR scaling ---------------------------------------------------- */
  if (atr14 >= currentPrice * 0.04) { bull *= 1.1; bear *= 1.2; }
  else if (atr14 >= currentPrice * 0.03) { bull *= 1.05; bear *= 1.1; }
  else if (atr14 <= currentPrice * 0.01) { bull *= 0.9; bear *= 0.9; }
  else if (atr14 <= currentPrice * 0.015){ bull *= 0.95; bear *= 0.95; }

  /* ---------- –50 … +50 logistic score ---------- */
  const raw      = bull - bear;
  const logistic = 1 / (1 + Math.exp(-raw));     // 0 … 1
  const score    = Math.round((logistic - 0.5) * 1000) / 10;

  return score;                                  // only the score
}




/**
 * Advanced fundamental score  (0 = very weak, 10 = very strong)
 * — sector-aware weights (high-growth vs dividend vs normal)
 * — uses P/E, P/B, P/S, EPS growth, fwd/ttm EPS, D/E, yield & div-growth
 * — clamps & guards against NaN / divide-by-zero
 */
function getAdvancedFundamentalScore(stock) {
  const n = v => (Number.isFinite(v) ? v : 0);           // safe number

  /* ---------- canonical sector buckets ---------- */
  const HIGH_GROWTH_SECTORS = new Set([
    "Technology","Communications","Pharmaceuticals",
    "Electric Machinery","Precision Instruments","Machinery",
    "Automobiles & Auto parts"
  ]);
  const DIVIDEND_FOCUS_SECTORS = new Set([
    "Utilities","Electric Power","Gas","Banking","Insurance","Real Estate"
  ]);
  const FINANCIAL_SECTORS = new Set([
    "Banking","Insurance","Other Financial Services","Securities"
  ]);

  const sector        = stock.sector || "";
  const isHGrowth     = HIGH_GROWTH_SECTORS.has(sector);
  const isDivFocus    = DIVIDEND_FOCUS_SECTORS.has(sector);
  const isFinancial   = FINANCIAL_SECTORS.has(sector);
  /* ---------- pull metrics ---------- */
  const pe   = n(stock.peRatio);
  const pb   = n(stock.pbRatio);
  const ps   = n(stock.priceToSales);
  const d2e  = Math.max(n(stock.debtEquityRatio), 0);
  const dy   = n(stock.dividendYield);          // %
  const dg5  = n(stock.dividendGrowth5yr);      // %
  const epsG = n(stock.epsGrowthRate);          // %
  const epsF = n(stock.epsForward);
  const epsT = n(stock.epsTrailingTwelveMonths);
  /* ---------- pillar scores ---------- */
  let g = 0, v = 0, h = 0, d = 0;

  /* --- GROWTH ------------------------------------------------------------ */
  if (epsG >= 20) g += 3;         else if (epsG >= 10) g += 2;
  else if (epsG >=  5) g += 1;    else if (epsG <  0)  g -= 2;

  const epsRatio = epsT ? epsF / epsT : 1;
  if      (epsRatio >= 1.20) g += 2;
  else if (epsRatio >= 1.05) g += 1;
  else if (epsRatio <= 0.95) g -= 1;

  g = Math.max(0, Math.min(10, g * 2));        // 0-10

  /* --- VALUE ------------------------------------------------------------- */
  /* P/E */
  if (pe > 0 && pe < 10)      v += 3;
  else if (pe < 15)           v += 2;
  else if (pe < 20)           v += 1;
  else if (pe > 30 || pe <= 0) v -= 1;

  /* P/B */
  if (pb > 0 && pb < 1)       v += 3;
  else if (pb < 2)            v += 2;
  else if (pb < 3)            v += 1;
  else if (pb > 5)            v -= 1;

  /* P/S (skip most financials) */
  if (!isFinancial) {
    if (ps > 0 && ps < 2)     v += 1.5;
    else if (ps > 6)          v -= 1;
  }

  /* growth-sector premium tolerance */
  if (isHGrowth && pe > 0 && pe < 25) v += 1;

  v = Math.max(0, Math.min(10, v * 1.5));

  /* --- FINANCIAL HEALTH -------------------------------------------------- */
  if      (d2e < 0.25) h += 3;
  else if (d2e < 0.5)  h += 2;
  else if (d2e < 1.0)  h += 1;
  else if (d2e > 2.0)  h -= 2;
  else if (d2e > 1.5)  h -= 1;

  if (isFinancial && d2e < 1.5) h += 1;        // capital-intensive leeway

  h = Math.max(0, Math.min(10, (h + 2) * 2));

  /* --- DIVIDEND ---------------------------------------------------------- */
  if (dy > 0) {
    if      (dy >= 6) d += 3;
    else if (dy >= 4) d += 2;
    else if (dy >= 2) d += 1;

    if      (dg5 >= 10) d += 2;
    else if (dg5 >=  5) d += 1;
    else if (dg5 <   0) d -= 1;

    d = Math.max(0, Math.min(10, d * 2));
  }

  /* ---------- sector-adjusted weights ---------- */
  const w = {
    growth : isHGrowth   ? 0.45 : isDivFocus ? 0.20 : 0.35,
    value  : isHGrowth   ? 0.20 :                0.30,
    health :                0.25,
    dividend : isDivFocus ? 0.25 : 0.10
  };

  /* ---------- composite 0-10 ---------- */
  const score =
    g * w.growth +
    v * w.value +
    h * w.health +
    d * w.dividend;

  return Math.round(score * 10) / 10;          // one-decimal 0-10
}







/**
 *  getValuationScore(stock [, weightOverrides])
 *  -------------------------------------------
 *  • Returns ONE number in the 0‒10 range
 *  • Sector-aware bands for P/E, P/B, P/S  + PEG, Yield, Size
 *  • Optional weightOverrides = { pe, pb, ps, peg, yield, size }
 */
function getValuationScore(stock, weightOverrides = {}) {
  const n = v => (Number.isFinite(v) ? v : 0);        // NaN-safe

  /* 1 ─ Sector buckets ────────────────────────────────────────────── */
  const HG = new Set([
    "Technology","Communications","Pharmaceuticals",
    "Electric Machinery","Precision Instruments","Machinery",
    "Automobiles & Auto parts"
  ]);
  const VAL = new Set(["Banking","Insurance","Utilities","Real Estate"]);

  const sector = stock.sector || "";
  const isHG   = HG.has(sector);
  const isVAL  = VAL.has(sector);

  /* 2 ─ Extract metrics ───────────────────────────────────────────── */
  const pe   = n(stock.peRatio);
  const pb   = n(stock.pbRatio);
  const ps   = n(stock.priceToSales);
  const mc   = n(stock.marketCap);             // local currency
  const gEPS = n(stock.epsGrowthRate);         // %
  const dy   = n(stock.dividendYield);         // %

  /* 3 ─ Helper: linear score low-better metric ---------------------- */
  const scaleLowBetter = (val, good, ok, bad) => {
    if (val <= good) return  2;                        // very cheap
    if (val <= ok)   return  1;                        // cheap
    if (val <= bad)  return -1;                        // expensive
    return -2;                                         // very expensive
  };

  /* 4 ─ P/E, P/B, P/S ---------------------------------------------- */
  const peS = pe <= 0
    ? -2
    : scaleLowBetter(
        pe,
        isHG ? 25 : isVAL ? 8  : 10,
        isHG ? 40 : isVAL ? 15 : 18,
        isHG ? 60 : isVAL ? 20 : 30
      );

  const pbS = pb <= 0
    ? -1
    : scaleLowBetter(
        pb,
        isHG ? 2  : isVAL ? 0.8 : 1,
        isHG ? 4  : isVAL ? 1.5 : 2.5,
        isHG ? 6  : isVAL ? 2.5 : 4
      );

  const psS = ps <= 0
    ? 0
    : scaleLowBetter(
        ps,
        isHG ? 3 : 1,
        isHG ? 8 : 2,
        isHG ? 12 : 5
      );

  /* 5 ─ PEG ratio (only if positive growth) ------------------------- */
  let pegS = 0;
  if (pe > 0 && gEPS > 0) {
    const peg = pe / gEPS;            // crude, gEPS is % so PEG≈PE/Δ%
    if (peg < 1)      pegS =  1.5;
    else if (peg < 2) pegS =  0.5;
    else if (peg > 3) pegS = -1;
  }

  /* 6 ─ Dividend yield bonus --------------------------------------- */
  const yieldS = dy >= 4 ? 0.6 : dy >= 2 ? 0.3 : 0;

  /* 7 ─ Size premium / discount ------------------------------------ */
  const sizeS =
    mc >= 1e12 ?  0.5 :
    mc >= 1e11 ?  0.3 :
    mc >= 1e10 ?  0.0 :
    mc >= 2e9  ? -0.2 :
                 -0.5;

  /* 8 ─ Combine with weights --------------------------------------- */
  const W = {
    pe   : 1.6,
    pb   : 1.2,
    ps   : 1.0,
    peg  : 1.1,
    yield: 0.6,
    size : 0.5,
    ...weightOverrides          // caller tweaks on the fly
  };

  const raw =
      peS   * W.pe   +
      pbS   * W.pb   +
      psS   * W.ps   +
      pegS  * W.peg  +
      yieldS* W.yield+
      sizeS * W.size;

  /* 9 ─ Map raw (-8 … +8) → 0 … 10 --------------------------------- */
  const score = Math.max(0, Math.min(10, (raw + 8) * (10 / 16)));

  return Math.round(score * 10) / 10;          // 1-dp numeric
}




/**
 *  getNumericTier(stock [, weights])
 *  ---------------------------------
 *  • stock must contain technicalScore, fundamentalScore, valuationScore
 *  • returns an integer Tier 1 … 6  (1 = best)
 *  • weights default to { tech:0.4, fund:0.35, val:0.25 }  – override if needed
 */
function getNumericTier(stock, weights = {}) {
  const w = { tech: 0.40, fund: 0.35, val: 0.25, ...weights };

  /* ----------- safe pulls ------------- */
  const tRaw = Number.isFinite(stock.technicalScore)   ? stock.technicalScore   : 0;
  const fRaw = Number.isFinite(stock.fundamentalScore) ? stock.fundamentalScore : 0;
  const vRaw = Number.isFinite(stock.valuationScore)   ? stock.valuationScore   : 0;

  /* ----------- normalise to 0–10 ------ */
  const tech = Math.max(0, Math.min(10, (tRaw + 50) * 0.1));   // –50…+50 → 0…10

  const fund = fRaw > 10 || fRaw < 0           // detect –50…+50 style input
               ? Math.max(0, Math.min(10, (fRaw + 50) * 0.1))
               : Math.max(0, Math.min(10, fRaw));               // already 0…10

  const val  = Math.max(0, Math.min(10, vRaw));                 // clamp

  /* ----------- base composite --------- */
  let score = tech * w.tech + fund * w.fund + val * w.val;      // 0…10

  /* ----------- contextual tweaks ------ */
  if (fund >= 7.5 && val <= 2)  score -= 0.4;   // Over-valued quality
  if (val  >= 7   && fund <= 3) score -= 0.4;   // Value trap
  if (tech >= 7   && fund >= 7) score += 0.4;   // Everything aligned
  if (tech <= 2   && fund >= 7) score -= 0.4;   // Great co. but chart ugly

  /* ----------- assign tier ------------ */
  if (score >= 8 ) return 1;   // Dream
  if (score >= 6.5) return 2;  // Elite
  if (score >= 5 ) return 3;   // Solid
  if (score >= 3.5) return 4;  // Speculative
  if (score >= 2 ) return 5;   // Risky
  return 6;                    // Red Flag
}



function getEntryTimingScore(stock, opts = {}) {
  const n = (v) => (Number.isFinite(v) ? v : 0); // NaN-safe

  /* ──────────── Extract Price Data ──────────── */
  const prices = {
    current: n(stock.currentPrice),
    open: n(stock.openPrice),
    high: n(stock.highPrice),
    low: n(stock.lowPrice),
    prev: n(stock.prevClosePrice),
    hi52: n(stock.fiftyTwoWeekHigh),
    lo52: n(stock.fiftyTwoWeekLow),
    ma50: n(stock.movingAverage50d),
    ma200: n(stock.movingAverage200d),
    atr: n(stock.atr14),
  };

  /* ──────────── Calculate Derived Metrics ──────────── */
  const metrics = {
    dailyRangePct: prices.current
      ? ((prices.high - prices.low) / prices.current) * 100
      : 0,
    pctFromHi52: prices.hi52
      ? ((prices.hi52 - prices.current) / prices.hi52) * 100
      : 0,
    pctFromLo52: prices.lo52
      ? ((prices.current - prices.lo52) / prices.lo52) * 100
      : 0,
    pctFromMA50: prices.ma50
      ? ((prices.current - prices.ma50) / prices.ma50) * 100
      : 0,
    gapPct: prices.prev ? ((prices.open - prices.prev) / prices.prev) * 100 : 0,
  };

  /* ──────────── Pattern Recognition ──────────── */
  const patterns = {
    strongClose:
      prices.current > prices.open &&
      prices.current > prices.prev &&
      prices.current - Math.min(prices.open, prices.prev) >
        (prices.high - prices.current) * 2,

    weakClose:
      prices.current < prices.open &&
      prices.current < prices.prev &&
      Math.max(prices.open, prices.prev) - prices.current >
        (prices.current - prices.low) * 2,

    bullishRev:
      prices.current > prices.open &&
      prices.open < prices.prev &&
      prices.current > prices.prev,
    bearishRev:
      prices.current < prices.open &&
      prices.open > prices.prev &&
      prices.current < prices.prev,
    doji:
      Math.abs(prices.current - prices.open) < (prices.high - prices.low) * 0.1,
    gapUp: metrics.gapPct >= 2,
    gapDown: metrics.gapPct <= -2,
    insideDay: prices.high <= prices.prev && prices.low >= prices.prev,

    bullTrap:
      prices.current <= prices.open &&
      prices.high - prices.open >= Math.abs(prices.open * 0.01) &&
      (prices.high - prices.current) / (prices.high - prices.low || 1e-6) >=
        0.7,
  };

  /* ──────────── Weights Configuration ──────────── */
  const weights = {
    close: 2.0,
    hiLo: 1.2,
    ma: 1.0,
    gap: 1.0,
    pattern: 1.0,
    vol: 0.7,
    penalty: 2.0,
    ...opts.weights,
  };

  /* ──────────── Score Calculation ──────────── */
  let score = 0;

  // Close strength
  if (patterns.strongClose) score += weights.close;
  else if (patterns.weakClose) score -= weights.close;

  // Reversal patterns
  if (patterns.bullishRev) score += 0.7 * weights.pattern;
  if (patterns.bearishRev) score -= 0.7 * weights.pattern;

  // 52-week positioning
  if (prices.current >= prices.hi52) score += weights.hiLo;
  else if (metrics.pctFromHi52 <= 1) score += 0.8 * weights.hiLo;
  else if (prices.current <= prices.lo52) score -= weights.hiLo;
  else if (metrics.pctFromLo52 <= 1) score -= 0.8 * weights.hiLo;

  // Moving average confluence
  if (prices.ma50 && prices.ma200) {
    const above50 = prices.current > prices.ma50;
    const above200 = prices.current > prices.ma200;
    if (above50 && above200) score += weights.ma;
    else if (!above50 && !above200) score -= weights.ma;
    else if (Math.abs(metrics.pctFromMA50) <= 1) score += 0.3 * weights.ma;
  }

  // Gap behavior
  if (patterns.gapUp && prices.current > prices.open)
    score += 0.7 * weights.gap;
  if (patterns.gapDown && prices.current < prices.open)
    score -= 0.7 * weights.gap;

  // Inside day patterns
  if (patterns.insideDay && prices.current > prices.prev)
    score += 0.5 * weights.pattern;
  if (patterns.insideDay && prices.current < prices.prev)
    score -= 0.5 * weights.pattern;

  // Doji context
  if (patterns.doji) {
    if (prices.current > prices.ma50 && prices.current > prices.ma200)
      score += 0.3 * weights.pattern;
    else if (prices.current < prices.ma50 && prices.current < prices.ma200)
      score -= 0.3 * weights.pattern;
  }

  // Volatility context
  const hiVol = prices.atr > 0 && prices.atr > prices.current * 0.04;
  const loVol = prices.atr > 0 && prices.atr < prices.current * 0.015;
  if (hiVol && patterns.strongClose) score += 0.3 * weights.vol;
  if (hiVol && patterns.weakClose) score -= 0.3 * weights.vol;
  if (loVol && patterns.insideDay) score += 0.3 * weights.vol;

  // Penalties
  if (patterns.bullTrap) score -= weights.penalty;
  if (patterns.weakClose && patterns.gapUp) score -= 0.7 * weights.penalty;

  /* ──────────── Tier Mapping ──────────── */
  const cutoffs = {
    t1: 4,
    t2: 2,
    t3: 0.5,
    t4: -0.5,
    t5: -2,
    t6: -4,
    ...opts.cutoffs,
  };

  if (score >= cutoffs.t1) return 1; // Strong Buy
  if (score >= cutoffs.t2) return 2; // Buy
  if (score >= cutoffs.t3) return 3; // Watch
  if (score >= cutoffs.t4) return 4; // Neutral
  if (score >= cutoffs.t5) return 5; // Caution
  if (score >= cutoffs.t6) return 6; // Avoid
  return 7; // Strong Avoid
}

function getEnhancedEntryTimingScore(stock, opts = {}) {
  // Get single-day score as baseline
  const singleDayScore = getEntryTimingScore(stock, opts);

  // Validate historical data
  const historicalData = stock.historicalData || [];
  if (!historicalData.length) {
    console.warn(
      `No historical data available for ${stock.ticker}, using basic entry timing only.`
    );
    return singleDayScore;
  }

  const recentData = historicalData
    .slice(-15)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (recentData.length < 5) {
    console.warn(
      `Insufficient historical data for ${stock.ticker}, using basic entry timing only.`
    );
    return singleDayScore;
  }

  const n = (v) => (Number.isFinite(v) ? v : 0);
  const currentPrice = n(stock.currentPrice);

  /* ──────────── Extract Historical Arrays ──────────── */
  const historical = {
    closes: recentData.map((day) => day.close),
    volumes: recentData.map((day) => day.volume),
    highs: recentData.map((day) => day.high),
    lows: recentData.map((day) => day.low),
  };

  /* ──────────── Calculate Momentum & Trends ──────────── */
  const momentum = calculateMomentumMetrics(historical, recentData);

  /* ──────────── Pattern Detection ──────────── */
  const bullishPatterns = detectBullishPatterns(
    recentData,
    historical,
    stock,
    currentPrice
  );
  const bearishPatterns = detectBearishPatterns(recentData, historical);
  const exhaustionPatterns = detectExhaustionPatterns(
    recentData,
    historical,
    stock,
    momentum.recent
  );

  /* ──────────── Calculate Historical Score ──────────── */
  const weights = getPatternWeights(opts);
  let histScore = 0;

  // Apply momentum scoring
  histScore += scoreMomentum(momentum, weights);

  // Apply pattern scoring
  histScore += scoreBullishPatterns(bullishPatterns, weights);
  histScore += scoreBearishPatterns(bearishPatterns, weights);

  // Apply exhaustion penalties
  histScore += scoreExhaustionPatterns(
    exhaustionPatterns,
    weights,
    momentum.recent
  );

  /* ──────────── Combine Scores ──────────── */
  const combinedWeights = {
    current: 0.2,
    history: 0.8,
    ...opts.combinedWeights,
  };
  const normalizedSingleDayScore = 4 - (singleDayScore - 1);
  const combinedRawScore =
    normalizedSingleDayScore * combinedWeights.current +
    histScore * combinedWeights.history;

  /* ──────────── Final Tier Mapping ──────────── */
  const cutoffs = {
    t1: 2.5,
    t2: 1.5,
    t3: 0.5,
    t4: -0.5,
    t5: -1.5,
    t6: -2.5,
    ...opts.combinedCutoffs,
  };

  if (combinedRawScore >= cutoffs.t1) return 1; // Strong Buy
  if (combinedRawScore >= cutoffs.t2) return 2; // Buy
  if (combinedRawScore >= cutoffs.t3) return 3; // Watch
  if (combinedRawScore >= cutoffs.t4) return 4; // Neutral
  if (combinedRawScore >= cutoffs.t5) return 5; // Caution
  if (combinedRawScore >= cutoffs.t6) return 6; // Avoid
  return 7; // Strong Avoid
}

/* ──────────── Helper Functions ──────────── */

function calculateMomentumMetrics(historical, recentData) {
  let recentMomentum = 0,
    volumeTrend = 0;

  if (recentData.length >= 15) {
    const last5Avg =
      historical.closes.slice(-5).reduce((sum, price) => sum + price, 0) / 5;
    const prev10Avg =
      historical.closes.slice(-15, -5).reduce((sum, price) => sum + price, 0) /
      10;
    recentMomentum = ((last5Avg - prev10Avg) / prev10Avg) * 100;
  }

  if (recentData.length >= 10) {
    const last5VolAvg =
      historical.volumes.slice(-5).reduce((sum, vol) => sum + vol, 0) / 5;
    const prev5VolAvg =
      historical.volumes.slice(-10, -5).reduce((sum, vol) => sum + vol, 0) / 5;
    volumeTrend = ((last5VolAvg - prev5VolAvg) / prev5VolAvg) * 100;
  }

  return { recent: recentMomentum, volume: volumeTrend };
}

function detectBullishPatterns(recentData, historical, stock, currentPrice) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const patterns = {};

  // Higher lows pattern
  if (recentData.length >= 7) {
    const last7Lows = recentData.slice(-7).map((day) => day.low);
    const higherLowsCount = last7Lows
      .slice(1)
      .reduce((count, low, i) => (low > last7Lows[i] ? count + 1 : count), 0);
    patterns.higherLows = higherLowsCount >= 5;
  }

  // Price compression
  if (recentData.length >= 7) {
    const ranges = recentData.slice(-7).map((day) => day.high - day.low);
    const rangeAvg = ranges.reduce((sum, range) => sum + range, 0) / 7;
    const last3RangeAvg =
      ranges.slice(-3).reduce((sum, range) => sum + range, 0) / 3;
    patterns.priceCompression = last3RangeAvg < rangeAvg * 0.7;
  }

  // Engulfing pattern
  if (recentData.length >= 2) {
    const yesterday = recentData[recentData.length - 2];
    const today = recentData[recentData.length - 1];
    patterns.bullishEngulfing =
      yesterday.close < yesterday.open &&
      today.close > today.open &&
      today.open < yesterday.close &&
      today.close > yesterday.open;
  }

  // Support test
  if (recentData.length >= 10) {
    const lowestDay = recentData
      .slice(-10)
      .reduce(
        (lowest, day) => (day.low < lowest.low ? day : lowest),
        recentData[recentData.length - 10]
      );
    const today = recentData[recentData.length - 1];
    patterns.supportTest =
      today.low <= lowestDay.low * 1.01 &&
      today.close > today.open &&
      today.close > lowestDay.low * 1.02;
  }

  // MA pullback
  if (n(stock.movingAverage20d) > 0) {
    const ma20 = n(stock.movingAverage20d);
    const ma50 = n(stock.movingAverage50d);
    const low = Math.min(...recentData.slice(-3).map((day) => day.low));
    patterns.pullbackToMA =
      (low <= ma20 * 1.01 && currentPrice > ma20) ||
      (low <= ma50 * 1.01 && currentPrice > ma50);
  }

  // Breakout from consolidation
  patterns.breakoutFromConsolidation = detectBreakoutPattern(
    recentData,
    patterns.priceCompression
  );

  // Cup and handle
  patterns.cupAndHandle = detectCupAndHandle(recentData);

  return patterns;
}

function detectBearishPatterns(recentData, historical) {
  const patterns = {};

  // Lower highs pattern
  if (recentData.length >= 7) {
    const last7Highs = recentData.slice(-7).map((day) => day.high);
    const lowerHighsCount = last7Highs
      .slice(1)
      .reduce(
        (count, high, i) => (high < last7Highs[i] ? count + 1 : count),
        0
      );
    patterns.lowerHighs = lowerHighsCount >= 5;
  }

  // Bearish engulfing
  if (recentData.length >= 2) {
    const yesterday = recentData[recentData.length - 2];
    const today = recentData[recentData.length - 1];
    patterns.bearishEngulfing =
      yesterday.close > yesterday.open &&
      today.close < today.open &&
      today.open > yesterday.close &&
      today.close < yesterday.open;
  }

  // Doji after trend
  if (recentData.length >= 5) {
    const lastDay = recentData[recentData.length - 1];
    const dojiRange =
      Math.abs(lastDay.close - lastDay.open) <
      (lastDay.high - lastDay.low) * 0.1;
    const last4Closes = historical.closes.slice(-5, -1);
    const hadTrend =
      (last4Closes[3] > last4Closes[0] && last4Closes[3] > last4Closes[1]) ||
      (last4Closes[3] < last4Closes[0] && last4Closes[3] < last4Closes[1]);
    patterns.dojiAfterTrend = dojiRange && hadTrend;
  }

  return patterns;
}

function detectExhaustionPatterns(
  recentData,
  historical,
  stock,
  recentMomentum
) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const patterns = {};

  // Trend maturity
  if (recentData.length >= 15) {
    const upDaysCount = recentData.slice(-14).reduce((count, day, i) => {
      const prevDay =
        i === 0
          ? recentData[recentData.length - 15]
          : recentData[recentData.length - 14 + i - 1];
      return day.close > prevDay.close ? count + 1 : count;
    }, 0);
    patterns.trendTooMature = upDaysCount >= 10;
  }

  // Climax pattern
  if (recentData.length >= 10) {
    const avgVolume =
      historical.volumes.slice(-10, -5).reduce((sum, vol) => sum + vol, 0) / 5;
    patterns.climaxPattern = recentData.slice(-5).some((day) => {
      const highVolume = day.volume > avgVolume * 1.8;
      const smallGain =
        day.close > day.open &&
        day.close - day.open < (day.high - day.low) * 0.3;
      const nearHigh = day.close > day.high - (day.high - day.low) * 0.2;
      return highVolume && smallGain && nearHigh;
    });
  }

  // Bearish divergence
  if (stock.rsi14 && recentData.length >= 10) {
    const currentRSI = n(stock.rsi14);
    const recentHigh = Math.max(...recentData.slice(-5).map((day) => day.high));
    const priorHigh = Math.max(
      ...recentData.slice(-10, -5).map((day) => day.high)
    );
    patterns.bearishDivergence =
      recentHigh > priorHigh && currentRSI < 65 && recentMomentum < 3;
  }

  // Exhaustion gap
  patterns.exhaustionGap = recentData.slice(-3).some((day, i, arr) => {
    if (i === 0) return false;
    const gapUp = day.open > arr[i - 1].close * 1.02;
    const weakness = day.close < day.open;
    return gapUp && weakness;
  });

  // Volume climax
  if (recentData.length >= 15) {
    const avgVolume =
      historical.volumes.reduce((sum, vol) => sum + vol, 0) /
      historical.volumes.length;
    const last3Volume =
      historical.volumes.slice(-3).reduce((sum, vol) => sum + vol, 0) / 3;
    patterns.volumeClimax = last3Volume > avgVolume * 2.2;
  }

  // Overbought momentum divergence
  if (stock.rsi14) {
    const currentRSI = n(stock.rsi14);
    patterns.overboughtMomentumDiv = currentRSI > 70 && recentMomentum < 2.5;
  }

  // At resistance
  if (stock.fiftyTwoWeekHigh && stock.currentPrice) {
    patterns.atResistance =
      n(stock.currentPrice) >= n(stock.fiftyTwoWeekHigh) * 0.98;
  }

  return patterns;
}

function detectBreakoutPattern(recentData, priceCompression) {
  if (recentData.length < 15) return false;

  const last10Ranges = recentData
    .slice(-12, -2)
    .map((day, i, arr) =>
      i === 0
        ? day.high - day.low
        : Math.max(
            day.high - day.low,
            Math.abs(day.high - arr[i - 1].close),
            Math.abs(day.low - arr[i - 1].close)
          )
    );
  const atrLast10 = last10Ranges.reduce((sum, range) => sum + range, 0) / 10;

  const latestDay = recentData[recentData.length - 1];
  const rangeExpansion = latestDay.high - latestDay.low > atrLast10 * 1.5;
  const directionalStrength =
    Math.abs(latestDay.close - latestDay.open) >
    (latestDay.high - latestDay.low) * 0.6;

  return priceCompression && rangeExpansion && directionalStrength;
}

function detectCupAndHandle(recentData) {
  if (recentData.length < 15) return false;

  const cupLeft = recentData.slice(-15, -10);
  const cupBottom = recentData.slice(-10, -5);
  const cupRight = recentData.slice(-5);

  const maxLeftHigh = Math.max(...cupLeft.map((day) => day.high));
  const minBottomLow = Math.min(...cupBottom.map((day) => day.low));
  const maxRightHigh = Math.max(...cupRight.map((day) => day.high));

  const similarHighs =
    Math.abs(maxLeftHigh - maxRightHigh) < maxLeftHigh * 0.03;
  const properBottom =
    minBottomLow < Math.min(maxLeftHigh, maxRightHigh) * 0.95;
  const recentPullback =
    cupRight[3].close < cupRight[2].close &&
    cupRight[4].close > cupRight[3].close;

  return similarHighs && properBottom && recentPullback;
}

function getPatternWeights(opts) {
  return {
    momentum: 1.5,
    volume: 1.0,
    higherLows: 1.2,
    lowerHighs: 1.2,
    compression: 0.8,
    engulfing: 1.5,
    doji: 0.7,
    support: 1.3,
    gapFill: 0.9,
    pullbackMA: 1.4,
    breakout: 1.6,
    cupHandle: 1.7,
    trendMaturity: 1.5,
    climax: 1.8,
    bearishDiv: 1.4,
    exhaustionGap: 1.2,
    volumeClimax: 1.0,
    overboughtDiv: 1.3,
    resistance: 0.8,
    ...opts.histWeights,
  };
}

function scoreMomentum(momentum, weights) {
  let score = 0;
  if (momentum.recent > 3) score += weights.momentum;
  else if (momentum.recent > 1) score += 0.5 * weights.momentum;
  else if (momentum.recent < -3) score -= weights.momentum;
  else if (momentum.recent < -1) score -= 0.5 * weights.momentum;

  if (momentum.volume > 20 && momentum.recent > 0)
    score += 0.8 * weights.volume;
  else if (momentum.volume > 20 && momentum.recent < 0)
    score -= 0.5 * weights.volume;

  return score;
}

function scoreBullishPatterns(patterns, weights) {
  let score = 0;
  if (patterns.higherLows) score += weights.higherLows;
  if (patterns.priceCompression)
    score += (patterns.priceCompression ? 0.6 : 0.2) * weights.compression;
  if (patterns.bullishEngulfing) score += weights.engulfing;
  if (patterns.supportTest) score += weights.support;
  if (patterns.pullbackToMA) score += weights.pullbackMA;
  if (patterns.breakoutFromConsolidation) score += weights.breakout;
  if (patterns.cupAndHandle) score += weights.cupHandle;
  return score;
}

function scoreBearishPatterns(patterns, weights) {
  let score = 0;
  if (patterns.lowerHighs) score -= weights.lowerHighs;
  if (patterns.bearishEngulfing) score -= weights.engulfing;
  if (patterns.dojiAfterTrend) score -= 0.4 * weights.doji;
  return score;
}

function scoreExhaustionPatterns(patterns, weights, recentMomentum) {
  let score = 0;
  if (patterns.trendTooMature) score -= weights.trendMaturity;
  if (patterns.climaxPattern) score -= 1.2 * weights.climax;
  if (patterns.bearishDivergence) score -= weights.bearishDiv;
  if (patterns.exhaustionGap) score -= 0.8 * weights.exhaustionGap;
  if (patterns.volumeClimax && recentMomentum > 0)
    score -= 0.7 * weights.volumeClimax;
  if (patterns.overboughtMomentumDiv) score -= weights.overboughtDiv;
  if (patterns.atResistance) score -= 0.5 * weights.resistance;

  // Multiple exhaustion signals penalty
  const exhaustionCount = Object.values(patterns).filter(Boolean).length;
  if (exhaustionCount >= 3) score -= 1.5;

  return score;
}


function calculateKeyLevels(stock) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const historicalData = stock.historicalData || [];

  const levels = {
    supports: [],
    resistances: [],
    pivotPoint: null,
    recentSwingHigh: null,
    recentSwingLow: null,
  };

  // Calculate pivot point from today's data
  if (stock.highPrice && stock.lowPrice && stock.currentPrice) {
    levels.pivotPoint =
      (n(stock.highPrice) + n(stock.lowPrice) + n(stock.currentPrice)) / 3;
  }

  // Find recent swing highs and lows from historical data
  if (historicalData.length >= 10) {
    const recentData = historicalData.slice(-20);

    // Find swing highs (higher than 2 days before and after)
    for (let i = 2; i < recentData.length - 2; i++) {
      const current = recentData[i];
      const isSwingHigh =
        current.high > recentData[i - 1].high &&
        current.high > recentData[i - 2].high &&
        current.high > recentData[i + 1].high &&
        current.high > recentData[i + 2].high;

      if (isSwingHigh) {
        levels.resistances.push(current.high);
        if (!levels.recentSwingHigh || current.high > levels.recentSwingHigh) {
          levels.recentSwingHigh = current.high;
        }
      }

      const isSwingLow =
        current.low < recentData[i - 1].low &&
        current.low < recentData[i - 2].low &&
        current.low < recentData[i + 1].low &&
        current.low < recentData[i + 2].low;

      if (isSwingLow) {
        levels.supports.push(current.low);
        if (!levels.recentSwingLow || current.low < levels.recentSwingLow) {
          levels.recentSwingLow = current.low;
        }
      }
    }
  }

  // Add moving averages as potential support/resistance
  if (stock.movingAverage20d) levels.supports.push(n(stock.movingAverage20d));
  if (stock.movingAverage50d) levels.supports.push(n(stock.movingAverage50d));
  if (stock.movingAverage200d) levels.supports.push(n(stock.movingAverage200d));

  // Sort levels
  levels.supports.sort((a, b) => b - a); // Descending order
  levels.resistances.sort((a, b) => a - b); // Ascending order

  return levels;
}

function calculateSmartStopLoss(stock, levels, atr, entryScore, opts = {}) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const currentPrice = n(stock.currentPrice);
  const lowPrice = n(stock.lowPrice);

  // Base stop loss multipliers based on entry score
  const stopMultipliers = {
    1: 1.5, // Strong Buy - tighter stop
    2: 1.8, // Buy
    3: 2.0, // Watch
    4: 2.2, // Neutral
    5: 2.5, // Caution
    6: 2.8, // Avoid
    7: 3.0, // Strong Avoid - wider stop
  };

  const baseMultiplier = stopMultipliers[entryScore] || 2.0;
  const atrMultiplier = opts.stopLossATRMultiplier || baseMultiplier;

  // Method 1: ATR-based stop
  const atrStop = currentPrice - atr * atrMultiplier;

  // Method 2: Support-based stop
  let supportStop = null;
  const nearestSupport = levels.supports.find(
    (s) => s < currentPrice && s > currentPrice * 0.95
  );
  if (nearestSupport) {
    supportStop = nearestSupport - atr * 0.5; // Small buffer below support
  }

  // Method 3: Recent low-based stop
  let recentLowStop = null;
  if (levels.recentSwingLow && levels.recentSwingLow < currentPrice) {
    recentLowStop = levels.recentSwingLow - atr * 0.3;
  }

  // Choose the most appropriate stop loss
  const candidates = [atrStop, supportStop, recentLowStop].filter(
    (s) => s !== null && s > 0
  );

  if (candidates.length === 0) {
    return currentPrice * 0.95; // Default 5% stop
  }

  // For bullish setups (scores 1-3), prefer tighter stops
  // For bearish setups (scores 5-7), prefer wider stops
  if (entryScore <= 3) {
    // Use the highest (tightest) stop for bullish setups
    return Math.max(...candidates);
  } else {
    // Use a balanced approach for neutral/bearish setups
    return candidates.reduce((a, b) => a + b) / candidates.length;
  }
}

function calculateSmartPriceTarget(
  stock,
  levels,
  atr,
  entryScore,
  stopLoss,
  opts = {}
) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const currentPrice = n(stock.currentPrice);
  const highPrice = n(stock.highPrice);

  // Minimum risk/reward ratios based on entry score
  const minRRRatios = {
    1: 2.5, // Strong Buy - higher targets
    2: 2.0, // Buy
    3: 1.8, // Watch
    4: 1.5, // Neutral
    5: 1.2, // Caution
    6: 1.0, // Avoid
    7: 0.8, // Strong Avoid - conservative targets
  };

  const minRR = opts.minRiskReward || minRRRatios[entryScore] || 1.5;
  const risk = currentPrice - (stopLoss || currentPrice * 0.95);
  const minTarget = currentPrice + risk * minRR;

  // Method 1: ATR-based target
  const targetMultipliers = {
    1: 3.0, // Strong Buy
    2: 2.5, // Buy
    3: 2.0, // Watch
    4: 1.5, // Neutral
    5: 1.2, // Caution
    6: 1.0, // Avoid
    7: 0.8, // Strong Avoid
  };

  const atrMultiplier =
    opts.targetATRMultiplier || targetMultipliers[entryScore] || 2.0;
  const atrTarget = currentPrice + atr * atrMultiplier;

  // Method 2: Resistance-based target
  let resistanceTarget = null;
  const nearestResistance = levels.resistances.find(
    (r) => r > currentPrice * 1.02
  );
  if (nearestResistance) {
    resistanceTarget = nearestResistance - atr * 0.2; // Small buffer below resistance
  }

  // Method 3: Fibonacci extension
  if (levels.recentSwingLow && levels.recentSwingHigh) {
    const swingRange = levels.recentSwingHigh - levels.recentSwingLow;
    const fib1618 = currentPrice + swingRange * 0.618;
    const fib1000 = currentPrice + swingRange;

    // Choose fibonacci level based on entry score
    resistanceTarget =
      resistanceTarget || (entryScore <= 2 ? fib1000 : fib1618);
  }

  // Method 4: Percentage-based targets
  const percentTargets = {
    1: currentPrice * 1.08, // 8% for strong buy
    2: currentPrice * 1.06, // 6% for buy
    3: currentPrice * 1.04, // 4% for watch
    4: currentPrice * 1.03, // 3% for neutral
    5: currentPrice * 1.02, // 2% for caution
    6: currentPrice * 1.015, // 1.5% for avoid
    7: currentPrice * 1.01, // 1% for strong avoid
  };
  const percentTarget = percentTargets[entryScore] || currentPrice * 1.03;

  // Method 5: 52-week high target (for bullish setups)
  let yearHighTarget = null;
  if (entryScore <= 3 && stock.fiftyTwoWeekHigh) {
    const hi52 = n(stock.fiftyTwoWeekHigh);
    if (hi52 > currentPrice && hi52 < currentPrice * 1.2) {
      yearHighTarget = hi52;
    }
  }

  // Collect all valid targets
  const candidates = [
    atrTarget,
    resistanceTarget,
    percentTarget,
    yearHighTarget,
    minTarget,
  ].filter((t) => t !== null && t > currentPrice);

  if (candidates.length === 0) {
    return currentPrice * 1.05; // Default 5% target
  }

  // For bullish setups, be more aggressive with targets
  if (entryScore <= 2) {
    // Use the highest reasonable target (but cap at 20% gain)
    const maxReasonable = Math.min(Math.max(...candidates), currentPrice * 1.2);
    return Math.max(maxReasonable, minTarget);
  } else if (entryScore <= 4) {
    // Use average of targets for neutral setups
    const avgTarget = candidates.reduce((a, b) => a + b) / candidates.length;
    return Math.max(avgTarget, minTarget);
  } else {
    // Use conservative target for bearish setups
    return Math.max(Math.min(...candidates), minTarget);
  }
}



function getEnhancedEntryTimingV2(stock, opts = {}) {
  // Get Layer 1 score from existing function
  const layer1Score = getEnhancedEntryTimingScore(stock, opts);

  // Validate historical data for Layer 2 analysis
  const historicalData = stock.historicalData || [];
  if (historicalData.length < 20) {
    // Not enough data for Layer 2, use Layer 1 and calculate targets
    return getTargetsFromScore(stock, layer1Score, opts);
  }

  // Prepare data
  const recentData = historicalData
    .slice(-30)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  /* ──────────── Layer 2: Advanced Pattern Recognition ──────────── */

  // 1. Chart Patterns
  const chartPatterns = detectChartPatterns(recentData);

  // 2. Volume Analysis
  const volumeSignals = analyzeVolumeSignals(recentData);

  // 3. Candlestick Patterns
  const candlePatterns = detectCandlePatterns(recentData);

  // 4. Trend Strength
  const trendStrength = calculateTrendStrength(recentData);

  // 5. Breakout Quality
  const breakoutQuality = evaluateBreakoutQuality(stock, recentData);

  /* ──────────── Layer 2 Scoring ──────────── */

  let layer2Score = 0;

  // Score Chart Patterns
  if (chartPatterns.doubleBottom) layer2Score += 1.5;
  if (chartPatterns.inverseHeadAndShoulders) layer2Score += 1.8;
  if (chartPatterns.ascendingTriangle) layer2Score += 1.2;
  if (chartPatterns.bullFlag) layer2Score += 1.0;
  if (chartPatterns.doubleTop) layer2Score -= 1.5;
  if (chartPatterns.headAndShoulders) layer2Score -= 1.8;
  if (chartPatterns.descendingTriangle) layer2Score -= 1.2;
  if (chartPatterns.bearFlag) layer2Score -= 1.0;

  // Score Volume Signals
  if (volumeSignals.bullishVolumeSpike) layer2Score += 1.2;
  if (volumeSignals.accumulation) layer2Score += 0.8;
  if (volumeSignals.bullishOBVDivergence) layer2Score += 1.0;
  if (volumeSignals.positiveCMF) layer2Score += 0.6;
  if (volumeSignals.distribution) layer2Score -= 0.8;
  if (volumeSignals.bearishOBVDivergence) layer2Score -= 1.0;
  if (volumeSignals.negativeCMF) layer2Score -= 0.6;

  // Score Candlestick Patterns
  if (candlePatterns.hammer) layer2Score += 0.8;
  if (candlePatterns.morningStar) layer2Score += 1.2;
  if (candlePatterns.bullishMarubozu) layer2Score += 0.6;
  if (candlePatterns.shootingStar) layer2Score -= 0.8;
  if (candlePatterns.eveningStar) layer2Score -= 1.2;
  if (candlePatterns.bearishMarubozu) layer2Score -= 0.6;

  // Score Trend Strength
  if (trendStrength.strongUptrend) layer2Score += 1.0;
  else if (trendStrength.weakUptrend) layer2Score += 0.4;
  else if (trendStrength.strongDowntrend) layer2Score -= 1.0;
  else if (trendStrength.weakDowntrend) layer2Score -= 0.4;

  // Score Breakout Quality
  if (breakoutQuality.confirmed) layer2Score += 1.5;
  else if (breakoutQuality.falseBreakout) layer2Score -= 1.5;

  /* ──────────── Combine Scores ──────────── */

  // Convert Layer 1 score (1-7) to normalized scale
  const normalizedLayer1 = 4 - (layer1Score - 1);

  // Combine with configurable weights
  const weights = {
    layer1: 0.6,
    layer2: 0.4,
    ...opts.layerWeights,
  };

  const combinedScore =
    normalizedLayer1 * weights.layer1 + layer2Score * weights.layer2;

  // Map back to 1-7 scale
  const finalScore = mapToFinalScore(combinedScore);

  // Calculate stop loss and price target with the enhanced score
  return getTargetsFromScore(stock, finalScore, opts);
}

/* ──────────── Helper function to calculate targets ──────────── */

function getTargetsFromScore(stock, score, opts = {}) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const currentPrice = n(stock.currentPrice);
  const atr = n(stock.atr14) || currentPrice * 0.02;

  // Validate we have minimum data
  if (!currentPrice || currentPrice <= 0) {
    return {
      score: score,
      stopLoss: null,
      priceTarget: null,
    };
  }

  // Calculate support and resistance levels
  const levels = calculateKeyLevels(stock);

  // Calculate smart stop loss
  const stopLoss = calculateSmartStopLoss(stock, levels, atr, score, opts);

  // Calculate smart price target
  const priceTarget = calculateSmartPriceTarget(
    stock,
    levels,
    atr,
    score,
    stopLoss,
    opts
  );

  return {
    score: score,
    stopLoss: stopLoss ? Math.round(stopLoss * 100) / 100 : null,
    priceTarget: priceTarget ? Math.round(priceTarget * 100) / 100 : null,
  };
}

/* ──────────── Chart Pattern Detection ──────────── */

function detectChartPatterns(recentData) {
  const patterns = {
    doubleBottom: false,
    doubleTop: false,
    headAndShoulders: false,
    inverseHeadAndShoulders: false,
    ascendingTriangle: false,
    descendingTriangle: false,
    bullFlag: false,
    bearFlag: false,
  };

  if (recentData.length < 20) return patterns;

  // Double Bottom
  patterns.doubleBottom = detectDoubleBottom(recentData);

  // Double Top
  patterns.doubleTop = detectDoubleTop(recentData);

  // Head and Shoulders
  patterns.headAndShoulders = detectHeadAndShoulders(recentData);
  patterns.inverseHeadAndShoulders = detectInverseHeadAndShoulders(recentData);

  // Triangles
  patterns.ascendingTriangle = detectAscendingTriangle(recentData);
  patterns.descendingTriangle = detectDescendingTriangle(recentData);

  // Flags
  patterns.bullFlag = detectBullFlag(recentData);
  patterns.bearFlag = detectBearFlag(recentData);

  return patterns;
}

function detectDoubleBottom(data) {
  if (data.length < 15) return false;

  // Find two lows with similar prices
  const lows = [];
  for (let i = 2; i < data.length - 2; i++) {
    if (
      data[i].low < data[i - 1].low &&
      data[i].low < data[i - 2].low &&
      data[i].low < data[i + 1].low &&
      data[i].low < data[i + 2].low
    ) {
      lows.push({ index: i, price: data[i].low });
    }
  }

  if (lows.length < 2) return false;

  // Check if two lows are similar (within 3%)
  const lastTwo = lows.slice(-2);
  const priceDiff =
    Math.abs(lastTwo[0].price - lastTwo[1].price) / lastTwo[0].price;

  // Check for neckline break
  if (priceDiff < 0.03) {
    const neckline = Math.max(
      ...data.slice(lastTwo[0].index, lastTwo[1].index + 1).map((d) => d.high)
    );
    const currentPrice = data[data.length - 1].close;
    return currentPrice > neckline;
  }

  return false;
}

function detectDoubleTop(data) {
  if (data.length < 15) return false;

  const highs = [];
  for (let i = 2; i < data.length - 2; i++) {
    if (
      data[i].high > data[i - 1].high &&
      data[i].high > data[i - 2].high &&
      data[i].high > data[i + 1].high &&
      data[i].high > data[i + 2].high
    ) {
      highs.push({ index: i, price: data[i].high });
    }
  }

  if (highs.length < 2) return false;

  const lastTwo = highs.slice(-2);
  const priceDiff =
    Math.abs(lastTwo[0].price - lastTwo[1].price) / lastTwo[0].price;

  if (priceDiff < 0.03) {
    const neckline = Math.min(
      ...data.slice(lastTwo[0].index, lastTwo[1].index + 1).map((d) => d.low)
    );
    const currentPrice = data[data.length - 1].close;
    return currentPrice < neckline;
  }

  return false;
}

function detectHeadAndShoulders(data) {
  if (data.length < 15) return false;

  // Find three peaks
  const peaks = [];
  for (let i = 2; i < data.length - 2; i++) {
    if (data[i].high > data[i - 1].high && data[i].high > data[i + 1].high) {
      peaks.push({ index: i, price: data[i].high });
    }
  }

  if (peaks.length < 3) return false;

  // Check if middle peak is highest (head)
  const lastThree = peaks.slice(-3);
  const isHead =
    lastThree[1].price > lastThree[0].price &&
    lastThree[1].price > lastThree[2].price;

  // Check if shoulders are similar
  const shoulderDiff =
    Math.abs(lastThree[0].price - lastThree[2].price) / lastThree[0].price;

  return isHead && shoulderDiff < 0.03;
}

function detectInverseHeadAndShoulders(data) {
  if (data.length < 15) return false;

  const troughs = [];
  for (let i = 2; i < data.length - 2; i++) {
    if (data[i].low < data[i - 1].low && data[i].low < data[i + 1].low) {
      troughs.push({ index: i, price: data[i].low });
    }
  }

  if (troughs.length < 3) return false;

  const lastThree = troughs.slice(-3);
  const isInverseHead =
    lastThree[1].price < lastThree[0].price &&
    lastThree[1].price < lastThree[2].price;

  const shoulderDiff =
    Math.abs(lastThree[0].price - lastThree[2].price) / lastThree[0].price;

  return isInverseHead && shoulderDiff < 0.03;
}

function detectAscendingTriangle(data) {
  if (data.length < 10) return false;

  const highs = data.slice(-10).map((d) => d.high);
  const lows = data.slice(-10).map((d) => d.low);

  // Check if highs are relatively flat
  const highsRange = Math.max(...highs) - Math.min(...highs);
  const avgHigh = highs.reduce((a, b) => a + b) / highs.length;
  const highsFlat = highsRange / avgHigh < 0.02;

  // Check if lows are rising
  const lowsRising = lows[lows.length - 1] > lows[0] * 1.02;

  return highsFlat && lowsRising;
}

function detectDescendingTriangle(data) {
  if (data.length < 10) return false;

  const highs = data.slice(-10).map((d) => d.high);
  const lows = data.slice(-10).map((d) => d.low);

  // Check if lows are relatively flat
  const lowsRange = Math.max(...lows) - Math.min(...lows);
  const avgLow = lows.reduce((a, b) => a + b) / lows.length;
  const lowsFlat = lowsRange / avgLow < 0.02;

  // Check if highs are falling
  const highsFalling = highs[highs.length - 1] < highs[0] * 0.98;

  return lowsFlat && highsFalling;
}

function detectBullFlag(data) {
  if (data.length < 10) return false;

  // Check for strong upward move followed by consolidation
  const poleStart = data.length - 10;
  const poleEnd = data.length - 5;

  const poleMove =
    (data[poleEnd].close - data[poleStart].close) / data[poleStart].close;
  const strongPole = poleMove > 0.05; // 5% move

  // Check for tight consolidation in last 5 days
  const flagData = data.slice(-5);
  const flagRange =
    Math.max(...flagData.map((d) => d.high)) -
    Math.min(...flagData.map((d) => d.low));
  const avgPrice = flagData.reduce((sum, d) => sum + d.close, 0) / 5;
  const tightFlag = flagRange / avgPrice < 0.03;

  return strongPole && tightFlag;
}

function detectBearFlag(data) {
  if (data.length < 10) return false;

  const poleStart = data.length - 10;
  const poleEnd = data.length - 5;

  const poleMove =
    (data[poleEnd].close - data[poleStart].close) / data[poleStart].close;
  const strongPole = poleMove < -0.05; // -5% move

  const flagData = data.slice(-5);
  const flagRange =
    Math.max(...flagData.map((d) => d.high)) -
    Math.min(...flagData.map((d) => d.low));
  const avgPrice = flagData.reduce((sum, d) => sum + d.close, 0) / 5;
  const tightFlag = flagRange / avgPrice < 0.03;

  return strongPole && tightFlag;
}

/* ──────────── Volume Analysis ──────────── */

function analyzeVolumeSignals(data) {
  const signals = {
    bullishVolumeSpike: false,
    bearishVolumeSpike: false,
    accumulation: false,
    distribution: false,
    bullishOBVDivergence: false,
    bearishOBVDivergence: false,
    positiveCMF: false,
    negativeCMF: false,
  };

  if (data.length < 20) return signals;

  // Volume spike detection
  const avgVolume =
    data.slice(-20, -1).reduce((sum, d) => sum + d.volume, 0) / 19;
  const latestVolume = data[data.length - 1].volume;
  const volumeSpike = latestVolume > avgVolume * 1.5;

  if (volumeSpike) {
    const priceChange =
      data[data.length - 1].close - data[data.length - 1].open;
    signals.bullishVolumeSpike = priceChange > 0;
    signals.bearishVolumeSpike = priceChange < 0;
  }

  // Accumulation/Distribution
  const adRatio = calculateAccumulationDistribution(data.slice(-10));
  signals.accumulation = adRatio > 0.6;
  signals.distribution = adRatio < 0.4;

  // OBV Divergence
  const obvDivergence = calculateOBVDivergence(data.slice(-20));
  signals.bullishOBVDivergence = obvDivergence > 0;
  signals.bearishOBVDivergence = obvDivergence < 0;

  // Chaikin Money Flow
  const cmf = calculateCMF(data.slice(-20));
  signals.positiveCMF = cmf > 0.1;
  signals.negativeCMF = cmf < -0.1;

  return signals;
}

function calculateAccumulationDistribution(data) {
  let upVolume = 0;
  let downVolume = 0;

  data.forEach((day) => {
    if (day.close > day.open) {
      upVolume += day.volume;
    } else {
      downVolume += day.volume;
    }
  });

  const totalVolume = upVolume + downVolume;
  return totalVolume > 0 ? upVolume / totalVolume : 0.5;
}

function calculateOBVDivergence(data) {
  // Calculate OBV
  const obv = [0];
  for (let i = 1; i < data.length; i++) {
    if (data[i].close > data[i - 1].close) {
      obv.push(obv[i - 1] + data[i].volume);
    } else if (data[i].close < data[i - 1].close) {
      obv.push(obv[i - 1] - data[i].volume);
    } else {
      obv.push(obv[i - 1]);
    }
  }

  // Check for divergence
  const priceTrend =
    (data[data.length - 1].close - data[0].close) / data[0].close;
  const obvTrend = (obv[obv.length - 1] - obv[0]) / Math.abs(obv[0] || 1);

  if (priceTrend < -0.05 && obvTrend > 0) return 1; // Bullish divergence
  if (priceTrend > 0.05 && obvTrend < 0) return -1; // Bearish divergence
  return 0;
}

function calculateCMF(data) {
  let mfVolume = 0;
  let totalVolume = 0;

  data.forEach((day) => {
    const mfMultiplier =
      (day.close - day.low - (day.high - day.close)) /
      (day.high - day.low || 1);
    mfVolume += mfMultiplier * day.volume;
    totalVolume += day.volume;
  });

  return totalVolume > 0 ? mfVolume / totalVolume : 0;
}

/* ──────────── Candlestick Patterns ──────────── */

function detectCandlePatterns(data) {
  const patterns = {
    hammer: false,
    shootingStar: false,
    morningStar: false,
    eveningStar: false,
    bullishMarubozu: false,
    bearishMarubozu: false,
  };

  if (data.length < 3) return patterns;

  const latest = data[data.length - 1];
  const prev = data[data.length - 2];
  const prev2 = data[data.length - 3];

  // Hammer
  patterns.hammer = detectHammer(latest, prev);

  // Shooting Star
  patterns.shootingStar = detectShootingStar(latest, prev);

  // Morning Star
  patterns.morningStar = detectMorningStar(prev2, prev, latest);

  // Evening Star
  patterns.eveningStar = detectEveningStar(prev2, prev, latest);

  // Marubozu
  patterns.bullishMarubozu = detectBullishMarubozu(latest);
  patterns.bearishMarubozu = detectBearishMarubozu(latest);

  return patterns;
}

function detectHammer(candle, prevCandle) {
  const body = Math.abs(candle.close - candle.open);
  const lowerShadow = Math.min(candle.open, candle.close) - candle.low;
  const upperShadow = candle.high - Math.max(candle.open, candle.close);

  return (
    prevCandle.close > prevCandle.open && // Previous was bearish
    body > 0 &&
    lowerShadow > body * 2 &&
    upperShadow < body * 0.3
  );
}

function detectShootingStar(candle, prevCandle) {
  const body = Math.abs(candle.close - candle.open);
  const upperShadow = candle.high - Math.max(candle.open, candle.close);
  const lowerShadow = Math.min(candle.open, candle.close) - candle.low;

  return (
    prevCandle.close < prevCandle.open && // Previous was bullish
    body > 0 &&
    upperShadow > body * 2 &&
    lowerShadow < body * 0.3
  );
}

function detectMorningStar(first, second, third) {
  const firstBearish = first.close < first.open;
  const secondSmall =
    Math.abs(second.close - second.open) <
    Math.abs(first.close - first.open) * 0.3;
  const thirdBullish = third.close > third.open;
  const thirdCloses = third.close > (first.close + first.open) / 2;

  return firstBearish && secondSmall && thirdBullish && thirdCloses;
}

function detectEveningStar(first, second, third) {
  const firstBullish = first.close > first.open;
  const secondSmall =
    Math.abs(second.close - second.open) <
    Math.abs(first.close - first.open) * 0.3;
  const thirdBearish = third.close < third.open;
  const thirdCloses = third.close < (first.close + first.open) / 2;

  return firstBullish && secondSmall && thirdBearish && thirdCloses;
}

function detectBullishMarubozu(candle) {
  const body = Math.abs(candle.close - candle.open);
  const totalRange = candle.high - candle.low;

  return candle.close > candle.open && body > totalRange * 0.95;
}

function detectBearishMarubozu(candle) {
  const body = Math.abs(candle.close - candle.open);
  const totalRange = candle.high - candle.low;

  return candle.close < candle.open && body > totalRange * 0.95;
}

/* ──────────── Trend Strength (ADX-like) ──────────── */

function calculateTrendStrength(data) {
  const strength = {
    strongUptrend: false,
    weakUptrend: false,
    strongDowntrend: false,
    weakDowntrend: false,
    choppy: false,
  };

  if (data.length < 14) return strength;

  // Simple trend strength calculation
  const closes = data.map((d) => d.close);
  const sma14 = closes.slice(-14).reduce((a, b) => a + b) / 14;
  const currentPrice = closes[closes.length - 1];

  // Calculate directional movement
  let upMoves = 0;
  let downMoves = 0;

  for (let i = data.length - 14; i < data.length; i++) {
    if (data[i].close > data[i - 1].close) upMoves++;
    if (data[i].close < data[i - 1].close) downMoves++;
  }

  const trendRatio = Math.max(upMoves, downMoves) / 14;
  const pricePosition = (currentPrice - sma14) / sma14;

  if (trendRatio > 0.7 && pricePosition > 0.02) {
    strength.strongUptrend = true;
  } else if (trendRatio > 0.5 && pricePosition > 0) {
    strength.weakUptrend = true;
  } else if (trendRatio > 0.7 && pricePosition < -0.02) {
    strength.strongDowntrend = true;
  } else if (trendRatio > 0.5 && pricePosition < 0) {
    strength.weakDowntrend = true;
  } else {
    strength.choppy = true;
  }

  return strength;
}

/* ──────────── Breakout Quality ──────────── */

function evaluateBreakoutQuality(stock, data) {
  const quality = {
    confirmed: false,
    falseBreakout: false,
    pending: false,
  };

  if (data.length < 5) return quality;

  const n = (v) => (Number.isFinite(v) ? v : 0);
  const currentPrice = n(stock.currentPrice);
  const recentHigh = Math.max(...data.slice(-20).map((d) => d.high));
  const recentLow = Math.min(...data.slice(-20).map((d) => d.low));

  // Check if we're near a breakout level
  const nearResistance = currentPrice > recentHigh * 0.98;
  const nearSupport = currentPrice < recentLow * 1.02;

  if (nearResistance || nearSupport) {
    const latestCandle = data[data.length - 1];
    const volumeSpike =
      latestCandle.volume >
      (data.slice(-20, -1).reduce((sum, d) => sum + d.volume, 0) / 19) * 1.5;

    if (nearResistance && currentPrice > recentHigh) {
      // Breakout above resistance
      if (volumeSpike && latestCandle.close > latestCandle.open) {
        quality.confirmed = true;
      } else {
        quality.falseBreakout = true;
      }
    } else if (nearSupport && currentPrice < recentLow) {
      // Breakdown below support
      if (volumeSpike && latestCandle.close < latestCandle.open) {
        quality.confirmed = true;
      } else {
        quality.falseBreakout = true;
      }
    } else {
      quality.pending = true;
    }
  }

  return quality;
}

/* ──────────── Final Score Mapping ──────────── */

function mapToFinalScore(combinedScore) {
  // Enhanced cutoffs for better distribution
  if (combinedScore >= 3.0) return 1; // Strong Buy
  if (combinedScore >= 2.0) return 2; // Buy
  if (combinedScore >= 1.0) return 3; // Watch
  if (combinedScore >= 0) return 4; // Neutral
  if (combinedScore >= -1.0) return 5; // Caution
  if (combinedScore >= -2.0) return 6; // Avoid
  return 7; // Strong Avoid
}

// Export if using modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getEnhancedEntryTimingV2 };
}



/**
 * Determine Buying Urgency and Risk Level
 */
function getLimitOrderPrice(stock) {
  // Extract all available data
  const {
    ticker,
    sector,
    currentPrice,
    fiftyTwoWeekLow,
    fiftyTwoWeekHigh,
    movingAverage50d,
    movingAverage200d,
    bollingerLower,
    bollingerUpper,
    rsi14,
    macd,
    macdSignal,
    stochasticK,
    stochasticD,
    atr14,
    historicalData,
    prevClosePrice, // Previous day closing price
  } = stock;

  // Helper function to calculate standard deviation
  function calculateStdDev(values) {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
    return Math.sqrt(
      squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length
    );
  }

  // Check for significant market-wide movement
  const dailyChange = prevClosePrice ? currentPrice / prevClosePrice - 1 : 0;
  const isMarketShockDay = Math.abs(dailyChange) > 0.02; // 2% daily move threshold

  // Calculate stock-specific volatility characteristics
  const volatilityFactor = atr14 ? atr14 / currentPrice : 0.02;
  const isHighVolatility = volatilityFactor > 0.03;

  // Analyze recent price trend to detect sudden drops
  let recentMarketTrend = "NEUTRAL";
  let recentMarketVolatility = "NORMAL";

  if (historicalData && historicalData.length > 5) {
    // Get the last 5 days of data
    const recentData = historicalData.slice(-5);
    const fiveDayReturn = currentPrice / recentData[0].price - 1;

    // Calculate recent volatility
    const recentDailyReturns = [];
    for (let i = 1; i < recentData.length; i++) {
      recentDailyReturns.push(
        recentData[i].price / recentData[i - 1].price - 1
      );
    }

    const recentVolatility = calculateStdDev(recentDailyReturns);

    // Determine trend direction and volatility level
    if (fiveDayReturn < -0.05) {
      recentMarketTrend = "STRONG_DOWN";
    } else if (fiveDayReturn < -0.02) {
      recentMarketTrend = "DOWN";
    } else if (fiveDayReturn > 0.05) {
      recentMarketTrend = "STRONG_UP";
    } else if (fiveDayReturn > 0.02) {
      recentMarketTrend = "UP";
    }

    if (recentVolatility > 0.02) {
      recentMarketVolatility = "HIGH";
    }
  }

  // Sector-specific adjustments
  const isTechSector = sector === "Technology" || sector === "Communications";
  const isDefensiveSector =
    sector === "Utilities" || sector === "Consumer Staples";

  // Determine technical conditions
  const isOversold = rsi14 < (isDefensiveSector ? 35 : 30);
  const isBearishMomentum = macd < 0 && (macdSignal ? macd < macdSignal : true);
  const isBearishStochastic = stochasticK < 20 && stochasticD < 20;
  const isPriceNearSupport = currentPrice <= bollingerLower * 1.02;

  // Calculate position in 52-week range (0-100%)
  const pricePositionInRange =
    ((currentPrice - fiftyTwoWeekLow) / (fiftyTwoWeekHigh - fiftyTwoWeekLow)) *
    100;

  // Support and resistance levels
  const majorSupport = Math.max(
    movingAverage200d || currentPrice * 0.92,
    fiftyTwoWeekLow * 1.05
  );

  const minorSupport = Math.max(
    movingAverage50d || currentPrice * 0.96,
    bollingerLower || currentPrice * (1 - volatilityFactor * 2)
  );

  // Dynamic urgency evaluation
  let urgencyScore = 0;

  // Technical factors
  if (isOversold) urgencyScore += 2;
  if (isBearishMomentum) urgencyScore += 1;
  if (isBearishStochastic) urgencyScore += 1;
  if (isPriceNearSupport) urgencyScore += 2;

  // Price position factors
  if (pricePositionInRange < 15) urgencyScore += 3;
  else if (pricePositionInRange < 30) urgencyScore += 2;
  else if (pricePositionInRange < 50) urgencyScore += 1;

  // Market trend adjustments - critical for addressing your concern
  if (recentMarketTrend === "STRONG_DOWN") {
    urgencyScore -= 2; // Reduce urgency during sharp market drops

    if (isMarketShockDay && dailyChange < 0) {
      urgencyScore -= 3; // Further reduce during dramatic news-driven drops
    }
  } else if (recentMarketTrend === "DOWN") {
    urgencyScore -= 1;
  }

  // Volatility adjustments
  if (isHighVolatility) urgencyScore += 1;
  if (recentMarketVolatility === "HIGH") urgencyScore -= 1; // Be more cautious during volatile periods

  // Sector adjustments
  if (isTechSector) urgencyScore += 1;
  if (isDefensiveSector) urgencyScore -= 1;

  // Determine final urgency level
  let urgencyLevel;
  if (urgencyScore >= 6) urgencyLevel = "HIGH_URGENCY";
  else if (urgencyScore >= 3) urgencyLevel = "MODERATE_URGENCY";
  else if (urgencyScore >= 0) urgencyLevel = "LOW_URGENCY";
  else urgencyLevel = "WAIT_AND_SEE"; // New level for market shock days

  // Market shock day override - directly addressing your concern
  if (isMarketShockDay && dailyChange < -0.03) {
    urgencyLevel = "WAIT_AND_SEE"; // Force conservative approach during major drops
  }

  // Calculate limit order price based on urgency
  let limitOrderPrice;

  switch (urgencyLevel) {
    case "HIGH_URGENCY":
      // More conservative during market shocks but still opportunistic
      limitOrderPrice = Math.min(
        currentPrice * (isMarketShockDay ? 0.97 : 0.99),
        minorSupport * 1.01
      );
      break;

    case "MODERATE_URGENCY":
      // More patient approach
      limitOrderPrice = Math.min(
        currentPrice * (isMarketShockDay ? 0.95 : 0.97),
        (minorSupport + majorSupport) / 2
      );
      break;

    case "LOW_URGENCY":
      // Conservative, wait for better price
      limitOrderPrice = Math.min(
        currentPrice * (isMarketShockDay ? 0.93 : 0.95),
        majorSupport
      );
      break;

    case "WAIT_AND_SEE":
      // Very conservative during market shocks - expect further drops
      // Target significant discounts during market-wide events
      limitOrderPrice = Math.min(currentPrice * 0.9, majorSupport * 0.95);
      break;
  }

  // Market shock adjustment - expect further declines
  if (isMarketShockDay && dailyChange < 0) {
    // Additional discount during market shocks
    limitOrderPrice *= 0.97;
  }

  // Recent trend adjustment
  if (recentMarketTrend === "STRONG_DOWN") {
    // Expect further declines in strong downtrends
    limitOrderPrice *= 0.97;
  }

  // Final guardrails - adjust floor during market shocks
  const absoluteMinimum = isMarketShockDay
    ? Math.max(currentPrice * 0.85, fiftyTwoWeekLow * 1.02)
    : Math.max(currentPrice * 0.9, fiftyTwoWeekLow * 1.05);

  // Never go above current price
  limitOrderPrice = Math.min(
    Math.max(limitOrderPrice, absoluteMinimum),
    currentPrice
  );

  return parseFloat(limitOrderPrice.toFixed(2));
}




/***********************************************
 * 6) SCAN LOGIC (Main Workflow)
 ***********************************************/
window.scan = {
  async fetchStockAnalysis(tickerList = []) {
    try {
      const allTickers = [
        { code: "4151.T", sector: "Pharmaceuticals" },
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
        { code: "7974.T", sector: "Services" },
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
        { code: "9532.T", sector: "Gas" }
      ];

      const filteredTickers =
        tickerList.length > 0
          ? allTickers.filter((t) => tickerList.includes(t.code.replace(".T", "")))
          : allTickers;

      for (const tickerObj of filteredTickers) {
        console.log(`\n--- Fetching data for ${tickerObj.code} ---`);

        try {
          // 1) Fetch Yahoo data
          const result = await fetchSingleStockData(tickerObj);
          if (!result.success) {
            console.error("Error fetching stock analysis:", result.error);
            throw new Error("Failed to fetch Yahoo data.");
          }

          const { code, sector, yahooData } = result.data;

          // First check if yahooData exists at all
          if (!yahooData) {
            console.error(
              `Missing Yahoo data for ${code}. Aborting calculation.`
            );
            throw new Error("Yahoo data is completely missing.");
          }

          // Define critical fields that must be present
          const criticalFields = ["currentPrice", "highPrice", "lowPrice"];
          const missingCriticalFields = criticalFields.filter(
            (field) => !yahooData[field]
          );

          // Define non-critical fields to check
          const nonCriticalFields = [
            "openPrice",
            "prevClosePrice",
            "marketCap",
            "peRatio",
            "pbRatio",
            "dividendYield",
            "dividendGrowth5yr",
            "fiftyTwoWeekHigh",
            "fiftyTwoWeekLow",
            "epsTrailingTwelveMonths",
            "epsForward",
            "epsGrowthRate",
            "debtEquityRatio",
            "movingAverage50d",
            "movingAverage200d",
            "rsi14",
            "macd",
            "macdSignal",
            "bollingerMid",
            "bollingerUpper",
            "bollingerLower",
            "stochasticK",
            "stochasticD",
            "obv",
            "atr14",
          ];
          const missingNonCriticalFields = nonCriticalFields.filter(
            (field) =>
              yahooData[field] === undefined || yahooData[field] === null
          );

          // Check for zero values (which might indicate failures in calculations)
          const zeroFields = [...criticalFields, ...nonCriticalFields].filter(
            (field) =>
              yahooData[field] !== undefined &&
              yahooData[field] !== null &&
              yahooData[field] === 0 &&
              !["dividendYield", "dividendGrowth5yr", "epsGrowthRate"].includes(
                field
              ) // Fields that can legitimately be zero
          );

          // Log detailed information
          console.log(`Data validation for ${code}:`);

          if (missingCriticalFields.length > 0) {
            console.error(
              `❌ Missing critical fields: ${missingCriticalFields.join(", ")}`
            );
            throw new Error(
              `Critical Yahoo data is missing: ${missingCriticalFields.join(
                ", "
              )}`
            );
          }

          if (missingNonCriticalFields.length > 0) {
            console.warn(
              `⚠️ Missing non-critical fields: ${missingNonCriticalFields.join(
                ", "
              )}`
            );
          }

          if (zeroFields.length > 0) {
            console.warn(
              `⚠️ Fields with zero values (potential calculation errors): ${zeroFields.join(
                ", "
              )}`
            );
          }

          console.log(
            `✅ All critical fields present for ${code}. Continuing analysis...`
          );
          console.log("Yahoo data:", yahooData);

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
            dividendGrowth5yr: yahooData.dividendGrowth5yr,
            fiftyTwoWeekHigh: yahooData.fiftyTwoWeekHigh,
            fiftyTwoWeekLow: yahooData.fiftyTwoWeekLow,
            epsTrailingTwelveMonths: yahooData.epsTrailingTwelveMonths,
            epsForward: yahooData.epsForward,
            epsGrowthRate: yahooData.epsGrowthRate,
            debtEquityRatio: yahooData.debtEquityRatio,
            movingAverage50d: yahooData.movingAverage50d,
            movingAverage200d: yahooData.movingAverage200d,

            // 📈 Technical indicators
            rsi14: yahooData.rsi14,
            macd: yahooData.macd,
            macdSignal: yahooData.macdSignal,
            bollingerMid: yahooData.bollingerMid,
            bollingerUpper: yahooData.bollingerUpper,
            bollingerLower: yahooData.bollingerLower,
            stochasticK: yahooData.stochasticK,
            stochasticD: yahooData.stochasticD,
            obv: yahooData.obv,
            atr14: yahooData.atr14,
          };

          const historicalData = await fetchHistoricalData(stock.ticker);
          stock.historicalData = historicalData || [];

          // 4) Analyze with ML for next 30 days, using the already-fetched historicalData
          console.log(`Analyzing stock: ${stock.ticker}`);
          const prediction = await analyzeStock(stock.ticker, historicalData);
          if (prediction == null) {
            console.error(
              `Failed to generate prediction for ${stock.ticker}. Aborting.`
            );
            throw new Error("Failed to generate prediction.");
          }

          console.log("prediction: ", prediction);
          stock.prediction = prediction;

          // 5) Calculate Stop Loss & Target
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

          stock.growthPotential = parseFloat(growthPotential.toFixed(2));
          stock.finalScore = parseFloat(finalScore.toFixed(2));
          stock.technicalScore = getTechnicalScore(stock);
          stock.fundamentalScore = getAdvancedFundamentalScore(stock);
          stock.valuationScore = getValuationScore(stock);

          const entryAnalysis = getEnhancedEntryTimingV2(stock);

          // Assign each value to the stock object
          stock.entryTimingScore = entryAnalysis.score;
          stock.smartStopLoss = entryAnalysis.stopLoss;
          stock.smartPriceTarget = entryAnalysis.priceTarget;
          stock.tier = getNumericTier(stock);
          stock.limitOrder = getLimitOrderPrice(stock);

          // 10) Send data in Bubble key format
          const stockObject = {
            _api_c2_ticker: stock.ticker,
            _api_c2_sector: stock.sector,
            _api_c2_currentPrice: stock.currentPrice,
            _api_c2_entryTimingScore: stock.entryTimingScore,
            _api_c2_prediction: stock.prediction,
            _api_c2_stopLoss: stock.stopLoss,
            _api_c2_targetPrice: stock.targetPrice,
            _api_c2_growthPotential: stock.growthPotential,
            _api_c2_score: stock.score,
            _api_c2_finalScore: stock.finalScore,
            _api_c2_tier: stock.tier,
            _api_c2_smartStopLoss : stock.smartStopLoss,
            _api_c2_smartPriceTarget : stock.smartPriceTarget,
            _api_c2_limitOrder: stock.limitOrder,

            // Add complete stock data as JSON
            _api_c2_otherData: JSON.stringify({
              // Price data
              highPrice: stock.highPrice,
              lowPrice: stock.lowPrice,
              openPrice: stock.openPrice,
              prevClosePrice: stock.prevClosePrice,

              // Fundamental metrics
              marketCap: stock.marketCap,
              peRatio: stock.peRatio,
              pbRatio: stock.pbRatio,
              dividendYield: stock.dividendYield,
              dividendGrowth5yr: stock.dividendGrowth5yr,
              fiftyTwoWeekHigh: stock.fiftyTwoWeekHigh,
              fiftyTwoWeekLow: stock.fiftyTwoWeekLow,
              epsTrailingTwelveMonths: stock.epsTrailingTwelveMonths,
              epsForward: stock.epsForward,
              epsGrowthRate: stock.epsGrowthRate,
              debtEquityRatio: stock.debtEquityRatio,

              // Technical indicators
              movingAverage50d: stock.movingAverage50d,
              movingAverage200d: stock.movingAverage200d,
              rsi14: stock.rsi14,
              macd: stock.macd,
              macdSignal: stock.macdSignal,
              bollingerMid: stock.bollingerMid,
              bollingerUpper: stock.bollingerUpper,
              bollingerLower: stock.bollingerLower,
              stochasticK: stock.stochasticK,
              stochasticD: stock.stochasticD,
              obv: stock.obv,
              atr14: stock.atr14,

              // Calculated scores
              technicalScore: stock.technicalScore,
              fundamentalScore: stock.fundamentalScore,
              valuationScore: stock.valuationScore,
            }),
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

      // ✅ Finished processing all tickers (success or some errors)
      bubble_fn_finish();
    } catch (error) {
      console.error("❌ Error in fetchStockAnalysis:", error.message);

      // 🔴 If outer error (like JSON parse or logic bug), still call finish
      bubble_fn_finish();

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


const customHeaders = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, Gecko) Chrome/91.0.4472.124 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
};

function computeMedian(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computePercentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = p * (sorted.length - 1);
  if (Number.isInteger(idx)) {
    return sorted[idx];
  } else {
    const lower = sorted[Math.floor(idx)];
    const upper = sorted[Math.ceil(idx)];
    return lower + (upper - lower) * (idx - Math.floor(idx));
  }
}

function computeIQR(arr) {
  const q1 = computePercentile(arr, 0.25);
  const q3 = computePercentile(arr, 0.75);
  return q3 - q1;
}

/**
 * Winsorize a value given lower and upper bounds.
 */
function winsorizeVal(val, lower, upper) {
  return Math.min(Math.max(val, lower), upper);
}

/**
 * Winsorize an array given lower and upper percentile thresholds.
 */
function winsorizeArray(arr, lowerP = 0.05, upperP = 0.95) {
  const lower = computePercentile(arr, lowerP);
  const upper = computePercentile(arr, upperP);
  return {
    winsorized: arr.map((x) => winsorizeVal(x, lower, upper)),
    lower,
    upper,
  };
}

/**
 * Compute simple moving average over an array.
 */
function computeSMA(arr, window) {
  const sma = [];
  for (let i = 0; i < arr.length; i++) {
    const start = Math.max(0, i - window + 1);
    const subset = arr.slice(start, i + 1);
    const avg = subset.reduce((sum, v) => sum + v, 0) / subset.length;
    sma.push(avg);
  }
  return sma;
}

/**
 * Compute daily log return.
 * For log prices, daily return = log(p[i]) - log(p[i-1])
 */
function computeDailyLogReturn(logPrices) {
  const returns = [0]; // First day return set to 0.
  for (let i = 1; i < logPrices.length; i++) {
    returns.push(logPrices[i] - logPrices[i - 1]);
  }
  return returns;
}

function customHuberLoss(delta = 1.0) {
  return function (yTrue, yPred) {
    const error = yTrue.sub(yPred).abs();
    const quadratic = tf.minimum(error, delta);
    const linear = error.sub(quadratic);
    return tf
      .add(tf.mul(0.5, tf.square(quadratic)), tf.mul(delta, linear))
      .mean();
  };
}




/* -------------------------------------------------------------------------
   30‑Day‑Ahead utilities — but now they predict the **maximum** price that will
   occur within the next 30 days (instead of the closing price exactly on +30).
   Function names are kept unchanged so existing imports still work.
   ------------------------------------------------------------------------- */

/**
 * prepareDataFor30DayAheadPrice
 *
 * Returns { inputTensor, outputTensor, meta }
 *   • inputTensor  — shape  [N, 30, 4]
 *   • outputTensor — shape  [N,  1]   (normalised max‑log‑price)
 *   • meta         — medians / IQRs / winsorisation bounds, etc.
 */
function prepareDataFor30DayAheadPrice(
  data,
  sequenceLength = 30,
  predictionGap = 30
) {
  if (data.length < sequenceLength + predictionGap) {
    throw new Error("Not enough data to create sequences for prediction.");
  }

  // ───────────────────────────────────────────
  // 1. Extract raw arrays & derived features
  // ───────────────────────────────────────────
  const prices  = data.map((d) => d.price);
  const volumes = data.map((d) => d.volume);
  const logPrices = prices.map(Math.log);
  const sma7  = computeSMA(logPrices, 7);
  const dLogR = computeDailyLogReturn(logPrices);

  // ───────────────────────────────────────────
  // 2. Winsorisation on the training segment (exclude forecast window)
  // ───────────────────────────────────────────
  const cutoff = prices.length - predictionGap;
  const { winsorized: wLog, lower: loLog, upper: hiLog } = winsorizeArray(logPrices.slice(0, cutoff));
  const { winsorized: wVol, lower: loVol, upper: hiVol } = winsorizeArray(volumes   .slice(0, cutoff));
  const { winsorized: wSma, lower: loSma, upper: hiSma } = winsorizeArray(sma7     .slice(0, cutoff));
  const { winsorized: wRet, lower: loRet, upper: hiRet } = winsorizeArray(dLogR    .slice(0, cutoff));

  // ───────────────────────────────────────────
  // 3. Robust statistics (median & IQR)
  // ───────────────────────────────────────────
  const medLog = computeMedian(wLog); const iqrLog = computeIQR(wLog);
  const medVol = computeMedian(wVol); const iqrVol = computeIQR(wVol);
  const medSma = computeMedian(wSma); const iqrSma = computeIQR(wSma);
  const medRet = computeMedian(wRet); const iqrRet = computeIQR(wRet);

  const bounds = {
    logPrice: { lower: loLog, upper: hiLog },
    volume  : { lower: loVol, upper: hiVol },
    sma     : { lower: loSma, upper: hiSma },
    return  : { lower: loRet, upper: hiRet },
  };

  const norm = (v, m, q, lo, hi) => (winsorizeVal(v, lo, hi) - m) / (q || 1);

  // ───────────────────────────────────────────
  // 4. Build sequences & **max‑price** targets
  // ───────────────────────────────────────────
  const X = []; const y = [];
  for (let i = 0; i <= data.length - sequenceLength - predictionGap; i++) {
    // 4‑a  .. input sequence
    const seq = [];
    for (let j = 0; j < sequenceLength; j++) {
      seq.push([
        norm(Math.log(prices [i+j]), medLog, iqrLog, loLog, hiLog),
        norm(volumes [i+j],       medVol, iqrVol, loVol, hiVol),
        norm(sma7   [i+j],        medSma, iqrSma, loSma, hiSma),
        norm(dLogR  [i+j],        medRet, iqrRet, loRet, hiRet),
      ]);
    }
    X.push(seq);

    // 4‑b  .. TARGET: max log‑price within [i+seqLen, i+seqLen+gap)
    const windowMaxPrice = Math.max(...prices.slice(i + sequenceLength, i + sequenceLength + predictionGap));
    y.push(norm(Math.log(windowMaxPrice), medLog, iqrLog, loLog, hiLog));
  }

  return {
    inputTensor : tf.tensor3d(X, [X.length, sequenceLength, 4]),
    outputTensor: tf.tensor2d(y, [y.length, 1]),
    meta: {
      medianLogPrice: medLog, iqrLogPrice: iqrLog,
      medianVolume  : medVol, iqrVolume  : iqrVol,
      medianSMA     : medSma, iqrSMA     : iqrSma,
      medianReturn  : medRet, iqrReturn  : iqrRet,
      bounds,
      lastKnownPrice: prices[prices.length-1],
    },
  };
}

/**
 * trainModelFor30DayAheadPrice ➜ **trains on the new target** (max‑price).
 */
async function trainModelFor30DayAheadPrice(data) {
  const seqLen = 30, gap = 30;
  const { inputTensor, outputTensor, meta } = prepareDataFor30DayAheadPrice(data, seqLen, gap);

  const model = tf.sequential();
  model.add(tf.layers.lstm({ units: 64, inputShape: [seqLen, 4],
    kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
    recurrentRegularizer: tf.regularizers.l2({ l2: 0.01 }),
  }));
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.dense({ units: 1 }));

  model.compile({ optimizer: tf.train.adam(), loss: customHuberLoss(2.0) });
  await model.fit(inputTensor, outputTensor, {
    epochs: 50, batchSize: 32, validationSplit: 0.2,
    callbacks: [tf.callbacks.earlyStopping({ monitor: 'val_loss', patience: 5, restoreBestWeight: true })],
  });

  return { model, meta };
}

/**
 * predict30DayAheadPrice ➜ returns estimated **highest** price in next 30 days.
 */
async function predict30DayAheadPrice(modelObj, data) {
  const { model, meta } = modelObj;
  const {
    medianLogPrice, iqrLogPrice,
    medianVolume,   iqrVolume,
    medianSMA,      iqrSMA,
    medianReturn,   iqrReturn,
    bounds,
  } = meta;

  const seqLen = 30;
  const recent = data.slice(-seqLen);
  const prices  = recent.map((d) => d.price);
  const volumes = recent.map((d) => d.volume);
  const logPrices = prices.map(Math.log);
  const sma7  = computeSMA(logPrices, 7);
  const dLogR = computeDailyLogReturn(logPrices);

  const norm = (v, m, q, lo, hi) => (winsorizeVal(v, lo, hi) - m) / (q || 1);
  const seq = recent.map((_, i) => [
    norm(Math.log(prices [i]), medianLogPrice, iqrLogPrice, bounds.logPrice.lower, bounds.logPrice.upper),
    norm(volumes [i],         medianVolume,   iqrVolume,   bounds.volume.lower,   bounds.volume.upper),
    norm(sma7    [i],         medianSMA,      iqrSMA,      bounds.sma.lower,      bounds.sma.upper),
    norm(dLogR   [i],         medianReturn,   iqrReturn,   bounds.return.lower,   bounds.return.upper),
  ]);

  const predNorm = model.predict(tf.tensor3d([seq], [1, seqLen, 4])).dataSync()[0];
  const predLog  = predNorm * iqrLogPrice + medianLogPrice;
  return Math.exp(predLog);
}

// If you are using modules:
// export { prepareDataFor30DayAheadPrice, trainModelFor30DayAheadPrice, predict30DayAheadPrice };




async function analyzeStock(ticker, historicalData) {
  console.log(`Starting analysis for ${ticker} with ${historicalData?.length || 0} data points...`);
  
  try {
    // Pre-process data to ensure no NaN values
    const cleanData = [];
    for (let i = 0; i < historicalData.length; i++) {
      const item = historicalData[i];
      if (item && 
          item.price !== undefined && 
          !isNaN(item.price) && 
          item.volume !== undefined && 
          !isNaN(item.volume)) {
        cleanData.push(item);
      }
    }

    if (cleanData.length < historicalData.length) {
      console.log(`Filtered out ${historicalData.length - cleanData.length} invalid data points for ${ticker}`);
    }

    // Check if we have enough data
    if (cleanData.length < 60) { // Need at least 60 data points (30 for sequence + 30 for prediction)
      console.warn(`Insufficient data for prediction on ${ticker}`);
      if (cleanData.length > 0) {
        return cleanData[cleanData.length - 1].price; // Return last valid price
      }
      return null;
    }

    // Check if this appears to be a Nikkei stock
    const isNikkeiStock =
      ticker.includes(".T") ||
      ticker.includes(".JP") ||
      ticker.endsWith("JT") ||
      ticker.startsWith("JP:");

    // Get current price (for fallback and constraints)
    const prices = cleanData.map(item => item.price);
    const currentPrice = prices[prices.length - 1];

    // If we have enough data for model training
    if (cleanData.length >= 90) { // At least 90 days of data
      try {
        console.log(`${ticker}: Training prediction model...`);
        
        // Use try-catch for each step to get better error information
        let modelObj;
        try {
          // Train the model with 30-day sequence for 30-day ahead prediction
          modelObj = await trainModelFor30DayAheadPrice(cleanData);
          console.log(`${ticker}: Model training completed`);
        } catch (trainError) {
          console.error(`${ticker}: Error during model training:`, trainError.message);
          throw new Error(`Model training failed: ${trainError.message}`);
        }
        
        let predictedPrice;
        try {
          // Get prediction
          predictedPrice = await predict30DayAheadPrice(modelObj, cleanData);
          console.log(`${ticker}: Raw prediction: ${predictedPrice}`);
        } catch (predictError) {
          console.error(`${ticker}: Error during prediction:`, predictError.message);
          throw new Error(`Prediction failed: ${predictError.message}`);
        }
        
        // Validate prediction
        if (isNaN(predictedPrice) || !isFinite(predictedPrice) || predictedPrice <= 0) {
          console.warn(`${ticker}: Invalid prediction result. Using current price.`);
          return currentPrice;
        }
        
        // Apply market-specific constraints
        const percentChange = (predictedPrice / currentPrice - 1) * 100;
        
        // Apply Nikkei-specific constraints
        if (isNikkeiStock && percentChange > 15) {
          console.log(`${ticker}: Limiting Nikkei stock prediction to +15%`);
          predictedPrice = currentPrice * 1.15;
        } else if (isNikkeiStock && percentChange < -15) {
          console.log(`${ticker}: Limiting Nikkei stock prediction to -15%`);
          predictedPrice = currentPrice * 0.85;
        } else if (percentChange > 30) { // General constraints for other markets
          console.log(`${ticker}: Limiting extreme prediction to +30%`);
          predictedPrice = currentPrice * 1.3;
        } else if (percentChange < -30) {
          console.log(`${ticker}: Limiting extreme prediction to -30%`);
          predictedPrice = currentPrice * 0.7;
        }
        
        console.log(`${ticker}: Final prediction: ${predictedPrice.toFixed(2)} (${((predictedPrice/currentPrice-1)*100).toFixed(2)}%)`);
        return predictedPrice;
      } catch (error) {
        console.error(`${ticker}: ML prediction process failed:`, error.message);
        // Fall back to trend-based prediction on model failure
        console.log(`${ticker}: Falling back to trend-based prediction`);
      }
    }
    
    // If we reach here, either we don't have enough data or ML prediction failed
    // Use simple trend-based prediction as fallback
    console.log(`${ticker}: Using trend-based prediction`);
    
    // Use the last 30 days (or what's available) to detect trend
    const lookbackPeriod = Math.min(30, prices.length - 1);
    const priorPrice = prices[prices.length - 1 - lookbackPeriod];
    const recentTrendPercent = (currentPrice / priorPrice - 1) * 100;
    
    // Apply dampening factor to recent trend (30% of trend)
    let predictedChangePercent = recentTrendPercent * 0.3;
    
    // Apply constraints based on stock type
    const maxChange = isNikkeiStock ? 10 : 15; // More conservative for Nikkei
    predictedChangePercent = Math.max(Math.min(predictedChangePercent, maxChange), -maxChange);
    
    const predictedPrice = currentPrice * (1 + predictedChangePercent / 100);
    
    console.log(`${ticker}: Trend-based prediction: ${predictedPrice.toFixed(2)} (${predictedChangePercent.toFixed(2)}%)`);
    return predictedPrice;
    
  } catch (error) {
    console.error(`Error analyzing stock for ${ticker}:`, error.message);
    
    // Ultimate fallback - return current price if available
    if (historicalData && historicalData.length > 0) {
      for (let i = historicalData.length - 1; i >= 0; i--) {
        const item = historicalData[i];
        if (item && item.price && !isNaN(item.price)) {
          return item.price;
        }
      }
    }
    return null;
  } finally {
    // Clean up any potential memory leaks from TensorFlow.js
    try {
      tf.engine().endScope();
      if (tf.engine().getNumTensors() > 0) {
        console.warn(`${ticker}: Potential memory leak - ${tf.engine().getNumTensors()} tensors still allocated`);
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

window.fastscan = {
  async fastfetchStockAnalysis(tickerList = []) {
    try {
      for (const tickerObj of tickerList) {
        const { ticker, data } = tickerObj;
        const { prediction: previousprediction, sector } = data;

        console.log(`\n--- Fetching data for ${ticker} ---`);

        try {
          // 1) Fetch Yahoo data
          const result = await fetchSingleStockData({ code: ticker });
          if (!result.success) {
            console.error("Error fetching stock analysis:", result.error);
            throw new Error("Failed to fetch Yahoo data.");
          }

          const { code, yahooData } = result.data;

          // Check if yahooData exists
          if (!yahooData) {
            console.error(`Missing Yahoo data for ${code}. Aborting calculation.`);
            throw new Error("Yahoo data is completely missing.");
          }

          // Define critical fields that must be present
          const criticalFields = ["currentPrice", "highPrice", "lowPrice"];
          const missingCriticalFields = criticalFields.filter(
            (field) => !yahooData[field]
          );

          const nonCriticalFields = [
            "openPrice", "prevClosePrice", "marketCap", "peRatio", "pbRatio",
            "dividendYield", "dividendGrowth5yr", "fiftyTwoWeekHigh", "fiftyTwoWeekLow",
            "epsTrailingTwelveMonths", "epsForward", "epsGrowthRate", "debtEquityRatio",
            "movingAverage50d", "movingAverage200d", "rsi14", "macd", "macdSignal",
            "bollingerMid", "bollingerUpper", "bollingerLower", "stochasticK",
            "stochasticD", "obv", "atr14"
          ];
          const missingNonCriticalFields = nonCriticalFields.filter(
            (field) =>
              yahooData[field] === undefined || yahooData[field] === null
          );

          const zeroFields = [...criticalFields, ...nonCriticalFields].filter(
            (field) =>
              yahooData[field] !== undefined &&
              yahooData[field] !== null &&
              yahooData[field] === 0 &&
              !["dividendYield", "dividendGrowth5yr", "epsGrowthRate"].includes(field)
          );

          console.log(`Data validation for ${code}:`);

          if (missingCriticalFields.length > 0) {
            console.error(`❌ Missing critical fields: ${missingCriticalFields.join(", ")}`);
            throw new Error(`Critical Yahoo data is missing: ${missingCriticalFields.join(", ")}`);
          }

          if (missingNonCriticalFields.length > 0) {
            console.warn(`⚠️ Missing non-critical fields: ${missingNonCriticalFields.join(", ")}`);
          }

          if (zeroFields.length > 0) {
            console.warn(`⚠️ Fields with zero values: ${zeroFields.join(", ")}`);
          }

          console.log(`✅ All critical fields present for ${code}. Continuing analysis...`);


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
            dividendGrowth5yr: yahooData.dividendGrowth5yr,
            fiftyTwoWeekHigh: yahooData.fiftyTwoWeekHigh,
            fiftyTwoWeekLow: yahooData.fiftyTwoWeekLow,
            epsTrailingTwelveMonths: yahooData.epsTrailingTwelveMonths,
            epsForward: yahooData.epsForward,
            epsGrowthRate: yahooData.epsGrowthRate,
            debtEquityRatio: yahooData.debtEquityRatio,
            movingAverage50d: yahooData.movingAverage50d,
            movingAverage200d: yahooData.movingAverage200d,
            rsi14: yahooData.rsi14,
            macd: yahooData.macd,
            macdSignal: yahooData.macdSignal,
            bollingerMid: yahooData.bollingerMid,
            bollingerUpper: yahooData.bollingerUpper,
            bollingerLower: yahooData.bollingerLower,
            stochasticK: yahooData.stochasticK,
            stochasticD: yahooData.stochasticD,
            obv: yahooData.obv,
            atr14: yahooData.atr14,
          };

          console.log(`Analyzing stock: ${stock.ticker}`);

          const historicalData = await fetchHistoricalData(stock.ticker);
          stock.historicalData = historicalData || [];
          const prediction = previousprediction;
          if (prediction == null) {
            console.error(`Failed to generate prediction for ${stock.ticker}. Aborting.`);
            throw new Error("Failed to generate prediction.");
          }

          stock.prediction = prediction;

          const { stopLoss, targetPrice } = calculateStopLossAndTarget(stock, prediction);
          if (stopLoss === null || targetPrice === null) {
            console.error(`Failed to calculate stop loss or target price for ${stock.ticker}.`);
            throw new Error("Stop loss or target price calculation failed.");
          }

          stock.stopLoss = stopLoss;
          stock.targetPrice = targetPrice;

          const growthPotential =
            ((stock.targetPrice - stock.currentPrice) / stock.currentPrice) * 100;

          stock.score = computeScore(stock, stock.sector);

          const weights = { metrics: 0.7, growth: 0.3 };
          const finalScore =
            weights.metrics * stock.score + weights.growth * (growthPotential / 100);

          stock.growthPotential = parseFloat(growthPotential.toFixed(2));
          stock.finalScore = parseFloat(finalScore.toFixed(2));
          stock.technicalScore = getTechnicalScore(stock);
          stock.fundamentalScore = getAdvancedFundamentalScore(stock);
          stock.valuationScore = getValuationScore(stock);
          const entryAnalysis = getEnhancedEntryTimingV2(stock);

          // Assign each value to the stock object
          stock.entryTimingScore = entryAnalysis.score;
          stock.smartStopLoss = entryAnalysis.stopLoss;
          stock.smartPriceTarget = entryAnalysis.priceTarget;
          stock.tier = getNumericTier(stock);
          stock.limitOrder = getLimitOrderPrice(stock);

          const stockObject = {
            _api_c2_ticker: stock.ticker,
            _api_c2_sector: stock.sector,
            _api_c2_currentPrice: stock.currentPrice,
            _api_c2_entryTimingScore: stock.entryTimingScore,
            _api_c2_prediction: stock.prediction,
            _api_c2_stopLoss: stock.stopLoss,
            _api_c2_targetPrice: stock.targetPrice,
            _api_c2_growthPotential: stock.growthPotential,
            _api_c2_score: stock.score,
            _api_c2_finalScore: stock.finalScore,
            _api_c2_smartStopLoss: stock.smartStopLoss,
            _api_c2_smartPriceTarget: stock.smartPriceTarget,
            _api_c2_tier: stock.tier,
            _api_c2_limitOrder: stock.limitOrder,
            _api_c2_otherData: JSON.stringify({
              highPrice: stock.highPrice,
              lowPrice: stock.lowPrice,
              openPrice: stock.openPrice,
              prevClosePrice: stock.prevClosePrice,
              marketCap: stock.marketCap,
              peRatio: stock.peRatio,
              pbRatio: stock.pbRatio,
              dividendYield: stock.dividendYield,
              dividendGrowth5yr: stock.dividendGrowth5yr,
              fiftyTwoWeekHigh: stock.fiftyTwoWeekHigh,
              fiftyTwoWeekLow: stock.fiftyTwoWeekLow,
              epsTrailingTwelveMonths: stock.epsTrailingTwelveMonths,
              epsForward: stock.epsForward,
              epsGrowthRate: stock.epsGrowthRate,
              debtEquityRatio: stock.debtEquityRatio,
              movingAverage50d: stock.movingAverage50d,
              movingAverage200d: stock.movingAverage200d,
              rsi14: stock.rsi14,
              macd: stock.macd,
              macdSignal: stock.macdSignal,
              bollingerMid: stock.bollingerMid,
              bollingerUpper: stock.bollingerUpper,
              bollingerLower: stock.bollingerLower,
              stochasticK: stock.stochasticK,
              stochasticD: stock.stochasticD,
              obv: stock.obv,
              atr14: stock.atr14,
              technicalScore: stock.technicalScore,
              fundamentalScore: stock.fundamentalScore,
              valuationScore: stock.valuationScore,
            }),
          };

          console.log(`📤 Sending ${stock.ticker} to Bubble:`, stockObject);
          bubble_fn_result(stockObject);
        } catch (error) {
          console.error(`❌ Error processing ticker ${ticker}:`, error.message);
        }
      }

      bubble_fn_finish();
    } catch (error) {
      console.error("❌ Error in fetchStockAnalysis:", error.message);
      bubble_fn_finish();
      throw new Error("Analysis aborted due to errors.");
    }
  },
};
