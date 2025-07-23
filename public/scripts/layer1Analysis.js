/**
 * Analyzes short-term (15-day) price action, patterns, and momentum.
 *
 * @param {object} stock - The stock object.
 * @param {object} [opts={}] - Optional configuration.
 * @returns {number} A score from 1 (Strong Buy) to 7 (Strong Avoid).
 */
export function getLayer1PatternScore(stock, historicalData, opts) {
  if (historicalData.length < 15) return 7; // Not enough data, return Strong Avoid

  const recentData = historicalData
    .slice(-15)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const n = (v) => (Number.isFinite(v) ? v : 0);
  const currentPrice = n(stock.currentPrice);

  const historical = {
    closes: recentData.map((day) => day.close),
    volumes: recentData.map((day) => day.volume),
    highs: recentData.map((day) => day.high),
    lows: recentData.map((day) => day.low),
  };

  const momentum = calculateMomentumMetrics(historical, recentData);
  const bullishPatterns = detectBullishPatterns(
    recentData,
    historical,
    stock,
    currentPrice
  );
  const bearishPatterns = detectBearishPatterns(recentData, historical);
  const exhaustionPatterns = detectExhaustionPatterns(
    recentData,
    historical,
    stock,
    momentum.recent
  );

  const weights = getPatternWeights(opts);
  let histScore = 0;
  histScore += scoreMomentum(momentum, weights);
  histScore += scoreBullishPatterns(bullishPatterns, weights);
  histScore += scoreBearishPatterns(bearishPatterns, weights);
  histScore += scoreExhaustionPatterns(
    exhaustionPatterns,
    weights,
    momentum.recent
  );

  const cutoffs = {
    t1: 2.5,
    t2: 1.5,
    t3: 0.5,
    t4: -0.5,
    t5: -1.5,
    t6: -2.5,
    ...opts.combinedCutoffs,
  };

  if (histScore >= cutoffs.t1) return 1; // Strong Buy
  if (histScore >= cutoffs.t2) return 2; // Buy
  if (histScore >= cutoffs.t3) return 3; // Watch
  if (histScore >= cutoffs.t4) return 4; // Neutral
  if (histScore >= cutoffs.t5) return 5; // Caution
  if (histScore >= cutoffs.t6) return 6; // Avoid
  return 7; // Strong Avoid
}




function calculateMomentumMetrics(historical, recentData) {
  let recentMomentum = 0,
    volumeTrend = 0;

  if (recentData.length >= 15) {
    const last5Avg =
      historical.closes.slice(-5).reduce((sum, price) => sum + price, 0) / 5;
    const prev10Avg =
      historical.closes.slice(-15, -5).reduce((sum, price) => sum + price, 0) /
      10;
    recentMomentum = ((last5Avg - prev10Avg) / prev10Avg) * 100;
  }

  if (recentData.length >= 10) {
    const last5VolAvg =
      historical.volumes.slice(-5).reduce((sum, vol) => sum + vol, 0) / 5;
    const prev5VolAvg =
      historical.volumes.slice(-10, -5).reduce((sum, vol) => sum + vol, 0) / 5;
    volumeTrend = ((last5VolAvg - prev5VolAvg) / prev5VolAvg) * 100;
  }

  return { recent: recentMomentum, volume: volumeTrend };
}

