// swingTradeEntryTiming.js
// Determines optimal swing trade entry points based on technicals only (no sentiment)

export function analyzeSwingTradeEntry(stock, historicalData, opts = {}) {
  if (!validateInputs(stock, historicalData)) {
    return {
      buyNow: false,
      reason: "Invalid or insufficient data for analysis",
    };
  }

  const analysis = {
    entryQuality: 0,
    technicalChecks: {},
    // allow manual overrides via opts (optional)
    stopLoss: Number.isFinite(opts.stopLoss) ? opts.stopLoss : null,
    priceTarget: Number.isFinite(opts.priceTarget) ? opts.priceTarget : null,
  };

  // Chronological candles
  const sortedData = [...historicalData].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );

  // Robust price-action (works pre-open/after-close)
  const nr = (v) => (Number.isFinite(v) ? v : 0);
  const lastBar = sortedData[sortedData.length - 1] || {};
  const pxNow = nr(stock.currentPrice) || nr(lastBar.close);
  const pxOpen = nr(stock.openPrice) || nr(lastBar.open);
  const prevClose = nr(stock.prevClosePrice) || nr(lastBar.close);
  const priceActionPositive =
    pxNow > Math.max(pxOpen, prevClose) || nr(lastBar.close) > nr(lastBar.open);

  // 1) Market Structure
  const marketStructure = analyzeMarketStructure(stock, sortedData);
  analysis.technicalChecks.marketStructure = marketStructure;

  // 2) Entry Conditions
  const entryConditions = checkEntryConditions(stock, sortedData);
  analysis.technicalChecks.entryConditions = entryConditions;

  // 3) Risk/Reward (with fallback stops/targets; opts can override)
  const riskReward = analyzeRiskReward(stock, marketStructure, {
    stopLoss: analysis.stopLoss,
    target: analysis.priceTarget,
  });
  analysis.technicalChecks.riskReward = riskReward;
  if (riskReward.adjustedStopLoss)
    analysis.stopLoss = riskReward.adjustedStopLoss;
  if (riskReward.reward > 0 && !analysis.priceTarget) {
    analysis.priceTarget = pxNow + riskReward.reward;
  }

  // 4) Timing
  const timingSignals = confirmEntryTiming(stock, sortedData, marketStructure);
  analysis.technicalChecks.timing = timingSignals;

  // 5) Volume/Momentum
  const volumeMomentum = validateVolumeMomentum(stock, sortedData);
  analysis.technicalChecks.volumeMomentum = volumeMomentum;

  // 6) Guard (late, extended, climax)
  const guard = getEntryGuards(
    stock,
    sortedData,
    marketStructure,
    entryConditions
  );
  if (guard.vetoed) return { buyNow: false, reason: guard.reason };

  // 7) Final Decision
  return makeFinalDecision(
    stock,
    analysis,
    entryConditions,
    timingSignals,
    riskReward,
    marketStructure,
    volumeMomentum,
    priceActionPositive
  );
}

/* ───────────────── Input Validation ───────────────── */
function validateInputs(stock, historicalData) {
  if (!stock || !historicalData) return false;
  if (!Array.isArray(historicalData) || historicalData.length < 20)
    return false;
  if (!stock.currentPrice || stock.currentPrice <= 0) return false;
  return true;
}

/* ───────────────── Market Structure ───────────────── */
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

  const ma5 = n(stock.movingAverage5d);
  const ma25 = n(stock.movingAverage25d);
  const ma50 = n(stock.movingAverage50d);
  const ma75 = n(stock.movingAverage75d);
  const ma200 = n(stock.movingAverage200d);

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

  let trendScore = 0;
  if (currentPrice > ma5 && ma5 > 0) trendScore++;
  if (currentPrice > ma25 && ma25 > 0) trendScore++;
  if (currentPrice > ma50 && ma50 > 0) trendScore++;
  if (currentPrice > ma200 && ma200 > 0) trendScore++;
  if (ma5 > ma25 && ma25 > 0) trendScore++;
  if (ma25 > ma50 && ma50 > 0) trendScore++;
  if (ma50 > ma200 && ma200 > 0) trendScore++;

  structure.trend =
    trendScore >= 6
      ? "STRONG_UP"
      : trendScore >= 4
      ? "UP"
      : trendScore >= 2
      ? "WEAK_UP"
      : "DOWN";

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
  structure.structureQuality = calculateStructureQuality(
    structure,
    historicalData
  );
  return structure;
}

