/**
 * Enhanced Buy Trigger for Swing Trading - FIXED VERSION
 *
 * Major fixes:
 * - Strict extension/exhaustion checks
 * - No buying into parabolic moves
 * - Requires confirmed support for pullbacks
 * - "Wait for pullback" signals instead of chasing
 * - Removed opportunistic tier for weak setups
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
    extension = {}, // NEW
    exhaustion = {}, // NEW
    debug = {},
  } = entryAnalysis;

  // Extract additional features
  const features = debug.features || {};
  const volatility = features.riskMetrics_volatility || 0;
  const hasHigherHighsLows = features.priceStructure_higherHighsLows === 1;
  const isAccumulating = features.institutional_accumulation === 1;
  const netInstitutional = features.institutional_netScore || 0;
  const volumeConfirmation = features.volume_confirmation === 1;
  const nearSupport = features.trendStructure_nearSupport === 1;
  const hasPullback = features.priceStructure_pullback === 1;

  // ===== NEW: EXTENSION/EXHAUSTION CHECK =====
  // This comes FIRST - no point checking other criteria if extended
  if (extension.isExtended || exhaustion.isExhausted) {
    const extensionReasons = [];

    if (extension.isParabolic) {
      extensionReasons.push("parabolic move");
    } else if (extension.extensionLevel === "EXTREME") {
      extensionReasons.push(
        `extremely extended (${(extension.distanceFromMA20 * 100).toFixed(
          0
        )}% above MA20)`
      );
    } else if (extension.isExtended) {
      extensionReasons.push(
        `extended ${(extension.distanceFromMA20 * 100).toFixed(0)}% above MA20`
      );
    }

    if (exhaustion.isExhausted) {
      extensionReasons.push(
        `showing exhaustion (${exhaustion.signals.join(", ")})`
      );
    }

    return {
      isBuyNow: false,
      reason: `WAIT FOR PULLBACK - ${extensionReasons.join(" and ")}`,
      waitForPullback: true, // NEW flag
      details: {
        score,
        confidence,
        riskRewardRatio,
        extensionLevel: extension.extensionLevel,
        extensionScore: extension.extensionScore,
        exhaustionScore: exhaustion.exhaustionScore,
        distanceFromMA20: (extension.distanceFromMA20 * 100).toFixed(1) + "%",
        distanceFromMA50: (extension.distanceFromMA50 * 100).toFixed(1) + "%",
        consecutiveUpDays: extension.consecutiveUpDays,
        suggestion: "Monitor for pullback to MA20/MA50 or support level",
      },
    };
  }

  // ===== TIERED CRITERIA (STRICTER) =====
  const buyTiers = {
    // Tier 1: Strong Buy - Full position (VERY STRICT)
    strong: {
      minScore: 1,
      maxScore: 1,
      minConfidence: 0.7, // Raised from 0.65
      minRiskReward: 3.0, // Raised from 2.5
      minRelativeStrength: 65, // Lowered from 70 (don't need super high RS)
      maxRelativeStrength: 85, // NEW: Cap to avoid chasing
      requiredConditions: 4, // Raised from 3
      requiresPullback: true, // NEW: Must have pullback
    },
    // Tier 2: Standard Buy - Normal position
    standard: {
      minScore: 1,
      maxScore: 2,
      minConfidence: 0.55, // Raised from 0.5
      minRiskReward: 2.5, // Raised from 2.0
      minRelativeStrength: 50,
      maxRelativeStrength: 90,
      requiredConditions: 3, // Raised from 2
      requiresPullback: false, // Can buy breakouts
    },
    // REMOVED opportunistic tier - too risky
  };

  // ===== ABSOLUTE DISQUALIFIERS (EXPANDED) =====
  const disqualifiers = [
    stage === "DECLINING",
    stage === "DISTRIBUTION",
    longTermRegime === "BEARISH" && shortTermRegime === "BEARISH",
    volatility > 0.6,
    !Number.isFinite(stopLoss) || !Number.isFinite(priceTarget),
    stopLoss <= 0 || priceTarget <= 0,
    relativeStrength < 40,
    // NEW disqualifiers
    extension.shortTermGain > 0.15, // Up >15% in recent days
    extension.consecutiveUpDays >= 7, // 7+ up days in a row
  ];

  if (disqualifiers.some(Boolean)) {
    const disqualifyReason = getDisqualifyReason(
      stage,
      longTermRegime,
      shortTermRegime,
      volatility,
      stopLoss,
      priceTarget,
      relativeStrength,
      extension
    );
    return {
      isBuyNow: false,
      reason: `Disqualified: ${disqualifyReason}`,
      details: {
        score,
        confidence,
        riskRewardRatio,
        disqualified: true,
        reason: disqualifyReason,
      },
    };
  }

  // ===== BONUS CONDITIONS (MORE STRICT) =====
  const bonusConditions = {
    confirmedPullback: hasPullback && nearSupport && !extension.isExtended,
    strongTrend:
      stage === "ADVANCING" && hasHigherHighsLows && !extension.isExtended,
    accumulation: stage === "ACCUMULATION" && confidence > 0.55,
    institutional: isAccumulating && netInstitutional > 5, // Raised from 3
    momentum: relativeStrength >= 60 && relativeStrength <= 85, // Capped
    excellentRR: riskRewardRatio >= 3.0,
    volume: volumeConfirmation,
    support: nearSupport,
    regime:
      (longTermRegime === "TRENDING" || shortTermRegime === "TRENDING") &&
      !longTermRegime.includes("BEARISH"),
    lowVolatility: volatility < 0.25, // Stricter
  };

  const bonusCount = Object.values(bonusConditions).filter(Boolean).length;

  // ===== EVALUATE AGAINST TIERS =====
  let qualifyingTier = null;
  let tierName = "";

  for (const [name, tier] of Object.entries(buyTiers)) {
    const meetsScore = score >= tier.minScore && score <= tier.maxScore;
    const meetsConfidence = confidence >= tier.minConfidence;
    const meetsRR = riskRewardRatio >= tier.minRiskReward;
    const meetsRS =
      relativeStrength >= tier.minRelativeStrength &&
      relativeStrength <= tier.maxRelativeStrength;
    const meetsBonus = bonusCount >= tier.requiredConditions;
    const meetsPullback =
      !tier.requiresPullback || bonusConditions.confirmedPullback;

    if (
      meetsScore &&
      meetsConfidence &&
      meetsRR &&
      meetsRS &&
      meetsBonus &&
      meetsPullback
    ) {
      qualifyingTier = tier;
      tierName = name;
      break;
    }
  }

  // ===== SPECIAL SETUPS (MORE STRICT) =====
  const specialSetup = checkSpecialSetups(
    keyInsights,
    confidence,
    riskRewardRatio,
    stage,
    bonusConditions,
    extension
  );

  // Only allow special setups if they're really good
  if (
    specialSetup.qualified &&
    !qualifyingTier &&
    specialSetup.confidence >= 0.6
  ) {
    qualifyingTier = buyTiers.standard;
    tierName = "special";
  }

  // ===== GENERATE BUY DECISION =====
  if (
    qualifyingTier ||
    (specialSetup.qualified && specialSetup.confidence >= 0.6)
  ) {
    // Final safety check - no buying if showing any exhaustion
    if (exhaustion.signals && exhaustion.signals.length > 0) {
      return {
        isBuyNow: false,
        reason: `WAIT - Exhaustion signals present: ${exhaustion.signals.join(
          ", "
        )}`,
        waitForConfirmation: true,
        details: {
          score,
          confidence,
          riskRewardRatio,
          exhaustionSignals: exhaustion.signals,
          suggestion: "Wait for exhaustion to clear",
        },
      };
    }

    const positionSize = getPositionSize(
      tierName,
      confidence,
      riskRewardRatio,
      volatility,
      bonusCount,
      extension
    );

    const reasons = buildBuyReasons(
      tierName,
      score,
      confidence,
      riskRewardRatio,
      relativeStrength,
      stage,
      bonusConditions,
      specialSetup,
      keyInsights
    );

    return {
      isBuyNow: true,
      reason: reasons.join(" | "),
      details: {
        tier: tierName,
        score,
        confidence,
        riskRewardRatio,
        stopLoss,
        priceTarget,
        positionSize,
        stage,
        relativeStrength,
        volatility,
        bonusCount,
        bonusConditions: Object.entries(bonusConditions)
          .filter(([_, v]) => v)
          .map(([k]) => k),
        regime: `${longTermRegime}/${shortTermRegime}`,
        specialSetup: specialSetup.type,
        extensionLevel: extension.extensionLevel,
      },
    };
  }

  // ===== NEAR MISS ANALYSIS =====
  const nearMissAnalysis = analyzeNearMiss(
    score,
    confidence,
    riskRewardRatio,
    relativeStrength,
    bonusCount,
    buyTiers.standard,
    bonusConditions,
    extension
  );

  if (nearMissAnalysis.isNearMiss) {
    return {
      isBuyNow: false,
      reason: `WATCH - ${nearMissAnalysis.reason}`,
      details: {
        score,
        confidence,
        riskRewardRatio,
        nearMiss: true,
        missing: nearMissAnalysis.missing,
        bonusCount,
        suggestion: nearMissAnalysis.suggestion,
      },
    };
  }

  // ===== STANDARD REJECTION =====
  return {
    isBuyNow: false,
    reason: buildRejectionReason(
      score,
      confidence,
      riskRewardRatio,
      relativeStrength,
      stage,
      bonusCount
    ),
    details: {
      score,
      confidence,
      riskRewardRatio,
      stage,
      relativeStrength,
      bonusCount,
      recommendation,
    },
  };
}

// ===== UPDATED HELPER FUNCTIONS =====

function getDisqualifyReason(
  stage,
  longTermRegime,
  shortTermRegime,
  volatility,
  stopLoss,
  priceTarget,
  relativeStrength,
  extension
) {
  if (stage === "DECLINING") return "Declining stage";
  if (stage === "DISTRIBUTION") return "Distribution stage";
  if (longTermRegime === "BEARISH" && shortTermRegime === "BEARISH")
    return "Bearish regime";
  if (volatility > 0.6)
    return `Extreme volatility (${(volatility * 100).toFixed(0)}%)`;
  if (!Number.isFinite(stopLoss) || !Number.isFinite(priceTarget))
    return "Invalid levels";
  if (relativeStrength < 40) return `Very weak RS (${relativeStrength})`;
  if (extension.shortTermGain > 0.15)
    return `Recent gain too high (${(extension.shortTermGain * 100).toFixed(
      0
    )}%)`;
  if (extension.consecutiveUpDays >= 7)
    return `Too many consecutive up days (${extension.consecutiveUpDays})`;
  return "Failed criteria";
}

function checkSpecialSetups(
  keyInsights,
  confidence,
  riskRewardRatio,
  stage,
  bonusConditions,
  extension
) {
  const insightsText = keyInsights.join(" ").toLowerCase();

  // NEW: No special setups if extended
  if (extension.isExtended) {
    return { qualified: false, type: null, confidence: 0 };
  }

  // Breakout setup (STRICTER)
  if (
    (insightsText.includes("breakout") ||
      insightsText.includes("breaking out")) &&
    confidence >= 0.6 && // Raised from 0.45
    riskRewardRatio >= 2.5 && // Raised from 1.8
    bonusConditions.volume &&
    bonusConditions.institutional
  ) {
    return { qualified: true, type: "breakout", confidence };
  }

  // Pullback to support (STRICTER)
  if (
    insightsText.includes("pullback") &&
    bonusConditions.support &&
    bonusConditions.confirmedPullback && // NEW requirement
    stage === "ADVANCING" &&
    confidence >= 0.55 // Raised from 0.4
  ) {
    return { qualified: true, type: "pullback", confidence };
  }

  // Accumulation completion (STRICTER)
  if (
    stage === "ACCUMULATION" &&
    bonusConditions.institutional &&
    confidence >= 0.6 && // Raised from 0.45
    riskRewardRatio >= 2.5 && // Raised from 2.0
    !extension.isExtended
  ) {
    return { qualified: true, type: "accumulation", confidence };
  }

  return { qualified: false, type: null, confidence: 0 };
}

function getPositionSize(
  tierName,
  confidence,
  riskRewardRatio,
  volatility,
  bonusCount,
  extension
) {
  // NEW: Never full size if any extension present
  if (extension.distanceFromMA20 > 0.08) {
    return "HALF";
  }

  let baseSize;

  // Base size by tier
  switch (tierName) {
    case "strong":
      baseSize = bonusCount >= 6 ? "FULL" : "NORMAL+"; // Harder to get full
      break;
    case "standard":
      baseSize = "NORMAL";
      break;
    case "special":
      baseSize = "HALF";
      break;
    default:
      baseSize = "QUARTER";
  }

  // Adjust for volatility
  if (volatility > 0.35) {
    // Stricter than 0.45
    if (baseSize === "FULL") baseSize = "NORMAL";
    else if (baseSize === "NORMAL+") baseSize = "NORMAL";
    else if (baseSize === "NORMAL") baseSize = "HALF";
    else if (baseSize === "HALF") baseSize = "QUARTER";
  }

  // Only boost for truly exceptional setups
  if (
    bonusCount >= 7 && // Raised from 6
    confidence >= 0.75 && // Raised from 0.7
    riskRewardRatio >= 3.5 && // Raised from 3.0
    volatility < 0.25 && // Stricter
    !extension.isExtended
  ) {
    if (baseSize === "NORMAL") baseSize = "NORMAL+";
    else if (baseSize === "HALF") baseSize = "NORMAL";
  }

  return baseSize;
}

function analyzeNearMiss(
  score,
  confidence,
  riskRewardRatio,
  relativeStrength,
  bonusCount,
  minTier,
  bonusConditions,
  extension
) {
  const missing = [];

  // Check against minimum tier
  if (score > minTier.maxScore) {
    missing.push(`score ${score} > ${minTier.maxScore}`);
  }
  if (confidence < minTier.minConfidence) {
    missing.push(
      `conf ${Math.round(confidence * 100)}% < ${Math.round(
        minTier.minConfidence * 100
      )}%`
    );
  }
  if (riskRewardRatio < minTier.minRiskReward) {
    missing.push(
      `R:R ${riskRewardRatio.toFixed(1)} < ${minTier.minRiskReward}`
    );
  }
  if (relativeStrength < minTier.minRelativeStrength) {
    missing.push(`RS ${relativeStrength} < ${minTier.minRelativeStrength}`);
  }
  if (relativeStrength > minTier.maxRelativeStrength) {
    missing.push(
      `RS ${relativeStrength} > ${minTier.maxRelativeStrength} (too hot)`
    );
  }
  if (bonusCount < minTier.requiredConditions) {
    missing.push(
      `${bonusCount}/${minTier.requiredConditions} bonus conditions`
    );
  }

  // NEW: Check if just needs pullback
  if (extension.isExtended && missing.length === 0) {
    return {
      isNearMiss: true,
      missing: ["waiting for pullback"],
      reason: "Good setup but extended - wait for pullback",
      suggestion: "Monitor for pullback to support",
    };
  }

  // It's a near miss if only 1-2 things are missing
  const isNearMiss = missing.length <= 2 && missing.length > 0;

  if (isNearMiss) {
    const suggestion =
      missing.length === 1
        ? "Almost ready"
        : "Needs improvement in multiple areas";

    return {
      isNearMiss: true,
      missing,
      reason: missing.slice(0, 2).join(", "),
      suggestion,
    };
  }

  return { isNearMiss: false };
}

function buildBuyReasons(
  tierName,
  score,
  confidence,
  riskRewardRatio,
  relativeStrength,
  stage,
  bonusConditions,
  specialSetup,
  keyInsights
) {
  const reasons = [];

  // Lead with signal strength
  if (tierName === "strong") {
    reasons.push("STRONG BUY");
  } else if (specialSetup.qualified) {
    reasons.push(`${specialSetup.type.toUpperCase()} BUY`);
  } else {
    reasons.push("BUY");
  }

  // Confidence
  reasons.push(`${Math.round(confidence * 100)}% conf`);

  // Risk/Reward
  if (riskRewardRatio >= 3.0) {
    reasons.push(`${riskRewardRatio.toFixed(1)}:1 R:R!`);
  } else {
    reasons.push(`${riskRewardRatio.toFixed(1)}:1 R:R`);
  }

  // Add most relevant bonus conditions
  if (bonusConditions.confirmedPullback) {
    reasons.push("confirmed pullback");
  } else if (bonusConditions.strongTrend) {
    reasons.push("strong trend");
  } else if (bonusConditions.institutional) {
    reasons.push("institutional buying");
  } else if (bonusConditions.momentum) {
    reasons.push(`RS ${relativeStrength}`);
  }

  return reasons.slice(0, 5);
}

function buildRejectionReason(
  score,
  confidence,
  riskRewardRatio,
  relativeStrength,
  stage,
  bonusCount
) {
  const issues = [];

  if (score > 2) {
    issues.push(`Weak signal (${score})`);
  }
  if (confidence < 0.55) {
    // Raised threshold
    issues.push(`Low conf (${Math.round(confidence * 100)}%)`);
  }
  if (riskRewardRatio < 2.5) {
    // Raised threshold
    issues.push(`Poor R:R (${riskRewardRatio.toFixed(1)}:1)`);
  }
  if (relativeStrength < 50) {
    issues.push(`Weak RS (${relativeStrength})`);
  } else if (relativeStrength > 90) {
    issues.push(`RS too high (${relativeStrength}) - likely extended`);
  }
  if (bonusCount < 3) {
    // Raised threshold
    issues.push(`Few positives (${bonusCount})`);
  }

  return issues.slice(0, 3).join(" | ") || "Does not meet criteria";
}
