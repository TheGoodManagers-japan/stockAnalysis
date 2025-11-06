// ================== DEEP MARKET ANALYSIS (Layer 2) ==================
// deepMarketAnalysis.js

/**
 * Performs advanced (90-day) analysis including market structure, regime,
 * order flow, and institutional patterns to generate deep market insights.
 *
 * @param {object} stock - The stock object.
 * @param {array} historicalData - OHLCV array.
 * @returns {{ mlScore:number, features:Object, longTermRegime:Object, shortTermRegime:Object }}
 */
export function getDeepMarketAnalysis(stock, historicalData) {
  // Soften behavior on thin history so the orchestrator doesn't auto-veto
  if (!historicalData || historicalData.length < 90) {
    return {
      mlScore: -0.5, // mild caution only
      features: { f4_characteristics_INSUFFICIENT_HISTORY: 1 },
      longTermRegime: {
        type: "UNKNOWN",
        characteristics: ["INSUFFICIENT_HISTORY"],
      },
      shortTermRegime: {
        type: "UNKNOWN",
        characteristics: ["INSUFFICIENT_HISTORY"],
      },
    };
  }

  // Sort entire history first, then take last 90 in chronological order
  const sortedAll = [...historicalData].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );
  const recentData = sortedAll.slice(-90);

  // 1) GATHER ALL DATA & ANALYSIS
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
  const longTermRegime = detectMarketRegime(sortedAll);
  const intermediateRegime = detectMarketRegime(recentData); // 30–90b context

  // 2) FEATURE VECTOR & BASE SCORE
  const features = extractFeatureVector(
    microstructure, // f0
    volumeProfile, // f1
    priceActionQuality, // f2
    hiddenDivergences, // f3
    longTermRegime, // f4
    advancedPatterns, // f5
    volatilityRegime, // f6
    orderFlow, // f7
    extensionAnalysis, // f8
    trendQuality, // f9
    momentumAnalysis, // f10
    detectInstitutionalActivity(recentData) // f11
  );

  let mlScore = calculateMLScore(features);

  // 3) REGIME-BASED & CONTEXTUAL ADJUSTMENTS (softened/polished)
  let regimeAdjustment = 0;
  const has = (arr, s) => Array.isArray(arr) && arr.includes(s);

  const isLongDown =
    longTermRegime.type === "TRENDING" &&
    has(longTermRegime.characteristics, "DOWNTREND");
  const isLongUp =
    longTermRegime.type === "TRENDING" &&
    has(longTermRegime.characteristics, "UPTREND");
  const isShortDown =
    shortTermRegime.type === "TRENDING" &&
    has(shortTermRegime.characteristics, "DOWNTREND");
  const isShortUp =
    shortTermRegime.type === "TRENDING" &&
    has(shortTermRegime.characteristics, "UPTREND");
  const isShortRange = shortTermRegime.type === "RANGE_BOUND";

  if (isLongDown) {
    if (isShortDown) regimeAdjustment = -3.0;
    else if (isShortRange) regimeAdjustment = -1.2;
    else if (isShortUp) regimeAdjustment = 1.5;
  } else if (isLongUp) {
    if (isShortUp && !extensionAnalysis.parabolicMove) regimeAdjustment = 1.5;
    else if (isShortDown) regimeAdjustment = 0.5;
  } else if (longTermRegime.type === "RANGE_BOUND") {
    if (priceActionQuality.nearRangeLow) regimeAdjustment = 1.5;
    else if (priceActionQuality.nearRangeHigh) regimeAdjustment = -2.0;
  } else if (longTermRegime.type === "CHOPPY") {
    regimeAdjustment = -Math.min(
      1.5,
      (longTermRegime.strength || 0) * 0.8 || 1.0
    );
  } else if (longTermRegime.type === "UNKNOWN") {
    regimeAdjustment = -0.8;
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

  const ltTier = mapRegimeToTier(longTermRegime, mlScore);

  return { mlScore, features, longTermRegime, intermediateRegime, ltTier }; // ← NEW field
}

