import { getLayer1PatternScore } from './layer1Analysis.js';
import { getLayer2MLAnalysis } from './layer2Analysis.js';

/**
 * Orchestrates the entry timing analysis by calling Layer 1 and Layer 2 functions,
 * then combines their results into a final comprehensive score.
 *
 * @param {object} stock - The stock object, including historicalData and currentPrice.
 * @param {object} [opts={}] - Optional configuration for weights and cutoffs.
 * @returns {object} The final analysis result.
 */
export function getComprehensiveEntryTiming(stock, historicalData) {
  // --- 1. GET LAYER 1 SCORE ---
  // Calls the short-term pattern analysis.
  const layer1Score = getLayer1PatternScore(stock, historicalData);

  // --- 2. GET LAYER 2 ANALYSIS ---
  // Calls the advanced ML and regime analysis.
  const { mlScore, features, longTermRegime, shortTermRegime } =
    getLayer2MLAnalysis(stock, historicalData);

  // --- 3. COMBINE SCORES & GENERATE FINAL OUTPUT ---
  // Normalize Layer 1 score to align with the ML score's scale.
  // A score of 1 (Strong Buy) becomes ~4, a score of 7 (Strong Avoid) becomes ~-2.
  const normalizedLayer1 = 4.5 - layer1Score * 0.75;

  const weights = { layer1: 0.25, mlAnalysis: 0.75, ...opts.layerWeights };
  const combinedScore =
    normalizedLayer1 * weights.layer1 + mlScore * weights.mlAnalysis;

  const { finalScore, confidence } = mapToFinalScoreWithConfidence(
    combinedScore,
    features,
    longTermRegime // Use long-term regime for confidence mapping
  );

  const result = getTargetsFromScore(stock, finalScore, opts);
  result.confidence = confidence;
  result.longTermRegime = longTermRegime.type;
  result.shortTermRegime = shortTermRegime.type;
  result.keyInsights = generateKeyInsights(features);

  return result;
}


/* ──────────── Advanced Confidence Mapping ──────────── */

function mapToFinalScoreWithConfidence(combinedScore, features, marketRegime) {
  let confidence = 0.5; // Base confidence

  // Adjust confidence based on feature alignment
  const bullishFeatures = Object.entries(features).filter(
    ([key, value]) => key.includes("bullish") && value === 1
  ).length;
  const bearishFeatures = Object.entries(features).filter(
    ([key, value]) => key.includes("bearish") && value === 1
  ).length;

  if (bullishFeatures > bearishFeatures + 3) {
    confidence += 0.3;
  } else if (bearishFeatures > bullishFeatures + 3) {
    confidence -= 0.3;
  }

  // Market regime confidence adjustment
  if (marketRegime.type === "TRENDING" && marketRegime.strength > 0.8) {
    confidence += 0.2;
  } else if (marketRegime.type === "CHOPPY") {
    confidence -= 0.2;
  }

  confidence = Math.max(0.1, Math.min(0.9, confidence));

  // Map score with confidence weighting
  let finalScore;
  if (combinedScore >= 4.0) finalScore = 1; // Was 3.0
  else if (combinedScore >= 2.8) finalScore = 2; // Was 2.0
  else if (combinedScore >= 1.5) finalScore = 3; // Was 1.0
  else if (combinedScore >= 0.0) finalScore = 4;
  else if (combinedScore >= -1.5) finalScore = 5; // Was -1.0
  else if (combinedScore >= -2.8) finalScore = 6; // Was -2.0
  else finalScore = 7;

  // Adjust based on confidence
  if (confidence < 0.3 && finalScore <= 2) {
    finalScore = Math.min(finalScore + 1, 7);
  }

  return { finalScore, confidence };
}

/* ──────────── Key Insights Generator ──────────── */

function generateKeyInsights(features) {
  const insights = [];

  if (features.f0_sellerExhaustion) {
    insights.push("Seller exhaustion detected - potential reversal");
  }

  if (features.f5_wyckoffSpring) {
    insights.push("Wyckoff spring pattern - high probability long setup");
  }

  if (features.f6_compression && features.f6_EXPANSION_STARTING) {
    insights.push("Volatility expansion starting from compressed state");
  }

  if (features.f1_pocRising) {
    insights.push("Volume point of control rising - bullish accumulation");
  }

  return insights;
}



