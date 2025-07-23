/**
 * Performs advanced (90-day) analysis including market structure, regime,
 * order flow, and institutional patterns to generate an ML-inspired score.
 *
 * @param {object} stock - The stock object.
 * @returns {object} An object containing the mlScore and other key analytical features.
 */
export function getLayer2MLAnalysis(stock, historicalData) {
  if (historicalData.length < 90) {
    return {
      mlScore: -5,
      features: [],
      longTermRegime: { type: "UNKNOWN" },
      shortTermRegime: { type: "UNKNOWN" },
    };
  }

  const recentData = historicalData
    .slice(-90)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  // 1. GATHER ALL DATA & ANALYSIS
  const microstructure = analyzeMicrostructure(recentData);
  const volumeProfile = analyzeVolumeProfile(recentData);
  const priceActionQuality = analyzePriceActionQuality(recentData);
  const hiddenDivergences = detectHiddenDivergences(stock, recentData);
  const volatilityRegime = analyzeVolatilityRegime(stock, recentData);
  const advancedPatterns = detectAdvancedPatterns(recentData, volatilityRegime);
  const orderFlow = inferOrderFlow(recentData);
  const extensionAnalysis = analyzeExtension(stock, recentData);
  const trendQuality = analyzeTrendQuality(stock, recentData);
  const momentumAnalysis = analyzeMomentumPersistence(stock, recentData);
  const institutionalPatterns = detectInstitutionalActivity(recentData);
  const longTermRegime = detectMarketRegime(historicalData);
  const shortTermRegime = detectMarketRegime(recentData);

  // 2. CALCULATE ML-INSPIRED SCORE
  const features = extractFeatureVector(
    microstructure,
    volumeProfile,
    priceActionQuality,
    hiddenDivergences,
    longTermRegime,
    advancedPatterns,
    volatilityRegime,
    orderFlow,
    extensionAnalysis,
    trendQuality,
    momentumAnalysis,
    institutionalPatterns
  );
  let mlScore = calculateMLScore(features);

  // 3. APPLY REGIME-BASED & CONTEXTUAL ADJUSTMENTS
  let regimeAdjustment = 0;
  const isLongDown =
    longTermRegime.type === "TRENDING" &&
    longTermRegime.characteristics.includes("DOWNTREND");
  const isLongUp =
    longTermRegime.type === "TRENDING" &&
    longTermRegime.characteristics.includes("UPTREND");
  const isShortDown =
    shortTermRegime.type === "TRENDING" &&
    shortTermRegime.characteristics.includes("DOWNTREND");
  const isShortRange = shortTermRegime.type === "RANGE_BOUND";
  const isShortUp =
    shortTermRegime.type === "TRENDING" &&
    shortTermRegime.characteristics.includes("UPTREND");

  if (isLongDown) {
    if (isShortDown) regimeAdjustment = -4.0;
    else if (isShortRange) regimeAdjustment = -1.5;
    else if (isShortUp) regimeAdjustment = 2.0;
  } else if (isLongUp) {
    if (isShortUp && !extensionAnalysis.parabolicMove) regimeAdjustment = 1.5;
    else if (isShortDown) regimeAdjustment = 0.5;
  } else if (longTermRegime.type === "RANGE_BOUND") {
    if (priceActionQuality.nearRangeLow) regimeAdjustment = 2.0;
    else if (priceActionQuality.nearRangeHigh) regimeAdjustment = -2.5;
  } else if (
    longTermRegime.type === "CHOPPY" ||
    longTermRegime.type === "UNKNOWN"
  ) {
    regimeAdjustment = -3.0;
  }
  mlScore += regimeAdjustment;

  // Contextual adjustments
  if (microstructure.bullishAuction && volumeProfile.pocRising) mlScore += 2.5;
  if (microstructure.sellerExhaustion && orderFlow.buyingPressure)
    mlScore += 3.0;
  if (hiddenDivergences.bullishHidden && trendQuality.isHealthyTrend)
    mlScore += 2.0;
  if (advancedPatterns.wyckoffSpring) mlScore += 3.5;
  if (advancedPatterns.threePushes && extensionAnalysis.isExtended)
    mlScore -= 3.0;
  if (volatilityRegime.compression && advancedPatterns.coiledSpring)
    mlScore += 2.5;

  return { mlScore, features, longTermRegime, shortTermRegime };
}




