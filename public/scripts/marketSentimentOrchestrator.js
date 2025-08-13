import { getShortTermSentimentScore } from "./shortTermSentimentAnalysis.js";
import { getDeepMarketAnalysis } from "./deepMarketAnalysis.js";

/**
 * Enhanced orchestrator with market-adaptive weighting and better score normalization.
 * Safe for pre-open runs (uses prior-day OHLC for pivots).
 *
 * Key points:
 * - Directional JPX tick rounding (longs: stop & target rounded DOWN to tick).
 * - MA50/MA200 added to supports OR resistances based on relation to currentPrice.
 * - Confidence affects risk (tighter stops / higher targets when confidence high).
 * - Use classic pivots (P, R1, S1); integrate into stop/target candidates.
 * - Windows for level relevance blend ATR and % of price.
 * - Daily limit band clamp (approx).
 * - No pre-open / PTS gap adjustments anywhere.
 */

export function getComprehensiveMarketSentiment(stock, historicalData) {
  // ---- Validate inputs
  if (!stock || !historicalData || historicalData.length < 50) {
    return {
      score: 7,
      stopLoss: null,
      priceTarget: null,
      confidence: 0,
      error: "Insufficient data for analysis",
    };
  }
  console.log("stock:");
  console.log(stock);

  // ---- Ensure chronology once and reuse everywhere
  const sorted = [...historicalData].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );

  // ---- 1) SHORT-TERM SENTIMENT (Layer 1)
  console.log("getShortTermSentimentScore");
  const shortTermScore = getShortTermSentimentScore(stock, sorted);

  // ---- 2) DEEP MARKET ANALYSIS (Layer 2) (robust defaults)
  const {
    mlScore,
    features = {},
    longTermRegime = { type: "UNKNOWN", strength: 0 },
    shortTermRegime = { type: "UNKNOWN", strength: 0 },
  } = getDeepMarketAnalysis(stock, sorted) || {};

  console.log("getDeepMarketAnalysis complete");
  // ---- 3) Market-adaptive weighting (ensure 1 is reachable in trending regime)
  const weights = getAdaptiveSentimentWeights(longTermRegime, shortTermRegime);

  // ---- 4) Normalization & clamping
  // Map ShortTerm 1..7 -> 5..-3 linearly (1→+5, 4→+1, 7→-3)
  const normalizedShortTerm = 5 - shortTermScore;

  let safeMl = Number.isFinite(mlScore) ? mlScore : 0;
  // Assume ML behaves like a z-score; cap extremes so thresholds remain meaningful
  safeMl = Math.max(-3, Math.min(3, safeMl));

  const combinedScore =
    normalizedShortTerm * weights.shortTerm + safeMl * weights.deepAnalysis;

  // ---- 5) Score → bucket + confidence
  const { finalScore, confidence } = mapToSentimentScoreWithConfidence(
    combinedScore,
    features,
    longTermRegime,
    shortTermRegime
  );

  // ---- 6) Risk levels based on sentiment (confidence-aware, no gap logic)
  const result = calculateRiskLevelsFromSentiment(
    stock,
    sorted, // use sorted everywhere
    finalScore,
    confidence,
    combinedScore
  );
  result.confidence = confidence;
  result.longTermRegime = longTermRegime.type;
  result.shortTermRegime = shortTermRegime.type;
  result.keyInsights = generateSentimentInsights(features);
  result.rawCombinedScore = combinedScore; // for debugging

  return result;
}

/* ───────────────── Market-Adaptive Weighting ───────────────── */

function getAdaptiveSentimentWeights(longTermRegime, shortTermRegime) {
  const lt = longTermRegime?.type || "UNKNOWN";
  const st = shortTermRegime?.type || "UNKNOWN";

  if (lt === "TRENDING" && st === "TRENDING") {
    // Make Strong Buy reachable: max = 5*0.3 + 3*0.7 = 3.6
    return { shortTerm: 0.3, deepAnalysis: 0.7 };
  } else if (lt === "CHOPPY" || st === "CHOPPY") {
    // Slight bias to deep analysis, but keep short-term meaningful for mean reversion
    return { shortTerm: 0.4, deepAnalysis: 0.6 };
  } else if (lt !== st && lt !== "UNKNOWN" && st !== "UNKNOWN") {
    // Transition → balance
    return { shortTerm: 0.5, deepAnalysis: 0.5 };
  } else {
    return { shortTerm: 0.3, deepAnalysis: 0.7 };
  }
}

