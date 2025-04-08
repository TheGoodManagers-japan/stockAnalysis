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

function getTechnicalScore(stock) {
  // Extract only the properties we know are available
  const {
    currentPrice = 0,
    movingAverage50d = 0,
    movingAverage200d = 0,
    rsi14 = 50,
    macd = 0,
    macdSignal = 0,
    bollingerMid = 0,
    bollingerUpper = 0,
    bollingerLower = 0,
    stochasticK = 50,
    stochasticD = 50,
    atr14 = 0,
    obv = 0,
  } = stock;

  // === TREND SIGNALS ===
  const goldCross =
    movingAverage50d > movingAverage200d &&
    movingAverage50d - movingAverage200d < movingAverage50d * 0.05;
  const deathCross =
    movingAverage50d < movingAverage200d &&
    movingAverage200d - movingAverage50d < movingAverage200d * 0.05;
  const strongBullishTrend = movingAverage50d > movingAverage200d * 1.05;
  const strongBearishTrend = movingAverage50d < movingAverage200d * 0.95;
  const moderateBullishTrend =
    movingAverage50d > movingAverage200d && !goldCross && !strongBullishTrend;
  const moderateBearishTrend =
    movingAverage50d < movingAverage200d && !deathCross && !strongBearishTrend;

  // === MOMENTUM SIGNALS ===
  // MACD
  const isBullishMACD = macd > macdSignal;
  const isBearishMACD = macd < macdSignal;
  const macdCrossover = Math.abs(macd - macdSignal) < Math.abs(macd * 0.1);
  const macdDivergence = Math.abs(macd - macdSignal) > Math.abs(macd * 0.25);

  // RSI
  const isOverbought = rsi14 >= 70;
  const isOverboughtExtreme = rsi14 >= 80;
  const isOversold = rsi14 <= 30;
  const isOversoldExtreme = rsi14 <= 20;
  const isBullishRSI = rsi14 >= 55 && rsi14 < 70;
  const isBearishRSI = rsi14 <= 45 && rsi14 > 30;

  // Stochastic
  const isStochOverbought = stochasticK >= 80 && stochasticD >= 80;
  const isStochOversold = stochasticK <= 20 && stochasticD <= 20;
  const isBullishStochastic = stochasticK > stochasticD;
  const isBearishStochastic = stochasticK < stochasticD;
  const stochCrossover = Math.abs(stochasticK - stochasticD) < 5;

  // === VOLATILITY AND PRICE ACTION ===
  // Bollinger Bands
  const isBullishBB = currentPrice > bollingerMid;
  const isBearishBB = currentPrice < bollingerMid;
  const isUpperBreakout = currentPrice > bollingerUpper;
  const isLowerBreakout = currentPrice < bollingerLower;
  const isNarrowBands =
    bollingerUpper &&
    bollingerLower &&
    (bollingerUpper - bollingerLower) / bollingerMid < 0.05;
  const isWideBands =
    bollingerUpper &&
    bollingerLower &&
    (bollingerUpper - bollingerLower) / bollingerMid > 0.08;

  // ATR (Volatility)
  const isHighVolatility = atr14 >= currentPrice * 0.03;
  const isVeryHighVolatility = atr14 >= currentPrice * 0.04;
  const isLowVolatility = atr14 <= currentPrice * 0.015;
  const isVeryLowVolatility = atr14 <= currentPrice * 0.01;

  // === SCORING SYSTEM ===
  // Base weights for different signal categories
  const weights = {
    trend: 2.5,
    momentum: 2.0,
    volatility: 1.5,
    special: 1.5,
  };

  // Initialize bullish and bearish scores
  let bullishScore = 0;
  let bearishScore = 0;

  // === CALCULATE BULLISH SIGNALS ===
  // Trend signals
  if (strongBullishTrend) bullishScore += weights.trend * 1.2;
  else if (moderateBullishTrend) bullishScore += weights.trend;
  else if (goldCross) bullishScore += weights.special * 1.5;

  // Momentum signals
  if (isBullishMACD) {
    bullishScore += weights.momentum * 0.7;
    if (macdDivergence) bullishScore += weights.momentum * 0.3;
  } else if (macdCrossover && macd > 0) {
    bullishScore += weights.special * 0.7;
  }

  if (isOversold) {
    bullishScore += weights.special * 0.8;
    if (isOversoldExtreme) bullishScore += weights.special * 0.4;
  } else if (isBullishRSI) {
    bullishScore += weights.momentum * 0.7;
  }

  if (isBullishStochastic) {
    bullishScore += weights.momentum * 0.6;
    if (isStochOversold && stochCrossover)
      bullishScore += weights.special * 0.8;
  }

  // Volatility signals
  if (isUpperBreakout) bullishScore += weights.volatility * 0.8;
  else if (isBullishBB) bullishScore += weights.volatility * 0.6;

  if (isNarrowBands && moderateBullishTrend)
    bullishScore += weights.special * 0.7;

  // === CALCULATE BEARISH SIGNALS ===
  // Trend signals
  if (strongBearishTrend) bearishScore += weights.trend * 1.2;
  else if (moderateBearishTrend) bearishScore += weights.trend;
  else if (deathCross) bearishScore += weights.special * 1.5;

  // Momentum signals
  if (isBearishMACD) {
    bearishScore += weights.momentum * 0.7;
    if (macdDivergence) bearishScore += weights.momentum * 0.3;
  } else if (macdCrossover && macd < 0) {
    bearishScore += weights.special * 0.7;
  }

  if (isOverbought) {
    bearishScore += weights.special * 0.8;
    if (isOverboughtExtreme) bearishScore += weights.special * 0.4;
  } else if (isBearishRSI) {
    bearishScore += weights.momentum * 0.7;
  }

  if (isBearishStochastic) {
    bearishScore += weights.momentum * 0.6;
    if (isStochOverbought && stochCrossover)
      bearishScore += weights.special * 0.8;
  }

  // Volatility signals
  if (isLowerBreakout) bearishScore += weights.volatility * 0.8;
  else if (isBearishBB) bearishScore += weights.volatility * 0.6;

  if (isNarrowBands && moderateBearishTrend)
    bearishScore += weights.special * 0.7;

  // === VOLATILITY ADJUSTMENTS ===
  // Adjust scores based on volatility conditions
  if (isVeryHighVolatility) {
    bullishScore *= 1.1;
    bearishScore *= 1.2;
  } else if (isHighVolatility) {
    bullishScore *= 1.05;
    bearishScore *= 1.1;
  } else if (isLowVolatility) {
    bullishScore *= 0.95;
    bearishScore *= 0.95;
  } else if (isVeryLowVolatility) {
    bullishScore *= 0.9;
    bearishScore *= 0.9;
  }

  // === NET SCORE ===
  // Calculate net score (bullish - bearish)
  const netScore = bullishScore - bearishScore;

  // Return just the score, rounded to one decimal place
  return Math.round(netScore * 10) / 10;
}


