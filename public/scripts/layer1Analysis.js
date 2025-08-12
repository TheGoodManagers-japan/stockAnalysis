/**
 * Enhanced Layer 1 Pattern Analysis for Swing Trading
 * Analyzes 30-day price action with focus on swing trading patterns
 *
 * Key improvements:
 * - Extended to 30-day analysis window (proper for swing setups)
 * - Added relative strength vs market
 * - Proper flag/pennant detection
 * - Volume accumulation/distribution tracking
 * - Multi-timeframe support consideration
 * - Risk/reward aware scoring
 */

export function getLayer1PatternScore(stock, historicalData) {
  // Swing trading needs more data for proper pattern recognition
  if (!historicalData || historicalData.length < 30) {
    return 7; // Strong Avoid - insufficient data
  }

  // Sort and take last 30 days for swing analysis
  const sorted = [...historicalData].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );
  const recentData = sorted.slice(-30);

  const n = (v) => (Number.isFinite(v) ? v : 0);
  const currentPrice = n(stock.currentPrice);

  // Build historical arrays
  const historical = {
    closes: recentData.map((day) => n(day.close)),
    volumes: recentData.map((day) => n(day.volume)),
    highs: recentData.map((day) => n(day.high)),
    lows: recentData.map((day) => n(day.low)),
    opens: recentData.map((day) => n(day.open)),
  };

  // --- Core Analysis Components ---
  const momentum = calculateSwingMomentum(historical, stock);
  const volumeAnalysis = analyzeVolumeAccumulation(recentData, historical);
  const swingPatterns = detectSwingPatterns(
    recentData,
    historical,
    stock,
    currentPrice
  );
  const trendStructure = analyzeTrendStructure(
    recentData,
    historical,
    stock,
    currentPrice
  );
  const riskReward = assessRiskReward(recentData, stock, currentPrice);
  const relativeStrength = calculateRelativeStrength(stock, recentData);

  // --- Scoring with Swing-Optimized Weights ---
  const weights = getSwingWeights(stock, trendStructure);
  let score = 0;

  // Core components
  score += scoreSwingMomentum(momentum, weights);
  score += scoreVolumeAccumulation(volumeAnalysis, weights);
  score += scoreSwingPatterns(swingPatterns, weights);
  score += scoreTrendStructure(trendStructure, weights);
  score += scoreRiskReward(riskReward, weights);
  score += scoreRelativeStrength(relativeStrength, weights);

  // --- Map to 1-7 scale (swing-optimized thresholds) ---
  const thresholds = {
    strongBuy: 4.0, // Relaxed from 2.5
    buy: 2.5, // Relaxed from 1.5
    watch: 1.0, // Relaxed from 0.5
    neutral: -0.5,
    caution: -2.0,
    avoid: -3.5,
  };

  if (score >= thresholds.strongBuy) return 1;
  if (score >= thresholds.buy) return 2;
  if (score >= thresholds.watch) return 3;
  if (score >= thresholds.neutral) return 4;
  if (score >= thresholds.caution) return 5;
  if (score >= thresholds.avoid) return 6;
  return 7;
}

/* ──────────── SWING MOMENTUM ANALYSIS ──────────── */
function calculateSwingMomentum(historical, stock) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  // Rate of change over different periods
  const roc5 = calculateROC(historical.closes, 5);
  const roc10 = calculateROC(historical.closes, 10);
  const roc20 = calculateROC(historical.closes, 20);

  // MACD momentum
  const macdMomentum = n(stock.macd) - n(stock.macdSignal);
  const macdPositive = n(stock.macd) > 0;

  // Stochastic momentum (using fetched values)
  const stochMomentum = n(stock.stochasticK) - n(stock.stochasticD);
  const stochOversold = n(stock.stochasticK) < 30 && n(stock.stochasticD) < 30;
  const stochTurning = stochOversold && stochMomentum > 0;

  // Price vs moving averages momentum
  const ma20Distance = stock.movingAverage20d
    ? (historical.closes[historical.closes.length - 1] -
        n(stock.movingAverage20d)) /
      n(stock.movingAverage20d)
    : 0;
  const ma50Distance = stock.movingAverage50d
    ? (historical.closes[historical.closes.length - 1] -
        n(stock.movingAverage50d)) /
      n(stock.movingAverage50d)
    : 0;

  return {
    roc5,
    roc10,
    roc20,
    macdMomentum,
    macdPositive,
    stochMomentum,
    stochOversold,
    stochTurning,
    ma20Distance,
    ma50Distance,
    accelerating: roc5 > roc10 && roc10 > roc20,
    decelerating: roc5 < roc10 && roc10 < roc20,
  };
}

