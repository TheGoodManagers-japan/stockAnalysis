/**
 * Enhanced Entry Timing Orchestrator for Swing Trading - BALANCED VERSION
 *
 * Changes made to reduce over-conservatism:
 * 1. Raised extension thresholds (15% and 25% instead of 8% and 12%)
 * 2. Removed duplicate penalties
 * 3. Lowered final score thresholds
 * 4. Balanced positive and negative scoring
 * 5. Only penalize EXTREME conditions
 */

import { getLayer1PatternScore } from "./layer1Analysis.js";
import { getLayer2MLAnalysis } from "./layer2Analysis.js";

export function getComprehensiveEntryTiming(
  stock,
  historicalData,
  marketData = null
) {
  // ---- Input validation
  if (!stock || !historicalData || historicalData.length < 90) {
    return {
      score: 7,
      stopLoss: null,
      priceTarget: null,
      confidence: 0,
      error: "Insufficient data for swing analysis (need 90+ days)",
      recommendation: "AVOID",
    };
  }

  // ---- Data preparation
  const sorted = [...historicalData].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );

  // ---- Extension and Exhaustion Analysis
  const extensionAnalysis = analyzeExtension(stock, sorted);
  const exhaustionSignals = detectExhaustion(stock, sorted);

  // ---- Layer 1: Pattern Analysis (30-day focus)
  console.log("Running Layer 1 Pattern Analysis...");
  const layer1Score = getLayer1PatternScore(stock, sorted);

  // ---- Layer 2: ML Context Analysis (90-day context, 30-day signals)
  console.log("Running Layer 2 ML Analysis...");
  const layer2Result = getLayer2MLAnalysis(stock, sorted, marketData) || {};
  const {
    mlScore = 0,
    features = {},
    longTermRegime = { type: "UNKNOWN", strength: 0 },
    shortTermRegime = { type: "UNKNOWN", strength: 0 },
    confidence: layer2Confidence = 0.5,
    insights = [],
  } = layer2Result;

  // ---- Adaptive Weighting based on market conditions
  const weights = getSwingAdaptiveWeights(
    longTermRegime,
    shortTermRegime,
    features,
    extensionAnalysis
  );

  // ---- Score Combination with Extension Penalties
  const { finalScore, confidence, recommendation } = combineScoresForSwing(
    layer1Score,
    mlScore,
    weights,
    layer2Confidence,
    features,
    longTermRegime,
    shortTermRegime,
    extensionAnalysis,
    exhaustionSignals
  );

  // ---- Risk Management (Stop Loss & Price Target)
  const riskManagement = calculateSwingRiskManagement(
    stock,
    sorted,
    finalScore,
    confidence,
    features,
    extensionAnalysis
  );

  // ---- Generate comprehensive insights
  const keyInsights = generateSwingInsights(
    features,
    insights,
    layer1Score,
    mlScore,
    riskManagement,
    extensionAnalysis,
    exhaustionSignals
  );

  // ---- Compile final result
  return {
    score: finalScore,
    confidence: confidence,
    recommendation: recommendation,
    stopLoss: riskManagement.stopLoss,
    priceTarget: riskManagement.priceTarget,
    riskRewardRatio: riskManagement.riskRewardRatio,
    positionSizeHint: riskManagement.positionSizeHint,
    longTermRegime: longTermRegime.type,
    shortTermRegime: shortTermRegime.type,
    stage: features.stageAnalysis_current || "UNKNOWN",
    relativeStrength: features.relativeStrength_rsRating || 50,
    keyInsights: keyInsights,
    extension: extensionAnalysis,
    exhaustion: exhaustionSignals,
    // Debug info
    debug: {
      layer1Score,
      mlScore,
      weights,
      rawConfidence: layer2Confidence,
      features: Object.keys(features).length,
      isExtended: extensionAnalysis.isExtended,
      isExhausted: exhaustionSignals.isExhausted,
    },
  };
}

/* ════════════════════ IMPROVED EXTENSION ANALYSIS ════════════════════ */

