/**
 * Enhanced Entry Timing Orchestrator for Swing Trading
 * Coordinates Layer 1 (30-day patterns) and Layer 2 (90-day context)
 *
 * Key improvements:
 * - Swing-optimized stop/target placement
 * - Uses swing points for natural stops
 * - Minimum 2:1 R:R enforcement
 * - Confidence-based position sizing hints
 * - Stage-aware adjustments
 * - Better feature interpretation from new layers
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
  console.log("Running Layer 2 ML Analysis - finished");

  // ---- Adaptive Weighting based on market conditions
  const weights = getSwingAdaptiveWeights(
    longTermRegime,
    shortTermRegime,
    features
  );

  // ---- Score Combination
  const { finalScore, confidence, recommendation } = combineScoresForSwing(
    layer1Score,
    mlScore,
    weights,
    layer2Confidence,
    features,
    longTermRegime,
    shortTermRegime
  );

  console.log("here 1");

  // ---- Risk Management (Stop Loss & Price Target)
  const riskManagement = calculateSwingRiskManagement(
    stock,
    sorted,
    finalScore,
    confidence,
    features
  );

  console.log("here 2");

  // ---- Generate comprehensive insights
  const keyInsights = generateSwingInsights(
    features,
    insights,
    layer1Score,
    mlScore,
    riskManagement
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
    // Debug info
    debug: {
      layer1Score,
      mlScore,
      weights,
      rawConfidence: layer2Confidence,
      features: Object.keys(features).length,
    },
  };
}

/* ════════════════════ ADAPTIVE WEIGHTING ════════════════════ */

function getSwingAdaptiveWeights(longTermRegime, shortTermRegime, features) {
  const lt = longTermRegime?.type || "UNKNOWN";
  const st = shortTermRegime?.type || "UNKNOWN";

  // Base weights for swing trading
  let weights = {
    layer1: 0.4, // Pattern recognition
    layer2: 0.6, // Context and regime
  };

  // Adjust based on market conditions
  if (lt === "TRENDING" && st === "TRENDING") {
    // Strong trending market - ML context more important
    weights = { layer1: 0.35, layer2: 0.65 };
  } else if (lt === "RANGE_BOUND" || st === "RANGE_BOUND") {
    // Range-bound - patterns more important
    weights = { layer1: 0.5, layer2: 0.5 };
  } else if (lt === "VOLATILE" || st === "VOLATILE") {
    // High volatility - be more conservative, rely on ML
    weights = { layer1: 0.3, layer2: 0.7 };
  } else if (lt === "TRANSITIONAL" || st === "TRANSITIONAL") {
    // Market in transition - balance both
    weights = { layer1: 0.45, layer2: 0.55 };
  }

  // Stage-based adjustments
  const stage = features.stageAnalysis_current;
  if (stage === "ACCUMULATION") {
    // In accumulation, patterns matter more
    weights.layer1 = Math.min(0.6, weights.layer1 * 1.2);
    weights.layer2 = 1 - weights.layer1;
  } else if (stage === "DECLINING") {
    // In decline, context matters more
    weights.layer1 = Math.max(0.25, weights.layer1 * 0.8);
    weights.layer2 = 1 - weights.layer1;
  }

  return weights;
}

/* ════════════════════ SCORE COMBINATION ════════════════════ */

function combineScoresForSwing(
  layer1Score,
  mlScore,
  weights,
  layer2Confidence,
  features,
  longTermRegime,
  shortTermRegime
) {
  // MORE CONSERVATIVE normalization
  // 1 (best) → +2, 4 (neutral) → 0, 7 (worst) → -4
  const normalizedLayer1 = (4 - layer1Score) * 0.667; // Reduced from 1.0

  // Clamp ML score more aggressively
  const clampedML = Math.max(-4, Math.min(3, mlScore)); // Was -5 to +5

  // Weighted combination
  let combinedScore =
    normalizedLayer1 * weights.layer1 + clampedML * weights.layer2;

  // REDUCED adjustments
  const rsRating = features.relativeStrength_rsRating || 50;
  if (rsRating >= 85) {
    // Raised from 80
    combinedScore += 0.5; // Was 1.0
  } else if (rsRating <= 30) {
    combinedScore -= 1.5; // Was -1.0
  }

  // Stage adjustments (more conservative)
  const stage = features.stageAnalysis_current;
  if (
    stage === "ADVANCING" &&
    features.priceStructure_pullback &&
    features.priceStructure_higherHighsLows
  ) {
    // Added condition
    combinedScore += 0.8; // Was 1.5
  } else if (stage === "DISTRIBUTION" || stage === "DECLINING") {
    combinedScore -= 2.0; // Was -1.5
  }

  // STRICTER final score mapping
  let finalScore;
  let recommendation;

  if (combinedScore >= 4.0) {
    // Was 3.0
    finalScore = 1;
    recommendation = "STRONG BUY";
  } else if (combinedScore >= 2.5) {
    // Was 2.0
    finalScore = 2;
    recommendation = "BUY";
  } else if (combinedScore >= 1.0) {
    // Same
    finalScore = 3;
    recommendation = "WATCH - Positive";
  } else if (combinedScore >= -0.5) {
    // Same
    finalScore = 4;
    recommendation = "NEUTRAL";
  } else if (combinedScore >= -2.0) {
    // Was -1.5
    finalScore = 5;
    recommendation = "WATCH - Negative";
  } else if (combinedScore >= -3.5) {
    // Was -2.5
    finalScore = 6;
    recommendation = "AVOID";
  } else {
    finalScore = 7;
    recommendation = "STRONG AVOID";
  }

  // MORE AGGRESSIVE confidence veto
  if (confidence < 0.5 && finalScore <= 2) {
    // Was 0.3
    finalScore = Math.min(4, finalScore + 2); // Push to neutral
    recommendation = "NEUTRAL - Low confidence";
  }

  // Add market condition veto
  if (
    (longTermRegime?.type === "VOLATILE" ||
      shortTermRegime?.type === "VOLATILE") &&
    finalScore <= 2
  ) {
    finalScore = Math.min(3, finalScore + 1);
    recommendation = "WATCH - High volatility";
  }

  return { finalScore, confidence, recommendation };
}