/* ──────────── NEW: Microstructure Analysis ──────────── */

function analyzeMicrostructure(data) {
    const analysis = {
      bullishAuction: false,
      bearishAuction: false,
      sellerExhaustion: false,
      buyerExhaustion: false,
      deltaProfile: "NEUTRAL",
    };
  
    if (data.length < 20) return analysis;
  
    // Analyze recent price/volume auction dynamics
    const recent = data.slice(-10);
    let bullishBars = 0,
      bearishBars = 0;
    let totalBullVolume = 0,
      totalBearVolume = 0;
  
    recent.forEach((bar, i) => {
      const range = bar.high - bar.low;
      const body = Math.abs(bar.close - bar.open);
      const upperWick = bar.high - Math.max(bar.close, bar.open);
      const lowerWick = Math.min(bar.close, bar.open) - bar.low;
  
      // Estimate buy/sell volume
      if (bar.close > bar.open) {
        bullishBars++;
        totalBullVolume += bar.volume * (body / range || 0.5);
  
        // Check for seller exhaustion (long lower wick)
        if (lowerWick > body * 2) {
          analysis.sellerExhaustion = true;
        }
      } else {
        bearishBars++;
        totalBearVolume += bar.volume * (body / range || 0.5);
  
        // Check for buyer exhaustion (long upper wick)
        if (upperWick > body * 2) {
          analysis.buyerExhaustion = true;
        }
      }
    });
  
    // Determine auction type
    const volumeRatio =
      totalBullVolume / (totalBullVolume + totalBearVolume || 1);
    analysis.bullishAuction = volumeRatio > 0.65 && bullishBars > bearishBars;
    analysis.bearishAuction = volumeRatio < 0.35 && bearishBars > bullishBars;
  
    // Delta profile
    if (volumeRatio > 0.7) analysis.deltaProfile = "STRONG_BULLISH";
    else if (volumeRatio > 0.55) analysis.deltaProfile = "BULLISH";
    else if (volumeRatio < 0.3) analysis.deltaProfile = "STRONG_BEARISH";
    else if (volumeRatio < 0.45) analysis.deltaProfile = "BEARISH";
  
    return analysis;
  }
  
  /* ──────────── NEW: Volume Profile Analysis ──────────── */
  
  function analyzeVolumeProfile(data) {
    const profile = {
      pocRising: false,
      pocFalling: false,
      highVolumeNode: null,
      lowVolumeNode: null,
      volumeTrend: "NEUTRAL",
    };
  
    if (data.length < 30) return profile;
  
    // Calculate average price for determining appropriate bucket size
    const avgPrice =
      data.slice(-30).reduce((sum, bar) => sum + (bar.high + bar.low) / 2, 0) /
      30;
  
    // Create price-volume histogram with percentage-based buckets
    const priceVolumes = {};
    const priceStepPercent = 0.005; // 0.5% buckets
    const priceStep = avgPrice * priceStepPercent;
  
    data.slice(-30).forEach((bar) => {
      const midPrice = (bar.high + bar.low) / 2;
      const bucket = Math.round(midPrice / priceStep) * priceStep;
      priceVolumes[bucket] = (priceVolumes[bucket] || 0) + bar.volume;
    });
  
    // Find Point of Control (POC) and Low Volume Node (LVN)
    let maxVolume = 0;
    let minVolume = Infinity;
    let poc = 0;
    let lvn = 0;
  
    Object.entries(priceVolumes).forEach(([price, volume]) => {
      const priceNum = parseFloat(price);
      if (volume > maxVolume) {
        maxVolume = volume;
        poc = priceNum;
      }
      if (volume < minVolume && volume > 0) {
        minVolume = volume;
        lvn = priceNum;
      }
    });
  
    // Check if POC is rising or falling
    const recentPrices = data.slice(-10).map((d) => d.close);
    const avgRecentPrice =
      recentPrices.reduce((a, b) => a + b) / recentPrices.length;
  
    profile.pocRising = poc < avgRecentPrice;
    profile.pocFalling = poc > avgRecentPrice;
    profile.highVolumeNode = poc;
    profile.lowVolumeNode = lvn;
  
    // Volume trend analysis
    const vol10 = data.slice(-10).reduce((sum, d) => sum + d.volume, 0) / 10;
    const vol30 = data.slice(-30).reduce((sum, d) => sum + d.volume, 0) / 30;
  
    if (vol10 > vol30 * 1.2) profile.volumeTrend = "INCREASING";
    else if (vol10 < vol30 * 0.8) profile.volumeTrend = "DECREASING";
  
    return profile;
  }
  
  /* ──────────── NEW: Price Action Quality ──────────── */
  
  function analyzePriceActionQuality(data) {
    const quality = {
      clean: false,
      choppy: false,
      impulsive: false,
      corrective: false,
      nearRangeHigh: false,
      nearRangeLow: false,
      trendEfficiency: 0,
    };
  
    if (data.length < 20) return quality;
  
    const prices = data.map((d) => d.close);
    const highs = data.map((d) => d.high);
    const lows = data.map((d) => d.low);
  
    // Calculate trend efficiency (directional movement / total movement)
    const startPrice = prices[prices.length - 20];
    const endPrice = prices[prices.length - 1];
    const directionalMove = Math.abs(endPrice - startPrice);
  
    let totalMove = 0;
    for (let i = prices.length - 19; i < prices.length; i++) {
      totalMove += Math.abs(prices[i] - prices[i - 1]);
    }
  
    quality.trendEfficiency = totalMove > 0 ? directionalMove / totalMove : 0;
  
    // Determine action type
    quality.clean = quality.trendEfficiency > 0.7;
    quality.choppy = quality.trendEfficiency < 0.3;
    quality.impulsive =
      quality.trendEfficiency > 0.6 &&
      Math.abs(endPrice - startPrice) / startPrice > 0.05;
    quality.corrective =
      quality.trendEfficiency < 0.5 &&
      Math.abs(endPrice - startPrice) / startPrice < 0.03;
  
    // Range analysis
    const rangeHigh = Math.max(...highs.slice(-20));
    const rangeLow = Math.min(...lows.slice(-20));
    const currentPrice = prices[prices.length - 1];
  
    quality.nearRangeHigh =
      currentPrice > rangeLow + (rangeHigh - rangeLow) * 0.8;
    quality.nearRangeLow = currentPrice < rangeLow + (rangeHigh - rangeLow) * 0.2;
  
    return quality;
  }
  
  /* ──────────── NEW: Hidden Divergence Detection ──────────── */
  
  function detectHiddenDivergences(stock, data) {
    const divergences = {
      bullishHidden: false,
      bearishHidden: false,
      strength: 0,
    };
  
    if (data.length < 30 || !stock.rsi14) return divergences;
  
    // For hidden divergences, we need to calculate RSI history
    // Simplified version using price momentum as proxy
    const prices = data.map((d) => d.close);
    const currentRSI = stock.rsi14;
  
    // Find recent swing points
    const swingLows = [];
    const swingHighs = [];
  
    for (let i = 5; i < data.length - 5; i++) {
      if (
        prices[i] < prices[i - 2] &&
        prices[i] < prices[i + 2] &&
        prices[i] < prices[i - 4] &&
        prices[i] < prices[i + 4]
      ) {
        swingLows.push({ index: i, price: prices[i] });
      }
      if (
        prices[i] > prices[i - 2] &&
        prices[i] > prices[i + 2] &&
        prices[i] > prices[i - 4] &&
        prices[i] > prices[i + 4]
      ) {
        swingHighs.push({ index: i, price: prices[i] });
      }
    }
  
    // Check for hidden bullish divergence (higher low in price, lower low in momentum)
    if (swingLows.length >= 2) {
      const recent = swingLows[swingLows.length - 1];
      const previous = swingLows[swingLows.length - 2];
  
      if (recent.price > previous.price) {
        // Price made higher low, check if momentum made lower low
        const recentMomentum = calculateMomentumAtPoint(data, recent.index);
        const previousMomentum = calculateMomentumAtPoint(data, previous.index);
  
        if (recentMomentum < previousMomentum) {
          divergences.bullishHidden = true;
          divergences.strength = Math.abs(recentMomentum - previousMomentum);
        }
      }
    }
  
    // Check for hidden bearish divergence (lower high in price, higher high in momentum)
    if (swingHighs.length >= 2) {
      const recent = swingHighs[swingHighs.length - 1];
      const previous = swingHighs[swingHighs.length - 2];
  
      if (recent.price < previous.price) {
        // Price made lower high, check if momentum made higher high
        const recentMomentum = calculateMomentumAtPoint(data, recent.index);
        const previousMomentum = calculateMomentumAtPoint(data, previous.index);
  
        if (recentMomentum > previousMomentum) {
          divergences.bearishHidden = true;
          // Use the maximum strength if both divergences present
          divergences.strength = Math.max(
            divergences.strength,
            Math.abs(recentMomentum - previousMomentum)
          );
        }
      }
    }
  
    return divergences;
  }
  
  /* ──────────── NEW: Market Regime Detection ──────────── */
  
  /* ──────────── NEW: Market Regime Detection (Version 2 - Long-Term View) ──────────── */
  
  function detectMarketRegime(historicalData) {
    const regime = {
      type: "UNKNOWN",
      strength: 0,
      volatility: "NORMAL",
      characteristics: [],
    };
  
    // We need at least 60 days of data for a meaningful regime assessment.
    if (historicalData.length < 60) {
      regime.type = "UNKNOWN";
      regime.characteristics.push("INSUFFICIENT_HISTORY");
      return regime;
    }
  
    // Use up to 1 year of data for the analysis
    const data = historicalData.slice(-252);
    const prices = data.map((d) => d.close);
    const returns = [];
  
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
  
    const avgReturn = returns.reduce((a, b) => a + b) / returns.length;
    // Calculate standard deviation of daily returns
    const dailyVolatility = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
        (returns.length - 1)
    );
    // Annualize it for a more stable metric
    const annualVolatility = dailyVolatility * Math.sqrt(252);
  
    const xValues = Array.from({ length: prices.length }, (_, i) => i);
    const { slope, r2 } = linearRegression(xValues, prices);
  
    // Classify regime based on the provided data's timeframe
    if (r2 > 0.4 && slope > 0) {
      regime.type = "TRENDING";
      regime.strength = r2;
      regime.characteristics.push("UPTREND");
    } else if (r2 > 0.4 && slope < 0) {
      regime.type = "TRENDING";
      regime.strength = r2;
      regime.characteristics.push("DOWNTREND");
    } else if (annualVolatility < 0.25) {
      // Volatility less than 25% annually
      regime.type = "RANGE_BOUND";
      regime.strength = 1 - annualVolatility;
      regime.characteristics.push("LOW_VOLATILITY");
    } else {
      regime.type = "CHOPPY";
      regime.strength = annualVolatility;
      regime.characteristics.push("HIGH_VOLATILITY");
    }
  
    // Volatility classification
    if (annualVolatility > 0.45) regime.volatility = "HIGH";
    else if (annualVolatility < 0.25) regime.volatility = "LOW";
  
    return regime;
  }
  
  /* ──────────── NEW: Advanced Pattern Detection ──────────── */
  
  function detectAdvancedPatterns(data, volatilityRegime) {
    const patterns = {
      wyckoffSpring: false,
      wyckoffUpthrust: false,
      threePushes: false,
      coiledSpring: false,
      failedBreakout: false,
      successfulRetest: false,
    };
  
    if (data.length < 30) return patterns;
  
    const highs = data.map((d) => d.high);
    const lows = data.map((d) => d.low);
    const closes = data.map((d) => d.close);
    const volumes = data.map((d) => d.volume);
  
    // Wyckoff Spring (false breakdown with volume)
    const recentLows = lows.slice(-20);
    const supportLevel = Math.min(...recentLows.slice(0, 15));
    const last5Days = data.slice(-5);
  
    const springCandidate = last5Days.find(
      (d) =>
        d.low < supportLevel * 0.99 &&
        d.close > supportLevel &&
        d.volume > (volumes.slice(-20, -5).reduce((a, b) => a + b) / 15) * 1.5
    );
  
    if (springCandidate && closes[closes.length - 1] > supportLevel * 1.01) {
      patterns.wyckoffSpring = true;
    }
  
    // Three Pushes Pattern (exhaustion)
    const pushes = findPushes(highs.slice(-30));
    if (pushes.length >= 3 && pushes[pushes.length - 1].declining) {
      patterns.threePushes = true;
    }
  
    // Coiled Spring - use the unified volatility analysis
    patterns.coiledSpring =
      volatilityRegime.compression &&
      (volatilityRegime.cyclePhase === "COMPRESSION_ONGOING" ||
        volatilityRegime.cyclePhase === "EXPANSION_STARTING");
  
    return patterns;
  }
  
  /* ──────────── NEW: Volatility Regime Analysis ──────────── */
  
  function analyzeVolatilityRegime(stock, data) {
    const analysis = {
      regime: "NORMAL",
      compression: false,
      expansion: false,
      cyclePhase: "UNKNOWN",
      bollingerSqueeze: false,
    };
  
    if (data.length < 30) return analysis;
  
    const atr = stock.atr14 || calculateATR(data.slice(-14));
    const historicalATRs = [];
  
    // Calculate rolling ATRs
    for (let i = 30; i < data.length; i++) {
      historicalATRs.push(calculateATR(data.slice(i - 14, i)));
    }
  
    if (historicalATRs.length === 0) return analysis;
  
    const avgATR = historicalATRs.reduce((a, b) => a + b) / historicalATRs.length;
    const currentATRRatio = atr / avgATR;
  
    // Classify volatility regime
    if (currentATRRatio < 0.7) {
      analysis.regime = "LOW";
      analysis.compression = true;
    } else if (currentATRRatio > 1.3) {
      analysis.regime = "HIGH";
      analysis.expansion = true;
    }
  
    // Bollinger Band squeeze detection
    const bbWidth =
      (stock.bollingerUpper - stock.bollingerLower) / stock.bollingerMid;
    if (bbWidth < 0.05) {
      analysis.bollingerSqueeze = true;
    }
  
    // Volatility cycle phase
    if (
      analysis.compression &&
      historicalATRs[historicalATRs.length - 1] <
        historicalATRs[historicalATRs.length - 2]
    ) {
      analysis.cyclePhase = "COMPRESSION_ONGOING";
    } else if (
      analysis.compression &&
      historicalATRs[historicalATRs.length - 1] >
        historicalATRs[historicalATRs.length - 2]
    ) {
      analysis.cyclePhase = "EXPANSION_STARTING";
    }
  
    return analysis;
  }
  
  

  /* ──────────── NEW: Order Flow Inference ──────────── */

