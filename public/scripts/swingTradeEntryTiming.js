// swingTradeEntryTiming.js
// Determines optimal swing trade entry points based on market sentiment and technical conditions

/**
 * Main function to determine if NOW is the time to enter a swing trade
 * @param {object} sentimentResult - Result from getComprehensiveMarketSentiment
 * @param {object} stock - Stock data with current price, indicators, etc.
 * @param {array} historicalData - Historical OHLCV data (90+ days recommended)
 * @returns {object} { buyNow: boolean, reason: string }
 */
export function analyzeSwingTradeEntry(sentimentResult, stock, historicalData) {
  // Validate inputs
  if (!validateInputs(sentimentResult, stock, historicalData)) {
    return {
      buyNow: false,
      reason: "Invalid or insufficient data for analysis",
    };
  }

  // Initialize internal tracking structure
  const analysis = {
    sentimentScore: sentimentResult.score,
    sentimentConfidence: sentimentResult.confidence,
    entryQuality: 0,
    technicalChecks: {},
    stopLoss: sentimentResult.stopLoss,
    priceTarget: sentimentResult.priceTarget,
  };

  // STEP 1: Sentiment Gate - Only proceed if sentiment is favorable
  const sentimentCheck = checkSentimentGate(sentimentResult);
  if (!sentimentCheck.passed) {
    return {
      buyNow: false,
      reason: sentimentCheck.reason,
    };
  }

  // Ensure data is sorted chronologically
  const sortedData = [...historicalData].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );

  // Compute robust, scan-safe price-action flag (works pre-open/after-close)
  const nr = (v) => (Number.isFinite(v) ? v : 0);
  const lastBar = sortedData[sortedData.length - 1] || {};
  const pxNow = nr(stock.currentPrice) || nr(lastBar.close);
  const pxOpen = nr(stock.openPrice) || nr(lastBar.open);
  const prevClose = nr(stock.prevClosePrice) || nr(lastBar.close);
  const priceActionPositive = pxNow > Math.max(pxOpen, prevClose);

  // STEP 2: Market Structure Analysis
  const marketStructure = analyzeMarketStructure(stock, sortedData);
  analysis.technicalChecks.marketStructure = marketStructure;

  // STEP 3: Entry Condition Checks
  const entryConditions = checkEntryConditions(
    stock,
    sortedData,
    sentimentResult
  );
  analysis.technicalChecks.entryConditions = entryConditions;

  // STEP 4: Risk/Reward Analysis (includes fallback if sentiment lacks stop/target)
  const riskReward = analyzeRiskReward(stock, sentimentResult, marketStructure);
  analysis.technicalChecks.riskReward = riskReward;

  // STEP 5: Timing Confirmation
  const timingSignals = confirmEntryTiming(stock, sortedData, marketStructure);
  analysis.technicalChecks.timing = timingSignals;

  // STEP 6: Volume and Momentum Validation
  const volumeMomentum = validateVolumeMomentum(stock, sortedData);
  analysis.technicalChecks.volumeMomentum = volumeMomentum;

  // STEP 6.5: Late-entry / Overextension Veto (hard gate)
  // Pass entryConditions so legit pullback+bounce entries aren’t vetoed as “late”
  const guard = getEntryGuards(
    stock,
    sortedData,
    marketStructure,
    entryConditions
  );
  if (guard.vetoed) {
    return {
      buyNow: false,
      reason: guard.reason,
    };
  }

  // STEP 7: Final Entry Decision
  return makeFinalDecision(
    stock,
    analysis,
    entryConditions,
    timingSignals,
    riskReward,
    marketStructure,
    volumeMomentum,
    priceActionPositive // robust flag
  );
}

/* ───────────────── Input Validation ───────────────── */

function validateInputs(sentimentResult, stock, historicalData) {
  if (!sentimentResult || !stock || !historicalData) return false;
  if (!Array.isArray(historicalData) || historicalData.length < 20)
    return false;
  if (!stock.currentPrice || stock.currentPrice <= 0) return false;
  return true;
}

/* ───────────────── STEP 1: Sentiment Gate ───────────────── */

function checkSentimentGate(sentiment) {
  // Only consider stocks with bullish sentiment (scores 1-3)
  if (sentiment.score > 3) {
    return {
      passed: false,
      reason: `Sentiment not bullish enough (score: ${sentiment.score}/7). Wait for better market sentiment.`,
    };
  }

  // Require minimum confidence (lowered from 0.4 to 0.35)
  if (sentiment.confidence < 0.35) {
    return {
      passed: false,
      reason: `Setup confidence too low (${(sentiment.confidence * 100).toFixed(
        0
      )}%). Wait for clearer signals.`,
    };
  }

  return { passed: true };
}

/* ───────────────── STEP 2: Market Structure Analysis ───────────────── */

function analyzeMarketStructure(stock, historicalData) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const currentPrice = n(stock.currentPrice);

  const structure = {
    trend: "UNKNOWN",
    keyLevels: {},
    pricePosition: {},
    structureQuality: 0,
  };

  if (historicalData.length < 20) return structure;

  // Calculate key levels using available MAs from stock data
  const ma5 = n(stock.movingAverage5d);
  const ma25 = n(stock.movingAverage25d);
  const ma50 = n(stock.movingAverage50d);
  const ma75 = n(stock.movingAverage75d);
  const ma200 = n(stock.movingAverage200d);

  // Find support and resistance levels from historical data
  const recent50 = historicalData.slice(-50);
  const recent20 = recent50.slice(-20);

  const highs20 = recent20.map((d) => n(d.high));
  const lows20 = recent20.map((d) => n(d.low));
  const recentHigh = Math.max(...highs20);
  const recentLow = Math.min(...lows20);

  structure.keyLevels = {
    recentHigh,
    recentLow,
    range: recentHigh - recentLow,
    ma5,
    ma25,
    ma50,
    ma75,
    ma200,
    fiftyTwoWeekHigh: n(stock.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: n(stock.fiftyTwoWeekLow),
  };

  // Determine trend using multiple MAs
  let trendScore = 0;
  if (currentPrice > ma5 && ma5 > 0) trendScore++;
  if (currentPrice > ma25 && ma25 > 0) trendScore++;
  if (currentPrice > ma50 && ma50 > 0) trendScore++;
  if (currentPrice > ma200 && ma200 > 0) trendScore++;
  if (ma5 > ma25 && ma5 > 0 && ma25 > 0) trendScore++;
  if (ma25 > ma50 && ma25 > 0 && ma50 > 0) trendScore++;
  if (ma50 > ma200 && ma50 > 0 && ma200 > 0) trendScore++;

  if (trendScore >= 6) structure.trend = "STRONG_UP";
  else if (trendScore >= 4) structure.trend = "UP";
  else if (trendScore >= 2) structure.trend = "WEAK_UP";
  else structure.trend = "DOWN";

  // Calculate price position within range
  const rangePosition =
    structure.keyLevels.range > 0
      ? (currentPrice - recentLow) / structure.keyLevels.range
      : 0.5;

  structure.pricePosition = {
    inRange: rangePosition,
    nearSupport: rangePosition < 0.3,
    nearResistance: rangePosition > 0.7,
    inMiddle: rangePosition >= 0.3 && rangePosition <= 0.7,
  };

  // Find specific support/resistance levels including psychological levels
  structure.keyLevels.supports = findEnhancedSupportLevels(
    historicalData,
    currentPrice,
    stock
  );
  structure.keyLevels.resistances = findEnhancedResistanceLevels(
    historicalData,
    currentPrice,
    stock
  );

  // Quality score
  structure.structureQuality = calculateStructureQuality(
    structure,
    historicalData
  );

  return structure;
}