/* ──────────── VOLUME ACCUMULATION/DISTRIBUTION ──────────── */
function analyzeVolumeAccumulation(recentData, historical) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  // Calculate On-Balance Volume trend
  let obv = 0;
  const obvValues = [];
  for (let i = 1; i < recentData.length; i++) {
    if (n(recentData[i].close) > n(recentData[i - 1].close)) {
      obv += n(recentData[i].volume);
    } else if (n(recentData[i].close) < n(recentData[i - 1].close)) {
      obv -= n(recentData[i].volume);
    }
    obvValues.push(obv);
  }

  // OBV trend (compare recent vs earlier)
  const obvRecent = obvValues.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const obvPrior = obvValues.slice(-15, -10).reduce((a, b) => a + b, 0) / 5;
  const obvRising = obvRecent > obvPrior;

  // Accumulation/Distribution days
  let accumDays = 0;
  let distDays = 0;
  const avgVolume =
    historical.volumes.reduce((a, b) => a + b, 0) / historical.volumes.length;

  for (let i = 1; i < recentData.length; i++) {
    const volRatio = n(recentData[i].volume) / avgVolume;
    if (volRatio > 1.2) {
      if (n(recentData[i].close) > n(recentData[i - 1].close)) {
        accumDays++;
      } else if (n(recentData[i].close) < n(recentData[i - 1].close)) {
        distDays++;
      }
    }
  }

  // Volume dry-up detection (important for breakouts)
  const last5Vol = historical.volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const volumeDryUp = last5Vol < avgVolume * 0.7;

  // Relative volume on up vs down days
  let upVolume = 0,
    downVolume = 0;
  for (let i = 1; i < recentData.length; i++) {
    if (n(recentData[i].close) > n(recentData[i - 1].close)) {
      upVolume += n(recentData[i].volume);
    } else {
      downVolume += n(recentData[i].volume);
    }
  }
  const volumeBias = upVolume / (upVolume + downVolume + 1);

  return {
    obvRising,
    accumDays,
    distDays,
    netAccumulation: accumDays - distDays,
    volumeDryUp,
    volumeBias,
    isAccumulating: accumDays > distDays * 1.5,
    isDistributing: distDays > accumDays * 1.5,
  };
}

/* ──────────── SWING PATTERN DETECTION ──────────── */
function detectSwingPatterns(recentData, historical, stock, currentPrice) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const patterns = {};

  // Flag Pattern (key swing pattern)
  patterns.flag = detectFlagPattern(recentData, historical);

  // Pennant Pattern
  patterns.pennant = detectPennantPattern(recentData, historical);

  // Channel Breakout
  patterns.channelBreakout = detectChannelBreakout(recentData, historical);

  // First Pullback After Breakout
  patterns.firstPullback = detectFirstPullback(recentData, historical, stock);

  // Higher Lows / Higher Highs (uptrend structure)
  patterns.higherLowsHighs = detectHigherLowsHighs(recentData);

  // Base Building (consolidation above support)
  patterns.baseBuilding = detectBaseBuilding(recentData, historical, stock);

  // MA Reclaim (price reclaims key MA)
  patterns.maReclaim = detectMAReclaim(recentData, stock, currentPrice);

  // Reversal from oversold
  patterns.oversoldReversal = detectOversoldReversal(recentData, stock);

  return patterns;
}