function analyzeExtension(stock, historicalData) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  const analysis = {
    isExtended: false,
    isParabolic: false,
    extensionLevel: "LOW",
    distanceFromMA20: 0,
    distanceFromMA50: 0,
    distanceFromMA200: 0,
    consecutiveUpDays: 0,
    shortTermGain: 0,
    accelerationRate: 0,
    extensionScore: 0,
  };

  if (!stock || historicalData.length < 30) return analysis;

  const currentPrice = n(stock.currentPrice);
  const ma20 = n(stock.movingAverage20d);
  const ma50 = n(stock.movingAverage50d);
  const ma200 = n(stock.movingAverage200d);

  // Distance from MAs
  if (ma20 > 0) {
    analysis.distanceFromMA20 = (currentPrice - ma20) / ma20;
  }
  if (ma50 > 0) {
    analysis.distanceFromMA50 = (currentPrice - ma50) / ma50;
  }
  if (ma200 > 0) {
    analysis.distanceFromMA200 = (currentPrice - ma200) / ma200;
  }

  // Count consecutive up days
  const recentData = historicalData.slice(-10);
  let upDays = 0;
  for (let i = 1; i < recentData.length; i++) {
    if (n(recentData[i].close) > n(recentData[i - 1].close)) {
      upDays++;
    } else {
      break;
    }
  }
  analysis.consecutiveUpDays = upDays;

  // Short-term gain (5-day and 10-day)
  if (historicalData.length >= 10) {
    const price5DaysAgo = n(historicalData[historicalData.length - 6].close);
    const price10DaysAgo = n(historicalData[historicalData.length - 11].close);
    const gain5Day =
      price5DaysAgo > 0 ? (currentPrice - price5DaysAgo) / price5DaysAgo : 0;
    const gain10Day =
      price10DaysAgo > 0 ? (currentPrice - price10DaysAgo) / price10DaysAgo : 0;
    analysis.shortTermGain = Math.max(gain5Day, gain10Day);
  }

  // Check for parabolic acceleration
  if (historicalData.length >= 20) {
    const roc5 = calculateROC(historicalData.slice(-5));
    const roc10 = calculateROC(historicalData.slice(-10));
    const roc20 = calculateROC(historicalData.slice(-20));

    // Parabolic = each period's ROC is significantly higher
    if (roc5 > roc10 * 1.5 && roc10 > roc20 * 1.5 && roc5 > 0.15) {
      analysis.isParabolic = true;
      analysis.accelerationRate = roc5 / roc20;
    }
  }

  // Calculate extension score with RAISED THRESHOLDS
  let extensionScore = 0;

  // MA extension checks (RAISED THRESHOLDS)
  if (analysis.distanceFromMA20 > 0.15) extensionScore += 0.2; // Was 0.08
  if (analysis.distanceFromMA20 > 0.25) extensionScore += 0.2; // Was 0.12
  if (analysis.distanceFromMA50 > 0.25) extensionScore += 0.2; // Was 0.15
  if (analysis.distanceFromMA50 > 0.35) extensionScore += 0.1; // Was 0.20
  if (analysis.distanceFromMA200 > 0.4) extensionScore += 0.1; // Was 0.30

  // Momentum extension (RAISED THRESHOLDS)
  if (analysis.consecutiveUpDays >= 7) extensionScore += 0.1; // Was 5
  if (analysis.consecutiveUpDays >= 10) extensionScore += 0.1; // Was 7
  if (analysis.shortTermGain > 0.2) extensionScore += 0.1; // Was 0.15
  if (analysis.shortTermGain > 0.3) extensionScore += 0.1; // Was 0.20

  // Parabolic penalty (keep this strict)
  if (analysis.isParabolic) extensionScore += 0.3;

  analysis.extensionScore = Math.min(1, extensionScore);
  analysis.isExtended = extensionScore >= 0.6; // RAISED from 0.5

  // Determine extension level with ADJUSTED THRESHOLDS
  if (extensionScore >= 0.8) {
    // Was 0.7
    analysis.extensionLevel = "EXTREME";
  } else if (extensionScore >= 0.6) {
    // Was 0.5
    analysis.extensionLevel = "HIGH";
  } else if (extensionScore >= 0.4) {
    // Was 0.3
    analysis.extensionLevel = "MODERATE";
  } else {
    analysis.extensionLevel = "LOW";
  }

  return analysis;
}