/* ───────────────── STEP 3: Entry Conditions ───────────────── */

function checkEntryConditions(stock, historicalData, sentiment) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const currentPrice = n(stock.currentPrice);

  const conditions = {
    pullbackToSupport: false,
    bounceConfirmed: false,
    breakingResistance: false,
    notOverextended: false,
    notExhausted: false,
    volumeConfirmation: false,
    momentumAligned: false,
    patternComplete: false,
    score: 0,
  };

  if (historicalData.length < 20) return conditions;

  const recent = historicalData.slice(-20);

  // Enhanced condition checks with available indicators
  conditions.pullbackToSupport = checkEnhancedPullbackToSupport(
    stock,
    recent,
    currentPrice
  );
  conditions.bounceConfirmed = checkEnhancedBounceConfirmation(
    stock,
    recent,
    currentPrice
  );
  conditions.breakingResistance = checkResistanceBreakout(
    stock,
    recent,
    currentPrice
  );
  conditions.notOverextended = checkNotOverextended(
    stock,
    recent,
    currentPrice
  );
  conditions.notExhausted = checkNotExhausted(stock, recent);
  conditions.volumeConfirmation = checkEnhancedVolumePattern(recent, stock);
  conditions.momentumAligned = checkEnhancedMomentumAlignment(stock);
  conditions.patternComplete = checkPatternCompletion(recent, currentPrice);

  // Calculate weighted score based on importance (made less strict)
  const scores = {
    pullbackToSupport: conditions.pullbackToSupport ? 25 : 0,
    bounceConfirmed: conditions.bounceConfirmed ? 25 : 0,
    breakingResistance: conditions.breakingResistance ? 20 : 0,
    notOverextended: conditions.notOverextended ? 15 : 0,
    notExhausted: conditions.notExhausted ? 10 : 0,
    volumeConfirmation: conditions.volumeConfirmation ? 10 : 0,
    momentumAligned: conditions.momentumAligned ? 10 : 0,
    patternComplete: conditions.patternComplete ? 15 : 0,
  };

  conditions.score = Math.min(
    100,
    Object.values(scores).reduce((a, b) => a + b, 0)
  );

  return conditions;
}

/* ───────────────── Enhanced Entry Condition Helpers ───────────────── */

function checkEnhancedPullbackToSupport(stock, recent, currentPrice) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  // Check multiple MAs for support
  const ma5 = n(stock.movingAverage5d);
  const ma25 = n(stock.movingAverage25d);
  const ma50 = n(stock.movingAverage50d);
  const ma200 = n(stock.movingAverage200d);

  const last5Lows = recent.slice(-5).map((d) => n(d.low));
  const lowestRecent = Math.min(...last5Lows);

  // Check if we've pulled back to any MA and bounced (require price above MA)
  const mas = [
    { value: ma5, name: "MA5", tolerance: 0.02 },
    { value: ma25, name: "MA25", tolerance: 0.025 },
    { value: ma50, name: "MA50", tolerance: 0.03 },
    { value: ma200, name: "MA200", tolerance: 0.035 },
  ];

  for (const ma of mas) {
    if (ma.value > 0) {
      const touchedMA =
        Math.abs(lowestRecent - ma.value) / ma.value < ma.tolerance;
      const bounced = currentPrice > ma.value * 1.005; // Must be clearly above MA
      const todayUp = currentPrice > n(stock.openPrice); // Must be up today
      if (touchedMA && bounced && todayUp) return true;
    }
  }

  // Previous resistance turned support (relaxed tolerance)
  const previousHigh = Math.max(
    ...recent.slice(-20, -10).map((d) => n(d.high))
  );
  if (
    previousHigh > 0 &&
    Math.abs(lowestRecent - previousHigh) / previousHigh < 0.03
  ) {
    if (currentPrice > previousHigh * 0.99) return true; // Allow 1% below previous high
  }

  // Fibonacci retracement levels (38.2%, 50%, 61.8%)
  const recentSwingHigh = Math.max(...recent.slice(-10).map((d) => n(d.high)));
  const recentSwingLow = Math.min(
    ...recent.slice(-20, -10).map((d) => n(d.low))
  );
  const swingRange = recentSwingHigh - recentSwingLow;

  if (swingRange > 0) {
    const fib382 = recentSwingHigh - swingRange * 0.382;
    const fib50 = recentSwingHigh - swingRange * 0.5;
    const fib618 = recentSwingHigh - swingRange * 0.618;

    const fibLevels = [fib382, fib50, fib618];
    for (const level of fibLevels) {
      if (
        level > 0 &&
        Math.abs(lowestRecent - level) / level < 0.03 &&
        currentPrice > level * 0.99
      ) {
        return true;
      }
    }
  }

  return false;
}

function checkEnhancedBounceConfirmation(stock, recent, currentPrice) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  if (recent.length < 3) return false;

  const last3Days = recent.slice(-3);
  const lastDay = recent[recent.length - 1];
  const prevDay = recent[recent.length - 2];

  // 1) Hammer/Doji at support (relaxed)
  const hammerPattern = (() => {
    const range = n(lastDay.high) - n(lastDay.low);
    const body = Math.abs(n(lastDay.close) - n(lastDay.open));
    const lowerWick =
      Math.min(n(lastDay.close), n(lastDay.open)) - n(lastDay.low);
    return (
      range > 0 &&
      body < range * 0.4 &&
      lowerWick > body * 1.5 &&
      n(lastDay.close) >= n(lastDay.open)
    );
  })();

  // 2) Bullish engulfing (must be green today)
  const bullishEngulfing =
    n(prevDay.close) < n(prevDay.open) &&
    n(lastDay.close) > n(lastDay.open) &&
    n(lastDay.open) <= n(prevDay.close) &&
    n(lastDay.close) > n(prevDay.open) &&
    n(lastDay.close) > n(lastDay.open);

  // 3) Morning star (3-day)
  const morningStar = (() => {
    if (last3Days.length < 3) return false;
    const [day1, day2, day3] = last3Days;
    return (
      n(day1.close) < n(day1.open) &&
      Math.abs(n(day2.close) - n(day2.open)) <
        (n(day2.high) - n(day2.low)) * 0.3 &&
      n(day3.close) > n(day3.open) &&
      n(day3.close) > (n(day1.open) + n(day1.close)) / 2
    );
  })();

  // 4) Higher low with volume (must be green)
  const higherLowWithVolume =
    n(lastDay.low) > n(prevDay.low) &&
    n(lastDay.close) > n(lastDay.open) &&
    n(lastDay.volume) > n(prevDay.volume) * 1.2;

  // 5) Intraday reversal over MA50 (must be green)
  const intradayReversal = (() => {
    const ma50 = n(stock.movingAverage50d);
    if (ma50 <= 0) return false;
    return (
      n(lastDay.open) < ma50 &&
      n(lastDay.close) > ma50 &&
      n(lastDay.close) > n(lastDay.open)
    );
  })();

  // 6) Today must show buying pressure
  const todayBullish =
    n(stock.currentPrice) > n(stock.openPrice) &&
    n(stock.currentPrice) > n(stock.prevClosePrice);

  return (
    hammerPattern ||
    bullishEngulfing ||
    morningStar ||
    higherLowWithVolume ||
    intradayReversal ||
    todayBullish
  );
}