/* ──────────── Microstructure ──────────── */
function analyzeMicrostructure(data) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const analysis = {
    bullishAuction: false,
    bearishAuction: false,
    sellerExhaustion: false,
    buyerExhaustion: false,
    deltaProfile: "NEUTRAL",
  };

  if (!data || data.length < 20) return analysis;

  const recent = data.slice(-10);
  let bullishBars = 0,
    bearishBars = 0;
  let totalBullVolume = 0,
    totalBearVolume = 0;

  recent.forEach((bar) => {
    const high = n(bar.high),
      low = n(bar.low),
      open = n(bar.open),
      close = n(bar.close),
      vol = n(bar.volume);
    const range = Math.max(0, high - low);
    const body = Math.abs(close - open);
    const upperWick = Math.max(0, high - Math.max(close, open));
    const lowerWick = Math.max(0, Math.min(close, open) - low);

    if (close > open) {
      bullishBars++;
      totalBullVolume += vol * (range > 0 ? body / range : 0.5);
      if (lowerWick > body * 2) analysis.sellerExhaustion = true;
    } else if (close < open) {
      bearishBars++;
      totalBearVolume += vol * (range > 0 ? body / range : 0.5);
      if (upperWick > body * 2) analysis.buyerExhaustion = true;
    }
  });

  const denom = totalBullVolume + totalBearVolume;
  const volumeRatio = denom > 0 ? totalBullVolume / denom : 0.5;

  analysis.bullishAuction = volumeRatio > 0.65 && bullishBars > bearishBars;
  analysis.bearishAuction = volumeRatio < 0.35 && bearishBars > bullishBars;

  if (volumeRatio > 0.7) analysis.deltaProfile = "STRONG_BULLISH";
  else if (volumeRatio > 0.55) analysis.deltaProfile = "BULLISH";
  else if (volumeRatio < 0.3) analysis.deltaProfile = "STRONG_BEARISH";
  else if (volumeRatio < 0.45) analysis.deltaProfile = "BEARISH";

  return analysis;
}

/* ──────────── Volume Profile ──────────── */
function analyzeVolumeProfile(data) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const profile = {
    pocRising: false,
    pocFalling: false,
    highVolumeNode: null,
    lowVolumeNode: null,
    volumeTrend: "NEUTRAL",
  };
  if (!data || data.length < 30) return profile;

  const last30 = data.slice(-30);
  const avgPrice =
    last30.reduce((s, d) => s + (n(d.high) + n(d.low)) / 2, 0) / 30;
  const priceStepPercent = 0.005;
  const priceStep = Math.max(1e-8, Math.abs(avgPrice) * priceStepPercent);

  const priceVolumes = {};
  last30.forEach((bar) => {
    const mid = (n(bar.high) + n(bar.low)) / 2;
    const bucket = Math.round(mid / priceStep) * priceStep;
    priceVolumes[bucket] = (priceVolumes[bucket] || 0) + n(bar.volume);
  });

  let maxVolume = -1,
    minVolume = Number.POSITIVE_INFINITY;
  let poc = null,
    lvn = null;

  Object.entries(priceVolumes).forEach(([price, vol]) => {
    const p = parseFloat(price);
    if (vol > maxVolume) {
      maxVolume = vol;
      poc = p;
    }
    if (vol > 0 && vol < minVolume) {
      minVolume = vol;
      lvn = p;
    }
  });

  const recentPrices = last30.slice(-10).map((d) => n(d.close));
  const avgRecentPrice =
    recentPrices.reduce((a, b) => a + b, 0) / Math.max(1, recentPrices.length);

  if (poc != null) {
    profile.pocRising = poc < avgRecentPrice;
    profile.pocFalling = poc > avgRecentPrice;
  }
  profile.highVolumeNode = poc;
  profile.lowVolumeNode = lvn;

  const vol10 = last30.slice(-10).reduce((s, d) => s + n(d.volume), 0) / 10;
  const vol30 = last30.reduce((s, d) => s + n(d.volume), 0) / 30;
  if (vol10 > vol30 * 1.2) profile.volumeTrend = "INCREASING";
  else if (vol10 < vol30 * 0.8) profile.volumeTrend = "DECREASING";

  return profile;
}

