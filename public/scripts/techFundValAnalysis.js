export function getTechnicalScore(stock, customWeights = {}) {
  const n = (v) => (Number.isFinite(v) ? v : 0); // safe number
  /* ---------- pull metrics ---------- */
  const {
    currentPrice = 0,
    movingAverage50d = 0,
    movingAverage200d = 0,
    rsi14 = 50,
    macd = 0,
    macdSignal = 0,
    bollingerMid = currentPrice,
    bollingerUpper = currentPrice * 1.1,
    bollingerLower = currentPrice * 0.9,
    stochasticK = 50,
    stochasticD = 50,
    atr14 = currentPrice * 0.02,
    obv = 0,
    obvMA20 = 0, // supply if available
  } = stock;

  /* ---------- weights ---------- */
  const W = {
    trend: 2.5,
    momentum: 2.0,
    volatility: 1.5,
    special: 1.5,
    ...customWeights,
  };

  /* ---------- helpers ---------- */
  const pctDiff = (a, b) => Math.abs(a - b) / (Math.abs(b) || 1e-6);

  /* ---------- scoring ---------- */
  let bull = 0,
    bear = 0;

  /* --- TREND ---------------------------------------------------------- */
  const gc =
    movingAverage50d > movingAverage200d &&
    pctDiff(movingAverage50d, movingAverage200d) < 0.05;
  const dc =
    movingAverage50d < movingAverage200d &&
    pctDiff(movingAverage50d, movingAverage200d) < 0.05;
  const sbt = movingAverage50d > movingAverage200d * 1.05;
  const sbr = movingAverage50d < movingAverage200d * 0.95;
  const mbt = movingAverage50d > movingAverage200d && !gc && !sbt;
  const mbr = movingAverage50d < movingAverage200d && !dc && !sbr;

  if (sbt) bull += W.trend * 1.3;
  else if (mbt) bull += W.trend;
  if (gc) bull += W.special * 2;
  if (sbr) bear += W.trend * 1.3;
  else if (mbr) bear += W.trend;
  if (dc) bear += W.special * 2;

  /* --- MOMENTUM ------------------------------------------------------- */
  const macdBase = Math.max(Math.abs(macd), 1e-4);
  const macdCross = Math.abs(macd - macdSignal) < macdBase * 0.1;
  const macdDiv = Math.abs(macd - macdSignal) > macdBase * 0.25;

  if (macd > macdSignal) {
    bull += W.momentum * 0.8;
    if (macdDiv) bull += W.momentum * 0.4;
  } else {
    bear += W.momentum * 0.8;
    if (macdDiv) bear += W.momentum * 0.4;
  }
  if (macdCross && macd > 0) bull += W.special * 0.8;
  if (macdCross && macd < 0) bear += W.special * 0.8;

  if (rsi14 >= 70) bear += W.special;
  else if (rsi14 <= 30) bull += W.special;
  else if (rsi14 >= 55) bull += W.momentum * 0.7;
  else if (rsi14 <= 45) bear += W.momentum * 0.7;

  if (stochasticK > stochasticD) {
    bull += W.momentum * 0.6;
    if (stochasticK <= 20) bull += W.special * 0.8;
  } else {
    bear += W.momentum * 0.6;
    if (stochasticK >= 80) bear += W.special * 0.8;
  }

  if (obvMA20) {
    if (obv > obvMA20) bull += W.momentum * 0.5;
    else if (obv < obvMA20) bear += W.momentum * 0.5;
  }

  /* --- PRICE ACTION / VOLATILITY ------------------------------------- */
  const mid = Math.max(bollingerMid, 1e-6);
  const bandW = (bollingerUpper - bollingerLower) / mid;
  const upperBreak = currentPrice > bollingerUpper;
  const lowerBreak = currentPrice < bollingerLower;

  if (upperBreak) bull += W.volatility * 0.9;
  else if (currentPrice > bollingerMid) bull += W.volatility * 0.6;

  if (lowerBreak) bear += W.volatility * 0.9;
  else if (currentPrice < bollingerMid) bear += W.volatility * 0.6;

  if (bandW < 0.05 && mbt) bull += W.special * 0.7;
  if (bandW < 0.05 && mbr) bear += W.special * 0.7;

  if (bandW > 0.08 && sbt) bull += W.volatility * 0.4;
  if (bandW > 0.08 && sbr) bear += W.volatility * 0.4;

  /* --- ATR scaling ---------------------------------------------------- */
  if (atr14 >= currentPrice * 0.04) {
    bull *= 1.1;
    bear *= 1.2;
  } else if (atr14 >= currentPrice * 0.03) {
    bull *= 1.05;
    bear *= 1.1;
  } else if (atr14 <= currentPrice * 0.01) {
    bull *= 0.9;
    bear *= 0.9;
  } else if (atr14 <= currentPrice * 0.015) {
    bull *= 0.95;
    bear *= 0.95;
  }

  /* ---------- –50 … +50 logistic score ---------- */
  const raw = bull - bear;
  const logistic = 1 / (1 + Math.exp(-raw)); // 0 … 1
  const score = Math.round((logistic - 0.5) * 1000) / 10;

  return score; // only the score
}