function checkEnhancedVolumePattern(recent, stock) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  if (recent.length < 20) return false;

  // Use OBV if available
  const obv = n(stock.obv);
  const obvRising = obv > 0;

  // Average volumes
  const avgVolume20 = recent.reduce((sum, d) => sum + n(d.volume), 0) / 20;
  const avgVolume5 =
    recent.slice(-5).reduce((sum, d) => sum + n(d.volume), 0) / 5;

  const volumeExpanding = avgVolume5 > avgVolume20;

  const accumulationDays = recent.slice(-10).filter((d) => {
    const bullish = n(d.close) > n(d.open);
    const highVolume = n(d.volume) > avgVolume20;
    return bullish && highVolume;
  }).length;

  const distributionDays = recent.slice(-10).filter((d) => {
    const bearish = n(d.close) < n(d.open);
    const highVolume = n(d.volume) > avgVolume20 * 1.2;
    return bearish && highVolume;
  }).length;

  return (
    (volumeExpanding && accumulationDays > distributionDays) ||
    (accumulationDays >= 2 && distributionDays <= 1) ||
    obvRising
  );
}

function checkEnhancedMomentumAlignment(stock) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  const rsi = n(stock.rsi14);
  const macd = n(stock.macd);
  const macdSignal = n(stock.macdSignal);
  const stochK = n(stock.stochasticK);
  const stochD = n(stock.stochasticD);

  // Multiple momentum confirmations (require actual bullish price action)
  const currentPrice = n(stock.currentPrice);
  const openPrice = n(stock.openPrice);
  const prevClose = n(stock.prevClosePrice);

  const priceActionBullish =
    currentPrice > openPrice && currentPrice > prevClose;

  const rsiBullish = rsi > 45 && rsi < 75;
  const macdBullish = macd > macdSignal;
  const macdCrossover =
    macd > macdSignal && Math.abs(macd - macdSignal) < Math.abs(macd) * 0.2;
  const stochasticBullish = stochK > stochD && stochK > 20 && stochK < 85;

  if (!priceActionBullish) return false;

  let alignedSignals = 1; // price action counts as one
  if (rsiBullish) alignedSignals++;
  if (macdBullish || macdCrossover) alignedSignals++;
  if (stochasticBullish) alignedSignals++;

  return alignedSignals >= 2;
}

function checkNotOverextended(stock, recent, currentPrice) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  // Check distance from multiple MAs
  const ma5 = n(stock.movingAverage5d);
  const ma25 = n(stock.movingAverage25d);
  const ma50 = n(stock.movingAverage50d);

  // Dynamic thresholds based on ATR
  const atr = n(stock.atr14);
  const priceVolatility = currentPrice > 0 ? atr / currentPrice : 0.02;

  // Adjust extension thresholds based on volatility (more lenient)
  const maxExtension5 = 5 + priceVolatility * 150;
  const maxExtension25 = 8 + priceVolatility * 200;
  const maxExtension50 = 12 + priceVolatility * 250;

  if (ma5 > 0) {
    const distanceFromMA5 = ((currentPrice - ma5) / ma5) * 100;
    if (distanceFromMA5 > maxExtension5) return false;
  }

  if (ma25 > 0) {
    const distanceFromMA25 = ((currentPrice - ma25) / ma25) * 100;
    if (distanceFromMA25 > maxExtension25) return false;
  }

  if (ma50 > 0) {
    const distanceFromMA50 = ((currentPrice - ma50) / ma50) * 100;
    if (distanceFromMA50 > maxExtension50) return false;
  }

  // Check RSI (slightly more lenient)
  const rsi = n(stock.rsi14);
  if (rsi > 78) return false;

  // Check Bollinger Bands
  const bbUpper = n(stock.bollingerUpper);
  if (bbUpper > 0 && currentPrice > bbUpper) return false;

  // Check recent run-up (more lenient)
  const fiveDaysAgo = recent[recent.length - 6]?.close;
  if (fiveDaysAgo && fiveDaysAgo > 0) {
    const fiveDayGain = ((currentPrice - fiveDaysAgo) / fiveDaysAgo) * 100;
    const maxGain = 12 + priceVolatility * 350;
    if (fiveDayGain > maxGain) return false;
  }

  return true;
}

function checkNotExhausted(stock, recent) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  let exhaustionSignals = 0;

  // 1. Decreasing volume on recent up moves (more lenient)
  const last5 = recent.slice(-5);
  const upDaysWithDecreasingVolume = last5.filter((d, i) => {
    if (i === 0) return false;
    return n(d.close) > n(d.open) && n(d.volume) < n(last5[i - 1].volume);
  }).length;
  if (upDaysWithDecreasingVolume >= 4) exhaustionSignals++;

  // 2. Multiple dojis or small bodies (more lenient)
  const smallBodies = last5.filter((d) => {
    const range = n(d.high) - n(d.low);
    const body = Math.abs(n(d.close) - n(d.open));
    return range > 0 && body / range < 0.25;
  }).length;
  if (smallBodies >= 4) exhaustionSignals++;

  // 3. RSI divergence
  const rsi = n(stock.rsi14);
  if (rsi > 60 && rsi < 70) {
    const priceHigher =
      n(recent[recent.length - 1].high) >
      n(recent[recent.length - 6]?.high || 0);
    if (priceHigher && rsi < 65) exhaustionSignals++;
  }

  // 4. Stochastic overbought (more lenient)
  const stochK = n(stock.stochasticK);
  if (stochK > 85) exhaustionSignals++;

  // 5. Failed breakout attempts
  const failedBreakouts = checkFailedBreakouts(recent);
  if (failedBreakouts) exhaustionSignals++;

  return exhaustionSignals <= 2;
}

function checkFailedBreakouts(recent) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  if (recent.length < 10) return false;

  // Look for recent highs that failed to hold
  let failures = 0;
  const recentHigh = Math.max(...recent.slice(-10).map((d) => n(d.high)));

  for (let i = recent.length - 10; i < recent.length - 1; i++) {
    const dayHigh = n(recent[i].high);
    const nextDayClose = n(recent[i + 1].close);

    if (dayHigh >= recentHigh * 0.99 && nextDayClose < dayHigh * 0.98) {
      failures++;
    }
  }

  return failures >= 2;
}

/* ───────────────── STEP 4: Risk/Reward Analysis ───────────────── */