/* ════════════════════ RISK MANAGEMENT ════════════════════ */

function calculateSwingRiskManagement(
  stock,
  historicalData,
  score,
  confidence,
  features
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

  // ===== STOP LOSS CALCULATION =====

  const stopLoss = calculateSwingStopLoss(
    stock,
    historicalData,
    currentPrice,
    atr,
    score,
    confidence,
    features
  );

  // ===== PRICE TARGET CALCULATION =====

  const priceTarget = calculateSwingPriceTarget(
    stock,
    historicalData,
    currentPrice,
    atr,
    stopLoss,
    score,
    confidence,
    features
  );

  // ===== RISK/REWARD RATIO =====

  const risk = currentPrice - stopLoss;
  const reward = priceTarget - currentPrice;
  const riskRewardRatio = risk > 0 ? reward / risk : 0;

  // ===== POSITION SIZE HINT =====

  const positionSizeHint = getPositionSizeHint(
    confidence,
    riskRewardRatio,
    features.riskMetrics_volatility || 0,
    score
  );

  // Round to JPX ticks if applicable
  const finalStopLoss = roundToJPXTick(stopLoss, false); // Round down
  const finalPriceTarget = roundToJPXTick(priceTarget, false); // Round down

  return {
    stopLoss: finalStopLoss,
    priceTarget: finalPriceTarget,
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
  features
) {
  // Find recent swing low
  const swingLow = findRecentSwingLow(historicalData.slice(-30));

  // ATR-based stop
  const atrMultiplier = score <= 2 ? 1.5 : score <= 4 ? 2.0 : 2.5;
  const atrStop = currentPrice - atr * atrMultiplier;

  // MA-based stop
  const ma50 = Number(stock?.movingAverage50d) || 0;
  const maStop = ma50 > 0 ? ma50 - atr * 0.3 : 0;

  // Determine stop candidates
  const candidates = [];

  // Swing low is preferred for swing trading
  if (swingLow && swingLow < currentPrice && swingLow > currentPrice * 0.9) {
    candidates.push(swingLow - atr * 0.2); // Small buffer below swing
  }

  // ATR stop
  if (atrStop > currentPrice * 0.85) {
    // Max 15% stop
    candidates.push(atrStop);
  }

  // MA stop if in uptrend
  if (
    maStop &&
    maStop > currentPrice * 0.9 &&
    features.stageAnalysis_current === "ADVANCING"
  ) {
    candidates.push(maStop);
  }

  // Choose stop based on score
  let stopLoss;
  if (candidates.length === 0) {
    // Fallback: percentage-based
    stopLoss =
      currentPrice * (1 - Math.min(0.08, 0.03 + (atr / currentPrice) * 2));
  } else if (score <= 2) {
    // Best setups: tightest stop
    stopLoss = Math.max(...candidates);
  } else if (score <= 4) {
    // Good setups: average stop
    stopLoss = candidates.reduce((a, b) => a + b, 0) / candidates.length;
  } else {
    // Weak setups: widest stop
    stopLoss = Math.min(...candidates);
  }

  // Ensure minimum distance (at least 1% for swings)
  const minDistance = currentPrice * 0.01;
  if (currentPrice - stopLoss < minDistance) {
    stopLoss = currentPrice - minDistance;
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
  features
) {
  // Risk amount
  const risk = currentPrice - stopLoss;

  // Minimum R:R for swing trades
  const minRR = score <= 2 ? 3.0 : score <= 4 ? 2.5 : 2.0;
  const minTarget = currentPrice + risk * minRR;

  // Find recent swing high
  const swingHigh = findRecentSwingHigh(historicalData.slice(-30));

  // ATR-based target
  const atrMultiplier = score <= 2 ? 3.5 : score <= 4 ? 2.5 : 2.0;
  const atrTarget = currentPrice + atr * atrMultiplier;

  // Resistance levels
  const resistance52w = Number(stock?.fiftyTwoWeekHigh) || 0;

  // Determine target candidates
  const candidates = [minTarget, atrTarget];

  // Swing high as target
  if (swingHigh && swingHigh > currentPrice * 1.05) {
    candidates.push(swingHigh * 0.98); // Just below resistance
  }

  // 52-week high if not too far
  if (
    resistance52w &&
    resistance52w > currentPrice &&
    resistance52w < currentPrice * 1.2
  ) {
    candidates.push(resistance52w * 0.98);
  }

  // Measured move for patterns
  if (features.priceStructure_breakout) {
    const measuredMove = currentPrice * 1.15; // 15% measured move
    candidates.push(measuredMove);
  }

  // Choose target based on score and stage
  let priceTarget;
  const stage = features.stageAnalysis_current;

  if (stage === "ADVANCING" && score <= 2) {
    // Strong uptrend, best setup: aggressive target
    priceTarget = Math.max(...candidates);
  } else if (score <= 3) {
    // Good setup: balanced target
    const filtered = candidates.filter((t) => t <= currentPrice * 1.15);
    priceTarget = filtered.length ? Math.max(...filtered) : minTarget;
  } else {
    // Conservative target
    priceTarget = minTarget;
  }

  // Cap at reasonable levels (20% max for swings)
  priceTarget = Math.min(priceTarget, currentPrice * 1.2);

  return priceTarget;
}

/* ════════════════════ POSITION SIZING ════════════════════ */

function getPositionSizeHint(confidence, riskRewardRatio, volatility, score) {
  // Base position size on confidence and R:R
  let sizeHint = "NORMAL";

  if (confidence >= 0.7 && riskRewardRatio >= 3.0 && score <= 2) {
    sizeHint = "FULL";
  } else if (confidence >= 0.6 && riskRewardRatio >= 2.5) {
    sizeHint = "NORMAL+";
  } else if (confidence < 0.4 || riskRewardRatio < 2.0) {
    sizeHint = "HALF";
  } else if (confidence < 0.3 || riskRewardRatio < 1.5) {
    sizeHint = "QUARTER";
  }

  // Volatility adjustment
  if (volatility > 0.5) {
    // High volatility: reduce size
    if (sizeHint === "FULL") sizeHint = "NORMAL+";
    else if (sizeHint === "NORMAL+") sizeHint = "NORMAL";
    else if (sizeHint === "NORMAL") sizeHint = "HALF";
  }

  return sizeHint;
}

/* ════════════════════ INSIGHT GENERATION ════════════════════ */

function generateSwingInsights(
  features,
  layer2Insights,
  layer1Score,
  mlScore,
  riskManagement
) {
  const insights = [...layer2Insights]; // Start with Layer 2 insights

  // Add entry quality insight
  if (layer1Score <= 2 && mlScore > 2) {
    insights.push("Strong pattern setup with positive market context");
  } else if (layer1Score <= 3 && features.institutional_accumulation) {
    insights.push("Good pattern with institutional accumulation");
  }

  // Risk/Reward insight
  if (riskManagement.riskRewardRatio >= 3) {
    insights.push(`Excellent R:R ratio of ${riskManagement.riskRewardRatio}:1`);
  } else if (riskManagement.riskRewardRatio < 2) {
    insights.push(
      `Weak R:R ratio of ${riskManagement.riskRewardRatio}:1 - consider passing`
    );
  }

  // Stage-specific insights
  const stage = features.stageAnalysis_current;
  if (stage === "ACCUMULATION" && features.priceStructure_tightRange) {
    insights.push("Accumulation with tight range - potential breakout setup");
  }

  // Volume insights
  if (features.volumeDynamics_dryingUp) {
    insights.push("Volume drying up - watch for expansion");
  }

  return insights.slice(0, 5); // Limit to top 5 insights
}

/* ════════════════════ UTILITY FUNCTIONS ════════════════════ */

function findRecentSwingLow(data) {
  if (!data || data.length < 5) return null;

  let swingLow = null;
  for (let i = 2; i < data.length - 2; i++) {
    if (
      data[i].low < data[i - 1].low &&
      data[i].low < data[i - 2].low &&
      data[i].low < data[i + 1].low &&
      data[i].low < data[i + 2].low
    ) {
      if (!swingLow || data[i].low < swingLow) {
        swingLow = data[i].low;
      }
    }
  }

  // If no swing found, use recent minimum
  if (!swingLow) {
    swingLow = Math.min(...data.slice(-10).map((d) => d.low));
  }

  return swingLow;
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

  // If no swing found, use recent maximum
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
  // JPX tick sizes
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
