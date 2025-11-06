// trchFundValAnalysis.js (JP-only, value-first, patched)

/* =============================================================================
 * Helpers
 * =============================================================================
 */
export function toPercent(x) {
  const v = Number.isFinite(x) ? Number(x) : 0;
  if (v === 0) return 0;
  if (v > 50 && v <= 5000) return v / 100;   // bps → %
  if (v > 0 && v <= 1) return v * 100;       // decimal → %
  return v;                                   // already %
}

export function toRatio(x) {
  const v = Number.isFinite(x) ? Number(x) : 0;
  // If a percent slipped in (e.g., 120 → 1.2), map >10 as percent
  return v > 10 ? v / 100 : v;
}

function clamp(v, lo, hi) {
  const n = Number.isFinite(v) ? v : lo;
  return Math.max(lo, Math.min(hi, n));
}

function wins(v, lo, hi) {
  // winsorize; keep within [lo, hi]
  const n = Number.isFinite(v) ? v : NaN;
  if (!Number.isFinite(n)) return NaN;
  return Math.max(lo, Math.min(hi, n));
}

function nz(v, d = 0) {
  return Number.isFinite(v) ? v : d;
}

/* =============================================================================
 * Sets / sector groupings
 * =============================================================================
 */
const HIGH_GROWTH_SECTORS = new Set([
  // Growth-leaning groups (expanded to match your universe labels)
  "Technology",
  "Communication Services", // synonym for "Communications"
  "Communications",
  "Healthcare",             // captures Pharmaceuticals/Medtech
  "Pharmaceuticals",
  "Electric Machinery",
  "Precision Instruments",
  "Machinery",
  "Automobiles & Auto parts",
  "Technology Hardware",
  "Semiconductors",
]);
const DIVIDEND_FOCUS_SECTORS = new Set([
  // More defensive / income-oriented
  "Utilities",
  "Electric Power",
  "Gas",
  "Real Estate",
  "Consumer Defensive",     // staples often dividend-heavy in JP
  "Staples",
  "Banking",
  "Insurance",
]);
const FINANCIAL_SECTORS = new Set([
  // Anything we should treat with financials logic (ignore PS, D/E, etc.)
  "Financial Services",
  "Banking",
  "Insurance",
  "Other Financial Services",
  "Securities",
  "Capital Markets",
  "Diversified Financials",
]);

/* =============================================================================
 * QUALITY SCORE (0 … 10)
 * – sector-aware; now with optional profitability hints if present (ROE/Margins)
 * =============================================================================
 */
export function getQualityScore(stock) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

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
  const epsGpct = toPercent(stock?.epsGrowthRate); // ensure %
  const epsF = n(stock?.epsForward);
  const epsT = n(stock?.epsTrailingTwelveMonths);

  // Optional profitability if provided
  const roe = toPercent(stock?.roe);
  const ebitMargin = toPercent(stock?.ebitMargin);

  let growth = 0, health = 0, dividend = 0, sanity = 0, profitability = 0;

  // Growth
  if (epsGpct >= 20) growth += 3;
  else if (epsGpct >= 10) growth += 2;
  else if (epsGpct >= 5) growth += 1;
  else if (epsGpct < 0) growth -= 2;

  const epsRatio = epsT ? epsF / epsT : 1;
  if (epsRatio >= 1.2) growth += 2;
  else if (epsRatio >= 1.05) growth += 1;
  else if (epsRatio <= 0.95) growth -= 1;

  // Health (ignore D/E for financials)
  if (!isFinancial) {
    if (d2e < 0.25) health += 3;
    else if (d2e < 0.5) health += 2;
    else if (d2e < 1.0) health += 1;
    else if (d2e > 2.0) health -= 2;
    else if (d2e > 1.5) health -= 1;
  }

  // Profitability hints (optional data)
  if (roe) {
    if (roe >= 20) profitability += 2;
    else if (roe >= 12) profitability += 1;
    else if (roe <= 4) profitability -= 1;
  }
  if (ebitMargin) {
    if (ebitMargin >= 18) profitability += 1;
    else if (ebitMargin <= 5) profitability -= 0.5;
  }

  // Dividend
  if (dy > 0) {
    if (dy >= 6) dividend += 3;
    else if (dy >= 4) dividend += 2;
    else if (dy >= 2) dividend += 1;

    if (dg5 >= 10) dividend += 2;
    else if (dg5 >= 5) dividend += 1;
    else if (dg5 < 0) dividend -= 1; // dividend cut risk
  }

  // Sanity (profitability present & non-absurd sales multiple)
  if (pe > 0 && epsT > 0) sanity += 1;
  if (!isFinancial && ps > 0 && ps < 12) sanity += 0.5;

  const g = clamp(growth * 2, 0, 10);
  const h = clamp((health + 2) * 2, 0, 10);
  const d = clamp(dividend * 2, 0, 10);
  const s = clamp(sanity * 3, 0, 10);
  const p = clamp(profitability * 2, 0, 10);

  const weights = {
    growth: isHGrowth ? 0.4 : isDivFocus ? 0.2 : 0.33,
    health: 0.25,
    dividend: isDivFocus ? 0.2 : 0.1,
    profitability: 0.25,
    sanity: 0.07,
  };

  const score = g * weights.growth + h * weights.health + d * weights.dividend + p * weights.profitability + s * weights.sanity;
  return Math.round(score * 10) / 10;
}
export const getAdvancedFundamentalScore = getQualityScore; // alias