/* ════════════════════ EXHAUSTION DETECTION (Keep as is) ════════════════════ */

function detectExhaustion(stock, historicalData) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  const exhaustion = {
    isExhausted: false,
    signals: [],
    climacticVolume: false,
    rsiDivergence: false,
    momentumLoss: false,
    resistanceRejection: false,
    exhaustionScore: 0,
  };

  if (!stock || historicalData.length < 30) return exhaustion;

  const recentData = historicalData.slice(-20);

  // 1. Climactic Volume Check
  const volumes = recentData.map((d) => n(d.volume));
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const maxRecentVol = Math.max(...volumes.slice(-5));

  if (maxRecentVol > avgVolume * 2.5) {
    const highVolDay = recentData.find((d) => n(d.volume) === maxRecentVol);
    if (highVolDay) {
      const dayIndex = recentData.indexOf(highVolDay);
      if (dayIndex < recentData.length - 1) {
        const nextDay = recentData[dayIndex + 1];
        if (n(nextDay.close) < n(highVolDay.close)) {
          exhaustion.climacticVolume = true;
          exhaustion.signals.push("Climactic volume reversal");
        }
      }
    }
  }

  // 2. RSI Divergence Check
  const rsi = n(stock.rsi14);
  if (rsi > 70 && historicalData.length >= 10) {
    const recentHigh = Math.max(...recentData.slice(-5).map((d) => n(d.high)));
    const earlierHigh = Math.max(
      ...recentData.slice(-15, -10).map((d) => n(d.high))
    );

    if (recentHigh > earlierHigh && rsi < 75) {
      exhaustion.rsiDivergence = true;
      exhaustion.signals.push("RSI bearish divergence");
    }
  }

  // 3. Momentum Loss Check
  const macd = n(stock.macd);
  const signal = n(stock.macdSignal);
  const histogram = macd - signal;

  if (histogram < 0 && n(stock.currentPrice) > n(stock.movingAverage20d)) {
    exhaustion.momentumLoss = true;
    exhaustion.signals.push("MACD momentum loss");
  }

  // 4. Resistance Rejection Check
  const high52w = n(stock.fiftyTwoWeekHigh);
  const currentPrice = n(stock.currentPrice);

  if (high52w > 0) {
    const nearResistance = Math.abs(currentPrice - high52w) / high52w < 0.02;
    const failedBreakout = currentPrice < high52w * 0.98 && nearResistance;

    if (failedBreakout) {
      const touchedResistance = recentData
        .slice(-5)
        .some((d) => n(d.high) >= high52w * 0.99);
      if (touchedResistance) {
        exhaustion.resistanceRejection = true;
        exhaustion.signals.push("Rejected at 52-week high");
      }
    }
  }

  // Calculate exhaustion score
  let score = 0;
  if (exhaustion.climacticVolume) score += 0.3;
  if (exhaustion.rsiDivergence) score += 0.25;
  if (exhaustion.momentumLoss) score += 0.2;
  if (exhaustion.resistanceRejection) score += 0.25;

  exhaustion.exhaustionScore = score;
  exhaustion.isExhausted = score >= 0.5;

  return exhaustion;
}

/* ════════════════════ ADAPTIVE WEIGHTING (Adjusted) ════════════════════ */

function getSwingAdaptiveWeights(
  longTermRegime,
  shortTermRegime,
  features,
  extensionAnalysis
) {
  const lt = longTermRegime?.type || "UNKNOWN";
  const st = shortTermRegime?.type || "UNKNOWN";

  // Base weights for swing trading
  let weights = {
    layer1: 0.4,
    layer2: 0.6,
  };

  // Only reduce pattern importance when EXTREMELY extended
  if (extensionAnalysis.extensionLevel === "EXTREME") {
    weights.layer1 *= 0.7; // Less severe reduction (was 0.5)
    weights.layer2 = 1 - weights.layer1;
  }

  // Existing regime adjustments
  if (
    lt === "TRENDING" &&
    st === "TRENDING" &&
    !extensionAnalysis.isParabolic
  ) {
    weights = { layer1: 0.35, layer2: 0.65 };
  } else if (lt === "RANGE_BOUND" || st === "RANGE_BOUND") {
    weights = { layer1: 0.5, layer2: 0.5 };
  } else if (lt === "VOLATILE" || st === "VOLATILE") {
    weights = { layer1: 0.3, layer2: 0.7 };
  }

  return weights;
}

