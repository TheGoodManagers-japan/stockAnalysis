// ================== SHORT TERM SENTIMENT ANALYSIS (Layer 1) ==================
// shortTermSentimentAnalysis.js

/**
 * Analyzes short-term (≈15 trading days) price action, patterns, and momentum to determine market sentiment.
 * Japan-friendly defaults: emphasizes MA25/MA50 (25日線/50日線), adaptive thresholds by ATR%.
 * No external options: everything is handled internally.
 *
 * @param {object} stock - The stock object (expects currentPrice, rsi14, movingAverage25d/50d if available).
 * @param {array} historicalData - Recent daily bars (each: { date, open, high, low, close, volume }).
 * @returns {number} Sentiment tier 1..7 (1=Strong Bullish, 7=Strong Bearish).
 */
export function getShortTermSentimentScore(stock, historicalData) {
  if (!historicalData || historicalData.length < 15) {
    return 7; // conservative when insufficient data
  }

  // Sort chronologically; keep enough history to compute MA25/ATR gracefully
  const sorted = [...historicalData].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );
  const recentData = sorted.slice(-15); // core sentiment window

  const n = (v) => (Number.isFinite(v) ? v : 0);
  const currentPrice = n(stock?.currentPrice) || n(recentData.at(-1)?.close);

  // ---- Market context (JP-friendly) ----
  const ctx = deriveMarketContext(stock, sorted, currentPrice);
  // ctx: { atr, atrPct, ma25, ma50, ma25SlopeUp, volBucket }

  // Containers for arrays we re-use
  const historical = {
    closes: recentData.map((d) => n(d.close)),
    volumes: recentData.map((d) => n(d.volume)),
    highs: recentData.map((d) => n(d.high)),
    lows: recentData.map((d) => n(d.low)),
  };

  // --- Pattern & Momentum Detection ---
  const momentum = calculateShortTermMomentum(historical, recentData, ctx);
  const bullishPatterns = detectShortTermBullishPatterns(
    recentData,
    historical,
    stock,
    currentPrice,
    ctx
  );
  const bearishPatterns = detectShortTermBearishPatterns(
    recentData,
    historical,
    ctx
  );
  const exhaustionPatterns = detectShortTermExhaustion(
    recentData,
    historical,
    stock,
    momentum.recent,
    ctx
  );

  // --- Scoring ---
  const baseWeights = getShortTermSentimentWeights();
  const weights = adjustWeightsForContext(baseWeights, ctx);

  let sentimentScore = 0;
  sentimentScore += scoreMomentumForSentiment(momentum, weights, ctx);
  sentimentScore += scoreBullishPatternsForSentiment(bullishPatterns, weights);
  sentimentScore += scoreBearishPatternsForSentiment(bearishPatterns, weights);
  sentimentScore += scoreExhaustionForSentiment(
    exhaustionPatterns,
    weights,
    momentum.recent
  );

  // --- Sentiment Tier Mapping (centered; works across buckets) ---
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
 * CONTEXT & HELPERS (Japan-friendly; MA25 emphasis; ATR-aware)
 * -----------------------------------------------------------------
 */

function deriveMarketContext(stock, sorted, currentPrice) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  // ATR14 (Wilder). If insufficient data, fallback to avg true range of last 10.
  const atr = computeATR(sorted, 14) || approxATR(sorted);
  const atrPct = atr > 0 && currentPrice > 0 ? atr / currentPrice : 0.015;

  // Volatility buckets (daily):
  // low ≤ 1.2%, mid 1.2–3.0%, high ≥ 3.0%
  const volBucket = atrPct <= 0.012 ? "low" : atrPct >= 0.03 ? "high" : "mid";

  // MA25/MA50 with fallbacks to SMA if stock fields are missing
  const ma25 = n(stock?.movingAverage25d) || sma(sorted, 25, "close");
  const ma50 = n(stock?.movingAverage50d) || sma(sorted, 50, "close");

  // MA25 slope (simple): compare last 5 vs previous 5 average of MA25 proxy
  const ma25Series = rollingSMASeries(sorted, 25);
  const mLen = ma25Series.length;
  let ma25SlopeUp = false;
  if (mLen >= 10) {
    const last5 = avg(ma25Series.slice(-5));
    const prev5 = avg(ma25Series.slice(-10, -5));
    ma25SlopeUp = last5 > prev5;
  } else {
    // Fallback heuristic if little history
    ma25SlopeUp = currentPrice > ma25;
  }

  return { atr, atrPct, ma25, ma50, ma25SlopeUp, volBucket };
}