function analyzeRiskReward(stock, sentiment, marketStructure) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const currentPrice = n(stock.currentPrice);
  const rawATR = n(stock.atr14);
  // Floor ATR as % of price to avoid tiny ATR explosion
  const atr = Math.max(rawATR, currentPrice * 0.005); // 0.5% floor

  const analysis = {
    ratio: 0,
    risk: 0,
    reward: 0,
    acceptable: false,
    quality: "POOR",
    adjustedStopLoss: null,
    multipleTargets: [],
  };

  let stopLoss = n(sentiment.stopLoss);
  let target = n(sentiment.priceTarget);

  // >>> Fallback when sentiment lacks stop/target <<<
  if (!stopLoss || !target) {
    const supports = marketStructure?.keyLevels?.supports || [];
    const resistances = marketStructure?.keyLevels?.resistances || [];

    if (!stopLoss) {
      if (supports.length) {
        stopLoss = supports[0] - Math.max(0.3 * atr, currentPrice * 0.002);
      } else {
        stopLoss = currentPrice - 1.8 * atr;
      }
    }
    if (!target) {
      if (resistances.length) {
        target = resistances[0];
      } else {
        target = currentPrice + 2.8 * atr;
      }
    }
  }
  // <<< end fallback >>>

  if (
    !stopLoss ||
    !target ||
    stopLoss >= currentPrice ||
    target <= currentPrice
  ) {
    return analysis;
  }

  // Validate and adjust stop loss if needed
  if (atr > 0) {
    const minStopDistance = atr * 1.5; // At least 1.5 ATR away
    if (currentPrice - stopLoss < minStopDistance) {
      stopLoss = currentPrice - minStopDistance;
      analysis.adjustedStopLoss = stopLoss;
    }
  }

  analysis.risk = currentPrice - stopLoss;
  analysis.reward = target - currentPrice;
  analysis.ratio = analysis.reward / analysis.risk;

  // Multiple targets for scaling out
  analysis.multipleTargets = [
    { level: currentPrice + analysis.reward * 0.5, percentage: 33 },
    { level: currentPrice + analysis.reward * 0.75, percentage: 33 },
    { level: target, percentage: 34 },
  ];

  // Dynamic R:R requirements based on market conditions (more lenient)
  let requiredRatio = 1.8;

  if (marketStructure.trend === "STRONG_UP") requiredRatio = 1.3;
  else if (marketStructure.trend === "DOWN") requiredRatio = 2.5;

  // Adjust for volatility/heat
  const rsi = n(stock.rsi14);
  if (rsi > 65 && rsi < 75) requiredRatio += 0.3;

  // Evaluate R:R quality
  if (analysis.ratio >= requiredRatio + 1) {
    analysis.quality = "EXCELLENT";
    analysis.acceptable = true;
  } else if (analysis.ratio >= requiredRatio) {
    analysis.quality = "GOOD";
    analysis.acceptable = true;
  } else if (
    analysis.ratio >= requiredRatio - 0.5 &&
    marketStructure.trend === "STRONG_UP"
  ) {
    analysis.quality = "FAIR";
    analysis.acceptable = true;
  } else {
    analysis.quality = "POOR";
    analysis.acceptable = false;
  }

  return analysis;
}

/* ───────────────── STEP 5: Timing Confirmation ───────────────── */

function confirmEntryTiming(stock, historicalData, marketStructure) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  const signals = {
    intraday: {},
    daily: {},
    marketPhase: {},
    score: 0,
  };

  if (historicalData.length < 5) return signals;

  const recent = historicalData.slice(-5);
  const lastDay = recent[recent.length - 1];
  const prevDay = recent[recent.length - 2];
  const currentPrice = n(stock.currentPrice);

  // Intraday signals (require actual bullish action)
  const todayUp = n(stock.currentPrice) > n(stock.openPrice);

  signals.intraday = {
    closeNearHigh:
      n(lastDay.close) >
      n(lastDay.high) - (n(lastDay.high) - n(lastDay.low)) * 0.3,
    bullishClose: n(lastDay.close) > n(lastDay.open),
    volumeSurge:
      n(lastDay.volume) >
      (recent.slice(0, 4).reduce((s, d) => s + n(d.volume), 0) / 4) * 1.1,
    openAbovePrevClose: n(stock.openPrice) > n(stock.prevClosePrice),
    strongOpen: n(stock.openPrice) > n(stock.prevClosePrice) * 1.005,
    currentlyBullish: todayUp,
  };

  // Daily signals
  signals.daily = {
    higherLow: n(lastDay.low) > n(prevDay.low),
    higherClose: n(lastDay.close) > n(prevDay.close),
    trendContinuation: checkTrendContinuation(recent),
    aboveVWAP: currentPrice > calculateVWAP(lastDay),
  };

  // Market phase considerations
  signals.marketPhase = getMarketPhaseSignals(stock, lastDay);

  // Calculate timing score with weighted components
  let score = 0;
  if (signals.intraday.closeNearHigh) score += 15;
  if (signals.intraday.bullishClose) score += 10;
  if (signals.intraday.volumeSurge) score += 20;
  if (signals.intraday.strongOpen) score += 10;
  if (signals.intraday.currentlyBullish) score += 20;
  if (signals.daily.higherLow) score += 15;
  if (signals.daily.higherClose) score += 10;
  if (signals.daily.trendContinuation) score += 15;
  if (signals.marketPhase.favorable) score += 15;

  signals.score = score;

  return signals;
}

function getMarketPhaseSignals(stock, lastDay) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  // Simple market phase analysis
  const openToHighRatio =
    n(lastDay.high) > n(lastDay.open)
      ? (n(lastDay.high) - n(lastDay.open)) / (n(lastDay.high) - n(lastDay.low))
      : 0;

  const closeToHighRatio =
    n(lastDay.high) > n(lastDay.low)
      ? (n(lastDay.close) - n(lastDay.low)) / (n(lastDay.high) - n(lastDay.low))
      : 0.5;

  return {
    favorable: openToHighRatio < 0.5 && closeToHighRatio > 0.7, // Steady climb
    accumulation: closeToHighRatio > 0.8,
    distribution: closeToHighRatio < 0.2,
  };
}

function calculateVWAP(dayData) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const typicalPrice =
    (n(dayData.high) + n(dayData.low) + n(dayData.close)) / 3;
  return typicalPrice; // Simplified VWAP
}

/* ───────────────── STEP 6: Volume and Momentum Validation ───────────────── */

function validateVolumeMomentum(stock, historicalData) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  const validation = {
    volumeProfile: "NEUTRAL",
    momentumState: "NEUTRAL",
    divergences: [],
    relativeStrength: 0,
    score: 0,
  };

  if (historicalData.length < 20) return validation;

  const recent = historicalData.slice(-20);

  // Enhanced volume analysis
  const volumeAnalysis = analyzeVolumeProfile(recent);
  validation.volumeProfile = volumeAnalysis.profile;

  // Enhanced momentum analysis
  const rsi = n(stock.rsi14);
  const macd = n(stock.macd);
  const stochK = n(stock.stochasticK);

  // Momentum state based on multiple indicators
  if (rsi > 60 && rsi < 70 && macd > 0) {
    validation.momentumState = "STRONG";
  } else if (rsi > 50 && rsi <= 60) {
    validation.momentumState = "BUILDING";
  } else if (rsi > 40 && rsi <= 50) {
    validation.momentumState = "WEAK";
  } else if (rsi <= 30) {
    validation.momentumState = "OVERSOLD";
  } else if (rsi >= 70) {
    validation.momentumState = "OVERBOUGHT";
  }

  // Check for divergences
  validation.divergences = checkDivergences(stock, recent);

  // Relative strength (5d change)
  const priceChange5d =
    recent.length >= 5
      ? ((n(recent[recent.length - 1].close) -
          n(recent[recent.length - 5].close)) /
          n(recent[recent.length - 5].close)) *
        100
      : 0;
  validation.relativeStrength = priceChange5d;

  // Score
  let score = 0;
  if (validation.volumeProfile === "ACCUMULATION") score += 30;
  else if (validation.volumeProfile === "EXPANDING") score += 20;

  if (validation.momentumState === "STRONG") score += 30;
  else if (validation.momentumState === "BUILDING") score += 20;
  else if (validation.momentumState === "OVERSOLD") score += 10;

  if (validation.divergences.length === 0) score += 20;
  else if (validation.divergences.some((d) => d.type === "bullish"))
    score += 10;

  if (validation.relativeStrength > 5) score += 10;

  validation.score = score;

  return validation;
}

