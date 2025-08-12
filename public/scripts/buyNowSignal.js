/**
 * Fixed Buy Trigger Wrapper for Swing Trading
 *
 * This version includes stricter criteria and additional filters
 * to prevent overly bullish bias in swing trading decisions.
 *
 * Key improvements:
 * - Stricter confidence requirements
 * - Higher R:R minimums
 * - Additional volatility checks
 * - Market regime filters
 * - Requires multiple confirming signals
 */

export function getBuyTrigger(stock, historicalData, entryAnalysis = null) {
  // ===== VALIDATION =====

  if (!stock || !historicalData) {
    return {
      isBuyNow: false,
      reason: "Missing required data",
      details: null,
    };
  }

  if (!entryAnalysis) {
    return {
      isBuyNow: false,
      reason: "Entry analysis not performed",
      details: null,
    };
  }

  // ===== EXTRACT KEY METRICS =====

  const {
    score,
    confidence = 0,
    recommendation = "UNKNOWN",
    riskRewardRatio = 0,
    stopLoss,
    priceTarget,
    stage = "UNKNOWN",
    relativeStrength = 50,
    keyInsights = [],
    longTermRegime = "UNKNOWN",
    shortTermRegime = "UNKNOWN",
    debug = {},
  } = entryAnalysis;

  // Extract additional features if available
  const features = debug.features || {};
  const volatility = features.riskMetrics_volatility || 0;
  const hasHigherHighsLows = features.priceStructure_higherHighsLows === 1;
  const isAccumulating = features.institutional_accumulation === 1;
  const netInstitutional = features.institutional_netScore || 0;

  // ===== STRICTER SWING TRADING CRITERIA =====

  const criteria = {
    scoreThreshold: 2, // Only scores 1-2 are buys
    minConfidence: 0.5, // RAISED from 0.4
    minRiskReward: 2.5, // RAISED from 2.0
    minRelativeStrength: 50, // RAISED from 40
    maxVolatility: 0.5, // NEW: Max acceptable volatility
    avoidStages: ["DECLINING", "DISTRIBUTION", "TRANSITIONAL"], // Added TRANSITIONAL
    avoidRegimes: ["BEARISH", "VOLATILE", "CHOPPY"], // Added VOLATILE and CHOPPY
    requireTrendStructure: true, // NEW: Require proper trend structure
  };

  // ===== ENHANCED BUY DECISION LOGIC =====

  // Primary checks
  const isStrongSignal = score <= criteria.scoreThreshold;
  const hasConfidence = confidence >= criteria.minConfidence;
  const hasGoodRR = riskRewardRatio >= criteria.minRiskReward;
  const hasStrength = relativeStrength >= criteria.minRelativeStrength;
  const isGoodStage = !criteria.avoidStages.includes(stage);
  const hasValidLevels =
    Number.isFinite(stopLoss) && Number.isFinite(priceTarget);

  // Enhanced regime checks
  const isAcceptableRegime =
    !criteria.avoidRegimes.includes(longTermRegime) &&
    !criteria.avoidRegimes.includes(shortTermRegime);

  // Volatility check
  const hasAcceptableVolatility = volatility <= criteria.maxVolatility;

  // Trend structure check
  const hasTrendStructure =
    !criteria.requireTrendStructure || hasHigherHighsLows;

  // Count positive confirmations
  const positiveSignals = [
    relativeStrength >= 80, // RS leader
    stage === "ADVANCING", // In uptrend
    stage === "ACCUMULATION" && confidence > 0.6, // Good accumulation
    isAccumulating && netInstitutional > 5, // Institutional buying
    hasHigherHighsLows, // Proper trend structure
    riskRewardRatio >= 3.0, // Excellent R:R
    confidence >= 0.7, // High confidence
  ].filter(Boolean).length;

  // Require at least 2 positive confirmations
  const hasMultipleConfirmations = positiveSignals >= 2;

  // ===== FINAL DECISION WITH STRICT REQUIREMENTS =====

  // All conditions must be met for a buy
  if (
    isStrongSignal &&
    hasConfidence &&
    hasGoodRR &&
    hasStrength &&
    isGoodStage &&
    isAcceptableRegime &&
    hasValidLevels &&
    hasAcceptableVolatility &&
    hasTrendStructure &&
    hasMultipleConfirmations
  ) {
    // Build detailed reason string
    const reasons = [];

    // Signal strength
    if (score === 1 && confidence >= 0.7) {
      reasons.push("STRONG BUY signal");
    } else if (score === 1) {
      reasons.push("Strong signal");
    } else {
      reasons.push("Buy signal");
    }

    // Confidence
    reasons.push(`${Math.round(confidence * 100)}% conf`);

    // Risk/Reward
    if (riskRewardRatio >= 3.0) {
      reasons.push(`excellent ${riskRewardRatio.toFixed(1)}:1 R:R`);
    } else {
      reasons.push(`${riskRewardRatio.toFixed(1)}:1 R:R`);
    }

    // Relative Strength
    if (relativeStrength >= 85) {
      reasons.push(`RS leader (${relativeStrength})`);
    } else if (relativeStrength >= 70) {
      reasons.push(`RS ${relativeStrength}`);
    }

    // Stage/Trend
    if (stage === "ADVANCING" && hasHigherHighsLows) {
      reasons.push("strong uptrend");
    } else if (stage === "ADVANCING") {
      reasons.push("uptrend");
    } else if (stage === "ACCUMULATION") {
      reasons.push("accumulation breakout");
    }

    // Institutional activity
    if (isAccumulating && netInstitutional > 5) {
      reasons.push("institutional buying");
    }

    // Add top insight if meaningful
    const meaningfulInsight = keyInsights.find(
      (insight) =>
        insight.includes("pullback") ||
        insight.includes("breakout") ||
        insight.includes("accumulation")
    );
    if (meaningfulInsight) {
      reasons.push(meaningfulInsight);
    }

    return {
      isBuyNow: true,
      reason: reasons.slice(0, 5).join(" | "), // Limit to 5 reasons
      details: {
        score,
        confidence,
        riskRewardRatio,
        stopLoss,
        priceTarget,
        positionSize: getPositionSizeRecommendation(
          confidence,
          riskRewardRatio,
          score,
          volatility
        ),
        stage,
        relativeStrength,
        volatility,
        positiveSignals,
        regime: `${longTermRegime}/${shortTermRegime}`,
      },
    };
  }

  // ===== HANDLE REJECTIONS WITH CLEAR REASONING =====

  // Near-miss watch candidates (stricter criteria)
  if (score <= 3 && confidence >= 0.4 && riskRewardRatio >= 2.0) {
    const watchReasons = [];
    watchReasons.push("WATCH");

    // Identify what's missing
    const missingItems = [];
    if (!hasConfidence)
      missingItems.push(`conf ${Math.round(confidence * 100)}%`);
    if (!hasGoodRR) missingItems.push(`R:R ${riskRewardRatio.toFixed(1)}`);
    if (!hasAcceptableVolatility) missingItems.push("high volatility");
    if (!hasTrendStructure) missingItems.push("no trend");
    if (!hasMultipleConfirmations)
      missingItems.push(`only ${positiveSignals} signals`);
    if (!isGoodStage) missingItems.push(`${stage} stage`);

    watchReasons.push(`Missing: ${missingItems.slice(0, 2).join(", ")}`);

    // Add any positive aspects
    if (relativeStrength >= 70) watchReasons.push(`RS ${relativeStrength}`);
    if (keyInsights.length > 0) watchReasons.push(keyInsights[0]);

    return {
      isBuyNow: false,
      reason: watchReasons.join(" - "),
      details: {
        score,
        confidence,
        riskRewardRatio,
        nearMiss: true,
        missingCriteria: getMissingCriteria(criteria, {
          isStrongSignal,
          hasConfidence,
          hasGoodRR,
          hasStrength,
          isGoodStage,
          isAcceptableRegime,
          hasValidLevels,
          hasAcceptableVolatility,
          hasTrendStructure,
          hasMultipleConfirmations,
        }),
        positiveSignals,
      },
    };
  }

  // Clear rejection with prioritized reasons
  const rejectionReasons = [];

  // Priority 1: Major disqualifiers
  if (!isGoodStage) {
    rejectionReasons.push(`${stage} stage`);
  }
  if (!isAcceptableRegime) {
    const regimeText = [longTermRegime, shortTermRegime]
      .filter((r) => criteria.avoidRegimes.includes(r))
      .join("/");
    rejectionReasons.push(`${regimeText} regime`);
  }

  // Priority 2: Signal quality
  if (!isStrongSignal) {
    rejectionReasons.push(`Weak signal (score ${score})`);
  }
  if (!hasConfidence) {
    rejectionReasons.push(`Low conf (${Math.round(confidence * 100)}%)`);
  }

  // Priority 3: Risk issues
  if (!hasGoodRR && hasValidLevels) {
    rejectionReasons.push(`Poor R:R (${riskRewardRatio.toFixed(1)}:1)`);
  }
  if (!hasAcceptableVolatility && volatility > 0) {
    rejectionReasons.push(
      `High volatility (${(volatility * 100).toFixed(0)}%)`
    );
  }

  // Priority 4: Structural issues
  if (!hasStrength) {
    rejectionReasons.push(`Weak RS (${relativeStrength})`);
  }
  if (!hasTrendStructure) {
    rejectionReasons.push("No trend structure");
  }
  if (!hasMultipleConfirmations) {
    rejectionReasons.push(`Insufficient confirmations (${positiveSignals})`);
  }

  // Priority 5: Technical issues
  if (!hasValidLevels) {
    rejectionReasons.push("Invalid levels");
  }

  // Construct final rejection message
  const primaryReason = rejectionReasons[0] || "Does not meet criteria";
  const secondaryReasons = rejectionReasons.slice(1, 3);

  return {
    isBuyNow: false,
    reason:
      secondaryReasons.length > 0
        ? `${primaryReason} | ${secondaryReasons.join(" | ")}`
        : primaryReason,
    details: {
      score,
      confidence,
      riskRewardRatio,
      recommendation,
      allReasons: rejectionReasons,
      positiveSignals,
      stage,
      relativeStrength,
      regime: `${longTermRegime}/${shortTermRegime}`,
    },
  };
}

