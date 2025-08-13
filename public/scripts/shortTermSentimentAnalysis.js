// ================== SHORT TERM SENTIMENT ANALYSIS (Layer 1) ==================
// shortTermSentimentAnalysis.js

/**
 * Analyzes short-term (15-day) price action, patterns, and momentum to determine market sentiment.
 * Refactored to remove the optional 'opts' parameter, using internal defaults.
 *
 * @param {object} stock - The stock object.
 * @param {array} historicalData - The last 15+ days of historical data.
 * @returns {number} A sentiment score from 1 (Strong Bullish) to 7 (Strong Bearish).
 */
export function getShortTermSentimentScore(stock, historicalData) {
  if (!historicalData || historicalData.length < 15) {
    return 7; // Not enough data, return Strong Bearish (keep semantics)
  }

  // Ensure data is sorted chronologically, then take the last 15 days.
  const sorted = [...historicalData].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );
  const recentData = sorted.slice(-15);

  const n = (v) => (Number.isFinite(v) ? v : 0);
  const currentPrice = n(stock.currentPrice);

  const historical = {
    closes: recentData.map((day) => n(day.close)),
    volumes: recentData.map((day) => n(day.volume)),
    highs: recentData.map((day) => n(day.high)),
    lows: recentData.map((day) => n(day.low)),
  };

  // --- Pattern & Momentum Detection ---
  const momentum = calculateShortTermMomentum(historical, recentData);
  const bullishPatterns = detectShortTermBullishPatterns(
    recentData,
    historical,
    stock,
    currentPrice
  );
  const bearishPatterns = detectShortTermBearishPatterns(
    recentData,
    historical
  );
  const exhaustionPatterns = detectShortTermExhaustion(
    recentData,
    historical,
    stock,
    momentum.recent
  );

  // --- Scoring ---
  const weights = getShortTermSentimentWeights();
  let sentimentScore = 0;
  sentimentScore += scoreMomentumForSentiment(momentum, weights);
  sentimentScore += scoreBullishPatternsForSentiment(bullishPatterns, weights);
  sentimentScore += scoreBearishPatternsForSentiment(bearishPatterns, weights);
  sentimentScore += scoreExhaustionForSentiment(
    exhaustionPatterns,
    weights,
    momentum.recent
  );

  // --- Sentiment Tier Mapping ---
  const cutoffs = {
    t1: 2.5,
    t2: 1.5,
    t3: 0.5,
    t4: -0.5,
    t5: -1.5,
    t6: -2.5,
  };

  if (sentimentScore >= cutoffs.t1) return 1; // Strong Bullish
  if (sentimentScore >= cutoffs.t2) return 2; // Bullish
  if (sentimentScore >= cutoffs.t3) return 3; // Weak Bullish
  if (sentimentScore >= cutoffs.t4) return 4; // Neutral
  if (sentimentScore >= cutoffs.t5) return 5; // Weak Bearish
  if (sentimentScore >= cutoffs.t6) return 6; // Bearish
  return 7; // Strong Bearish
}

/**
 * -----------------------------------------------------------------
 * HELPER FUNCTIONS FOR SHORT-TERM SENTIMENT ANALYSIS
 * -----------------------------------------------------------------
 */

function calculateShortTermMomentum(historical, recentData) {
  let recentMomentum = 0;
  let volumeTrend = 0;

  if (recentData.length >= 15) {
    const last5 = historical.closes.slice(-5);
    const prev10 = historical.closes.slice(-15, -5);
    const last5Avg = last5.length
      ? last5.reduce((s, p) => s + p, 0) / last5.length
      : 0;
    const prev10Avg = prev10.length
      ? prev10.reduce((s, p) => s + p, 0) / prev10.length
      : 0;
    recentMomentum = prev10Avg ? ((last5Avg - prev10Avg) / prev10Avg) * 100 : 0;
  }

  if (recentData.length >= 10) {
    const last5v = historical.volumes.slice(-5);
    const prev5v = historical.volumes.slice(-10, -5);
    const last5VolAvg = last5v.length
      ? last5v.reduce((s, v) => s + v, 0) / last5v.length
      : 0;
    const prev5VolAvg = prev5v.length
      ? prev5v.reduce((s, v) => s + v, 0) / prev5v.length
      : 0;
    volumeTrend = prev5VolAvg
      ? ((last5VolAvg - prev5VolAvg) / prev5VolAvg) * 100
      : 0;
  }

  return { recent: recentMomentum, volume: volumeTrend };
}