/* ───────────────── Entry Conditions ───────────────── */
function checkEntryConditions(stock, historicalData) {
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

/* ───────────────── Risk/Reward ───────────────── */
function analyzeRiskReward(stock, marketStructure, overrides = {}) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const currentPrice = n(stock.currentPrice);
  const rawATR = n(stock.atr14);
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

  let stopLoss = Number.isFinite(overrides.stopLoss)
    ? overrides.stopLoss
    : null;
  let target = Number.isFinite(overrides.target) ? overrides.target : null;

  if (!stopLoss || !target) {
    const supports = marketStructure?.keyLevels?.supports || [];
    const resistances = marketStructure?.keyLevels?.resistances || [];
    if (!stopLoss)
      stopLoss = supports.length
        ? supports[0] - Math.max(0.3 * atr, currentPrice * 0.002)
        : currentPrice - 1.8 * atr;
    if (!target)
      target = resistances.length ? resistances[0] : currentPrice + 2.8 * atr;
  }

  if (
    !stopLoss ||
    !target ||
    stopLoss >= currentPrice ||
    target <= currentPrice
  )
    return analysis;

  if (atr > 0) {
    const minStopDistance = atr * 1.5;
    if (currentPrice - stopLoss < minStopDistance) {
      stopLoss = currentPrice - minStopDistance;
      analysis.adjustedStopLoss = stopLoss;
    }
  }

  analysis.risk = currentPrice - stopLoss;
  analysis.reward = target - currentPrice;
  analysis.ratio = analysis.reward / analysis.risk;

  analysis.multipleTargets = [
    { level: currentPrice + analysis.reward * 0.5, percentage: 33 },
    { level: currentPrice + analysis.reward * 0.75, percentage: 33 },
    { level: target, percentage: 34 },
  ];

  // Requirements not influenced by sentiment
  let requiredRatio = 1.6;
  if (marketStructure.trend === "STRONG_UP") requiredRatio = 1.2;
  else if (marketStructure.trend === "DOWN") requiredRatio = 2.3;

  const rsi = n(stock.rsi14);
  if (rsi > 65 && rsi < 75) requiredRatio += 0.2;

  if (analysis.ratio >= requiredRatio + 1) {
    analysis.quality = "EXCELLENT";
    analysis.acceptable = true;
  } else if (analysis.ratio >= requiredRatio) {
    analysis.quality = "GOOD";
    analysis.acceptable = true;
  } else if (
    analysis.ratio >= requiredRatio - 0.4 &&
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

/* ───────────────── Timing ───────────────── */
function confirmEntryTiming(stock, historicalData, marketStructure) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const signals = { intraday: {}, daily: {}, marketPhase: {}, score: 0 };
  if (historicalData.length < 5) return signals;

  const recent = historicalData.slice(-5);
  const lastDay = recent[recent.length - 1];
  const prevDay = recent[recent.length - 2];
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

  signals.daily = {
    higherLow: n(lastDay.low) > n(prevDay.low),
    higherClose: n(lastDay.close) > n(prevDay.close),
    trendContinuation: checkTrendContinuation(recent),
    aboveVWAP: n(stock.currentPrice) > calculateVWAP(lastDay),
  };

  signals.marketPhase = getMarketPhaseSignals(stock, lastDay);

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
  const openToHighRatio =
    n(lastDay.high) > n(lastDay.open)
      ? (n(lastDay.high) - n(lastDay.open)) / (n(lastDay.high) - n(lastDay.low))
      : 0;
  const closeToHighRatio =
    n(lastDay.high) > n(lastDay.low)
      ? (n(lastDay.close) - n(lastDay.low)) / (n(lastDay.high) - n(lastDay.low))
      : 0.5;

  return {
    favorable: openToHighRatio < 0.5 && closeToHighRatio > 0.7,
    accumulation: closeToHighRatio > 0.8,
    distribution: closeToHighRatio < 0.2,
  };
}

function calculateVWAP(dayData) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  return (n(dayData.high) + n(dayData.low) + n(dayData.close)) / 3;
}