/* ──────────── TREND STRUCTURE ANALYSIS ──────────── */
function analyzeTrendStructure(recentData, historical, stock, currentPrice) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  // Stage Analysis (Accumulation, Markup, Distribution, Markdown)
  const stage = determineStage(recentData, stock);

  // ADX for trend strength
  const adxStrong = n(stock.adx) > 25;
  const adxWeak = n(stock.adx) < 20;

  // Moving average alignment
  const ma20 = n(stock.movingAverage20d);
  const ma50 = n(stock.movingAverage50d);
  const ma200 = n(stock.movingAverage200d);

  const bullishAlignment = ma20 > ma50 && ma50 > ma200 && ma200 > 0;
  const bearishAlignment = ma20 < ma50 && ma50 < ma200 && ma200 > 0;

  // Support/Resistance levels
  const keyLevels = findKeyLevels(recentData, historical);
  const nearSupport = isNearSupport(currentPrice, keyLevels.supports);
  const nearResistance = isNearResistance(currentPrice, keyLevels.resistances);

  // Trend quality
  const trendQuality = assessTrendQuality(historical);

  return {
    stage,
    adxStrong,
    adxWeak,
    bullishAlignment,
    bearishAlignment,
    nearSupport,
    nearResistance,
    keyLevels,
    trendQuality,
    isHealthyPullback: stage === "MARKUP" && nearSupport,
    isBreakoutReady: stage === "ACCUMULATION" && nearResistance,
  };
}

/* ──────────── RISK/REWARD ASSESSMENT ──────────── */
function assessRiskReward(recentData, stock, currentPrice) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  // Find logical stop level (swing low)
  const swingLow = findRecentSwingLow(recentData);
  const stopDistance = currentPrice - swingLow;
  const stopPercent = stopDistance / currentPrice;

  // Find logical target (resistance or measured move)
  const swingHigh = findRecentSwingHigh(recentData);
  const targetDistance = swingHigh - currentPrice;
  const targetPercent = targetDistance / currentPrice;

  // Calculate R:R ratio
  const riskRewardRatio = targetDistance / Math.max(stopDistance, 0.01);

  // ATR-based position sizing consideration
  const atr = n(stock.atr14);
  const atrPercent = atr / currentPrice;
  const positionSizeScore = atrPercent < 0.03 ? 1 : atrPercent < 0.05 ? 0.5 : 0;

  return {
    stopPercent,
    targetPercent,
    riskRewardRatio,
    atrPercent,
    positionSizeScore,
    isGoodRR: riskRewardRatio >= 2,
    isTightStop: stopPercent < 0.05,
    isWideStop: stopPercent > 0.1,
  };
}

/* ──────────── RELATIVE STRENGTH ──────────── */
function calculateRelativeStrength(stock, recentData) {
  // In production, you'd compare against SPY or sector ETF
  // For now, using price performance vs market expectations

  const n = (v) => (Number.isFinite(v) ? v : 0);

  // Price vs 52-week high/low
  const high52w = n(stock.fiftyTwoWeekHigh);
  const low52w = n(stock.fiftyTwoWeekLow);
  const currentPrice = n(stock.currentPrice);

  const rangePosition =
    high52w > low52w ? (currentPrice - low52w) / (high52w - low52w) : 0.5;

  // New high proximity
  const nearNewHigh = currentPrice > high52w * 0.95;
  const makingNewHigh = currentPrice >= high52w;

  // Performance vs MA200 (market proxy)
  const ma200 = n(stock.movingAverage200d);
  const outperformance = ma200 > 0 ? (currentPrice - ma200) / ma200 : 0;

  return {
    rangePosition,
    nearNewHigh,
    makingNewHigh,
    outperformance,
    isLeader: rangePosition > 0.8,
    isLaggard: rangePosition < 0.2,
  };
}

/* ──────────── PATTERN DETECTION HELPERS ──────────── */