function detectShortTermBullishPatterns(
  recentData,
  historical,
  stock,
  currentPrice
) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const patterns = {};

  // Higher lows pattern (≥5 of last 6 pairs are higher)
  if (recentData.length >= 7) {
    const last7Lows = recentData.slice(-7).map((d) => n(d.low));
    const higherLowsCount = last7Lows
      .slice(1)
      .reduce((count, low, i) => (low > last7Lows[i] ? count + 1 : count), 0);
    patterns.higherLows = higherLowsCount >= 5;
  }

  // Price compression (last 3 average range < 70% of last 7 average)
  if (recentData.length >= 7) {
    const ranges = recentData
      .slice(-7)
      .map((d) => Math.max(0, n(d.high) - n(d.low)));
    const rangeAvg = ranges.length
      ? ranges.reduce((s, r) => s + r, 0) / ranges.length
      : 0;
    const last3RangeAvg =
      ranges.slice(-3).reduce((s, r) => s + r, 0) /
      Math.max(1, Math.min(3, ranges.length));
    patterns.priceCompression =
      last3RangeAvg > 0 && last3RangeAvg < rangeAvg * 0.7;
  }

  // Bullish engulfing (allow equality)
  if (recentData.length >= 2) {
    const y = recentData[recentData.length - 2];
    const t = recentData[recentData.length - 1];
    patterns.bullishEngulfing =
      n(y.close) <= n(y.open) &&
      n(t.close) >= n(t.open) &&
      n(t.open) <= n(y.close) &&
      n(t.close) >= n(y.open) &&
      n(t.close) > n(t.open);
  }

  // Support test (touch lowest of last 10 + rebound)
  if (recentData.length >= 10) {
    const window10 = recentData.slice(-10);
    const lowestDay = window10.reduce((lowest, d) =>
      n(d.low) < n(lowest.low) ? d : lowest
    );
    const today = recentData[recentData.length - 1];
    patterns.supportTest =
      n(today.low) <= n(lowestDay.low) * 1.01 &&
      n(today.close) > n(today.open) &&
      n(today.close) > n(lowestDay.low) * 1.02;
  }

  // MA pullback (to 20d or 50d then back above)
  const ma20 = n(stock.movingAverage20d);
  const ma50 = n(stock.movingAverage50d);
  if (ma20 > 0 || ma50 > 0) {
    const recentLows = recentData.slice(-3).map((d) => n(d.low));
    const low = Math.min(...recentLows);
    patterns.pullbackToMA =
      (ma20 > 0 && low <= ma20 * 1.01 && currentPrice > ma20) ||
      (ma50 > 0 && low <= ma50 * 1.01 && currentPrice > ma50) ||
      false;
  } else {
    patterns.pullbackToMA = false;
  }

  // Breakout from consolidation
  patterns.breakoutFromConsolidation = detectBreakoutFromConsolidation(
    recentData,
    patterns.priceCompression
  );

  // Cup and handle
  patterns.cupAndHandle = detectCupAndHandlePattern(recentData);

  return patterns;
}

function detectShortTermBearishPatterns(recentData, historical) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const patterns = {};

  // Lower highs pattern (≥5 of last 6 pairs are lower)
  if (recentData.length >= 7) {
    const last7Highs = recentData.slice(-7).map((d) => n(d.high));
    const lowerHighsCount = last7Highs
      .slice(1)
      .reduce(
        (count, high, i) => (high < last7Highs[i] ? count + 1 : count),
        0
      );
    patterns.lowerHighs = lowerHighsCount >= 5;
  }

  // Bearish engulfing (allow equality)
  if (recentData.length >= 2) {
    const y = recentData[recentData.length - 2];
    const t = recentData[recentData.length - 1];
    patterns.bearishEngulfing =
      n(y.close) >= n(y.open) &&
      n(t.close) <= n(t.open) &&
      n(t.open) >= n(y.close) &&
      n(t.close) <= n(y.open) &&
      n(t.close) < n(t.open);
  }

  // Doji after trend
  if (recentData.length >= 5) {
    const lastDay = recentData[recentData.length - 1];
    const dojiRange =
      Math.abs(n(lastDay.close) - n(lastDay.open)) <
      Math.max(0.000001, (n(lastDay.high) - n(lastDay.low)) * 0.1);
    const last4Closes = recentData.slice(-5, -1).map((d) => n(d.close));
    const hadTrend =
      (last4Closes[3] > last4Closes[0] && last4Closes[3] > last4Closes[1]) ||
      (last4Closes[3] < last4Closes[0] && last4Closes[3] < last4Closes[1]);
    patterns.dojiAfterTrend = dojiRange && hadTrend;
  }

  return patterns;
}