function inferOrderFlow(data) {
    const flow = {
      buyingPressure: false,
      sellingPressure: false,
      absorption: false,
      imbalance: 0,
    };
  
    if (data.length < 10) return flow;
  
    const recent = data.slice(-10);
    let buyVolume = 0,
      sellVolume = 0;
    let absorption = 0;
  
    recent.forEach((bar, i) => {
      const range = bar.high - bar.low;
      const closePosition = range > 0 ? (bar.close - bar.low) / range : 0.5;
  
      // Estimate buy/sell volume
      buyVolume += bar.volume * closePosition;
      sellVolume += bar.volume * (1 - closePosition);
  
      // Check for absorption (high volume, small price movement)
      if (
        bar.volume > (recent.reduce((sum, d) => sum + d.volume, 0) / 10) * 1.5 &&
        range < bar.close * 0.01
      ) {
        absorption++;
      }
    });
  
    flow.imbalance = (buyVolume - sellVolume) / (buyVolume + sellVolume);
    flow.buyingPressure = flow.imbalance > 0.2;
    flow.sellingPressure = flow.imbalance < -0.2;
    flow.absorption = absorption >= 2;
  
    return flow;
  }
  


  /* ──────────── V4 ANALYSIS FUNCTIONS (IMPLEMENTATION) ──────────── */