function getAdvancedFundamentalScore(stock) {
  const sector = stock.sector;
  // Extract metrics safely with defaults
  const {
    // Growth metrics
    epsGrowthRate = 0,
    epsForward = 0,
    epsTrailingTwelveMonths = 0,

    // Value metrics
    peRatio = 0,
    pbRatio = 0,

    // Financial health metrics
    debtEquityRatio = 1,

    // Dividend metrics
    dividendYield = 0,
    dividendGrowth5yr = 0,

    // Price data
    currentPrice = 0,
    marketCap = 0,
  } = stock;

  // Initialize scores
  let growthScore = 0;
  let valueScore = 0;
  let financialHealthScore = 0;
  let dividendScore = 0;
  let totalScore = 0;

  // Track key characteristics
  let isStrongGrowth = false;
  let isStrongValue = false;
  let isStrongDividend = false;
  let isStrongBalance = false;

  // Industry-specific adjustments (simplified)
  const isHighGrowthSector =
    sector &&
    (sector.includes("Technology") ||
      sector.includes("Communications") ||
      sector.includes("Pharmaceutical") ||
      sector.includes("Electric Machinery"));

  const isDividendFocusSector =
    sector &&
    (sector.includes("Utilities") ||
      sector.includes("Electric Power") ||
      sector.includes("Gas") ||
      sector.includes("Banking") ||
      sector.includes("Insurance") ||
      sector.includes("Real Estate"));

  // === GROWTH SCORE ===
  // EPS Growth Rate
  if (epsGrowthRate >= 20) {
    growthScore += 3;
    isStrongGrowth = true;
  } else if (epsGrowthRate >= 10) {
    growthScore += 2;
    isStrongGrowth = true;
  } else if (epsGrowthRate >= 5) {
    growthScore += 1;
  } else if (epsGrowthRate < 0) {
    growthScore -= 2;
  }

  // Forward vs Trailing EPS
  if (epsForward > epsTrailingTwelveMonths * 1.2) {
    growthScore += 2;
    isStrongGrowth = true;
  } else if (epsForward > epsTrailingTwelveMonths * 1.05) {
    growthScore += 1;
  } else if (epsForward < epsTrailingTwelveMonths * 0.95) {
    growthScore -= 1;
  }

  // Normalize growth score (0-10)
  growthScore = Math.max(0, Math.min(10, growthScore * 2));

  // === VALUE SCORE ===
  // P/E Ratio (lower is better for value)
  if (peRatio > 0 && peRatio < 10) {
    valueScore += 3;
    isStrongValue = true;
  } else if (peRatio > 0 && peRatio < 15) {
    valueScore += 2;
    isStrongValue = true;
  } else if (peRatio > 0 && peRatio < 20) {
    valueScore += 1;
  } else if (peRatio > 30) {
    valueScore -= 1;
  } else if (peRatio <= 0) {
    valueScore -= 1; // Negative earnings
  }

  // Adjust for high growth sectors
  if (isHighGrowthSector && peRatio > 0 && peRatio < 25) {
    valueScore += 1;
  }

  // P/B Ratio (lower is better for value)
  if (pbRatio > 0 && pbRatio < 1) {
    valueScore += 3;
    isStrongValue = true;
  } else if (pbRatio > 0 && pbRatio < 2) {
    valueScore += 2;
  } else if (pbRatio > 0 && pbRatio < 3) {
    valueScore += 1;
  } else if (pbRatio > 5) {
    valueScore -= 1;
  }

  // Normalize value score (0-10)
  valueScore = Math.max(0, Math.min(10, valueScore * 1.67));

  // === FINANCIAL HEALTH SCORE ===
  // Debt-to-Equity Ratio
  if (debtEquityRatio < 0.25) {
    financialHealthScore += 3;
    isStrongBalance = true;
  } else if (debtEquityRatio < 0.5) {
    financialHealthScore += 2;
    isStrongBalance = true;
  } else if (debtEquityRatio < 1.0) {
    financialHealthScore += 1;
  } else if (debtEquityRatio > 2.0) {
    financialHealthScore -= 2;
  } else if (debtEquityRatio > 1.5) {
    financialHealthScore -= 1;
  }

  // Adjust for sector (financial sectors typically have higher debt)
  if (
    sector &&
    (sector.includes("Banking") ||
      sector.includes("Financial") ||
      sector.includes("Insurance")) &&
    debtEquityRatio < 1.5
  ) {
    financialHealthScore += 1;
  }

  // Normalize financial health score (0-10)
  financialHealthScore = Math.max(
    0,
    Math.min(10, (financialHealthScore + 2) * 2)
  );

  // === DIVIDEND SCORE ===
  // Skip dividend evaluation if no dividend
  if (dividendYield === 0) {
    dividendScore = 0;
  } else {
    // Dividend Yield
    if (dividendYield >= 6) {
      dividendScore += 3;
      isStrongDividend = true;
    } else if (dividendYield >= 4) {
      dividendScore += 2;
      isStrongDividend = true;
    } else if (dividendYield >= 2) {
      dividendScore += 1;
    }

    // Dividend Growth
    if (dividendGrowth5yr >= 10) {
      dividendScore += 2;
      isStrongDividend = true;
    } else if (dividendGrowth5yr >= 5) {
      dividendScore += 1;
    } else if (dividendGrowth5yr < 0) {
      dividendScore -= 1;
    }

    // Normalize dividend score (0-10)
    dividendScore = Math.max(0, Math.min(10, dividendScore * 2));
  }

  // === CALCULATE TOTAL SCORE ===
  // Set weights based on sector type
  let weights = {
    growth: 0.35,
    value: 0.3,
    financialHealth: 0.25,
    dividend: 0.1,
  };

  // Adjust weights for dividend-focused sectors
  if (isDividendFocusSector) {
    weights = {
      growth: 0.2,
      value: 0.3,
      financialHealth: 0.25,
      dividend: 0.25,
    };
  }

  // Adjust weights for high-growth sectors
  if (isHighGrowthSector) {
    weights = {
      growth: 0.45,
      value: 0.2,
      financialHealth: 0.25,
      dividend: 0.1,
    };
  }

  // Calculate final score
  totalScore =
    growthScore * weights.growth +
    valueScore * weights.value +
    financialHealthScore * weights.financialHealth +
    dividendScore * weights.dividend;

  // Round to one decimal place and return just the score
  return Math.round(totalScore * 10) / 10;
}






function getValuationScore(stock) {
  const sector = stock.sector;

  const {
    peRatio = 0,
    pbRatio = 0,
    marketCap = 0,
    priceToSales = 0,
    epsGrowthRate = 0,
    dividendYield = 0,
  } = stock;

  // Determine sector category for adjusted valuation metrics
  const isHighGrowthSector =
    sector &&
    (sector.includes("Technology") ||
      sector.includes("Communications") ||
      sector.includes("Pharmaceutical") ||
      sector.includes("Electric Machinery"));

  const isValueSector =
    sector &&
    (sector.includes("Bank") ||
      sector.includes("Insurance") ||
      sector.includes("Utilities") ||
      sector.includes("Real Estate"));

  // Adjust thresholds based on sector
  const peThresholds = isHighGrowthSector
    ? [0, 25, 40, 60] // [very low, low, fair, high] for growth sectors
    : isValueSector
    ? [0, 8, 15, 20] // for value sectors
    : [0, 10, 18, 30]; // default

  const pbThresholds = isHighGrowthSector
    ? [0, 2, 4, 6]
    : isValueSector
    ? [0, 0.8, 1.5, 2.5]
    : [0, 1, 2.5, 4];

  // Initialize score components
  let peScore = 0;
  let pbScore = 0;
  let psScore = 0;
  let marketCapScore = 0;
  let growthAdjustment = 0;
  let yieldBonus = 0;

  // Calculate PE Score
  if (peRatio <= 0) {
    peScore = -2; // Negative earnings
  } else if (peRatio <= peThresholds[1]) {
    peScore = 2; // Very low PE
  } else if (peRatio <= peThresholds[2]) {
    peScore = 1; // Low PE
  } else if (peRatio <= peThresholds[3]) {
    peScore = -1; // High PE
  } else {
    peScore = -2; // Very high PE
  }

  // Calculate PB Score
  if (pbRatio <= 0) {
    pbScore = -1; // Negative book value
  } else if (pbRatio < pbThresholds[1]) {
    pbScore = 2; // Very low PB
  } else if (pbRatio <= pbThresholds[2]) {
    pbScore = 1; // Low PB
  } else if (pbRatio <= pbThresholds[3]) {
    pbScore = 0; // Fair PB
  } else {
    pbScore = -1; // High PB
  }

  // P/S ratio evaluation if available
  if (priceToSales > 0) {
    if (isHighGrowthSector) {
      if (priceToSales < 3) psScore = 1;
      else if (priceToSales > 10) psScore = -1;
    } else {
      if (priceToSales < 1) psScore = 1;
      else if (priceToSales > 3) psScore = -1;
    }
  }

  // Market Cap evaluation
  if (marketCap >= 1_000_000_000_000) {
    // Trillion dollar
    marketCapScore = 0.5; // Large stable company
  } else if (marketCap >= 100_000_000_000) {
    // 100B+
    marketCapScore = 0.3;
  } else if (marketCap >= 10_000_000_000) {
    // 10B+
    marketCapScore = 0;
  } else if (marketCap >= 2_000_000_000) {
    // 2B+
    marketCapScore = -0.1;
  } else {
    marketCapScore = -0.3; // Small cap risk
  }

  // Growth adjustment - high growth can justify higher valuations
  if (epsGrowthRate >= 25) {
    growthAdjustment = 1;
  } else if (epsGrowthRate >= 15) {
    growthAdjustment = 0.5;
  } else if (epsGrowthRate <= -10) {
    growthAdjustment = -1;
  } else if (epsGrowthRate < 0) {
    growthAdjustment = -0.5;
  }

  // Dividend yield can add value for income investors
  if (dividendYield >= 4) {
    yieldBonus = 0.5;
  } else if (dividendYield >= 2) {
    yieldBonus = 0.3;
  }

  // Calculate total score with weights
  const totalScore =
    peScore * 1.5 + // PE has highest weight
    pbScore * 1.2 + // PB has second highest
    psScore * 0.8 + // PS has medium weight
    marketCapScore + // Market cap has low weight
    growthAdjustment + // Growth adjustment
    yieldBonus; // Dividend bonus

  // Return rounded score
  return Math.round(totalScore * 10) / 10;
}