/* ───────────────── Confidence Mapping ───────────────── */

function mapToSentimentScoreWithConfidence(
  combinedScore,
  features,
  longTermRegime,
  shortTermRegime
) {
  let confidence = 0.5; // base

  // Count bullish/bearish signals from feature set
  const isOn = (v) => v === true || v === 1 || (typeof v === "number" && v > 0);

  // Be specific to avoid double-counting (e.g., "wyckoffUpthrust" vs "wyckoffSpring",
  // "pocRising" vs "pocFalling")
  const BULLISH_KEYS = [
    "bullish",
    "long",
    "accumulat", // isAccumulating
    "wyckoffspring",
    "sellerexhaustion",
    "pocrising",
    "compression",
    "cyclephase_expansion", // f6_cyclePhase_EXPANSION_STARTING
  ];
  const BEARISH_KEYS = [
    "bearish",
    "short",
    "distribut",
    "buyerexhaustion",
    "wyckoffupthrust",
    "pocfalling",
  ];

  let bull = 0;
  let bear = 0;
  for (const [k, v] of Object.entries(features || {})) {
    const keyLower = k.toLowerCase();
    if (isOn(v) && BULLISH_KEYS.some((kw) => keyLower.includes(kw))) bull++;
    if (isOn(v) && BEARISH_KEYS.some((kw) => keyLower.includes(kw))) bear++;
  }

  const featureAlignment = (bull - bear) / Math.max(bull + bear, 1);
  confidence += featureAlignment * 0.3;

  // Regime effects
  if (
    longTermRegime?.type === "TRENDING" &&
    (longTermRegime?.strength || 0) > 0.8
  ) {
    confidence += 0.15;
  } else if (
    longTermRegime?.type !== shortTermRegime?.type &&
    longTermRegime?.type !== "UNKNOWN" &&
    shortTermRegime?.type !== "UNKNOWN"
  ) {
    confidence -= 0.15; // conflict
  }
  // Do NOT penalize CHOPPY-on-CHOPPY per your intent.

  // Bound confidence
  confidence = Math.max(0.2, Math.min(0.9, confidence));

  // Map combinedScore to 1..7 buckets (1 best)
  // With normalizedShortTerm in [-3..5] and ml in [-3..3], combined ~[-4..+5].
  const trendingNudge =
    longTermRegime?.type === "TRENDING" && shortTermRegime?.type === "TRENDING"
      ? -0.05
      : 0;

  let finalScore;
  const s = combinedScore + trendingNudge;
  if (s >= 4.5) finalScore = 1; // Strong Buy (was 3.5)
  else if (s >= 3.5) finalScore = 2; // Buy (was 2.5)
  else if (s >= 2.5) finalScore = 3; // Weak Buy (was 1.5)
  else if (s >= 1.0) finalScore = 4; // Neutral (was 0.5)
  else if (s >= -0.5) finalScore = 5; // Weak Avoid (was -0.5)
  else if (s >= -2.0) finalScore = 6; // Avoid (was -1.5)
  else finalScore = 7; // Strong Avoid

  return { finalScore, confidence };
}

/* ───────────────── Key Insights ───────────────── */

function generateSentimentInsights(features = {}) {
  const insights = [];
  if (features.f0_sellerExhaustion) {
    insights.push("Seller exhaustion detected – potential reversal");
  }
  if (features.f5_wyckoffSpring) {
    insights.push("Wyckoff spring pattern – long setup");
  }
  if (features.f6_compression && features.f6_cyclePhase_EXPANSION_STARTING) {
    insights.push("Volatility expansion starting from compression");
  }
  if (features.f1_pocRising) {
    insights.push("Rising volume POC – accumulation bias");
  }
  return insights;
}