function detectShortTermExhaustion(
  recentData,
  historical,
  stock,
  recentMomentum
) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const patterns = {};
  const currentPrice = n(stock?.currentPrice);

  // Trend maturity: count up days in the last 14 comparisons
  if (recentData.length >= 15) {
    const window = recentData.slice(-15);
    let upDaysCount = 0;
    for (let i = 1; i < window.length; i++) {
      if (n(window[i].close) > n(window[i - 1].close)) upDaysCount++;
    }
    patterns.trendTooMature = upDaysCount >= 10;
  } else {
    patterns.trendTooMature = false;
  }

  // Climax pattern (high volume, small real body, close near high)
  if (recentData.length >= 10) {
    const prev5VolAvg =
      historical.volumes.slice(-10, -5).reduce((s, v) => s + v, 0) / 5 || 0;
    patterns.climaxPattern = recentData.slice(-5).some((d) => {
      const highVolume = n(d.volume) > prev5VolAvg * 1.8;
      const range = Math.max(0, n(d.high) - n(d.low));
      const realBody = Math.abs(n(d.close) - n(d.open));
      const smallGain = n(d.close) > n(d.open) && realBody < range * 0.3;
      const nearHigh = n(d.close) > n(d.high) - range * 0.2;
      return highVolume && smallGain && nearHigh;
    });
  } else {
    patterns.climaxPattern = false;
  }

  // Bearish divergence (price higher high, RSI not confirming + weak momentum)
  const currentRSI = n(stock.rsi14);
  if (currentRSI && recentData.length >= 10) {
    const recentHigh = Math.max(...recentData.slice(-5).map((d) => n(d.high)));
    const priorHigh = Math.max(
      ...recentData.slice(-10, -5).map((d) => n(d.high))
    );
    patterns.bearishDivergence =
      recentHigh > priorHigh && currentRSI < 65 && recentMomentum < 3;
  } else {
    patterns.bearishDivergence = false;
  }

  // Exhaustion gap (gap up then close weak)
  patterns.exhaustionGap = recentData.slice(-3).some((d, i, arr) => {
    if (i === 0) return false;
    const prev = arr[i - 1];
    const gapUp = n(d.open) > n(prev.close) * 1.02;
    const weakness = n(d.close) < n(d.open);
    return gapUp && weakness;
  });

  // Volume climax (3-day avg >> 15-day avg)
  if (recentData.length >= 15) {
    const avgVolume =
      historical.volumes.reduce((s, v) => s + v, 0) /
        historical.volumes.length || 0;
    const last3Volume =
      historical.volumes.slice(-3).reduce((s, v) => s + v, 0) / 3 || 0;
    patterns.volumeClimax = avgVolume > 0 && last3Volume > avgVolume * 2.2;
  } else {
    patterns.volumeClimax = false;
  }

  // Overbought momentum divergence
  patterns.overboughtMomentumDiv = currentRSI > 70 && recentMomentum < 2.5;

  // At resistance (near 52W high)
  const fiftyTwoWeekHigh = n(stock.fiftyTwoWeekHigh);
  if (
    Number.isFinite(fiftyTwoWeekHigh) &&
    fiftyTwoWeekHigh > 0 &&
    Number.isFinite(currentPrice)
  ) {
    patterns.atResistance = currentPrice >= fiftyTwoWeekHigh * 0.98;
  } else {
    patterns.atResistance = false;
  }

  return patterns;
}

function detectBreakoutFromConsolidation(recentData, priceCompression) {
  if (recentData.length < 15) return false;

  // Use the 10 trading days prior to today for ATR-like range
  const prev10 = recentData.slice(-11, -1); // exclude latest day
  if (prev10.length < 10) return false;

  const last10Ranges = prev10.map((day, i) => {
    if (i === 0) {
      return Math.max(0, day.high - day.low);
    }
    const prevClose = prev10[i - 1].close;
    return Math.max(
      0,
      day.high - day.low,
      Math.abs(day.high - prevClose),
      Math.abs(day.low - prevClose)
    );
  });

  const atrLast10 =
    last10Ranges.reduce((s, r) => s + r, 0) / last10Ranges.length;

  const latestDay = recentData[recentData.length - 1];
  const dayRange = Math.max(0, latestDay.high - latestDay.low);
  const realBody = Math.abs(latestDay.close - latestDay.open);

  const rangeExpansion = dayRange > atrLast10 * 1.5;
  const directionalStrength = realBody > dayRange * 0.6;

  return Boolean(priceCompression) && rangeExpansion && directionalStrength;
}