function getTargetsFromScore(stock, score, opts = {}) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const currentPrice = n(stock.currentPrice);
  const atr = n(stock.atr14) || currentPrice * 0.02;

  // Validate we have minimum data
  if (!currentPrice || currentPrice <= 0) {
    return {
      score: score,
      stopLoss: null,
      priceTarget: null,
    };
  }

  // Calculate support and resistance levels
  const levels = calculateKeyLevels(stock);

  // Calculate smart stop loss
  const stopLoss = calculateSmartStopLoss(stock, levels, atr, score, opts);

  // Calculate smart price target
  const priceTarget = calculateSmartPriceTarget(
    stock,
    levels,
    atr,
    score,
    stopLoss,
    opts
  );

  return {
    score: score,
    stopLoss: stopLoss ? Math.round(stopLoss * 100) / 100 : null,
    priceTarget: priceTarget ? Math.round(priceTarget * 100) / 100 : null,
  };
}

function calculateKeyLevels(stock) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const historicalData = stock.historicalData || [];

  const levels = {
    supports: [],
    resistances: [],
    pivotPoint: null,
    recentSwingHigh: null,
    recentSwingLow: null,
  }; // Calculate pivot point from today's data

  if (stock.highPrice && stock.lowPrice && stock.currentPrice) {
    levels.pivotPoint =
      (n(stock.highPrice) + n(stock.lowPrice) + n(stock.currentPrice)) / 3;
  } // Find recent swing highs and lows from historical data

  if (historicalData.length >= 10) {
    const recentData = historicalData.slice(-20);

    for (let i = 2; i < recentData.length - 2; i++) {
      const current = recentData[i];
      const isSwingHigh =
        current.high > recentData[i - 1].high &&
        current.high > recentData[i - 2].high &&
        current.high > recentData[i + 1].high &&
        current.high > recentData[i + 2].high;

      if (isSwingHigh) {
        levels.resistances.push(current.high);
        if (!levels.recentSwingHigh || current.high > levels.recentSwingHigh) {
          levels.recentSwingHigh = current.high;
        }
      }

      const isSwingLow =
        current.low < recentData[i - 1].low &&
        current.low < recentData[i - 2].low &&
        current.low < recentData[i + 1].low &&
        current.low < recentData[i + 2].low;

      if (isSwingLow) {
        levels.supports.push(current.low);
        if (!levels.recentSwingLow || current.low < levels.recentSwingLow) {
          levels.recentSwingLow = current.low;
        }
      }
    }
  } // Add moving averages as potential support levels

  if (stock.movingAverage50d) levels.supports.push(n(stock.movingAverage50d));
  if (stock.movingAverage200d) levels.supports.push(n(stock.movingAverage200d));

  // *** ADDED FROM FUNCTION 2 ***
  // Add 52-week high as a major resistance level
  if (stock.fiftyTwoWeekHigh)
    levels.resistances.push(n(stock.fiftyTwoWeekHigh)); // Sort levels

  levels.supports.sort((a, b) => b - a); // Descending order (highest support first)
  levels.resistances.sort((a, b) => a - b); // Ascending order (lowest resistance first)

  return levels;
}

function calculateSmartStopLoss(stock, levels, atr, entryScore, opts = {}) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const currentPrice = n(stock.currentPrice);
  const lowPrice = n(stock.lowPrice);

  // Base stop loss multipliers based on entry score
  const stopMultipliers = {
    1: 1.5, // Strong Buy - tighter stop
    2: 1.8, // Buy
    3: 2.0, // Watch
    4: 2.2, // Neutral
    5: 2.5, // Caution
    6: 2.8, // Avoid
    7: 3.0, // Strong Avoid - wider stop
  };

  const baseMultiplier = stopMultipliers[entryScore] || 2.0;
  const atrMultiplier = opts.stopLossATRMultiplier || baseMultiplier;

  // Method 1: ATR-based stop
  const atrStop = currentPrice - atr * atrMultiplier;

  // Method 2: Support-based stop
  let supportStop = null;
  const nearestSupport = levels.supports.find(
    (s) => s < currentPrice && s > currentPrice * 0.95
  );
  if (nearestSupport) {
    supportStop = nearestSupport - atr * 0.5; // Small buffer below support
  }

  // Method 3: Recent low-based stop
  let recentLowStop = null;
  if (levels.recentSwingLow && levels.recentSwingLow < currentPrice) {
    recentLowStop = levels.recentSwingLow - atr * 0.3;
  }

  // Choose the most appropriate stop loss
  const candidates = [atrStop, supportStop, recentLowStop].filter(
    (s) => s !== null && s > 0
  );

  if (candidates.length === 0) {
    return currentPrice * 0.95; // Default 5% stop
  }

  // For bullish setups (scores 1-3), prefer tighter stops
  // For bearish setups (scores 5-7), prefer wider stops
  if (entryScore <= 3) {
    // Use the highest (tightest) stop for bullish setups
    return Math.max(...candidates);
  } else {
    // Use a balanced approach for neutral/bearish setups
    return candidates.reduce((a, b) => a + b) / candidates.length;
  }
}

