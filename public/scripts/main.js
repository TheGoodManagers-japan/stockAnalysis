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

    // 10) Send data in Bubble key format
 const stockObject = {
   _api_c2_ticker: stock.ticker,
   _api_c2_sector: stock.sector,
   _api_c2_currentPrice: stock.currentPrice,
   _api_c2_entryTimingScore: stock.entryTimingScore,
   _api_c2_predictedPrediction: stock.prediction,
   _api_c2_stopLoss: stock.stopLoss,
   _api_c2_targetPrice: stock.targetPrice,
   _api_c2_growthPotential: stock.growthPotential,
   _api_c2_score: stock.score,
   _api_c2_finalScore: stock.finalScore,
   _api_c2_tier: stock.tier,

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
/**
 * Modified version of the stock price prediction model with fixes for unrealistic predictions
 */

function computeMedian(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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
  return { winsorized: arr.map(x => winsorizeVal(x, lower, upper)), lower, upper };
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

/**
 * Compute monthly log returns from log prices
 */
function computeMonthlyLogReturns(logPrices, period = 30) {
  const monthlyReturns = [];
  for (let i = period; i < logPrices.length; i++) {
    monthlyReturns.push(logPrices[i] - logPrices[i - period]);
  }
  return monthlyReturns;
}

/**
 * Calculate statistical volatility (standard deviation of returns)
 */
function calculateVolatility(returns) {
  const mean = returns.reduce((sum, val) => sum + val, 0) / returns.length;
  const squaredDiffs = returns.map(val => Math.pow(val - mean, 2));
  const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / returns.length;
  return Math.sqrt(variance);
}

/**
 * Modified Huber loss function for robustness against outliers
 */
function customHuberLoss(delta = 1.0) {
  return function(yTrue, yPred) {
    const error = yTrue.sub(yPred).abs();
    const quadratic = tf.minimum(error, delta);
    const linear = error.sub(quadratic);
    return tf.add(tf.mul(0.5, tf.square(quadratic)), tf.mul(delta, linear)).mean();
  };
}

/**
 * Improved Stock Analysis Module with NaN Protection
 * 
 * This code enhances the stock analysis model to prevent NaN issues in prediction
 * by adding comprehensive error handling, validation, and fallback mechanisms.
 */

/**
 * Fixed implementation of prepareDataFor30DayAheadPrice function
 * Added safeguards against NaN, division by zero, and invalid data
 */
function prepareDataFor30DayAheadPrice(data, sequenceLength, predictionGap) {
  // Filter out invalid data points
  const validData = data.filter(item => 
    typeof item.price === 'number' && 
    !isNaN(item.price) && 
    item.price > 0 &&
    typeof item.volume === 'number' && 
    !isNaN(item.volume) && 
    item.volume >= 0
  );
  
  if (validData.length < data.length) {
    console.warn(`Filtered out ${data.length - validData.length} invalid data points`);
  }
  
  // Extract features
  const prices = validData.map(item => item.price);
  const volumes = validData.map(item => item.volume);
  
  // Calculate log prices with safety check
  const logPrices = prices.map(p => {
    try {
      return Math.log(Math.max(p, 0.001)); // Ensure non-zero positive value
    } catch (e) {
      console.warn("Error calculating log price:", e);
      return 0;
    }
  });
  
  // Calculate technical indicators
  const sma7 = computeSMA(logPrices, 7);
  const sma20 = computeSMA(logPrices, 20);
  const sma50 = computeSMA(logPrices, 50);
  const returns = computeDailyLogReturn(logPrices);
  
  // Calculate volatility features
  const vol10 = [];
  const vol30 = [];
  
  for (let i = 0; i < logPrices.length; i++) {
    const start10 = Math.max(0, i - 10 + 1);
    const start30 = Math.max(0, i - 30 + 1);
    
    const v10 = calculateVolatility(returns.slice(start10, i + 1)) || 0;
    const v30 = calculateVolatility(returns.slice(start30, i + 1)) || 0;
    
    vol10.push(v10);
    vol30.push(v30);
  }
  
  // Winsorize features to handle outliers
  const { winsorized: wLogPrices, lower: lowerLogPrice, upper: upperLogPrice } = winsorizeArray(logPrices);
  const { winsorized: wVolumes, lower: lowerVolume, upper: upperVolume } = winsorizeArray(volumes);
  const { winsorized: wSMA7, lower: lowerSMA7, upper: upperSMA7 } = winsorizeArray(sma7);
  const { winsorized: wSMA20, lower: lowerSMA20, upper: upperSMA20 } = winsorizeArray(sma20);
  const { winsorized: wSMA50, lower: lowerSMA50, upper: upperSMA50 } = winsorizeArray(sma50);
  const { winsorized: wReturns, lower: lowerReturn, upper: upperReturn } = winsorizeArray(returns);
  const { winsorized: wVol10, lower: lowerVol10, upper: upperVol10 } = winsorizeArray(vol10);
  const { winsorized: wVol30, lower: lowerVol30, upper: upperVol30 } = winsorizeArray(vol30);
  
  // Calculate normalization parameters
  const medianLogPrice = computeMedian(wLogPrices);
  const iqrLogPrice = Math.max(computeIQR(wLogPrices), 0.00001); // Prevent division by zero
  
  const medianVolume = computeMedian(wVolumes);
  const iqrVolume = Math.max(computeIQR(wVolumes), 0.00001);
  
  const medianSMA7 = computeMedian(wSMA7);
  const iqrSMA7 = Math.max(computeIQR(wSMA7), 0.00001);
  
  const medianSMA20 = computeMedian(wSMA20);
  const iqrSMA20 = Math.max(computeIQR(wSMA20), 0.00001);
  
  const medianSMA50 = computeMedian(wSMA50);
  const iqrSMA50 = Math.max(computeIQR(wSMA50), 0.00001);
  
  const medianReturn = computeMedian(wReturns);
  const iqrReturn = Math.max(computeIQR(wReturns), 0.00001);
  
  const medianVol10 = computeMedian(wVol10);
  const iqrVol10 = Math.max(computeIQR(wVol10), 0.00001);
  
  const medianVol30 = computeMedian(wVol30);
  const iqrVol30 = Math.max(computeIQR(wVol30), 0.00001);
  
  // Bounds for constraining prediction - with safety checks
  const monthlyLogReturns = computeMonthlyLogReturns(logPrices);
  
  let minMonthlyReturn = -0.5; // Default fallback (about -40%)
  let maxMonthlyReturn = 0.5;  // Default fallback (about +65%)
  
  if (monthlyLogReturns && monthlyLogReturns.length > 0) {
    try {
      minMonthlyReturn = Math.max(Math.min(...monthlyLogReturns.filter(v => !isNaN(v))), -0.5);
      maxMonthlyReturn = Math.min(Math.max(...monthlyLogReturns.filter(v => !isNaN(v))), 0.5);
    } catch (e) {
      console.warn("Error calculating monthly return bounds:", e);
    }
  }
  
  // Create sequences for training - with safety checks
  const sequences = [];
  const targets = [];
  
  for (let i = 0; i < validData.length - sequenceLength - predictionGap; i++) {
    const sequence = [];
    
    let hasInvalidValues = false;
    
    for (let j = 0; j < sequenceLength; j++) {
      const idx = i + j;
      
      try {
        // Normalize with safety checks
        const normalizedFeatures = [
          (winsorizeVal(logPrices[idx], lowerLogPrice, upperLogPrice) - medianLogPrice) / iqrLogPrice,
          (winsorizeVal(volumes[idx], lowerVolume, upperVolume) - medianVolume) / iqrVolume,
          (winsorizeVal(sma7[idx], lowerSMA7, upperSMA7) - medianSMA7) / iqrSMA7,
          (winsorizeVal(sma20[idx], lowerSMA20, upperSMA20) - medianSMA20) / iqrSMA20,
          (winsorizeVal(sma50[idx], lowerSMA50, upperSMA50) - medianSMA50) / iqrSMA50,
          (winsorizeVal(returns[idx], lowerReturn, upperReturn) - medianReturn) / iqrReturn,
          (winsorizeVal(vol10[idx], lowerVol10, upperVol10) - medianVol10) / iqrVol10,
          (winsorizeVal(vol30[idx], lowerVol30, upperVol30) - medianVol30) / iqrVol30
        ];
        
        // Check for NaN or Infinity values
        if (normalizedFeatures.some(v => !isFinite(v) || isNaN(v))) {
          hasInvalidValues = true;
          break;
        }
        
        sequence.push(normalizedFeatures);
      } catch (e) {
        console.warn("Error creating sequence at index", idx, e);
        hasInvalidValues = true;
        break;
      }
    }
    
    if (hasInvalidValues) {
      continue; // Skip this sequence
    }
    
    // Target is normalized log price with predictionGap into the future
    const targetIdx = i + sequenceLength + predictionGap;
    
    if (targetIdx >= logPrices.length) {
      continue; // Skip if target is out of range
    }
    
    try {
      const normalizedTargetLogPrice = (
        winsorizeVal(logPrices[targetIdx], lowerLogPrice, upperLogPrice) - medianLogPrice
      ) / iqrLogPrice;
      
      // Check for NaN or Infinity values
      if (!isFinite(normalizedTargetLogPrice) || isNaN(normalizedTargetLogPrice)) {
        continue;
      }
      
      sequences.push(sequence);
      targets.push([normalizedTargetLogPrice]);
    } catch (e) {
      console.warn("Error creating target at index", targetIdx, e);
    }
  }
  
  if (sequences.length === 0) {
    throw new Error("Failed to create valid sequences for training");
  }
  
  // Create tensors
  const inputTensor = tf.tensor3d(sequences);
  const outputTensor = tf.tensor2d(targets);
  
  // Create bounds object for prediction
  const bounds = {
    logPrice: { lower: lowerLogPrice, upper: upperLogPrice },
    volume: { lower: lowerVolume, upper: upperVolume },
    sma7: { lower: lowerSMA7, upper: upperSMA7 },
    sma20: { lower: lowerSMA20, upper: upperSMA20 },
    sma50: { lower: lowerSMA50, upper: upperSMA50 },
    return: { lower: lowerReturn, upper: upperReturn },
    vol10: { lower: lowerVol10, upper: upperVol10 },
    vol30: { lower: lowerVol30, upper: upperVol30 }
  };
  
  // Meta data for normalization and denormalization during prediction
  const meta = {
    medianLogPrice, iqrLogPrice,
    medianVolume, iqrVolume,
    medianSMA7, iqrSMA7,
    medianSMA20, iqrSMA20,
    medianSMA50, iqrSMA50,
    medianReturn, iqrReturn,
    medianVol10, iqrVol10,
    medianVol30, iqrVol30,
    bounds,
    minMonthlyReturn,
    maxMonthlyReturn
  };
  
  return { inputTensor, outputTensor, meta };
}

/**
 * Fixed version of predict30DayAheadPrice with enhanced error handling
 */
async function predict30DayAheadPrice(modelObj, data, maxMonthlyReturnPct = 5) {
  try {
    const { model, meta } = modelObj;
    const sequenceLength = 60; // Must match the sequence length used during training
    
    // Extract relevant meta data
    const {
      medianLogPrice, iqrLogPrice,
      medianVolume, iqrVolume,
      medianSMA7, iqrSMA7,
      medianSMA20, iqrSMA20,
      medianSMA50, iqrSMA50,
      medianReturn, iqrReturn,
      medianVol10, iqrVol10,
      medianVol30, iqrVol30,
      bounds,
      minMonthlyReturn,
      maxMonthlyReturn
    } = meta;
    
    // Validate meta data
    if (!isFinite(medianLogPrice) || isNaN(medianLogPrice) || !isFinite(iqrLogPrice) || isNaN(iqrLogPrice) || iqrLogPrice === 0) {
      console.error("Invalid normalization parameters:", { medianLogPrice, iqrLogPrice });
      throw new Error("Invalid normalization parameters");
    }
    
    // Use a market-specific constraint that can be adjusted
    const userMaxMonthlyReturn = Math.log(1 + (maxMonthlyReturnPct / 100));
    const userMinMonthlyReturn = Math.log(1 - (maxMonthlyReturnPct / 100));
    
    // Use the more conservative of the two constraints
    const effectiveMaxReturn = Math.min(maxMonthlyReturn || 0.5, userMaxMonthlyReturn);
    const effectiveMinReturn = Math.max(minMonthlyReturn || -0.5, userMinMonthlyReturn);
    
    // Filter out invalid data
    const validData = data.filter(item => 
      typeof item.price === 'number' && !isNaN(item.price) && item.price > 0 &&
      typeof item.volume === 'number' && !isNaN(item.volume) && item.volume >= 0
    );
    
    // Extract recent data
    if (validData.length < sequenceLength) {
      throw new Error(`Not enough valid data for prediction. Need at least ${sequenceLength} data points.`);
    }
    
    const recentData = validData.slice(-sequenceLength);
    const recentPrices = recentData.map(item => item.price);
    const recentVolumes = recentData.map(item => item.volume);
    
    // Store the last price as a fallback
    const lastPrice = recentPrices[recentPrices.length - 1];
    
    // Compute features for recent data
    const recentLogPrices = recentPrices.map(p => {
      try {
        return Math.log(Math.max(p, 0.001)); // Ensure non-zero positive value
      } catch (e) {
        console.warn("Error calculating log price:", e);
        return 0;
      }
    });
    
    const sma7Recent = computeSMA(recentLogPrices, 7);
    const sma20Recent = computeSMA(recentLogPrices, 20);
    const sma50Recent = computeSMA(recentLogPrices, 50);
    const returnRecent = computeDailyLogReturn(recentLogPrices);
    
    // Calculate volatility features
    const vol10Recent = [];
    const vol30Recent = [];
    
    for (let i = 0; i < recentLogPrices.length; i++) {
      const start10 = Math.max(0, i - 10 + 1);
      const start30 = Math.max(0, i - 30 + 1);
      
      const vol10 = calculateVolatility(returnRecent.slice(start10, i + 1)) || 0;
      const vol30 = calculateVolatility(returnRecent.slice(start30, i + 1)) || 0;
      
      vol10Recent.push(vol10);
      vol30Recent.push(vol30);
    }
    
    // Create normalized input sequence with validation
    const normSeq = [];
    
    for (let idx = 0; idx < recentData.length; idx++) {
      try {
        const features = [
          (winsorizeVal(recentLogPrices[idx], bounds.logPrice.lower, bounds.logPrice.upper) - medianLogPrice) / (iqrLogPrice || 0.00001),
          (winsorizeVal(recentVolumes[idx], bounds.volume.lower, bounds.volume.upper) - medianVolume) / (iqrVolume || 0.00001),
          (winsorizeVal(sma7Recent[idx], bounds.sma7.lower, bounds.sma7.upper) - medianSMA7) / (iqrSMA7 || 0.00001),
          (winsorizeVal(sma20Recent[idx], bounds.sma20.lower, bounds.sma20.upper) - medianSMA20) / (iqrSMA20 || 0.00001),
          (winsorizeVal(sma50Recent[idx], bounds.sma50.lower, bounds.sma50.upper) - medianSMA50) / (iqrSMA50 || 0.00001),
          (winsorizeVal(returnRecent[idx], bounds.return.lower, bounds.return.upper) - medianReturn) / (iqrReturn || 0.00001),
          (winsorizeVal(vol10Recent[idx], bounds.vol10.lower, bounds.vol10.upper) - medianVol10) / (iqrVol10 || 0.00001),
          (winsorizeVal(vol30Recent[idx], bounds.vol30.lower, bounds.vol30.upper) - medianVol30) / (iqrVol30 || 0.00001)
        ];
        
        // Validate all features are finite numbers
        if (features.some(val => !isFinite(val) || isNaN(val))) {
          console.warn(`Invalid feature value at index ${idx}`);
          continue;
        }
        
        normSeq.push(features);
      } catch (e) {
        console.warn(`Error creating normalized feature at index ${idx}:`, e);
      }
    }
    
    if (normSeq.length < sequenceLength) {
      throw new Error(`Not enough valid normalized data for prediction. Generated ${normSeq.length}/${sequenceLength} required points.`);
    }
    
    // Take only the last sequenceLength points if we have more
    const finalSeq = normSeq.slice(-sequenceLength);
    
    const inputTensor = tf.tensor3d([finalSeq], [1, sequenceLength, 8]);
    
    // Make prediction with error handling
    let predNormLogPrice;
    try {
      const prediction = model.predict(inputTensor);
      predNormLogPrice = prediction.dataSync()[0];
      
      // Clean up tensor to prevent memory leaks
      prediction.dispose();
      inputTensor.dispose();
      
      // Check if prediction is valid
      if (!isFinite(predNormLogPrice) || isNaN(predNormLogPrice)) {
        console.warn("Model returned NaN or infinite prediction:", predNormLogPrice);
        return lastPrice; // Fallback to last known price
      }
    } catch (e) {
      console.error("Error during model prediction:", e);
      return lastPrice; // Fallback to last known price
    }
    
    // Inverse transformation to get predicted log-price
    const predictedLogPrice = predNormLogPrice * iqrLogPrice + medianLogPrice;
    
    // Calculate and constrain the predicted return
    const lastLogPrice = Math.log(Math.max(lastPrice, 0.001)); // Ensure positive value
    const predictedLogReturn = predictedLogPrice - lastLogPrice;
    
    // Apply market-specific constraints
    const constrainedLogReturn = Math.min(Math.max(predictedLogReturn, effectiveMinReturn), effectiveMaxReturn);
    
    // Calculate the final constrained log price and convert to actual price
    const constrainedLogPrice = lastLogPrice + constrainedLogReturn;
    const predictedPrice = Math.exp(constrainedLogPrice);
    
    // Final validation
    if (!isFinite(predictedPrice) || isNaN(predictedPrice) || predictedPrice <= 0) {
      console.warn("Invalid final predicted price:", predictedPrice);
      return lastPrice; // Fallback to last known price
    }
    
    // Calculate percentage change for reporting
    const percentChange = (Math.exp(constrainedLogReturn) - 1) * 100;
    console.log(`Predicted price: ${predictedPrice.toFixed(2)}, Change: ${percentChange.toFixed(2)}%`);
    
    return predictedPrice;
  } catch (error) {
    console.error("Error in predict30DayAheadPrice:", error);
    // Find the last valid price in the dataset
    for (let i = data.length - 1; i >= 0; i--) {
      if (typeof data[i].price === 'number' && !isNaN(data[i].price) && data[i].price > 0) {
        return data[i].price;
      }
    }
    return 0; // Ultimate fallback if no valid prices exist
  }
}
/**
 * Improved model training with more robust architecture and regularization
 */
async function trainModelFor30DayAheadPrice(data) {
  const sequenceLength = 60; // Increased from 30 to capture more historical context
  const predictionGap = 30;
  const { inputTensor, outputTensor, meta } = prepareDataFor30DayAheadPrice(data, sequenceLength, predictionGap);

  const model = tf.sequential();
  
  // First LSTM layer with batch normalization
  model.add(tf.layers.lstm({
    units: 32,
    inputShape: [sequenceLength, 8], // Updated for the 8 features
    returnSequences: true,
    kernelRegularizer: tf.regularizers.l1l2({ l1: 0.001, l2: 0.01 }),
    recurrentRegularizer: tf.regularizers.l2({ l2: 0.01 }),
  }));
  
  model.add(tf.layers.batchNormalization());
  model.add(tf.layers.dropout({ rate: 0.3 }));
  
  // Second LSTM layer
  model.add(tf.layers.lstm({
    units: 16,
    returnSequences: false,
    kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
    recurrentRegularizer: tf.regularizers.l2({ l2: 0.01 }),
  }));
  
  model.add(tf.layers.batchNormalization());
  model.add(tf.layers.dropout({ rate: 0.3 }));
  
  // Output layer with tanh activation to constrain outputs
  model.add(tf.layers.dense({ 
    units: 1, 
    activation: 'tanh',
    kernelRegularizer: tf.regularizers.l2({ l2: 0.01 })
  }));

  // Using lower learning rate for stability
  const optimizer = tf.train.adam({ learningRate: 0.001 });
  model.compile({ optimizer: optimizer, loss: customHuberLoss(0.5) }); // Lowered delta for more robustness

  console.log('Training model for 30-day ahead log-price prediction with improved architecture...');
  
  // More sophisticated early stopping
  const earlyStopping = tf.callbacks.earlyStopping({
    monitor: 'val_loss',
    patience: 10,
    minDelta: 0.001,
    mode: 'min',
    verbose: 1
  });

  await model.fit(inputTensor, outputTensor, {
    epochs: 100, // Increased epochs with early stopping
    batchSize: 32,
    validationSplit: 0.2,
    callbacks: [earlyStopping],
    verbose: 1
  });
  
  console.log('Training completed.');

  return { model, meta };
}



/**
 * Enhanced analyzeStock function with comprehensive error handling
 * and debugging to prevent NaN prediction issues
 */
export async function analyzeStock(
  ticker,
  historicalData,
  maxMonthlyReturnPct = 5
) {
  try {
    console.log(`📊 Analyzing stock ${ticker} with ${historicalData.length} data points...`);
    
    // Validate minimum data requirement
    if (historicalData.length < 120) {
      console.error(`❌ Not enough data to train the model for ${ticker}.`);
      return null;
    }
    
    // Validate data integrity
    const invalidPriceEntries = historicalData.filter(
      item => typeof item.price !== 'number' || isNaN(item.price) || item.price <= 0
    );
    
    const invalidVolumeEntries = historicalData.filter(
      item => typeof item.volume !== 'number' || isNaN(item.volume) || item.volume < 0
    );
    
    if (invalidPriceEntries.length > 0) {
      console.warn(`⚠️ Found ${invalidPriceEntries.length} invalid price entries in ${ticker}`);
    }
    
    if (invalidVolumeEntries.length > 0) {
      console.warn(`⚠️ Found ${invalidVolumeEntries.length} invalid volume entries in ${ticker}`);
    }
    
    // If more than 20% of data is invalid, return error
    if (invalidPriceEntries.length > historicalData.length * 0.2) {
      console.error(`❌ Too many invalid price entries in ${ticker}.`);
      return null;
    }
    
    // Filter out any invalid data
    const validData = historicalData.filter(
      item => typeof item.price === 'number' && !isNaN(item.price) && item.price > 0 &&
              typeof item.volume === 'number' && !isNaN(item.volume) && item.volume >= 0
    );
    
    console.log(`ℹ️ Using ${validData.length}/${historicalData.length} valid data points for analysis`);
    
    // Train model with enhanced error tracing
    console.log(`🧠 Training model for ${ticker}...`);
    let modelObj;
    try {
      modelObj = await trainModelFor30DayAheadPrice(validData);
      console.log(`✅ Model training completed for ${ticker}`);
    } catch (error) {
      console.error(`❌ Error training model for ${ticker}:`, error.message);
      return null;
    }
    
    // Verify model object integrity
    if (!modelObj || !modelObj.model || !modelObj.meta) {
      console.error(`❌ Invalid model object for ${ticker}`);
      return null;
    }
    
    // Check meta data integrity
    const { meta } = modelObj;
    const requiredMetaFields = [
      'medianLogPrice', 'iqrLogPrice', 'bounds', 
      'minMonthlyReturn', 'maxMonthlyReturn'
    ];
    
    const missingFields = requiredMetaFields.filter(field => 
      meta[field] === undefined || meta[field] === null
    );
    
    if (missingFields.length > 0) {
      console.error(`❌ Missing required meta fields for ${ticker}: ${missingFields.join(', ')}`);
      return null;
    }
    
    // Check for zero IQR values
    if (meta.iqrLogPrice === 0) {
      console.warn(`⚠️ Zero iqrLogPrice detected for ${ticker}, setting to minimum value`);
      meta.iqrLogPrice = 0.00001;
    }
    
    // Make prediction with enhanced logging
    console.log(`🔮 Making prediction for ${ticker}...`);
    let predictedPrice;
    try {
      predictedPrice = await predict30DayAheadPrice(
        modelObj,
        validData,
        maxMonthlyReturnPct
      );
      
      // Verify prediction
      if (predictedPrice === null || predictedPrice === undefined || !isFinite(predictedPrice) || isNaN(predictedPrice)) {
        const lastPrice = validData[validData.length - 1].price;
        console.warn(`⚠️ Invalid prediction (${predictedPrice}) for ${ticker}, falling back to last price: ${lastPrice}`);
        
        // Fall back to last price
        predictedPrice = lastPrice;
      } else {
        // Calculate and log percentage change
        const lastPrice = validData[validData.length - 1].price;
        const change = ((predictedPrice - lastPrice) / lastPrice) * 100;
        console.log(`📈 Prediction for ${ticker}: ${predictedPrice.toFixed(2)} (${change >= 0 ? '+' : ''}${change.toFixed(2)}%)`);
      }
    } catch (error) {
      console.error(`❌ Error making prediction for ${ticker}:`, error.message);
      return null;
    }
    
    return predictedPrice;
  } catch (error) {
    console.error(`❌ Unhandled error analyzing stock ${ticker}:`, error.message);
    return null;
  }
}