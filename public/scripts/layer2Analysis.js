// layer2Analysis.js
// Standalone Layer 2 analysis (no benchmark/sector required)
// Exports: getLayer2MLAnalysis(stock, historicalData)
// Output fields align with your orchestrator expectations.




export function getLayer2MLAnalysis(stock, historicalData) {
  if (!historicalData || historicalData.length < 90) {
    return {
      mlScore: -5,
      features: {},
      longTermRegime: {
        type: "UNKNOWN",
        characteristics: ["INSUFFICIENT_HISTORY"],
      },
      shortTermRegime: {
        type: "UNKNOWN",
        characteristics: ["INSUFFICIENT_HISTORY"],
      },
    };
  }

  // Chronological
  const sortedAll = [...historicalData].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );

  // Windows
  const ctxWin = sortedAll.slice(-Math.min(180, sortedAll.length)); // context
  const stWin = sortedAll.slice(-Math.min(30, sortedAll.length)); // timing
  const midWin = sortedAll.slice(-Math.min(90, sortedAll.length)); // short-term regime base

  // ---- 1) Analyses (ordered to preserve fX_* keys your orchestrator uses)
  const microstructure = analyzeMicrostructure(stWin); // f0
  const volumeProfile = analyzeVolumeProfile(sortedAll.slice(-30)); // f1
  const priceActionQuality = analyzePriceActionQuality(ctxWin); // f2
  const hiddenDivergences = detectHiddenDivergences(stock, stWin); // f3
  const longTermRegime = detectMarketRegime(sortedAll); // f4
  const volatilityRegime = analyzeVolatilityRegime(stock, ctxWin); // f6 (order kept later)
  const advancedPatterns = detectAdvancedPatterns(stWin, volatilityRegime); // f5
  const orderFlow = inferOrderFlow(stWin); // f7
  const extensionAnalysis = analyzeExtension(stock, ctxWin); // f8
  const trendQuality = analyzeTrendQuality(stock, ctxWin); // f9
  const momentumAnalysis = analyzeMomentumPersistence(stock, stWin); // f10
  const institutionalAct = detectInstitutionalActivity(sortedAll); // f11

  // ---- 2) Features vector (f0..f11 key space preserved)
  const features = extractFeatureVector(
    microstructure, // f0
    volumeProfile, // f1
    priceActionQuality, // f2
    hiddenDivergences, // f3
    longTermRegime, // f4
    advancedPatterns, // f5
    volatilityRegime, // f6
    orderFlow, // f7
    extensionAnalysis, // f8
    trendQuality, // f9
    momentumAnalysis, // f10
    institutionalAct // f11
  );

  // ---- 3) Base ML-like score from features
  let mlScore = calculateMLScore(features);

  // ---- 4) Regime/contextual adjustments (kept simple & bounded)
  let regimeAdjustment = 0;
  const has = (arr, s) => Array.isArray(arr) && arr.includes(s);

  const isLongDown =
    longTermRegime.type === "TRENDING" &&
    has(longTermRegime.characteristics, "DOWNTREND");
  const isLongUp =
    longTermRegime.type === "TRENDING" &&
    has(longTermRegime.characteristics, "UPTREND");
  const shortTermRegime = detectMarketRegime(midWin);

  const isShortDown =
    shortTermRegime.type === "TRENDING" &&
    has(shortTermRegime.characteristics, "DOWNTREND");
  const isShortUp =
    shortTermRegime.type === "TRENDING" &&
    has(shortTermRegime.characteristics, "UPTREND");
  const isShortRange = shortTermRegime.type === "RANGE_BOUND";

  if (isLongDown) {
    if (isShortDown) regimeAdjustment = -4.0;
    else if (isShortRange) regimeAdjustment = -1.5;
    else if (isShortUp) regimeAdjustment = 2.0;
  } else if (isLongUp) {
    if (isShortUp && !extensionAnalysis.parabolicMove) regimeAdjustment = 1.5;
    else if (isShortDown) regimeAdjustment = 0.5;
  } else if (longTermRegime.type === "RANGE_BOUND") {
    if (priceActionQuality.nearRangeLow) regimeAdjustment = 2.0;
    else if (priceActionQuality.nearRangeHigh) regimeAdjustment = -2.5;
  } else if (
    longTermRegime.type === "CHOPPY" ||
    longTermRegime.type === "UNKNOWN"
  ) {
    regimeAdjustment = -3.0;
  }
  mlScore += regimeAdjustment;

  // Contextual combos
  if (microstructure.bullishAuction && volumeProfile.pocRising) mlScore += 2.0;
  if (microstructure.sellerExhaustion && orderFlow.buyingPressure)
    mlScore += 3.0;
  if (hiddenDivergences.bullishHidden && trendQuality.isHealthyTrend)
    mlScore += 2.0;
  if (advancedPatterns.wyckoffSpring) mlScore += 3.5;
  if (advancedPatterns.wyckoffUpthrust) mlScore -= 3.0;
  if (advancedPatterns.threePushes && extensionAnalysis.isExtended)
    mlScore -= 3.0;
  if (volatilityRegime.compression && advancedPatterns.coiledSpring)
    mlScore += 2.5;
  if (advancedPatterns.failedBreakout) mlScore -= 2.0;
  if (advancedPatterns.successfulRetest) mlScore += 1.5;

  // Soft clamp
  mlScore = clamp(mlScore, -3, 3);

  return { mlScore, features, longTermRegime, shortTermRegime };
}