/* ════════════════════ IMPROVED SCORE COMBINATION ════════════════════ */

function combineScoresForSwing(
  layer1Score,
  mlScore,
  weights,
  layer2Confidence,
  features,
  longTermRegime,
  shortTermRegime,
  extensionAnalysis,
  exhaustionSignals
) {
  let confidence = Number.isFinite(layer2Confidence) ? layer2Confidence : 0.5;

  // Normalize scores
  const normalizedLayer1 = (4 - layer1Score) * 0.667;
  const clampedML = Math.max(-4, Math.min(3, mlScore));

  // Weighted combination
  let combinedScore =
    normalizedLayer1 * weights.layer1 + clampedML * weights.layer2;

  // RS Rating adjustments (MORE BALANCED)
  const rsRating = features.relativeStrength_rsRating || 50;
  if (rsRating >= 80) {
    // Lowered from 85
    if (
      extensionAnalysis.extensionLevel === "LOW" ||
      extensionAnalysis.extensionLevel === "MODERATE"
    ) {
      combinedScore += 0.5; // Increased from 0.3
    }
    // Only penalize if EXTREMELY extended
    else if (extensionAnalysis.extensionLevel === "EXTREME") {
      combinedScore -= 0.3; // Reduced penalty
    }
  } else if (rsRating <= 30) {
    combinedScore -= 1.0; // Reduced from -1.5
  }

  // Stage adjustments (MORE BALANCED)
  const stage = features.stageAnalysis_current;

  if (stage === "ADVANCING") {
    // Reward advancing stocks more generously
    if (
      features.priceStructure_pullback &&
      isPullbackConfirmed(features, extensionAnalysis)
    ) {
      combinedScore += 1.2; // Increased from 0.8
    } else if (extensionAnalysis.extensionLevel === "LOW") {
      combinedScore += 0.5; // Reward non-extended advancing stocks
    }
    // Only penalize EXTREME extensions
    else if (extensionAnalysis.extensionLevel === "EXTREME") {
      combinedScore -= 1.0; // Reduced from -1.5
    }
    // MODERATE extensions in advancing stage are NORMAL - no penalty
  } else if (
    stage === "ACCUMULATION" &&
    features.stageAnalysis_readiness > 0.5
  ) {
    combinedScore += 0.3; // New bonus for accumulation stocks
  } else if (stage === "DISTRIBUTION") {
    combinedScore -= 1.5; // Reduced from -2.0
  } else if (stage === "DECLINING") {
    combinedScore -= 2.0; // Keep this strict
  }

  // Extension penalties (ONLY ONE PENALTY, NOT MULTIPLE)
  if (extensionAnalysis.extensionLevel === "EXTREME") {
    combinedScore -= 1.5; // Single penalty for extreme extension
    confidence *= 0.7;
  } else if (extensionAnalysis.extensionLevel === "HIGH") {
    combinedScore -= 0.5; // Minor penalty for high extension
    confidence *= 0.85;
  }
  // NO PENALTY for MODERATE or LOW extension

  // Parabolic penalty (keep this)
  if (extensionAnalysis.isParabolic) {
    combinedScore -= 1.5; // Reduced from -2.0
    confidence *= 0.6;
  }

  // Exhaustion penalties (adjusted)
  if (exhaustionSignals.isExhausted) {
    combinedScore -= exhaustionSignals.exhaustionScore * 1.5; // Reduced from *2
    confidence *= 1 - exhaustionSignals.exhaustionScore * 0.2; // Reduced from *0.3
  }

  // BALANCED final score mapping (LOWERED THRESHOLDS)
  let finalScore;
  let recommendation;

  if (combinedScore >= 2.5) {
    // Lowered from 4.5
    finalScore = 1;
    recommendation = "STRONG BUY";
  } else if (combinedScore >= 1.5) {
    // Lowered from 3.0
    finalScore = 2;
    recommendation = "BUY";
  } else if (combinedScore >= 0.5) {
    // Lowered from 1.5
    finalScore = 3;
    recommendation = "WATCH - Positive";
  } else if (combinedScore >= -0.5) {
    // Lowered from 0
    finalScore = 4;
    recommendation = "NEUTRAL";
  } else if (combinedScore >= -1.5) {
    // Same
    finalScore = 5;
    recommendation = "WATCH - Negative";
  } else if (combinedScore >= -2.5) {
    // Raised from -3.0
    finalScore = 6;
    recommendation = "AVOID";
  } else {
    finalScore = 7;
    recommendation = "STRONG AVOID";
  }

  // Override only for EXTREME cases
  if (extensionAnalysis.extensionLevel === "EXTREME" && finalScore <= 2) {
    finalScore = 3;
    recommendation = "WAIT FOR PULLBACK - Extremely extended";
  }
  // Don't override for moderate extensions

  // Confidence veto (less strict)
  if (confidence < 0.4 && finalScore <= 2) {
    // Lowered from 0.5
    finalScore = Math.min(4, finalScore + 1); // Less penalty
    recommendation = "NEUTRAL - Low confidence";
  }

  return { finalScore, confidence, recommendation };
}