/* ───────────────── Volume/Momentum ───────────────── */
// (unchanged functions below, but now fully technical-only)
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
  const volumeAnalysis = analyzeVolumeProfile(recent);
  validation.volumeProfile = volumeAnalysis.profile;

  const rsi = n(stock.rsi14);
  const macd = n(stock.macd);
  if (rsi > 60 && rsi < 70 && macd > 0) validation.momentumState = "STRONG";
  else if (rsi > 50 && rsi <= 60) validation.momentumState = "BUILDING";
  else if (rsi > 40 && rsi <= 50) validation.momentumState = "WEAK";
  else if (rsi <= 30) validation.momentumState = "OVERSOLD";
  else if (rsi >= 70) validation.momentumState = "OVERBOUGHT";

  validation.divergences = checkDivergences(stock, recent);

  const priceChange5d =
    recent.length >= 5
      ? ((n(recent[recent.length - 1].close) -
          n(recent[recent.length - 5].close)) /
          n(recent[recent.length - 5].close)) *
        100
      : 0;
  validation.relativeStrength = priceChange5d;

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
  if (recentVolume > avgVolume * 1.3 && upVolume > downVolume)
    profile = "ACCUMULATION";
  else if (recentVolume > avgVolume * 1.2) profile = "EXPANDING";
  else if (recentVolume < avgVolume * 0.7) profile = "CONTRACTING";
  else if (downVolume > upVolume * 1.5) profile = "DISTRIBUTION";
  return { profile, upVolume, downVolume, avgVolume };
}

/* ───────────────── Final Decision ───────────────── */
function makeFinalDecision(
  stock,
  analysis,
  entryConditions,
  timingSignals,
  riskReward,
  marketStructure,
  volumeMomentum,
  priceActionPositive
) {
  const weights = getAdaptiveWeights(marketStructure, volumeMomentum);
  const qualityScore =
    entryConditions.score * weights.entryConditions +
    timingSignals.score * weights.timing +
    (riskReward.acceptable ? 80 : 20) * weights.riskReward +
    marketStructure.structureQuality * weights.marketStructure +
    volumeMomentum.score * weights.volumeMomentum;
  analysis.entryQuality = Math.round(qualityScore);

  const qualityThreshold = getQualityThreshold(marketStructure);

  const mustHavesMet =
    riskReward.acceptable &&
    entryConditions.notOverextended &&
    entryConditions.notExhausted &&
    priceActionPositive;

  const pullbackBounce =
    entryConditions.pullbackToSupport && entryConditions.bounceConfirmed;
  const breakoutWithVolume =
    entryConditions.breakingResistance && entryConditions.volumeConfirmation;
  const patternWithTiming =
    entryConditions.patternComplete && timingSignals.score >= 50;

  const momentumEntry =
    entryConditions.momentumAligned &&
    entryConditions.notOverextended &&
    volumeMomentum.score >= 50 &&
    priceActionPositive &&
    (stock.currentPrice - (stock.openPrice || stock.currentPrice)) /
      (stock.openPrice || stock.currentPrice) >
      0.003;

  const idealSetup =
    entryConditions.pullbackToSupport &&
    entryConditions.bounceConfirmed &&
    (entryConditions.volumeConfirmation ||
      volumeMomentum.volumeProfile === "ACCUMULATION") &&
    entryConditions.momentumAligned;

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
    let buyReason = "";
    if (idealSetup) {
      buyReason = `IDEAL ENTRY: Pullback to support with bounce confirmed, strong volume (${
        volumeMomentum.volumeProfile
      }), and momentum aligned. Entry quality: ${
        analysis.entryQuality
      }%. R:R ${riskReward.ratio.toFixed(1)}:1.`;
    } else if (pullbackBounce) {
      buyReason = `PULLBACK ENTRY: Bounce from key support confirmed. Entry quality: ${
        analysis.entryQuality
      }%. R:R ${riskReward.ratio.toFixed(1)}:1.`;
    } else if (breakoutWithVolume) {
      buyReason = `BREAKOUT ENTRY: Resistance break with ${
        volumeMomentum.volumeProfile
      } volume. Entry quality: ${
        analysis.entryQuality
      }%. R:R ${riskReward.ratio.toFixed(1)}:1.`;
    } else if (patternWithTiming) {
      buyReason = `PATTERN ENTRY: Pattern completion with good timing (score ${
        timingSignals.score
      }). Entry quality: ${
        analysis.entryQuality
      }%. R:R ${riskReward.ratio.toFixed(1)}:1.`;
    } else if (momentumEntry) {
      buyReason = `MOMENTUM ENTRY: Momentum aligned (${
        volumeMomentum.momentumState
      }). Entry quality: ${
        analysis.entryQuality
      }%. R:R ${riskReward.ratio.toFixed(1)}:1.`;
    } else if (goodEnoughConditions) {
      buyReason = `TECHNICAL ENTRY: Solid setup in ${
        marketStructure.trend
      } trend. Today up ${(
        ((stock.currentPrice - (stock.openPrice || stock.currentPrice)) /
          (stock.openPrice || stock.currentPrice)) *
        100
      ).toFixed(2)}%. Entry quality: ${
        analysis.entryQuality
      }%. R:R ${riskReward.ratio.toFixed(1)}:1.`;
    }
    return { buyNow: true, reason: buyReason };
  }

  // Explain misses
  let waitReason = "";
  if (!priceActionPositive) {
    const openPx = stock.openPrice || stock.currentPrice;
    const pct = openPx
      ? ((((stock.currentPrice || openPx) - openPx) / openPx) * 100).toFixed(2)
      : "0.00";
    waitReason = `Stock is down ${pct}% today. No entry on red days—wait for bullish price action.`;
  } else if (!mustHavesMet) {
    if (!riskReward.acceptable) {
      waitReason = `Risk/Reward not favorable (${riskReward.ratio.toFixed(
        1
      )}:1, need ${(marketStructure.trend === "STRONG_UP" ? 1.5 : 2.0).toFixed(
        1
      )}:1+).`;
    } else if (!entryConditions.notOverextended) {
      const rsi = Number(stock?.rsi14) || 0;
      const bbUpper = Number(stock?.bollingerUpper) || 0;
      if (rsi > 70)
        waitReason = `RSI overbought at ${rsi.toFixed(0)}—wait for a cool-off.`;
      else if (bbUpper > 0 && stock.currentPrice > bbUpper)
        waitReason = `Above upper Bollinger Band—wait for pullback into bands.`;
      else waitReason = `Extended from MAs—wait for pullback to MA25/MA50.`;
    } else if (!entryConditions.notExhausted) {
      waitReason = `Exhaustion signals present (${volumeMomentum.volumeProfile} volume, momentum ${volumeMomentum.momentumState}). Wait for consolidation.`;
    }
  } else if (!hasStrongSignal) {
    if (!entryConditions.pullbackToSupport)
      waitReason =
        "No pullback to support yet—wait for MA25/MA50 or key support test.";
    else if (!entryConditions.bounceConfirmed)
      waitReason =
        "At support but bounce not confirmed—wait for a bullish reversal candle with volume.";
    else if (!entryConditions.volumeConfirmation)
      waitReason = `Volume pattern is ${volumeMomentum.volumeProfile}—wait for accumulation.`;
    else
      waitReason =
        "No clear trigger—wait for pullback, breakout, or pattern completion.";
  } else {
    waitReason = `Entry quality too low (${analysis.entryQuality}%, need ${qualityThreshold}%+).`;
  }

  if (marketStructure.trend === "DOWN")
    waitReason += " Note: Overall trend is bearish (counter-trend).";
  else if (marketStructure.trend === "WEAK_UP")
    waitReason += " Note: Uptrend is weak—be selective.";

  return { buyNow: false, reason: waitReason };
}