/**
 * Enhanced position size recommendation with volatility consideration
 */
function getPositionSizeRecommendation(
  confidence,
  riskRewardRatio,
  score,
  volatility
) {
  // Start with base sizing
  let size = "QUARTER"; // Default to smallest

  // High quality setup
  if (confidence >= 0.7 && riskRewardRatio >= 3.0 && score === 1) {
    size = "FULL";
  }
  // Good quality setup
  else if (confidence >= 0.6 && riskRewardRatio >= 2.5 && score <= 2) {
    size = "NORMAL";
  }
  // Acceptable setup
  else if (confidence >= 0.5 && riskRewardRatio >= 2.0) {
    size = "HALF";
  }

  // Reduce for high volatility
  if (volatility > 0.4) {
    if (size === "FULL") size = "NORMAL";
    else if (size === "NORMAL") size = "HALF";
    else if (size === "HALF") size = "QUARTER";
  } else if (volatility > 0.3) {
    if (size === "FULL") size = "NORMAL";
  }

  return size;
}

/**
 * Enhanced criteria checking with new requirements
 */
function getMissingCriteria(criteria, checks) {
  const missing = [];

  if (!checks.isStrongSignal) missing.push("score");
  if (!checks.hasConfidence) missing.push("confidence");
  if (!checks.hasGoodRR) missing.push("risk-reward");
  if (!checks.hasStrength) missing.push("relative-strength");
  if (!checks.isGoodStage) missing.push("stage");
  if (!checks.isAcceptableRegime) missing.push("regime");
  if (!checks.hasValidLevels) missing.push("levels");
  if (!checks.hasAcceptableVolatility) missing.push("volatility");
  if (!checks.hasTrendStructure) missing.push("trend-structure");
  if (!checks.hasMultipleConfirmations) missing.push("confirmations");

  return missing;
}