function analyzeVolumeProfile(recent) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  const avgVolume = recent.reduce((s, d) => s + n(d.volume), 0) / recent.length;
  const recentVolume =
    recent.slice(-5).reduce((s, d) => s + n(d.volume), 0) / 5;

  const upDays = recent.filter((d) => n(d.close) > n(d.open));
  const downDays = recent.filter((d) => n(d.close) < n(d.open));

  const upVolume =
    upDays.reduce((s, d) => s + n(d.volume), 0) / Math.max(1, upDays.length);
  const downVolume =
    downDays.reduce((s, d) => s + n(d.volume), 0) /
    Math.max(1, downDays.length);

  let profile = "NEUTRAL";

  if (recentVolume > avgVolume * 1.3 && upVolume > downVolume) {
    profile = "ACCUMULATION";
  } else if (recentVolume > avgVolume * 1.2) {
    profile = "EXPANDING";
  } else if (recentVolume < avgVolume * 0.7) {
    profile = "CONTRACTING";
  } else if (downVolume > upVolume * 1.5) {
    profile = "DISTRIBUTION";
  }

  return { profile, upVolume, downVolume, avgVolume };
}

/* ───────────────── STEP 7: Final Entry Decision ───────────────── */

function makeFinalDecision(
  stock,
  analysis,
  entryConditions,
  timingSignals,
  riskReward,
  marketStructure,
  volumeMomentum,
  priceActionPositive // robust flag passed from caller
) {
  // Calculate overall entry quality score with dynamic weights
  const weights = getAdaptiveWeights(marketStructure, volumeMomentum);

  const qualityScore =
    entryConditions.score * weights.entryConditions +
    timingSignals.score * weights.timing +
    (riskReward.acceptable ? 80 : 20) * weights.riskReward +
    marketStructure.structureQuality * weights.marketStructure +
    volumeMomentum.score * weights.volumeMomentum;

  analysis.entryQuality = Math.round(qualityScore);

  // Dynamic quality threshold based on market conditions
  const qualityThreshold = getQualityThreshold(
    marketStructure,
    analysis.sentimentScore
  );

  // Must-have conditions
  const mustHavesMet =
    riskReward.acceptable &&
    entryConditions.notOverextended &&
    entryConditions.notExhausted &&
    priceActionPositive; // Must be green today (robust)

  // Strong buy signals
  const pullbackBounce =
    entryConditions.pullbackToSupport && entryConditions.bounceConfirmed;
  const breakoutWithVolume =
    entryConditions.breakingResistance && entryConditions.volumeConfirmation;
  const patternWithTiming =
    entryConditions.patternComplete && timingSignals.score >= 50;

  // Momentum entry only valid if price is actually up today
  const momentumEntry =
    entryConditions.momentumAligned &&
    entryConditions.notOverextended &&
    volumeMomentum.score >= 50 &&
    priceActionPositive &&
    (stock.currentPrice - (stock.openPrice || stock.currentPrice)) /
      (stock.openPrice || stock.currentPrice) >
      0.003; // ≥0.3%

  // Ideal setup (relaxed)
  const idealSetup =
    entryConditions.pullbackToSupport &&
    entryConditions.bounceConfirmed &&
    (entryConditions.volumeConfirmation ||
      volumeMomentum.volumeProfile === "ACCUMULATION") &&
    entryConditions.momentumAligned;

  // Final decision checks
  const highQuality = analysis.entryQuality >= qualityThreshold;
  const hasStrongSignal =
    pullbackBounce ||
    breakoutWithVolume ||
    patternWithTiming ||
    momentumEntry ||
    idealSetup;

  const goodEnoughConditions =
    entryConditions.score >= 65 &&
    riskReward.acceptable &&
    priceActionPositive &&
    (entryConditions.notOverextended || marketStructure.trend === "STRONG_UP");

  if (
    (mustHavesMet && hasStrongSignal && highQuality) ||
    goodEnoughConditions
  ) {
    // BUY NOW - Reason
    let buyReason = "";

    if (idealSetup) {
      buyReason = `IDEAL ENTRY: Pullback to support with bounce confirmed, strong volume (${
        volumeMomentum.volumeProfile
      }), and momentum aligned. Entry quality: ${
        analysis.entryQuality
      }%. Risk/Reward: ${riskReward.ratio.toFixed(1)}:1.`;
    } else if (pullbackBounce) {
      const ma = entryConditions.pullbackToSupport ? "key support" : "MA";
      buyReason = `PULLBACK ENTRY: Price pulled back to ${ma} and bounce is confirmed. Entry quality: ${
        analysis.entryQuality
      }%. Risk/Reward: ${riskReward.ratio.toFixed(1)}:1.`;
    } else if (breakoutWithVolume) {
      buyReason = `BREAKOUT ENTRY: Breaking resistance with ${
        volumeMomentum.volumeProfile
      } volume pattern. Entry quality: ${
        analysis.entryQuality
      }%. Risk/Reward: ${riskReward.ratio.toFixed(1)}:1.`;
    } else if (patternWithTiming) {
      buyReason = `PATTERN ENTRY: Bullish pattern complete with good timing (score: ${
        timingSignals.score
      }). Entry quality: ${
        analysis.entryQuality
      }%. Risk/Reward: ${riskReward.ratio.toFixed(1)}:1.`;
    } else if (momentumEntry) {
      buyReason = `MOMENTUM ENTRY: Momentum aligned with ${
        volumeMomentum.momentumState
      } state. Entry quality: ${
        analysis.entryQuality
      }%. Risk/Reward: ${riskReward.ratio.toFixed(1)}:1.`;
    } else if (goodEnoughConditions) {
      buyReason = `TECHNICAL ENTRY: Good technical setup with ${
        marketStructure.trend
      } trend. Currently up ${(
        ((stock.currentPrice - (stock.openPrice || stock.currentPrice)) /
          (stock.openPrice || stock.currentPrice)) *
        100
      ).toFixed(2)}% today. Entry quality: ${
        analysis.entryQuality
      }%. Risk/Reward: ${riskReward.ratio.toFixed(1)}:1.`;
    }

    return { buyNow: true, reason: buyReason };
  } else {
    // NOT A BUY - Explain what's missing
    let waitReason = "";

    // First check if stock is red today
    if (!priceActionPositive) {
      const openPx = stock.openPrice || stock.currentPrice;
      const percentDown = openPx
        ? ((((stock.currentPrice || openPx) - openPx) / openPx) * 100).toFixed(
            2
          )
        : "0.00";
      waitReason = `Stock is down ${percentDown}% today. No entry on red days. Wait for bullish price action.`;
    } else if (!mustHavesMet) {
      if (!riskReward.acceptable) {
        waitReason = `Risk/Reward not favorable (${riskReward.ratio.toFixed(
          1
        )}:1, need ${(marketStructure.trend === "STRONG_UP"
          ? 1.5
          : 2.0
        ).toFixed(1)}:1+). Wait for better setup.`;
      } else if (!entryConditions.notOverextended) {
        const rsi = Number(stock?.rsi14) || 0;
        const bbUpper = Number(stock?.bollingerUpper) || 0;
        if (rsi > 70) {
          waitReason = `RSI overbought at ${rsi.toFixed(
            0
          )}. Wait for pullback to cool off momentum.`;
        } else if (bbUpper > 0 && stock.currentPrice > bbUpper) {
          waitReason = `Price above Bollinger Band upper limit. Wait for pullback into bands.`;
        } else {
          waitReason = `Price overextended from moving averages. Wait for pullback to MA25/MA50.`;
        }
      } else if (!entryConditions.notExhausted) {
        waitReason = `Showing exhaustion signals (${volumeMomentum.volumeProfile} volume, momentum ${volumeMomentum.momentumState}). Wait for consolidation and renewed buying.`;
      }
    } else if (!hasStrongSignal) {
      if (!entryConditions.pullbackToSupport) {
        waitReason =
          "No pullback to support yet. Wait for price to test MA25/MA50 or key support level.";
      } else if (!entryConditions.bounceConfirmed) {
        waitReason =
          "At support but bounce not confirmed. Wait for bullish reversal candle with volume.";
      } else if (!entryConditions.volumeConfirmation) {
        waitReason = `Setup looks good but volume pattern is ${volumeMomentum.volumeProfile}. Wait for accumulation volume.`;
      } else {
        waitReason =
          "No clear entry trigger. Wait for pullback to support, breakout, or pattern completion.";
      }
    } else if (!highQuality) {
      waitReason = `Entry quality too low (${analysis.entryQuality}%, need ${qualityThreshold}%+). `;
      if (timingSignals.score < 50) {
        waitReason += "Timing not optimal - wait for stronger daily close.";
      } else if (volumeMomentum.score < 50) {
        waitReason += "Volume/momentum not aligned - wait for improvement.";
      } else {
        waitReason += "Wait for better alignment of technical conditions.";
      }
    }

    if (marketStructure.trend === "DOWN") {
      waitReason += " Note: Overall trend is bearish (counter-trend trade).";
    } else if (marketStructure.trend === "WEAK_UP") {
      waitReason += " Note: Uptrend is weak, be selective.";
    }

    return { buyNow: false, reason: waitReason };
  }
}

