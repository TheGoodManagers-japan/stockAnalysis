// ================== DEEP MARKET ANALYSIS (Layer 2) — Orchestrator ==================
// deep/index.js — main entry point, delegates to sub-modules

import { analyzeMicrostructure, inferOrderFlow, detectInstitutionalActivity } from "./microstructure.js";
import { analyzeVolumeProfile } from "./volume.js";
import {
  analyzePriceActionQuality,
  detectHiddenDivergences,
  detectMarketRegime,
  detectAdvancedPatterns,
  analyzeVolatilityRegime,
  analyzeExtension,
  analyzeTrendQuality,
  analyzeMomentumPersistence,
} from "./patterns.js";
import { extractFeatureVector, calculateMLScore, mapRegimeToTier } from "./scoring.js";

/**
 * Performs advanced (90-day) analysis including market structure, regime,
 * order flow, and institutional patterns to generate deep market insights.
 *
 * @param {object} stock - The stock object.
 * @param {array} historicalData - OHLCV array.
 * @returns {{ mlScore:number, features:Object, longTermRegime:Object, intermediateRegime:Object, ltTier:number }}
 */
export function getDeepMarketAnalysis(stock, historicalData) {
  // Soften behavior on thin history so the orchestrator doesn't auto-veto
  if (!historicalData || historicalData.length < 90) {
    return {
      mlScore: -0.5, // mild caution only
      features: { f4_characteristics_INSUFFICIENT_HISTORY: 1 },
      longTermRegime: {
        type: "UNKNOWN",
        characteristics: ["INSUFFICIENT_HISTORY"],
      },
      intermediateRegime: {
        type: "UNKNOWN",
        characteristics: ["INSUFFICIENT_HISTORY"],
      },
    };
  }

  // Sort entire history first, then take last 90 in chronological order
  const sortedAll = [...historicalData].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );
  const recentData = sortedAll.slice(-90);

  // 1) GATHER ALL DATA & ANALYSIS
  const microstructure = analyzeMicrostructure(recentData);
  const volumeProfile = analyzeVolumeProfile(recentData);
  const priceActionQuality = analyzePriceActionQuality(recentData);
  const hiddenDivergences = detectHiddenDivergences(stock, recentData);
  const volatilityRegime = analyzeVolatilityRegime(stock, recentData);
  const advancedPatterns = detectAdvancedPatterns(recentData, volatilityRegime);
  const orderFlow = inferOrderFlow(recentData);
  const extensionAnalysis = analyzeExtension(stock, recentData);
  const trendQuality = analyzeTrendQuality(stock, recentData);
  const momentumAnalysis = analyzeMomentumPersistence(stock, recentData);
  const longTermRegime = detectMarketRegime(sortedAll);
  const intermediateRegime = detectMarketRegime(recentData); // 30-90b context

  // 2) FEATURE VECTOR & BASE SCORE
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
    detectInstitutionalActivity(recentData) // f11
  );

  let mlScore = calculateMLScore(features);

  // 3) REGIME-BASED & CONTEXTUAL ADJUSTMENTS (softened/polished)
  let regimeAdjustment = 0;
  const has = (arr, s) => Array.isArray(arr) && arr.includes(s);

  const isLongDown =
    longTermRegime.type === "TRENDING" &&
    has(longTermRegime.characteristics, "DOWNTREND");
  const isLongUp =
    longTermRegime.type === "TRENDING" &&
    has(longTermRegime.characteristics, "UPTREND");
  const isShortDown =
    intermediateRegime.type === "TRENDING" &&
    has(intermediateRegime.characteristics, "DOWNTREND");
  const isShortUp =
    intermediateRegime.type === "TRENDING" &&
    has(intermediateRegime.characteristics, "UPTREND");
  const isShortRange = intermediateRegime.type === "RANGE_BOUND";

  if (isLongDown) {
    if (isShortDown) regimeAdjustment = -1.8;
    else if (isShortRange) regimeAdjustment = -0.8;
    else if (isShortUp) regimeAdjustment = 1.2;
  } else if (isLongUp) {
    if (isShortUp && !extensionAnalysis.parabolicMove) regimeAdjustment = 1.8;
    else if (isShortDown) regimeAdjustment = 0.8;
  } else if (longTermRegime.type === "RANGE_BOUND") {
    if (priceActionQuality.nearRangeLow) regimeAdjustment = 1.5;
    else if (priceActionQuality.nearRangeHigh) regimeAdjustment = -2.0;
  } else if (longTermRegime.type === "CHOPPY") {
    // neutral adjustment for chop
    regimeAdjustment = 0;
  } else if (longTermRegime.type === "UNKNOWN") {
    // neutral when unsure
    regimeAdjustment = 0;
  }
  mlScore += regimeAdjustment;

  // Contextual adjustments
  if (microstructure.bullishAuction && volumeProfile.pocRising) mlScore += 2.5;
  if (microstructure.sellerExhaustion && orderFlow.buyingPressure)
    mlScore += 3.0;
  if (hiddenDivergences.bullishHidden && trendQuality.isHealthyTrend)
    mlScore += 2.0;
  if (advancedPatterns.wyckoffSpring) mlScore += 3.5;
  if (advancedPatterns.threePushes && extensionAnalysis.isExtended)
    mlScore -= 3.0;
  if (volatilityRegime.compression && advancedPatterns.coiledSpring)
    mlScore += 2.5;

  // Re-clamp after contextual adjustments to prevent overflow into tanh compression
  mlScore = Math.max(-5, Math.min(5, mlScore));

  const ltTier = mapRegimeToTier(longTermRegime, mlScore);

  return { mlScore, features, longTermRegime, intermediateRegime, ltTier };
}

// Re-export mapRegimeToTier for consumers that import it directly
export { mapRegimeToTier } from "./scoring.js";