/* ──────────── Microstructure ──────────── */
function analyzeMicrostructure(data) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const analysis = {
    bullishAuction: false,
    bearishAuction: false,
    sellerExhaustion: false,
    buyerExhaustion: false,
    deltaProfile: "NEUTRAL",
  };
  if (!data || data.length < 20) return analysis;

  const recent = data.slice(-10);
  let bullishBars = 0,
    bearishBars = 0;
  let totalBullVolume = 0,
    totalBearVolume = 0;

  recent.forEach((bar) => {
    const high = n(bar.high),
      low = n(bar.low),
      open = n(bar.open),
      close = n(bar.close),
      vol = n(bar.volume);
    const range = Math.max(0, high - low);
    const body = Math.abs(close - open);
    const upperWick = Math.max(0, high - Math.max(close, open));
    const lowerWick = Math.max(0, Math.min(close, open) - low);

    if (close > open) {
      bullishBars++;
      totalBullVolume += vol * (range > 0 ? body / range : 0.5);
      if (lowerWick > body * 2) analysis.sellerExhaustion = true;
    } else if (close < open) {
      bearishBars++;
      totalBearVolume += vol * (range > 0 ? body / range : 0.5);
      if (upperWick > body * 2) analysis.buyerExhaustion = true;
    }
  });

  const denom = totalBullVolume + totalBearVolume;
  const volumeRatio = denom > 0 ? totalBullVolume / denom : 0.5;

  analysis.bullishAuction = volumeRatio > 0.65 && bullishBars > bearishBars;
  analysis.bearishAuction = volumeRatio < 0.35 && bearishBars > bullishBars;

  if (volumeRatio > 0.7) analysis.deltaProfile = "STRONG_BULLISH";
  else if (volumeRatio > 0.55) analysis.deltaProfile = "BULLISH";
  else if (volumeRatio < 0.3) analysis.deltaProfile = "STRONG_BEARISH";
  else if (volumeRatio < 0.45) analysis.deltaProfile = "BEARISH";

  return analysis;
}

