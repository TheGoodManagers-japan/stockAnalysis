/**
 * Simplified Buy Trigger Wrapper for Swing Trading
 *
 * This is a thin wrapper around the comprehensive entry timing analysis
 * that converts the sophisticated scoring into a simple buy/no-buy decision
 * suitable for automated trading systems or simple dashboards.
 *
 * Key features:
 * - Respects the orchestrator's analysis completely
 * - Adds swing-specific filters (min R:R, confidence thresholds)
 * - Provides clear, actionable reasons
 * - Includes pre-market safety checks
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
  } = entryAnalysis;

  // ===== SWING TRADING CRITERIA =====

  const criteria = {
    scoreThreshold: 2, // Only scores 1-2 are buys
    minConfidence: 0.4, // Minimum 40% confidence
    minRiskReward: 2.0, // Minimum 2:1 R:R for swings
    minRelativeStrength: 40, // Don't buy extremely weak stocks
    avoidStages: ["DECLINING", "DISTRIBUTION"], // Bad stages for longs
    avoidRegimes: ["BEARISH"], // Avoid if both regimes bearish
  };

  // ===== BUY DECISION LOGIC =====

  // Check if it's a strong enough signal
  const isStrongSignal = score <= criteria.scoreThreshold;

  // Check confidence
  const hasConfidence = confidence >= criteria.minConfidence;

  // Check risk/reward
  const hasGoodRR = riskRewardRatio >= criteria.minRiskReward;

  // Check relative strength
  const hasStrength = relativeStrength >= criteria.minRelativeStrength;

  // Check stage
  const isGoodStage = !criteria.avoidStages.includes(stage);

  // Check regime (avoid if both are bearish)
  const isAcceptableRegime = !(
    longTermRegime === "BEARISH" && shortTermRegime === "BEARISH"
  );

  // Check if stops/targets are valid
  const hasValidLevels =
    Number.isFinite(stopLoss) && Number.isFinite(priceTarget);

  // ===== COMPILE DECISION =====

  // Strong buy conditions
  if (
    isStrongSignal &&
    hasConfidence &&
    hasGoodRR &&
    hasStrength &&
    isGoodStage &&
    isAcceptableRegime &&
    hasValidLevels
  ) {
    // Build reason string
    const reasons = [];

    if (score === 1) {
      reasons.push("STRONG BUY signal");
    } else {
      reasons.push("BUY signal");
    }

    reasons.push(`${Math.round(confidence * 100)}% confidence`);
    reasons.push(`${riskRewardRatio.toFixed(1)}:1 R:R`);

    if (relativeStrength >= 80) {
      reasons.push("RS leader");
    }

    if (stage === "ADVANCING") {
      reasons.push("uptrend");
    } else if (stage === "ACCUMULATION") {
      reasons.push("accumulation");
    }

    // Add top insight if available
    if (keyInsights.length > 0) {
      reasons.push(keyInsights[0]);
    }

    return {
      isBuyNow: true,
      reason: reasons.join(" | "),
      details: {
        score,
        confidence,
        riskRewardRatio,
        stopLoss,
        priceTarget,
        positionSize: getPositionSizeRecommendation(
          confidence,
          riskRewardRatio,
          score
        ),
        stage,
        relativeStrength,
      },
    };
  }

  // ===== HANDLE REJECTIONS =====

  // Near-miss watch candidates
  if (score === 3 || (score === 2 && !hasGoodRR)) {
    const watchReasons = [];
    watchReasons.push("WATCH");

    if (!hasGoodRR) {
      watchReasons.push(`R:R only ${riskRewardRatio.toFixed(1)}:1`);
    }
    if (!hasConfidence) {
      watchReasons.push(`confidence only ${Math.round(confidence * 100)}%`);
    }
    if (keyInsights.length > 0) {
      watchReasons.push(keyInsights[0]);
    }

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
        }),
      },
    };
  }

  // Clear rejection
  const rejectionReasons = [];

  if (!isStrongSignal) {
    rejectionReasons.push(`Weak signal (score ${score})`);
  }

  if (!hasConfidence) {
    rejectionReasons.push(`Low confidence (${Math.round(confidence * 100)}%)`);
  }

  if (!hasGoodRR && hasValidLevels) {
    rejectionReasons.push(`Poor R:R (${riskRewardRatio.toFixed(1)}:1)`);
  }

  if (!hasStrength) {
    rejectionReasons.push(`Weak RS (${relativeStrength})`);
  }

  if (!isGoodStage) {
    rejectionReasons.push(`Bad stage (${stage})`);
  }

  if (!isAcceptableRegime) {
    rejectionReasons.push("Bearish regime");
  }

  if (!hasValidLevels) {
    rejectionReasons.push("Invalid stop/target levels");
  }

  return {
    isBuyNow: false,
    reason: rejectionReasons.slice(0, 3).join(" | "), // Top 3 reasons
    details: {
      score,
      confidence,
      riskRewardRatio,
      recommendation,
      allReasons: rejectionReasons,
    },
  };
}

/**
 * Get position size recommendation based on signal quality
 */
function getPositionSizeRecommendation(confidence, riskRewardRatio, score) {
  // High quality setup
  if (confidence >= 0.7 && riskRewardRatio >= 3.0 && score === 1) {
    return "FULL";
  }

  // Good quality setup
  if (confidence >= 0.6 && riskRewardRatio >= 2.5 && score <= 2) {
    return "NORMAL";
  }

  // Acceptable setup
  if (confidence >= 0.5 && riskRewardRatio >= 2.0) {
    return "HALF";
  }

  // Marginal setup
  return "QUARTER";
}

/**
 * Identify which criteria are missing for debugging
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

  return missing;
}

/**
 * Alternative entry point that runs the full analysis
 * Convenience function that combines orchestrator + wrapper
 */
export function getCompleteBuyDecision(
  stock,
  historicalData,
  marketData = null
) {
  // Import the orchestrator (adjust path as needed)
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

/**
 * Quick check function for screening many stocks
 * Returns just the boolean and score for fast filtering
 */
export function quickBuyCheck(entryAnalysis) {
  if (!entryAnalysis) return { buy: false, score: 7 };

  const {
    score = 7,
    confidence = 0,
    riskRewardRatio = 0,
    stage = "UNKNOWN",
  } = entryAnalysis;

  // Quick check with minimal criteria
  const buy =
    score <= 2 &&
    confidence >= 0.4 &&
    riskRewardRatio >= 2.0 &&
    !["DECLINING", "DISTRIBUTION"].includes(stage);

  return { buy, score };
}