/* ───────────────── Risk Levels Based on Sentiment (no gap logic) ───────────────── */

function calculateRiskLevelsFromSentiment(
  stock,
  historicalDataSorted,
  score,
  confidence,
  combinedScore
) {
  const price = Number(stock?.currentPrice);
  if (!Number.isFinite(price) || price <= 0) {
    return {
      score,
      stopLoss: null,
      priceTarget: null,
      error: "Invalid price data",
    };
  }

  // Prefer precomputed ATR if present, then fall back
  const atr =
    (Number.isFinite(stock?.atr14) && stock.atr14 > 0 ? stock.atr14 : null) ||
    calculateATR(historicalDataSorted) ||
    estimateATR(stock, historicalDataSorted);

  if (!atr || atr <= 0) {
    return {
      score,
      stopLoss: null,
      priceTarget: null,
      error: "Cannot calculate ATR",
    };
  }

  const levels = identifyKeyPriceLevels(stock, historicalDataSorted);

  const stopLossRaw = calculateSentimentBasedStopLoss(
    stock,
    historicalDataSorted,
    levels,
    atr,
    score,
    confidence,
    combinedScore
  );
  let priceTargetRaw = calculateSentimentBasedTarget(
    stock,
    historicalDataSorted,
    levels,
    atr,
    score,
    confidence,
    combinedScore,
    stopLossRaw
  );

  // Re-enforce min R:R (no gap adjustment step)
  const minRR = getMinRiskRewardForSentiment(score, confidence);
  const risk = price - stopLossRaw;
  const rrFloor = price + Math.max(0, risk) * minRR;
  if (Number.isFinite(priceTargetRaw) && priceTargetRaw < rrFloor) {
    priceTargetRaw = rrFloor;
  }

  // Clamp to daily limit band (approx; override with stock.limitBandPct if provided)
  const { lowerLimit, upperLimit } = estimateDailyLimitBand(stock);
  let stopLossAdj = stopLossRaw;
  let priceTargetAdj = priceTargetRaw;
  if (Number.isFinite(stopLossAdj)) {
    stopLossAdj = Math.max(stopLossAdj, lowerLimit);
  }
  if (Number.isFinite(priceTargetAdj)) {
    priceTargetAdj = Math.min(priceTargetAdj, upperLimit);
  }

  // JPX tick rounding (directional: longs → floor)
  const stopLoss = stopLossAdj != null ? floorToJpxTick(stopLossAdj) : null;
  const priceTarget =
    priceTargetAdj != null ? floorToJpxTick(priceTargetAdj) : null;

  return {
    score,
    stopLoss,
    priceTarget,
  };
}

/* ───────────────── ATR helpers ───────────────── */

function calculateATR(data) {
  if (!Array.isArray(data) || data.length < 15) return null;
  const trs = [];
  // last 14 TRs
  for (let i = 1; i < 15; i++) {
    const cur = data[data.length - i];
    const prev = data[data.length - i - 1];
    if (!cur || !prev) continue;
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close)
    );
    trs.push(tr);
  }
  return trs.length ? trs.reduce((a, b) => a + b, 0) / trs.length : null;
}

function estimateATR(stock, historicalData) {
  const price = Number(stock?.currentPrice) || 0;
  if (historicalData?.length >= 5) {
    const recent = historicalData.slice(-5);
    const avgRange =
      recent.reduce((sum, d) => sum + Math.max(0, d.high - d.low), 0) /
      recent.length;
    if (avgRange > 0) return avgRange;
  }
  // JP: conservative default if we must
  const est = 0.02; // 2% of price
  return price * est;
}

/* ───────────────── Key Levels & Pivots ───────────────── */