/* ──────────── Volume Profile (POC trend over time) ──────────── */
function analyzeVolumeProfile(data) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const profile = {
    pocRising: false,
    pocFalling: false,
    highVolumeNode: null,
    lowVolumeNode: null,
    volumeTrend: "NEUTRAL",
  };
  if (!data || data.length < 30) return profile;

  const last30 = data.slice(-30);
  const split = 15;

  const bucketedPOC = (arr) => {
    const avgPrice =
      arr.reduce((s, d) => s + (n(d.high) + n(d.low)) / 2, 0) / arr.length;
    const step = Math.max(1e-8, Math.abs(avgPrice) * 0.005);
    const buckets = {};
    arr.forEach((d) => {
      const mid = (n(d.high) + n(d.low)) / 2;
      const b = Math.round(mid / step) * step;
      buckets[b] = (buckets[b] || 0) + n(d.volume);
    });
    let best = { p: null, v: -1 },
      worst = { p: null, v: Number.POSITIVE_INFINITY };
    Object.entries(buckets).forEach(([p, v]) => {
      const price = +p;
      if (v > best.v) best = { p: price, v };
      if (v > 0 && v < worst.v) worst = { p: price, v };
    });
    return { poc: best.p, lvn: worst.p };
  };

  const early = bucketedPOC(last30.slice(0, split));
  const late = bucketedPOC(last30.slice(split));

  if (Number.isFinite(early.poc) && Number.isFinite(late.poc)) {
    profile.pocRising = late.poc > early.poc * 1.002; // +0.2%
    profile.pocFalling = late.poc < early.poc * 0.998; // -0.2%
  }

  profile.highVolumeNode = late.poc ?? early.poc ?? null;
  profile.lowVolumeNode = late.lvn ?? early.lvn ?? null;

  const vol10 = last30.slice(-10).reduce((s, d) => s + n(d.volume), 0) / 10;
  const vol30 = last30.reduce((s, d) => s + n(d.volume), 0) / 30;
  if (vol10 > vol30 * 1.2) profile.volumeTrend = "INCREASING";
  else if (vol10 < vol30 * 0.8) profile.volumeTrend = "DECREASING";

  return profile;
}

/* ──────────── Price Action Quality ──────────── */
function analyzePriceActionQuality(data) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const quality = {
    clean: false,
    choppy: false,
    impulsive: false,
    corrective: false,
    nearRangeHigh: false,
    nearRangeLow: false,
    trendEfficiency: 0,
  };
  if (!data || data.length < 20) return quality;

  const prices = data.map((d) => n(d.close));
  const highs = data.map((d) => n(d.high));
  const lows = data.map((d) => n(d.low));

  const startPrice = prices[prices.length - 20];
  const endPrice = prices[prices.length - 1];
  const directionalMove = Math.abs(endPrice - startPrice);

  let totalMove = 0;
  for (let i = prices.length - 19; i < prices.length; i++) {
    totalMove += Math.abs(prices[i] - prices[i - 1]);
  }

  quality.trendEfficiency = totalMove > 0 ? directionalMove / totalMove : 0;
  quality.clean = quality.trendEfficiency > 0.7;
  quality.choppy = quality.trendEfficiency < 0.3;
  quality.impulsive =
    quality.trendEfficiency > 0.6 &&
    Math.abs(endPrice - startPrice) / Math.max(1e-8, startPrice) > 0.05;
  quality.corrective =
    quality.trendEfficiency < 0.5 &&
    Math.abs(endPrice - startPrice) / Math.max(1e-8, startPrice) < 0.03;

  const rangeHigh = Math.max(...highs.slice(-20));
  const rangeLow = Math.min(...lows.slice(-20));
  const currentPrice = prices[prices.length - 1];

  quality.nearRangeHigh =
    currentPrice > rangeLow + (rangeHigh - rangeLow) * 0.8;
  quality.nearRangeLow = currentPrice < rangeLow + (rangeHigh - rangeLow) * 0.2;

  return quality;
}

