// dashboard/engine/scoring/disagreement.js
// Ensemble disagreement signal — flags stocks where scoring dimensions conflict.

/**
 * Compute score disagreement across three scoring dimensions.
 * All inputs should be on 0-10 scale.
 * @param {number} tech - Technical score 0-10
 * @param {number} fund - Fundamental score 0-10
 * @param {number} val - Valuation score 0-10
 * @param {number} threshold - Stdev threshold for "conflicted" flag (default 2.5)
 * @returns {{ disagreement: number, isConflicted: boolean }}
 */
export function computeDisagreement(tech, fund, val, threshold = 2.5) {
  const scores = [tech, fund, val].filter((s) => Number.isFinite(s));
  if (scores.length < 2) return { disagreement: 0, isConflicted: false };
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance =
    scores.reduce((a, s) => a + (s - mean) ** 2, 0) / scores.length;
  const stdev = Math.sqrt(variance);
  const disagreement = Math.round(stdev * 100) / 100;
  return { disagreement, isConflicted: disagreement > threshold };
}
