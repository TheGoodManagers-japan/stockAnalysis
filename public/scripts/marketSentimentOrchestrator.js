// marketSentimentOrchestrator.js

import { getShortTermSentimentScore } from "./shortTermSentimentAnalysis.js";
import { getDeepMarketAnalysis } from "./deepMarketAnalysis.js";

/** ---------- tiny helpers ---------- */
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const labelFromBucket = (score) =>
  score <= 3 ? "bullish" : score >= 5 ? "bearish" : "neutral";

// farther from neutral (4) => more confidence
function confidenceFromShortScore(score) {
  const d = Math.abs(4 - (score ?? 4)); // 0..3
  return clamp(0.4 + d * 0.12, 0.2, 0.9); // ~0.4..0.76
}

// Lean on regime + mlScore for long-term confidence
function confidenceFromLong(longTermRegime, mlScore = 0) {
  let c = 0.45;
  if (longTermRegime?.type === "TRENDING")
    c += 0.2 * clamp(longTermRegime.strength ?? 0, 0, 1);
  if (longTermRegime?.type === "CHOPPY") c -= 0.1;
  if (longTermRegime?.type === "RANGE_BOUND") c -= 0.05;
  c += clamp((Math.abs(mlScore) / 5) * 0.2, 0, 0.2);
  return clamp(c, 0.2, 0.9);
}

// Map long-horizon signal → 1..7 bucket (no mixing with short-term)
function longTermBucket(mlScore = 0, longTermRegime) {
  // Smooth-clamped ML → [-3, +3]
  const mlScaled = Math.tanh((mlScore ?? 0) / 3) * 3;

  // Small regime nudge
  let nudge = 0;
  const chars = longTermRegime?.characteristics || [];
  if (longTermRegime?.type === "TRENDING") {
    if (chars.includes("UPTREND"))
      nudge += 0.8 * clamp(longTermRegime.strength ?? 0.5, 0, 1);
    if (chars.includes("DOWNTREND"))
      nudge -= 0.8 * clamp(longTermRegime.strength ?? 0.5, 0, 1);
  } else if (longTermRegime?.type === "RANGE_BOUND") {
    // light bias: keep center-ish
    nudge += 0;
  } else if (longTermRegime?.type === "CHOPPY") {
    // slightly pessimistic in choppy contexts
    nudge -= 0.2;
  }

  const s = mlScaled + nudge;

  // Thresholds tuned for s ∈ [-3, +3]
  if (s >= 2.2) return 1; // Strong Bullish
  if (s >= 1.3) return 2; // Bullish
  if (s >= 0.5) return 3; // Weak Bullish
  if (s >= -0.5) return 4; // Neutral
  if (s >= -1.3) return 5; // Weak Bearish
  if (s >= -2.2) return 6; // Bearish
  return 7; // Strong Bearish
}

/**
 * Return separate horizon scores with labels & confidence.
 * - shortTerm.score:    1..7 (your 15-day engine)
 * - longTerm.score:     1..7 (derived from deep analysis only)
 */
export function getComprehensiveMarketSentiment(stock, historicalData) {
  if (!stock || !historicalData || historicalData.length < 15) {
    return {
      shortTerm: { score: 7, label: "bearish", confidence: 0.3 },
      longTerm: {
        score: 4,
        label: "neutral",
        confidence: 0.3,
        regime: "UNKNOWN",
        strength: 0,
      },
      error: "Insufficient data for analysis",
    };
  }

  const sorted = [...historicalData].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );

  // --- Short-term (15-day engine) ---
  const stScore = getShortTermSentimentScore(stock, sorted); // 1..7
  const stLabel = labelFromBucket(stScore);
  const stConf = confidenceFromShortScore(stScore);

  // --- Long-term (deep analysis, no blending) ---
  const {
    mlScore = 0,
    features = {},
    longTermRegime = { type: "UNKNOWN", strength: 0, characteristics: [] },
    shortTermRegime = undefined, // exposed if you still want to inspect
  } = getDeepMarketAnalysis(stock, sorted) || {};

  const ltScore = longTermBucket(mlScore, longTermRegime);
  const ltLabel = labelFromBucket(ltScore);
  const ltConf = confidenceFromLong(longTermRegime, mlScore);

  return {
    shortTerm: { score: stScore, label: stLabel, confidence: stConf },
    longTerm: {
      score: ltScore,
      label: ltLabel,
      confidence: ltConf,
      regime: longTermRegime.type,
      strength: longTermRegime.strength ?? 0,
    }
  };
}
