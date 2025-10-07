// scoring.js (JP-only, value-first)
// -----------------------------------------------------------------------------
// Exports:
//   toPercent(x), toRatio(x)
//   getQualityScore(stock)                   // 0..10 (aka fundamentals)
//   getValuationScore(stock, overrides?)     // 0..10 (JPY size bands only)
//   getNumericTier(stock, opts?)             // 1..6 (value-only by default)
//   classifyValueQuadrant(stock, thresholds?)// "Great & Cheap", etc.
// Back-compat aliases are provided:
//   getAdvancedFundamentalScore === getQualityScore
//   getTechnicalScore      → returns 0 (noop so callers don’t break)
//   getTechnicalScoreLite  → returns 0 (noop so callers don’t break)
// -----------------------------------------------------------------------------

/** Normalize % fields that may arrive as decimal/percent/bps. */
export function toPercent(x) {
  const v = Number.isFinite(x) ? x : 0;
  if (v === 0) return 0;
  if (v > 50 && v <= 5000) return v / 100; // bps → %
  if (v > 0 && v <= 1) return v * 100; // decimal → %
  return v; // already %
}

/** Normalize ratio vs percent input to a 0..1-ish ratio. */
export function toRatio(x) {
  const v = Number.isFinite(x) ? x : 0;
  return v > 10 ? v / 100 : v;
}

/* =============================================================================
 * QUALITY SCORE (0 … 10)
 * – sector-aware; uses fields you already fetch (EPS fwd/ttm, EPS growth %, D/E,
 *   dividend yield/growth, simple sanity checks on PE/PS).
 * =============================================================================
 */
export function getQualityScore(stock) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  const HIGH_GROWTH_SECTORS = new Set([
    "Technology",
    "Communications",
    "Pharmaceuticals",
    "Electric Machinery",
    "Precision Instruments",
    "Machinery",
    "Automobiles & Auto parts",
  ]);
  const DIVIDEND_FOCUS_SECTORS = new Set([
    "Utilities",
    "Electric Power",
    "Gas",
    "Banking",
    "Insurance",
    "Real Estate",
  ]);
  const FINANCIAL_SECTORS = new Set([
    "Banking",
    "Insurance",
    "Other Financial Services",
    "Securities",
  ]);

  const sector = stock?.sector || "";
  const isHGrowth = HIGH_GROWTH_SECTORS.has(sector);
  const isDivFocus = DIVIDEND_FOCUS_SECTORS.has(sector);
  const isFinancial = FINANCIAL_SECTORS.has(sector);

  const pe = n(stock?.peRatio);
  const pb = n(stock?.pbRatio);
  const ps = n(stock?.priceToSales);
  const d2e = toRatio(stock?.debtEquityRatio);
  const dy = toPercent(stock?.dividendYield);
  const dg5 = toPercent(stock?.dividendGrowth5yr);
  const epsG = n(stock?.epsGrowthRate); // %
  const epsF = n(stock?.epsForward);
  const epsT = n(stock?.epsTrailingTwelveMonths);

  let growth = 0,
    health = 0,
    dividend = 0,
    sanity = 0;

  // Growth
  if (epsG >= 20) growth += 3;
  else if (epsG >= 10) growth += 2;
  else if (epsG >= 5) growth += 1;
  else if (epsG < 0) growth -= 2;

  const epsRatio = epsT ? epsF / epsT : 1;
  if (epsRatio >= 1.2) growth += 2;
  else if (epsRatio >= 1.05) growth += 1;
  else if (epsRatio <= 0.95) growth -= 1;

  // Health
  if (d2e < 0.25) health += 3;
  else if (d2e < 0.5) health += 2;
  else if (d2e < 1.0) health += 1;
  else if (d2e > 2.0) health -= 2;
  else if (d2e > 1.5) health -= 1;
  if (isFinancial && d2e < 1.5) health += 1;

  // Dividend
  if (dy > 0) {
    if (dy >= 6) dividend += 3;
    else if (dy >= 4) dividend += 2;
    else if (dy >= 2) dividend += 1;

    if (dg5 >= 10) dividend += 2;
    else if (dg5 >= 5) dividend += 1;
    else if (dg5 < 0) dividend -= 1;
  }

  // Sanity (profitability & non-absurd sales multiple)
  if (pe > 0 && epsT > 0) sanity += 1;
  if (!isFinancial && ps > 0 && ps < 12) sanity += 0.5;

  const g = Math.max(0, Math.min(10, growth * 2));
  const h = Math.max(0, Math.min(10, (health + 2) * 2));
  const d = Math.max(0, Math.min(10, dividend * 2));
  const s = Math.max(0, Math.min(10, sanity * 3));

  const weights = {
    growth: isHGrowth ? 0.45 : isDivFocus ? 0.2 : 0.35,
    health: 0.3,
    dividend: isDivFocus ? 0.25 : 0.1,
    sanity: 0.1,
  };

  const score =
    g * weights.growth +
    h * weights.health +
    d * weights.dividend +
    s * weights.sanity;
  return Math.round(score * 10) / 10;
}