/* =============================================================================
 * VALUATION SCORE (0 … 10)
 * – JP-only: sector-aware PE/PB/PS bands + normalized PEG + EV/EBIT/EV/EBITDA
 *   + FCF yield & shareholder yield sweeteners; size tilt when currency is JPY.
 * =============================================================================
 */
export function getValuationScore(stock, weightOverrides = {}) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  const sector = stock?.sector || "";
  const isHG = HIGH_GROWTH_SECTORS.has(sector);
  const isVAL = DIVIDEND_FOCUS_SECTORS.has(sector) || ["Utilities","Real Estate"].includes(sector);
  const isFinancial = FINANCIAL_SECTORS.has(sector);

  const pe = wins(n(stock?.peRatio), 0, 200);         // clamp extreme PE
  const pb = wins(n(stock?.pbRatio), 0, 20);
  const ps = wins(n(stock?.priceToSales), 0, 40);
  const evE = wins(n(stock?.evToEbit), 0, 80);
  const evEbitda = wins(n(stock?.evToEbitda), 0, 60);
  const fcfYield = toPercent(stock?.fcfYieldPct);       // %
  const shareholderYield = toPercent(stock?.shareholderYieldPct); // % (div + buybacks)
  const gEPSpct = toPercent(stock?.epsGrowthRate);      // normalize to %

  // Size tilt (only if JPY)
  const mc = n(stock?.marketCap);
  let sizeS = 0;
  // Always apply JPY size tilt (you trade JP only)
  if (Number.isFinite(mc)) {
    if (mc >= 10e12) sizeS = 0.5;      // ≥ ¥10T
    else if (mc >= 1e12) sizeS = 0.3;  // ≥ ¥1T
    else if (mc >= 1e11) sizeS = 0.0;  // ≥ ¥100B
    else if (mc >= 2e10) sizeS = -0.2; // ≥ ¥20B
    else sizeS = -0.5;                 // micro
  }

  const scaleLowBetter = (val, good, ok, bad) => {
    if (!Number.isFinite(val) || val <= 0) return -2;
    if (val <= good) return 2;
    if (val <= ok) return 1;
    if (val <= bad) return -1;
    return -2;
  };

  // PE bands
  const peS = pe <= 0 ? -2 : scaleLowBetter(
    pe,
    isHG ? 25 : isVAL ? 8 : 10,
    isHG ? 40 : isVAL ? 15 : 18,
    isHG ? 60 : isVAL ? 20 : 30
  );

  // PB bands
  const pbS = pb <= 0 ? -1 : scaleLowBetter(
    pb,
    isHG ? 2.0 : isVAL ? 0.8 : 1.0,
    isHG ? 4.0 : isVAL ? 1.5 : 2.5,
    isHG ? 6.0 : isVAL ? 2.5 : 4.0
  );

  // PS bands (ignore for financials). If strong margins, allow a bit more.
  const ebitMargin = toPercent(stock?.ebitMargin);
  const psS = isFinancial ? 0 : (ps > 0 ? (
    (ebitMargin >= 12)
      ? scaleLowBetter(ps, isHG ? 4 : 1.5, isHG ? 8 : 3, isHG ? 12 : 5)
      : scaleLowBetter(ps, isHG ? 3 : 1.2, isHG ? 6 : 2, isHG ? 10 : 4)
  ) : 0);

  // PEG (growth as %) with graded penalty
  let pegS = 0;
  if (pe > 0 && gEPSpct > 0) {
    const peg = pe / gEPSpct; // growth in %
    if (peg < 1) pegS = 1.5;
    else if (peg < 2) pegS = 0.5;
    else if (peg < 3) pegS = 0.0;
    else if (peg < 5) pegS = -0.7;
    else pegS = -1.2;
  }

  // EV/EBIT and EV/EBITDA bands (ignore if not available or for financials)
  let eveS = 0, ebitdaS = 0;
  if (!isFinancial && Number.isFinite(evE) && evE > 0) {
    eveS = scaleLowBetter(evE, isHG ? 12 : 8, isHG ? 20 : 12, isHG ? 28 : 18);
  }
  if (!isFinancial && Number.isFinite(evEbitda) && evEbitda > 0) {
    ebitdaS = scaleLowBetter(evEbitda, isHG ? 8 : 6, isHG ? 12 : 8, isHG ? 18 : 12);
  }

  // Yield sweeteners (bounded)
  const fyS = Number.isFinite(fcfYield) ? (fcfYield >= 8 ? 1.2 : fcfYield >= 4 ? 0.6 : fcfYield >= 2 ? 0.3 : 0) : 0;
  const shyS = Number.isFinite(shareholderYield) ? (shareholderYield >= 8 ? 0.8 : shareholderYield >= 4 ? 0.4 : 0) : 0;

  const W = {
    pe: 1.3,
    pb: 1.0,
    ps: 0.9,
    peg: 1.0,
    evE: 1.0,
    evEbitda: 0.8,
    fcfYield: 0.8,
    shareholderYield: 0.5,
    size: 0.4,
    ...weightOverrides,
  };

  const raw =
    peS * W.pe +
    pbS * W.pb +
    psS * W.ps +
    pegS * W.peg +
    eveS * W.evE +
    ebitdaS * W.evEbitda +
    fyS * W.fcfYield +
    shyS * W.shareholderYield +
    sizeS * W.size;

  // Map raw (roughly -10..+10) into 0..10 band, then clamp
  const score = clamp((raw + 8) * (10 / 16), 0, 10);
  return Math.round(score * 10) / 10;
}

