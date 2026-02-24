// ================== Microstructure & Order Flow ==================
import { num as n } from "../../helpers.js";

/**
 * Analyzes microstructure of recent price bars — auction type, delta profile,
 * seller/buyer exhaustion signals.
 */
export function analyzeMicrostructure(data) {
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

/**
 * Infers order flow from recent bars — buying/selling pressure, absorption.
 */
export function inferOrderFlow(data) {
  const flow = {
    buyingPressure: false,
    sellingPressure: false,
    absorption: false,
    imbalance: 0,
  };
  if (!data || data.length < 10) return flow;

  const recent = data.slice(-10);
  const avgVol = recent.reduce((s, d) => s + n(d.volume), 0) / 10;

  let buyVolume = 0,
    sellVolume = 0,
    absorption = 0;

  recent.forEach((bar) => {
    const high = n(bar.high),
      low = n(bar.low),
      close = n(bar.close),
      vol = n(bar.volume);
    const range = Math.max(0, high - low);
    const closePos = range > 0 ? (close - low) / range : 0.5;

    buyVolume += vol * closePos;
    sellVolume += vol * (1 - closePos);

    if (vol > avgVol * 1.5 && range < close * 0.01) absorption++;
  });

  const denom = buyVolume + sellVolume;
  flow.imbalance = denom > 0 ? (buyVolume - sellVolume) / denom : 0;
  flow.buyingPressure = flow.imbalance > 0.2;
  flow.sellingPressure = flow.imbalance < -0.2;
  flow.absorption = absorption >= 2;

  return flow;
}

/**
 * Detects institutional accumulation/distribution patterns via volume spikes.
 */
export function detectInstitutionalActivity(recentData) {
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