// Back-compat alias
export const getAdvancedFundamentalScore = getQualityScore;

/* =============================================================================
 * VALUATION SCORE (0 … 10)
 * – JP-only: size bands in JPY (¥). Sector-aware PE/PB/PS bands + PEG hint + yield.
 *   Market-cap bands: ≥¥10T, ≥¥1T, ≥¥100B, ≥¥20B, else micro.
 * =============================================================================
 */
export function getValuationScore(stock, weightOverrides = {}) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  const HG = new Set([
    "Technology",
    "Communications",
    "Pharmaceuticals",
    "Electric Machinery",
    "Precision Instruments",
    "Machinery",
    "Automobiles & Auto parts",
  ]);
  const VAL = new Set(["Banking", "Insurance", "Utilities", "Real Estate"]);
  const FIN = new Set([
    "Banking",
    "Insurance",
    "Other Financial Services",
    "Securities",
  ]);

  const sector = stock?.sector || "";
  const isHG = HG.has(sector);
  const isVAL = VAL.has(sector);
  const isFinancial = FIN.has(sector);

  const pe = n(stock?.peRatio);
  const pb = n(stock?.pbRatio);
  const ps = n(stock?.priceToSales);
  const mc = n(stock?.marketCap); // assume ¥ already (JP universe)
  const gEPS = n(stock?.epsGrowthRate); // %
  const dy = toPercent(stock?.dividendYield);

  const scaleLowBetter = (val, good, ok, bad) => {
    if (val <= good) return 2;
    if (val <= ok) return 1;
    if (val <= bad) return -1;
    return -2;
  };

  const peS =
    pe <= 0
      ? -2
      : scaleLowBetter(
          pe,
          isHG ? 25 : isVAL ? 8 : 10,
          isHG ? 40 : isVAL ? 15 : 18,
          isHG ? 60 : isVAL ? 20 : 30
        );

  const pbS =
    pb <= 0
      ? -1
      : scaleLowBetter(
          pb,
          isHG ? 2 : isVAL ? 0.8 : 1.0,
          isHG ? 4 : isVAL ? 1.5 : 2.5,
          isHG ? 6 : isVAL ? 2.5 : 4.0
        );

  const psS = isFinancial
    ? 0
    : ps > 0
    ? scaleLowBetter(ps, isHG ? 3 : 1, isHG ? 8 : 2, isHG ? 12 : 5)
    : 0;

  // PEG hint
  let pegS = 0;
  if (pe > 0 && gEPS > 0) {
    const peg = pe / gEPS;
    if (peg < 1) pegS = 1.5;
    else if (peg < 2) pegS = 0.5;
    else if (peg > 3) pegS = -1;
  }

  // Dividend yield sweetener
  const yieldS = dy >= 4 ? 0.6 : dy >= 2 ? 0.3 : 0;

  // JP-only size tilt (¥)
  let sizeS;
  if (mc >= 10e12) sizeS = 0.5; // ≥ ¥10T
  else if (mc >= 1e12) sizeS = 0.3; // ≥ ¥1T
  else if (mc >= 1e11) sizeS = 0.0; // ≥ ¥100B
  else if (mc >= 2e10) sizeS = -0.2; // ≥ ¥20B
  else sizeS = -0.5; // micro

  const W = {
    pe: 1.6,
    pb: 1.2,
    ps: 1.0,
    peg: 1.0,
    yield: 0.6,
    size: 0.5,
    ...weightOverrides,
  };

  const raw =
    peS * W.pe +
    pbS * W.pb +
    psS * W.ps +
    pegS * W.peg +
    yieldS * W.yield +
    sizeS * W.size;
  const score = Math.max(0, Math.min(10, (raw + 8) * (10 / 16)));
  return Math.round(score * 10) / 10;
}