/* ───────────────── Helper Functions ───────────────── */

function getAdaptiveWeights(marketStructure, volumeMomentum) {
  // Adjust weights based on market conditions
  const baseWeights = {
    entryConditions: 0.35,
    timing: 0.2,
    riskReward: 0.15,
    marketStructure: 0.15,
    volumeMomentum: 0.15,
  };

  // In strong trends, timing less important
  if (marketStructure.trend === "STRONG_UP") {
    baseWeights.timing = 0.15;
    baseWeights.marketStructure = 0.2;
  }

  // If volume is distributing, increase its importance
  if (volumeMomentum.volumeProfile === "DISTRIBUTION") {
    baseWeights.volumeMomentum = 0.25;
    baseWeights.timing = 0.15;
  }

  return baseWeights;
}

function getQualityThreshold(marketStructure, sentimentScore) {
  let threshold = 70; // base

  // Adjust based on market trend
  if (marketStructure.trend === "STRONG_UP") threshold -= 5;
  else if (marketStructure.trend === "DOWN") threshold += 10;

  // Adjust based on sentiment strength
  if (sentimentScore === 1) threshold -= 5;
  else if (sentimentScore === 3) threshold += 5;

  return Math.max(60, threshold);
}

function findEnhancedSupportLevels(historicalData, currentPrice, stock) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const supports = [];

  if (historicalData.length < 50) return supports;

  const recent50 = historicalData.slice(-50);

  // Find swing lows
  for (let i = 2; i < recent50.length - 2; i++) {
    const isSwingLow =
      n(recent50[i].low) < n(recent50[i - 1].low) &&
      n(recent50[i].low) < n(recent50[i - 2].low) &&
      n(recent50[i].low) < n(recent50[i + 1].low) &&
      n(recent50[i].low) < n(recent50[i + 2].low);

    if (isSwingLow && n(recent50[i].low) < currentPrice) {
      supports.push(n(recent50[i].low));
    }
  }

  // Add MAs as support if price is above them
  const mas = [stock.movingAverage50d, stock.movingAverage200d];
  mas.forEach((ma) => {
    if (n(ma) > 0 && n(ma) < currentPrice) {
      supports.push(n(ma));
    }
  });

  // Psychological levels (round numbers)
  const roundLevel = Math.floor(currentPrice / 100) * 100;
  if (roundLevel < currentPrice && roundLevel > currentPrice * 0.9) {
    supports.push(roundLevel);
  }

  // Previous day's low
  const prevDayLow = n(stock.lowPrice);
  if (prevDayLow < currentPrice) {
    supports.push(prevDayLow);
  }

  return [...new Set(supports)].sort((a, b) => b - a);
}

function findEnhancedResistanceLevels(historicalData, currentPrice, stock) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const resistances = [];

  if (historicalData.length < 50) return resistances;

  const recent50 = historicalData.slice(-50);

  // Find swing highs
  for (let i = 2; i < recent50.length - 2; i++) {
    const isSwingHigh =
      n(recent50[i].high) > n(recent50[i - 1].high) &&
      n(recent50[i].high) > n(recent50[i - 2].high) &&
      n(recent50[i].high) > n(recent50[i + 1].high) &&
      n(recent50[i].high) > n(recent50[i + 2].high);

    if (isSwingHigh && n(recent50[i].high) > currentPrice) {
      resistances.push(n(recent50[i].high));
    }
  }

  // 52-week high
  const yearHigh = n(stock.fiftyTwoWeekHigh);
  if (yearHigh > currentPrice) {
    resistances.push(yearHigh);
  }

  // Psychological levels
  const roundLevel = Math.ceil(currentPrice / 100) * 100;
  if (roundLevel > currentPrice && roundLevel < currentPrice * 1.1) {
    resistances.push(roundLevel);
  }

  // Previous day's high
  const prevDayHigh = n(stock.highPrice);
  if (prevDayHigh > currentPrice) {
    resistances.push(prevDayHigh);
  }

  return [...new Set(resistances)].sort((a, b) => a - b);
}

function calculateStructureQuality(structure, historicalData) {
  let quality = 50; // Base score

  // Trend alignment
  if (structure.trend === "STRONG_UP") quality += 30;
  else if (structure.trend === "UP") quality += 20;
  else if (structure.trend === "WEAK_UP") quality += 10;
  else if (structure.trend === "DOWN") quality -= 20;

  // Price position
  if (structure.pricePosition.nearSupport) quality += 20;
  else if (structure.pricePosition.nearResistance) quality -= 10;
  else if (structure.pricePosition.inMiddle) quality += 5;

  // Clear levels
  if (structure.keyLevels.supports.length >= 2) quality += 10;
  if (structure.keyLevels.resistances.length >= 2) quality += 10;

  // MA alignment
  if (
    structure.keyLevels.ma5 > structure.keyLevels.ma25 &&
    structure.keyLevels.ma25 > structure.keyLevels.ma50
  ) {
    quality += 10;
  }

  return Math.min(100, Math.max(0, quality));
}

function checkTrendContinuation(recent) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  if (recent.length < 5) return false;

  let higherHighs = 0;
  let higherLows = 0;

  for (let i = 1; i < recent.length; i++) {
    if (n(recent[i].high) > n(recent[i - 1].high)) higherHighs++;
    if (n(recent[i].low) > n(recent[i - 1].low)) higherLows++;
  }

  return higherHighs >= 3 && higherLows >= 3;
}

