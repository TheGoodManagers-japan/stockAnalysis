// buyNow.js
// Finalized "Buy Now" module with dedupe + RR gate (uses entryAnalysis levels only)

export const defaultConfig = Object.freeze({
  buyThreshold: 5.0, // points needed to say "Buy Now"
  minRR: 2.0, // optional overall min R:R gate

  // --- scoring buckets (same semantics as your earlier version)
  scores: {
    trendReversal: 5,
    resistanceBreak: 4,
    volatilitySqueeze: 4,
    pullbackEntry: 3,
    bullishEngulfing: 3,
    hammerCandle: 3,
    consolidationBreakout: 4,
    entryTimingScore: 6,
    confirmedBounce: 4,
  },

  // --- params used by checkers
  volume: {
    confirmationMultiplier: 1.5,
    exhaustionMultiplier: 2.5,
  },
  rsi: {
    overbought: 70,
    moderatelyOverbought: 65,
    oversold: 30,
    hardOverbought: 80,
  },
  squeeze: {
    bandWidthThreshold: 0.05,
  },
  pullback: {
    proximityPercent: 0.02,
    minRetracePercent: 0.03,
    maxRetracePercent: 0.15,
  },
  hammer: {
    bodyToRangeRatio: 0.1,
    wickToBodyRatio: 2,
  },
  consolidation: {
    period: 5,
    volumeMultiplier: 1.5,
  },
  parabolic: {
    consecutiveGreenDays: 5,
    distanceFromMA50: 0.1,
    distanceFromMA200: 0.2,
    shortTermGainThreshold: 0.15,
  },
  momentum: {
    minDaysForReversal: 2,
    volumeIncreaseForReversal: 1.3,
  },
  veto: {
    catastrophicDropPercent: -8.0,
    resistanceZoneBuffer: 0.03,
    resistanceBypassVolumeMultiplier: 3.0,
    resistanceBypassRsi: 75,
    choppyRegimeConfidenceThreshold: 0.3,
    momentumBypass: {
      minDistanceFromMA50: 0.02,
      minDistanceFromMA200: 0.0,
      minGreenDays: 3,
    },
  },
});

/* ========================================================================== */
/* PUBLIC API                                                                 */
/* ========================================================================== */