/* =============================================================================
 * VALUE-ONLY NUMERIC TIER (1 … 6)
 * – Uses only quality (fundamentals) and valuation. Technicals ignored by default.
 *   weights.mode:
 *     - "value_only"  (default): {fund:0.45, val:0.55}
 *     - "value_first" (tiny tech whisper if you still pass tech)
 * =============================================================================
 */
export function getNumericTier(stock, weights = {}) {
  const mode = weights.mode || "value_only";
  const preset =
    mode === "value_first"
      ? { tech: 0.05, fund: 0.4, val: 0.55 }
      : { tech: 0.0, fund: 0.45, val: 0.55 };

  const w = { ...preset, ...weights };

  const tRaw = Number.isFinite(stock?.technicalScore)
    ? stock.technicalScore
    : 0;
  const fRaw = Number.isFinite(stock?.fundamentalScore)
    ? stock.fundamentalScore
    : Number.isFinite(stock?.qualityScore)
    ? stock.qualityScore
    : 0;
  const vRaw = Number.isFinite(stock?.valuationScore)
    ? stock.valuationScore
    : 0;

  const tech = Math.max(0, Math.min(10, (tRaw + 50) * 0.1)); // if present
  const fund =
    fRaw > 10 || fRaw < 0
      ? Math.max(0, Math.min(10, (fRaw + 50) * 0.1))
      : Math.max(0, Math.min(10, fRaw));
  const val = Math.max(0, Math.min(10, vRaw));

  let score = tech * w.tech + fund * w.fund + val * w.val;

  // Lightweight anti-trap guards
  const d2e = toRatio(stock?.debtEquityRatio);
  const epsT = Number.isFinite(stock?.epsTrailingTwelveMonths)
    ? stock.epsTrailingTwelveMonths
    : 0;
  if (mode !== "default") {
    if (epsT <= 0) score -= 0.5; // losing money TTM
    if (d2e > 2.0) score -= 0.4; // high leverage
  }

  score = Math.max(0, Math.min(10, score));

  if (score >= 8) return 1; // Great & Cheap (Dream)
  if (score >= 6.5) return 2; // Great leaning cheap (Elite)
  if (score >= 5) return 3; // Fairly priced quality (Solid)
  if (score >= 3.5) return 4; // Speculative / mixed
  if (score >= 2) return 5; // Risky / likely trap
  return 6; // Red Flag
}

/* =============================================================================
 * QUADRANT CLASSIFIER — “great & cheap vs great & expensive”
 * =============================================================================
 */
export function classifyValueQuadrant(
  stock,
  thresholds = { qualityGreat: 7, cheapVal: 6, expensiveVal: 3 }
) {
  const q = Number.isFinite(stock?.fundamentalScore)
    ? stock.fundamentalScore
    : Number.isFinite(stock?.qualityScore)
    ? stock.qualityScore
    : getQualityScore(stock);

  const v = Number.isFinite(stock?.valuationScore)
    ? stock.valuationScore
    : getValuationScore(stock);

  const great = q >= thresholds.qualityGreat;
  const cheap = v >= thresholds.cheapVal;
  const expensive = v <= thresholds.expensiveVal;

  if (great && cheap)
    return { label: "Great & Cheap", verdict: "Likely undervalued quality" };
  if (great && expensive)
    return { label: "Great & Expensive", verdict: "Quality, priced rich" };
  if (!great && cheap)
    return {
      label: "Weak & Cheap (Trap?)",
      verdict: "Cheap for a reason risk",
    };
  return { label: "Weak & Expensive", verdict: "Avoid / poor value" };
}

/* =============================================================================
 * Back-compat no-op technicals (so old imports don’t crash)
 * =============================================================================
 */
export function getTechnicalScore() {
  return 0;
}
export function getTechnicalScoreLite() {
  return 0;
}

/* =============================================================================
 * Typical usage
 * =============================================================================
 *
 * const fundamentalScore = getQualityScore(stock);   // 0..10
 * const valuationScore   = getValuationScore(stock); // 0..10
 * const tier             = getNumericTier({ fundamentalScore, valuationScore }, { mode: "value_only" });
 * const quadrant         = classifyValueQuadrant({ fundamentalScore, valuationScore });
 *
 * stock.fundamentalScore = fundamentalScore;
 * stock.valuationScore   = valuationScore;
 * stock.tier             = tier;
 * stock.valueQuadrant    = quadrant.label;
 */