/* ──────────── Hidden Divergences (via RSI series) ──────────── */
function detectHiddenDivergences(stock, data) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const divergences = {
    bullishHidden: false,
    bearishHidden: false,
    strength: 0,
  };
  if (!data || data.length < 30) return divergences;

  const closes = data.map((d) => n(d.close));
  const rsi = stock?._rsiSeries14 || _calculateRSI(closes, 14);
  if (!rsi || rsi.length < closes.length - 1) {
    const r = _calculateRSI(closes, 14);
    if (!r || r.length === 0) return divergences;
  }

  const swingLows = [],
    swingHighs = [];
  for (let i = 5; i < data.length - 5; i++) {
    if (
      closes[i] < closes[i - 2] &&
      closes[i] < closes[i + 2] &&
      closes[i] < closes[i - 4] &&
      closes[i] < closes[i + 4]
    )
      swingLows.push(i);

    if (
      closes[i] > closes[i - 2] &&
      closes[i] > closes[i + 2] &&
      closes[i] > closes[i - 4] &&
      closes[i] > closes[i + 4]
    )
      swingHighs.push(i);
  }

  // Hidden bullish: price HL while RSI makes LL
  if (swingLows.length >= 2) {
    const a = swingLows[swingLows.length - 2];
    const b = swingLows[swingLows.length - 1];
    if (closes[b] > closes[a] && (rsi[b] ?? 50) < (rsi[a] ?? 50)) {
      divergences.bullishHidden = true;
      divergences.strength = Math.abs((rsi[a] ?? 50) - (rsi[b] ?? 50));
    }
  }

  // Hidden bearish: price LH while RSI makes HH
  if (swingHighs.length >= 2) {
    const a = swingHighs[swingHighs.length - 2];
    const b = swingHighs[swingHighs.length - 1];
    if (closes[b] < closes[a] && (rsi[b] ?? 50) > (rsi[a] ?? 50)) {
      divergences.bearishHidden = true;
      divergences.strength = Math.max(
        divergences.strength,
        Math.abs((rsi[a] ?? 50) - (rsi[b] ?? 50))
      );
    }
  }

  return divergences;
}

/* ──────────── Market Regime (log-price regression) ──────────── */
function detectMarketRegime(historicalData) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const regime = {
    type: "UNKNOWN",
    strength: 0,
    volatility: "NORMAL",
    characteristics: [],
  };
  if (!historicalData || historicalData.length < 60) {
    regime.characteristics.push("INSUFFICIENT_HISTORY");
    return regime;
  }

  const data = historicalData.slice(-252);
  const prices = data.map((d) => n(d.close)).map((p) => Math.max(1e-8, p));
  const logs = prices.map((p) => Math.log(p));

  const returns = [];
  for (let i = 1; i < prices.length; i++)
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);

  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const varSum = returns.reduce(
    (sum, r) => sum + Math.pow(r - avgReturn, 2),
    0
  );
  const dailyVolatility = Math.sqrt(varSum / Math.max(1, returns.length - 1));
  const annualVolatility = dailyVolatility * Math.sqrt(252);

  const x = Array.from({ length: logs.length }, (_, i) => i);
  const { slope, r2 } = linearRegression(x, logs);

  if (r2 > 0.4 && slope > 0) {
    regime.type = "TRENDING";
    regime.strength = r2;
    regime.characteristics.push("UPTREND");
  } else if (r2 > 0.4 && slope < 0) {
    regime.type = "TRENDING";
    regime.strength = r2;
    regime.characteristics.push("DOWNTREND");
  } else if (annualVolatility < 0.25) {
    regime.type = "RANGE_BOUND";
    regime.strength = Math.max(0, 1 - annualVolatility);
    regime.characteristics.push("LOW_VOLATILITY");
  } else {
    regime.type = "CHOPPY";
    regime.strength = annualVolatility;
    regime.characteristics.push("HIGH_VOLATILITY");
  }

  if (annualVolatility > 0.45) regime.volatility = "HIGH";
  else if (annualVolatility < 0.25) regime.volatility = "LOW";

  return regime;
}

