// ================== Feature Extraction & ML Scoring ==================

/**
 * Flattens analysis results into a flat feature map (f0_key, f1_key, ...).
 */
export function extractFeatureVector(...analyses) {
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

/**
 * Computes a heuristic ML score from the feature vector.
 * Positive = bullish, negative = bearish. Clamped to [-5, 5].
 */
export function calculateMLScore(features) {
  let score = 0;

  // STRICTER quality hurdle - require MORE signals
  let qualityPoints = 0;
  if (features.f2_clean) qualityPoints++;
  if (features.f9_isHealthyTrend) qualityPoints++;
  if (features.f4_type_TRENDING) qualityPoints++;
  if (features.f2_trendEfficiency > 0.5) qualityPoints++;

  // Penalize poor quality more heavily
  if (qualityPoints < 2) score -= 1.5;
  else if (qualityPoints < 3) score -= 0.5;

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
  if (features.f2_choppy) score -= 1.0;
  if (features.f8_isExtended && !features.f9_isHealthyTrend) score -= 1.5;

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

/**
 * Map a regime + mlScore to a compact tier (1..7).
 * 1 = Strong Bullish ... 7 = Strong Bearish
 */
export function mapRegimeToTier(longTermRegime, mlScore = 0) {
  const has = (arr, s) => Array.isArray(arr) && arr.includes(s);

  // Default neutral
  let tier = 4;

  if (longTermRegime?.type === "TRENDING" && has(longTermRegime.characteristics, "UPTREND")) {
    // Better mlScore => more bullish
    tier = mlScore >= 2 ? 1 : mlScore >= 0.5 ? 2 : 3;
  } else if (longTermRegime?.type === "TRENDING" && has(longTermRegime.characteristics, "DOWNTREND")) {
    tier = mlScore <= -2.5 ? 7 : mlScore <= -1.0 ? 6 : 5;
  } else if (longTermRegime?.type === "RANGE_BOUND") {
    // Without priceActionQuality context here, keep center
    tier = 4;
  } else if (longTermRegime?.type === "CHOPPY") {
    tier = 4; // neutral for chop
  } else {
    // UNKNOWN / insufficient history
    tier = 4;
  }
  return tier;
}
