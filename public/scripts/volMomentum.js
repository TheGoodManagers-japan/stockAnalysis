// volMomentum.js
import { n } from "./utils.js";

export function validateVolumeMomentum(stock, historicalData) {
  const validation = {
    volumeProfile: "NEUTRAL",
    momentumState: "NEUTRAL",
    divergences: [],
    relativeStrength: 0,
    score: 0,
  };
  if (historicalData.length < 20) return validation;

  const recent = historicalData.slice(-20);
  const { profile } = analyzeVolumeProfile(recent);
  validation.volumeProfile = profile;

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

export function analyzeVolumeProfile(recent) {
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

export function checkDivergences(stock, recent) {
  const divergences = [];
  if (recent.length < 10) return divergences;

  const rsi = n(stock.rsi14);
  const currentPrice = n(stock.currentPrice);
  const priceWeekAgo = n(recent[recent.length - 6]?.close);
  const priceTwoWeeksAgo = n(recent[recent.length - 11]?.close);

  if (priceWeekAgo && priceWeekAgo > 0) {
    const priceChange = ((currentPrice - priceWeekAgo) / priceWeekAgo) * 100;
    if (priceChange > 10 && rsi < 65)
      divergences.push({ type: "bearish", strength: "strong" });
    else if (priceChange > 5 && rsi < 60)
      divergences.push({ type: "bearish", strength: "moderate" });
    if (priceChange < -10 && rsi > 35)
      divergences.push({ type: "bullish", strength: "strong" });
    else if (priceChange < -5 && rsi > 40)
      divergences.push({ type: "bullish", strength: "moderate" });
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