/**
 * Analyzes how far a stock's price has extended from its mean.
 * @returns {{isExtended: boolean, parabolicMove: boolean}}
 */
function analyzeExtension(stock, recentData) {
    if (recentData.length < 20) {
      return { isExtended: false, parabolicMove: false };
    }
  
    const closes = recentData.map((d) => d.close);
    const currentPrice = closes[closes.length - 1];
  
    // Calculate 20-day Simple Moving Average
    const sma20 = closes.slice(-20).reduce((sum, val) => sum + val, 0) / 20;
  
    // 1. Check if price is "extended" from its 20-day average
    const distanceFromMean = ((currentPrice - sma20) / sma20) * 100;
    const isExtended = distanceFromMean > 15; // Extended if >15% above 20-day SMA
  
    // 2. Check for a parabolic (accelerating) move
    const changeLast5Days =
      closes[closes.length - 1] / closes[closes.length - 6] - 1;
    const changePrev5Days =
      closes[closes.length - 6] / closes[closes.length - 11] - 1;
    const parabolicMove =
      changeLast5Days > changePrev5Days * 2 && changeLast5Days > 0.08; // Recent 5-day gain is >2x the previous and >8%
  
    return { isExtended, parabolicMove };
  }
  
  /**
   * Assesses the quality and strength of the current trend using ADX.
   * @returns {{isHealthyTrend: boolean, trendStrength: number}}
   */
  function analyzeTrendQuality(stock, recentData) {
    if (recentData.length < 30) {
      // ADX needs at least 28 periods
      return { isHealthyTrend: false, trendStrength: 0 };
    }
  
    // Calculate ADX (Average Directional Index)
    const adxResult = _calculateADX(recentData.slice(-30), 14);
    const currentADX = adxResult[adxResult.length - 1].adx;
  
    const trendStrength = currentADX || 0;
    const isHealthyTrend = trendStrength > 25; // ADX > 25 indicates a strong trend
  
    return { isHealthyTrend, trendStrength };
  }
  
  /**
   * Checks if momentum has been persistent over time.
   * @returns {{persistentStrength: number}}
   */
  function analyzeMomentumPersistence(stock, recentData) {
    if (recentData.length < 20) {
      return { persistentStrength: 0 };
    }
  
    const closes = recentData.map((d) => d.close);
  
    // Calculate RSI for the recent period
    const rsiValues = _calculateRSI(closes, 14);
    const recentRSI = rsiValues.slice(-10); // Look at last 10 days of RSI
  
    // Calculate how many of the last 10 days RSI was above 55 (sign of bullish momentum)
    const daysRsiBullish = recentRSI.filter((rsi) => rsi > 55).length;
  
    // A score from 0 to 1 based on how persistent the bullish RSI has been
    const persistentStrength = daysRsiBullish / 10.0;
  
    return { persistentStrength };
  }
  
  /**
   * Detects signs of institutional buying (accumulation).
   * @returns {{accumulationDays: number, distributionDays: number, isAccumulating: boolean}}
   */
  function detectInstitutionalActivity(recentData) {
    if (recentData.length < 51) {
      return { accumulationDays: 0, distributionDays: 0, isAccumulating: false };
    }
  
    const relevantData = recentData.slice(-51); // Need 50 days for moving average + 1 day
    const avgVolume50 =
      relevantData.slice(0, 50).reduce((sum, day) => sum + day.volume, 0) / 50;
  
    let accumulationDays = 0;
    let distributionDays = 0;
  
    // Analyze the last 25 days for institutional activity
    const checkData = recentData.slice(-25);
  
    checkData.forEach((day, i) => {
      if (i === 0) return;
      const prevDay = checkData[i - 1];
  
      // Check for high volume
      if (day.volume > avgVolume50 * 1.5) {
        if (day.close > prevDay.close) {
          accumulationDays++;
        } else if (day.close < prevDay.close) {
          distributionDays++;
        }
      }
    });
  
    const isAccumulating = accumulationDays > distributionDays + 2;
  
    return { accumulationDays, distributionDays, isAccumulating };
  }



  
  /* ──────────── HELPER FUNCTIONS FOR V4 ANALYSIS ──────────── */

