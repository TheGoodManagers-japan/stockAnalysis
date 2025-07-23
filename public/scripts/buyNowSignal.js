/**
 * @file This script provides a comprehensive stock analysis engine to generate buy signals.
 * It combines multiple technical analysis techniques, including pattern recognition,
 * trend analysis, and a detailed scoring model, into a single, unified function.
 *
 * Key Features:
 * - Score-based system: Aggregates scores from various detected bullish signals.
 * - Veto system: Allows specific bearish conditions to override buy signals.
 * - Modular Checkers: Easy to add, remove, or modify individual signal and veto checks.
 * - Configurable: All scoring weights and thresholds are managed in a central config object.
 * - Comprehensive Analysis: Integrates trend reversals, breakouts, candlestick patterns,
 * and a detailed entry timing score.
 */

// --- CONFIGURATION ---
// Central configuration for all thresholds, scores, and weights.
const defaultConfig = {
  buyThreshold: 5, // Minimum total score to trigger a "buy" signal.
  scores: {
    trendReversal: 5,
    resistanceBreak: 4,
    volatilitySqueeze: 4,
    pullbackEntry: 3,
    bullishEngulfing: 3,
    hammerCandle: 3,
    consolidationBreakout: 4, // New signal from checkForBuyNowSignal
    entryTimingScore: 6, // High score for a positive timing model result.
  },
  volume: {
    confirmationMultiplier: 1.5, // e.g., volume must be 1.5x the average.
  },
  rsi: {
    overbought: 70,
  },
  squeeze: {
    bandWidthThreshold: 0.05, // Example: Bollinger Bandwidth percent
  },
  pullback: {
    proximityPercent: 0.02, // e.g., within 2% of the moving average.
  },
  hammer: {
    bodyToRangeRatio: 0.1, // Ensures body is not insignificantly small (prevents Dojis).
    wickToBodyRatio: 2, // Lower wick must be at least 2x the body.
  },
  consolidation: {
    period: 5, // Days to look back for consolidation.
    volumeMultiplier: 1.5,
  },
  veto: {
    catastrophicDropPercent: -8.0, // A drop of 8% or more is a veto.
    resistanceZoneBuffer: 0.03, // 3% buffer below a major resistance high.
    resistanceBypassVolumeMultiplier: 3.0, // Bypass veto with 3x volume.
    resistanceBypassRsi: 75, // Bypass veto with RSI > 75.
  },
};

/**
 * Analyzes the stock to generate a buy signal.
 * This is the single entry point for the entire trigger analysis.
 *
 * @param {object} stock - The stock object with current data (e.g., MAs, RSI).
 * @param {array} historicalData - The array of historical daily data for the stock.
 * @returns {{isBuyNow: boolean, reason: string}} An object with the buy decision and a descriptive reason.
 */