function detectFlagPattern(recentData, historical) {
  if (recentData.length < 20) return false;

  // Look for strong move up (pole) followed by consolidation (flag)
  const pole = recentData.slice(-20, -10);
  const flag = recentData.slice(-10);

  // Calculate pole strength
  const poleMove =
    (pole[pole.length - 1].close - pole[0].close) / pole[0].close;
  const isPole = poleMove > 0.1; // 10%+ move

  // Check flag characteristics
  const flagHigh = Math.max(...flag.map((d) => d.high));
  const flagLow = Math.min(...flag.map((d) => d.low));
  const flagRange = (flagHigh - flagLow) / flagLow;
  const isTightFlag = flagRange < 0.05; // Less than 5% range

  // Volume should decrease in flag
  const poleVolume = pole.reduce((sum, d) => sum + d.volume, 0) / pole.length;
  const flagVolume = flag.reduce((sum, d) => sum + d.volume, 0) / flag.length;
  const volumeContraction = flagVolume < poleVolume * 0.7;

  return isPole && isTightFlag && volumeContraction;
}

function detectPennantPattern(recentData, historical) {
  if (recentData.length < 15) return false;

  const recent = recentData.slice(-15);
  const highs = recent.map((d) => d.high);
  const lows = recent.map((d) => d.low);

  // Check for converging highs and lows
  const firstHalf = 7;
  const earlyRange =
    Math.max(...highs.slice(0, firstHalf)) -
    Math.min(...lows.slice(0, firstHalf));
  const lateRange = Math.max(...highs.slice(-5)) - Math.min(...lows.slice(-5));

  return lateRange < earlyRange * 0.5; // Range contracted by 50%+
}

function detectChannelBreakout(recentData, historical) {
  if (recentData.length < 20) return false;

  const prices = recentData.slice(-20, -1).map((d) => d.close);
  const channelHigh = Math.max(...recentData.slice(-20, -1).map((d) => d.high));
  const latestClose = recentData[recentData.length - 1].close;
  const latestVolume = recentData[recentData.length - 1].volume;
  const avgVolume =
    historical.volumes.reduce((a, b) => a + b, 0) / historical.volumes.length;

  return latestClose > channelHigh && latestVolume > avgVolume * 1.5;
}

function detectFirstPullback(recentData, historical, stock) {
  if (recentData.length < 10) return false;

  // Check if we recently broke above MA50
  const ma50 = Number(stock.movingAverage50d) || 0;
  if (ma50 === 0) return false;

  let brokeAbove = false;
  for (let i = recentData.length - 10; i < recentData.length - 3; i++) {
    if (recentData[i].close > ma50 && recentData[i - 1].close < ma50) {
      brokeAbove = true;
      break;
    }
  }

  // Now check if pulling back to MA50
  const currentPrice = recentData[recentData.length - 1].close;
  const touchingMA = Math.abs(currentPrice - ma50) / ma50 < 0.02;

  return brokeAbove && touchingMA;
}

function detectHigherLowsHighs(recentData) {
  const swingPoints = findSwingPoints(recentData);

  if (swingPoints.lows.length < 2 || swingPoints.highs.length < 2) {
    return false;
  }

  // Check last two lows and highs
  const lastTwoLows = swingPoints.lows.slice(-2);
  const lastTwoHighs = swingPoints.highs.slice(-2);

  const higherLows = lastTwoLows[1].price > lastTwoLows[0].price;
  const higherHighs = lastTwoHighs[1].price > lastTwoHighs[0].price;

  return higherLows && higherHighs;
}