export function getAdvancedFundamentalScore(stock) {
  const n = (v) => (Number.isFinite(v) ? v : 0); // safe number

  /* ---------- canonical sector buckets ---------- */
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

  const sector = stock.sector || "";
  const isHGrowth = HIGH_GROWTH_SECTORS.has(sector);
  const isDivFocus = DIVIDEND_FOCUS_SECTORS.has(sector);
  const isFinancial = FINANCIAL_SECTORS.has(sector);
  /* ---------- pull metrics ---------- */
  const pe = n(stock.peRatio);
  const pb = n(stock.pbRatio);
  const ps = n(stock.priceToSales);
  const d2e = Math.max(n(stock.debtEquityRatio), 0);
  const dy = n(stock.dividendYield); // %
  const dg5 = n(stock.dividendGrowth5yr); // %
  const epsG = n(stock.epsGrowthRate); // %
  const epsF = n(stock.epsForward);
  const epsT = n(stock.epsTrailingTwelveMonths);
  /* ---------- pillar scores ---------- */
  let g = 0,
    v = 0,
    h = 0,
    d = 0;

  /* --- GROWTH ------------------------------------------------------------ */
  if (epsG >= 20) g += 3;
  else if (epsG >= 10) g += 2;
  else if (epsG >= 5) g += 1;
  else if (epsG < 0) g -= 2;

  const epsRatio = epsT ? epsF / epsT : 1;
  if (epsRatio >= 1.2) g += 2;
  else if (epsRatio >= 1.05) g += 1;
  else if (epsRatio <= 0.95) g -= 1;

  g = Math.max(0, Math.min(10, g * 2)); // 0-10

  /* --- VALUE ------------------------------------------------------------- */
  /* P/E */
  if (pe > 0 && pe < 10) v += 3;
  else if (pe < 15) v += 2;
  else if (pe < 20) v += 1;
  else if (pe > 30 || pe <= 0) v -= 1;

  /* P/B */
  if (pb > 0 && pb < 1) v += 3;
  else if (pb < 2) v += 2;
  else if (pb < 3) v += 1;
  else if (pb > 5) v -= 1;

  /* P/S (skip most financials) */
  if (!isFinancial) {
    if (ps > 0 && ps < 2) v += 1.5;
    else if (ps > 6) v -= 1;
  }

  /* growth-sector premium tolerance */
  if (isHGrowth && pe > 0 && pe < 25) v += 1;

  v = Math.max(0, Math.min(10, v * 1.5));

  /* --- FINANCIAL HEALTH -------------------------------------------------- */
  if (d2e < 0.25) h += 3;
  else if (d2e < 0.5) h += 2;
  else if (d2e < 1.0) h += 1;
  else if (d2e > 2.0) h -= 2;
  else if (d2e > 1.5) h -= 1;

  if (isFinancial && d2e < 1.5) h += 1; // capital-intensive leeway

  h = Math.max(0, Math.min(10, (h + 2) * 2));

  /* --- DIVIDEND ---------------------------------------------------------- */
  if (dy > 0) {
    if (dy >= 6) d += 3;
    else if (dy >= 4) d += 2;
    else if (dy >= 2) d += 1;

    if (dg5 >= 10) d += 2;
    else if (dg5 >= 5) d += 1;
    else if (dg5 < 0) d -= 1;

    d = Math.max(0, Math.min(10, d * 2));
  }

  /* ---------- sector-adjusted weights ---------- */
  const w = {
    growth: isHGrowth ? 0.45 : isDivFocus ? 0.2 : 0.35,
    value: isHGrowth ? 0.2 : 0.3,
    health: 0.25,
    dividend: isDivFocus ? 0.25 : 0.1,
  };

  /* ---------- composite 0-10 ---------- */
  const score = g * w.growth + v * w.value + h * w.health + d * w.dividend;

  return Math.round(score * 10) / 10; // one-decimal 0-10
}

/**
 *  getValuationScore(stock [, weightOverrides])
 *  -------------------------------------------
 *  • Returns ONE number in the 0‒10 range
 *  • Sector-aware bands for P/E, P/B, P/S  + PEG, Yield, Size
 *  • Optional weightOverrides = { pe, pb, ps, peg, yield, size }
 */