/* ───────────────── Helpers (mostly unchanged) ───────────────── */
function getAdaptiveWeights(marketStructure, volumeMomentum) {
  const w = {
    entryConditions: 0.35,
    timing: 0.2,
    riskReward: 0.15,
    marketStructure: 0.15,
    volumeMomentum: 0.15,
  };
  if (marketStructure.trend === "STRONG_UP") {
    w.timing = 0.15;
    w.marketStructure = 0.2;
  }
  if (volumeMomentum.volumeProfile === "DISTRIBUTION") {
    w.volumeMomentum = 0.25;
    w.timing = 0.15;
  }
  return w;
}

function getQualityThreshold(marketStructure) {
  let t = 70;
  if (marketStructure.trend === "STRONG_UP") t -= 5;
  else if (marketStructure.trend === "DOWN") t += 10;
  return Math.max(60, t);
}

function findEnhancedSupportLevels(historicalData, currentPrice, stock) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const supports = [];
  if (historicalData.length < 50) return supports;
  const recent50 = historicalData.slice(-50);

  for (let i = 2; i < recent50.length - 2; i++) {
    const isSwingLow =
      n(recent50[i].low) < n(recent50[i - 1].low) &&
      n(recent50[i].low) < n(recent50[i - 2].low) &&
      n(recent50[i].low) < n(recent50[i + 1].low) &&
      n(recent50[i].low) < n(recent50[i + 2].low);
    if (isSwingLow && n(recent50[i].low) < currentPrice)
      supports.push(n(recent50[i].low));
  }

  [stock.movingAverage50d, stock.movingAverage200d].forEach((ma) => {
    if (n(ma) > 0 && n(ma) < currentPrice) supports.push(n(ma));
  });

  const roundLevel = Math.floor(currentPrice / 100) * 100;
  if (roundLevel < currentPrice && roundLevel > currentPrice * 0.9)
    supports.push(roundLevel);

  const prevDayLow = n(stock.lowPrice);
  if (prevDayLow < currentPrice) supports.push(prevDayLow);

  return [...new Set(supports)].sort((a, b) => b - a);
}