/**
 * Calculates Relative Strength Index (RSI).
 */
function _calculateRSI(prices, period) {
    let gains = 0;
    let losses = 0;
    const rsi = [];
  
    // Calculate initial average gains and losses
    for (let i = 1; i <= period; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff >= 0) {
        gains += diff;
      } else {
        losses -= diff;
      }
    }
  
    let avgGain = gains / period;
    let avgLoss = losses / period;
  
    for (let i = period; i < prices.length; i++) {
      const rs = avgGain / (avgLoss || 1);
      rsi.push(100 - 100 / (1 + rs));
  
      const diff = prices[i] - prices[i - 1];
      let currentGain = 0;
      let currentLoss = 0;
  
      if (diff >= 0) {
        currentGain = diff;
      } else {
        currentLoss = -diff;
      }
  
      avgGain = (avgGain * (period - 1) + currentGain) / period;
      avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
    }
    return rsi;
  }
  


  
  /**
 * Calculates Average Directional Index (ADX).
 */
function _calculateADX(data, period) {
    const trs = [];
    const plusDMs = [];
    const minusDMs = [];
  
    // Step 1: Calculate True Range (TR), +DM, -DM
    for (let i = 1; i < data.length; i++) {
      const high = data[i].high;
      const low = data[i].low;
      const close = data[i].close;
      const prevHigh = data[i - 1].high;
      const prevLow = data[i - 1].low;
      const prevClose = data[i - 1].close;
  
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trs.push(tr);
  
      const upMove = high - prevHigh;
      const downMove = prevLow - low;
  
      plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }
  
    // Helper for Wilder's Smoothing
    const wilderSmooth = (arr, p) => {
      const smoothed = [];
      let sum = arr.slice(0, p).reduce((a, b) => a + b, 0);
      smoothed.push(sum);
      for (let i = p; i < arr.length; i++) {
        sum =
          smoothed[smoothed.length - 1] -
          smoothed[smoothed.length - 1] / p +
          arr[i];
        smoothed.push(sum);
      }
      return smoothed;
    };
  
    const smoothedTR = wilderSmooth(trs, period);
    const smoothedPlusDM = wilderSmooth(plusDMs, period);
    const smoothedMinusDM = wilderSmooth(minusDMs, period);
  
    const plusDIs = [];
    const minusDIs = [];
  
    for (let i = 0; i < smoothedTR.length; i++) {
      plusDIs.push(100 * (smoothedPlusDM[i] / (smoothedTR[i] || 1)));
      minusDIs.push(100 * (smoothedMinusDM[i] / (smoothedTR[i] || 1)));
    }
  
    const dxs = [];
    for (let i = 0; i < plusDIs.length; i++) {
      const dx =
        100 *
        (Math.abs(plusDIs[i] - minusDIs[i]) / (plusDIs[i] + minusDIs[i] || 1));
      dxs.push(dx);
    }
  
    const adxValues = wilderSmooth(dxs, period).map((val) => val / period);
  
    return data
      .slice(-adxValues.length)
      .map((d, i) => ({ ...d, adx: adxValues[i] }));
  }


  
  


  /* ──────────── Feature Extraction ──────────── */