/* ──────────── Price Action Quality ──────────── */
function analyzePriceActionQuality(data) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const quality = {
    clean: false,
    choppy: false,
    impulsive: false,
    corrective: false,
    nearRangeHigh: false,
    nearRangeLow: false,
    trendEfficiency: 0,
  };
  if (!data || data.length < 20) return quality;

  const prices = data.map((d) => n(d.close));
  const highs = data.map((d) => n(d.high));
  const lows = data.map((d) => n(d.low));

  const startPrice = prices[prices.length - 20];
  const endPrice = prices[prices.length - 1];
  const directionalMove = Math.abs(endPrice - startPrice);

  let totalMove = 0;
  for (let i = prices.length - 19; i < prices.length; i++) {
    totalMove += Math.abs(prices[i] - prices[i - 1]);
  }

  quality.trendEfficiency = totalMove > 0 ? directionalMove / totalMove : 0;

  quality.clean = quality.trendEfficiency > 0.7;
  quality.choppy = quality.trendEfficiency < 0.3;
  quality.impulsive =
    quality.trendEfficiency > 0.6 &&
    Math.abs(endPrice - startPrice) / Math.max(1e-8, startPrice) > 0.05;
  quality.corrective =
    quality.trendEfficiency < 0.5 &&
    Math.abs(endPrice - startPrice) / Math.max(1e-8, startPrice) < 0.03;

  const rangeHigh = Math.max(...highs.slice(-20));
  const rangeLow = Math.min(...lows.slice(-20));
  const currentPrice = prices[prices.length - 1];

  quality.nearRangeHigh =
    currentPrice > rangeLow + (rangeHigh - rangeLow) * 0.8;
  quality.nearRangeLow = currentPrice < rangeLow + (rangeHigh - rangeLow) * 0.2;

  return quality;
}

/* ──────────── Hidden Divergences ──────────── */
function detectHiddenDivergences(stock, data) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const divergences = {
    bullishHidden: false,
    bearishHidden: false,
    strength: 0,
  };
  if (!data || data.length < 30 || !Number.isFinite(stock?.rsi14))
    return divergences;

  const prices = data.map((d) => n(d.close));
  const swingLows = [],
    swingHighs = [];

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

  if (swingLows.length >= 2) {
    const a = swingLows[swingLows.length - 2];
    const b = swingLows[swingLows.length - 1];
    if (b.price > a.price) {
      const mA = calculateMomentumAtPoint(data, a.index);
      const mB = calculateMomentumAtPoint(data, b.index);
      if (mB < mA) {
        divergences.bullishHidden = true;
        divergences.strength = Math.abs(mB - mA);
      }
    }
  }

  if (swingHighs.length >= 2) {
    const a = swingHighs[swingHighs.length - 2];
    const b = swingHighs[swingHighs.length - 1];
    if (b.price < a.price) {
      const mA = calculateMomentumAtPoint(data, a.index);
      const mB = calculateMomentumAtPoint(data, b.index);
      if (mB > mA) {
        divergences.bearishHidden = true;
        divergences.strength = Math.max(
          divergences.strength,
          Math.abs(mB - mA)
        );
      }
    }
  }

  return divergences;
}