function detectBullishPatterns(recentData, historical, stock, currentPrice) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const patterns = {};

  // Higher lows pattern
  if (recentData.length >= 7) {
    const last7Lows = recentData.slice(-7).map((day) => day.low);
    const higherLowsCount = last7Lows
      .slice(1)
      .reduce((count, low, i) => (low > last7Lows[i] ? count + 1 : count), 0);
    patterns.higherLows = higherLowsCount >= 5;
  }

  // Price compression
  if (recentData.length >= 7) {
    const ranges = recentData.slice(-7).map((day) => day.high - day.low);
    const rangeAvg = ranges.reduce((sum, range) => sum + range, 0) / 7;
    const last3RangeAvg =
      ranges.slice(-3).reduce((sum, range) => sum + range, 0) / 3;
    patterns.priceCompression = last3RangeAvg < rangeAvg * 0.7;
  }

  // Engulfing pattern
  if (recentData.length >= 2) {
    const yesterday = recentData[recentData.length - 2];
    const today = recentData[recentData.length - 1];
    patterns.bullishEngulfing =
      yesterday.close < yesterday.open &&
      today.close > today.open &&
      today.open < yesterday.close &&
      today.close > yesterday.open;
  }

  // Support test
  if (recentData.length >= 10) {
    const lowestDay = recentData
      .slice(-10)
      .reduce(
        (lowest, day) => (day.low < lowest.low ? day : lowest),
        recentData[recentData.length - 10]
      );
    const today = recentData[recentData.length - 1];
    patterns.supportTest =
      today.low <= lowestDay.low * 1.01 &&
      today.close > today.open &&
      today.close > lowestDay.low * 1.02;
  }

  // MA pullback
  if (n(stock.movingAverage20d) > 0) {
    const ma20 = n(stock.movingAverage20d);
    const ma50 = n(stock.movingAverage50d);
    const low = Math.min(...recentData.slice(-3).map((day) => day.low));
    patterns.pullbackToMA =
      (low <= ma20 * 1.01 && currentPrice > ma20) ||
      (low <= ma50 * 1.01 && currentPrice > ma50);
  }

  // Breakout from consolidation
  patterns.breakoutFromConsolidation = detectBreakoutPattern(
    recentData,
    patterns.priceCompression
  );

  // Cup and handle
  patterns.cupAndHandle = detectCupAndHandle(recentData);

  return patterns;
}

function detectBearishPatterns(recentData, historical) {
  const patterns = {};

  // Lower highs pattern
  if (recentData.length >= 7) {
    const last7Highs = recentData.slice(-7).map((day) => day.high);
    const lowerHighsCount = last7Highs
      .slice(1)
      .reduce(
        (count, high, i) => (high < last7Highs[i] ? count + 1 : count),
        0
      );
    patterns.lowerHighs = lowerHighsCount >= 5;
  }

  // Bearish engulfing
  if (recentData.length >= 2) {
    const yesterday = recentData[recentData.length - 2];
    const today = recentData[recentData.length - 1];
    patterns.bearishEngulfing =
      yesterday.close > yesterday.open &&
      today.close < today.open &&
      today.open > yesterday.close &&
      today.close < yesterday.open;
  }

  // Doji after trend
  if (recentData.length >= 5) {
    const lastDay = recentData[recentData.length - 1];
    const dojiRange =
      Math.abs(lastDay.close - lastDay.open) <
      (lastDay.high - lastDay.low) * 0.1;
    const last4Closes = historical.closes.slice(-5, -1);
    const hadTrend =
      (last4Closes[3] > last4Closes[0] && last4Closes[3] > last4Closes[1]) ||
      (last4Closes[3] < last4Closes[0] && last4Closes[3] < last4Closes[1]);
    patterns.dojiAfterTrend = dojiRange && hadTrend;
  }

  return patterns;
}

function detectExhaustionPatterns(
  recentData,
  historical,
  stock,
  recentMomentum
) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const patterns = {};

  // Trend maturity
  if (recentData.length >= 15) {
    const upDaysCount = recentData.slice(-14).reduce((count, day, i) => {
      const prevDay =
        i === 0
          ? recentData[recentData.length - 15]
          : recentData[recentData.length - 14 + i - 1];
      return day.close > prevDay.close ? count + 1 : count;
    }, 0);
    patterns.trendTooMature = upDaysCount >= 10;
  }

  // Climax pattern
  if (recentData.length >= 10) {
    const avgVolume =
      historical.volumes.slice(-10, -5).reduce((sum, vol) => sum + vol, 0) / 5;
    patterns.climaxPattern = recentData.slice(-5).some((day) => {
      const highVolume = day.volume > avgVolume * 1.8;
      const smallGain =
        day.close > day.open &&
        day.close - day.open < (day.high - day.low) * 0.3;
      const nearHigh = day.close > day.high - (day.high - day.low) * 0.2;
      return highVolume && smallGain && nearHigh;
    });
  }

  // Bearish divergence
  if (stock.rsi14 && recentData.length >= 10) {
    const currentRSI = n(stock.rsi14);
    const recentHigh = Math.max(...recentData.slice(-5).map((day) => day.high));
    const priorHigh = Math.max(
      ...recentData.slice(-10, -5).map((day) => day.high)
    );
    patterns.bearishDivergence =
      recentHigh > priorHigh && currentRSI < 65 && recentMomentum < 3;
  }

  // Exhaustion gap
  patterns.exhaustionGap = recentData.slice(-3).some((day, i, arr) => {
    if (i === 0) return false;
    const gapUp = day.open > arr[i - 1].close * 1.02;
    const weakness = day.close < day.open;
    return gapUp && weakness;
  });

  // Volume climax
  if (recentData.length >= 15) {
    const avgVolume =
      historical.volumes.reduce((sum, vol) => sum + vol, 0) /
      historical.volumes.length;
    const last3Volume =
      historical.volumes.slice(-3).reduce((sum, vol) => sum + vol, 0) / 3;
    patterns.volumeClimax = last3Volume > avgVolume * 2.2;
  }

  // Overbought momentum divergence
  if (stock.rsi14) {
    const currentRSI = n(stock.rsi14);
    patterns.overboughtMomentumDiv = currentRSI > 70 && recentMomentum < 2.5;
  }

  // At resistance
  if (stock.fiftyTwoWeekHigh && stock.currentPrice) {
    patterns.atResistance =
      n(stock.currentPrice) >= n(stock.fiftyTwoWeekHigh) * 0.98;
  }

  return patterns;
}