/* ════════════════════ PULLBACK CONFIRMATION (Adjusted) ════════════════════ */

function isPullbackConfirmed(features, extensionAnalysis) {
  // A confirmed pullback must:
  // 1. Not be EXTREMELY extended (moderate is OK)
  // 2. Have found support (bounced)
  // 3. Show accumulation or positive volume

  if (extensionAnalysis.extensionLevel === "EXTREME") return false;

  const hasSupport = features.trendStructure_nearSupport === 1;
  const hasBounce = features.priceStructure_pullback === 1;
  const hasVolume =
    features.volumeDynamics_accumVolume > features.volumeDynamics_distVolume;

  return hasSupport && hasBounce && hasVolume;
}

/* ════════════════════ RISK MANAGEMENT (Keep mostly as is) ════════════════════ */

function calculateSwingRiskManagement(
  stock,
  historicalData,
  score,
  confidence,
  features,
  extensionAnalysis
) {
  const currentPrice = Number(stock?.currentPrice) || 0;
  const atr = Number(stock?.atr14) || calculateATR(historicalData.slice(-15));

  if (!currentPrice || !atr) {
    return {
      stopLoss: null,
      priceTarget: null,
      riskRewardRatio: 0,
      positionSizeHint: "UNABLE TO CALCULATE",
    };
  }

  const stopLoss = calculateSwingStopLoss(
    stock,
    historicalData,
    currentPrice,
    atr,
    score,
    confidence,
    features,
    extensionAnalysis
  );

  const priceTarget = calculateSwingPriceTarget(
    stock,
    historicalData,
    currentPrice,
    atr,
    stopLoss,
    score,
    confidence,
    features,
    extensionAnalysis
  );

  const risk = currentPrice - stopLoss;
  const reward = priceTarget - currentPrice;
  const riskRewardRatio = risk > 0 ? reward / risk : 0;

  const positionSizeHint = getPositionSizeHint(
    confidence,
    riskRewardRatio,
    features.riskMetrics_volatility || 0,
    score,
    extensionAnalysis
  );

  return {
    stopLoss: roundToJPXTick(stopLoss, false),
    priceTarget: roundToJPXTick(priceTarget, false),
    riskRewardRatio: Math.round(riskRewardRatio * 10) / 10,
    positionSizeHint,
  };
}