function checkDivergences(stock, recent) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const divergences = [];

  if (recent.length < 10) return divergences;

  const rsi = n(stock.rsi14);
  const currentPrice = n(stock.currentPrice);
  const priceWeekAgo = n(recent[recent.length - 6]?.close);
  const priceTwoWeeksAgo = n(recent[recent.length - 11]?.close);

  if (priceWeekAgo && priceWeekAgo > 0) {
    const priceChange = ((currentPrice - priceWeekAgo) / priceWeekAgo) * 100;

    if (priceChange > 5 && rsi < 60) {
      divergences.push({ type: "bearish", strength: "moderate" });
    } else if (priceChange > 10 && rsi < 65) {
      divergences.push({ type: "bearish", strength: "strong" });
    }

    if (priceChange < -5 && rsi > 40) {
      divergences.push({ type: "bullish", strength: "moderate" });
    } else if (priceChange < -10 && rsi > 35) {
      divergences.push({ type: "bullish", strength: "strong" });
    }
  }

  const macd = n(stock.macd);
  if (priceTwoWeeksAgo && priceTwoWeeksAgo > 0) {
    const longerPriceChange =
      ((currentPrice - priceTwoWeeksAgo) / priceTwoWeeksAgo) * 100;

    if (longerPriceChange > 10 && macd < 0) {
      divergences.push({ type: "bearish", indicator: "MACD" });
    } else if (longerPriceChange < -10 && macd > 0) {
      divergences.push({ type: "bullish", indicator: "MACD" });
    }
  }

  return divergences;
}

function checkResistanceBreakout(stock, recent, currentPrice) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  const resistanceWindow = recent.slice(-12, -2);
  if (resistanceWindow.length < 8) return false;

  const resistance = Math.max(...resistanceWindow.map((d) => n(d.high)));
  const lastDay = recent[recent.length - 1];

  // Must be breaking out TODAY (vs the latest daily bar), not yesterday
  const todayBreakout =
    currentPrice > resistance * 1.01 && n(stock.openPrice) < resistance * 1.02;

  // Check for breakout with volume
  const avgVolume =
    recent.slice(-10).reduce((sum, d) => sum + n(d.volume), 0) / 10;

  const breakoutConfirmed =
    todayBreakout &&
    currentPrice > n(stock.openPrice) &&
    n(lastDay.volume) > avgVolume * 1.3 &&
    n(lastDay.close) > resistance; // yesterday closed above resistance too

  return breakoutConfirmed;
}

function checkPatternCompletion(recent, currentPrice) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  if (recent.length < 10) return false;

  if (detectBullFlag(recent)) return true;
  if (detectAscendingTriangle(recent)) return true;
  if (detectInverseHeadShoulders(recent)) return true;
  if (detectDoubleBottom(recent)) return true;

  return false;
}

/* ───────────────── Pattern Detection Functions ───────────────── */

function detectBullFlag(recent) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  if (recent.length < 10) return false;

  const firstHalf = recent.slice(0, 5);
  const secondHalf = recent.slice(5, 10);

  const poleStart = Math.min(...firstHalf.map((d) => n(d.low)));
  const poleEnd = Math.max(...firstHalf.map((d) => n(d.high)));
  const poleMove = ((poleEnd - poleStart) / poleStart) * 100;

  const flagHigh = Math.max(...secondHalf.map((d) => n(d.high)));
  const flagLow = Math.min(...secondHalf.map((d) => n(d.low)));
  const flagRange = ((flagHigh - flagLow) / flagLow) * 100;

  const poleVolume = firstHalf.reduce((sum, d) => sum + n(d.volume), 0) / 5;
  const flagVolume = secondHalf.reduce((sum, d) => sum + n(d.volume), 0) / 5;
  const volumeDecline = flagVolume < poleVolume * 0.7;

  return poleMove > 10 && flagRange < 5 && flagLow > poleStart && volumeDecline;
}

function detectAscendingTriangle(recent) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  if (recent.length < 15) return false;

  const highs = [];
  const lows = [];

  for (let i = 2; i < recent.length - 2; i++) {
    if (
      n(recent[i].high) > n(recent[i - 1].high) &&
      n(recent[i].high) > n(recent[i + 1].high)
    ) {
      highs.push(n(recent[i].high));
    }
    if (
      n(recent[i].low) < n(recent[i - 1].low) &&
      n(recent[i].low) < n(recent[i + 1].low)
    ) {
      lows.push(n(recent[i].low));
    }
  }

  if (highs.length < 2 || lows.length < 2) return false;

  const highsRange = Math.max(...highs) - Math.min(...highs);
  const avgHigh = highs.reduce((a, b) => a + b, 0) / highs.length;
  const flatTop = (highsRange / avgHigh) * 100 < 2;

  const risingLows = lows.length >= 2 && lows[lows.length - 1] > lows[0] * 1.02;

  return flatTop && risingLows;
}

function detectInverseHeadShoulders(recent) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  if (recent.length < 15) return false;

  const third1 = recent.slice(0, 5);
  const third2 = recent.slice(5, 10);
  const third3 = recent.slice(10, 15);

  const shoulder1Low = Math.min(...third1.map((d) => n(d.low)));
  const headLow = Math.min(...third2.map((d) => n(d.low)));
  const shoulder2Low = Math.min(...third3.map((d) => n(d.low)));

  const headLower =
    headLow < shoulder1Low * 0.97 && headLow < shoulder2Low * 0.97;
  const shouldersEqual =
    Math.abs(shoulder1Low - shoulder2Low) / shoulder1Low < 0.03;

  const neckline = Math.max(...recent.slice(0, 10).map((d) => n(d.high)));
  const currentClose = n(recent[recent.length - 1].close);
  const necklineBroken = currentClose > neckline;

  return headLower && shouldersEqual && necklineBroken;
}

function detectDoubleBottom(recent) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  if (recent.length < 15) return false;

  const firstHalf = recent.slice(0, 7);
  const secondHalf = recent.slice(8, 15);

  const firstLow = Math.min(...firstHalf.map((d) => n(d.low)));
  const secondLow = Math.min(...secondHalf.map((d) => n(d.low)));

  const lowsEqual = Math.abs(firstLow - secondLow) / firstLow < 0.02;
  const middlePeak = Math.max(...recent.slice(5, 10).map((d) => n(d.high)));
  const validPeak = middlePeak > firstLow * 1.03;

  const currentClose = n(recent[recent.length - 1].close);
  const breakout = currentClose > middlePeak;

  return lowsEqual && validPeak && breakout;
}

/* ───────────────── LATE ENTRY / OVEREXTENSION GUARD ───────────────── */

/* ───────────────── CONFIG (tunable) ───────────────── */
const LATE_GUARD = {
  // Pivot/breakout timing
  breakoutLookback: 15, // days to search for a pivot & breakout
  breakoutConfirmVolMult: 1.3, // close > pivot with >=1.3x avg10 volume
  maxDaysAfterBreakout: 3, // D0..D3 allowed; later requires pullback
  maxPctAbovePivot: 0.03, // >3% above pivot = likely chase (unless very fresh)

  // Extension limits (relaxed slightly vs initial)
  maxConsecutiveUpDays: 4, // was 3
  maxATRAboveMA25: 2.2, // was 1.6
  maxATRAboveMA50: 3.2, // was 2.2
  max5dGainPct: 14, // was 12

  // RSI / Bollinger
  hardRSI: 76, // was 74
  softRSI: 70,
  bbUpperCountForVeto: 2,

  // Climax day
  climaxVolMult: 2.5,
  climaxCloseFromHigh: 0.6, // close in lower 60% of bar range

  // Pullback allowances to re-enable entries after late move
  pullbackNearMA25Pct: 0.012, // within 1.2% of MA25
  pullbackATR: 1.0, // within 1 ATR of pivot
};

