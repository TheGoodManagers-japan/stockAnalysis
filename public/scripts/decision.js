// decision.js
import { n } from "./utils.js";

export function makeFinalDecision(
  stock,
  analysis,
  entryConditions,
  timingSignals,
  riskReward,
  marketStructure,
  volumeMomentum,
  priceActionPositive,
  cfg
) {
  const weights = getAdaptiveWeights(marketStructure, volumeMomentum);
  const qualityScore =
    entryConditions.score * weights.entryConditions +
    timingSignals.score * weights.timing +
    (riskReward.acceptable ? 80 : 20) * weights.riskReward +
    marketStructure.structureQuality * weights.marketStructure +
    volumeMomentum.score * weights.volumeMomentum;
  analysis.entryQuality = Math.round(qualityScore);

  const qualityThreshold = getQualityThreshold(marketStructure, cfg);

  const openPx = Number.isFinite(stock.openPrice)
    ? stock.openPrice
    : stock.currentPrice;
  const dayPct = openPx
    ? (((stock.currentPrice || openPx) - openPx) / openPx) * 100
    : 0;
  const priceActionGate = cfg.requirePriceActionPositive
    ? priceActionPositive
    : priceActionPositive ||
      (cfg.allowSmallRedDay && dayPct >= cfg.redDayMaxDownPct);

  const mustHavesMet =
    riskReward.acceptable &&
    entryConditions.notOverextended &&
    (cfg.enforceNotExhausted ? entryConditions.notExhausted : true) &&
    priceActionGate;

  const pullbackBounce =
    entryConditions.pullbackToSupport && entryConditions.bounceConfirmed;
  const breakoutWithVolume =
    entryConditions.breakingResistance && entryConditions.volumeConfirmation;
  const patternWithTiming =
    entryConditions.patternComplete && timingSignals.score >= 50;

  const momentumEntry =
    entryConditions.momentumAligned &&
    entryConditions.notOverextended &&
    volumeMomentum.score >= 50 &&
    priceActionGate &&
    (stock.currentPrice - (stock.openPrice || stock.currentPrice)) /
      (stock.openPrice || stock.currentPrice) >
      0.003;

  const idealSetup =
    entryConditions.pullbackToSupport &&
    entryConditions.bounceConfirmed &&
    (entryConditions.volumeConfirmation ||
      volumeMomentum.volumeProfile === "ACCUMULATION") &&
    entryConditions.momentumAligned;

  const highQuality = analysis.entryQuality >= qualityThreshold;
  const hasStrongSignal =
    pullbackBounce ||
    breakoutWithVolume ||
    patternWithTiming ||
    momentumEntry ||
    idealSetup;

  const goodEnoughConditions =
    entryConditions.score >= cfg.minEntryScore &&
    riskReward.acceptable &&
    priceActionGate &&
    (entryConditions.notOverextended || marketStructure.trend === "STRONG_UP");

  if (
    (mustHavesMet && hasStrongSignal && highQuality) ||
    goodEnoughConditions
  ) {
    let buyReason = "";
    if (idealSetup) {
      buyReason = `IDEAL ENTRY: Pullback + bounce confirmed, strong volume (${
        volumeMomentum.volumeProfile
      }), momentum aligned. Entry quality: ${
        analysis.entryQuality
      }%. R:R ${riskReward.ratio.toFixed(1)}:1.`;
    } else if (pullbackBounce) {
      buyReason = `PULLBACK ENTRY: Bounce from key support confirmed. Entry quality: ${
        analysis.entryQuality
      }%. R:R ${riskReward.ratio.toFixed(1)}:1.`;
    } else if (breakoutWithVolume) {
      buyReason = `BREAKOUT ENTRY: Resistance break with ${
        volumeMomentum.volumeProfile
      } volume. Entry quality: ${
        analysis.entryQuality
      }%. R:R ${riskReward.ratio.toFixed(1)}:1.`;
    } else if (patternWithTiming) {
      buyReason = `PATTERN ENTRY: Pattern completion with good timing (score ${
        timingSignals.score
      }). Entry quality: ${
        analysis.entryQuality
      }%. R:R ${riskReward.ratio.toFixed(1)}:1.`;
    } else if (momentumEntry) {
      buyReason = `MOMENTUM ENTRY: Momentum aligned (${
        volumeMomentum.momentumState
      }). Entry quality: ${
        analysis.entryQuality
      }%. R:R ${riskReward.ratio.toFixed(1)}:1.`;
    } else {
      buyReason = `TECHNICAL ENTRY: Solid setup in ${
        marketStructure.trend
      } trend. Today ${dayPct.toFixed(2)}%. Entry quality: ${
        analysis.entryQuality
      }%. R:R ${riskReward.ratio.toFixed(1)}:1.`;
    }
    return { buyNow: true, reason: buyReason };
  }

  let waitReason = "";
  if (!priceActionGate) {
    waitReason = `Price action weak today (${dayPct.toFixed(
      2
    )}%). Wait for bullish action or smaller red day.`;
  } else if (!(riskReward.acceptable && entryConditions.notOverextended)) {
    if (!riskReward.acceptable) {
      const need =
        marketStructure.trend === "STRONG_UP"
          ? cfg.rrStrongUp
          : marketStructure.trend === "DOWN"
          ? cfg.rrDown
          : cfg.rrBase;
      waitReason = `Risk/Reward not favorable (${riskReward.ratio.toFixed(
        1
      )}:1, need ${need.toFixed(1)}:1+).`;
    } else if (!entryConditions.notOverextended) {
      const rsi = n(stock?.rsi14) || 0;
      const bbUpper = n(stock?.bollingerUpper) || 0;
      if (rsi > 70)
        waitReason = `RSI ${rsi.toFixed(0)} (overbought) — wait for cool-off.`;
      else if (bbUpper > 0 && stock.currentPrice > bbUpper)
        waitReason = `Above upper Bollinger Band — wait for pullback into bands.`;
      else
        waitReason = `Extended from MAs — wait for pullback toward MA25/MA50.`;
    }
  } else if (
    !(
      entryConditions.pullbackToSupport ||
      entryConditions.breakingResistance ||
      entryConditions.patternComplete ||
      entryConditions.momentumAligned
    )
  ) {
    waitReason =
      "No clear trigger — wait for pullback, breakout, or pattern completion.";
  } else if (analysis.entryQuality < qualityThreshold) {
    waitReason = `Entry quality too low (${analysis.entryQuality}%, need ${qualityThreshold}%).`;
  } else {
    waitReason =
      "Conditions close but not all aligned — monitor for confirmation.";
  }

  if (marketStructure.trend === "DOWN")
    waitReason += " Note: Overall trend is bearish (counter-trend).";
  else if (marketStructure.trend === "WEAK_UP")
    waitReason += " Note: Uptrend is weak — be selective.";
  return { buyNow: false, reason: waitReason };
}

/* internals */
function getAdaptiveWeights(marketStructure, volumeMomentum) {
  const w = {
    entryConditions: 0.35,
    timing: 0.2,
    riskReward: 0.15,
    marketStructure: 0.15,
    volumeMomentum: 0.15,
  };
  if (marketStructure.trend === "STRONG_UP") {
    w.timing = 0.15;
    w.marketStructure = 0.2;
  }
  if (volumeMomentum.volumeProfile === "DISTRIBUTION") {
    w.volumeMomentum = 0.25;
    w.timing = 0.15;
  }
  return w;
}

function getQualityThreshold(marketStructure, cfg) {
  let t = cfg.qualityBase;
  if (marketStructure.trend === "STRONG_UP") t -= 5;
  else if (marketStructure.trend === "DOWN") t += 8;
  return Math.max(55, t);
}