function identifyKeyPriceLevels(stock, historicalData) {
  const currentPrice = Number(stock?.currentPrice);
  const levels = {
    supports: [],
    resistances: [],
    pivotPoint: null,
    r1: null,
    s1: null,
    recentSwingHigh: null,
    recentSwingLow: null,
  };

  const addIfFinite = (arr, v) => {
    const x = Number(v);
    if (Number.isFinite(x) && x > 0) arr.push(x);
  };

  // Structural MAs -> side-aware
  const ma50 = Number(stock?.movingAverage50d);
  const ma200 = Number(stock?.movingAverage200d);
  if (Number.isFinite(ma50)) {
    if (ma50 < currentPrice) addIfFinite(levels.supports, ma50);
    else addIfFinite(levels.resistances, ma50);
  }
  if (Number.isFinite(ma200)) {
    if (ma200 < currentPrice) addIfFinite(levels.supports, ma200);
    else addIfFinite(levels.resistances, ma200);
  }

  // 52-week high is resistance
  addIfFinite(levels.resistances, stock?.fiftyTwoWeekHigh);

  // Classic daily pivots from PRIOR day
  const prevHigh = Number(stock?.highPrice);
  const prevLow = Number(stock?.lowPrice);
  const prevClose = Number(stock?.prevClosePrice);
  if (
    [prevHigh, prevLow, prevClose].every((v) => Number.isFinite(v) && v > 0)
  ) {
    const P = (prevHigh + prevLow + prevClose) / 3;
    const R1 = 2 * P - prevLow;
    const S1 = 2 * P - prevHigh;
    levels.pivotPoint = P;
    levels.r1 = R1;
    levels.s1 = S1;
    // Treat as contextual levels
    if (R1 > currentPrice) addIfFinite(levels.resistances, R1);
    if (S1 < currentPrice) addIfFinite(levels.supports, S1);
  }

  // Swing points (last 20)
  if (Array.isArray(historicalData) && historicalData.length >= 20) {
    const recent = historicalData.slice(-20);
    for (let i = 2; i < recent.length - 2; i++) {
      const c = recent[i];
      if (!c) continue;
      const isHigh =
        c.high > recent[i - 1].high &&
        c.high > recent[i - 2].high &&
        c.high > recent[i + 1].high &&
        c.high > recent[i + 2].high;

      if (isHigh) {
        addIfFinite(levels.resistances, c.high);
        if (!levels.recentSwingHigh || c.high > levels.recentSwingHigh) {
          levels.recentSwingHigh = c.high;
        }
      }

      const isLow =
        c.low < recent[i - 1].low &&
        c.low < recent[i - 2].low &&
        c.low < recent[i + 1].low &&
        c.low < recent[i + 2].low;

      if (isLow) {
        addIfFinite(levels.supports, c.low);
        if (!levels.recentSwingLow || c.low < levels.recentSwingLow) {
          levels.recentSwingLow = c.low;
        }
      }
    }
  }

  // Dedup + sort
  levels.supports = [...new Set(levels.supports)].sort((a, b) => b - a); // high→low
  levels.resistances = [...new Set(levels.resistances)].sort((a, b) => a - b); // low→high

  return levels;
}

/* ───────────────── Stop / Target ───────────────── */