/* ──────────── Advanced Patterns ──────────── */
function detectAdvancedPatterns(data, volatilityRegime) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const patterns = {
    wyckoffSpring: false,
    wyckoffUpthrust: false,
    threePushes: false,
    coiledSpring: false,
    failedBreakout: false,
    successfulRetest: false,
    failedBreakdown: false, // internal helper flag (not used by orchestrator)
  };
  if (!data || data.length < 30) return patterns;

  const highs = data.map((d) => n(d.high));
  const lows = data.map((d) => n(d.low));
  const closes = data.map((d) => n(d.close));
  const volumes = data.map((d) => n(d.volume));

  // Support/Resistance from prior 15 bars (lookback within last 20)
  const recentLows = lows.slice(-20);
  const supportLevel = Math.min(...recentLows.slice(0, 15));
  const recentHighs = highs.slice(-20);
  const resistanceLevel = Math.max(...recentHighs.slice(0, 15));

  const last5 = data.slice(-5);
  const avgVol15 = volumes.slice(-20, -5).reduce((a, b) => a + b, 0) / 15 || 0;

  // Wyckoff Spring
  const springCandidate = last5.find(
    (d) =>
      n(d.low) < supportLevel * 0.99 &&
      n(d.close) > supportLevel &&
      n(d.volume) > avgVol15 * 1.5
  );
  if (springCandidate && closes[closes.length - 1] > supportLevel * 1.01) {
    patterns.wyckoffSpring = true;
  }

  // Failed Breakdown (helper / for microstructure pairing)
  const fbd = last5.find(
    (d) =>
      n(d.low) < supportLevel * 0.995 &&
      n(d.close) < supportLevel &&
      n(d.volume) > avgVol15 * 1.3
  );
  if (fbd) patterns.failedBreakdown = true;

  // Wyckoff Upthrust
  for (let i = Math.max(0, data.length - 5); i < data.length; i++) {
    const d = data[i];
    const high = n(d.high),
      close = n(d.close),
      vol = n(d.volume);
    if (
      high > resistanceLevel * 1.005 &&
      close < resistanceLevel &&
      vol > avgVol15 * 1.3
    ) {
      patterns.wyckoffUpthrust = true;
      break;
    }
  }

  // Breakout detection and quick failure or successful retest
  let confirmedBreakoutIdx = null;
  for (let i = data.length - 8; i < data.length; i++) {
    if (i < 0) continue;
    if (n(data[i]?.close) > resistanceLevel * 1.005) {
      confirmedBreakoutIdx = i;
      break;
    }
  }
  if (confirmedBreakoutIdx != null) {
    const failWindowEnd = Math.min(data.length - 1, confirmedBreakoutIdx + 3);
    for (let j = confirmedBreakoutIdx + 1; j <= failWindowEnd; j++) {
      if (n(data[j].close) < resistanceLevel) {
        patterns.failedBreakout = true;
        break;
      }
    }
    if (!patterns.failedBreakout) {
      for (
        let j = confirmedBreakoutIdx + 1;
        j <= Math.min(data.length - 1, confirmedBreakoutIdx + 5);
        j++
      ) {
        const low = n(data[j].low),
          close = n(data[j].close),
          open = n(data[j].open);
        const near =
          Math.abs(low - resistanceLevel) / Math.max(1e-8, resistanceLevel) <
          0.01;
        const reclaim = close > resistanceLevel && close > open;
        if (near && reclaim) {
          patterns.successfulRetest = true;
          break;
        }
      }
    }
  }

  // Three pushes (simple impulse segmentation)
  const pushes = findPushes(highs.slice(-30));
  if (pushes.length >= 3 && pushes[pushes.length - 1].declining)
    patterns.threePushes = true;

  // Coiled spring via volatility regime
  patterns.coiledSpring =
    Boolean(volatilityRegime?.compression) &&
    (volatilityRegime?.cyclePhase === "COMPRESSION_ONGOING" ||
      volatilityRegime?.cyclePhase === "EXPANSION_STARTING");

  return patterns;
}