/* ──────────── Market Regime ──────────── */
function detectMarketRegime(historicalData) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const regime = {
    type: "UNKNOWN",
    strength: 0,
    volatility: "NORMAL",
    characteristics: [],
  };
  if (!historicalData || historicalData.length < 60) {
    regime.characteristics.push("INSUFFICIENT_HISTORY");
    return regime;
  }

  const data = historicalData.slice(-252);
  const prices = data.map((d) => n(d.close));
  const returns = [];
  for (let i = 1; i < prices.length; i++)
    returns.push((prices[i] - prices[i - 1]) / Math.max(1e-8, prices[i - 1]));

  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const varSum = returns.reduce(
    (sum, r) => sum + Math.pow(r - avgReturn, 2),
    0
  );
  const dailyVolatility = Math.sqrt(varSum / Math.max(1, returns.length - 1));
  const annualVolatility = dailyVolatility * Math.sqrt(252);

  const xValues = Array.from({ length: prices.length }, (_, i) => i);
  const { slope, r2 } = linearRegression(xValues, prices);

  if (r2 > 0.4 && slope > 0) {
    regime.type = "TRENDING";
    regime.strength = r2;
    regime.characteristics.push("UPTREND");
  } else if (r2 > 0.4 && slope < 0) {
    regime.type = "TRENDING";
    regime.strength = r2;
    regime.characteristics.push("DOWNTREND");
  } else if (annualVolatility < 0.25) {
    regime.type = "RANGE_BOUND";
    regime.strength = Math.max(0, 1 - annualVolatility);
    regime.characteristics.push("LOW_VOLATILITY");
  } else {
    regime.type = "CHOPPY";
    regime.strength = annualVolatility;
    regime.characteristics.push("HIGH_VOLATILITY");
  }

  if (annualVolatility > 0.45) regime.volatility = "HIGH";
  else if (annualVolatility < 0.25) regime.volatility = "LOW";

  return regime;
}

/* ──────────── Advanced Patterns ──────────── */
function detectAdvancedPatterns(data, volatilityRegime) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const patterns = {
    wyckoffSpring: false,
    wyckoffUpthrust: false,
    threePushes: false,
    coiledSpring: false,
    failedBreakout: false,
    successfulRetest: false,
  };
  if (!data || data.length < 30) return patterns;

  const highs = data.map((d) => n(d.high));
  const lows = data.map((d) => n(d.low));
  const closes = data.map((d) => n(d.close));
  const volumes = data.map((d) => n(d.volume));

  // --- Wyckoff Spring
  const recentLows = lows.slice(-20);
  const supportLevel = Math.min(...recentLows.slice(0, 15));
  const last5 = data.slice(-5);
  const avgVol15 = volumes.slice(-20, -5).reduce((a, b) => a + b, 0) / 15 || 0;

  const springCandidate = last5.find(
    (d) =>
      n(d.low) < supportLevel * 0.99 &&
      n(d.close) > supportLevel &&
      n(d.volume) > avgVol15 * 1.5
  );
  if (springCandidate && closes[closes.length - 1] > supportLevel * 1.01) {
    patterns.wyckoffSpring = true;
  }

  // --- Upthrust / failed breakout / successful retest (resistance-based)
  const baseWindow = data.slice(-25, -5);
  if (baseWindow.length >= 5) {
    const resistance = Math.max(...baseWindow.map((d) => n(d.high)));
    const tol = 0.005; // 0.5%

    // Upthrust: pierce above resistance intraday, close back below, on higher volume
    const last3 = data.slice(-3);
    const upthrustBar = last3.find(
      (d) =>
        n(d.high) > resistance * (1 + tol) &&
        n(d.close) < resistance &&
        n(d.volume) > (avgVol15 || 1)
    );
    if (upthrustBar) patterns.wyckoffUpthrust = true;

    // Failed breakout: had a close above, then back below within 2 bars
    const last5Bars = data.slice(-5);
    const hadCloseAbove = last5Bars.some(
      (d) => n(d.close) > resistance * (1 + tol / 2)
    );
    const nowBelow = n(closes[closes.length - 1]) < resistance;
    if (hadCloseAbove && nowBelow) patterns.failedBreakout = true;

    // Successful retest: close > resistance but low tags resistance ±0.3%
    const today = data[data.length - 1];
    const retestTouched =
      n(today.low) <= resistance * 1.003 && n(today.low) >= resistance * 0.997;
    if (n(today.close) > resistance * (1 + tol / 2) && retestTouched) {
      patterns.successfulRetest = true;
    }
  }

  // --- Three pushes
  const pushes = findPushes(highs.slice(-30));
  if (pushes.length >= 3 && pushes[pushes.length - 1].declining)
    patterns.threePushes = true;

  // --- Coiled spring
  patterns.coiledSpring =
    Boolean(volatilityRegime?.compression) &&
    (volatilityRegime?.cyclePhase === "COMPRESSION_ONGOING" ||
      volatilityRegime?.cyclePhase === "EXPANSION_STARTING");

  return patterns;
}