function findEnhancedResistanceLevels(historicalData, currentPrice, stock) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const resistances = [];
  if (historicalData.length < 50) return resistances;
  const recent50 = historicalData.slice(-50);

  for (let i = 2; i < recent50.length - 2; i++) {
    const isSwingHigh =
      n(recent50[i].high) > n(recent50[i - 1].high) &&
      n(recent50[i].high) > n(recent50[i - 2].high) &&
      n(recent50[i].high) > n(recent50[i + 1].high) &&
      n(recent50[i].high) > n(recent50[i + 2].high);
    if (isSwingHigh && n(recent50[i].high) > currentPrice)
      resistances.push(n(recent50[i].high));
  }

  const yearHigh = n(stock.fiftyTwoWeekHigh);
  if (yearHigh > currentPrice) resistances.push(yearHigh);

  const roundLevel = Math.ceil(currentPrice / 100) * 100;
  if (roundLevel > currentPrice && roundLevel < currentPrice * 1.1)
    resistances.push(roundLevel);

  const prevDayHigh = n(stock.highPrice);
  if (prevDayHigh > currentPrice) resistances.push(prevDayHigh);

  return [...new Set(resistances)].sort((a, b) => a - b);
}

function calculateStructureQuality(structure, historicalData) {
  let q = 50;
  if (structure.trend === "STRONG_UP") q += 30;
  else if (structure.trend === "UP") q += 20;
  else if (structure.trend === "WEAK_UP") q += 10;
  else if (structure.trend === "DOWN") q -= 20;

  if (structure.pricePosition.nearSupport) q += 20;
  else if (structure.pricePosition.nearResistance) q -= 10;
  else if (structure.pricePosition.inMiddle) q += 5;

  if (structure.keyLevels.supports.length >= 2) q += 10;
  if (structure.keyLevels.resistances.length >= 2) q += 10;

  if (
    structure.keyLevels.ma5 > structure.keyLevels.ma25 &&
    structure.keyLevels.ma25 > structure.keyLevels.ma50
  )
    q += 10;

  return Math.min(100, Math.max(0, q));
}

function checkTrendContinuation(recent) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  if (recent.length < 5) return false;
  let higherHighs = 0,
    higherLows = 0;
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
    if (priceChange > 5 && rsi < 60)
      divergences.push({ type: "bearish", strength: "moderate" });
    else if (priceChange > 10 && rsi < 65)
      divergences.push({ type: "bearish", strength: "strong" });
    if (priceChange < -5 && rsi > 40)
      divergences.push({ type: "bullish", strength: "moderate" });
    else if (priceChange < -10 && rsi > 35)
      divergences.push({ type: "bullish", strength: "strong" });
  }

  const macd = n(stock.macd);
  if (priceTwoWeeksAgo && priceTwoWeeksAgo > 0) {
    const longerPriceChange =
      ((currentPrice - priceTwoWeeksAgo) / priceTwoWeeksAgo) * 100;
    if (longerPriceChange > 10 && macd < 0)
      divergences.push({ type: "bearish", indicator: "MACD" });
    else if (longerPriceChange < -10 && macd > 0)
      divergences.push({ type: "bullish", indicator: "MACD" });
  }
  return divergences;
}

function checkResistanceBreakout(stock, recent, currentPrice) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const resistanceWindow = recent.slice(-12, -2);
  if (resistanceWindow.length < 8) return false;
  const resistance = Math.max(...resistanceWindow.map((d) => n(d.high)));
  const lastDay = recent[recent.length - 1];
  const avgVolume =
    recent.slice(-10).reduce((sum, d) => sum + n(d.volume), 0) / 10;

  const todayBreakout =
    currentPrice > resistance * 1.01 && n(stock.openPrice) < resistance * 1.02;
  const breakoutConfirmed =
    todayBreakout &&
    currentPrice > n(stock.openPrice) &&
    n(lastDay.volume) > avgVolume * 1.3 &&
    n(lastDay.close) > resistance;

  return breakoutConfirmed;
}