export function getValuationScore(stock, weightOverrides = {}) {
  const n = (v) => (Number.isFinite(v) ? v : 0); // NaN-safe

  /* 1 ─ Sector buckets ────────────────────────────────────────────── */
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

  const sector = stock.sector || "";
  const isHG = HG.has(sector);
  const isVAL = VAL.has(sector);

  /* 2 ─ Extract metrics ───────────────────────────────────────────── */
  const pe = n(stock.peRatio);
  const pb = n(stock.pbRatio);
  const ps = n(stock.priceToSales);
  const mc = n(stock.marketCap); // local currency
  const gEPS = n(stock.epsGrowthRate); // %
  const dy = n(stock.dividendYield); // %

  /* 3 ─ Helper: linear score low-better metric ---------------------- */
  const scaleLowBetter = (val, good, ok, bad) => {
    if (val <= good) return 2; // very cheap
    if (val <= ok) return 1; // cheap
    if (val <= bad) return -1; // expensive
    return -2; // very expensive
  };

  /* 4 ─ P/E, P/B, P/S ---------------------------------------------- */
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
          isHG ? 2 : isVAL ? 0.8 : 1,
          isHG ? 4 : isVAL ? 1.5 : 2.5,
          isHG ? 6 : isVAL ? 2.5 : 4
        );

  const psS =
    ps <= 0 ? 0 : scaleLowBetter(ps, isHG ? 3 : 1, isHG ? 8 : 2, isHG ? 12 : 5);

  /* 5 ─ PEG ratio (only if positive growth) ------------------------- */
  let pegS = 0;
  if (pe > 0 && gEPS > 0) {
    const peg = pe / gEPS; // crude, gEPS is % so PEG≈PE/Δ%
    if (peg < 1) pegS = 1.5;
    else if (peg < 2) pegS = 0.5;
    else if (peg > 3) pegS = -1;
  }

  /* 6 ─ Dividend yield bonus --------------------------------------- */
  const yieldS = dy >= 4 ? 0.6 : dy >= 2 ? 0.3 : 0;

  /* 7 ─ Size premium / discount ------------------------------------ */
  const sizeS =
    mc >= 1e12
      ? 0.5
      : mc >= 1e11
      ? 0.3
      : mc >= 1e10
      ? 0.0
      : mc >= 2e9
      ? -0.2
      : -0.5;

  /* 8 ─ Combine with weights --------------------------------------- */
  const W = {
    pe: 1.6,
    pb: 1.2,
    ps: 1.0,
    peg: 1.1,
    yield: 0.6,
    size: 0.5,
    ...weightOverrides, // caller tweaks on the fly
  };

  const raw =
    peS * W.pe +
    pbS * W.pb +
    psS * W.ps +
    pegS * W.peg +
    yieldS * W.yield +
    sizeS * W.size;

  /* 9 ─ Map raw (-8 … +8) → 0 … 10 --------------------------------- */
  const score = Math.max(0, Math.min(10, (raw + 8) * (10 / 16)));

  return Math.round(score * 10) / 10; // 1-dp numeric
}



export function getNumericTier(stock, weights = {}) {
  const w = { tech: 0.4, fund: 0.35, val: 0.25, ...weights };

  /* ----------- safe pulls ------------- */
  const tRaw = Number.isFinite(stock.technicalScore) ? stock.technicalScore : 0;
  const fRaw = Number.isFinite(stock.fundamentalScore)
    ? stock.fundamentalScore
    : 0;
  const vRaw = Number.isFinite(stock.valuationScore) ? stock.valuationScore : 0;

  /* ----------- normalise to 0–10 ------ */
  const tech = Math.max(0, Math.min(10, (tRaw + 50) * 0.1)); // –50…+50 → 0…10

  const fund =
    fRaw > 10 || fRaw < 0 // detect –50…+50 style input
      ? Math.max(0, Math.min(10, (fRaw + 50) * 0.1))
      : Math.max(0, Math.min(10, fRaw)); // already 0…10

  const val = Math.max(0, Math.min(10, vRaw)); // clamp

  /* ----------- base composite --------- */
  let score = tech * w.tech + fund * w.fund + val * w.val; // 0…10

  /* ----------- contextual tweaks ------ */
  if (fund >= 7.5 && val <= 2) score -= 0.4; // Over-valued quality
  if (val >= 7 && fund <= 3) score -= 0.4; // Value trap
  if (tech >= 7 && fund >= 7) score += 0.4; // Everything aligned
  if (tech <= 2 && fund >= 7) score -= 0.4; // Great co. but chart ugly

  /* ----------- assign tier ------------ */
  if (score >= 8) return 1; // Dream
  if (score >= 6.5) return 2; // Elite
  if (score >= 5) return 3; // Solid
  if (score >= 3.5) return 4; // Speculative
  if (score >= 2) return 5; // Risky
  return 6; // Red Flag
}