/* ──────────── Volatility Regime ──────────── */
function analyzeVolatilityRegime(stock, data) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const analysis = {
    regime: "NORMAL",
    compression: false,
    expansion: false,
    cyclePhase: "UNKNOWN",
    bollingerSqueeze: false,
  };
  if (!data || data.length < 30) return analysis;

  const period = 14;
  const atr =
    Number.isFinite(stock?.atr14) && stock.atr14 > 0
      ? stock.atr14
      : calculateATR(data.slice(-(period + 1)), period); // 15 bars needed for ATR(14)

  const historicalATRs = [];
  for (let i = period + 1; i <= data.length; i++) {
    const win = data.slice(i - (period + 1), i);
    historicalATRs.push(calculateATR(win, period));
  }
  if (historicalATRs.length === 0) return analysis;

  const avgATR =
    historicalATRs.reduce((a, b) => a + b, 0) / historicalATRs.length;
  const currentATRRatio = avgATR > 0 ? atr / avgATR : 1;

  if (currentATRRatio < 0.7) {
    analysis.regime = "LOW";
    analysis.compression = true;
  } else if (currentATRRatio > 1.3) {
    analysis.regime = "HIGH";
    analysis.expansion = true;
  }

  const upper = n(stock?.bollingerUpper),
    lower = n(stock?.bollingerLower),
    mid = n(stock?.bollingerMid);
  if (upper > 0 && lower > 0 && mid > 0) {
    const bbWidth = (upper - lower) / mid;
    if (bbWidth < 0.05) analysis.bollingerSqueeze = true;
  }

  if (historicalATRs.length >= 2) {
    const last = historicalATRs[historicalATRs.length - 1];
    const prev = historicalATRs[historicalATRs.length - 2];
    if (analysis.compression && last < prev)
      analysis.cyclePhase = "COMPRESSION_ONGOING";
    else if (analysis.compression && last > prev)
      analysis.cyclePhase = "EXPANSION_STARTING";
  }

  return analysis;
}

/* ──────────── Order Flow (absorption via median range) ──────────── */
function inferOrderFlow(data) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const flow = {
    buyingPressure: false,
    sellingPressure: false,
    absorption: false,
    imbalance: 0,
  };
  if (!data || data.length < 20) return flow;

  const recent = data.slice(-20);
  const avgVol = recent.reduce((s, d) => s + n(d.volume), 0) / recent.length;

  const ranges = recent.map((d) => n(d.high) - n(d.low)).filter((x) => x > 0);
  ranges.sort((a, b) => a - b);
  const medRange = ranges[Math.floor(ranges.length / 2)] || 0;
  const tightThresh = medRange * 0.6;

  let buyV = 0,
    sellV = 0,
    absorb = 0;

  recent.forEach((bar) => {
    const high = n(bar.high),
      low = n(bar.low),
      close = n(bar.close),
      vol = n(bar.volume);
    const range = Math.max(0, high - low);
    const closePos = range > 0 ? (close - low) / range : 0.5;
    buyV += vol * closePos;
    sellV += vol * (1 - closePos);
    if (vol > avgVol * 1.5 && range < tightThresh) absorb++;
  });

  const denom = buyV + sellV;
  flow.imbalance = denom > 0 ? (buyV - sellV) / denom : 0;
  flow.buyingPressure = flow.imbalance > 0.2;
  flow.sellingPressure = flow.imbalance < -0.2;
  flow.absorption = absorb >= 2;

  return flow;
}

/* ──────────── Extension / Trend / Momentum ──────────── */
function analyzeExtension(stock, recentData) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  if (!recentData || recentData.length < 20)
    return { isExtended: false, parabolicMove: false };

  const closes = recentData.map((d) => n(d.close));
  const currentPrice = closes[closes.length - 1];
  const sma20 = closes.slice(-20).reduce((s, v) => s + v, 0) / 20;

  const distanceFromMean =
    sma20 > 0 ? ((currentPrice - sma20) / sma20) * 100 : 0;
  const isExtended = distanceFromMean > 15;

  const pNow = closes[closes.length - 1];
  const p_5 = closes[closes.length - 6];
  const p_10 = closes[closes.length - 11];
  const changeLast5 = p_5 > 0 ? pNow / p_5 - 1 : 0;
  const changePrev5 = p_10 > 0 ? p_5 / p_10 - 1 : 0;
  const parabolicMove = changeLast5 > changePrev5 * 2 && changeLast5 > 0.08;

  return { isExtended, parabolicMove };
}