function detectBreakoutPattern(recentData, priceCompression) {
  if (recentData.length < 15) return false;

  const last10Ranges = recentData
    .slice(-12, -2)
    .map((day, i, arr) =>
      i === 0
        ? day.high - day.low
        : Math.max(
            day.high - day.low,
            Math.abs(day.high - arr[i - 1].close),
            Math.abs(day.low - arr[i - 1].close)
          )
    );
  const atrLast10 = last10Ranges.reduce((sum, range) => sum + range, 0) / 10;

  const latestDay = recentData[recentData.length - 1];
  const rangeExpansion = latestDay.high - latestDay.low > atrLast10 * 1.5;
  const directionalStrength =
    Math.abs(latestDay.close - latestDay.open) >
    (latestDay.high - latestDay.low) * 0.6;

  return priceCompression && rangeExpansion && directionalStrength;
}

function detectCupAndHandle(recentData) {
  if (recentData.length < 15) return false;

  const cupLeft = recentData.slice(-15, -10);
  const cupBottom = recentData.slice(-10, -5);
  const cupRight = recentData.slice(-5);

  const maxLeftHigh = Math.max(...cupLeft.map((day) => day.high));
  const minBottomLow = Math.min(...cupBottom.map((day) => day.low));
  const maxRightHigh = Math.max(...cupRight.map((day) => day.high));

  const similarHighs =
    Math.abs(maxLeftHigh - maxRightHigh) < maxLeftHigh * 0.03;
  const properBottom =
    minBottomLow < Math.min(maxLeftHigh, maxRightHigh) * 0.95;
  const recentPullback =
    cupRight[3].close < cupRight[2].close &&
    cupRight[4].close > cupRight[3].close;

  return similarHighs && properBottom && recentPullback;
}

function getPatternWeights(opts) {
  return {
    momentum: 1.5,
    volume: 1.0,
    higherLows: 1.2,
    lowerHighs: 1.2,
    compression: 0.8,
    engulfing: 1.5,
    doji: 0.7,
    support: 1.3,
    gapFill: 0.9,
    pullbackMA: 1.4,
    breakout: 1.6,
    cupHandle: 1.7,
    trendMaturity: 1.5,
    climax: 1.8,
    bearishDiv: 1.4,
    exhaustionGap: 1.2,
    volumeClimax: 1.0,
    overboughtDiv: 1.3,
    resistance: 0.8
  };
}

function scoreMomentum(momentum, weights) {
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

function scoreBullishPatterns(patterns, weights) {
  let score = 0;
  if (patterns.higherLows) score += weights.higherLows;
  if (patterns.priceCompression)
    score += (patterns.priceCompression ? 0.6 : 0.2) * weights.compression;
  if (patterns.bullishEngulfing) score += weights.engulfing;
  if (patterns.supportTest) score += weights.support;
  if (patterns.pullbackToMA) score += weights.pullbackMA;
  if (patterns.breakoutFromConsolidation) score += weights.breakout;
  if (patterns.cupAndHandle) score += weights.cupHandle;
  return score;
}

function scoreBearishPatterns(patterns, weights) {
  let score = 0;
  if (patterns.lowerHighs) score -= weights.lowerHighs;
  if (patterns.bearishEngulfing) score -= weights.engulfing;
  if (patterns.dojiAfterTrend) score -= 0.4 * weights.doji;
  return score;
}

function scoreExhaustionPatterns(patterns, weights, recentMomentum) {
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
  