function getNumericTier(stock) {
  // Extract numerical scores directly
  const technicalScore = stock.technicalScore || 0;
  const fundamentalScore = stock.fundamentalScore || 0;
  const valuationScore = stock.valuationScore || 0;

  // Apply contextual rules for tier adjustment
  let adjustedScore = technicalScore + fundamentalScore + valuationScore;

  // Special case: Great fundamentals but terrible valuation
  if (fundamentalScore >= 7.5 && valuationScore <= -2) {
    adjustedScore -= 0.5; // Penalize overvalued good companies
  }

  // Special case: Great valuation but terrible fundamentals
  if (valuationScore >= 3.5 && fundamentalScore <= 3) {
    adjustedScore -= 0.5; // Value trap warning
  }

  // Special case: Excellent technical setup with good fundamentals
  if (technicalScore >= 3.5 && fundamentalScore >= 7) {
    adjustedScore += 0.5; // Bonus for alignment
  }

  // Assign tier based on adjusted total score
  if (adjustedScore >= 8) return 1; // TIER 1: Dream
  if (adjustedScore >= 6.5) return 2; // TIER 2: Elite
  if (adjustedScore >= 5) return 3; // TIER 3: Solid
  if (adjustedScore >= 3.5) return 4; // TIER 4: Speculative
  if (adjustedScore >= 2) return 5; // TIER 5: Risky
  return 6; // TIER 6: Red Flag
}




function getEntryTimingScore(stock) {
  // Extract properties with default values
  const {
    currentPrice = 0,
    openPrice = 0,
    highPrice = 0,
    lowPrice = 0,
    prevClosePrice = 0,
    fiftyTwoWeekHigh = 0,
    fiftyTwoWeekLow = 0,
    movingAverage50d = 0,
    movingAverage200d = 0,
    atr14 = 0,
  } = stock;

  // Calculate basic metrics
  const dailyRange = highPrice - lowPrice;
  const percentRange = currentPrice > 0 ? (dailyRange / currentPrice) * 100 : 0;
  const percentFromHigh =
    fiftyTwoWeekHigh > 0
      ? ((fiftyTwoWeekHigh - currentPrice) / fiftyTwoWeekHigh) * 100
      : 0;
  const percentFromLow =
    fiftyTwoWeekLow > 0
      ? ((currentPrice - fiftyTwoWeekLow) / fiftyTwoWeekLow) * 100
      : 0;
  const distanceFrom50d =
    movingAverage50d > 0
      ? ((currentPrice - movingAverage50d) / movingAverage50d) * 100
      : 0;

  // Pattern detection
  const isVolatile =
    percentRange > 5 || (atr14 > 0 && atr14 > currentPrice * 0.03);
  const isExtremeLowVolatility = percentRange < 1.5;
  const nearHigh = percentFromHigh <= 2;
  const veryNearHigh = percentFromHigh <= 1;
  const atAllTimeHigh = currentPrice >= fiftyTwoWeekHigh;
  const nearLow = percentFromLow <= 2;
  const veryNearLow = percentFromLow <= 1;
  const atAllTimeLow = currentPrice <= fiftyTwoWeekLow;

  // Candlestick patterns
  const strongClose =
    currentPrice > openPrice &&
    currentPrice > prevClosePrice &&
    currentPrice - Math.min(openPrice, prevClosePrice) >
      (highPrice - currentPrice) * 2;
  const veryStrongClose =
    strongClose && currentPrice > highPrice - (highPrice - lowPrice) * 0.2;
  const weakClose =
    currentPrice < openPrice &&
    currentPrice < prevClosePrice &&
    Math.max(openPrice, prevClosePrice) - currentPrice >
      (currentPrice - lowPrice) * 2;
  const veryWeakClose =
    weakClose && currentPrice < lowPrice + (highPrice - lowPrice) * 0.2;
  const bullishReversal =
    currentPrice > openPrice &&
    openPrice < prevClosePrice &&
    currentPrice > prevClosePrice;
  const bearishReversal =
    currentPrice < openPrice &&
    openPrice > prevClosePrice &&
    currentPrice < prevClosePrice;
  const doji =
    Math.abs(currentPrice - openPrice) < (highPrice - lowPrice) * 0.1;

  // Moving average relationship
  const aboveMA50 = currentPrice > movingAverage50d;
  const aboveMA200 = currentPrice > movingAverage200d;
  const nearMA50 = Math.abs(distanceFrom50d) < 1;
  const aboveBothMAs = aboveMA50 && aboveMA200;
  const belowBothMAs = !aboveMA50 && !aboveMA200;

  // Compute weighted entry score
  let score = 0;

  // ✅ Bullish signals (positive score)
  if (veryStrongClose) score += 3;
  else if (strongClose) score += 2;

  if (bullishReversal) score += 1.5;

  if (atAllTimeHigh) score += 2;
  else if (veryNearHigh) score += 1.5;
  else if (nearHigh) score += 1;

  if (aboveBothMAs) score += 1.5;
  else if (aboveMA50 && nearMA50) score += 1;

  if (nearMA50 && bullishReversal) score += 0.5;

  // Volatility impacts
  if (!isVolatile && strongClose) score += 1;
  if (isExtremeLowVolatility && currentPrice > prevClosePrice) score -= 0.5; // Too quiet

  // ⚠️ Bearish signals (negative score)
  if (veryWeakClose) score -= 3;
  else if (weakClose) score -= 2;

  if (bearishReversal) score -= 1.5;

  if (atAllTimeLow) score -= 2;
  else if (veryNearLow) score -= 1.5;
  else if (nearLow) score -= 1;

  if (belowBothMAs) score -= 1.5;

  if (isVolatile && weakClose) score -= 1;

  // Special case for doji at key levels
  if (doji) {
    if (nearHigh || nearLow) {
      score += 0; // Neutral impact - waiting for next move
    } else if (aboveBothMAs) {
      score += 0.5; // Slight positive in uptrend
    } else if (belowBothMAs) {
      score -= 0.5; // Slight negative in downtrend
    }
  }

  // Return integer score (1-7)
  if (score >= 4) {
    return 1; // Strong Buy
  }

  if (score >= 2) {
    return 2; // Buy
  }

  if (score >= 0.5) {
    return 3; // Watch
  }

  if (score > -0.5 && score < 0.5) {
    return 4; // Neutral
  }

  if (score >= -2) {
    return 5; // Caution
  }

  if (score >= -4) {
    return 6; // Avoid
  }

  return 7; // Strong Avoid
}



/**
 * Determine Buying Urgency and Risk Level
 */
function getBuyingUrgency(stock) {
  const {
    rsi14,
    macd,
    stochasticK,
    stochasticD,
    currentPrice,
    fiftyTwoWeekLow,
    fiftyTwoWeekHigh
  } = stock;

  // Calculate price position in the 52-week range.
  const pricePositionInRange =
    ((currentPrice - fiftyTwoWeekLow) / (fiftyTwoWeekHigh - fiftyTwoWeekLow)) * 100;

  // Assess market conditions.
  const oversoldCondition = rsi14 < 30;
  const bearishMomentum = macd < 0;
  const lowStochasticValues = stochasticK < 20 && stochasticD < 20;

  // Default urgency and risk settings.
  let urgencyLevel = 'NEUTRAL';
  let riskLevel = 'MODERATE';

  if (oversoldCondition && bearishMomentum && lowStochasticValues) {
    urgencyLevel = 'HIGH_URGENCY';
    riskLevel = 'HIGH_RISK';
  } else if (pricePositionInRange < 20) {
    urgencyLevel = 'MODERATE_URGENCY';
    riskLevel = 'MODERATE_RISK';
  }

  return {
    urgencyLevel,
    riskLevel,
    pricePositionInRange: parseFloat(pricePositionInRange.toFixed(2))
  };
}


function calculateLimitOrderPrice(stock, urgencyLevel) {
  const {
    currentPrice,
    fiftyTwoWeekLow,
    movingAverage50d,
    movingAverage200d,
    bollingerLower
  } = stock;

  let limitOrderPrice;

  if (urgencyLevel === 'HIGH_URGENCY') {
    // Aggressive buying strategy: deeper discount.
    limitOrderPrice = Math.min(
      currentPrice * 0.9,                   // 10% below current price,
      bollingerLower || currentPrice * 0.9,   // lower Bollinger Band (if available),
      movingAverage50d || currentPrice * 0.95 // or 50-day moving average.
    );
  } else if (urgencyLevel === 'MODERATE_URGENCY') {
    // Moderate discount strategy.
    limitOrderPrice = Math.min(
      currentPrice * 0.95,                     // 5% below current price,
      movingAverage50d || currentPrice * 0.97,   // primary support level,
      movingAverage200d || currentPrice * 0.96    // secondary support level.
    );
  } else {
    // Conservative strategy for a neutral market.
    limitOrderPrice = Math.min(
      currentPrice * 0.97,
      movingAverage50d || currentPrice * 0.98
    );
  }

  // Ensure the limit order price is not too low.
  limitOrderPrice = Math.max(
    limitOrderPrice,
    currentPrice * 0.85,      // Prevent excessively low orders.
    fiftyTwoWeekLow * 1.05     // Maintain a price slightly above the 52-week low.
  );

  // Round to 2 decimal places.
  return parseFloat(limitOrderPrice.toFixed(2));
}