/* ─────────── Utility: rolling stats & helpers ─────────── */
function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + (+b || 0), 0) / arr.length : 0;
}
function n(v) {
  return Number.isFinite(v) ? v : 0;
}

function countConsecutiveUpDays(data, k = 8) {
  let c = 0;
  for (let i = data.length - 1; i > 0 && c < k; i--) {
    if (n(data[i].close) > n(data[i - 1].close)) c++;
    else break;
  }
  return c;
}

/* Find a recent pivot (highest high pre-breakout) and detect the breakout day */
function findPivotAndBreakout(recent) {
  if (recent.length < 12) return null;
  const window = recent.slice(-LATE_GUARD.breakoutLookback);
  if (window.length < 12) return null;

  const pre = window.slice(0, -2); // exclude last 2 bars when finding pivot
  const pivot = Math.max(...pre.map((d) => n(d.high)));
  const avgVol10 = avg(window.slice(-10).map((d) => n(d.volume)));

  let breakoutIdx = -1;
  for (let i = pre.length; i < window.length; i++) {
    const d = window[i];
    if (
      n(d.close) > pivot &&
      n(d.volume) >= avgVol10 * LATE_GUARD.breakoutConfirmVolMult
    ) {
      breakoutIdx = i;
      break;
    }
  }
  if (breakoutIdx === -1) return null;

  const daysSinceBreakout = window.length - 1 - breakoutIdx;
  return { pivot, daysSinceBreakout };
}

/* Lightweight anchored constraint & late-window logic */
function lateWindowVeto(stock, recent, pivotInfo) {
  if (!pivotInfo) return { veto: false };

  const curr = n(stock.currentPrice);
  // Floor ATR at 0.5% of price to avoid division blowups
  const atr = Math.max(n(stock.atr14), curr * 0.005);
  const ma25 = n(stock.movingAverage25d);

  const { pivot, daysSinceBreakout } = pivotInfo;
  const pctAbovePivot = pivot > 0 ? (curr - pivot) / pivot : 0;

  if (daysSinceBreakout > LATE_GUARD.maxDaysAfterBreakout) {
    const nearMA25 =
      ma25 > 0 &&
      Math.abs(curr - ma25) / ma25 <= LATE_GUARD.pullbackNearMA25Pct;
    const withinATRofPivot =
      Math.abs(curr - pivot) <= LATE_GUARD.pullbackATR * atr;
    if (!nearMA25 && !withinATRofPivot) {
      return {
        veto: true,
        reason: `Late after breakout (D+${daysSinceBreakout}) and not near MA25/pivot.`,
      };
    }
  }

  if (pctAbovePivot > LATE_GUARD.maxPctAbovePivot) {
    if (daysSinceBreakout > 1) {
      return {
        veto: true,
        reason: `Price ${(pctAbovePivot * 100).toFixed(
          1
        )}% above pivot – late breakout chase.`,
      };
    }
  }

  return { veto: false };
}

/* Extension / exhaustion checks */
function overboughtOverextendedVeto(stock, recent) {
  const curr = n(stock.currentPrice);
  const prev5 = recent[recent.length - 6]?.close;
  const gain5 = prev5 ? ((curr - n(prev5)) / n(prev5)) * 100 : 0;

  const rsi = n(stock.rsi14);
  const bbU = n(stock.bollingerUpper);
  const ma25 = n(stock.movingAverage25d);
  const ma50 = n(stock.movingAverage50d);
  const atr = Math.max(n(stock.atr14), curr * 0.005); // percent floor

  if (rsi >= LATE_GUARD.hardRSI) {
    return { veto: true, reason: `RSI ${rsi.toFixed(0)} is too hot.` };
  }
  const last2AboveBBU = recent
    .slice(-2)
    .every((d) => bbU > 0 && n(d.close) > bbU);
  if (rsi >= LATE_GUARD.softRSI && last2AboveBBU) {
    return {
      veto: true,
      reason: `Overbought (RSI ${rsi.toFixed(
        0
      )}) with repeated closes above upper band.`,
    };
  }

  if (ma25 > 0 && (curr - ma25) / atr > LATE_GUARD.maxATRAboveMA25) {
    return {
      veto: true,
      reason: `Too far above MA25 (${((curr - ma25) / atr).toFixed(1)} ATR).`,
    };
  }
  if (ma50 > 0 && (curr - ma50) / atr > LATE_GUARD.maxATRAboveMA50) {
    return {
      veto: true,
      reason: `Too far above MA50 (${((curr - ma50) / atr).toFixed(1)} ATR).`,
    };
  }

  if (gain5 > LATE_GUARD.max5dGainPct) {
    return {
      veto: true,
      reason: `+${gain5.toFixed(1)}% in 5 days – extended.`,
    };
  }

  const ups = countConsecutiveUpDays(recent, 8);
  if (ups > LATE_GUARD.maxConsecutiveUpDays) {
    return {
      veto: true,
      reason: `${ups} straight up days – late without a reset.`,
    };
  }

  return { veto: false };
}

/* Volume climax / blow-off day */
function climaxVeto(recent) {
  if (recent.length < 20) return { veto: false };
  const last = recent[recent.length - 1];
  const range = Math.max(0.01, n(last.high) - n(last.low));
  const closeFromHighPct = (n(last.high) - n(last.close)) / range; // 0 = close at high, 1 = at low

  const avgVol20 = avg(recent.slice(-20).map((d) => n(d.volume)));
  const isClimax =
    n(last.volume) >= avgVol20 * LATE_GUARD.climaxVolMult &&
    closeFromHighPct >= LATE_GUARD.climaxCloseFromHigh;

  if (isClimax) {
    return {
      veto: true,
      reason: `Volume climax with weak close – likely blow-off.`,
    };
  }
  return { veto: false };
}

/* Master guard */
function getEntryGuards(stock, sortedData, marketStructure, entryConditions) {
  const recent = sortedData.slice(-20);

  // If this is a legit pullback entry, bypass “late breakout” veto
  if (entryConditions?.pullbackToSupport && entryConditions?.bounceConfirmed) {
    const ext = overboughtOverextendedVeto(stock, recent);
    if (ext.veto) return { vetoed: true, reason: ext.reason };
    const clim = climaxVeto(sortedData.slice(-20));
    if (clim.veto) return { vetoed: true, reason: clim.reason };
    return { vetoed: false };
  }

  const pivotInfo = findPivotAndBreakout(
    sortedData.slice(-LATE_GUARD.breakoutLookback)
  );
  const late = lateWindowVeto(stock, recent, pivotInfo);
  if (late.veto) return { vetoed: true, reason: late.reason };

  const ext = overboughtOverextendedVeto(stock, recent);
  if (ext.veto) return { vetoed: true, reason: ext.reason };

  const clim = climaxVeto(sortedData.slice(-20));
  if (clim.veto) return { vetoed: true, reason: clim.reason };

  return { vetoed: false };
}
