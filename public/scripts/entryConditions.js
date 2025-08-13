// entryConditions.js
import { n } from "./utils.js";

export function checkEntryConditions(stock, historicalData, cfg) {
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
    currentPrice,
    cfg
  );
  conditions.notOverextended = checkNotOverextended(
    stock,
    recent,
    currentPrice
  );
  conditions.notExhausted = checkNotExhausted(stock, recent);
  conditions.volumeConfirmation = checkEnhancedVolumePattern(recent, stock);
  conditions.momentumAligned = checkEnhancedMomentumAlignment(stock);
  conditions.patternComplete = checkPatternCompletion(recent);

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

/* ── helpers ── */
export function checkEnhancedPullbackToSupport(stock, recent, currentPrice) {
  const ma5 = n(stock.movingAverage5d);
  const ma25 = n(stock.movingAverage25d);
  const ma50 = n(stock.movingAverage50d);
  const ma200 = n(stock.movingAverage200d);
  const last5Lows = recent.slice(-5).map((d) => n(d.low));
  const lowestRecent = Math.min(...last5Lows);

  const mas = [
    { value: ma5, tolerance: 0.02 },
    { value: ma25, tolerance: 0.025 },
    { value: ma50, tolerance: 0.03 },
    { value: ma200, tolerance: 0.035 },
  ];
  for (const ma of mas) {
    if (ma.value > 0) {
      const touchedMA =
        Math.abs(lowestRecent - ma.value) / ma.value < ma.tolerance;
      const bounced = currentPrice > ma.value * 1.005;
      const todayUp = currentPrice > n(stock.openPrice);
      if (touchedMA && bounced && todayUp) return true;
    }
  }

  const prevHighArr = recent.slice(-20, -10).map((d) => n(d.high));
  const previousHigh = Math.max(...prevHighArr, 0);
  if (
    previousHigh > 0 &&
    Math.abs(lowestRecent - previousHigh) / previousHigh < 0.03
  ) {
    if (currentPrice > previousHigh * 0.99) return true;
  }

  const recentSwingHigh = Math.max(...recent.slice(-10).map((d) => n(d.high)));
  const recentSwingLow = Math.min(
    ...recent.slice(-20, -10).map((d) => n(d.low))
  );
  const swingRange = recentSwingHigh - recentSwingLow;
  if (swingRange > 0) {
    const fibs = [
      recentSwingHigh - swingRange * 0.382,
      recentSwingHigh - swingRange * 0.5,
      recentSwingHigh - swingRange * 0.618,
    ];
    for (const level of fibs) {
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

export function checkEnhancedBounceConfirmation(stock, recent, currentPrice) {
  if (recent.length < 3) return false;
  const last3Days = recent.slice(-3);
  const lastDay = recent[recent.length - 1];
  const prevDay = recent[recent.length - 2];

  const range = n(lastDay.high) - n(lastDay.low);
  const body = Math.abs(n(lastDay.close) - n(lastDay.open));
  const lowerWick =
    Math.min(n(lastDay.close), n(lastDay.open)) - n(lastDay.low);
  const hammerPattern =
    range > 0 &&
    body < range * 0.4 &&
    lowerWick > body * 1.5 &&
    n(lastDay.close) >= n(lastDay.open);

  const bullishEngulfing =
    n(prevDay.close) < n(prevDay.open) &&
    n(lastDay.close) > n(lastDay.open) &&
    n(lastDay.open) <= n(prevDay.close) &&
    n(lastDay.close) > n(prevDay.open);

  const morningStar = (() => {
    if (last3Days.length < 3) return false;
    const [d1, d2, d3] = last3Days;
    return (
      n(d1.close) < n(d1.open) &&
      Math.abs(n(d2.close) - n(d2.open)) < (n(d2.high) - n(d2.low)) * 0.3 &&
      n(d3.close) > n(d3.open) &&
      n(d3.close) > (n(d1.open) + n(d1.close)) / 2
    );
  })();

  const higherLowWithVolume =
    n(lastDay.low) > n(prevDay.low) &&
    n(lastDay.close) > n(lastDay.open) &&
    n(lastDay.volume) > n(prevDay.volume) * 1.2;

  const intradayReversal = (() => {
    const ma50 = n(stock.movingAverage50d);
    if (ma50 <= 0) return false;
    return (
      n(lastDay.open) < ma50 &&
      n(lastDay.close) > ma50 &&
      n(lastDay.close) > n(lastDay.open)
    );
  })();

  const todayBullish =
    n(currentPrice) > n(stock.openPrice) &&
    n(currentPrice) > n(stock.prevClosePrice);

  return (
    hammerPattern ||
    bullishEngulfing ||
    morningStar ||
    higherLowWithVolume ||
    intradayReversal ||
    todayBullish
  );
}

export function checkEnhancedVolumePattern(recent, stock) {
  if (recent.length < 20) return false;

  const obv = n(stock.obv);
  const obvRising = obv > 0;

  const avgVolume20 = recent.reduce((s, d) => s + n(d.volume), 0) / 20;
  const avgVolume5 = recent.slice(-5).reduce((s, d) => s + n(d.volume), 0) / 5;

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

export function checkEnhancedMomentumAlignment(stock) {
  const rsi = n(stock.rsi14);
  const macd = n(stock.macd);
  const macdSignal = n(stock.macdSignal);
  const stochK = n(stock.stochasticK);
  const stochD = n(stock.stochasticD);

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

  let alignedSignals = 1;
  if (rsiBullish) alignedSignals++;
  if (macdBullish || macdCrossover) alignedSignals++;
  if (stochasticBullish) alignedSignals++;
  return alignedSignals >= 2;
}

export function checkNotOverextended(stock, recent, currentPrice) {
  const ma5 = n(stock.movingAverage5d);
  const ma25 = n(stock.movingAverage25d);
  const ma50 = n(stock.movingAverage50d);

  const rawATR = n(stock.atr14);
  const atr = Math.max(rawATR, currentPrice * 0.005);
  const priceVolatility = atr / Math.max(1, currentPrice);

  const maxExtension5 = 5 + priceVolatility * 150;
  const maxExtension25 = 8 + priceVolatility * 200;
  const maxExtension50 = 12 + priceVolatility * 250;

  if (ma5 > 0 && ((currentPrice - ma5) / ma5) * 100 > maxExtension5)
    return false;
  if (ma25 > 0 && ((currentPrice - ma25) / ma25) * 100 > maxExtension25)
    return false;
  if (ma50 > 0 && ((currentPrice - ma50) / ma50) * 100 > maxExtension50)
    return false;

  const rsi = n(stock.rsi14);
  if (rsi > 78) return false;

  const bbUpper = n(stock.bollingerUpper);
  if (bbUpper > 0) {
    const bbOvershoot = (currentPrice - bbUpper) / bbUpper;
    if (bbOvershoot > 0.012 && rsi >= 74) return false;
  }

  const fiveDaysAgo = recent[recent.length - 6]?.close;
  if (fiveDaysAgo && fiveDaysAgo > 0) {
    const fiveDayGain = ((currentPrice - fiveDaysAgo) / fiveDaysAgo) * 100;
    const maxGain = 12 + priceVolatility * 350;
    if (fiveDayGain > maxGain) return false;
  }
  return true;
}

export function checkNotExhausted(stock, recent) {
  let exhaustionSignals = 0;
  const last5 = recent.slice(-5);

  const upDaysDecVol = last5.filter(
    (d, i) =>
      i > 0 && n(d.close) > n(d.open) && n(d.volume) < n(last5[i - 1].volume)
  ).length;
  if (upDaysDecVol >= 4) exhaustionSignals++;

  const smallBodies = last5.filter((d) => {
    const range = n(d.high) - n(d.low);
    const body = Math.abs(n(d.close) - n(d.open));
    return range > 0 && body / range < 0.25;
  }).length;
  if (smallBodies >= 4) exhaustionSignals++;

  const rsi = n(stock.rsi14);
  if (rsi > 60 && rsi < 70) {
    const priceHigher =
      n(recent[recent.length - 1].high) >
      n(recent[recent.length - 6]?.high || 0);
    if (priceHigher && rsi < 65) exhaustionSignals++;
  }

  const stochK = n(stock.stochasticK);
  if (stochK > 85) exhaustionSignals++;

  if (checkFailedBreakouts(recent)) exhaustionSignals++;

  return exhaustionSignals <= 2;
}

export function checkFailedBreakouts(recent) {
  if (recent.length < 10) return false;
  let failures = 0;
  const recentHigh = Math.max(...recent.slice(-10).map((d) => n(d.high)));
  for (let i = recent.length - 10; i < recent.length - 1; i++) {
    const dayHigh = n(recent[i].high);
    const nextClose = n(recent[i + 1].close);
    if (dayHigh >= recentHigh * 0.99 && nextClose < dayHigh * 0.98) failures++;
  }
  return failures >= 2;
}

export function checkResistanceBreakout(stock, recent, currentPrice, cfg) {
  const resistanceWindow = recent.slice(-12, -2);
  if (resistanceWindow.length < 8) return false;
  const resistance = Math.max(...resistanceWindow.map((d) => n(d.high)));
  const lastDay = recent[recent.length - 1];
  const avgVolume =
    recent.slice(-10).reduce((sum, d) => sum + n(d.volume), 0) / 10;

  const todayBreakout =
    currentPrice > resistance * 1.01 && n(stock.openPrice) < resistance * 1.02;
  const volumeOK =
    n(lastDay.volume) > avgVolume * (cfg?.breakoutVolMult ?? 1.15);

  return (
    todayBreakout &&
    currentPrice > n(stock.openPrice) &&
    volumeOK &&
    n(lastDay.close) > resistance
  );
}

export function checkPatternCompletion(recent) {
  if (recent.length < 10) return false;
  return (
    detectBullFlag(recent) ||
    detectAscendingTriangle(recent) ||
    detectInverseHeadShoulders(recent) ||
    detectDoubleBottom(recent)
  );
}

/* patterns */
function detectBullFlag(recent) {
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
  return headLower && shouldersEqual && currentClose > neckline;
}

function detectDoubleBottom(recent) {
  if (recent.length < 15) return false;
  const firstHalf = recent.slice(0, 7);
  const secondHalf = recent.slice(8, 15);
  const firstLow = Math.min(...firstHalf.map((d) => n(d.low)));
  const secondLow = Math.min(...secondHalf.map((d) => n(d.low)));
  const lowsEqual = Math.abs(firstLow - secondLow) / firstLow < 0.02;
  const middlePeak = Math.max(...recent.slice(5, 10).map((d) => n(d.high)));
  const currentClose = n(recent[recent.length - 1].close);
  return lowsEqual && currentClose > middlePeak && middlePeak > firstLow * 1.03;
}