function detectBaseBuilding(recentData, historical, stock) {
  if (recentData.length < 15) return false;

  const recent = recentData.slice(-15);
  const highs = recent.map((d) => d.high);
  const lows = recent.map((d) => d.low);

  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  const range = (maxHigh - minLow) / minLow;

  // Tight range (less than 10%)
  const isTight = range < 0.1;

  // Above key support (MA50)
  const ma50 = Number(stock.movingAverage50d) || 0;
  const aboveSupport = minLow > ma50 * 0.98;

  // Volume drying up
  const volumes = recent.map((d) => d.volume);
  const avgVolume =
    historical.volumes.reduce((a, b) => a + b, 0) / historical.volumes.length;
  const recentVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const volumeDrying = recentVolume < avgVolume * 0.8;

  return isTight && aboveSupport && volumeDrying;
}

function detectMAReclaim(recentData, stock, currentPrice) {
  const ma20 = Number(stock.movingAverage20d) || 0;
  const ma50 = Number(stock.movingAverage50d) || 0;

  if (ma20 === 0 && ma50 === 0) return false;

  // Check if we were below MA and now above
  const wasBelow20 = recentData.slice(-5, -2).some((d) => d.close < ma20);
  const nowAbove20 = currentPrice > ma20;

  const wasBelow50 = recentData.slice(-5, -2).some((d) => d.close < ma50);
  const nowAbove50 = currentPrice > ma50;

  return (wasBelow20 && nowAbove20) || (wasBelow50 && nowAbove50);
}

function detectOversoldReversal(recentData, stock) {
  const rsi = Number(stock.rsi14) || 50;
  const stochK = Number(stock.stochasticK) || 50;

  // Was oversold
  const wasOversold = rsi < 35 || stochK < 30;

  // Showing reversal (green candle, higher low)
  const latest = recentData[recentData.length - 1];
  const prev = recentData[recentData.length - 2];

  const greenCandle = latest.close > latest.open;
  const higherLow = latest.low > prev.low;

  return wasOversold && greenCandle && higherLow;
}

/* ──────────── UTILITY FUNCTIONS ──────────── */

function calculateROC(closes, period) {
  if (closes.length < period + 1) return 0;
  const current = closes[closes.length - 1];
  const past = closes[closes.length - 1 - period];
  return past > 0 ? ((current - past) / past) * 100 : 0;
}

function findSwingPoints(data) {
  const lows = [];
  const highs = [];

  for (let i = 2; i < data.length - 2; i++) {
    // Swing low
    if (
      data[i].low < data[i - 1].low &&
      data[i].low < data[i - 2].low &&
      data[i].low < data[i + 1].low &&
      data[i].low < data[i + 2].low
    ) {
      lows.push({ index: i, price: data[i].low });
    }

    // Swing high
    if (
      data[i].high > data[i - 1].high &&
      data[i].high > data[i - 2].high &&
      data[i].high > data[i + 1].high &&
      data[i].high > data[i + 2].high
    ) {
      highs.push({ index: i, price: data[i].high });
    }
  }

  return { lows, highs };
}

function findRecentSwingLow(data) {
  const swings = findSwingPoints(data);
  if (swings.lows.length === 0) {
    return Math.min(...data.slice(-10).map((d) => d.low));
  }
  return swings.lows[swings.lows.length - 1].price;
}

function findRecentSwingHigh(data) {
  const swings = findSwingPoints(data);
  if (swings.highs.length === 0) {
    return Math.max(...data.slice(-10).map((d) => d.high));
  }
  return swings.highs[swings.highs.length - 1].price;
}

function findKeyLevels(recentData, historical) {
  const supports = [];
  const resistances = [];

  // Find swing points
  const swings = findSwingPoints(recentData);
  supports.push(...swings.lows.map((s) => s.price));
  resistances.push(...swings.highs.map((s) => s.price));

  // Remove duplicates and sort
  return {
    supports: [...new Set(supports)].sort((a, b) => b - a),
    resistances: [...new Set(resistances)].sort((a, b) => a - b),
  };
}

function isNearSupport(price, supports) {
  return supports.some((s) => Math.abs(price - s) / s < 0.03);
}

function isNearResistance(price, resistances) {
  return resistances.some((r) => Math.abs(price - r) / r < 0.03);
}