export function getBuyTrigger(stock, historicalData, entryAnalysis = null) {
  const config = defaultConfig;

  if (!historicalData || historicalData.length < 50) {
    return {
      isBuyNow: false,
      reason: "Insufficient historical data for a reliable analysis.",
      rr: null,
    };
  }

  // Pre-open safe: last completed bar
  const today = historicalData[historicalData.length - 1];
  const yesterday = historicalData[historicalData.length - 2];

  // ---- Use levels from entryAnalysis ONLY to compute R:R (no re-analysis)
  const price = Number(stock?.currentPrice) || today.close;
  const haveSL = Number.isFinite(entryAnalysis?.stopLoss);
  const havePT = Number.isFinite(entryAnalysis?.priceTarget);
  const rr =
    haveSL && havePT
      ? (entryAnalysis.priceTarget - price) /
        Math.max(1e-6, price - entryAnalysis.stopLoss)
      : null;

  // ---- Context (helpers are pre-open safe)
  const avgVolume10 = rollingAvgVolume(historicalData, 10);
  const avgVolume20 = rollingAvgVolume(historicalData, 20);
  const avgVolume50 = rollingAvgVolume(historicalData, 50);

  const context = {
    today,
    yesterday,
    avgVolume10,
    avgVolume20,
    avgVolume50,
    historicalData,
    stock,
    entryAnalysis,
    atr14: Number(stock?.atr14) || calcATR14(historicalData),
    recentPerformance: calculateRecentPerformance(historicalData),
    marketStructure: analyzeMarketStructure(stock, historicalData),
  };
  context.keyLevels = calculateKeyLevels(stock, historicalData);

  // ---- Signals (don’t duplicate what entryTiming already did; just consume it)
  const signalChecks = [
    checkTrendReversal,
    checkResistanceBreak,
    checkVolatilitySqueeze,
    checkEnhancedPullbackEntry,
    checkBullishEngulfing,
    checkHammerCandle,
    checkConsolidationBreakout,
    checkConfirmedBounce,
    checkEntryTimingScore, // consumes entryAnalysis.score (1..4 supportive)
  ];

  const detectedSignals = signalChecks
    .map((fn) => fn(stock, context, config))
    .filter((s) => s && s.detected)
    .map((s) => ({ ...s, __cat: categorizeSignalName(s.name) }));

  // ---- DEDUPLICATION: down-weight overlaps vs strong entryTiming & cap per-category stacking
  const dedupedSignals = applyDedupe(detectedSignals, entryAnalysis);
  const totalScore = dedupedSignals.reduce((sum, s) => sum + s.score, 0);

  // ---- Veto checks (kept as before)
  const vetoChecks = [
    checkRsiOverbought,
    checkCatastrophicDrop,
    checkSupportBreak,
    checkMajorResistance,
    checkChoppyRegime,
    checkParabolicMove,
    checkExhaustedTrend,
    checkFalseBreakout,
    checkWeakBounce,
  ];
  const vetoResults = vetoChecks
    .map((fn) => fn(stock, context, config))
    .filter((v) => v.isVetoed);

  if (vetoResults.length > 0) {
    const signalText = dedupedSignals.length
      ? `Patterns found (${dedupedSignals
          .map((s) => s.name)
          .join(" | ")}), but signal`
      : "Signal";
    return {
      isBuyNow: false,
      reason: `${signalText} vetoed: ${vetoResults
        .map((v) => v.reason)
        .join(" & ")}`,
      rr,
    };
  }

  // ---- Optional R:R gate using entryAnalysis levels (no level outputs)
  const minRR = config.minRR ?? 2.0;
  if (rr != null && rr < minRR) {
    return {
      isBuyNow: false,
      reason: `R:R ${rr.toFixed(2)} < ${minRR.toFixed(1)}: not attractive`,
      rr,
    };
  }

  if (totalScore >= config.buyThreshold) {
    const insight = entryAnalysis?.keyInsights?.[0]
      ? ` | ${entryAnalysis.keyInsights[0]}`
      : "";
    return {
      isBuyNow: true,
      reason: `Buy Trigger (${totalScore.toFixed(1)} pts): ${dedupedSignals
        .map((s) => s.name)
        .join(" | ")}${insight}`,
      rr,
    };
  }

  return {
    isBuyNow: false,
    reason: `No trigger: Score ${totalScore.toFixed(1)} < threshold ${
      config.buyThreshold
    }.`,
    rr,
  };
}

/* ========================================================================== */
/* DEDUPE HELPERS                                                             */
/* ========================================================================== */

function categorizeSignalName(name = "") {
  const n = String(name).toLowerCase();
  if (n.includes("entry score")) return "entry";
  if (n.includes("trend reversal")) return "trend";
  if (n.includes("squeeze")) return "trend";
  if (n.includes("consolidation breakout")) return "trend";
  if (
    n.startsWith("broke resistance") ||
    n.includes("retest") ||
    n.includes("bounce")
  )
    return "level";
  if (n.includes("pullback")) return "pullback";
  if (n.includes("engulfing") || n.includes("hammer")) return "candlestick";
  return "other";
}

function buildDedupeWeights(entryAnalysis) {
  const w = {
    trend: 1,
    level: 1,
    pullback: 1,
    candlestick: 1,
    entry: 1,
    other: 1,
  };
  if (!entryAnalysis || !Number.isFinite(entryAnalysis.score)) return w;

  const score = entryAnalysis.score; // 1..7 (1 best)
  const conf = Math.max(0, Math.min(1, entryAnalysis.confidence ?? 0.5));
  const lerp = (a, b, t) => a + (b - a) * t;

  if (score <= 2) {
    w.trend = lerp(0.6, 0.4, conf);
    w.level = lerp(0.7, 0.5, conf);
    w.pullback = lerp(0.7, 0.5, conf);
    w.candlestick = lerp(0.5, 0.3, conf);
  } else if (score === 3) {
    w.trend = 0.85;
    w.level = 0.85;
    w.pullback = 0.85;
    w.candlestick = 0.6;
  } else if (score === 4) {
    w.trend = 0.95;
    w.level = 0.95;
    w.pullback = 0.95;
    w.candlestick = 0.7;
  }
  return w;
}

