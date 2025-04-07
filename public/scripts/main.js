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
    valuation: 0.25,
    marketStability: 0.2,
    dividendBenefit: 0.15,
    historicalPerformance: 0.15,
    momentum: 0.15,
    volatilityRisk: 0.1,
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

  // --- Valuation Score (PE & PB Ratios with refinement)
  const peScore =
    stock.peRatio > 0
      ? Math.max(0, Math.min(1, (20 - stock.peRatio) / 20))
      : 0.5;
  const pbScore =
    stock.pbRatio > 0
      ? Math.max(0, Math.min(1, (2.5 - stock.pbRatio) / 2.5))
      : 0.5;
  let valuationScore = ((peScore + pbScore) / 2) * sectorMultiplier.valuation;

  // --- Market Stability (Volatility + Beta combined)
  const volatility = calculateHistoricalVolatility(stock.historicalData);
  const normalizedVol = Math.min(volatility / 0.05, 1);
  const betaScore = stock.beta
    ? Math.max(0, 1 - Math.abs(stock.beta - 1) / 1)
    : 0.5;
  const stabilityScore =
    ((1 - normalizedVol) * 0.7 + betaScore * 0.3) * sectorMultiplier.stability;

  // --- Dividend Benefit (Yield + Growth combined)
  const dividendYieldScore = Math.min(stock.dividendYield / 5, 1);
  const dividendGrowthScore = stock.dividendGrowth5yr
    ? Math.min(stock.dividendGrowth5yr / 10, 1)
    : 0.5;
  const dividendScore =
    (dividendYieldScore * 0.7 + dividendGrowthScore * 0.3) *
    sectorMultiplier.dividend;

  // --- Historical Performance (Position in 52-week range)
  const range = stock.fiftyTwoWeekHigh - stock.fiftyTwoWeekLow;
  const position =
    range > 0 ? (stock.currentPrice - stock.fiftyTwoWeekLow) / range : 0.5;
  const historicalPerformance = position;

  // --- Momentum Score (Enhanced RSI, MACD, Stochastic)
  let momentumScore = 0;
  if (stock.rsi14) {
    momentumScore += (stock.rsi14 - 30) / 40; // Scaled between RSI 30-70
  }
  if (stock.macd && stock.macdSignal) {
    momentumScore += stock.macd > stock.macdSignal ? 0.3 : 0;
  }
  if (stock.stochasticK) {
    momentumScore += (stock.stochasticK / 100) * 0.3;
  }
  momentumScore = Math.min(momentumScore / 2, 1); // normalize

  // --- Volatility Risk (Enhanced ATR & Bollinger bands check)
  let volatilityRiskScore = 1;
  const atrRatio = stock.atr14 / stock.currentPrice;
  volatilityRiskScore -= atrRatio > 0.03 ? 0.2 : atrRatio > 0.015 ? 0.1 : 0;
  if (stock.currentPrice > stock.bollingerUpper) volatilityRiskScore -= 0.1;
  if (stock.currentPrice < stock.bollingerLower) volatilityRiskScore -= 0.1;
  volatilityRiskScore = Math.max(volatilityRiskScore, 0.5);

  // --- Final Weighted Score
  const rawScore =
    valuationScore * weights.valuation +
    stabilityScore * weights.marketStability +
    dividendScore * weights.dividendBenefit +
    historicalPerformance * weights.historicalPerformance +
    momentumScore * weights.momentum +
    volatilityRiskScore * weights.volatilityRisk;

  return Math.min(Math.max(rawScore, 0), 1);
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

function getTechnicalSummaryLabel(stock) {
  const {
    currentPrice,
    movingAverage50d,
    movingAverage200d,
    rsi14,
    macd,
    macdSignal,
    bollingerMid,
    stochasticK,
    stochasticD,
    obv,
    atr14,
  } = stock;

  // Signal checks
  const isBullishTrend = movingAverage50d > movingAverage200d;
  const isBullishMACD = macd > macdSignal;
  const isBullishStochastic = stochasticK > stochasticD;
  const isStrongRSI = rsi14 > 50;
  const isAboveMidBB = currentPrice > bollingerMid;
  const hasOBV = obv > 0;
  const isLowVolatility = atr14 <= currentPrice * 0.02;

  // Weighted scoring system
  const weights = {
    trend: 2,
    macd: 1.5,
    stochastic: 1,
    rsi: 1.5,
    bollinger: 1,
    obv: 1,
  };

  let score = 0;
  if (isBullishTrend) score += weights.trend;
  if (isBullishMACD) score += weights.macd;
  if (isBullishStochastic) score += weights.stochastic;
  if (isStrongRSI) score += weights.rsi;
  if (isAboveMidBB) score += weights.bollinger;
  if (hasOBV) score += weights.obv;

  // Adjusted thresholds — easier to trigger good signals
  if (score >= 5.5) return "Strong Bullish 📈";
  if (score >= 4) return "Oversold 🟢";
  if (score >= 3) return "Possible Reversal 🟡";
  if (score >= 2) return "Neutral ⚪️";
  if (score >= 1) return "Weak Signal 🟠";
  return "Bearish 🟥";
}