function extractFeatureVector(...analyses) {
    // Flatten all analysis objects into a feature vector
    const features = {};
  
    analyses.forEach((analysis, idx) => {
      Object.entries(analysis).forEach(([key, value]) => {
        if (typeof value === "boolean") {
          features[`f${idx}_${key}`] = value ? 1 : 0;
        } else if (typeof value === "number") {
          features[`f${idx}_${key}`] = value;
        } else if (typeof value === "string") {
          // One-hot encode string values
          features[`f${idx}_${key}_${value}`] = 1;
        }
      });
    });
  
    return features;
  }
  
/* ──────────── ML-Inspired Scoring ──────────── */

function calculateMLScore(features) {
    // Simulate a gradient boosted tree scoring mechanism
    let score = 0;
  
    let qualityHurdle = 0;
    // Note: These feature numbers (f2, f9, f4) correspond to the order you pass them into extractFeatureVector.
    // f2 = priceActionQuality, f9 = trendQuality, f4 = marketRegime
    if (features.f2_clean) qualityHurdle++; // Is the price action smooth?
    if (features.f9_isHealthyTrend) qualityHurdle++; // Is the ADX strong?
    if (features.f4_type_TRENDING) qualityHurdle++; // Is the regime trending?
  
    if (qualityHurdle < 2) {
      // If it fails 2 or more quality checks, start with a penalty.
      score -= 2.0;
    }
  
    // High-impact feature combinations (learned patterns)
    if (
      features.f0_bullishAuction &&
      features.f1_pocRising &&
      features.f2_clean
    ) {
      score += 3.5; // Strong bullish setup
    }
  
    if (features.f3_bullishHidden && features.f9_isHealthyTrend) {
      score += 2.8; // Hidden divergence in uptrend
    }
  
    if (features.f3_bearishHidden && features.f8_isExtended) {
      score -= 2.8; // Hidden divergence in extended move - continuation of selling
    }
  
    if (features.f5_wyckoffSpring && features.f7_buyingPressure) {
      score += 4.0; // High probability reversal
    }
  
    if (features.f0_sellerExhaustion && features.f6_compression) {
      score += 2.5; // Volatility breakout setup
    }
  
    // Negative patterns
    if (features.f5_threePushes && features.f8_parabolicMove) {
      score -= 4.0; // Exhaustion
    }
  
    if (features.f0_bearishAuction && features.f1_pocFalling) {
      score -= 3.0; // Distribution
    }
  
    // Non-linear interactions
    const momentumScore =
      (features.f10_persistentStrength || 0) *
      (1 + (features.f9_trendStrength || 0) / 10);
    score += momentumScore;
  
    // Volatility adjustments
    if (features.f6_EXPANSION_STARTING && features.f2_impulsive) {
      score *= 1.3; // Boost for breakout conditions
    }
  
    return score;
  }
  

  