function getLimitOrder(stock) {
  // Determine buying urgency.
  const urgencyDetails = getBuyingUrgency(stock);
  
  // Calculate the limit order price using the urgency level.
  const limitOrderPrice = calculateLimitOrderPrice(stock, urgencyDetails.urgencyLevel);
  
  // Return only the limit order price.
  return limitOrderPrice;
}




/***********************************************
 * 6) SCAN LOGIC (Main Workflow)
 ***********************************************/
window.scan = {
  async fetchStockAnalysis() {
    try {
      const tickers = [
{code:"4151.T",sector:"Pharmaceuticals"},
{code:"4502.T",sector:"Pharmaceuticals"},
{code:"4503.T",sector:"Pharmaceuticals"},
{code:"4506.T",sector:"Pharmaceuticals"},
{code:"4507.T",sector:"Pharmaceuticals"},
{code:"4519.T",sector:"Pharmaceuticals"},
{code:"4523.T",sector:"Pharmaceuticals"},
{code:"4568.T",sector:"Pharmaceuticals"},
{code:"4578.T",sector:"Pharmaceuticals"},
{code:"6479.T",sector:"Electric Machinery"},
{code:"6501.T",sector:"Electric Machinery"},
{code:"6503.T",sector:"Electric Machinery"},
{code:"6504.T",sector:"Electric Machinery"},
{code:"6506.T",sector:"Electric Machinery"},
{code:"6526.T",sector:"Electric Machinery"},
{code:"6594.T",sector:"Electric Machinery"},
{code:"6645.T",sector:"Electric Machinery"},
{code:"6674.T",sector:"Electric Machinery"},
{code:"6701.T",sector:"Electric Machinery"},
{code:"6702.T",sector:"Electric Machinery"},
{code:"6723.T",sector:"Electric Machinery"},
{code:"6724.T",sector:"Electric Machinery"},
{code:"6752.T",sector:"Electric Machinery"},
{code:"6753.T",sector:"Electric Machinery"},
{code:"6758.T",sector:"Electric Machinery"},
{code:"6762.T",sector:"Electric Machinery"},
{code:"6770.T",sector:"Electric Machinery"},
{code:"6841.T",sector:"Electric Machinery"},
{code:"6857.T",sector:"Electric Machinery"},
{code:"6861.T",sector:"Electric Machinery"},
{code:"6902.T",sector:"Electric Machinery"},
{code:"6920.T",sector:"Electric Machinery"},
{code:"6952.T",sector:"Electric Machinery"},
{code:"6954.T",sector:"Electric Machinery"},
{code:"6971.T",sector:"Electric Machinery"},
{code:"6976.T",sector:"Electric Machinery"},
{code:"6981.T",sector:"Electric Machinery"},
{code:"7735.T",sector:"Electric Machinery"},
{code:"7751.T",sector:"Electric Machinery"},
{code:"7752.T",sector:"Electric Machinery"},
{code:"8035.T",sector:"Electric Machinery"},
{code:"7201.T",sector:"Automobiles & Auto parts"},
{code:"7202.T",sector:"Automobiles & Auto parts"},
{code:"7203.T",sector:"Automobiles & Auto parts"},
{code:"7205.T",sector:"Automobiles & Auto parts"},
{code:"7211.T",sector:"Automobiles & Auto parts"},
{code:"7261.T",sector:"Automobiles & Auto parts"},
{code:"7267.T",sector:"Automobiles & Auto parts"},
{code:"7269.T",sector:"Automobiles & Auto parts"},
{code:"7270.T",sector:"Automobiles & Auto parts"},
{code:"7272.T",sector:"Automobiles & Auto parts"},
{code:"4543.T",sector:"Precision Instruments"},
{code:"4902.T",sector:"Precision Instruments"},
{code:"6146.T",sector:"Precision Instruments"},
{code:"7731.T",sector:"Precision Instruments"},
{code:"7733.T",sector:"Precision Instruments"},
{code:"7741.T",sector:"Precision Instruments"},
{code:"7762.T",sector:"Precision Instruments"},
{code:"9432.T",sector:"Communications"},
{code:"9433.T",sector:"Communications"},
{code:"9434.T",sector:"Communications"},
{code:"9613.T",sector:"Communications"},
{code:"9984.T",sector:"Communications"},
{code:"5831.T",sector:"Banking"},
{code:"7186.T",sector:"Banking"},
{code:"8304.T",sector:"Banking"},
{code:"8306.T",sector:"Banking"},
{code:"8308.T",sector:"Banking"},
{code:"8309.T",sector:"Banking"},
{code:"8316.T",sector:"Banking"},
{code:"8331.T",sector:"Banking"},
{code:"8354.T",sector:"Banking"},
{code:"8411.T",sector:"Banking"},
{code:"8253.T",sector:"Other Financial Services"},
{code:"8591.T",sector:"Other Financial Services"},
{code:"8697.T",sector:"Other Financial Services"},
{code:"8601.T",sector:"Securities"},
{code:"8604.T",sector:"Securities"},
{code:"8630.T",sector:"Insurance"},
{code:"8725.T",sector:"Insurance"},
{code:"8750.T",sector:"Insurance"},
{code:"8766.T",sector:"Insurance"},
{code:"8795.T",sector:"Insurance"},
{code:"1332.T",sector:"Fishery"},
{code:"2002.T",sector:"Foods"},
{code:"2269.T",sector:"Foods"},
{code:"2282.T",sector:"Foods"},
{code:"2501.T",sector:"Foods"},
{code:"2502.T",sector:"Foods"},
{code:"2503.T",sector:"Foods"},
{code:"2801.T",sector:"Foods"},
{code:"2802.T",sector:"Foods"},
{code:"2871.T",sector:"Foods"},
{code:"2914.T",sector:"Foods"},
{code:"3086.T",sector:"Retail"},
{code:"3092.T",sector:"Retail"},
{code:"3099.T",sector:"Retail"},
{code:"3382.T",sector:"Retail"},
{code:"7453.T",sector:"Retail"},
{code:"8233.T",sector:"Retail"},
{code:"8252.T",sector:"Retail"},
{code:"8267.T",sector:"Retail"},
{code:"9843.T",sector:"Retail"},
{code:"9983.T",sector:"Retail"},
{code:"2413.T",sector:"Services"},
{code:"2432.T",sector:"Services"},
{code:"3659.T",sector:"Services"},
{code:"4307.T",sector:"Services"},
{code:"4324.T",sector:"Services"},
{code:"4385.T",sector:"Services"},
{code:"4661.T",sector:"Services"},
{code:"4689.T",sector:"Services"},
{code:"4704.T",sector:"Services"},
{code:"4751.T",sector:"Services"},
{code:"4755.T",sector:"Services"},
{code:"6098.T",sector:"Services"},
{code:"6178.T",sector:"Services"},
{code:"7974.T",sector:"Services"},
{code:"9602.T",sector:"Services"},
{code:"9735.T",sector:"Services"},
{code:"9766.T",sector:"Services"},
{code:"1605.T",sector:"Mining"},
{code:"3401.T",sector:"Textiles & Apparel"},
{code:"3402.T",sector:"Textiles & Apparel"},
{code:"3861.T",sector:"Pulp & Paper"},
{code:"3405.T",sector:"Chemicals"},
{code:"3407.T",sector:"Chemicals"},
{code:"4004.T",sector:"Chemicals"},
{code:"4005.T",sector:"Chemicals"},
{code:"4021.T",sector:"Chemicals"},
{code:"4042.T",sector:"Chemicals"},
{code:"4043.T",sector:"Chemicals"},
{code:"4061.T",sector:"Chemicals"},
{code:"4063.T",sector:"Chemicals"},
{code:"4183.T",sector:"Chemicals"},
{code:"4188.T",sector:"Chemicals"},
{code:"4208.T",sector:"Chemicals"},
{code:"4452.T",sector:"Chemicals"},
{code:"4901.T",sector:"Chemicals"},
{code:"4911.T",sector:"Chemicals"},
{code:"6988.T",sector:"Chemicals"},
{code:"5019.T",sector:"Petroleum"},
{code:"5020.T",sector:"Petroleum"},
{code:"5101.T",sector:"Rubber"},
{code:"5108.T",sector:"Rubber"},
{code:"5201.T",sector:"Glass & Ceramics"},
{code:"5214.T",sector:"Glass & Ceramics"},
{code:"5233.T",sector:"Glass & Ceramics"},
{code:"5301.T",sector:"Glass & Ceramics"},
{code:"5332.T",sector:"Glass & Ceramics"},
{code:"5333.T",sector:"Glass & Ceramics"},
{code:"5401.T",sector:"Steel"},
{code:"5406.T",sector:"Steel"},
{code:"5411.T",sector:"Steel"},
{code:"3436.T",sector:"Nonferrous Metals"},
{code:"5706.T",sector:"Nonferrous Metals"},
{code:"5711.T",sector:"Nonferrous Metals"},
{code:"5713.T",sector:"Nonferrous Metals"},
{code:"5714.T",sector:"Nonferrous Metals"},
{code:"5801.T",sector:"Nonferrous Metals"},
{code:"5802.T",sector:"Nonferrous Metals"},
{code:"5803.T",sector:"Nonferrous Metals"},
{code:"2768.T",sector:"Trading Companies"},
{code:"8001.T",sector:"Trading Companies"},
{code:"8002.T",sector:"Trading Companies"},
{code:"8015.T",sector:"Trading Companies"},
{code:"8031.T",sector:"Trading Companies"},
{code:"8053.T",sector:"Trading Companies"},
{code:"8058.T",sector:"Trading Companies"},
{code:"1721.T",sector:"Construction"},
{code:"1801.T",sector:"Construction"},
{code:"1802.T",sector:"Construction"},
{code:"1803.T",sector:"Construction"},
{code:"1808.T",sector:"Construction"},
{code:"1812.T",sector:"Construction"},
{code:"1925.T",sector:"Construction"},
{code:"1928.T",sector:"Construction"},
{code:"1963.T",sector:"Construction"},
{code:"5631.T",sector:"Machinery"},
{code:"6103.T",sector:"Machinery"},
{code:"6113.T",sector:"Machinery"},
{code:"6273.T",sector:"Machinery"},
{code:"6301.T",sector:"Machinery"},
{code:"6302.T",sector:"Machinery"},
{code:"6305.T",sector:"Machinery"},
{code:"6326.T",sector:"Machinery"},
{code:"6361.T",sector:"Machinery"},
{code:"6367.T",sector:"Machinery"},
{code:"6471.T",sector:"Machinery"},
{code:"6472.T",sector:"Machinery"},
{code:"6473.T",sector:"Machinery"},
{code:"7004.T",sector:"Machinery"},
{code:"7011.T",sector:"Machinery"},
{code:"7013.T",sector:"Machinery"},
{code:"7012.T",sector:"Shipbuilding"},
{code:"7832.T",sector:"Other Manufacturing"},
{code:"7911.T",sector:"Other Manufacturing"},
{code:"7912.T",sector:"Other Manufacturing"},
{code:"7951.T",sector:"Other Manufacturing"},
{code:"3289.T",sector:"Real Estate"},
{code:"8801.T",sector:"Real Estate"},
{code:"8802.T",sector:"Real Estate"},
{code:"8804.T",sector:"Real Estate"},
{code:"8830.T",sector:"Real Estate"},
{code:"9001.T",sector:"Railway & Bus"},
{code:"9005.T",sector:"Railway & Bus"},
{code:"9007.T",sector:"Railway & Bus"},
{code:"9008.T",sector:"Railway & Bus"},
{code:"9009.T",sector:"Railway & Bus"},
{code:"9020.T",sector:"Railway & Bus"},
{code:"9021.T",sector:"Railway & Bus"},
{code:"9022.T",sector:"Railway & Bus"},
{code:"9064.T",sector:"Land Transport"},
{code:"9147.T",sector:"Land Transport"},
{code:"9101.T",sector:"Marine Transport"},
{code:"9104.T",sector:"Marine Transport"},
{code:"9107.T",sector:"Marine Transport"},
{code:"9201.T",sector:"Air Transport"},
{code:"9202.T",sector:"Air Transport"},
{code:"9301.T",sector:"Warehousing"},
{code:"9501.T",sector:"Electric Power"},
{code:"9502.T",sector:"Electric Power"},
{code:"9503.T",sector:"Electric Power"},
{code:"9531.T",sector:"Gas"},
{code:"9532.T",sector:"Gas"}
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

    // First check if yahooData exists at all
    if (!yahooData) {
      console.error(`Missing Yahoo data for ${code}. Aborting calculation.`);
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
      (field) => yahooData[field] === undefined || yahooData[field] === null
    );

    // Check for zero values (which might indicate failures in calculations)
    const zeroFields = [...criticalFields, ...nonCriticalFields].filter(
      (field) =>
        yahooData[field] !== undefined &&
        yahooData[field] !== null &&
        yahooData[field] === 0 &&
        !["dividendYield", "dividendGrowth5yr", "epsGrowthRate"].includes(field) // Fields that can legitimately be zero
    );

    // Log detailed information
    console.log(`Data validation for ${code}:`);

    if (missingCriticalFields.length > 0) {
      console.error(
        `❌ Missing critical fields: ${missingCriticalFields.join(", ")}`
      );
      throw new Error(
        `Critical Yahoo data is missing: ${missingCriticalFields.join(", ")}`
      );
    }

    if (missingNonCriticalFields.length > 0) {
      console.warn(
        `⚠️ Missing non-critical fields: ${missingNonCriticalFields.join(", ")}`
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

    console.log("prediction: ",prediction);
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
      ((stock.targetPrice - stock.currentPrice) / stock.currentPrice) * 100;

    // 8) Compute fundamental/technical score
    stock.score = computeScore(stock, stock.sector);

    // 9) Combine them => finalScore
    const weights = { metrics: 0.7, growth: 0.3 };
    const finalScore =
      weights.metrics * stock.score + weights.growth * (growthPotential / 100);

    stock.growthPotential = parseFloat(growthPotential.toFixed(2));
    stock.finalScore = parseFloat(finalScore.toFixed(2));
    stock.technicalScore = getTechnicalScore(stock);
    stock.fundamentalScore = getAdvancedFundamentalScore(stock);
    stock.valuationScore = getValuationScore(stock);
    stock.entryTimingScore = getEntryTimingScore(stock);
    stock.tier = getNumericTier(stock);
    stock.limitOrder = getLimitOrder(stock);

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
 * Compute standard deviation of an array
 */
function computeStdDev(arr) {
  const mean = arr.reduce((sum, val) => sum + val, 0) / arr.length;
  const squaredDiffs = arr.map((val) => Math.pow(val - mean, 2));
  return Math.sqrt(
    squaredDiffs.reduce((sum, val) => sum + val, 0) / arr.length
  );
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
 * Compute exponential moving average (EMA)
 */
function computeEMA(arr, window) {
  const k = 2 / (window + 1); // Smoothing factor
  const ema = [arr[0]];

  for (let i = 1; i < arr.length; i++) {
    ema.push(arr[i] * k + ema[i - 1] * (1 - k));
  }

  return ema;
}

/**
 * Compute MACD (Moving Average Convergence Divergence)
 */
function computeMACD(arr, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const fastEMA = computeEMA(arr, fastPeriod);
  const slowEMA = computeEMA(arr, slowPeriod);

  // MACD line = fast EMA - slow EMA
  const macdLine = fastEMA.map((fast, i) => fast - slowEMA[i]);

  // Signal line = EMA of MACD line
  const signalLine = computeEMA(macdLine, signalPeriod);

  // Histogram = MACD line - signal line
  const histogram = macdLine.map((macd, i) => macd - signalLine[i]);

  return { macdLine, signalLine, histogram };
}

/**
 * Compute Relative Strength Index (RSI)
 */
function computeRSI(prices, window = 14) {
  if (prices.length <= window) {
    return Array(prices.length).fill(50); // Default to neutral RSI if not enough data
  }

  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  const rsi = [50]; // First value defaults to neutral

  for (let i = window; i < changes.length; i++) {
    const windowChanges = changes.slice(i - window, i);

    const gains = windowChanges.filter((change) => change > 0);
    const losses = windowChanges
      .filter((change) => change < 0)
      .map((change) => Math.abs(change));

    const avgGain = gains.length
      ? gains.reduce((sum, val) => sum + val, 0) / window
      : 0;
    const avgLoss = losses.length
      ? losses.reduce((sum, val) => sum + val, 0) / window
      : 0;

    if (avgLoss === 0) {
      rsi.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsi.push(100 - 100 / (1 + rs));
    }
  }

  // Pad the beginning with the first calculated RSI value
  while (rsi.length < prices.length) {
    rsi.unshift(rsi[0]);
  }

  return rsi;
}

/**
 * Compute Bollinger Bands
 */
function computeBollingerBands(prices, window = 20, numStdDev = 2) {
  const sma = computeSMA(prices, window);
  const bands = [];

  for (let i = 0; i < prices.length; i++) {
    const start = Math.max(0, i - window + 1);
    const windowSlice = prices.slice(start, i + 1);
    const stdDev = computeStdDev(windowSlice);

    bands.push({
      middle: sma[i],
      upper: sma[i] + numStdDev * stdDev,
      lower: sma[i] - numStdDev * stdDev,
    });
  }

  return bands;
}

/**
 * Compute Average True Range (ATR) - a volatility indicator
 */
function computeATR(prices, high, low, period = 14) {
  if (!high || !low) {
    // If high/low not provided, approximate using the price
    high = prices;
    low = prices;
  }

  const trueRanges = [];

  // First true range is simply the high - low
  trueRanges.push(high[0] - low[0]);

  // Calculate subsequent true ranges
  for (let i = 1; i < prices.length; i++) {
    const trueHigh = Math.max(high[i], prices[i - 1]);
    const trueLow = Math.min(low[i], prices[i - 1]);
    trueRanges.push(trueHigh - trueLow);
  }

  // Calculate ATR using EMA
  const atr = [trueRanges[0]];
  for (let i = 1; i < trueRanges.length; i++) {
    atr.push((atr[i - 1] * (period - 1) + trueRanges[i]) / period);
  }

  return atr;
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

/**
 * Calculate annualized volatility based on log returns
 */
function computeVolatility(logReturns, daysInYear = 252) {
  const stdDev = computeStdDev(logReturns.slice(1)); // Skip first zero return
  return stdDev * Math.sqrt(daysInYear);
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

function prepareDataFor30DayAheadPrice(
  data,
  sequenceLength = 30,
  predictionGap = 30
) {
  if (data.length < sequenceLength + predictionGap) {
    throw new Error(`Not enough data to create sequences for prediction.`);
  }

  // Extract raw arrays.
  const prices = data.map((item) => item.price);
  const volumes = data.map((item) => item.volume);

  // Convert prices to log scale.
  const logPrices = prices.map((p) => Math.log(p));

  // Compute additional features on log scale.
  const sma7 = computeSMA(logPrices, 7);
  const sma20 = computeSMA(logPrices, 20);
  const sma50 = computeSMA(logPrices, 50);
  const dailyLogReturn = computeDailyLogReturn(logPrices);

  // Calculate volatility
  const volatility = [];
  const volWindow = 20;
  for (let i = 0; i < dailyLogReturn.length; i++) {
    const start = Math.max(0, i - volWindow + 1);
    const windowReturns = dailyLogReturn.slice(start, i + 1);
    const vol = computeStdDev(windowReturns) * Math.sqrt(252); // Annualize
    volatility.push(vol);
  }

  // Compute RSI
  const rsi = computeRSI(prices);

  // Compute price momentum: 30-day return
  const momentum = [];
  for (let i = 0; i < prices.length; i++) {
    const lookback = Math.max(0, i - 30);
    momentum.push(Math.log(prices[i] / prices[lookback]));
  }

  // Calculate price relative to 50-day SMA (a technical indicator)
  const priceToSMA = [];
  for (let i = 0; i < prices.length; i++) {
    priceToSMA.push(Math.log(prices[i]) - sma50[i]);
  }

  // Use training portion (excluding prediction gap) to compute robust parameters
  const trainLen = data.length - predictionGap;
  const trainLogPricesRaw = logPrices.slice(0, trainLen);
  const trainVolumesRaw = volumes.slice(0, trainLen);
  const trainSMA7_raw = sma7.slice(0, trainLen);
  const trainSMA20_raw = sma20.slice(0, trainLen);
  const trainReturnRaw = dailyLogReturn.slice(0, trainLen);
  const trainVolatilityRaw = volatility.slice(0, trainLen);
  const trainRSI_raw = rsi.slice(0, trainLen);
  const trainMomentumRaw = momentum.slice(0, trainLen);
  const trainPriceToSMA_raw = priceToSMA.slice(0, trainLen);

  // Winsorize each feature to remove extreme outliers
  const {
    winsorized: trainLogPrices,
    lower: lowerLogPrice,
    upper: upperLogPrice,
  } = winsorizeArray(trainLogPricesRaw, 0.01, 0.99); // Tighter bounds for Nikkei

  const {
    winsorized: trainVolumes,
    lower: lowerVolume,
    upper: upperVolume,
  } = winsorizeArray(trainVolumesRaw, 0.01, 0.99);

  const {
    winsorized: trainSMA7,
    lower: lowerSMA7,
    upper: upperSMA7,
  } = winsorizeArray(trainSMA7_raw, 0.01, 0.99);

  const {
    winsorized: trainSMA20,
    lower: lowerSMA20,
    upper: upperSMA20,
  } = winsorizeArray(trainSMA20_raw, 0.01, 0.99);

  const {
    winsorized: trainReturn,
    lower: lowerReturn,
    upper: upperReturn,
  } = winsorizeArray(trainReturnRaw, 0.01, 0.99);

  const {
    winsorized: trainVolatility,
    lower: lowerVolatility,
    upper: upperVolatility,
  } = winsorizeArray(trainVolatilityRaw, 0.01, 0.99);

  const {
    winsorized: trainRSI,
    lower: lowerRSI,
    upper: upperRSI,
  } = winsorizeArray(trainRSI_raw, 0.05, 0.95);

  const {
    winsorized: trainMomentum,
    lower: lowerMomentum,
    upper: upperMomentum,
  } = winsorizeArray(trainMomentumRaw, 0.01, 0.99);

  const {
    winsorized: trainPriceToSMA,
    lower: lowerPriceToSMA,
    upper: upperPriceToSMA,
  } = winsorizeArray(trainPriceToSMA_raw, 0.01, 0.99);

  // Compute robust statistics on winsorized training data.
  const medianLogPrice = computeMedian(trainLogPrices);
  const iqrLogPrice = computeIQR(trainLogPrices);
  const medianVolume = computeMedian(trainVolumes);
  const iqrVolume = computeIQR(trainVolumes);
  const medianSMA7 = computeMedian(trainSMA7);
  const iqrSMA7 = computeIQR(trainSMA7);
  const medianSMA20 = computeMedian(trainSMA20);
  const iqrSMA20 = computeIQR(trainSMA20);
  const medianReturn = computeMedian(trainReturn);
  const iqrReturn = computeIQR(trainReturn);
  const medianVolatility = computeMedian(trainVolatility);
  const iqrVolatility = computeIQR(trainVolatility);
  const medianRSI = computeMedian(trainRSI);
  const iqrRSI = computeIQR(trainRSI);
  const medianMomentum = computeMedian(trainMomentum);
  const iqrMomentum = computeIQR(trainMomentum);
  const medianPriceToSMA = computeMedian(trainPriceToSMA);
  const iqrPriceToSMA = computeIQR(trainPriceToSMA);

  // Store winsorization bounds.
  const metaBounds = {
    logPrice: { lower: lowerLogPrice, upper: upperLogPrice },
    volume: { lower: lowerVolume, upper: upperVolume },
    sma7: { lower: lowerSMA7, upper: upperSMA7 },
    sma20: { lower: lowerSMA20, upper: upperSMA20 },
    return: { lower: lowerReturn, upper: upperReturn },
    volatility: { lower: lowerVolatility, upper: upperVolatility },
    rsi: { lower: lowerRSI, upper: upperRSI },
    momentum: { lower: lowerMomentum, upper: upperMomentum },
    priceToSMA: { lower: lowerPriceToSMA, upper: upperPriceToSMA },
  };

  // Helper normalization function: winsorize first, then robust normalize.
  const normalize = (val, median, iqr, lower, upper) =>
    (winsorizeVal(val, lower, upper) - median) / (iqr || 1);

  // Calculate historical returns distribution for 30-day horizon
  const thirtyDayLogReturns = [];
  for (let i = 0; i <= data.length - 30; i++) {
    thirtyDayLogReturns.push(Math.log(prices[i + 30 - 1] / prices[i]));
  }

  // Calculate 95th, 99th percentiles for both upside and downside
  const maxUpside = computePercentile(thirtyDayLogReturns, 0.99);
  const maxDownside = computePercentile(thirtyDayLogReturns, 0.01);

  // Store these bounds for constraining predictions later
  const returnConstraints = {
    maxLogReturn: maxUpside,
    minLogReturn: maxDownside,
  };

  const inputs = [];
  const outputs = [];

  // Build training sequences.
  for (let i = 0; i <= data.length - sequenceLength - predictionGap; i++) {
    const seq = [];
    for (let j = 0; j < sequenceLength; j++) {
      const idx = i + j;
      seq.push([
        // Log price (normalized)
        normalize(
          Math.log(prices[idx]),
          medianLogPrice,
          iqrLogPrice,
          lowerLogPrice,
          upperLogPrice
        ),
        // Volume (normalized)
        normalize(
          volumes[idx],
          medianVolume,
          iqrVolume,
          lowerVolume,
          upperVolume
        ),
        // 7-day SMA (normalized)
        normalize(sma7[idx], medianSMA7, iqrSMA7, lowerSMA7, upperSMA7),
        // 20-day SMA (normalized)
        normalize(sma20[idx], medianSMA20, iqrSMA20, lowerSMA20, upperSMA20),
        // Daily log return (normalized)
        normalize(
          dailyLogReturn[idx],
          medianReturn,
          iqrReturn,
          lowerReturn,
          upperReturn
        ),
        // Volatility (normalized)
        normalize(
          volatility[idx],
          medianVolatility,
          iqrVolatility,
          lowerVolatility,
          upperVolatility
        ),
        // RSI (normalized)
        normalize(rsi[idx], medianRSI, iqrRSI, lowerRSI, upperRSI),
        // Momentum (normalized)
        normalize(
          momentum[idx],
          medianMomentum,
          iqrMomentum,
          lowerMomentum,
          upperMomentum
        ),
        // Price to SMA (normalized)
        normalize(
          priceToSMA[idx],
          medianPriceToSMA,
          iqrPriceToSMA,
          lowerPriceToSMA,
          upperPriceToSMA
        ),
      ]);
    }
    inputs.push(seq);

    // Target: logPrice 30 days after sequence end
    const targetLogPrice = Math.log(
      prices[i + sequenceLength + predictionGap - 1]
    );
    outputs.push(
      normalize(
        targetLogPrice,
        medianLogPrice,
        iqrLogPrice,
        lowerLogPrice,
        upperLogPrice
      )
    );
  }

  // Convert inputs and outputs to tensors.
  const inputTensor = tf.tensor3d(inputs, [inputs.length, sequenceLength, 9]); // 9 features
  const outputTensor = tf.tensor2d(outputs, [outputs.length, 1]);

  const meta = {
    medianLogPrice,
    iqrLogPrice,
    medianVolume,
    iqrVolume,
    medianSMA7,
    iqrSMA7,
    medianSMA20,
    iqrSMA20,
    medianReturn,
    iqrReturn,
    medianVolatility,
    iqrVolatility,
    medianRSI,
    iqrRSI,
    medianMomentum,
    iqrMomentum,
    medianPriceToSMA,
    iqrPriceToSMA,
    bounds: metaBounds,
    returnConstraints,
    // Save the last known actual price.
    lastKnownPrice: prices[prices.length - 1],
    // Save historical volatility for realistic predictions
    historicalVolatility: computeVolatility(dailyLogReturn),
  };

  return { inputTensor, outputTensor, meta };
}

/**
 * Creates an ensemble of models with different architectures
 */
async function createModelEnsemble(inputShape, numModels = 3) {
  const models = [];

  // Model 1: LSTM model
  const model1 = tf.sequential();
  model1.add(
    tf.layers.lstm({
      units: 64,
      inputShape,
      returnSequences: false,
      kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
      recurrentRegularizer: tf.regularizers.l2({ l2: 0.01 }),
      dropout: 0.2,
      recurrentDropout: 0.2,
    })
  );
  model1.add(tf.layers.dropout({ rate: 0.2 }));
  model1.add(tf.layers.dense({ units: 32, activation: "relu" }));
  model1.add(tf.layers.dense({ units: 1 }));

  // Model 2: GRU model (alternative RNN architecture)
  const model2 = tf.sequential();
  model2.add(
    tf.layers.gru({
      units: 64,
      inputShape,
      returnSequences: true,
      kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
      recurrentRegularizer: tf.regularizers.l2({ l2: 0.01 }),
      dropout: 0.3,
    })
  );
  model2.add(
    tf.layers.gru({
      units: 32,
      returnSequences: false,
      kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
      recurrentRegularizer: tf.regularizers.l2({ l2: 0.01 }),
    })
  );
  model2.add(tf.layers.dense({ units: 1 }));

  // Model 3: ConvLSTM model (with CNN feature extraction)
  const model3 = tf.sequential();
  model3.add(
    tf.layers.conv1d({
      filters: 32,
      kernelSize: 3,
      activation: "relu",
      inputShape,
    })
  );
  model3.add(tf.layers.maxPooling1d({ poolSize: 2 }));
  model3.add(
    tf.layers.lstm({
      units: 48,
      returnSequences: false,
      kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
    })
  );
  model3.add(tf.layers.dropout({ rate: 0.2 }));
  model3.add(tf.layers.dense({ units: 1 }));

  models.push(model1, model2, model3);

  // Compile all models
  models.forEach((model) => {
    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: customHuberLoss(0.8),
    });
  });

  return models;
}

/**
 * Trains an ensemble of models for 30-day ahead price prediction.
 */
async function trainModelFor30DayAheadPrice(data) {
  const sequenceLength = 30;
  const predictionGap = 30;
  const { inputTensor, outputTensor, meta } = prepareDataFor30DayAheadPrice(
    data,
    sequenceLength,
    predictionGap
  );

  const inputShape = [sequenceLength, 9]; // 9 features
  const models = await createModelEnsemble(inputShape);

  console.log(
    "Training ensemble of models for 30-day ahead prediction with enhanced features..."
  );

  const trainedModels = [];
  for (let i = 0; i < models.length; i++) {
    console.log(`Training model ${i + 1}/${models.length}...`);

    const earlyStopping = tf.callbacks.earlyStopping({
      monitor: "val_loss",
      patience: 8,
      minDelta: 0.001,
    });

    await models[i].fit(inputTensor, outputTensor, {
      epochs: 100,
      batchSize: 32,
      validationSplit: 0.2,
      callbacks: [earlyStopping],
      shuffle: true,
    });

    trainedModels.push(models[i]);
  }

  console.log("Ensemble training completed.");

  return { models: trainedModels, meta };
}

/**
 * Predicts the stock price 30 days ahead using the ensemble of trained models.
 * Applies realistic constraints based on historical volatility.
 */
async function predict30DayAheadPrice(modelObj, data) {
  const { models, meta } = modelObj;
  const {
    medianLogPrice,
    iqrLogPrice,
    medianVolume,
    iqrVolume,
    medianSMA7,
    iqrSMA7,
    medianSMA20,
    iqrSMA20,
    medianReturn,
    iqrReturn,
    medianVolatility,
    iqrVolatility,
    medianRSI,
    iqrRSI,
    medianMomentum,
    iqrMomentum,
    medianPriceToSMA,
    iqrPriceToSMA,
    bounds,
    returnConstraints,
    lastKnownPrice,
    historicalVolatility,
  } = meta;
  const sequenceLength = 30;

  try {
    // Extract recent data.
    const recentData = data.slice(-sequenceLength);
    const recentPrices = recentData.map((item) => item.price);
    const recentVolumes = recentData.map((item) => item.volume);

    // Compute logPrices and other features for recent data
    const recentLogPrices = recentPrices.map((p) => Math.log(p));
    const sma7Recent = computeSMA(recentLogPrices, 7);
    const sma20Recent = computeSMA(recentLogPrices, 20);
    const sma50Recent = computeSMA(recentLogPrices, 50);
    const returnRecent = computeDailyLogReturn(recentLogPrices);

    // Calculate volatility for recent data
    const volatilityRecent = [];
    const volWindow = 20;
    for (let i = 0; i < returnRecent.length; i++) {
      const start = Math.max(0, i - volWindow + 1);
      const windowReturns = returnRecent.slice(start, i + 1);
      const vol = computeStdDev(windowReturns) * Math.sqrt(252); // Annualize
      volatilityRecent.push(vol);
    }

    // Calculate RSI
    const rsiRecent = computeRSI(recentPrices);

    // Calculate momentum
    const momentumRecent = [];
    for (let i = 0; i < recentPrices.length; i++) {
      const lookback = Math.max(0, i - 30);
      momentumRecent.push(Math.log(recentPrices[i] / recentPrices[lookback]));
    }

    // Calculate price relative to 50-day SMA
    const priceToSMARecent = [];
    for (let i = 0; i < recentPrices.length; i++) {
      priceToSMARecent.push(Math.log(recentPrices[i]) - sma50Recent[i]);
    }

    // Create the normalized sequence for prediction
    const normSeq = recentData.map((item, idx) => [
      // Log price (normalized)
      (winsorizeVal(
        Math.log(item.price),
        bounds.logPrice.lower,
        bounds.logPrice.upper
      ) -
        medianLogPrice) /
        (iqrLogPrice || 1),
      // Volume (normalized)
      (winsorizeVal(item.volume, bounds.volume.lower, bounds.volume.upper) -
        medianVolume) /
        (iqrVolume || 1),
      // 7-day SMA (normalized)
      (winsorizeVal(sma7Recent[idx], bounds.sma7.lower, bounds.sma7.upper) -
        medianSMA7) /
        (iqrSMA7 || 1),
      // 20-day SMA (normalized)
      (winsorizeVal(sma20Recent[idx], bounds.sma20.lower, bounds.sma20.upper) -
        medianSMA20) /
        (iqrSMA20 || 1),
      // Return (normalized)
      (winsorizeVal(
        returnRecent[idx],
        bounds.return.lower,
        bounds.return.upper
      ) -
        medianReturn) /
        (iqrReturn || 1),
      // Volatility (normalized)
      (winsorizeVal(
        volatilityRecent[idx],
        bounds.volatility.lower,
        bounds.volatility.upper
      ) -
        medianVolatility) /
        (iqrVolatility || 1),
      // RSI (normalized)
      (winsorizeVal(rsiRecent[idx], bounds.rsi.lower, bounds.rsi.upper) -
        medianRSI) /
        (iqrRSI || 1),
      // Momentum (normalized)
      (winsorizeVal(
        momentumRecent[idx],
        bounds.momentum.lower,
        bounds.momentum.upper
      ) -
        medianMomentum) /
        (iqrMomentum || 1),
      // Price to SMA (normalized)
      (winsorizeVal(
        priceToSMARecent[idx],
        bounds.priceToSMA.lower,
        bounds.priceToSMA.upper
      ) -
        medianPriceToSMA) /
        (iqrPriceToSMA || 1),
    ]);

    const inputTensor = tf.tensor3d([normSeq], [1, sequenceLength, 9]);

    // Get predictions from each model
    const predictions = [];
    let validPredictions = 0;

    for (const model of models) {
      try {
        const predNormLogPrice = model.predict(inputTensor).dataSync()[0];

        // Only add prediction if it's a valid number
        if (!isNaN(predNormLogPrice) && isFinite(predNormLogPrice)) {
          predictions.push(predNormLogPrice);
          validPredictions++;
        }
      } catch (err) {
        console.warn("Error in model prediction:", err.message);
        // Continue with other models
      }
    }

    // If we don't have any valid predictions, use a fallback approach
    if (validPredictions === 0) {
      console.warn(
        "No valid predictions from any model. Using trend-based fallback method."
      );

      // Simple fallback: Use recent trend (last 30 days) with dampening
      const startPrice = recentPrices[0];
      const endPrice = recentPrices[recentPrices.length - 1];
      const recentTrendPercent = (endPrice / startPrice - 1) * 100;

      // Dampen the trend by 0.5 (assume trend continues but weaker)
      const predictedChangePercent = recentTrendPercent * 0.5;

      // Apply strict bounds for fallback prediction (max 5% for Nikkei)
      const boundedChange = Math.max(Math.min(predictedChangePercent, 5), -5);
      const predictedPrice = lastKnownPrice * (1 + boundedChange / 100);

      return {
        predictedPrice,
        percentChange: boundedChange,
        currentPrice: lastKnownPrice,
        confidence: {
          isNonModelFallback: true,
          monthlyVolatility: historicalVolatility * Math.sqrt(30 / 252) * 100,
          maxAllowedMove: 5,
        },
      };
    }

    // Average the valid ensemble predictions
    const avgPredNormLogPrice =
      predictions.reduce((a, b) => a + b, 0) / validPredictions;

    // Inverse transformation: get predicted log-price
    const predictedLogPrice =
      avgPredNormLogPrice * iqrLogPrice + medianLogPrice;

    // Apply realistic constraints based on historical volatility and market behavior
    const currentLogPrice = Math.log(lastKnownPrice);

    // Calculate the predicted return
    let predictedReturn = predictedLogPrice - currentLogPrice;

    // Check for NaN or infinite values and replace with safe defaults
    if (isNaN(predictedReturn) || !isFinite(predictedReturn)) {
      console.warn("Invalid predicted return. Using 0% change as fallback.");
      predictedReturn = 0;
    }

    // Apply constraints based on historical return bounds
    predictedReturn = Math.min(
      Math.max(predictedReturn, returnConstraints.minLogReturn),
      returnConstraints.maxLogReturn
    );

    // Apply additional volatility-based constraints (tighter for Nikkei stocks)
    // Max monthly change = ±2.5 * monthly volatility
    const monthlyVolatility = historicalVolatility * Math.sqrt(30 / 252); // Convert annual to monthly
    const maxMonthlyMove = 2.5 * monthlyVolatility;

    // Apply the tighter bound for Nikkei stocks (known for lower volatility)
    predictedReturn = Math.min(
      Math.max(predictedReturn, -maxMonthlyMove),
      maxMonthlyMove
    );

    // Special case for extremely high/low volatility
    if (isNaN(maxMonthlyMove) || !isFinite(maxMonthlyMove)) {
      console.warn("Invalid volatility calculation. Using fixed ±5% bounds.");
      predictedReturn = Math.min(Math.max(predictedReturn, -0.05), 0.05);
    }

    // Re-calculate predicted log price with constraints
    const constrainedLogPrice = currentLogPrice + predictedReturn;

    // Exponentiate to get the actual price prediction
    let predictedPrice = Math.exp(constrainedLogPrice);

    // Final check for NaN or infinity
    if (isNaN(predictedPrice) || !isFinite(predictedPrice)) {
      console.warn(
        "Final prediction is invalid. Using current price as fallback."
      );
      predictedPrice = lastKnownPrice;
      predictedReturn = 0;
    }

    // Calculate predicted percent change for logging
    const percentChange = (predictedPrice / lastKnownPrice - 1) * 100;

    console.log(`Current price: ${lastKnownPrice.toFixed(2)}`);
    console.log(
      `Predicted price in 30 days: ${predictedPrice.toFixed(
        2
      )} (${percentChange.toFixed(2)}%)`
    );
    console.log(`Monthly volatility: ${(monthlyVolatility * 100).toFixed(2)}%`);
    console.log(
      `Maximum allowed monthly move: ±${(maxMonthlyMove * 100).toFixed(2)}%`
    );

    return {
      predictedPrice,
      percentChange,
      currentPrice: lastKnownPrice,
      confidence: {
        monthlyVolatility: monthlyVolatility * 100,
        maxAllowedMove: maxMonthlyMove * 100,
      },
    };
  } catch (error) {
    console.error("Error in prediction:", error.message);
    // If any error occurs in the prediction process, return a safe fallback (0% change)
    return {
      predictedPrice: lastKnownPrice,
      percentChange: 0,
      currentPrice: lastKnownPrice,
      confidence: {
        isErrorFallback: true,
      },
    };
  }
}

export async function analyzeStock(ticker, historicalData) {
  try {
    // Pre-process data to ensure no NaN values
    const cleanData = historicalData.filter(
      (item) =>
        item &&
        item.price !== undefined &&
        !isNaN(item.price) &&
        item.volume !== undefined &&
        !isNaN(item.volume)
    );

    if (cleanData.length < historicalData.length) {
      console.log(
        `Filtered out ${
          historicalData.length - cleanData.length
        } invalid data points for ${ticker}`
      );
    }

    if (cleanData.length < 30) {
      console.warn(`Insufficient data for reliable prediction on ${ticker}`);
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

    // Calculate basic statistics
    const prices = cleanData.map((item) => item.price);
    const currentPrice = prices[prices.length - 1];

    try {
      // If we have enough data for full model training
      if (cleanData.length >= 365) {
        const modelObj = await trainModelFor30DayAheadPrice(cleanData);
        const prediction = await predict30DayAheadPrice(modelObj, cleanData);

        // Apply Nikkei-specific constraints if needed
        if (isNikkeiStock && prediction.percentChange > 15) {
          console.log(
            "Applying Nikkei-specific constraint (max 15% monthly change)"
          );
          return currentPrice * 1.15; // Cap at 15% increase
        }

        // Final validation on prediction result
        if (
          isNaN(prediction.predictedPrice) ||
          !isFinite(prediction.predictedPrice)
        ) {
          console.warn("Invalid prediction result. Using current price.");
          return currentPrice;
        }

        return prediction.predictedPrice;
      } else {
        // Simple trend-based prediction for limited data
        const lookbackPeriod = Math.min(30, prices.length - 1);
        const priorPrice = prices[prices.length - 1 - lookbackPeriod];
        const recentTrendPercent = (currentPrice / priorPrice - 1) * 100;

        // Apply dampening and constraints
        const maxChange = isNikkeiStock ? 10 : 15; // More conservative for Nikkei
        const predictedChangePercent = Math.max(
          Math.min(recentTrendPercent * 0.3, maxChange),
          -maxChange
        );

        return currentPrice * (1 + predictedChangePercent / 100);
      }
    } catch (modelError) {
      console.error("Error in prediction model:", modelError.message);
      return currentPrice; // Return current price as fallback
    }
  } catch (error) {
    console.error(`Error analyzing stock for ${ticker}:`, error.message);

    // Safe fallback if available
    if (historicalData && historicalData.length > 0) {
      const lastValidPrice = historicalData
        .filter((item) => item && item.price && !isNaN(item.price))
        .map((item) => item.price)
        .pop();

      return lastValidPrice || null;
    }
    return null;
  }
}