function categoryCaps() {
  return {
    entry: Infinity, // Let EntryTiming stand on its own
    trend: 4.5,
    level: 4.0,
    pullback: 3.0,
    candlestick: 2.5,
    other: 3.0,
  };
}

function applyDedupe(signals, entryAnalysis) {
  if (!signals?.length) return [];

  const weights = buildDedupeWeights(entryAnalysis);
  const caps = categoryCaps();

  const weighted = signals.map((s) => {
    const cat = s.__cat || "other";
    return { ...s, score: s.score * (weights[cat] ?? 1) };
  });

  const byCat = weighted.reduce((m, s) => {
    (m[s.__cat || "other"] ||= []).push(s);
    return m;
  }, {});

  const adjusted = [];
  for (const [cat, arr] of Object.entries(byCat)) {
    const cap = caps[cat] ?? 3.0;
    const sum = arr.reduce((a, b) => a + b.score, 0);
    if (sum > cap && cap !== Infinity) {
      const scale = cap / sum;
      arr.forEach((s) => adjusted.push({ ...s, score: s.score * scale }));
    } else {
      adjusted.push(...arr);
    }
  }

  return adjusted.map(({ __cat, ...rest }) => rest);
}

/* ========================================================================== */
/* SIGNAL CHECKERS (pre-open safe)                                            */
/* ========================================================================== */

function checkTrendReversal(stock, context, config) {
  const { today, yesterday, avgVolume20 } = context;
  const { macd, macdSignal, movingAverage25d, movingAverage75d } = stock;

  const hasData =
    Number.isFinite(movingAverage75d) &&
    Number.isFinite(movingAverage25d) &&
    Number.isFinite(macd) &&
    Number.isFinite(macdSignal);
  if (!hasData) return { detected: false };

  const priceTrigger =
    today.close > movingAverage75d && yesterday.close <= movingAverage75d;
  if (!priceTrigger) return { detected: false };

  const trendTrigger = movingAverage25d > movingAverage75d;
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
  const { today, yesterday, keyLevels, avgVolume20, atr14 } = context;
  const immediateResistance = keyLevels.resistances.find(
    (r) => r > yesterday.close
  );
  if (!Number.isFinite(immediateResistance)) return { detected: false };

  const within = atr14
    ? immediateResistance - yesterday.close <= 3 * atr14
    : true;
  if (!within) return { detected: false };

  const priceBroke =
    yesterday.close < immediateResistance && today.close > immediateResistance;
  if (!priceBroke) return { detected: false };

  const volumeConfirms =
    today.volume > avgVolume20 * config.volume.confirmationMultiplier;
  const name = `Broke Resistance${volumeConfirms ? " on high volume" : ""}`;
  return { detected: true, name, score: config.scores.resistanceBreak };
}