export function getBuyTrigger(stock, historicalData) {
  const config = defaultConfig;

  if (!historicalData || historicalData.length < 50) {
    return {
      isBuyNow: false,
      reason: "Insufficient historical data for a reliable analysis.",
    };
  }

  const today = historicalData[historicalData.length - 1];
  const yesterday = historicalData[historicalData.length - 2];

  // Create a shared context to avoid recalculating data across checks.
  // This is the single source of truth for daily data.
  const context = {
    today: today,
    yesterday: yesterday,
    avgVolume10:
      historicalData.slice(-11, -1).reduce((sum, day) => sum + day.volume, 0) /
      10,
    avgVolume20:
      historicalData.slice(-21, -1).reduce((sum, day) => sum + day.volume, 0) /
      20,
    // The enriched stock object is now part of the context for helpers that need it.
    enrichedStock: {
      ...stock,
      currentPrice: today.close,
      historicalData: historicalData,
    },
  };
  context.keyLevels = calculateKeyLevels(context.enrichedStock);

  // --- Run all signal checks ---
  const signalChecks = [
    checkTrendReversal,
    checkResistanceBreak,
    checkVolatilitySqueeze,
    checkPullbackEntry,
    checkBullishEngulfing,
    checkHammerCandle,
    checkConsolidationBreakout,
    checkEntryTimingScore, // Now properly uses context
  ];
  const detectedSignals = signalChecks
    .map((checkFn) => checkFn(stock, context, config))
    .filter((signal) => signal.detected);

  const totalScore = detectedSignals.reduce(
    (sum, signal) => sum + signal.score,
    0
  );

  // --- Run all veto checks ---
  const vetoChecks = [
    checkRsiOverbought,
    checkCatastrophicDrop,
    checkSupportBreak,
    checkMajorResistance,
  ];
  const vetoResults = vetoChecks
    .map((vetoFn) => vetoFn(stock, context, config))
    .filter((veto) => veto.isVetoed);

  // --- Format the final decision ---
  if (vetoResults.length > 0) {
    const signalText =
      detectedSignals.length > 0
        ? `Patterns found (${detectedSignals
            .map((s) => s.name)
            .join(" | ")}), but signal`
        : "Signal";
    return {
      isBuyNow: false,
      reason: `${signalText} vetoed: ${vetoResults
        .map((v) => v.reason)
        .join(" & ")}`,
    };
  }

  if (totalScore >= config.buyThreshold) {
    return {
      isBuyNow: true,
      reason: `Buy Trigger (${totalScore} pts): ${detectedSignals
        .map((s) => s.name)
        .join(" | ")}`,
    };
  }

  return {
    isBuyNow: false,
    reason: `No trigger: Score of ${totalScore} did not meet threshold of ${config.buyThreshold}.`,
  };
}

/**
 * -----------------------------------------------------------------
 * SIGNAL CHECKER FUNCTIONS
 * -----------------------------------------------------------------
 */

function checkTrendReversal(stock, context, config) {
  const { today, yesterday, avgVolume20 } = context;
  const { macd, macdSignal, movingAverage25d, movingAverage75d } = stock;
  const { historicalData } = context.enrichedStock;
  const hasData =
    movingAverage75d && movingAverage25d && macd && macdSignal !== undefined;
  if (!hasData || historicalData.length < 80) return { detected: false };

  const priceTrigger =
    today.close > movingAverage75d && yesterday.close <= movingAverage75d;
  if (!priceTrigger) return { detected: false };

  const ma25History =
    historicalData.slice(-30, -5).reduce((sum, day) => sum + day.close, 0) / 25;
  const trendTrigger = movingAverage25d > ma25History;
  const momentumTrigger = macd > macdSignal;
  const volumeTrigger =
    today.volume > avgVolume20 * config.volume.confirmationMultiplier;
  const confirmations = [trendTrigger, momentumTrigger, volumeTrigger].filter(
    Boolean
  ).length;

  if (confirmations >= 2) {
    return {
      detected: true,
      name: "Trend Reversal",
      score: config.scores.trendReversal,
    };
  }
  return { detected: false };
}

function checkResistanceBreak(stock, context, config) {
  const { today, yesterday, keyLevels, avgVolume20 } = context;
  const immediateResistance = keyLevels.resistances.find(
    (r) => r > yesterday.close
  );
  if (!immediateResistance) return { detected: false };

  const priceBroke =
    yesterday.close < immediateResistance && today.close > immediateResistance;
  if (!priceBroke) return { detected: false };

  const volumeConfirms =
    today.volume > avgVolume20 * config.volume.confirmationMultiplier;
  const name = `Broke Resistance${volumeConfirms ? " on high volume" : ""}`;
  return { detected: true, name: name, score: config.scores.resistanceBreak };
}

function checkVolatilitySqueeze(stock, context, config) {
  const { bollingerUpper, bollingerLower, bollingerMid } = stock;
  const { currentPrice } = context.enrichedStock;
  if (!bollingerUpper || !bollingerLower || !bollingerMid)
    return { detected: false };

  const bandWidth = (bollingerUpper - bollingerLower) / bollingerMid;
  const isSqueezed = bandWidth < config.squeeze.bandWidthThreshold;
  const isBreakingOut = currentPrice > bollingerUpper;

  if (isSqueezed && isBreakingOut) {
    return {
      detected: true,
      name: "Volatility Squeeze Breakout",
      score: config.scores.volatilitySqueeze,
    };
  }
  return { detected: false };
}