/* ──────────── Volatility Regime ──────────── */
function analyzeVolatilityRegime(stock, data) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const analysis = {
    regime: "NORMAL",
    compression: false,
    expansion: false,
    cyclePhase: "UNKNOWN",
    bollingerSqueeze: false,
  };
  if (!data || data.length < 30) return analysis;

  const period = 14;
  const atr =
    Number.isFinite(stock?.atr14) && stock.atr14 > 0
      ? stock.atr14
      : calculateATR(data.slice(-(period + 1)), period); // need 15 bars for ATR(14)

  const historicalATRs = [];
  for (let i = period + 1; i <= data.length; i++) {
    const win = data.slice(i - (period + 1), i);
    historicalATRs.push(calculateATR(win, period));
  }
  if (historicalATRs.length === 0) return analysis;

  const avgATR =
    historicalATRs.reduce((a, b) => a + b, 0) / historicalATRs.length;
  const currentATRRatio = avgATR > 0 ? atr / avgATR : 1;

  if (currentATRRatio < 0.7) {
    analysis.regime = "LOW";
    analysis.compression = true;
  } else if (currentATRRatio > 1.3) {
    analysis.regime = "HIGH";
    analysis.expansion = true;
  }

  const upper = n(stock?.bollingerUpper),
    lower = n(stock?.bollingerLower),
    mid = n(stock?.bollingerMid);
  if (upper > 0 && lower > 0 && mid > 0) {
    const bbWidth = (upper - lower) / mid;
    if (bbWidth < 0.05) analysis.bollingerSqueeze = true;
  }

  if (historicalATRs.length >= 2) {
    const last = historicalATRs[historicalATRs.length - 1];
    const prev = historicalATRs[historicalATRs.length - 2];
    if (analysis.compression && last < prev)
      analysis.cyclePhase = "COMPRESSION_ONGOING";
    else if (analysis.compression && last > prev)
      analysis.cyclePhase = "EXPANSION_STARTING";
  }

  return analysis;
}

/* ──────────── Order Flow ──────────── */
function inferOrderFlow(data) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const flow = {
    buyingPressure: false,
    sellingPressure: false,
    absorption: false,
    imbalance: 0,
  };
  if (!data || data.length < 10) return flow;

  const recent = data.slice(-10);
  const avgVol = recent.reduce((s, d) => s + n(d.volume), 0) / 10;

  let buyVolume = 0,
    sellVolume = 0,
    absorption = 0;

  recent.forEach((bar) => {
    const high = n(bar.high),
      low = n(bar.low),
      close = n(bar.close),
      vol = n(bar.volume);
    const range = Math.max(0, high - low);
    const closePos = range > 0 ? (close - low) / range : 0.5;

    buyVolume += vol * closePos;
    sellVolume += vol * (1 - closePos);

    if (vol > avgVol * 1.5 && range < close * 0.01) absorption++;
  });

  const denom = buyVolume + sellVolume;
  flow.imbalance = denom > 0 ? (buyVolume - sellVolume) / denom : 0;
  flow.buyingPressure = flow.imbalance > 0.2;
  flow.sellingPressure = flow.imbalance < -0.2;
  flow.absorption = absorption >= 2;

  return flow;
}

