// marketStructure.js
import { n } from "./utils.js";

export function analyzeMarketStructure(stock, historicalData) {
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
  structure.structureQuality = calculateStructureQuality(structure);
  return structure;
}

export function findEnhancedSupportLevels(historicalData, currentPrice, stock) {
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

export function findEnhancedResistanceLevels(
  historicalData,
  currentPrice,
  stock
) {
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

export function calculateStructureQuality(structure) {
  let q = 50;
  if (structure.trend === "STRONG_UP") q += 30;
  else if (structure.trend === "UP") q += 20;
  else if (structure.trend === "WEAK_UP") q += 10;
  else if (structure.trend === "DOWN") q -= 20;

  if (structure.pricePosition.nearSupport) q += 20;
  else if (structure.pricePosition.nearResistance) q -= 10;
  else if (structure.pricePosition.inMiddle) q += 5;

  if ((structure.keyLevels.supports || []).length >= 2) q += 10;
  if ((structure.keyLevels.resistances || []).length >= 2) q += 10;

  if (
    structure.keyLevels.ma5 > structure.keyLevels.ma25 &&
    structure.keyLevels.ma25 > structure.keyLevels.ma50
  )
    q += 10;

  return Math.min(100, Math.max(0, q));
}