function analyzeTrendQuality(stock, recentData) {
  if (!recentData || recentData.length < 30)
    return { isHealthyTrend: false, trendStrength: 0 };
  const adxResult = _calculateADX(recentData.slice(-30), 14);
  const currentADX = adxResult.length
    ? adxResult[adxResult.length - 1].adx || 0
    : 0;
  return { isHealthyTrend: currentADX > 25, trendStrength: currentADX };
}

function analyzeMomentumPersistence(stock, recentData) {
  if (!recentData || recentData.length < 20) return { persistentStrength: 0 };
  const closes = recentData.map((d) =>
    Number.isFinite(d.close) ? d.close : 0
  );
  const rsiValues = _calculateRSI(closes, 14);
  const recentRSI = rsiValues.slice(-10);
  const daysBull = recentRSI.filter((v) => v > 55).length;
  return { persistentStrength: daysBull / 10 };
}

/* ──────────── Institutional Activity ──────────── */
function detectInstitutionalActivity(recentData) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  if (!recentData || recentData.length < 51)
    return { accumulationDays: 0, distributionDays: 0, isAccumulating: false };

  const relevant = recentData.slice(-51);
  const avgVolume50 =
    relevant.slice(0, 50).reduce((s, d) => s + n(d.volume), 0) / 50;

  let accumulationDays = 0,
    distributionDays = 0;
  const checkData = recentData.slice(-25);

  checkData.forEach((day, i) => {
    if (i === 0) return;
    const prev = checkData[i - 1];
    if (n(day.volume) > avgVolume50 * 1.5) {
      if (n(day.close) > n(prev.close)) accumulationDays++;
      else if (n(day.close) < n(prev.close)) distributionDays++;
    }
  });

  const isAccumulating = accumulationDays > distributionDays + 2;
  return { accumulationDays, distributionDays, isAccumulating };
}

