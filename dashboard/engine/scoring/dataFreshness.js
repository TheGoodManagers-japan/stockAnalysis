// dashboard/engine/scoring/dataFreshness.js
// Data freshness detection and score decay for stale fundamental data.

/**
 * Classify data freshness by age in days.
 * @param {number} ageDays
 * @returns {"fresh"|"aging"|"stale"}
 */
export function classifyFreshness(ageDays) {
  if (!Number.isFinite(ageDays) || ageDays < 0) return "stale";
  if (ageDays < 30) return "fresh";
  if (ageDays < 60) return "aging";
  return "stale";
}

/**
 * Apply decay to a score when data is stale.
 * Regresses toward 5.0 (sector median proxy) based on staleness.
 * @param {number} score - Raw 0-10 score
 * @param {"fresh"|"aging"|"stale"} freshness
 * @returns {number} - Adjusted score
 */
export function applyDecay(score, freshness) {
  if (!Number.isFinite(score)) return score;
  if (freshness === "fresh") return score;
  const median = 5.0;
  const decayFactor = freshness === "aging" ? 0.15 : 0.35;
  return Math.round((score + (median - score) * decayFactor) * 10) / 10;
}