function checkPullbackEntry(stock, context, config) {
  const { movingAverage25d, movingAverage75d } = stock;
  const { currentPrice } = context.enrichedStock;
  if (!movingAverage25d || !movingAverage75d) return { detected: false };

  const isInUptrend =
    currentPrice > movingAverage75d && movingAverage25d > movingAverage75d;
  if (!isInUptrend) return { detected: false };

  const priceNearMA25 =
    Math.abs(currentPrice - movingAverage25d) / movingAverage25d <
    config.pullback.proximityPercent;
  if (priceNearMA25) {
    return {
      detected: true,
      name: "Pullback to 25-day MA",
      score: config.scores.pullbackEntry,
    };
  }
  return { detected: false };
}

function checkBullishEngulfing(stock, context, config) {
  const { today, yesterday } = context;
  const isEngulfing =
    today.close > today.open &&
    yesterday.close < yesterday.open &&
    today.close > yesterday.open &&
    today.open < yesterday.close;

  if (isEngulfing) {
    return {
      detected: true,
      name: "Bullish Engulfing",
      score: config.scores.bullishEngulfing,
    };
  }
  return { detected: false };
}

function checkHammerCandle(stock, context, config) {
  const { today } = context;
  const dailyRange = today.high - today.low;
  if (dailyRange === 0) return { detected: false };

  const body = Math.abs(today.close - today.open);
  const lowerWick = Math.min(today.open, today.close) - today.low;
  const upperWick = today.high - Math.max(today.open, today.close);

  const isNotDoji = body > dailyRange * config.hammer.bodyToRangeRatio;
  const isHammerShape =
    lowerWick > body * config.hammer.wickToBodyRatio && upperWick < body;

  if (isNotDoji && isHammerShape) {
    return {
      detected: true,
      name: "Hammer Candle",
      score: config.scores.hammerCandle,
    };
  }
  return { detected: false };
}

function checkConsolidationBreakout(stock, context, config) {
  const { today, avgVolume10 } = context;
  const { historicalData } = context.enrichedStock;
  const period = config.consolidation.period;

  if (historicalData.length < period + 1) return { detected: false };

  const consolidationPeriod = historicalData.slice(-(period + 1), -1);
  const consolidationHigh = Math.max(...consolidationPeriod.map((d) => d.high));
  const isBreakout = today.close > consolidationHigh;
  const isVolumeConfirmed =
    today.volume > avgVolume10 * config.consolidation.volumeMultiplier;

  if (isBreakout && isVolumeConfirmed) {
    return {
      detected: true,
      name: `Consolidation Breakout`,
      score: config.scores.consolidationBreakout,
    };
  }
  return { detected: false };
}

function checkEntryTimingScore(stock, context, config) {
  const scoreTier = getEntryTimingScore_Helper(stock, context);

  if (scoreTier <= 2) {
    // Tier 1 is "Strong Buy", Tier 2 is "Buy"
    const name = scoreTier === 1 ? "Strong Entry Score" : "Good Entry Score";
    return {
      detected: true,
      name: name,
      score: config.scores.entryTimingScore,
    };
  }
  return { detected: false };
}

/**
 * -----------------------------------------------------------------
 * VETO CHECKER FUNCTIONS
 * -----------------------------------------------------------------
 */

function checkRsiOverbought(stock, context, config) {
  if (stock.rsi14 && stock.rsi14 > config.rsi.overbought) {
    return {
      isVetoed: true,
      reason: `RSI is overbought (${stock.rsi14.toFixed(0)})`,
    };
  }
  return { isVetoed: false };
}

function checkCatastrophicDrop(stock, context, config) {
  const { today, yesterday, avgVolume20 } = context;
  const percentChange =
    ((today.close - yesterday.close) / yesterday.close) * 100;

  if (
    percentChange < config.veto.catastrophicDropPercent &&
    today.volume > avgVolume20 * config.volume.confirmationMultiplier
  ) {
    return { isVetoed: true, reason: "Severe price drop on high volume" };
  }
  return { isVetoed: false };
}

function checkSupportBreak(stock, context, config) {
  const { today, yesterday } = context;
  const ma50 = stock.movingAverage50d;
  if (ma50 && today.close < ma50 && yesterday.close > ma50) {
    return { isVetoed: true, reason: "Broke below 50-day MA support" };
  }
  return { isVetoed: false };
}