function checkVolatilitySqueeze(stock, context, config) {
  const { bollingerUpper, bollingerLower, bollingerMid, currentPrice } = stock;
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

function checkEnhancedPullbackEntry(stock, context, config) {
  const { movingAverage25d, movingAverage50d, movingAverage75d, currentPrice } =
    stock;
  const { recentPerformance } = context;

  if (!movingAverage25d || !movingAverage75d) return { detected: false };

  const isInUptrend =
    currentPrice > movingAverage75d && movingAverage25d > movingAverage75d;
  if (!isInUptrend) return { detected: false };

  const pullbackFromHigh = recentPerformance.currentDrawdown;
  if (
    pullbackFromHigh < config.pullback.minRetracePercent ||
    pullbackFromHigh > config.pullback.maxRetracePercent
  )
    return { detected: false };

  const nearMA25 =
    Math.abs(currentPrice - movingAverage25d) / movingAverage25d <
    config.pullback.proximityPercent;
  const nearMA50 =
    movingAverage50d &&
    Math.abs(currentPrice - movingAverage50d) / movingAverage50d <
      config.pullback.proximityPercent;
  if (!nearMA25 && !nearMA50) return { detected: false };

  const { today, yesterday } = context;
  const showingBounce = today.close > today.open && today.low > yesterday.low;
  if (!showingBounce) return { detected: false };

  return {
    detected: true,
    name: `Confirmed Pullback to ${nearMA25 ? "25" : "50"}-day MA`,
    score: config.scores.pullbackEntry,
  };
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
  const { today, avgVolume10, historicalData } = context;
  const period = config.consolidation.period;
  if (!Array.isArray(historicalData) || historicalData.length < period + 1)
    return { detected: false };

  const consolidationPeriod = historicalData.slice(-(period + 1), -1);
  const consolidationHigh = Math.max(...consolidationPeriod.map((d) => d.high));
  const isBreakout = today.close > consolidationHigh;
  const isVolumeConfirmed =
    today.volume > avgVolume10 * config.consolidation.volumeMultiplier;

  if (isBreakout && isVolumeConfirmed) {
    return {
      detected: true,
      name: "Consolidation Breakout",
      score: config.scores.consolidationBreakout,
    };
  }
  return { detected: false };
}

function checkConfirmedBounce(stock, context, config) {
  const { today, yesterday, keyLevels, avgVolume20, historicalData, atr14 } =
    context;
  if (!Array.isArray(historicalData) || historicalData.length < 3)
    return { detected: false };

  const twoDaysAgo = historicalData[historicalData.length - 3];

  const windowBelow = atr14 ? 2.5 * atr14 : Infinity;
  const nearestSupport = keyLevels.supports.find(
    (s) =>
      s < today.close &&
      today.close - s <= windowBelow &&
      (yesterday.low <= s * 1.01 || twoDaysAgo.low <= s * 1.01)
  );
  if (!Number.isFinite(nearestSupport)) return { detected: false };

  const bounceConfirmed =
    today.close > yesterday.close &&
    today.close > today.open &&
    today.volume > avgVolume20 * config.momentum.volumeIncreaseForReversal;

  if (bounceConfirmed) {
    return {
      detected: true,
      name: "Confirmed Bounce off Support",
      score: config.scores.confirmedBounce,
    };
  }
  return { detected: false };
}

function checkEntryTimingScore(stock, context, config) {
  const { entryAnalysis } = context;
  if (!entryAnalysis || entryAnalysis.score == null) return { detected: false };
  if (entryAnalysis.score > 4) return { detected: false }; // only 1..4 are supportive

  const base = config.scores.entryTimingScore;
  const conf = Number.isFinite(entryAnalysis.confidence)
    ? entryAnalysis.confidence
    : 0.5;
  const tierBoost =
    { 1: 1.3, 2: 1.15, 3: 1.0, 4: 0.85 }[entryAnalysis.score] || 0.8;
  const score = Math.max(1.0, base * tierBoost * (0.8 + 0.4 * conf));

  const name =
    [
      "Strong Entry Score",
      "Good Entry Score",
      "OK Entry Score",
      "Cautious Entry Score",
    ][entryAnalysis.score - 1] || "Entry Score";

  return { detected: true, name, score: Math.round(score * 10) / 10 };
}

/* ========================================================================== */
/* VETO CHECKERS                                                              */
/* ========================================================================== */

function checkRsiOverbought(stock, context, config) {
  const rsi = stock.rsi14;
  if (!Number.isFinite(rsi)) return { isVetoed: false };

  if (rsi >= (config.rsi.hardOverbought || 80)) {
    return {
      isVetoed: true,
      reason: `RSI extremely overbought (${rsi.toFixed(0)})`,
    };
  }

  if (rsi > config.rsi.overbought) {
    const ms = context.marketStructure;
    const rp = context.recentPerformance;
    const b = config.veto.momentumBypass || {};
    const momentumBypass =
      ms.distanceFromMA50 > (b.minDistanceFromMA50 ?? 0.02) &&
      ms.distanceFromMA200 > (b.minDistanceFromMA200 ?? 0.0) &&
      rp.consecutiveGreenDays >= (b.minGreenDays ?? 3) &&
      context.today.close >= context.yesterday.close;

    if (momentumBypass) return { isVetoed: false };
    return {
      isVetoed: true,
      reason: `RSI overbought without momentum confirmation (${rsi.toFixed(
        0
      )})`,
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
  if (Number.isFinite(ma50) && today.close < ma50 && yesterday.close > ma50) {
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

function checkChoppyRegime(stock, context, config) {
  const { entryAnalysis } = context;
  if (!entryAnalysis) return { isVetoed: false };

  if (
    entryAnalysis.shortTermRegime === "CHOPPY" &&
    entryAnalysis.confidence < config.veto.choppyRegimeConfidenceThreshold
  ) {
    return {
      isVetoed: true,
      reason: `Choppy market regime with low confidence (${Math.round(
        (entryAnalysis.confidence || 0) * 100
      )}%)`,
    };
  }

  if (
    entryAnalysis.longTermRegime === "BEARISH" &&
    entryAnalysis.shortTermRegime === "BEARISH" &&
    entryAnalysis.score >= 5
  ) {
    return {
      isVetoed: true,
      reason: "Both short and long-term regimes are bearish",
    };
  }
  return { isVetoed: false };
}

function checkParabolicMove(stock, context, config) {
  const { recentPerformance, marketStructure } = context;
  const { rsi14 } = stock;

  const conditions = [];
  if (
    recentPerformance.consecutiveGreenDays >=
    config.parabolic.consecutiveGreenDays
  )
    conditions.push(
      `${recentPerformance.consecutiveGreenDays} consecutive green days`
    );
  if (marketStructure.distanceFromMA50 > config.parabolic.distanceFromMA50)
    conditions.push(
      `${(marketStructure.distanceFromMA50 * 100).toFixed(1)}% above MA50`
    );
  if (marketStructure.distanceFromMA200 > config.parabolic.distanceFromMA200)
    conditions.push(
      `${(marketStructure.distanceFromMA200 * 100).toFixed(1)}% above MA200`
    );
  if (recentPerformance.gain5d > config.parabolic.shortTermGainThreshold)
    conditions.push(
      `${(recentPerformance.gain5d * 100).toFixed(1)}% gain in 5 days`
    );
  if (
    Number.isFinite(rsi14) &&
    rsi14 > config.rsi.moderatelyOverbought &&
    marketStructure.distanceFrom52wHigh < 0.02
  )
    conditions.push("RSI overbought near 52w high");

  if (conditions.length >= 2) {
    return {
      isVetoed: true,
      reason: `Parabolic/overextended: ${conditions.join(", ")}`,
    };
  }
  return { isVetoed: false };
}

function checkExhaustedTrend(stock, context, config) {
  const { today, avgVolume20, recentPerformance, marketStructure } = context;
  const { rsi14 } = stock;

  const highVolumeNoProgress =
    today.volume > avgVolume20 * config.volume.exhaustionMultiplier &&
    today.close <= today.open &&
    recentPerformance.daysFromHigh <= 2;

  const repeatedRejection =
    recentPerformance.daysFromHigh > 0 &&
    recentPerformance.daysFromHigh < 5 &&
    today.high < context.yesterday.high;

  const decliningMomentum =
    Number.isFinite(rsi14) &&
    rsi14 < 50 &&
    marketStructure.distanceFromMA50 > 0.05;

  if (highVolumeNoProgress || (repeatedRejection && decliningMomentum)) {
    return { isVetoed: true, reason: "Trend showing exhaustion signs" };
  }
  return { isVetoed: false };
}

function checkFalseBreakout(stock, context, config) {
  const { today, yesterday, keyLevels, historicalData } = context;
  if (!Array.isArray(historicalData) || historicalData.length < 3)
    return { isVetoed: false };

  const twoDaysAgo = historicalData[historicalData.length - 3];

  const brokeResistanceYesterday = keyLevels.resistances.some(
    (r) => yesterday.close > r && twoDaysAgo.close < r
  );

  if (brokeResistanceYesterday) {
    const failingToday =
      today.close < yesterday.close &&
      today.close < today.open &&
      today.high < yesterday.high;

    if (failingToday) {
      return {
        isVetoed: true,
        reason: "Potential false breakout - failing to hold above resistance",
      };
    }
  }
  return { isVetoed: false };
}

function checkWeakBounce(stock, context, config) {
  const { today, yesterday, avgVolume20, recentPerformance, marketStructure } =
    context;

  const inDowntrend =
    marketStructure.distanceFromMA50 < -0.05 ||
    recentPerformance.gain10d < -0.1;
  if (!inDowntrend) return { isVetoed: false };

  const weakVolume = today.volume < avgVolume20 * 0.8;
  const smallBodyCandle =
    Math.abs(today.close - today.open) < (today.high - today.low) * 0.3;
  const failingAtResistance =
    today.high > yesterday.high && today.close < yesterday.high;

  if (weakVolume && (smallBodyCandle || failingAtResistance)) {
    return {
      isVetoed: true,
      reason: "Weak bounce in downtrend - low conviction",
    };
  }
  return { isVetoed: false };
}

/* ========================================================================== */
/* UTILS (shared helpers; pre-open safe)                                      */
/* ========================================================================== */

function meanSafe(nums) {
  const arr = nums.filter((x) => Number.isFinite(x));
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

// Excludes last completed bar from the average (pre-open safe)
function rollingAvgVolume(hd, n) {
  if (!Array.isArray(hd) || hd.length < 2) return 0;
  const end = hd.length - 1;
  const start = Math.max(0, end - n);
  const slice = hd.slice(start, end);
  return meanSafe(slice.map((d) => d?.volume ?? 0));
}

function calcATR14(hd) {
  if (!Array.isArray(hd) || hd.length < 15) return 0;
  const trs = [];
  for (let i = hd.length - 14; i < hd.length; i++) {
    const cur = hd[i],
      prev = hd[i - 1];
    if (!cur || !prev) continue;
    trs.push(
      Math.max(
        cur.high - cur.low,
        Math.abs(cur.high - prev.close),
        Math.abs(cur.low - prev.close)
      )
    );
  }
  return meanSafe(trs);
}

function calculateRecentPerformance(historicalData) {
  if (historicalData.length < 20)
    return {
      gain5d: 0,
      gain10d: 0,
      gain20d: 0,
      consecutiveGreenDays: 0,
      daysFromHigh: 20,
      currentDrawdown: 0,
    };

  const recent5 = historicalData.slice(-5);
  const recent10 = historicalData.slice(-10);
  const recent20 = historicalData.slice(-20);

  return {
    gain5d: (recent5.at(-1).close - recent5[0].close) / recent5[0].close,
    gain10d: (recent10.at(-1).close - recent10[0].close) / recent10[0].close,
    gain20d: (recent20.at(-1).close - recent20[0].close) / recent20[0].close,
    consecutiveGreenDays: countConsecutiveGreenDays(historicalData),
    daysFromHigh: daysSinceHigh(historicalData),
    currentDrawdown: calculateDrawdown(historicalData),
  };
}

function analyzeMarketStructure(stock, historicalData) {
  const currentPrice =
    Number(stock.currentPrice) || historicalData.at(-1)?.close || 0;
  return {
    distanceFromMA50: stock.movingAverage50d
      ? (currentPrice - stock.movingAverage50d) / stock.movingAverage50d
      : 0,
    distanceFromMA200: stock.movingAverage200d
      ? (currentPrice - stock.movingAverage200d) / stock.movingAverage200d
      : 0,
    distanceFrom52wHigh: stock.fiftyTwoWeekHigh
      ? (stock.fiftyTwoWeekHigh - currentPrice) / stock.fiftyTwoWeekHigh
      : 0,
    isNearResistance: isNearKeyResistance(historicalData, currentPrice),
    hasConfirmedSupport: hasConfirmedSupportBelow(historicalData, currentPrice),
  };
}

function calculateKeyLevels(stock, historicalData) {
  const levels = { supports: [], resistances: [] };
  const addIf = (arr, v) => {
    const x = Number(v);
    if (Number.isFinite(x) && x > 0) arr.push(x);
  };

  if (stock.movingAverage50d) addIf(levels.supports, stock.movingAverage50d);
  if (stock.movingAverage200d) addIf(levels.supports, stock.movingAverage200d);
  if (stock.fiftyTwoWeekHigh) addIf(levels.resistances, stock.fiftyTwoWeekHigh);

  if (historicalData && historicalData.length >= 20) {
    const recentData = historicalData.slice(-20);
    for (let i = 2; i < recentData.length - 2; i++) {
      const c = recentData[i];
      if (
        c.high > recentData[i - 1].high &&
        c.high > recentData[i - 2].high &&
        c.high > recentData[i + 1].high &&
        c.high > recentData[i + 2].high
      )
        levels.resistances.push(c.high);

      if (
        c.low < recentData[i - 1].low &&
        c.low < recentData[i - 2].low &&
        c.low < recentData[i + 1].low &&
        c.low < recentData[i + 2].low
      )
        levels.supports.push(c.low);
    }
  }

  levels.supports = [...new Set(levels.supports)].sort((a, b) => b - a);
  levels.resistances = [...new Set(levels.resistances)].sort((a, b) => a - b);
  return levels;
}

function countConsecutiveGreenDays(historicalData) {
  let count = 0;
  for (let i = historicalData.length - 1; i > 0; i--) {
    if (historicalData[i].close > historicalData[i - 1].close) count++;
    else break;
  }
  return count;
}

function daysSinceHigh(historicalData) {
  const window = historicalData.slice(-20);
  const recentHigh = Math.max(...window.map((d) => d.high));
  for (
    let i = historicalData.length - 1;
    i >= historicalData.length - window.length;
    i--
  ) {
    if (historicalData[i].high === recentHigh)
      return historicalData.length - 1 - i;
  }
  return 20;
}

function calculateDrawdown(historicalData) {
  const recent20High = Math.max(
    ...historicalData.slice(-20).map((d) => d.high)
  );
  const currentPrice = historicalData.at(-1).close;
  return recent20High > 0 ? (recent20High - currentPrice) / recent20High : 0;
}

function isNearKeyResistance(historicalData, currentPrice) {
  const highs = historicalData.slice(-50).map((d) => d.high);
  if (!highs.length) return false;
  const recentHigh = Math.max(...highs);
  return currentPrice > recentHigh * 0.97;
}

function hasConfirmedSupportBelow(historicalData, currentPrice) {
  const lows = historicalData
    .slice(-20)
    .map((d) => d.low)
    .filter(Number.isFinite);
  if (lows.length < 6) return false;
  const sortedAsc = [...lows].sort((a, b) => a - b);
  const supportLevel = sortedAsc[Math.min(5, sortedAsc.length - 1)];
  return currentPrice > supportLevel * 1.02;
}

function isNearMajorResistance_Helper(stock, context, config) {
  const { rsi14, currentPrice } = stock;
  const { today, avgVolume50, avgVolume20 } = context;

  if (Number.isFinite(stock.fiftyTwoWeekHigh)) {
    const percentFrom52High =
      (stock.fiftyTwoWeekHigh - currentPrice) / stock.fiftyTwoWeekHigh;
    if (percentFrom52High < config.veto.resistanceZoneBuffer) {
      const volBase =
        Number.isFinite(avgVolume50) && avgVolume50 > 0
          ? avgVolume50
          : avgVolume20;
      const hasExceptionalVolume =
        volBase > 0 &&
        today.volume > volBase * config.veto.resistanceBypassVolumeMultiplier;
      const hasVeryStrongRSI =
        Number.isFinite(rsi14) && rsi14 > config.veto.resistanceBypassRsi;

      if (hasExceptionalVolume && hasVeryStrongRSI) return false;
      return true;
    }
  }
  return false;
}
