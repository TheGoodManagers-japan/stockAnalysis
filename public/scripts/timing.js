// timing.js
import { n } from "./utils.js";

export function confirmEntryTiming(stock, historicalData) {
  const signals = { intraday: {}, daily: {}, marketPhase: {}, score: 0 };
  if (historicalData.length < 5) return signals;

  const recent = historicalData.slice(-5);
  const lastDay = recent[recent.length - 1];
  const prevDay = recent[recent.length - 2];

  signals.intraday = {
    closeNearHigh:
      n(lastDay.close) >
      n(lastDay.high) - (n(lastDay.high) - n(lastDay.low)) * 0.3,
    bullishClose: n(lastDay.close) > n(lastDay.open),
    volumeSurge:
      n(lastDay.volume) >
      (recent.slice(0, 4).reduce((s, d) => s + n(d.volume), 0) / 4) * 1.1,
    openAbovePrevClose: n(lastDay.open) > n(prevDay.close),
    strongOpen: n(lastDay.open) > n(prevDay.close) * 1.005,
    currentlyBullish: n(lastDay.close) > n(lastDay.open),
  };

  signals.daily = {
    higherLow: n(lastDay.low) > n(prevDay.low),
    higherClose: n(lastDay.close) > n(prevDay.close),
    trendContinuation: checkTrendContinuation(recent),
    aboveVWAP: n(lastDay.close) > calculateVWAP(lastDay),
  };

  signals.marketPhase = getMarketPhaseSignals(lastDay);

  let score = 0;
  if (signals.intraday.closeNearHigh) score += 15;
  if (signals.intraday.bullishClose) score += 10;
  if (signals.intraday.volumeSurge) score += 20;
  if (signals.intraday.strongOpen) score += 10;
  if (signals.intraday.currentlyBullish) score += 20;
  if (signals.daily.higherLow) score += 15;
  if (signals.daily.higherClose) score += 10;
  if (signals.daily.trendContinuation) score += 15;
  if (signals.marketPhase.favorable) score += 15;

  signals.score = score;
  return signals;
}

function checkTrendContinuation(recent) {
  if (recent.length < 5) return false;
  let higherHighs = 0,
    higherLows = 0;
  for (let i = 1; i < recent.length; i++) {
    if (n(recent[i].high) > n(recent[i - 1].high)) higherHighs++;
    if (n(recent[i].low) > n(recent[i - 1].low)) higherLows++;
  }
  return higherHighs >= 3 && higherLows >= 3;
}

function getMarketPhaseSignals(lastDay) {
  const openToHighRatio =
    n(lastDay.high) > n(lastDay.open)
      ? (n(lastDay.high) - n(lastDay.open)) / (n(lastDay.high) - n(lastDay.low))
      : 0;
  const closeToHighRatio =
    n(lastDay.high) > n(lastDay.low)
      ? (n(lastDay.close) - n(lastDay.low)) / (n(lastDay.high) - n(lastDay.low))
      : 0.5;

  return {
    favorable: openToHighRatio < 0.5 && closeToHighRatio > 0.7,
    accumulation: closeToHighRatio > 0.8,
    distribution: closeToHighRatio < 0.2,
  };
}

function calculateVWAP(dayData) {
  return (n(dayData.high) + n(dayData.low) + n(dayData.close)) / 3;
}