/* ──────────── RSI / ADX ──────────── */
function _calculateRSI(prices, period) {
  const rsi = [];
  if (!prices || prices.length < period + 1) return rsi;

  let gains = 0,
    losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period; i < prices.length; i++) {
    const rs = avgLoss ? avgGain / avgLoss : avgGain ? Infinity : 0;
    rsi.push(100 - 100 / (1 + rs));

    const diff = prices[i] - prices[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  return rsi;
}

function _calculateADX(data, period) {
  if (!data || data.length < period + 2)
    return data.map((d) => ({ ...d, adx: 0 }));

  const trs = [],
    plusDMs = [],
    minusDMs = [];
  for (let i = 1; i < data.length; i++) {
    const h = data[i].high,
      l = data[i].low,
      pc = data[i - 1].close,
      ph = data[i - 1].high,
      pl = data[i - 1].low;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trs.push(tr);

    const upMove = h - ph;
    const downMove = pl - l;
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  const wilderSmooth = (arr, p) => {
    if (arr.length < p) return [];
    const smoothed = [];
    let sum = arr.slice(0, p).reduce((a, b) => a + b, 0);
    smoothed.push(sum);
    for (let i = p; i < arr.length; i++) {
      sum =
        smoothed[smoothed.length - 1] -
        smoothed[smoothed.length - 1] / p +
        arr[i];
      smoothed.push(sum);
    }
    return smoothed;
  };

  const smTR = wilderSmooth(trs, period);
  const smPDM = wilderSmooth(plusDMs, period);
  const smMDM = wilderSmooth(minusDMs, period);

  const plusDI = smTR.map((v, i) => 100 * (smPDM[i] / (v || 1)));
  const minusDI = smTR.map((v, i) => 100 * (smMDM[i] / (v || 1)));

  const dxs = plusDI.map(
    (p, i) => 100 * (Math.abs(p - minusDI[i]) / Math.max(1e-8, p + minusDI[i]))
  );
  const adxValues = wilderSmooth(dxs, period).map((v) => v / period);

  return data
    .slice(-adxValues.length)
    .map((d, i) => ({ ...d, adx: adxValues[i] }));
}

/* ──────────── Feature Extraction & Scoring ──────────── */
function extractFeatureVector(...analyses) {
  const features = {};
  analyses.forEach((analysis, idx) => {
    Object.entries(analysis).forEach(([key, value]) => {
      if (typeof value === "boolean") {
        features[`f${idx}_${key}`] = value ? 1 : 0;
      } else if (typeof value === "number") {
        features[`f${idx}_${key}`] = value;
      } else if (typeof value === "string") {
        features[`f${idx}_${key}_${value}`] = 1; // one-hot
      } else if (Array.isArray(value)) {
        value.forEach((v) => (features[`f${idx}_${key}_${v}`] = 1));
      }
    });
  });
  return features;
}

function calculateMLScore(features) {
  let score = 0;

  // Quality hurdle
  let qualityHurdle = 0;
  if (features.f2_clean) qualityHurdle++;
  if (features.f9_isHealthyTrend) qualityHurdle++;
  if (features.f4_type_TRENDING) qualityHurdle++;
  if (qualityHurdle < 2) score -= 2.0;

  // Learned combos (kept from your prior mapping)
  if (features.f0_bullishAuction && features.f1_pocRising && features.f2_clean)
    score += 3.0;
  if (features.f3_bullishHidden && features.f9_isHealthyTrend) score += 2.5;
  if (features.f3_bearishHidden && features.f8_isExtended) score -= 2.5;
  if (features.f5_wyckoffSpring && features.f7_buyingPressure) score += 4.0;
  if (features.f0_sellerExhaustion && features.f6_compression) score += 2.3;

  // Negatives
  if (features.f5_threePushes && features.f8_parabolicMove) score -= 4.0;
  if (features.f5_wyckoffUpthrust && features.f1_pocFalling) score -= 3.0;
  if (features.f5_failedBreakout) score -= 2.0;

  // Non-linear momentum x trend
  const momentumScore =
    (features.f10_persistentStrength || 0) *
    (1 + (features.f9_trendStrength || 0) / 10);
  score += momentumScore;

  // Volatility expansion + impulsive action
  if (features.f6_cyclePhase_EXPANSION_STARTING && features.f2_impulsive) {
    score *= 1.25;
  }

  return score;
}

/* ──────────── Misc Helpers ──────────── */
function linearRegression(x, y) {
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((s, xi, i) => s + xi * y[i], 0);
  const sumXX = x.reduce((s, xi) => s + xi * xi, 0);

  const denom = n * sumXX - sumX * sumX;
  const slope = denom ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;

  const yMean = sumY / n;
  const ssTotal = y.reduce((s, yi) => s + Math.pow(yi - yMean, 2), 0);
  const ssResidual = y.reduce(
    (s, yi, i) => s + Math.pow(yi - (slope * x[i] + intercept), 2),
    0
  );
  const r2 = ssTotal ? 1 - ssResidual / ssTotal : 0;

  return { slope, intercept, r2 };
}

function findPushes(prices) {
  const pushes = [];
  let currentPush = null;

  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > prices[i - 1]) {
      if (!currentPush)
        currentPush = { start: i - 1, startPrice: prices[i - 1] };
    } else if (currentPush) {
      currentPush.end = i - 1;
      currentPush.endPrice = prices[i - 1];
      currentPush.gain =
        (currentPush.endPrice - currentPush.startPrice) /
        Math.max(1e-8, currentPush.startPrice);
      pushes.push(currentPush);
      currentPush = null;
    }
  }
  if (pushes.length >= 2) {
    const last = pushes[pushes.length - 1];
    const prev = pushes[pushes.length - 2];
    last.declining = last.gain < prev.gain;
  }
  return pushes;
}

/**
 * ATR over a window with (period+1) bars for TR calculation.
 * @param {Array} historicalData
 * @param {number} period
 */
function calculateATR(historicalData, period = 14) {
  if (!historicalData || historicalData.length < period + 1) return 0;
  const trs = [];
  for (let i = 1; i < historicalData.length; i++) {
    const h = historicalData[i].high,
      l = historicalData[i].low,
      pc = historicalData[i - 1].close;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trs.push(tr);
  }
  const last = trs.slice(-period);
  return last.reduce((s, v) => s + v, 0) / period;
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}