function checkMajorResistance(stock, context, config) {
  if (isNearMajorResistance_Helper(stock, context, config)) {
    return { isVetoed: true, reason: "Approaching major resistance zone" };
  }
  return { isVetoed: false };
}

/**
 * -----------------------------------------------------------------
 * UTILITY & HELPER FUNCTIONS
 * -----------------------------------------------------------------
 */

function isNearMajorResistance_Helper(stock, context, config) {
  const { rsi14 } = stock;
  const { historicalData, currentPrice } = context.enrichedStock;
  if (!historicalData || historicalData.length < 100) return false;

  const lookbackData = historicalData.slice(0, -22);
  if (lookbackData.length === 0) return false;

  const highestHighInPast = Math.max(...lookbackData.map((d) => d.high));
  const resistanceZoneStart =
    highestHighInPast * (1 - config.veto.resistanceZoneBuffer);

  if (currentPrice < resistanceZoneStart) return false;

  const avgVolume50 =
    historicalData.slice(-72, -22).reduce((sum, day) => sum + day.volume, 0) /
    50;
  const lastDayVolume = historicalData[historicalData.length - 1].volume;
  const hasExceptionalVolume =
    lastDayVolume > avgVolume50 * config.veto.resistanceBypassVolumeMultiplier;
  const hasVeryStrongRSI = rsi14 > config.veto.resistanceBypassRsi;

  if (hasExceptionalVolume && hasVeryStrongRSI) return false;
  return true;
}

function calculateKeyLevels(enrichedStock) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const { historicalData } = enrichedStock;
  const levels = { supports: [], resistances: [] };

  if (historicalData.length >= 20) {
    const recentData = historicalData.slice(-20);
    for (let i = 2; i < recentData.length - 2; i++) {
      const current = recentData[i];
      const isSwingHigh =
        current.high > recentData[i - 1].high &&
        current.high > recentData[i - 2].high &&
        current.high > recentData[i + 1].high &&
        current.high > recentData[i + 2].high;
      if (isSwingHigh) levels.resistances.push(current.high);
      const isSwingLow =
        current.low < recentData[i - 1].low &&
        current.low < recentData[i - 2].low &&
        current.low < recentData[i + 1].low &&
        current.low < recentData[i + 2].low;
      if (isSwingLow) levels.supports.push(current.low);
    }
  }
  if (enrichedStock.movingAverage50d)
    levels.supports.push(n(enrichedStock.movingAverage50d));
  if (enrichedStock.movingAverage200d)
    levels.supports.push(n(enrichedStock.movingAverage200d));
  if (enrichedStock.fiftyTwoWeekHigh)
    levels.resistances.push(n(enrichedStock.fiftyTwoWeekHigh));
  levels.supports = [...new Set(levels.supports)].sort((a, b) => b - a);
  levels.resistances = [...new Set(levels.resistances)].sort((a, b) => a - b);
  return levels;
}