function detectCupAndHandlePattern(recentData) {
  if (recentData.length < 15) return false;

  const cupLeft = recentData.slice(0, 5);
  const cupBottom = recentData.slice(5, 10);
  const cupRight = recentData.slice(10);

  const maxLeftHigh = Math.max(...cupLeft.map((d) => d.high));
  const minBottomLow = Math.min(...cupBottom.map((d) => d.low));
  const maxRightHigh = Math.max(...cupRight.map((d) => d.high));

  const similarHighs =
    Math.abs(maxLeftHigh - maxRightHigh) < maxLeftHigh * 0.03;
  const properBottom =
    minBottomLow < Math.min(maxLeftHigh, maxRightHigh) * 0.95;

  if (cupRight.length < 5) return false; // Ensure enough days for a handle

  const recentPullback =
    cupRight[cupRight.length - 2].close < cupRight[cupRight.length - 3].close &&
    cupRight[cupRight.length - 1].close > cupRight[cupRight.length - 2].close;

  return similarHighs && properBottom && recentPullback;
}

// Static weights for sentiment scoring
function getShortTermSentimentWeights() {
  return {
    momentum: 1.5,
    volume: 1.0,
    higherLows: 1.2,
    lowerHighs: 1.2,
    compression: 0.8,
    engulfing: 1.5,
    doji: 0.7,
    support: 1.3,
    pullbackMA: 1.4,
    breakout: 1.6,
    cupHandle: 1.7,
    trendMaturity: 1.5,
    climax: 1.8,
    bearishDiv: 1.4,
    exhaustionGap: 1.2,
    volumeClimax: 1.0,
    overboughtDiv: 1.3,
    resistance: 0.8,
  };
}

function scoreMomentumForSentiment(momentum, weights) {
  let score = 0;
  if (momentum.recent > 3) score += weights.momentum;
  else if (momentum.recent > 1) score += 0.5 * weights.momentum;
  else if (momentum.recent < -3) score -= weights.momentum;
  else if (momentum.recent < -1) score -= 0.5 * weights.momentum;

  if (momentum.volume > 20 && momentum.recent > 0)
    score += 0.8 * weights.volume;
  else if (momentum.volume > 20 && momentum.recent < 0)
    score -= 0.5 * weights.volume;

  return score;
}

function scoreBullishPatternsForSentiment(patterns, weights) {
  let score = 0;
  if (patterns.higherLows) score += weights.higherLows;

  // Compression: award only if present
  if (patterns.priceCompression) score += 0.6 * weights.compression;

  if (patterns.bullishEngulfing) score += weights.engulfing;
  if (patterns.supportTest) score += weights.support;
  if (patterns.pullbackToMA) score += weights.pullbackMA;
  if (patterns.breakoutFromConsolidation) score += weights.breakout;
  if (patterns.cupAndHandle) score += weights.cupHandle;
  return score;
}

function scoreBearishPatternsForSentiment(patterns, weights) {
  let score = 0;
  if (patterns.lowerHighs) score -= weights.lowerHighs;
  if (patterns.bearishEngulfing) score -= weights.engulfing;
  if (patterns.dojiAfterTrend) score -= 0.4 * weights.doji;
  return score;
}

function scoreExhaustionForSentiment(patterns, weights, recentMomentum) {
  let score = 0;
  if (patterns.trendTooMature) score -= weights.trendMaturity;
  if (patterns.climaxPattern) score -= 1.2 * weights.climax;
  if (patterns.bearishDivergence) score -= weights.bearishDiv;
  if (patterns.exhaustionGap) score -= 0.8 * weights.exhaustionGap;
  if (patterns.volumeClimax && recentMomentum > 0)
    score -= 0.7 * weights.volumeClimax;
  if (patterns.overboughtMomentumDiv) score -= weights.overboughtDiv;
  if (patterns.atResistance) score -= 0.5 * weights.resistance;

  // Multiple exhaustion signals penalty
  const exhaustionCount = Object.values(patterns).filter(Boolean).length;
  if (exhaustionCount >= 3) score -= 1.5;

  return score;
}