function calculateSwingStopLoss(
  stock,
  historicalData,
  currentPrice,
  atr,
  score,
  confidence,
  features,
  extensionAnalysis
) {
  // Only use wider stops for EXTREME extensions
  const atrMultiplier =
    extensionAnalysis.extensionLevel === "EXTREME"
      ? score <= 2
        ? 2.0
        : score <= 4
        ? 2.5
        : 3.0
      : score <= 2
      ? 1.5
      : score <= 4
      ? 2.0
      : 2.5;

  const atrStop = currentPrice - atr * atrMultiplier;
  const swingLow = findValidatedSwingLow(historicalData.slice(-30));
  const candidates = [];

  if (
    swingLow.isValid &&
    swingLow.price < currentPrice &&
    swingLow.price > currentPrice * 0.9
  ) {
    candidates.push(swingLow.price - atr * 0.2);
  }

  if (atrStop > currentPrice * 0.85) {
    candidates.push(atrStop);
  }

  if (extensionAnalysis.extensionLevel !== "EXTREME") {
    const ma50 = Number(stock?.movingAverage50d) || 0;
    const maStop = ma50 > 0 ? ma50 - atr * 0.3 : 0;
    if (maStop && maStop > currentPrice * 0.9) {
      candidates.push(maStop);
    }
  }

  let stopLoss;
  if (candidates.length === 0) {
    stopLoss =
      currentPrice * (1 - Math.min(0.08, 0.03 + (atr / currentPrice) * 2));
  } else if (score <= 2 && extensionAnalysis.extensionLevel !== "EXTREME") {
    stopLoss = Math.max(...candidates);
  } else {
    stopLoss = Math.min(...candidates);
  }

  return stopLoss;
}

function calculateSwingPriceTarget(
  stock,
  historicalData,
  currentPrice,
  atr,
  stopLoss,
  score,
  confidence,
  features,
  extensionAnalysis
) {
  const risk = currentPrice - stopLoss;

  // Adjust targets based on extension level
  const minRR =
    extensionAnalysis.extensionLevel === "EXTREME"
      ? score <= 2
        ? 2.0
        : score <= 4
        ? 1.8
        : 1.5
      : extensionAnalysis.extensionLevel === "HIGH"
      ? score <= 2
        ? 2.5
        : score <= 4
        ? 2.0
        : 1.8
      : score <= 2
      ? 3.0
      : score <= 4
      ? 2.5
      : 2.0;

  const minTarget = currentPrice + risk * minRR;

  if (extensionAnalysis.extensionLevel === "EXTREME") {
    return Math.min(minTarget, currentPrice * 1.08);
  }

  const atrMultiplier = score <= 2 ? 3.5 : score <= 4 ? 2.5 : 2.0;
  const atrTarget = currentPrice + atr * atrMultiplier;
  const candidates = [minTarget, atrTarget];

  const swingHigh = findRecentSwingHigh(historicalData.slice(-30));
  if (swingHigh && swingHigh > currentPrice * 1.05) {
    candidates.push(swingHigh * 0.98);
  }

  const priceTarget = Math.min(...candidates.filter((t) => t > currentPrice));
  return Math.min(priceTarget, currentPrice * 1.2);
}

/* ════════════════════ POSITION SIZING (Adjusted) ════════════════════ */

function getPositionSizeHint(
  confidence,
  riskRewardRatio,
  volatility,
  score,
  extensionAnalysis
) {
  const safeConfidence = Number.isFinite(confidence) ? confidence : 0.5;
  const safeRR = Number.isFinite(riskRewardRatio) ? riskRewardRatio : 0;

  // Only reduce position for EXTREME extensions
  if (extensionAnalysis.extensionLevel === "EXTREME") {
    return "HALF";
  } else if (extensionAnalysis.extensionLevel === "HIGH") {
    return score <= 2 ? "NORMAL" : "NORMAL-"; // Still allow normal positions
  }

  // Normal position sizing
  let sizeHint = "NORMAL";

  if (safeConfidence >= 0.7 && safeRR >= 3.0 && score <= 2) {
    sizeHint = "FULL";
  } else if (safeConfidence >= 0.6 && safeRR >= 2.5) {
    sizeHint = "NORMAL+";
  } else if (safeConfidence < 0.4 || safeRR < 2.0) {
    sizeHint = "HALF";
  } else if (safeConfidence < 0.3 || safeRR < 1.5) {
    sizeHint = "QUARTER";
  }

  return sizeHint;
}

/* ════════════════════ INSIGHT GENERATION (Keep as is) ════════════════════ */

