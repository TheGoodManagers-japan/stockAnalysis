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




/**
 * Return 1‑7 timing label.
 * 1  = Strong Buy, 7 = Strong Avoid
 */
function getEntryTimingScore(stock) {
  // ───────────────────────────────────────────
  // 1. Extract properties (defaults → 0)
  // ───────────────────────────────────────────
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

  // ───────────────────────────────────────────
  // 2. Basic metrics
  // ───────────────────────────────────────────
  const dailyRange        = highPrice - lowPrice;
  const percentRange      = currentPrice > 0 ? (dailyRange / currentPrice) * 100 : 0;
  const percentFromHigh   = fiftyTwoWeekHigh > 0
                           ? ((fiftyTwoWeekHigh - currentPrice) / fiftyTwoWeekHigh) * 100
                           : 0;
  const percentFromLow    = fiftyTwoWeekLow > 0
                           ? ((currentPrice - fiftyTwoWeekLow) / fiftyTwoWeekLow) * 100
                           : 0;
  const distanceFrom50d   = movingAverage50d > 0
                           ? ((currentPrice - movingAverage50d) / movingAverage50d) * 100
                           : 0;

  // ───────────────────────────────────────────
  // 3. Vol‑pattern & MA relationships
  // ───────────────────────────────────────────
  const isVolatile            = percentRange > 5 || (atr14 > 0 && atr14 > currentPrice * 0.03);
  const isExtremeLowVol       = percentRange < 1.5;
  const nearHigh              = percentFromHigh <= 2;
  const veryNearHigh          = percentFromHigh <= 1;
  const atAllTimeHigh         = currentPrice >= fiftyTwoWeekHigh;
  const nearLow               = percentFromLow <= 2;
  const veryNearLow           = percentFromLow <= 1;
  const atAllTimeLow          = currentPrice <= fiftyTwoWeekLow;

  // Candlestick strength / reversals
  const strongClose      =
    currentPrice > openPrice &&
    currentPrice > prevClosePrice &&
    currentPrice - Math.min(openPrice, prevClosePrice) >
      (highPrice - currentPrice) * 2;

  const veryStrongClose  =
    strongClose && currentPrice > highPrice - (highPrice - lowPrice) * 0.2;

  const weakClose        =
    currentPrice < openPrice &&
    currentPrice < prevClosePrice &&
    Math.max(openPrice, prevClosePrice) - currentPrice >
      (currentPrice - lowPrice) * 2;

  const veryWeakClose    =
    weakClose && currentPrice < lowPrice + (highPrice - lowPrice) * 0.2;

  const bullishReversal  =
    currentPrice > openPrice &&
    openPrice < prevClosePrice &&
    currentPrice > prevClosePrice;

  const bearishReversal  =
    currentPrice < openPrice &&
    openPrice > prevClosePrice &&
    currentPrice < prevClosePrice;

  const doji             =
    Math.abs(currentPrice - openPrice) < (highPrice - lowPrice) * 0.1;

  // Moving averages
  const aboveMA50     = currentPrice > movingAverage50d;
  const aboveMA200    = currentPrice > movingAverage200d;
  const nearMA50      = Math.abs(distanceFrom50d) < 1;
  const aboveBothMAs  = aboveMA50 && aboveMA200;
  const belowBothMAs  = !aboveMA50 && !aboveMA200;

  // ───────────────────────────────────────────
  // 4. 🚨  Bull‑trap detection  ─ NEW ─
  // 
  // Idea: price breaks out ≥ 1 % above open/prev close
  //       then gives back ≥ 70 % of that intraday range
  //       and finishes at/below the open.
  // ───────────────────────────────────────────
  const breakoutSizePct   = openPrice > 0 ? ((highPrice - openPrice) / openPrice) * 100 : 0;
  const retraceRatio      = dailyRange > 0 ? (highPrice - currentPrice) / dailyRange : 0; // 0‑1
  const bullTrap          =
      breakoutSizePct >= 1              // decent pop
   && retraceRatio    >= 0.70           // gave most of it back
   && currentPrice    <= openPrice;     // now at/under the open

  // Optional stronger version
  const strongBullTrap   = bullTrap && retraceRatio >= 0.90;

  // ───────────────────────────────────────────
  // 5. Scoring
  // ───────────────────────────────────────────
  let score = 0;

  // ✅ Bullish adds
  if (veryStrongClose) score += 3;
  else if (strongClose) score += 2;

  if (bullishReversal) score += 1.5;

  if (atAllTimeHigh)        score += 2;
  else if (veryNearHigh)    score += 1.5;
  else if (nearHigh)        score += 1;

  if (aboveBothMAs)         score += 1.5;
  else if (aboveMA50 && nearMA50) score += 1;

  if (nearMA50 && bullishReversal) score += 0.5;

  if (!isVolatile && strongClose) score += 1;

  if (isExtremeLowVol && currentPrice > prevClosePrice) score -= 0.5;

  // ⚠️  Bearish deductions
  if (veryWeakClose) score -= 3;
  else if (weakClose) score -= 2;

  if (bearishReversal) score -= 1.5;

  if (atAllTimeLow)        score -= 2;
  else if (veryNearLow)    score -= 1.5;
  else if (nearLow)        score -= 1;

  if (belowBothMAs)        score -= 1.5;

  if (isVolatile && weakClose) score -= 1;

  // 🚨  Bull‑trap penalty
  if (strongBullTrap)      score -= 3;
  else if (bullTrap)       score -= 2;

  // Doji nuance
  if (doji) {
    if (nearHigh || nearLow) {
      /* neutral */
    } else if (aboveBothMAs) {
      score += 0.5;
    } else if (belowBothMAs) {
      score -= 0.5;
    }
  }

  // ───────────────────────────────────────────
  // 6. Map raw score → 1‑7 label
  // ───────────────────────────────────────────
  if (score >= 4)          return 1; // Strong Buy
  if (score >= 2)          return 2; // Buy
  if (score >= 0.5)        return 3; // Watch
  if (score >  -0.5)       return 4; // Neutral
  if (score >= -2)         return 5; // Caution
  if (score >= -4)         return 6; // Avoid
  return 7;                           // Strong Avoid
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
          stock.entryTimingScore = getEntryTimingScore(stock);
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
/**
 * Fast Stock Analysis Function
 * 
 * This function calculates trade parameters (stop loss, target price, limit order, etc.) 
 * without recomputing predictions and scores, using pre-calculated values.
 * It's designed to be used after the market opens to quickly update trade parameters.
 */
async function fastStockAnalysis(ticker, stockData) {
  try {
    console.log(`\n--- Running fast analysis for ${ticker} ---`);
    
    // 1. Extract data from the simplified JSON input
    const {
      sector,
      prediction,
      score,
      technicalScore,
      fundamentalScore,
      valuationScore,
      otherData
    } = stockData;
    
    // 2. Build stock object with current data
    const stock = {
      ticker,
      sector,
      prediction,
      score,
      technicalScore,
      fundamentalScore,
      valuationScore,
      
      // Add all other data properties directly
      ...otherData,
      
      // Current market data will be updated from Yahoo
      currentPrice: stockData.yahooData?.currentPrice || otherData.currentPrice,
      highPrice: stockData.yahooData?.highPrice || otherData.highPrice,
      lowPrice: stockData.yahooData?.lowPrice || otherData.lowPrice,
      openPrice: stockData.yahooData?.openPrice || otherData.openPrice,
      prevClosePrice: stockData.yahooData?.prevClosePrice || otherData.prevClosePrice,
      
      // Historical data might be needed for some calculations
      historicalData: stockData.historicalData || [],
    };
    
    // 3. Calculate Stop Loss & Target
    const { stopLoss, targetPrice } = calculateStopLossAndTarget(stock, stock.prediction);
    stock.stopLoss = stopLoss;
    stock.targetPrice = targetPrice;
    
    // 4. Compute growth potential
    const growthPotential = ((stock.targetPrice - stock.currentPrice) / stock.currentPrice) * 100;
    stock.growthPotential = parseFloat(growthPotential.toFixed(2));
    
    // 5. Calculate final score (reusing the metric score)
    const weights = { metrics: 0.7, growth: 0.3 };
    const finalScore = 
      weights.metrics * stock.score + 
      weights.growth * (growthPotential / 100);
    stock.finalScore = parseFloat(finalScore.toFixed(2));
    
    // 6. Recalculate only the timing-dependent parameters
    stock.entryTimingScore = getEntryTimingScore(stock);
    stock.tier = getNumericTier(stock);
    stock.limitOrder = getLimitOrderPrice(stock);
    
    // 7. Recalculate all scores except prediction
    stock.technicalScore = getTechnicalScore(stock);
    stock.fundamentalScore = getAdvancedFundamentalScore(stock);
    stock.valuationScore = getValuationScore(stock);
    
    // 8. Return data in Bubble key format (same as original function)
    const stockObject = {
      _api_c2_ticker: stock.ticker,
      _api_c2_sector: stock.sector,
      _api_c2_currentPrice: stock.currentPrice,
      _api_c2_entryTimingScore: stock.entryTimingScore,
      _api_c2_prediction: stock.prediction,  // Reuse the prediction
      _api_c2_stopLoss: stock.stopLoss,
      _api_c2_targetPrice: stock.targetPrice,
      _api_c2_growthPotential: stock.growthPotential,
      _api_c2_score: computeScore(stock, stock.sector),  // Recalculate score
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
        
        // Recalculated scores
        technicalScore: stock.technicalScore,
        fundamentalScore: stock.fundamentalScore,
        valuationScore: stock.valuationScore,
      }),
    };
    
    console.log(`📤 Fast analysis for ${stock.ticker} complete.`);
    return stockObject;
  } catch (error) {
    console.error(`❌ Error in fastStockAnalysis for ${ticker}:`, error.message);
    throw error;
  }
}