function determineStage(recentData, stock) {
  const ma50 = Number(stock.movingAverage50d) || 0;
  const ma200 = Number(stock.movingAverage200d) || 0;
  const currentPrice = recentData[recentData.length - 1].close;

  if (ma50 === 0 || ma200 === 0) return "UNKNOWN";

  // Stage 1: Accumulation (base building near lows)
  if (Math.abs(ma50 - ma200) / ma200 < 0.05 && currentPrice < ma200 * 1.1) {
    return "ACCUMULATION";
  }

  // Stage 2: Markup (uptrend)
  if (ma50 > ma200 && currentPrice > ma50) {
    return "MARKUP";
  }

  // Stage 3: Distribution (topping)
  if (Math.abs(ma50 - ma200) / ma200 < 0.05 && currentPrice > ma200 * 1.2) {
    return "DISTRIBUTION";
  }

  // Stage 4: Markdown (downtrend)
  if (ma50 < ma200 && currentPrice < ma50) {
    return "MARKDOWN";
  }

  return "TRANSITION";
}

function assessTrendQuality(historical) {
  const closes = historical.closes;
  if (closes.length < 20) return 0;

  // Calculate directional movement
  const startPrice = closes[closes.length - 20];
  const endPrice = closes[closes.length - 1];
  const directMove = Math.abs(endPrice - startPrice);

  // Calculate total path
  let totalMove = 0;
  for (let i = closes.length - 19; i < closes.length; i++) {
    totalMove += Math.abs(closes[i] - closes[i - 1]);
  }

  // Efficiency ratio (0 to 1, higher is better)
  return totalMove > 0 ? directMove / totalMove : 0;
}

/* ──────────── SCORING FUNCTIONS ──────────── */

function getSwingWeights(stock, trendStructure) {
  // Adapt weights based on market stage
  const baseWeights = {
    momentum: 1.2,
    volume: 1.5,
    patterns: 2.0, // Higher weight for swing patterns
    trend: 1.3,
    riskReward: 1.8, // Critical for swings
    relativeStrength: 1.4,
  };

  // Adjust based on stage
  if (trendStructure.stage === "ACCUMULATION") {
    baseWeights.patterns *= 1.3; // Pattern breakouts more important
    baseWeights.volume *= 1.2; // Volume confirmation critical
  } else if (trendStructure.stage === "MARKUP") {
    baseWeights.momentum *= 1.2; // Momentum continuation important
    baseWeights.trend *= 1.3; // Trend following works
  } else if (trendStructure.stage === "DISTRIBUTION") {
    baseWeights.momentum *= 0.7; // Momentum less reliable
    baseWeights.volume *= 1.3; // Watch for distribution
  }

  return baseWeights;
}

function scoreSwingMomentum(momentum, weights) {
  let score = 0;

  // MACD momentum
  if (momentum.macdPositive && momentum.macdMomentum > 0) {
    score += weights.momentum * 0.8;
  } else if (momentum.macdMomentum > 0) {
    score += weights.momentum * 0.4;
  }

  // Stochastic oversold bounce
  if (momentum.stochTurning) {
    score += weights.momentum * 0.6;
  }

  // Acceleration pattern
  if (momentum.accelerating) {
    score += weights.momentum * 0.5;
  } else if (momentum.decelerating) {
    score -= weights.momentum * 0.3;
  }

  // Position relative to MAs
  if (momentum.ma20Distance > 0 && momentum.ma50Distance > 0) {
    score += weights.momentum * 0.4;
  }

  return score;
}

function scoreVolumeAccumulation(volumeAnalysis, weights) {
  let score = 0;

  if (volumeAnalysis.isAccumulating) {
    score += weights.volume * 1.0;
  } else if (volumeAnalysis.isDistributing) {
    score -= weights.volume * 0.8;
  }

  if (volumeAnalysis.obvRising) {
    score += weights.volume * 0.5;
  }

  if (volumeAnalysis.volumeDryUp) {
    score += weights.volume * 0.3; // Potential breakout setup
  }

  if (volumeAnalysis.volumeBias > 0.6) {
    score += weights.volume * 0.4;
  } else if (volumeAnalysis.volumeBias < 0.4) {
    score -= weights.volume * 0.3;
  }

  return score;
}