function calculateSmartPriceTarget(
  stock,
  levels,
  atr,
  entryScore,
  stopLoss,
  opts = {}
) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const currentPrice = n(stock.currentPrice);
  const highPrice = n(stock.highPrice);

  // Minimum risk/reward ratios based on entry score
  const minRRRatios = {
    1: 2.5, // Strong Buy - higher targets
    2: 2.0, // Buy
    3: 1.8, // Watch
    4: 1.5, // Neutral
    5: 1.2, // Caution
    6: 1.0, // Avoid
    7: 0.8, // Strong Avoid - conservative targets
  };

  const minRR = opts.minRiskReward || minRRRatios[entryScore] || 1.5;
  const risk = currentPrice - (stopLoss || currentPrice * 0.95);
  const minTarget = currentPrice + risk * minRR;

  // Method 1: ATR-based target
  const targetMultipliers = {
    1: 3.0, // Strong Buy
    2: 2.5, // Buy
    3: 2.0, // Watch
    4: 1.5, // Neutral
    5: 1.2, // Caution
    6: 1.0, // Avoid
    7: 0.8, // Strong Avoid
  };

  const atrMultiplier =
    opts.targetATRMultiplier || targetMultipliers[entryScore] || 2.0;
  const atrTarget = currentPrice + atr * atrMultiplier;

  // Method 2: Resistance-based target
  let resistanceTarget = null;
  const nearestResistance = levels.resistances.find(
    (r) => r > currentPrice * 1.02
  );
  if (nearestResistance) {
    resistanceTarget = nearestResistance - atr * 0.2; // Small buffer below resistance
  }

  // Method 3: Fibonacci extension
  if (levels.recentSwingLow && levels.recentSwingHigh) {
    const swingRange = levels.recentSwingHigh - levels.recentSwingLow;
    const fib1618 = currentPrice + swingRange * 0.618;
    const fib1000 = currentPrice + swingRange;

    // Choose fibonacci level based on entry score
    resistanceTarget =
      resistanceTarget || (entryScore <= 2 ? fib1000 : fib1618);
  }

  // Method 4: Percentage-based targets
  const percentTargets = {
    1: currentPrice * 1.08, // 8% for strong buy
    2: currentPrice * 1.06, // 6% for buy
    3: currentPrice * 1.04, // 4% for watch
    4: currentPrice * 1.03, // 3% for neutral
    5: currentPrice * 1.02, // 2% for caution
    6: currentPrice * 1.015, // 1.5% for avoid
    7: currentPrice * 1.01, // 1% for strong avoid
  };
  const percentTarget = percentTargets[entryScore] || currentPrice * 1.03;

  // Method 5: 52-week high target (for bullish setups)
  let yearHighTarget = null;
  if (entryScore <= 3 && stock.fiftyTwoWeekHigh) {
    const hi52 = n(stock.fiftyTwoWeekHigh);
    if (hi52 > currentPrice && hi52 < currentPrice * 1.2) {
      yearHighTarget = hi52;
    }
  }

  // Collect all valid targets
  const candidates = [
    atrTarget,
    resistanceTarget,
    percentTarget,
    yearHighTarget,
    minTarget,
  ].filter((t) => t !== null && t > currentPrice);

  if (candidates.length === 0) {
    return currentPrice * 1.05; // Default 5% target
  }

  // For bullish setups, be more aggressive with targets
  if (entryScore <= 2) {
    // Use the highest reasonable target (but cap at 20% gain)
    const maxReasonable = Math.min(Math.max(...candidates), currentPrice * 1.2);
    return Math.max(maxReasonable, minTarget);
  } else if (entryScore <= 4) {
    // Use average of targets for neutral setups
    const avgTarget = candidates.reduce((a, b) => a + b) / candidates.length;
    return Math.max(avgTarget, minTarget);
  } else {
    // Use conservative target for bearish setups
    return Math.max(Math.min(...candidates), minTarget);
  }
}
  
  
  