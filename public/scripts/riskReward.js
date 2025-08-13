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

  const supports = marketStructure?.keyLevels?.supports || [];
  const resistances = marketStructure?.keyLevels?.resistances || [];

  if (!stopLoss) {
    stopLoss = supports.length
      ? supports[0] - Math.max(0.3 * atr, currentPrice * 0.002)
      : currentPrice - 1.8 * atr;
  }
  if (!target) {
    target = resistances.length ? resistances[0] : currentPrice + 2.8 * atr;
  }

  if (
    !stopLoss ||
    !target ||
    stopLoss >= currentPrice ||
    target <= currentPrice
  )
    return analysis;

  // ▶ configurable min stop distance
  const minStopDistance = atr * (cfg?.stopMinATR ?? 1.5);
  if (currentPrice - stopLoss < minStopDistance) {
    stopLoss = currentPrice - minStopDistance;
    analysis.adjustedStopLoss = stopLoss;
  }

  let risk = currentPrice - stopLoss;
  let reward = target - currentPrice;

  // ▶ target stepping: try deeper resistances for better R:R
  const requiredRatioBase =
    marketStructure.trend === "STRONG_UP"
      ? cfg?.rrStrongUp ?? 1.15
      : marketStructure.trend === "DOWN"
      ? cfg?.rrDown ?? 2.1
      : cfg?.rrBase ?? 1.5;

  let requiredRatio = requiredRatioBase;
  const rsi = n(stock.rsi14);
  if (rsi > 65 && rsi < 75) requiredRatio += 0.2;

  let bestTarget = target;
  let bestReward = reward;
  let bestRatio = reward / risk;

  for (let i = 0; i < Math.min(3, resistances.length); i++) {
    const candidate = resistances[i];
    if (!Number.isFinite(candidate) || candidate <= currentPrice) continue;
    const candReward = candidate - currentPrice;
    const candRatio = candReward / risk;
    if (candRatio > bestRatio) {
      bestRatio = candRatio;
      bestReward = candReward;
      bestTarget = candidate;
      if (bestRatio >= requiredRatio) break;
    }
  }

  // ▶ extension fallback (clamped by 52W high and +20%)
  if (bestRatio < requiredRatio) {
    const fiftyTwo = n(stock.fiftyTwoWeekHigh);
    const needed = requiredRatio * risk;
    const extTarget = currentPrice + Math.max(needed, 1.6 * atr);
    const cap = Math.min(
      fiftyTwo > currentPrice ? fiftyTwo : Infinity,
      currentPrice * 1.2
    );
    const candidate = Math.min(extTarget, cap);
    if (candidate > currentPrice) {
      const candReward = candidate - currentPrice;
      const candRatio = candReward / risk;
      if (candRatio > bestRatio) {
        bestRatio = candRatio;
        bestReward = candReward;
        bestTarget = candidate;
      }
    }
  }

  analysis.risk = risk = currentPrice - stopLoss;
  analysis.reward = reward = bestReward;
  analysis.ratio = reward / risk;

  analysis.multipleTargets = [
    { level: currentPrice + reward * 0.5, percentage: 33 },
    { level: currentPrice + reward * 0.75, percentage: 33 },
    { level: bestTarget, percentage: 34 },
  ];

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