function scoreSwingPatterns(patterns, weights) {
  let score = 0;

  // High-value swing patterns
  if (patterns.flag) {
    score += weights.patterns * 1.5; // Flag patterns are gold for swings
  }

  if (patterns.pennant) {
    score += weights.patterns * 1.3;
  }

  if (patterns.channelBreakout) {
    score += weights.patterns * 1.2;
  }

  if (patterns.firstPullback) {
    score += weights.patterns * 1.4; // High probability setup
  }

  if (patterns.higherLowsHighs) {
    score += weights.patterns * 0.8;
  }

  if (patterns.baseBuilding) {
    score += weights.patterns * 1.0;
  }

  if (patterns.maReclaim) {
    score += weights.patterns * 0.7;
  }

  if (patterns.oversoldReversal) {
    score += weights.patterns * 0.6;
  }

  return score;
}

function scoreTrendStructure(trendStructure, weights) {
  let score = 0;

  // Stage-based scoring
  if (trendStructure.stage === "MARKUP") {
    score += weights.trend * 0.8;
  } else if (trendStructure.stage === "ACCUMULATION") {
    score += weights.trend * 0.5;
  } else if (trendStructure.stage === "DISTRIBUTION") {
    score -= weights.trend * 0.5;
  } else if (trendStructure.stage === "MARKDOWN") {
    score -= weights.trend * 1.0;
  }

  // ADX strength
  if (trendStructure.adxStrong) {
    score += weights.trend * 0.6;
  } else if (trendStructure.adxWeak) {
    score -= weights.trend * 0.3;
  }

  // MA alignment
  if (trendStructure.bullishAlignment) {
    score += weights.trend * 0.8;
  } else if (trendStructure.bearishAlignment) {
    score -= weights.trend * 0.8;
  }

  // Special setups
  if (trendStructure.isHealthyPullback) {
    score += weights.trend * 1.2; // Prime swing entry
  }

  if (trendStructure.isBreakoutReady) {
    score += weights.trend * 0.8;
  }

  // Trend quality
  score += weights.trend * trendStructure.trendQuality * 0.5;

  return score;
}

function scoreRiskReward(riskReward, weights) {
  let score = 0;

  // R:R ratio is critical for swing trading
  if (riskReward.isGoodRR) {
    score += weights.riskReward * 1.2;
  } else if (riskReward.riskRewardRatio < 1.5) {
    score -= weights.riskReward * 0.8; // Poor R:R
  }

  // Stop distance
  if (riskReward.isTightStop) {
    score += weights.riskReward * 0.5;
  } else if (riskReward.isWideStop) {
    score -= weights.riskReward * 0.3;
  }

  // Position sizing consideration
  score += weights.riskReward * riskReward.positionSizeScore * 0.4;

  // Target achievability
  if (riskReward.targetPercent > 0.05 && riskReward.targetPercent < 0.2) {
    score += weights.riskReward * 0.3; // Realistic swing target
  }

  return score;
}

function scoreRelativeStrength(relativeStrength, weights) {
  let score = 0;

  if (relativeStrength.isLeader) {
    score += weights.relativeStrength * 1.0;
  } else if (relativeStrength.isLaggard) {
    score -= weights.relativeStrength * 0.6;
  }

  if (relativeStrength.nearNewHigh) {
    score += weights.relativeStrength * 0.5;
  }

  if (relativeStrength.makingNewHigh) {
    score += weights.relativeStrength * 0.8;
  }

  // Outperformance vs MA200 (market proxy)
  if (relativeStrength.outperformance > 0.1) {
    score += weights.relativeStrength * 0.6;
  } else if (relativeStrength.outperformance < -0.1) {
    score -= weights.relativeStrength * 0.4;
  }

  return score;
}
