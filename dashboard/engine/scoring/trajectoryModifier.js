// dashboard/engine/scoring/trajectoryModifier.js
// Forward-looking tier modifier: detects improving/deteriorating fundamentals.

/**
 * Compare current fundamentals to a previous snapshot to detect trajectory.
 * @param {Object} prev - Previous snapshot { pe_ratio, eps_trailing, eps_forward, dividend_yield }
 * @param {Object} current - Current metrics { peRatio, epsTrailingTwelveMonths, epsForward, dividendYield }
 * @returns {{ trajectory: "improving"|"stable"|"deteriorating", tierAdj: number }}
 */
export function computeTrajectory(prev, current) {
  if (!prev || !current) {
    return { trajectory: "stable", tierAdj: 0 };
  }

  let improvingCount = 0;
  let deterioratingCount = 0;

  // EPS trailing: higher is better
  const curEps = Number(current.epsTrailingTwelveMonths) || 0;
  const oldEps = Number(prev.eps_trailing) || 0;
  if (oldEps > 0) {
    if (curEps > oldEps * 1.05) improvingCount++;
    else if (curEps < oldEps * 0.95) deterioratingCount++;
  }

  // EPS forward: higher is better
  const curFwd = Number(current.epsForward) || 0;
  const oldFwd = Number(prev.eps_forward) || 0;
  if (oldFwd > 0) {
    if (curFwd > oldFwd * 1.05) improvingCount++;
    else if (curFwd < oldFwd * 0.95) deterioratingCount++;
  }

  // Dividend yield: higher is better
  const curDiv = Number(current.dividendYield) || 0;
  const oldDiv = Number(prev.dividend_yield) || 0;
  if (oldDiv > 0) {
    if (curDiv > oldDiv * 1.1) improvingCount++;
    else if (curDiv < oldDiv * 0.9) deterioratingCount++;
  }

  // PE ratio: lower is better (only if both profitable)
  const curPe = Number(current.peRatio) || 0;
  const oldPe = Number(prev.pe_ratio) || 0;
  if (curPe > 0 && oldPe > 0) {
    if (curPe < oldPe * 0.9) improvingCount++;
    else if (curPe > oldPe * 1.1) deterioratingCount++;
  }

  const trajectory =
    improvingCount >= 2
      ? "improving"
      : deterioratingCount >= 2
        ? "deteriorating"
        : "stable";

  const tierAdj =
    trajectory === "improving" ? -0.5 : trajectory === "deteriorating" ? 0.5 : 0;

  return { trajectory, tierAdj };
}