/**
 * Quick check function for screening with stricter criteria
 */
export function quickBuyCheck(entryAnalysis) {
  if (!entryAnalysis) return { buy: false, score: 7 };

  const {
    score = 7,
    confidence = 0,
    riskRewardRatio = 0,
    stage = "UNKNOWN",
    relativeStrength = 50,
    longTermRegime = "UNKNOWN",
    shortTermRegime = "UNKNOWN",
  } = entryAnalysis;

  // Stricter quick check
  const buy =
    score <= 2 &&
    confidence >= 0.5 && // Raised
    riskRewardRatio >= 2.5 && // Raised
    relativeStrength >= 50 && // Added
    !["DECLINING", "DISTRIBUTION", "TRANSITIONAL"].includes(stage) &&
    !["BEARISH", "VOLATILE", "CHOPPY"].includes(longTermRegime) &&
    !["BEARISH", "VOLATILE", "CHOPPY"].includes(shortTermRegime);

  return { buy, score };
}

/**
 * Alternative entry point that runs the full analysis
 */
export function getCompleteBuyDecision(
  stock,
  historicalData,
  marketData = null
) {
  const { getComprehensiveEntryTiming } = require("./entryTimingOrchestrator");

  // Run the comprehensive analysis
  const entryAnalysis = getComprehensiveEntryTiming(
    stock,
    historicalData,
    marketData
  );

  // Convert to buy decision
  return getBuyTrigger(stock, historicalData, entryAnalysis);
}
