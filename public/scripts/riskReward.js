// riskReward.js
import { n } from "./utils.js";

export function analyzeRiskReward(stock, marketStructure, cfg, overrides = {}) {
  const currentPrice = n(stock.currentPrice);
  const rawATR = n(stock.atr14);
  const atr = Math.max(rawATR, currentPrice * 0.005);

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

  let requiredRatio = cfg.rrBase;
  if (marketStructure.trend === "STRONG_UP") requiredRatio = cfg.rrStrongUp;
  else if (marketStructure.trend === "DOWN") requiredRatio = cfg.rrDown;

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