/* ──────────── Extension / Trend / Momentum ──────────── */
function analyzeExtension(stock, recentData) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  if (!recentData || recentData.length < 20)
    return { isExtended: false, parabolicMove: false };

  const closes = recentData.map((d) => n(d.close));
  const currentPrice = closes[closes.length - 1];
  const sma20 = closes.slice(-20).reduce((s, v) => s + v, 0) / 20;

  const distanceFromMean =
    sma20 > 0 ? ((currentPrice - sma20) / sma20) * 100 : 0;
  const isExtended = distanceFromMean > 15;

  const pNow = closes[closes.length - 1];
  const p_5 = closes[closes.length - 6];
  const p_10 = closes[closes.length - 11];
  const changeLast5 = p_5 > 0 ? pNow / p_5 - 1 : 0;
  const changePrev5 = p_10 > 0 ? p_5 / p_10 - 1 : 0;
  const parabolicMove = changeLast5 > changePrev5 * 2 && changeLast5 > 0.08;

  return { isExtended, parabolicMove };
}

function analyzeTrendQuality(stock, recentData) {
  if (!recentData || recentData.length < 30)
    return { isHealthyTrend: false, trendStrength: 0 };
  const adxResult = _calculateADX(recentData.slice(-30), 14);
  const currentADX = adxResult.length
    ? adxResult[adxResult.length - 1].adx || 0
    : 0;
  return { isHealthyTrend: currentADX > 25, trendStrength: currentADX };
}

function analyzeMomentumPersistence(stock, recentData) {
  if (!recentData || recentData.length < 20) return { persistentStrength: 0 };
  const closes = recentData.map((d) =>
    Number.isFinite(d.close) ? d.close : 0
  );
  const rsiValues = _calculateRSI(closes, 14);
  const recentRSI = rsiValues.slice(-10);
  const daysBull = recentRSI.filter((v) => v > 55).length;
  return { persistentStrength: daysBull / 10 };
}

/* ──────────── Institutional Activity ──────────── */
function detectInstitutionalActivity(recentData) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  if (!recentData || recentData.length < 51)
    return { accumulationDays: 0, distributionDays: 0, isAccumulating: false };

  const relevant = recentData.slice(-51);
  const avgVolume50 =
    relevant.slice(0, 50).reduce((s, d) => s + n(d.volume), 0) / 50;

  let accumulationDays = 0,
    distributionDays = 0;
  const checkData = recentData.slice(-25);

  checkData.forEach((day, i) => {
    if (i === 0) return;
    const prev = checkData[i - 1];
    if (n(day.volume) > avgVolume50 * 1.5) {
      if (n(day.close) > n(prev.close)) accumulationDays++;
      else if (n(day.close) < n(prev.close)) distributionDays++;
    }
  });

  const isAccumulating = accumulationDays > distributionDays + 2;
  return { accumulationDays, distributionDays, isAccumulating };
}

