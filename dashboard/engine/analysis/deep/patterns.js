// ================== Patterns, Regime, Trend & Helpers ==================
import { calculateRSISeries, calculateATR as calcATRFromIndicators } from "../../indicators.js";
import { num as n } from "../../helpers.js";

/** ATR — delegates to canonical indicators.js */
const calculateATR = calcATRFromIndicators;

/* ──────────── Price Action Quality ──────────── */
export function analyzePriceActionQuality(data) {
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

/* ──────────── Hidden Divergences ──────────── */
export function detectHiddenDivergences(stock, data) {
  const divergences = {
    bullishHidden: false,
    bearishHidden: false,
    strength: 0,
  };
  if (!data || data.length < 30 || !Number.isFinite(stock?.rsi14))
    return divergences;

  const prices = data.map((d) => n(d.close));
  const swingLows = [],
    swingHighs = [];

  for (let i = 5; i < data.length - 5; i++) {
    if (
      prices[i] < prices[i - 2] &&
      prices[i] < prices[i + 2] &&
      prices[i] < prices[i - 4] &&
      prices[i] < prices[i + 4]
    ) {
      swingLows.push({ index: i, price: prices[i] });
    }
    if (
      prices[i] > prices[i - 2] &&
      prices[i] > prices[i + 2] &&
      prices[i] > prices[i - 4] &&
      prices[i] > prices[i + 4]
    ) {
      swingHighs.push({ index: i, price: prices[i] });
    }
  }

  if (swingLows.length >= 2) {
    const a = swingLows[swingLows.length - 2];
    const b = swingLows[swingLows.length - 1];
    if (b.price > a.price) {
      const mA = calculateMomentumAtPoint(data, a.index);
      const mB = calculateMomentumAtPoint(data, b.index);
      if (mB < mA) {
        divergences.bullishHidden = true;
        divergences.strength = Math.abs(mB - mA);
      }
    }
  }

  if (swingHighs.length >= 2) {
    const a = swingHighs[swingHighs.length - 2];
    const b = swingHighs[swingHighs.length - 1];
    if (b.price < a.price) {
      const mA = calculateMomentumAtPoint(data, a.index);
      const mB = calculateMomentumAtPoint(data, b.index);
      if (mB > mA) {
        divergences.bearishHidden = true;
        divergences.strength = Math.max(
          divergences.strength,
          Math.abs(mB - mA)
        );
      }
    }
  }

  return divergences;
}

/* ──────────── Market Regime ──────────── */
export function detectMarketRegime(historicalData) {
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
  const prices = data.map((d) => n(d.close));
  const returns = [];
  for (let i = 1; i < prices.length; i++)
    returns.push((prices[i] - prices[i - 1]) / Math.max(1e-8, prices[i - 1]));

  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const varSum = returns.reduce(
    (sum, r) => sum + Math.pow(r - avgReturn, 2),
    0
  );
  const dailyVolatility = Math.sqrt(varSum / Math.max(1, returns.length - 1));
  const annualVolatility = dailyVolatility * Math.sqrt(252);

  const xValues = Array.from({ length: prices.length }, (_, i) => i);
  const { slope, r2 } = linearRegression(xValues, prices);

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
export function detectAdvancedPatterns(data, volatilityRegime) {
  const patterns = {
    wyckoffSpring: false,
    wyckoffUpthrust: false,
    threePushes: false,
    coiledSpring: false,
    failedBreakout: false,
    successfulRetest: false,
  };
  if (!data || data.length < 30) return patterns;

  const highs = data.map((d) => n(d.high));
  const lows = data.map((d) => n(d.low));
  const closes = data.map((d) => n(d.close));
  const volumes = data.map((d) => n(d.volume));

  // --- Wyckoff Spring
  const recentLows = lows.slice(-20);
  const supportLevel = Math.min(...recentLows.slice(0, 15));
  const last5 = data.slice(-5);
  const avgVol15 = volumes.slice(-20, -5).reduce((a, b) => a + b, 0) / 15 || 0;

  const springCandidate = last5.find(
    (d) =>
      n(d.low) < supportLevel * 0.99 &&
      n(d.close) > supportLevel &&
      n(d.volume) > avgVol15 * 1.5
  );
  if (springCandidate && closes[closes.length - 1] > supportLevel * 1.01) {
    patterns.wyckoffSpring = true;
  }

  // --- Upthrust / failed breakout / successful retest (resistance-based)
  const baseWindow = data.slice(-25, -5);
  if (baseWindow.length >= 5) {
    const resistance = Math.max(...baseWindow.map((d) => n(d.high)));
    const tol = 0.005; // 0.5%

    // Upthrust: pierce above resistance intraday, close back below, on higher volume
    const last3 = data.slice(-3);
    const upthrustBar = last3.find(
      (d) =>
        n(d.high) > resistance * (1 + tol) &&
        n(d.close) < resistance &&
        n(d.volume) > (avgVol15 || 1)
    );
    if (upthrustBar) patterns.wyckoffUpthrust = true;

    // Failed breakout: had a close above, then back below within 2 bars
    const last5Bars = data.slice(-5);
    const hadCloseAbove = last5Bars.some(
      (d) => n(d.close) > resistance * (1 + tol / 2)
    );
    const nowBelow = n(closes[closes.length - 1]) < resistance;
    if (hadCloseAbove && nowBelow) patterns.failedBreakout = true;

    // Successful retest: close > resistance but low tags resistance +/-0.3%
    const today = data[data.length - 1];
    const retestTouched =
      n(today.low) <= resistance * 1.003 && n(today.low) >= resistance * 0.997;
    if (n(today.close) > resistance * (1 + tol / 2) && retestTouched) {
      patterns.successfulRetest = true;
    }
  }

  // --- Three pushes
  const pushes = findPushes(highs.slice(-30));
  if (pushes.length >= 3 && pushes[pushes.length - 1].declining)
    patterns.threePushes = true;

  // --- Coiled spring
  patterns.coiledSpring =
    Boolean(volatilityRegime?.compression) &&
    (volatilityRegime?.cyclePhase === "COMPRESSION_ONGOING" ||
      volatilityRegime?.cyclePhase === "EXPANSION_STARTING");

  return patterns;
}

/* ──────────── Volatility Regime ──────────── */
export function analyzeVolatilityRegime(stock, data) {
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
      : calculateATR(data.slice(-(period + 1)), period); // need 15 bars for ATR(14)

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

/* ──────────── Extension ──────────── */
export function analyzeExtension(stock, recentData) {
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

/* ──────────── Trend Quality ──────────── */
export function analyzeTrendQuality(stock, recentData) {
  if (!recentData || recentData.length < 30)
    return { isHealthyTrend: false, trendStrength: 0 };
  const adxResult = _calculateADX(recentData.slice(-30), 14);
  const currentADX = adxResult.length
    ? adxResult[adxResult.length - 1].adx || 0
    : 0;
  return { isHealthyTrend: currentADX > 25, trendStrength: currentADX };
}

/* ──────────── Momentum Persistence ──────────── */
export function analyzeMomentumPersistence(stock, recentData) {
  if (!recentData || recentData.length < 20) return { persistentStrength: 0 };
  const closes = recentData.map((d) =>
    Number.isFinite(d.close) ? d.close : 0
  );
  const rsiValues = _calculateRSI(closes, 14);
  const recentRSI = rsiValues.slice(-10);
  const daysBull = recentRSI.filter((v) => v > 55).length;
  return { persistentStrength: daysBull / 10 };
}

/* ──────────── Private Helpers ──────────── */

function calculateMomentumAtPoint(data, index) {
  if (!data || index < 5 || index >= data.length) return 0;
  const price = data[index].close;
  const priceAgo = data[index - 5].close;
  return priceAgo ? (price - priceAgo) / priceAgo : 0;
}

function linearRegression(x, y) {
  const len = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((s, xi, i) => s + xi * y[i], 0);
  const sumXX = x.reduce((s, xi) => s + xi * xi, 0);

  const denom = len * sumXX - sumX * sumX;
  const slope = denom ? (len * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / len;

  const yMean = sumY / len;
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

function _calculateRSI(prices, period) {
  const full = calculateRSISeries(prices, period);
  // Return only non-null values (matching original behavior)
  return full.filter((v) => v !== null);
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
