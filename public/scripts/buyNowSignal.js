/**
 * Balanced Buy Trigger Wrapper for Swing Trading
 *
 * This version maintains risk management while being practical enough
 * to actually identify good swing trading opportunities.
 *
 * Key changes from overly strict version:
 * - Tiered approach: different confidence levels trigger different position sizes
 * - Allows for "good enough" setups, not just perfect ones
 * - More nuanced scoring that doesn't require ALL conditions
 * - Separate criteria for different market conditions
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
  const volumeConfirmation = features.volume_confirmation === 1;
  const nearSupport = features.support_proximity <= 0.02; // Within 2% of support

  // ===== TIERED CRITERIA SYSTEM =====
  // Instead of one strict set, we have tiers
  const buyTiers = {
    // Tier 1: Strong Buy - Full position
    strong: {
      minScore: 1,
      maxScore: 1,
      minConfidence: 0.65,
      minRiskReward: 2.5,
      minRelativeStrength: 70,
      requiredConditions: 3, // Need 3 out of the bonus conditions
    },
    // Tier 2: Standard Buy - Normal position
    standard: {
      minScore: 1,
      maxScore: 2,
      minConfidence: 0.5,
      minRiskReward: 2.0,
      minRelativeStrength: 55,
      requiredConditions: 2, // Need 2 bonus conditions
    },
    // Tier 3: Opportunistic Buy - Half position
    opportunistic: {
      minScore: 1,
      maxScore: 2,
      minConfidence: 0.4,
      minRiskReward: 1.8,
      minRelativeStrength: 50,
      requiredConditions: 2, // Need 2 bonus conditions
    },
  };

  // ===== ABSOLUTE DISQUALIFIERS =====
  // These prevent any buy regardless of other factors
  const disqualifiers = [
    stage === "DECLINING",
    stage === "DISTRIBUTION",
    longTermRegime === "BEARISH" && shortTermRegime === "BEARISH",
    volatility > 0.6, // Extreme volatility
    !Number.isFinite(stopLoss) || !Number.isFinite(priceTarget),
    stopLoss <= 0 || priceTarget <= 0,
    relativeStrength < 40, // Too weak relative to market
  ];

  if (disqualifiers.some(Boolean)) {
    const disqualifyReason = getDisqualifyReason(
      stage,
      longTermRegime,
      shortTermRegime,
      volatility,
      stopLoss,
      priceTarget,
      relativeStrength
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

  // ===== BONUS CONDITIONS =====
  // Count positive factors that enhance the setup
  const bonusConditions = {
    strongTrend: stage === "ADVANCING" && hasHigherHighsLows,
    accumulation: stage === "ACCUMULATION" && confidence > 0.5,
    institutional: isAccumulating && netInstitutional > 3,
    momentum: relativeStrength >= 65,
    excellentRR: riskRewardRatio >= 3.0,
    volume: volumeConfirmation,
    support: nearSupport,
    regime: longTermRegime === "BULLISH" || shortTermRegime === "BULLISH",
    lowVolatility: volatility < 0.3,
  };

  const bonusCount = Object.values(bonusConditions).filter(Boolean).length;

  // ===== EVALUATE AGAINST TIERS =====
  let qualifyingTier = null;
  let tierName = "";

  // Check each tier from strongest to weakest
  for (const [name, tier] of Object.entries(buyTiers)) {
    const meetsScore = score >= tier.minScore && score <= tier.maxScore;
    const meetsConfidence = confidence >= tier.minConfidence;
    const meetsRR = riskRewardRatio >= tier.minRiskReward;
    const meetsRS = relativeStrength >= tier.minRelativeStrength;
    const meetsBonus = bonusCount >= tier.requiredConditions;

    if (meetsScore && meetsConfidence && meetsRR && meetsRS && meetsBonus) {
      qualifyingTier = tier;
      tierName = name;
      break;
    }
  }

  // ===== SPECIAL CASES =====
  // High-confidence breakouts or pullbacks can override normal criteria
  const specialSetup = checkSpecialSetups(
    keyInsights,
    confidence,
    riskRewardRatio,
    stage,
    bonusConditions
  );

  if (specialSetup.qualified && !qualifyingTier) {
    qualifyingTier = buyTiers.opportunistic;
    tierName = "special";
  }

  // ===== GENERATE BUY DECISION =====
  if (qualifyingTier || specialSetup.qualified) {
    const positionSize = getPositionSize(
      tierName,
      confidence,
      riskRewardRatio,
      volatility,
      bonusCount
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
      },
    };
  }

  // ===== NEAR MISS ANALYSIS =====
  // Identify what's preventing a buy signal
  const nearMissAnalysis = analyzeNearMiss(
    score,
    confidence,
    riskRewardRatio,
    relativeStrength,
    bonusCount,
    buyTiers.opportunistic
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

// ===== HELPER FUNCTIONS =====

function getDisqualifyReason(
  stage,
  longTermRegime,
  shortTermRegime,
  volatility,
  stopLoss,
  priceTarget,
  relativeStrength
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
  return "Failed criteria";
}

function checkSpecialSetups(
  keyInsights,
  confidence,
  riskRewardRatio,
  stage,
  bonusConditions
) {
  const insightsText = keyInsights.join(" ").toLowerCase();

  // Breakout setup
  if (
    (insightsText.includes("breakout") ||
      insightsText.includes("breaking out")) &&
    confidence >= 0.45 &&
    riskRewardRatio >= 1.8 &&
    (bonusConditions.volume || bonusConditions.institutional)
  ) {
    return { qualified: true, type: "breakout" };
  }

  // Pullback to support
  if (
    insightsText.includes("pullback") &&
    bonusConditions.support &&
    stage === "ADVANCING" &&
    confidence >= 0.4
  ) {
    return { qualified: true, type: "pullback" };
  }

  // Accumulation completion
  if (
    stage === "ACCUMULATION" &&
    bonusConditions.institutional &&
    confidence >= 0.45 &&
    riskRewardRatio >= 2.0
  ) {
    return { qualified: true, type: "accumulation" };
  }

  return { qualified: false, type: null };
}

function getPositionSize(
  tierName,
  confidence,
  riskRewardRatio,
  volatility,
  bonusCount
) {
  let baseSize;

  // Base size by tier
  switch (tierName) {
    case "strong":
      baseSize = "FULL";
      break;
    case "standard":
      baseSize = "NORMAL";
      break;
    case "opportunistic":
    case "special":
      baseSize = "HALF";
      break;
    default:
      baseSize = "QUARTER";
  }

  // Adjust for volatility
  if (volatility > 0.45) {
    // Reduce by one level for high volatility
    if (baseSize === "FULL") baseSize = "NORMAL";
    else if (baseSize === "NORMAL") baseSize = "HALF";
    else if (baseSize === "HALF") baseSize = "QUARTER";
  }

  // Boost for exceptional setups
  if (
    bonusCount >= 6 &&
    confidence >= 0.7 &&
    riskRewardRatio >= 3.0 &&
    volatility < 0.3
  ) {
    if (baseSize === "NORMAL") baseSize = "FULL";
    else if (baseSize === "HALF") baseSize = "NORMAL";
  }

  return baseSize;
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
  if (bonusConditions.strongTrend) {
    reasons.push("strong trend");
  } else if (bonusConditions.institutional) {
    reasons.push("institutional buying");
  } else if (bonusConditions.momentum) {
    reasons.push(`RS ${relativeStrength}`);
  }

  // Add relevant insight if not redundant
  const relevantInsight = keyInsights.find(
    (insight) =>
      !reasons.some((r) => r.toLowerCase().includes(insight.toLowerCase())) &&
      insight.length < 30
  );
  if (relevantInsight) {
    reasons.push(relevantInsight);
  }

  return reasons.slice(0, 5); // Limit to 5 reasons
}

function analyzeNearMiss(
  score,
  confidence,
  riskRewardRatio,
  relativeStrength,
  bonusCount,
  minTier
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
  if (bonusCount < minTier.requiredConditions) {
    missing.push(
      `${bonusCount}/${minTier.requiredConditions} bonus conditions`
    );
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
  if (confidence < 0.4) {
    issues.push(`Low conf (${Math.round(confidence * 100)}%)`);
  }
  if (riskRewardRatio < 1.8) {
    issues.push(`Poor R:R (${riskRewardRatio.toFixed(1)}:1)`);
  }
  if (relativeStrength < 50) {
    issues.push(`Weak RS (${relativeStrength})`);
  }
  if (bonusCount < 2) {
    issues.push(`Few positives (${bonusCount})`);
  }

  return issues.slice(0, 3).join(" | ") || "Does not meet criteria";
}