/**
 * Main function to run fast analysis for multiple tickers.
 * This integrates with your existing scan workflow.
 */
window.fastScan = {
  async fastAnalyzeStocks(tickersWithData = []) {
    try {
      const results = [];
      
      for (const item of tickersWithData) {
        try {
          const { ticker, data } = item;
          console.log(`Processing fast analysis for ${ticker}`);
          
          // 1. Fetch latest Yahoo data to get current prices
          const result = await fetchSingleStockData({ code: ticker });
          if (!result.success) {
            console.error(`Error fetching latest data for ${ticker}:`, result.error);
            continue;
          }
          
          // 2. Merge the fresh Yahoo data with pre-calculated data
          const analysisData = {
            ...data,
            yahooData: result.data.yahooData
          };
          
          // 3. Run fast analysis
          const analysisResult = await fastStockAnalysis(ticker, analysisData);
          
          // 4. Send the result to Bubble to override previous data
          console.log(`📤 Sending updated ${ticker} to Bubble:`, analysisResult);
          bubble_fn_result(analysisResult);
          results.push(analysisResult);
        } catch (error) {
          console.error(`❌ Error processing ticker ${item.ticker}:`, error.message);
        }
      }
      
      // ✅ Finished processing all tickers (success or some errors)
      console.log(`✅ Fast analysis completed for ${results.length} tickers`);
      bubble_fn_finish();
      
      return results;
    } catch (error) {
      console.error("❌ Error in fastAnalyzeStocks:", error.message);
      
      // 🔴 If outer error (like JSON parse or logic bug), still call finish
      bubble_fn_finish();
      
      throw new Error("Fast analysis aborted due to errors.");
    }
  },
  // No additional methods needed
};