function generateSwingInsights(
  features,
  layer2Insights,
  layer1Score,
  mlScore,
  riskManagement,
  extensionAnalysis,
  exhaustionSignals
) {
  const insights = [...layer2Insights];

  if (extensionAnalysis.extensionLevel === "EXTREME") {
    insights.unshift(
      `⚠️ Extremely extended ${(
        extensionAnalysis.distanceFromMA20 * 100
      ).toFixed(0)}% above MA20`
    );
  } else if (extensionAnalysis.extensionLevel === "HIGH") {
    insights.push(
      `Extended ${(extensionAnalysis.distanceFromMA20 * 100).toFixed(
        0
      )}% above MA20 - consider smaller position`
    );
  }

  if (extensionAnalysis.isParabolic) {
    insights.unshift("⚠️ PARABOLIC move detected - extreme caution");
  }

  if (exhaustionSignals.isExhausted) {
    insights.unshift(
      `⚠️ Exhaustion signals: ${exhaustionSignals.signals.join(", ")}`
    );
  }

  if (
    riskManagement.riskRewardRatio >= 3 &&
    extensionAnalysis.extensionLevel !== "EXTREME"
  ) {
    insights.push(`Good R:R ratio of ${riskManagement.riskRewardRatio}:1`);
  } else if (riskManagement.riskRewardRatio < 2) {
    insights.push(
      `Weak R:R ratio of ${riskManagement.riskRewardRatio}:1 - consider passing`
    );
  }

  return insights.slice(0, 5);
}

/* ════════════════════ UTILITY FUNCTIONS (Keep as is) ════════════════════ */

function findValidatedSwingLow(data) {
  const result = { price: null, isValid: false, touches: 0 };

  if (!data || data.length < 10) return result;

  const swingLows = [];
  for (let i = 2; i < data.length - 2; i++) {
    if (
      data[i].low < data[i - 1].low &&
      data[i].low < data[i - 2].low &&
      data[i].low < data[i + 1].low &&
      data[i].low < data[i + 2].low
    ) {
      swingLows.push({ index: i, price: data[i].low });
    }
  }

  if (swingLows.length === 0) {
    result.price = Math.min(...data.slice(-10).map((d) => d.low));
    return result;
  }

  const recentSwing = swingLows[swingLows.length - 1];
  result.price = recentSwing.price;

  const tolerance = recentSwing.price * 0.01;
  let touches = 0;

  for (let i = recentSwing.index; i < data.length; i++) {
    if (Math.abs(data[i].low - recentSwing.price) <= tolerance) {
      touches++;
    }
  }

  result.touches = touches;
  result.isValid = touches >= 2;

  return result;
}

function calculateROC(data) {
  if (!data || data.length < 2) return 0;
  const firstPrice = data[0].close;
  const lastPrice = data[data.length - 1].close;
  return firstPrice > 0 ? (lastPrice - firstPrice) / firstPrice : 0;
}

function findRecentSwingHigh(data) {
  if (!data || data.length < 5) return null;

  let swingHigh = null;
  for (let i = 2; i < data.length - 2; i++) {
    if (
      data[i].high > data[i - 1].high &&
      data[i].high > data[i - 2].high &&
      data[i].high > data[i + 1].high &&
      data[i].high > data[i + 2].high
    ) {
      if (!swingHigh || data[i].high > swingHigh) {
        swingHigh = data[i].high;
      }
    }
  }

  if (!swingHigh) {
    swingHigh = Math.max(...data.slice(-10).map((d) => d.high));
  }

  return swingHigh;
}

function calculateATR(data) {
  if (!data || data.length < 15) return 0;

  const trs = [];
  for (let i = 1; i < data.length; i++) {
    const curr = data[i];
    const prev = data[i - 1];
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );
    trs.push(tr);
  }

  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

function roundToJPXTick(price, roundUp = false) {
  let tick;
  if (price < 3000) tick = 1;
  else if (price < 5000) tick = 5;
  else if (price < 30000) tick = 10;
  else if (price < 50000) tick = 50;
  else if (price < 300000) tick = 100;
  else if (price < 500000) tick = 500;
  else tick = 1000;

  if (roundUp) {
    return Math.ceil(price / tick) * tick;
  } else {
    return Math.floor(price / tick) * tick;
  }
}