// FIXED: This helper has been refactored to remove the 'opts' parameter.
function getEntryTimingScore_Helper(stock, context) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const { today, yesterday } = context;

  // Data is now sourced from context (primary) and the original stock object (secondary).
  const prices = {
    current: n(today.close),
    open: n(today.open),
    high: n(today.high),
    low: n(today.low),
    prev: n(yesterday.close),
    hi52: n(stock.fiftyTwoWeekHigh),
    lo52: n(stock.fiftyTwoWeekLow),
    ma50: n(stock.movingAverage50d),
    ma200: n(stock.movingAverage200d),
    atr: n(stock.atr14),
  };

  const metrics = {
    pctFromHi52: prices.hi52
      ? ((prices.hi52 - prices.current) / prices.hi52) * 100
      : 0,
    pctFromLo52: prices.lo52
      ? ((prices.current - prices.lo52) / prices.lo52) * 100
      : 0,
    pctFromMA50: prices.ma50
      ? ((prices.current - prices.ma50) / prices.ma50) * 100
      : 0,
    gapPct: prices.prev ? ((prices.open - prices.prev) / prices.prev) * 100 : 0,
  };

  const patterns = {
    strongClose:
      prices.current > prices.open &&
      prices.current > prices.prev &&
      prices.current - Math.min(prices.open, prices.prev) >
        (prices.high - prices.current) * 2,
    weakClose:
      prices.current < prices.open &&
      prices.current < prices.prev &&
      Math.max(prices.open, prices.prev) - prices.current >
        (prices.current - prices.low) * 2,
    bullishRev:
      prices.current > prices.open &&
      prices.open < prices.prev &&
      prices.current > prices.prev,
    bearishRev:
      prices.current < prices.open &&
      prices.open > prices.prev &&
      prices.current < prices.prev,
    doji:
      Math.abs(prices.current - prices.open) < (prices.high - prices.low) * 0.1,
    gapUp: metrics.gapPct >= 2,
    gapDown: metrics.gapPct <= -2,
    insideDay: prices.high <= prices.prev && prices.low >= prices.prev,
    bullTrap:
      prices.current <= prices.open &&
      prices.high - prices.open >= Math.abs(prices.open * 0.01) &&
      (prices.high - prices.current) / (prices.high - prices.low || 1e-6) >=
        0.7,
  };

  const weights = {
    close: 2.0,
    hiLo: 1.2,
    ma: 1.0,
    gap: 1.0,
    pattern: 1.0,
    vol: 0.7,
    penalty: 2.0,
  };
  let score = 0;

  if (patterns.strongClose) score += weights.close;
  else if (patterns.weakClose) score -= weights.close;
  if (patterns.bullishRev) score += 0.7 * weights.pattern;
  if (patterns.bearishRev) score -= 0.7 * weights.pattern;
  if (prices.current >= prices.hi52) score += weights.hiLo;
  else if (metrics.pctFromHi52 <= 1) score += 0.8 * weights.hiLo;
  else if (prices.current <= prices.lo52) score -= weights.hiLo;
  else if (metrics.pctFromLo52 <= 1) score -= 0.8 * weights.hiLo;
  if (prices.ma50 && prices.ma200) {
    const above50 = prices.current > prices.ma50;
    const above200 = prices.current > prices.ma200;
    if (above50 && above200) score += weights.ma;
    else if (!above50 && !above200) score -= weights.ma;
    else if (Math.abs(metrics.pctFromMA50) <= 1) score += 0.3 * weights.ma;
  }
  if (patterns.gapUp && prices.current > prices.open)
    score += 0.7 * weights.gap;
  if (patterns.gapDown && prices.current < prices.open)
    score -= 0.7 * weights.gap;
  if (patterns.insideDay && prices.current > prices.prev)
    score += 0.5 * weights.pattern;
  if (patterns.insideDay && prices.current < prices.prev)
    score -= 0.5 * weights.pattern;
  if (patterns.doji) {
    if (prices.current > prices.ma50 && prices.current > prices.ma200)
      score += 0.3 * weights.pattern;
    else if (prices.current < prices.ma50 && prices.current < prices.ma200)
      score -= 0.3 * weights.pattern;
  }
  const hiVol = prices.atr > 0 && prices.atr > prices.current * 0.04;
  const loVol = prices.atr > 0 && prices.atr < prices.current * 0.015;
  if (hiVol && patterns.strongClose) score += 0.3 * weights.vol;
  if (hiVol && patterns.weakClose) score -= 0.3 * weights.vol;
  if (loVol && patterns.insideDay) score += 0.3 * weights.vol;
  if (patterns.bullTrap) score -= weights.penalty;
  if (patterns.weakClose && patterns.gapUp) score -= 0.7 * weights.penalty;

  const cutoffs = {
    t1: 4,
    t2: 2,
    t3: 0.5,
    t4: -0.5,
    t5: -2,
    t6: -4,
  };

  if (score >= cutoffs.t1) return 1; // Strong Buy
  if (score >= cutoffs.t2) return 2; // Buy
  if (score >= cutoffs.t3) return 3; // Watch
  if (score >= cutoffs.t4) return 4; // Neutral
  if (score >= cutoffs.t5) return 5; // Caution
  if (score >= cutoffs.t6) return 6; // Avoid
  return 7; // Strong Avoid
}