/* ──────────── RSI / ADX ──────────── */
function _calculateRSI(prices, period) {
  const rsi = [];
  if (!prices || prices.length < period + 1) return rsi;

  let gains = 0,
    losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period; i < prices.length; i++) {
    const rs = avgLoss ? avgGain / avgLoss : avgGain ? Infinity : 0;
    rsi.push(100 - 100 / (1 + rs));

    const diff = prices[i] - prices[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  return rsi;
}

function _calculateADX(data, period) {
  if (!data || data.length < period + 2)
    return data.map((d) => ({ ...d, adx: 0 }));

  const trs = [],
    plusDMs = [],
    minusDMs = [];
  for (let i = 1; i < data.length; i++) {
    const h = data[i].high,
      l = data[i].low,
      pc = data[i - 1].close,
      ph = data[i - 1].high,
      pl = data[i - 1].low;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trs.push(tr);

    const upMove = h - ph;
    const downMove = pl - l;
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  const wilderSmooth = (arr, p) => {
    if (arr.length < p) return [];
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

  const smTR = wilderSmooth(trs, period);
  const smPDM = wilderSmooth(plusDMs, period);
  const smMDM = wilderSmooth(minusDMs, period);

  const plusDI = smTR.map((v, i) => 100 * (smPDM[i] / (v || 1)));
  const minusDI = smTR.map((v, i) => 100 * (smMDM[i] / (v || 1)));

  const dxs = plusDI.map(
    (p, i) => 100 * (Math.abs(p - minusDI[i]) / Math.max(1e-8, p + minusDI[i]))
  );
  const adxValues = wilderSmooth(dxs, period).map((v) => v / period);

  return data
    .slice(-adxValues.length)
    .map((d, i) => ({ ...d, adx: adxValues[i] }));
}

/* ──────────── Feature Extraction & Scoring ──────────── */
function extractFeatureVector(...analyses) {
  const features = {};
  analyses.forEach((analysis, idx) => {
    Object.entries(analysis).forEach(([key, value]) => {
      if (typeof value === "boolean") {
        features[`f${idx}_${key}`] = value ? 1 : 0;
      } else if (typeof value === "number") {
        features[`f${idx}_${key}`] = value;
      } else if (typeof value === "string") {
        features[`f${idx}_${key}_${value}`] = 1; // one-hot string
      } else if (Array.isArray(value)) {
        value.forEach((v) => {
          features[`f${idx}_${key}_${v}`] = 1;
        });
      }
    });
  });
  return features;
}

function calculateMLScore(features) {
  let score = 0;

  // STRICTER quality hurdle - require MORE signals
  let qualityPoints = 0;
  if (features.f2_clean) qualityPoints++;
  if (features.f9_isHealthyTrend) qualityPoints++;
  if (features.f4_type_TRENDING) qualityPoints++;
  if (features.f2_trendEfficiency > 0.5) qualityPoints++;

  // Penalize poor quality more heavily
  if (qualityPoints < 2) score -= 3.0;
  else if (qualityPoints < 3) score -= 1.0;

  // Positive combos (more selective)
  if (
    features.f0_bullishAuction &&
    features.f1_pocRising &&
    features.f2_clean
  ) {
    score += 3.5;
  } else if (features.f0_bullishAuction && features.f1_pocRising) {
    score += 1.5;
  }

  // High-quality bullish clusters
  if (
    features.f5_wyckoffSpring &&
    features.f7_buyingPressure &&
    features.f0_sellerExhaustion
  ) {
    score += 5.0;
  } else if (features.f5_wyckoffSpring && features.f7_buyingPressure) {
    score += 3.0;
  }
  if (
    features.f3_bullishHidden &&
    features.f9_isHealthyTrend &&
    features.f2_clean
  ) {
    score += 3.5;
  } else if (features.f3_bullishHidden && features.f9_isHealthyTrend) {
    score += 1.8;
  }

  // Bearish confirmations & breakout quality
  if (features.f5_wyckoffUpthrust) score -= 3.2;
  if (features.f5_failedBreakout) score -= 2.2;
  if (features.f5_successfulRetest) score += 1.2;

  // Stronger penalties for negative signals
  if (features.f3_bearishHidden && features.f8_isExtended) score -= 4.0;
  if (features.f5_threePushes && features.f8_parabolicMove) score -= 5.0;
  if (features.f0_bearishAuction && features.f1_pocFalling) score -= 4.0;
  if (features.f2_choppy) score -= 2.0;
  if (features.f8_isExtended && !features.f9_isHealthyTrend) score -= 2.5;

  // Small nudges: volume/delta
  if (features.f1_volumeTrend_INCREASING && features.f0_bullishAuction)
    score += 0.8;
  if (features.f1_volumeTrend_DECREASING && features.f4_type_TRENDING)
    score -= 0.8;
  if (features.f0_deltaProfile_STRONG_BULLISH) score += 0.6;
  if (features.f0_deltaProfile_STRONG_BEARISH) score -= 0.6;

  // Momentum rewarded only if trend is healthy
  const momentumStrength = features.f10_persistentStrength || 0;
  const trendStrength = features.f9_trendStrength || 0;
  if (trendStrength > 25) {
    score += momentumStrength * (1 + trendStrength / 50);
  } else {
    score += momentumStrength * 0.3;
  }

  // Volatility-phase scaling
  if (
    features.f6_cyclePhase_EXPANSION_STARTING &&
    features.f2_impulsive &&
    features.f2_clean
  ) {
    score *= 1.3;
  } else if (features.f6_cyclePhase_COMPRESSION_ONGOING) {
    score *= 0.8;
  }

  // Clamp
  score = Math.max(-5, Math.min(5, score));
  return score;
}

/* ──────────── Misc Helpers ──────────── */
function calculateMomentumAtPoint(data, index) {
  if (!data || index < 5 || index >= data.length) return 0;
  const price = data[index].close;
  const priceAgo = data[index - 5].close;
  return priceAgo ? (price - priceAgo) / priceAgo : 0;
}

function linearRegression(x, y) {
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((s, xi, i) => s + xi * y[i], 0);
  const sumXX = x.reduce((s, xi) => s + xi * xi, 0);

  const denom = n * sumXX - sumX * sumX;
  const slope = denom ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;

  const yMean = sumY / n;
  const ssTotal = y.reduce((s, yi) => s + Math.pow(yi - yMean, 2), 0);
  const ssResidual = y.reduce(
    (s, yi, i) => s + Math.pow(yi - (slope * x[i] + intercept), 2),
    0
  );
  const r2 = ssTotal ? 1 - ssResidual / ssTotal : 0;

  return { slope, intercept, r2 };
}

function findPushes(prices) {
  const pushes = [];
  let currentPush = null;

  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > prices[i - 1]) {
      if (!currentPush)
        currentPush = { start: i - 1, startPrice: prices[i - 1] };
    } else if (currentPush) {
      currentPush.end = i - 1;
      currentPush.endPrice = prices[i - 1];
      currentPush.gain =
        (currentPush.endPrice - currentPush.startPrice) /
        Math.max(1e-8, currentPush.startPrice);
      pushes.push(currentPush);
      currentPush = null;
    }
  }
  if (pushes.length >= 2) {
    const last = pushes[pushes.length - 1];
    const prev = pushes[pushes.length - 2];
    last.declining = last.gain < prev.gain;
  }
  return pushes;
}

/**
 * ATR over a window with (period+1) bars for TR calculation.
 */
function calculateATR(historicalData, period = 14) {
  if (!historicalData || historicalData.length < period + 1) return 0;
  const trs = [];
  for (let i = 1; i < historicalData.length; i++) {
    const h = historicalData[i].high,
      l = historicalData[i].low,
      pc = historicalData[i - 1].close;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trs.push(tr);
  }
  const last = trs.slice(-period);
  return last.reduce((s, v) => s + v, 0) / period;
}


// Map a regime + mlScore to a compact tier (1..7)
// 1=Strong Bullish ... 7=Strong Bearish
export function mapRegimeToTier(longTermRegime, mlScore = 0) {
  const has = (arr, s) => Array.isArray(arr) && arr.includes(s);

  // Default neutral
  let tier = 4;

  if (longTermRegime?.type === "TRENDING" && has(longTermRegime.characteristics, "UPTREND")) {
    // Better mlScore ⇒ more bullish
    tier = mlScore >= 2 ? 1 : mlScore >= 0.5 ? 2 : 3;
  } else if (longTermRegime?.type === "TRENDING" && has(longTermRegime.characteristics, "DOWNTREND")) {
    tier = mlScore <= -2 ? 7 : mlScore <= -0.5 ? 6 : 5;
  } else if (longTermRegime?.type === "RANGE_BOUND") {
    // Without priceActionQuality context here, keep center
    tier = 4;
  } else if (longTermRegime?.type === "CHOPPY") {
    tier = 5; // mild bearish bias for chop
  } else {
    // UNKNOWN / insufficient history
    tier = 4;
  }
  return tier;
}