function getAdvancedFundamentalRating(stock) {
  const {
    epsGrowthRate,
    epsForward,
    epsTrailingTwelveMonths,
    dividendYield,
    dividendGrowth5yr,
    debtEquityRatio,
  } = stock;

  let score = 0;
  let isStrongGrowth = false;
  let isStrongDividend = false;

  // 📈 Earnings Growth
  if (epsGrowthRate > 10 && epsForward > epsTrailingTwelveMonths) {
    score += 2;
    isStrongGrowth = true;
  } else if (epsGrowthRate > 1) {
    score += 1;
  } else if (epsGrowthRate < 0) {
    score -= 2;
  }

  // 💵 Dividend Yield
  if (dividendYield >= 4) {
    score += 2;
    isStrongDividend = true;
  } else if (dividendYield >= 1) {
    score += 1;
  } else if (dividendYield === 0) {
    score -= 1;
  }

  // 📈 Dividend Growth
  if (dividendGrowth5yr >= 5) {
    score += 1;
    isStrongDividend = true;
  } else if (dividendGrowth5yr < 0) {
    score -= 1;
  }

  // 🧾 Debt
  if (debtEquityRatio < 0.5) {
    score += 1;
  } else if (debtEquityRatio > 1.5) {
    score -= 1;
  }

  // 🏷️ Final Classification (original logic)
  if (score >= 5 && isStrongGrowth && isStrongDividend)
    return "🟢 Excellent Fundamentals 💎";
  if (score >= 4 && isStrongGrowth) return "🟡 Solid Growth 📈";
  if (score >= 4 && isStrongDividend) return "🟩 Strong Dividend Stock 💵";
  if (score >= 2 && !isStrongGrowth && isStrongDividend)
    return "🟧 Value Play (Low Growth) 🧱";
  if (score >= 0) return "⚪ Neutral Fundamentals 🤔";
  if (score === -1 || score === -2) return "🟠 Watchlist Stock 🧐";
  return "🔴 Weak Fundamentals ⚠️";
}




function getEntryTimingLabel(stock) {
  const {
    currentPrice,
    openPrice,
    highPrice,
    lowPrice,
    prevClosePrice,
    fiftyTwoWeekHigh,
    fiftyTwoWeekLow,
  } = stock;

  const dailyRange = highPrice - lowPrice;
  const isVolatile = dailyRange > currentPrice * 0.03;
  const nearHigh = currentPrice >= fiftyTwoWeekHigh * 0.98;
  const nearLow = currentPrice <= fiftyTwoWeekLow * 1.02;
  const strongClose = currentPrice > openPrice && currentPrice > prevClosePrice;
  const weakClose = currentPrice < openPrice && currentPrice < prevClosePrice;

  let score = 0;

  console.log("🧪 Entry Timing Analysis for:", stock.ticker || "Unknown");
  console.log({ currentPrice, openPrice, highPrice, lowPrice, prevClosePrice });
  console.log({
    dailyRange,
    isVolatile,
    nearHigh,
    nearLow,
    strongClose,
    weakClose,
  });

  // Positive signals
  if (strongClose) {
    score += 2;
    console.log("✔️ Strong close → +2");
  }
  if (nearLow) {
    score += 1.5;
    console.log("✔️ Near 52W Low → +1.5");
  }
  if (nearHigh) {
    score += 1.5;
    console.log("✔️ Near 52W High → +1.5");
  }
  if (!isVolatile) {
    score += 1;
    console.log("✔️ Low volatility → +1");
  }

  // Negative signals
  if (weakClose) {
    score -= 1;
    console.log("❌ Weak close → -1");
  }
  if (isVolatile) {
    score -= 0.5;
    console.log("❌ High volatility → -0.5");
  }

  console.log("📊 Final Score:", score);

  // Final label thresholds
  if (score >= 4) return "📈 Breakout – Good Entry Zone";
  if (score >= 3) return "🟢 Rebound Setup – Potential Entry";
  if (score >= 2) return "✅ Stable Strength – Worth Watching";
  if (score <= -1.5) return "🔴 Volatile & Weak – Avoid Entry";
  if (score < 1) return "⚠️ Weak Close – Wait for Confirmation";

  return "⚪ Sideways / Neutral";
}