function calculateSentimentBasedStopLoss(
  stock,
  historicalData,
  levels,
  atr,
  sentimentScore,
  confidence,
  combinedScore
) {
  const currentPrice = Number(stock?.currentPrice);

  const baseMultiplier =
    {
      1: 1.2,
      2: 1.5,
      3: 1.8,
      4: 2.0,
      5: 2.3,
      6: 2.6,
      7: 3.0,
    }[sentimentScore] ?? 2.0;

  const volatilityAdjustment = getVolatilityAdjustment(stock, historicalData);

  // Confidence & intensity scaling (higher confidence → tighter stop)
  const confNorm = Math.max(0, Math.min(1, (confidence - 0.2) / 0.7)); // 0..1
  const intensity = Math.max(0, Math.min(1, (combinedScore + 4) / 9)); // approx map [-4..5] -> [0..1]
  const confScale = 1.1 - 0.3 * confNorm; // 1.1 → 0.8
  const intensityScale = 1.05 - 0.1 * intensity; // 1.05 → 0.95

  const atrMultiplier =
    baseMultiplier * volatilityAdjustment * confScale * intensityScale;

  const atrStop = currentPrice - atr * atrMultiplier;

  // Level windows: blend ATR and % of price
  const windowBelow = Math.min(2.5 * atr, currentPrice * 0.03); // 3% cap
  let supportStop = null;
  const nearestSupport = levels.supports.find(
    (s) => s < currentPrice && currentPrice - s <= windowBelow
  );
  if (nearestSupport != null) {
    supportStop = nearestSupport - atr * 0.3; // small buffer
  }

  let recentLowStop = null;
  if (levels.recentSwingLow && levels.recentSwingLow < currentPrice) {
    recentLowStop = levels.recentSwingLow - atr * 0.2;
  }

  // Pivot S1 (if trading above pivot)
  let s1Stop = null;
  if (
    Number.isFinite(levels.pivotPoint) &&
    Number.isFinite(levels.s1) &&
    currentPrice > levels.pivotPoint &&
    levels.s1 < currentPrice &&
    currentPrice - levels.s1 <= windowBelow
  ) {
    s1Stop = levels.s1 - atr * 0.2;
  }

  const candidates = [atrStop, supportStop, recentLowStop, s1Stop].filter(
    (s) => Number.isFinite(s) && s > 0 && s < currentPrice * 0.98
  );

  let chosen;
  if (!candidates.length) {
    const fallbackPercent = Math.min(0.02 + (atr / currentPrice) * 2, 0.1);
    chosen = currentPrice * (1 - fallbackPercent);
  } else if (sentimentScore <= 2) {
    chosen = Math.max(...candidates); // tightest stop for best setups
  } else if (sentimentScore <= 4) {
    chosen = candidates.reduce((a, b) => a + b, 0) / candidates.length;
  } else {
    chosen = Math.min(...candidates); // widest stop for weak setups
  }

  // Ensure minimum absolute distance (≥ 10 ticks)
  const minTicks = 10;
  const tick = jpxTick(currentPrice);
  const minDistance = minTicks * tick;
  if (currentPrice - chosen < minDistance) {
    chosen = currentPrice - minDistance;
  }

  return chosen;
}

function calculateSentimentBasedTarget(
  stock,
  historicalData,
  levels,
  atr,
  sentimentScore,
  confidence,
  combinedScore,
  stopLoss
) {
  const currentPrice = Number(stock?.currentPrice);
  if (!Number.isFinite(stopLoss) || stopLoss <= 0) {
    return floorToJpxTick(currentPrice * 1.05); // minimal default (rounded down)
  }

  const minRR = getMinRiskRewardForSentiment(sentimentScore, confidence);
  const risk = currentPrice - stopLoss;
  const minTarget = currentPrice + risk * minRR;

  // ATR-based target (confidence & intensity enlarge when strong)
  const baseTargetMult =
    { 1: 3.5, 2: 3.0, 3: 2.5, 4: 2.0, 5: 1.5, 6: 1.2, 7: 1.0 }[
      sentimentScore
    ] ?? 2.0;

  const volatilityAdjustment = getVolatilityAdjustment(stock, historicalData);
  const confNorm = Math.max(0, Math.min(1, (confidence - 0.2) / 0.7));
  const intensity = Math.max(0, Math.min(1, (combinedScore + 4) / 9));
  const uplift = 1 + 0.25 * confNorm + 0.15 * intensity; // up to ~1.4x
  const atrTarget =
    currentPrice + atr * baseTargetMult * volatilityAdjustment * uplift;

  // Resistance-based target within window
  const windowAbove = Math.min(3.0 * atr, currentPrice * 0.05); // 5% cap
  let resistanceTarget = null;
  const nearestResistance = levels.resistances.find(
    (r) => r > currentPrice && r - currentPrice <= windowAbove
  );
  if (nearestResistance) {
    resistanceTarget = nearestResistance * 0.995; // just below
  }

  // Classic pivot R1 as candidate
  let r1Target = null;
  if (
    Number.isFinite(levels.pivotPoint) &&
    Number.isFinite(levels.r1) &&
    levels.r1 > currentPrice &&
    levels.r1 - currentPrice <= Math.min(3.0 * atr, currentPrice * 0.05)
  ) {
    r1Target = levels.r1 * 0.995;
  }

  // Fibonacci extension from recent range (if available)
  if (levels.recentSwingLow != null && levels.recentSwingHigh != null) {
    const swing = levels.recentSwingHigh - levels.recentSwingLow;
    const base = levels.recentSwingHigh; // breakout continuation
    const fib618 = base + 0.618 * swing;
    const fib100 = base + 1.0 * swing;
    if (!resistanceTarget) {
      resistanceTarget = sentimentScore <= 2 ? fib100 : fib618;
    }
  }

  const candidates = [atrTarget, resistanceTarget, r1Target, minTarget].filter(
    (t) => Number.isFinite(t) && t > currentPrice * 1.01
  );

  if (!candidates.length) return floorToJpxTick(minTarget);

  let chosen;
  if (sentimentScore <= 2) {
    const cap = currentPrice * (1 + (atr / currentPrice) * 5); // cap at ~5 ATRs
    chosen = Math.max(Math.min(Math.max(...candidates), cap), minTarget);
  } else if (sentimentScore <= 4) {
    const avg = candidates.reduce((a, b) => a + b, 0) / candidates.length;
    chosen = Math.max(avg, minTarget);
  } else {
    chosen = Math.max(Math.min(...candidates), minTarget);
  }

  return chosen;
}