function computeATR(data, length = 14) {
  if (!Array.isArray(data) || data.length < length + 1) return 0;
  const n = (v) => (Number.isFinite(v) ? v : 0);
  let prevClose = n(data[0].close);
  let trs = [];
  for (let i = 1; i < data.length; i++) {
    const h = n(data[i].high),
      l = n(data[i].low),
      c = n(data[i].close);
    const tr = Math.max(
      h - l,
      Math.abs(h - prevClose),
      Math.abs(l - prevClose)
    );
    trs.push(tr);
    prevClose = c;
  }
  // Wilder's smoothing: first ATR = simple avg of first 'length' TRs; then EMA-like
  if (trs.length < length) return avg(trs);
  let atr = avg(trs.slice(0, length));
  for (let i = length; i < trs.length; i++) {
    atr = (atr * (length - 1) + trs[i]) / length;
  }
  return atr;
}

function approxATR(data) {
  if (!Array.isArray(data) || data.length < 10) return 0;
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const w = data.slice(-10);
  const ranges = w.map((d) => Math.max(0, n(d.high) - n(d.low)));
  return avg(ranges);
}

function sma(data, n, field = "close") {
  if (!Array.isArray(data) || data.length < n) return 0;
  let s = 0;
  for (let i = data.length - n; i < data.length; i++)
    s += Number(data[i][field]) || 0;
  return s / n;
}

function rollingSMASeries(data, n, field = "close") {
  if (!Array.isArray(data) || data.length < n) return [];
  const out = [];
  let s = 0;
  for (let i = 0; i < data.length; i++) {
    s += Number(data[i][field]) || 0;
    if (i >= n) s -= Number(data[i - n][field]) || 0;
    if (i >= n - 1) out.push(s / n);
  }
  return out;
}

function avg(arr) {
  return arr.length
    ? arr.reduce((a, b) => a + (Number(b) || 0), 0) / arr.length
    : 0;
}

function n(v) {
  return Number.isFinite(v) ? v : 0;
}

/**
 * -----------------------------------------------------------------
 * MOMENTUM
 * -----------------------------------------------------------------
 */
function calculateShortTermMomentum(historical, recentData, ctx) {
  let recentMomentum = 0;
  let volumeTrend = 0;

  // Adaptive thresholds by volatility bucket (for later scoring)
  // We still compute pure %, but scoring uses ctx.
  if (recentData.length >= 15) {
    const last5 = historical.closes.slice(-5);
    const prev10 = historical.closes.slice(-15, -5);
    const last5Avg = last5.length ? avg(last5) : 0;
    const prev10Avg = prev10.length ? avg(prev10) : 0;
    recentMomentum = prev10Avg ? ((last5Avg - prev10Avg) / prev10Avg) * 100 : 0;
  }

  if (recentData.length >= 10) {
    const last5v = historical.volumes.slice(-5);
    const prev5v = historical.volumes.slice(-10, -5);
    const last5VolAvg = last5v.length ? avg(last5v) : 0;
    const prev5VolAvg = prev5v.length ? avg(prev5v) : 0;
    volumeTrend = prev5VolAvg
      ? ((last5VolAvg - prev5VolAvg) / prev5VolAvg) * 100
      : 0;
  }

  return { recent: recentMomentum, volume: volumeTrend };
}

/**
 * -----------------------------------------------------------------
 * BULLISH / BEARISH PATTERNS (JP-friendly: MA25/MA50 emphasis)
 * -----------------------------------------------------------------
 */