function getValuationSummary(stock) {
  const { peRatio, pbRatio, beta, marketCap } = stock;
  let score = 0;

  // 🧮 P/E Ratio (max 2)
  if (peRatio > 0 && peRatio < 15) score += 2;
  else if (peRatio >= 15 && peRatio <= 25) score += 1;
  else if (peRatio > 25) score -= 1;

  // 📘 P/B Ratio (max 2)
  if (pbRatio > 0 && pbRatio < 1) score += 2;
  else if (pbRatio >= 1 && pbRatio <= 3) score += 1;
  else if (pbRatio > 3) score -= 1;

  // ⚖️ Beta (max 1)
  if (beta < 1) score += 1;
  else if (beta > 1.2) score -= 1;

  // 💰 Market Cap (max 1)
  if (marketCap >= 1_000_000_000_000) score += 1;
  else if (marketCap < 300_000_000_000) score -= 1;

  // 🏷️ Final Label (max score = 6)
  if (score >= 5) return "Deep Value 💎";
  if (score >= 3) return "Undervalued 📉";
  if (score >= 1) return "Fairly Priced ⚖️";
  return "Overpriced 🔴";
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
    console.log("yahoo data:", yahooData)
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
      dividendGrowth5yr: yahooData.dividendGrowth5yr,
      fiftyTwoWeekHigh: yahooData.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: yahooData.fiftyTwoWeekLow,
      epsTrailingTwelveMonths: yahooData.epsTrailingTwelveMonths,
      epsForward: yahooData.epsForward,
      epsGrowthRate: yahooData.epsGrowthRate,
      debtEquityRatio: yahooData.debtEquityRatio,
      beta: yahooData.beta,
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

          stock.prediction = prediction;
          stock.growthPotential = parseFloat(growthPotential.toFixed(2));
          stock.finalScore = parseFloat(finalScore.toFixed(2));
          stock.technicalSummary = getTechnicalSummaryLabel(stock);
          stock.fundamentalSummary = getAdvancedFundamentalRating(stock);
          stock.valuationSummary= getValuationSummary(stock);
          stock.entryTimingLabel = getEntryTimingLabel(stock);



          // 10) Send data in Bubble key format
         const stockObject = {
           _api_c2_ticker: stock.ticker,
           _api_c2_sector: stock.sector,
           _api_c2_currentPrice: stock.currentPrice,
           _api_c2_highPrice: stock.highPrice,
           _api_c2_lowPrice: stock.lowPrice,
           _api_c2_openPrice: stock.openPrice,
           _api_c2_prevClosePrice: stock.prevClosePrice,
           _api_c2_entryTimingLabel: stock.entryTimingLabel,
           _api_c2_marketCap: stock.marketCap,
           _api_c2_peRatio: stock.peRatio,
           _api_c2_pbRatio: stock.pbRatio,
           _api_c2_dividendYield: stock.dividendYield,
           _api_c2_dividendGrowth5yr: stock.dividendGrowth5yr,
           _api_c2_fiftyTwoWeekHigh: stock.fiftyTwoWeekHigh,
           _api_c2_fiftyTwoWeekLow: stock.fiftyTwoWeekLow,
           _api_c2_epsTrailing: stock.epsTrailingTwelveMonths,
           _api_c2_epsForward: stock.epsForward,
           _api_c2_epsGrowthRate: stock.epsGrowthRate,
           _api_c2_debtEquityRatio: stock.debtEquityRatio,
           _api_c2_beta: stock.beta,
           _api_c2_movingAverage50d: stock.movingAverage50d,
           _api_c2_movingAverage200d: stock.movingAverage200d,
           _api_c2_fundamentalSummary: stock.fundamentalSummary,
           _api_c2_valuationSummary: stock.valuationSummary,

           // 📈 Technical Indicators
           _api_c2_rsi14: stock.rsi14,
           _api_c2_macd: stock.macd,
           _api_c2_macdSignal: stock.macdSignal,
           _api_c2_bollingerMid: stock.bollingerMid,
           _api_c2_bollingerUpper: stock.bollingerUpper,
           _api_c2_bollingerLower: stock.bollingerLower,
           _api_c2_stochasticK: stock.stochasticK,
           _api_c2_stochasticD: stock.stochasticD,
           _api_c2_obv: stock.obv,
           _api_c2_atr14: stock.atr14,
           _api_c2_technicalSummary: stock.technicalSummary,

           // 🔮 Prediction & Strategy
           _api_c2_prediction: stock.prediction,
           _api_c2_stopLoss: stock.stopLoss,
           _api_c2_targetPrice: stock.targetPrice,
           _api_c2_growthPotential: stock.growthPotential,
           _api_c2_score: stock.score,
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
/**
 * Helper functions for robust statistics.
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
 * Custom Huber loss function.
 * Delta is the threshold at which to change from quadratic to linear.
 */
function customHuberLoss(delta = 1.0) {
  return function(yTrue, yPred) {
    const error = yTrue.sub(yPred).abs();
    const quadratic = tf.minimum(error, delta);
    const linear = error.sub(quadratic);
    return tf.add(tf.mul(0.5, tf.square(quadratic)), tf.mul(delta, linear)).mean();
  }
}

/**
 * Prepares training data for direct 30-day ahead price prediction.
 * The model now works with log prices. Each training sample consists of a 30-day sequence of:
 * [logPrice, volume, SMA_logPrice, dailyLogReturn] (robustly normalized),
 * and a target: the logPrice 30 days after the end of the sequence.
 */
function prepareDataFor30DayAheadPrice(data, sequenceLength = 30, predictionGap = 30) {
  if (data.length < sequenceLength + predictionGap) {
    throw new Error(`Not enough data to create sequences for prediction.`);
  }

  // Extract raw arrays.
  const prices = data.map(item => item.price);
  const volumes = data.map(item => item.volume);
  
  // Convert prices to log scale.
  const logPrices = prices.map(p => Math.log(p));
  
  // Compute additional features on log scale.
  const sma7 = computeSMA(logPrices, 7);
  const dailyLogReturn = computeDailyLogReturn(logPrices);

  // Use training portion (excluding prediction gap) to compute robust parameters for logPrices.
  const trainLogPricesRaw = logPrices.slice(0, logPrices.length - predictionGap);
  const trainVolumesRaw = volumes.slice(0, volumes.length - predictionGap);
  const trainSMA_raw = sma7.slice(0, sma7.length - predictionGap);
  const trainReturnRaw = dailyLogReturn.slice(0, dailyLogReturn.length - predictionGap);

  // Winsorize each feature.
  const { winsorized: trainLogPrices, lower: lowerLogPrice, upper: upperLogPrice } = winsorizeArray(trainLogPricesRaw);
  const { winsorized: trainVolumes, lower: lowerVolume, upper: upperVolume } = winsorizeArray(trainVolumesRaw);
  const { winsorized: trainSMA, lower: lowerSMA, upper: upperSMA } = winsorizeArray(trainSMA_raw);
  const { winsorized: trainReturn, lower: lowerReturn, upper: upperReturn } = winsorizeArray(trainReturnRaw);

  // Compute robust statistics on winsorized training data.
  const medianLogPrice = computeMedian(trainLogPrices);
  const iqrLogPrice = computeIQR(trainLogPrices);
  const medianVolume = computeMedian(trainVolumes);
  const iqrVolume = computeIQR(trainVolumes);
  const medianSMA = computeMedian(trainSMA);
  const iqrSMA = computeIQR(trainSMA);
  const medianReturn = computeMedian(trainReturn);
  const iqrReturn = computeIQR(trainReturn);

  // Store winsorization bounds.
  const metaBounds = {
    logPrice: { lower: lowerLogPrice, upper: upperLogPrice },
    volume: { lower: lowerVolume, upper: upperVolume },
    sma: { lower: lowerSMA, upper: upperSMA },
    return: { lower: lowerReturn, upper: upperReturn }
  };

  // Helper normalization function: winsorize first, then robust normalize.
  const normalize = (val, median, iqr, lower, upper) =>
    (winsorizeVal(val, lower, upper) - median) / (iqr || 1);

  const inputs = [];
  const outputs = [];

  // Build training sequences.
  for (let i = 0; i <= data.length - sequenceLength - predictionGap; i++) {
    const seq = [];
    for (let j = 0; j < sequenceLength; j++) {
      // Use logPrice for the price feature.
      seq.push([
        normalize(Math.log(prices[i + j]), medianLogPrice, iqrLogPrice, lowerLogPrice, upperLogPrice),
        normalize(volumes[i + j], medianVolume, iqrVolume, lowerVolume, upperVolume),
        normalize(sma7[i + j], medianSMA, iqrSMA, lowerSMA, upperSMA),
        normalize(dailyLogReturn[i + j], medianReturn, iqrReturn, lowerReturn, upperReturn)
      ]);
    }
    inputs.push(seq);

    // Target: logPrice 30 days after sequence end.
    const targetLogPrice = Math.log(prices[i + sequenceLength + predictionGap - 1]);
    outputs.push(normalize(targetLogPrice, medianLogPrice, iqrLogPrice, lowerLogPrice, upperLogPrice));
  }

  // Convert inputs and outputs to tensors.
  const inputTensor = tf.tensor3d(inputs, [inputs.length, sequenceLength, 4]);
  const outputTensor = tf.tensor2d(outputs, [outputs.length, 1]);

  const meta = {
    medianLogPrice,
    iqrLogPrice,
    medianVolume,
    iqrVolume,
    medianSMA,
    iqrSMA,
    medianReturn,
    iqrReturn,
    bounds: metaBounds,
    // Save the last known actual price.
    lastKnownPrice: prices[prices.length - 1]
  };

  return { inputTensor, outputTensor, meta };
}

/**
 * Trains a model to predict the logPrice 30 days ahead.
 */
async function trainModelFor30DayAheadPrice(data) {
  const sequenceLength = 30;
  const predictionGap = 30;
  const { inputTensor, outputTensor, meta } = prepareDataFor30DayAheadPrice(data, sequenceLength, predictionGap);

  const model = tf.sequential();
  model.add(
    tf.layers.lstm({
      units: 64,
      inputShape: [sequenceLength, 4],
      returnSequences: false,
      kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
      recurrentRegularizer: tf.regularizers.l2({ l2: 0.01 }),
    })
  );
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.dense({ units: 1 }));

  model.compile({ optimizer: tf.train.adam(), loss: customHuberLoss(1.0) });

  console.log('Training model for 30-day ahead log-price prediction with robust preprocessing...');
  const earlyStopping = tf.callbacks.earlyStopping({
    monitor: 'val_loss',
    patience: 5,
  });

  await model.fit(inputTensor, outputTensor, {
    epochs: 50,
    batchSize: 32,
    validationSplit: 0.2,
    callbacks: [earlyStopping],
  });
  console.log('Training completed.');

  return { model, meta };
}

/**
 * Predicts the stock price 30 days ahead using the trained model.
 * Applies the same winsorization and robust normalization on log-prices.
 */
async function predict30DayAheadPrice(modelObj, data) {
  const { model, meta } = modelObj;
  const { medianLogPrice, iqrLogPrice, medianVolume, iqrVolume, medianSMA, iqrSMA, medianReturn, iqrReturn, bounds, lastKnownPrice } = meta;
  const sequenceLength = 30;

  // Extract recent data.
  const recentData = data.slice(-sequenceLength);
  const recentPrices = recentData.map(item => item.price);
  const recentVolumes = recentData.map(item => item.volume);
  
  // Compute logPrices, SMA, and daily log return for recent data.
  const recentLogPrices = recentPrices.map(p => Math.log(p));
  const smaRecent = computeSMA(recentLogPrices, 7);
  const returnRecent = computeDailyLogReturn(recentLogPrices);

  const normSeq = recentData.map((item, idx) => [
    (winsorizeVal(Math.log(item.price), bounds.logPrice.lower, bounds.logPrice.upper) - medianLogPrice) / (iqrLogPrice || 1),
    (winsorizeVal(item.volume, bounds.volume.lower, bounds.volume.upper) - medianVolume) / (iqrVolume || 1),
    (winsorizeVal(smaRecent[idx], bounds.sma.lower, bounds.sma.upper) - medianSMA) / (iqrSMA || 1),
    (winsorizeVal(returnRecent[idx], bounds.return.lower, bounds.return.upper) - medianReturn) / (iqrReturn || 1)
  ]);

  const inputTensor = tf.tensor3d([normSeq], [1, sequenceLength, 4]);
  const predNormLogPrice = model.predict(inputTensor).dataSync()[0];

  // Inverse transformation: get predicted log-price, then exponentiate.
  const predictedLogPrice = predNormLogPrice * iqrLogPrice + medianLogPrice;
  const predictedPrice = Math.exp(predictedLogPrice);

  return predictedPrice;
}

/**
 * Main orchestration function.
 */
export async function analyzeStock(ticker, historicalData) {
  try {
    if (historicalData.length < 365) {
      throw new Error(`Not enough data to train the model for ${ticker}.`);
    }

    const modelObj = await trainModelFor30DayAheadPrice(historicalData);
    const predictedPrice = await predict30DayAheadPrice(modelObj, historicalData);

    console.log(`Predicted 30-day ahead price for ${ticker}:`, predictedPrice);
    return predictedPrice;
  } catch (error) {
    console.error(`Error analyzing stock for ${ticker}:`, error.message);
    return null;
  }
}