function getMinRiskRewardForSentiment(sentimentScore, confidence) {
  // Slightly lift min RR with confidence
  const base =
    {
      1: 3.0,
      2: 2.5,
      3: 2.0,
      4: 1.5,
      5: 1.2,
      6: 1.0,
      7: 0.8,
    }[sentimentScore] ?? 1.5;

  const confNorm = Math.max(0, Math.min(1, (confidence - 0.2) / 0.7));
  return base * (1 + 0.15 * confNorm); // up to +15%
}

/* ───────────────── Volatility Regime ───────────────── */

function getVolatilityAdjustment(stock, historicalData) {
  if (!Array.isArray(historicalData) || historicalData.length < 20) return 1.0;

  const recent = historicalData.slice(-20);
  let sum = 0;
  let count = 0;
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1];
    const cur = recent[i];
    if (!prev?.close || !cur?.close) continue;
    if (prev.close === 0) continue; // guard divide-by-zero
    sum += Math.abs((cur.close - prev.close) / prev.close);
    count++;
  }
  const avgDailyMove = count ? sum / count : 0;

  if (avgDailyMove > 0.03) return 0.8;
  if (avgDailyMove > 0.02) return 0.9;
  if (avgDailyMove < 0.01) return 1.2;
  if (avgDailyMove < 0.015) return 1.1;
  return 1.0;
}

/* ───────────────── Daily Limit Band (JPX approx) ───────────────── */

function estimateDailyLimitBand(stock) {
  const prevClose = Number(stock?.prevClosePrice);
  // If broker/exchange-specific limit is known, pass as stock.limitBandPct (e.g., 0.10)
  const limitPct =
    Number.isFinite(stock?.limitBandPct) && stock.limitBandPct > 0
      ? stock.limitBandPct
      : 0.1; // conservative default ±10%

  if (Number.isFinite(prevClose) && prevClose > 0) {
    return {
      lowerLimit: prevClose * (1 - limitPct),
      upperLimit: prevClose * (1 + limitPct),
    };
  }
  // Fallback if prevClose missing
  const ref = Number(stock?.currentPrice) || 0;
  return { lowerLimit: ref * 0.9, upperLimit: ref * 1.1 };
}

/* ───────────────── JPX tick rounding ───────────────── */
/**
 * Simplified JPX tick size bands (adjust if your broker differs).
 * See: price bands like 1 / 5 / 10 / 50 / 100 / 500 / 1,000 yen by ranges.
 */
function jpxTick(price) {
  if (price < 3000) return 1;
  if (price < 5000) return 5;
  if (price < 30000) return 10;
  if (price < 50000) return 50;
  if (price < 300000) return 100;
  if (price < 500000) return 500;
  return 1000;
}
function floorToJpxTick(price) {
  const t = jpxTick(price);
  return Math.floor(price / t) * t;
}

/* ───────────────── END ───────────────── */