function detectShortTermBullishPatterns(
  recentData,
  historical,
  stock,
  currentPrice,
  ctx
) {
  const patterns = {};
  const n = (v) => (Number.isFinite(v) ? v : 0);

  // Higher lows (≥5 of last 6 are higher)
  if (recentData.length >= 7) {
    const last7Lows = recentData.slice(-7).map((d) => n(d.low));
    const higherLowsCount = last7Lows
      .slice(1)
      .reduce((count, low, i) => (low > last7Lows[i] ? count + 1 : count), 0);
    patterns.higherLows = higherLowsCount >= 5;
  }

  // Price compression (last 3 avg range < 70% of last 7 avg)
  if (recentData.length >= 7) {
    const ranges = recentData
      .slice(-7)
      .map((d) => Math.max(0, n(d.high) - n(d.low)));
    const rangeAvg = ranges.length ? avg(ranges) : 0;
    const last3RangeAvg = avg(ranges.slice(-3));
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

  // Support test (lowest of last W + rebound). Slightly longer on low-vol names.
  const supportWin = ctx.volBucket === "low" ? 12 : 10;
  if (recentData.length >= supportWin) {
    const windowN = recentData.slice(-supportWin);
    const lowestDay = windowN.reduce((lowest, d) =>
      n(d.low) < n(lowest.low) ? d : lowest
    );
    const today = recentData[recentData.length - 1];
    patterns.supportTest =
      n(today.low) <= n(lowestDay.low) * 1.01 &&
      n(today.close) > n(today.open) &&
      n(today.close) > n(lowestDay.low) * 1.02;
  } else {
    patterns.supportTest = false;
  }

  // JP-centric MA pullback + reclaim (MA25/MA50, ±1.5% band) and MA25 reclaim
  const ma25 = ctx.ma25;
  const ma50 = ctx.ma50;
  const band = 0.015; // ±1.5%
  if (ma25 > 0 || ma50 > 0) {
    const recentLows = recentData.slice(-3).map((d) => n(d.low));
    const low = Math.min(...recentLows);
    const pullbackToMA25 =
      ma25 > 0 && low <= ma25 * (1 + band) && currentPrice > ma25;
    const pullbackToMA50 =
      ma50 > 0 && low <= ma50 * (1 + band) && currentPrice > ma50;
    patterns.pullbackToMA = pullbackToMA25 || pullbackToMA50;

    // MA25 reclaim signal: recently below, now solidly above with MA25 slope or neutral RSI
    const d0 = recentData.at(-1);
    const d1 = recentData.at(-2);
    const reclaimed =
      ma25 > 0 &&
      n(d1.close) <= ma25 * 0.998 &&
      n(d0.close) >= ma25 * 1.001 &&
      (ctx.ma25SlopeUp || (n(stock.rsi14) >= 42 && n(stock.rsi14) <= 74));
    patterns.reclaimMA25 = Boolean(reclaimed);
  } else {
    patterns.pullbackToMA = false;
    patterns.reclaimMA25 = false;
  }

  // Breakout from consolidation (uses compression flag)
  patterns.breakoutFromConsolidation = detectBreakoutFromConsolidation(
    recentData,
    patterns.priceCompression
  );

  // Cup and handle (simple heuristic)
  patterns.cupAndHandle = detectCupAndHandlePattern(recentData);

  return patterns;
}

function detectShortTermBearishPatterns(recentData, historical, ctx) {
  const patterns = {};
  const n = (v) => (Number.isFinite(v) ? v : 0);

  // Lower highs (≥5 of last 6 are lower)
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
  } else {
    patterns.dojiAfterTrend = false;
  }

  return patterns;
}

/**
 * -----------------------------------------------------------------
 * EXHAUSTION (adds MA25 distance/ATR guard)
 * -----------------------------------------------------------------
 */
function detectShortTermExhaustion(
  recentData,
  historical,
  stock,
  recentMomentum,
  ctx
) {
  const patterns = {};
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const currentPrice = n(stock?.currentPrice) || n(recentData.at(-1)?.close);

  // Trend maturity: many up-days in 15-day window
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
    const prev5VolAvg = avg(historical.volumes.slice(-10, -5)) || 0;
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

  // Bearish divergence (price HH, RSI not confirming + weak mom)
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
    const avgVolume = avg(historical.volumes) || 0;
    const last3Volume = avg(historical.volumes.slice(-3)) || 0;
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

  // NEW: Too far above MA25 (in ATR units) → prone to mean reversion
  if (ctx.ma25 > 0 && ctx.atr > 0) {
    const distATR = (currentPrice - ctx.ma25) / ctx.atr;
    // JP swing-style guard similar to our other module: warn if > ~2.2 ATR above MA25
    patterns.tooFarAboveMA25 = distATR > 2.2;
  } else {
    patterns.tooFarAboveMA25 = false;
  }

  return patterns;
}