/* =============================================================================
 * VALUE-ONLY NUMERIC TIER (1 … 6)
 * – Uses only quality (fundamentals) and valuation. Technicals ignored by default.
 *   weights.mode:
 *     - "value_only"  (default): {fund:0.45, val:0.55}
 *     - "value_first" (tiny tech whisper if you still pass tech)
 *   Lightweight anti-trap guards expanded: loss-making TTM, high leverage, neg FCF.
 * =============================================================================
 */
export function getNumericTier(stock, weights = {}) {
  const mode = weights.mode || "value_only";
  const preset =
    mode === "value_first"
      ? { tech: 0.05, fund: 0.4, val: 0.55 }
      : { tech: 0.0, fund: 0.45, val: 0.55 };
  const w = { ...preset, ...weights };

  const tRaw = Number.isFinite(stock?.technicalScore) ? stock.technicalScore : 0;
  const fRaw = Number.isFinite(stock?.fundamentalScore)
    ? stock.fundamentalScore
    : Number.isFinite(stock?.qualityScore)
    ? stock.qualityScore
    : 0;
  const vRaw = Number.isFinite(stock?.valuationScore) ? stock.valuationScore : 0;

  // Assume tech/fund/val already on 0..10 scales
  const tech = clamp(tRaw, 0, 10);
  const fund = clamp(fRaw, 0, 10);
  const val = clamp(vRaw, 0, 10);

  let score = tech * w.tech + fund * w.fund + val * w.val;

  // Anti-trap guards
  const sector = stock?.sector || "";
  const isFinancial = FINANCIAL_SECTORS.has(sector);
  const d2e = toRatio(stock?.debtEquityRatio);
  const epsT = nz(stock?.epsTrailingTwelveMonths);
  const fcfYield = toPercent(stock?.fcfYieldPct);

  if (epsT <= 0) score -= 0.5;                // losing money TTM
  if (!isFinancial && d2e > 2.0) score -= 0.4; // high leverage (non-financials)
  if (Number.isFinite(fcfYield) && fcfYield < 0) score -= 0.4; // negative FCF yield

  score = clamp(score, 0, 10);

  if (score >= 8) return 1;   // Great & Cheap (Dream)
  if (score >= 6.5) return 2; // Great leaning cheap (Elite)
  if (score >= 5) return 3;   // Fairly priced quality (Solid)
  if (score >= 3.5) return 4; // Speculative / mixed
  if (score >= 2) return 5;   // Risky / likely trap
  return 6;                   // Red Flag
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
    return { label: "Weak & Cheap (Trap?)", verdict: "Cheap for a reason risk" };
  return { label: "Weak & Expensive", verdict: "Avoid / poor value" };
}