function checkPatternCompletion(recent) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  if (recent.length < 10) return false;
  return (
    detectBullFlag(recent) ||
    detectAscendingTriangle(recent) ||
    detectInverseHeadShoulders(recent) ||
    detectDoubleBottom(recent)
  );
}

/* ───────────────── Pattern Detectors ───────────────── */
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
  const poleVolume = firstHalf.reduce((s, d) => s + n(d.volume), 0) / 5;
  const flagVolume = secondHalf.reduce((s, d) => s + n(d.volume), 0) / 5;
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
    )
      highs.push(n(recent[i].high));
    if (
      n(recent[i].low) < n(recent[i - 1].low) &&
      n(recent[i].low) < n(recent[i + 1].low)
    )
      lows.push(n(recent[i].low));
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
  const currentClose = n(recent[recent.length - 1].close);
  const breakout = currentClose > middlePeak;
  return lowsEqual && currentClose > middlePeak && middlePeak > firstLow * 1.03;
}

/* ───────────────── LATE/OVEREXTENSION GUARD ───────────────── */
const LATE_GUARD = {
  breakoutLookback: 15,
  breakoutConfirmVolMult: 1.3,
  maxDaysAfterBreakout: 4, // was 3
  maxPctAbovePivot: 0.05, // was 0.03

  maxConsecutiveUpDays: 5, // was 4
  maxATRAboveMA25: 2.6, // was 2.2
  maxATRAboveMA50: 3.6, // was 3.2
  max5dGainPct: 16, // was 14

  hardRSI: 77, // was 76
  softRSI: 70,
  bbUpperCountForVeto: 2,

  climaxVolMult: 2.5,
  climaxCloseFromHigh: 0.6,

  pullbackNearMA25Pct: 0.012,
  pullbackATR: 1.0,
};

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

function findPivotAndBreakout(recent) {
  if (recent.length < 12) return null;
  const window = recent.slice(-LATE_GUARD.breakoutLookback);
  if (window.length < 12) return null;

  const pre = window.slice(0, -2);
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

function lateWindowVeto(stock, recent, pivotInfo) {
  if (!pivotInfo) return { veto: false };
  const curr = n(stock.currentPrice);
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

  if (pctAbovePivot > LATE_GUARD.maxPctAbovePivot && daysSinceBreakout > 1) {
    return {
      veto: true,
      reason: `Price ${(pctAbovePivot * 100).toFixed(
        1
      )}% above pivot – late breakout chase.`,
    };
  }
  return { veto: false };
}

function overboughtOverextendedVeto(stock, recent) {
  const curr = n(stock.currentPrice);
  const prev5 = recent[recent.length - 6]?.close;
  const gain5 = prev5 ? ((curr - n(prev5)) / n(prev5)) * 100 : 0;

  const rsi = n(stock.rsi14);
  const bbU = n(stock.bollingerUpper);
  const ma25 = n(stock.movingAverage25d);
  const ma50 = n(stock.movingAverage50d);
  const atr = Math.max(n(stock.atr14), curr * 0.005);

  if (rsi >= LATE_GUARD.hardRSI)
    return { veto: true, reason: `RSI ${rsi.toFixed(0)} is too hot.` };

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

function climaxVeto(recent) {
  if (recent.length < 20) return { veto: false };
  const last = recent[recent.length - 1];
  const range = Math.max(0.01, n(last.high) - n(last.low));
  const closeFromHighPct = (n(last.high) - n(last.close)) / range;
  const avgVol20 = avg(recent.slice(-20).map((d) => n(d.volume)));
  const isClimax =
    n(last.volume) >= avgVol20 * LATE_GUARD.climaxVolMult &&
    closeFromHighPct >= LATE_GUARD.climaxCloseFromHigh;
  return isClimax
    ? { veto: true, reason: `Volume climax with weak close – likely blow-off.` }
    : { veto: false };
}

function getEntryGuards(stock, sortedData, marketStructure, entryConditions) {
  const recent = sortedData.slice(-20);

  // Bypass late-breakout veto for legit pullbacks and completed patterns
  if (
    (entryConditions?.pullbackToSupport && entryConditions?.bounceConfirmed) ||
    entryConditions?.patternComplete
  ) {
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