/**
 * -----------------------------------------------------------------
 * SPECIAL PATTERNS
 * -----------------------------------------------------------------
 */
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

  const atrLast10 = avg(last10Ranges);
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

  if (cupRight.length < 5) return false; // need enough days for a handle

  const recentPullback =
    cupRight[cupRight.length - 2].close < cupRight[cupRight.length - 3].close &&
    cupRight[cupRight.length - 1].close > cupRight[cupRight.length - 2].close;

  return similarHighs && properBottom && recentPullback;
}

/**
 * -----------------------------------------------------------------
 * WEIGHTS & SCORING (ATR-aware; MA25-friendly)
 * -----------------------------------------------------------------
 */

// Base weights (will be scaled by context)
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
    reclaimMA25: 1.4, // NEW
    breakout: 1.6,
    cupHandle: 1.7,
    trendMaturity: 1.5,
    climax: 1.8,
    bearishDiv: 1.4,
    exhaustionGap: 1.2,
    volumeClimax: 1.0,
    overboughtDiv: 1.3,
    resistance: 0.8,
    tooFarAboveMA25: 1.3, // NEW
  };
}

// Scale weights for JP context by volatility + MA25 slope
function adjustWeightsForContext(w, ctx) {
  const s = { ...w };

  if (ctx.volBucket === "low") {
    // Large caps / low beta → reward structure & MA behavior a bit more
    s.pullbackMA *= 1.15;
    s.reclaimMA25 *= 1.15;
    s.higherLows *= 1.1;
    s.breakout *= 0.95;
  } else if (ctx.volBucket === "high") {
    // High beta → reward thrusty patterns more; penalize exhaustion more
    s.engulfing *= 1.1;
    s.breakout *= 1.1;
    s.trendMaturity *= 1.1;
    s.climax *= 1.1;
  }

  if (ctx.ma25SlopeUp) {
    s.reclaimMA25 *= 1.1;
    s.higherLows *= 1.05;
  } else {
    s.tooFarAboveMA25 *= 1.1; // slope flat/down → extra caution when extended
  }

  return s;
}

function scoreMomentumForSentiment(momentum, weights, ctx) {
  // Adaptive momentum gates by vol bucket
  // low-vol: easier to cross; high-vol: stricter
  const gates =
    ctx.volBucket === "low"
      ? { strongPos: 2.2, weakPos: 0.8, weakNeg: -0.8, strongNeg: -2.2 }
      : ctx.volBucket === "high"
      ? { strongPos: 3.5, weakPos: 1.2, weakNeg: -1.2, strongNeg: -3.5 }
      : { strongPos: 3.0, weakPos: 1.0, weakNeg: -1.0, strongNeg: -3.0 };

  let score = 0;
  if (momentum.recent > gates.strongPos) score += weights.momentum;
  else if (momentum.recent > gates.weakPos) score += 0.5 * weights.momentum;
  else if (momentum.recent < gates.strongNeg) score -= weights.momentum;
  else if (momentum.recent < gates.weakNeg) score -= 0.5 * weights.momentum;

  if (momentum.volume > 20 && momentum.recent > 0)
    score += 0.8 * weights.volume;
  else if (momentum.volume > 20 && momentum.recent < 0)
    score -= 0.5 * weights.volume;

  return score;
}

function scoreBullishPatternsForSentiment(patterns, weights) {
  let score = 0;
  if (patterns.higherLows) score += weights.higherLows;

  if (patterns.priceCompression) score += 0.6 * weights.compression;

  if (patterns.bullishEngulfing) score += weights.engulfing;
  if (patterns.supportTest) score += weights.support;
  if (patterns.pullbackToMA) score += weights.pullbackMA;
  if (patterns.reclaimMA25) score += weights.reclaimMA25; // NEW
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
  if (patterns.tooFarAboveMA25) score -= weights.tooFarAboveMA25; // NEW

  // Multiple exhaustion signals penalty
  const exhaustionCount = Object.values(patterns).filter(Boolean).length;
  if (exhaustionCount >= 3) score -= 1.5;

  return score;
}