/* ──────────── Helper Functions ──────────── */

function calculateMomentumAtPoint(data, index) {
    if (index < 5 || index >= data.length) return 0;
  
    const price = data[index].close;
    const priceAgo = data[index - 5].close;
    return (price - priceAgo) / priceAgo;
  }
  


  
function linearRegression(x, y) {
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b);
  const sumY = y.reduce((a, b) => a + b);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Calculate R-squared
  const yMean = sumY / n;
  const ssTotal = y.reduce((sum, yi) => sum + Math.pow(yi - yMean, 2), 0);
  const ssResidual = y.reduce(
    (sum, yi, i) => sum + Math.pow(yi - (slope * x[i] + intercept), 2),
    0
  );
  const r2 = 1 - ssResidual / ssTotal;

  return { slope, intercept, r2 };
}



function findPushes(prices) {
  const pushes = [];
  let currentPush = null;

  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > prices[i - 1]) {
      if (!currentPush) {
        currentPush = { start: i - 1, startPrice: prices[i - 1] };
      }
    } else if (currentPush) {
      currentPush.end = i - 1;
      currentPush.endPrice = prices[i - 1];
      currentPush.gain =
        (currentPush.endPrice - currentPush.startPrice) /
        currentPush.startPrice;
      pushes.push(currentPush);
      currentPush = null;
    }
  }

  // Check if pushes are declining
  if (pushes.length >= 2) {
    const lastPush = pushes[pushes.length - 1];
    const prevPush = pushes[pushes.length - 2];
    lastPush.declining = lastPush.gain < prevPush.gain;
  }

  return pushes;
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
  