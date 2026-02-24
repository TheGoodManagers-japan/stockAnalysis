// valuePlay.js — Standalone value play analysis engine
// Scores stocks on 4 pillars (0-25 each) for a 0-100 total.
// Classifies into 5 categories, generates reasoning, entry/exit guidance.

import {
  toPercent,
  toRatio,
  clamp,
  nz,
  FINANCIAL_SECTORS,
  HIGH_GROWTH_SECTORS,
  DIVIDEND_FOCUS_SECTORS,
} from "./techFundValAnalysis.js";

/* ============================================================================
 * Constants
 * ========================================================================= */

const CYCLICAL_SECTORS = new Set([
  "steel_nonferrous_metals",
  "raw_materials_chemicals",
  "construction_materials",
  "automobiles_transportation_equipment",
  "machinery",
  "electric_appliances_precision",
  "transportation_logistics",
]);

const GRADES = [
  { min: 75, grade: "A" },
  { min: 60, grade: "B" },
  { min: 45, grade: "C" },
  { min: 30, grade: "D" },
  { min: 0, grade: "F" },
];

const GRADE_TARGET_STOP = {
  A: { targetPct: 0.25, stopPct: 0.10 },
  B: { targetPct: 0.18, stopPct: 0.13 },
  C: { targetPct: 0.12, stopPct: 0.16 },
  D: { targetPct: 0.08, stopPct: 0.18 },
  F: { targetPct: 0.05, stopPct: 0.20 },
};

const TIME_HORIZON_DAYS = {
  DEEP_VALUE: 365,
  QARP: 548,
  DIVIDEND_COMPOUNDER: 730,
  ASSET_PLAY: 274,
  RECOVERY_VALUE: 183,
};

const TIME_HORIZONS = {
  DEEP_VALUE: "6-18 months",
  QARP: "1-3 years",
  DIVIDEND_COMPOUNDER: "2-5 years",
  ASSET_PLAY: "6-12 months",
  RECOVERY_VALUE: "3-12 months",
};

const CLASSIFICATION_LABELS = {
  DEEP_VALUE: "Deep Value",
  QARP: "Quality at Reasonable Price",
  DIVIDEND_COMPOUNDER: "Dividend Compounder",
  ASSET_PLAY: "Asset Play",
  RECOVERY_VALUE: "Recovery Value",
};

/* ============================================================================
 * Helpers
 * ========================================================================= */

function f(v) {
  return Number.isFinite(v) ? v : 0;
}

function fmt(v, decimals = 1) {
  return Number.isFinite(v) ? v.toFixed(decimals) : "-";
}

function fmtJpy(v) {
  if (!Number.isFinite(v)) return "-";
  if (v >= 1e12) return `¥${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `¥${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `¥${(v / 1e6).toFixed(0)}M`;
  return `¥${Math.round(v).toLocaleString()}`;
}

function isFinSector(sector) {
  return FINANCIAL_SECTORS.has(sector);
}

/* ============================================================================
 * Pillar 1 — Intrinsic Value (0-25): How cheap is it?
 * ========================================================================= */

function scoreIntrinsicValue(stock) {
  let pts = 0;

  const pe = f(stock.peRatio);
  const eps = f(stock.epsTrailingTwelveMonths);
  const pb = f(toRatio(stock.pbRatio));
  const price = f(stock.currentPrice);
  const evEbitda = f(stock.evToEbitda);

  // Earnings yield (1/PE)
  const earningsYield = pe > 0 ? (1 / pe) * 100 : 0;
  if (earningsYield > 10) pts += 7;
  else if (earningsYield > 7) pts += 5;
  else if (earningsYield > 5) pts += 3;
  else if (earningsYield > 3) pts += 1;

  // Graham Number discount
  let grahamNumber = 0;
  let grahamDiscount = 0;
  if (eps > 0 && pb > 0 && price > 0) {
    const bvPerShare = price / pb;
    grahamNumber = Math.sqrt(22.5 * eps * bvPerShare);
    grahamDiscount = ((grahamNumber - price) / grahamNumber) * 100;
    if (grahamDiscount > 40) pts += 6;
    else if (grahamDiscount > 20) pts += 4;
    else if (grahamDiscount > 0) pts += 2;
  }

  // PB discount
  if (pb > 0) {
    if (pb < 0.5) pts += 6;
    else if (pb < 0.7) pts += 4;
    else if (pb < 1.0) pts += 3;
    else if (pb < 1.5) pts += 1;
  }

  // EV/EBITDA
  if (evEbitda > 0) {
    if (evEbitda < 4) pts += 6;
    else if (evEbitda < 6) pts += 4;
    else if (evEbitda < 8) pts += 3;
    else if (evEbitda < 12) pts += 1;
  }

  return {
    score: Math.min(pts, 25),
    earningsYield,
    grahamNumber,
    grahamDiscount,
  };
}

/* ============================================================================
 * Pillar 2 — Quality (0-25): Is cheapness justified or a trap?
 * ========================================================================= */

function scoreQuality(stock) {
  let pts = 0;

  const eps = f(stock.epsTrailingTwelveMonths);
  const epsF = f(stock.epsForward);
  const epsGrowth = f(toPercent(stock.epsGrowthRate));
  const fcfYield = f(stock.fcfYieldPct);
  const de = f(toRatio(stock.debtEquityRatio));
  const totalCash = f(stock.totalCash);
  const totalDebt = f(stock.totalDebt);
  const pb = f(toRatio(stock.pbRatio));
  const price = f(stock.currentPrice);

  // Earnings consistency
  if (eps > 0) pts += 4;
  if (epsF > eps && eps > 0) pts += 2;
  if (epsGrowth > 10) pts += 2;

  // Cash generation
  if (fcfYield > 8) pts += 5;
  else if (fcfYield > 5) pts += 3;
  else if (fcfYield > 2) pts += 2;
  else if (fcfYield > 0) pts += 1;
  else if (fcfYield < 0) pts -= 2;

  // Balance sheet
  if (isFinSector(stock.sector)) {
    pts += 2; // financials: skip D/E, give default
  } else {
    if (de > 0 && de < 0.3) pts += 4;
    else if (de < 0.5) pts += 3;
    else if (de < 1.0) pts += 2;
    else if (de < 1.5) pts += 1;
    else if (de > 2.0) pts -= 2;
  }

  // Net cash bonus
  if (totalCash > totalDebt && totalCash > 0) pts += 2;

  // Profitability (implied ROE)
  let impliedROE = 0;
  if (eps > 0 && pb > 0 && price > 0) {
    const bvPerShare = price / pb;
    impliedROE = (eps / bvPerShare) * 100;
    if (impliedROE > 15) pts += 4;
    else if (impliedROE > 10) pts += 3;
    else if (impliedROE > 5) pts += 2;
  }

  return { score: Math.min(pts, 25), impliedROE };
}

/* ============================================================================
 * Pillar 3 — Safety Margin (0-25): Downside protection?
 * ========================================================================= */

function scoreSafetyMargin(stock) {
  let pts = 0;

  const ptbv = f(stock.ptbv);
  const pb = f(toRatio(stock.pbRatio));
  const divYield = f(toPercent(stock.dividendYield));
  const totalCash = f(stock.totalCash);
  const totalDebt = f(stock.totalDebt);
  const marketCap = f(stock.marketCap);
  const price = f(stock.currentPrice);
  const low52 = f(stock.fiftyTwoWeekLow);
  const high52 = f(stock.fiftyTwoWeekHigh);
  const atr = f(stock.atr14);

  // P/TBV (or fallback to PB)
  const tbvMetric = ptbv > 0 ? ptbv : pb;
  if (tbvMetric > 0) {
    if (tbvMetric < 0.5) pts += 6;
    else if (tbvMetric < 0.8) pts += 4;
    else if (tbvMetric < 1.0) pts += 3;
    else if (tbvMetric < 1.5) pts += 1;
  }

  // Dividend floor
  if (divYield > 5) pts += 5;
  else if (divYield > 4) pts += 4;
  else if (divYield > 3) pts += 3;
  else if (divYield > 2) pts += 2;
  else if (divYield > 1) pts += 1;

  // Net cash cushion
  let netCashRatio = 0;
  if (marketCap > 0) {
    netCashRatio = ((totalCash - totalDebt) / marketCap) * 100;
    if (netCashRatio > 30) pts += 5;
    else if (netCashRatio > 15) pts += 3;
    else if (netCashRatio > 5) pts += 2;
    else if (netCashRatio > 0) pts += 1;
  }

  // 52-week position
  if (low52 > 0 && price > 0) {
    const ratioToLow = price / low52;
    if (ratioToLow <= 1.1) pts += 4;
    else if (ratioToLow <= 1.2) pts += 3;
    else if (ratioToLow <= 1.3) pts += 2;

    if (high52 > 0 && price >= high52 * 0.98) pts -= 1;
  }

  // Low volatility
  if (atr > 0 && price > 0) {
    const atrPct = (atr / price) * 100;
    if (atrPct < 2) pts += 3;
    else if (atrPct < 3) pts += 2;
    else if (atrPct < 4) pts += 1;
  }

  return { score: Math.min(pts, 25), netCashRatio };
}

/* ============================================================================
 * Pillar 4 — Catalyst (0-25): Will value unlock?
 * ========================================================================= */

function scoreCatalyst(stock) {
  let pts = 0;

  const regime = stock.marketRegime || "";
  const ltScore = f(stock.longTermScore); // 1=bullish, 7=bearish
  const price = f(stock.currentPrice);
  const ma200 = f(stock.movingAverage200d);
  const ma75 = f(stock.movingAverage75d);
  const ma25 = f(stock.movingAverage25d);
  const rsi = f(stock.rsi14);
  const divGrowth = f(toPercent(stock.dividendGrowth5yr));
  const shYield = f(stock.shareholderYieldPct);

  // LT Regime
  if (regime === "STRONG_UP") pts += 5;
  else if (regime === "UP") pts += 4;
  else if (regime === "RANGE") pts += 2;
  // DOWN = 0

  // LT Sentiment (lower = more bullish)
  if (ltScore >= 1 && ltScore <= 2) pts += 3;
  else if (ltScore === 3) pts += 2;
  else if (ltScore === 4) pts += 1;

  // MA Recovery
  if (price > 0) {
    if (ma200 > 0 && price > ma200) pts += 3;
    else if (ma75 > 0 && price > ma75) pts += 2;
    else if (ma25 > 0 && price > ma25) pts += 1;
  }

  // RSI room
  if (rsi > 0) {
    if (rsi >= 30 && rsi < 50) pts += 4;
    else if (rsi >= 50 && rsi < 60) pts += 3;
    else if (rsi >= 60 && rsi < 70) pts += 2;
    else if (rsi < 30) pts += 2; // deeply oversold
    // rsi >= 70 = 0
  }

  // Dividend growth
  if (divGrowth > 10) pts += 4;
  else if (divGrowth > 5) pts += 3;
  else if (divGrowth > 0) pts += 2;
  else if (divGrowth === 0) pts += 1;

  // Shareholder yield
  if (shYield > 6) pts += 3;
  else if (shYield > 4) pts += 2;
  else if (shYield > 2) pts += 1;

  return { score: Math.min(pts, 25) };
}

/* ============================================================================
 * Classification
 * ========================================================================= */

function classify(stock, pillars, metrics) {
  const { intrinsicValue, quality, safetyMargin, catalyst } = pillars;
  const pe = f(stock.peRatio);
  const pb = f(toRatio(stock.pbRatio));
  const ptbv = f(stock.ptbv) || pb;
  const divYield = f(toPercent(stock.dividendYield));
  const divGrowth = f(toPercent(stock.dividendGrowth5yr));
  const fcfYield = f(stock.fcfYieldPct);
  const epsF = f(stock.epsForward);
  const eps = f(stock.epsTrailingTwelveMonths);
  const price = f(stock.currentPrice);
  const low52 = f(stock.fiftyTwoWeekLow);
  const regime = stock.marketRegime || "";
  const totalCash = f(stock.totalCash);
  const totalDebt = f(stock.totalDebt);
  const marketCap = f(stock.marketCap);
  const netCashRatio = marketCap > 0 ? ((totalCash - totalDebt) / marketCap) * 100 : 0;

  const candidates = [];

  // Deep Value: cheapest of the cheap
  if (intrinsicValue >= 18 && pb < 0.8 && pe > 0 && pe < 12 && quality >= 10) {
    candidates.push({ cls: "DEEP_VALUE", score: intrinsicValue });
  }

  // QARP: great business at fair price
  if (quality >= 18 && intrinsicValue >= 12 && epsF > eps && fcfYield > 0) {
    candidates.push({ cls: "QARP", score: quality });
  }

  // Dividend Compounder
  if (divYield >= 3 && divGrowth > 0 && fcfYield > divYield && quality >= 12) {
    candidates.push({ cls: "DIVIDEND_COMPOUNDER", score: (divYield * 2) + divGrowth });
  }

  // Asset Play
  if ((ptbv > 0 && ptbv < 0.7) || netCashRatio > 20) {
    if (safetyMargin >= 18 && eps > 0) {
      candidates.push({ cls: "ASSET_PLAY", score: safetyMargin });
    }
  }

  // Recovery Value
  if (epsF > eps && eps > 0 && catalyst >= 15) {
    const nearLow = low52 > 0 && price > 0 && price <= low52 * 1.2;
    const regimeImproving = regime === "UP" || regime === "RANGE" || regime === "STRONG_UP";
    if (nearLow || regimeImproving) {
      candidates.push({ cls: "RECOVERY_VALUE", score: catalyst });
    }
  }

  // Pick best match or fallback to highest pillar
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].cls;
  }

  // Fallback: map highest pillar to most fitting category
  const pillarMax = Math.max(intrinsicValue, quality, safetyMargin, catalyst);
  if (pillarMax === intrinsicValue) return "DEEP_VALUE";
  if (pillarMax === quality) return "QARP";
  if (pillarMax === safetyMargin) return "ASSET_PLAY";
  return "RECOVERY_VALUE";
}

/* ============================================================================
 * Reasoning Engine
 * ========================================================================= */

function buildThesis(stock, metrics, classification) {
  const parts = [];
  const pe = f(stock.peRatio);
  const pb = f(toRatio(stock.pbRatio));

  if (pe > 0 && metrics.earningsYield > 3) {
    parts.push(`Trading at ${fmt(pe)}x earnings (${fmt(metrics.earningsYield)}% yield)`);
  }
  if (pb > 0 && pb < 1.5) {
    parts.push(`${fmt(pb)}x book value`);
  }
  if (metrics.grahamDiscount > 10) {
    parts.push(`${fmt(metrics.grahamDiscount)}% below Graham Number`);
  }
  if (metrics.fcfYield > 3) {
    parts.push(`generating ${fmt(metrics.fcfYield)}% free cash flow`);
  }
  if (metrics.dividendYield > 2) {
    const dg = metrics.dividendGrowth5yr;
    const dgStr = dg > 0 ? ` with ${fmt(dg)}% 5yr growth` : "";
    parts.push(`paying ${fmt(metrics.dividendYield)}% dividend${dgStr}`);
  }
  if (metrics.debtEquity < 0.5 && !isFinSector(stock.sector)) {
    parts.push(`conservative balance sheet (D/E ${fmt(metrics.debtEquity)})`);
  }
  if (metrics.netCashRatio > 10) {
    parts.push(`net cash position`);
  }
  if (metrics.impliedROE > 10) {
    parts.push(`${fmt(metrics.impliedROE)}% ROE`);
  }

  if (parts.length === 0) return `${CLASSIFICATION_LABELS[classification]} candidate.`;

  // Capitalize first part
  parts[0] = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  return parts.slice(0, 4).join(". ") + ".";
}

function buildRisks(stock, metrics) {
  const risks = [];
  const epsGrowth = f(toPercent(stock.epsGrowthRate));
  const de = f(toRatio(stock.debtEquityRatio));
  const fcfYield = f(stock.fcfYieldPct);
  const divYield = f(toPercent(stock.dividendYield));
  const divGrowth = f(toPercent(stock.dividendGrowth5yr));
  const price = f(stock.currentPrice);
  const high52 = f(stock.fiftyTwoWeekHigh);
  const regime = stock.marketRegime || "";

  if (epsGrowth < 5 && epsGrowth >= 0) {
    risks.push(`Low earnings growth (${fmt(epsGrowth)}%)`);
  }
  if (epsGrowth < 0) {
    risks.push(`Declining earnings (${fmt(epsGrowth)}%)`);
  }
  if (CYCLICAL_SECTORS.has(stock.sector)) {
    risks.push("Cyclical sector - earnings may be near peak");
  }
  if (de > 1.0 && !isFinSector(stock.sector)) {
    risks.push(`Elevated debt (D/E ${fmt(de)})`);
  }
  if (fcfYield < 0) {
    risks.push("Negative free cash flow");
  }
  if (divYield <= 0) {
    risks.push("No dividend income buffer");
  }
  if (divGrowth < 0) {
    risks.push(`Declining dividends (${fmt(divGrowth)}% 5yr)`);
  }
  if (high52 > 0 && price > 0 && price >= high52 * 0.95) {
    risks.push("Near 52-week high — limited upside margin");
  }
  if (regime === "DOWN") {
    risks.push("Downtrend regime — adverse momentum");
  }

  return risks.length > 0 ? risks : ["No major red flags identified"];
}

function buildCatalyst(stock, metrics) {
  const parts = [];
  const divGrowth = f(toPercent(stock.dividendGrowth5yr));
  const pb = f(toRatio(stock.pbRatio));
  const shYield = f(stock.shareholderYieldPct);
  const regime = stock.marketRegime || "";

  if (divGrowth > 5) {
    parts.push(`dividend growth compounding (${fmt(divGrowth)}% CAGR)`);
  }
  if (pb > 0 && pb < 1.0) {
    parts.push(`trading below book value (PB ${fmt(pb)}x) — potential rerating`);
  }
  if (regime === "UP" || regime === "STRONG_UP") {
    parts.push("favorable market regime supporting upside");
  }
  if (shYield > 4) {
    parts.push(`high shareholder returns (${fmt(shYield)}% yield)`);
  }

  // TSE governance reforms are a macro catalyst for all JP value stocks
  parts.push("TSE corporate governance reforms driving capital efficiency improvements");

  return parts.slice(0, 3).join(". ") + ".";
}

/* ============================================================================
 * Entry / Exit Framework
 * ========================================================================= */

function buildEntryExit(stock, grade, classification) {
  const price = f(stock.currentPrice);
  const ma200 = f(stock.movingAverage200d);
  const ma75 = f(stock.movingAverage75d);
  const ma25 = f(stock.movingAverage25d);

  // Determine entry approach
  let approach;
  if (ma200 > 0 && price < ma200) {
    approach = `Accumulate on weakness below ¥${Math.round(ma200).toLocaleString()} (MA200)`;
  } else if (ma200 > 0 && price <= ma200 * 1.03) {
    approach = `Attractive entry near long-term average at ¥${Math.round(ma200).toLocaleString()}`;
  } else if (ma200 > 0 && ma75 > 0 && price <= ma75) {
    approach = `Fair entry. Accumulate on pullbacks toward ¥${Math.round(ma200).toLocaleString()} (MA200)`;
  } else if (ma75 > 0) {
    approach = `Wait for pullback toward ¥${Math.round(ma75).toLocaleString()} (MA75) for better entry`;
  } else {
    approach = "Current levels acceptable for gradual accumulation";
  }

  // Accumulation zone
  const zoneLow = ma200 > 0 ? ma200 : price * 0.95;
  const zoneHigh = ma75 > 0 ? ma75 : price * 1.05;
  const accumulationZone = [Math.round(Math.min(zoneLow, zoneHigh)), Math.round(Math.max(zoneLow, zoneHigh))];

  // Conviction
  const conviction = grade === "A" ? "HIGH" : grade === "B" ? "MEDIUM" : "LOW";

  // Exit triggers
  const triggers = [];
  const pe = f(stock.peRatio);
  if (pe > 0) {
    const exitPE = Math.round(pe * 2);
    triggers.push(`PE exceeds ${exitPE}x (valuation stretched)`);
  }
  const divYield = f(toPercent(stock.dividendYield));
  if (divYield > 2) {
    triggers.push("Dividend cut or payout ratio becomes unsustainable");
  }
  triggers.push("EPS turns negative for two consecutive quarters");
  if (!isFinSector(stock.sector)) {
    triggers.push("D/E ratio rises above 2.0");
  }
  triggers.push("Value play score drops below 30 on re-scan");

  // Numeric target/stop for signal tracking
  const params = GRADE_TARGET_STOP[grade] || GRADE_TARGET_STOP.C;
  const targetPrice = price > 0 ? Math.round(price * (1 + params.targetPct)) : null;
  const stopPrice = price > 0 ? Math.round(price * (1 - params.stopPct)) : null;
  const timeHorizonDays = classification ? (TIME_HORIZON_DAYS[classification] || 365) : 365;

  return {
    approach,
    conviction,
    accumulationZone,
    triggers,
    reviewPeriod: "QUARTERLY",
    targetPrice,
    stopPrice,
    timeHorizonDays,
  };
}

/* ============================================================================
 * Main Entry Point
 * ========================================================================= */

export function analyzeValuePlay(stock, historicalData) {
  const price = f(stock.currentPrice);
  if (!price) {
    return {
      isValueCandidate: false,
      valuePlayScore: 0,
      grade: "F",
      classification: null,
      pillars: { intrinsicValue: 0, quality: 0, safetyMargin: 0, catalyst: 0 },
      thesis: "Insufficient data for value analysis.",
      risks: [],
      catalyst: "",
      timeHorizon: "",
      entry: { approach: "", conviction: "LOW", accumulationZone: [0, 0] },
      exit: { triggers: [], reviewPeriod: "QUARTERLY" },
      metrics: {},
    };
  }

  // Score each pillar
  const iv = scoreIntrinsicValue(stock);
  const qual = scoreQuality(stock);
  const safety = scoreSafetyMargin(stock);
  const cat = scoreCatalyst(stock);

  const pillars = {
    intrinsicValue: iv.score,
    quality: qual.score,
    safetyMargin: safety.score,
    catalyst: cat.score,
  };

  const totalScore = iv.score + qual.score + safety.score + cat.score;

  // Grade
  const grade = GRADES.find((g) => totalScore >= g.min)?.grade || "F";
  const isValueCandidate = totalScore >= 45;

  // Metrics snapshot
  const metrics = {
    earningsYield: iv.earningsYield,
    grahamNumber: iv.grahamNumber,
    grahamDiscount: iv.grahamDiscount,
    impliedROE: qual.impliedROE,
    fcfYield: f(stock.fcfYieldPct),
    dividendYield: f(toPercent(stock.dividendYield)),
    dividendGrowth5yr: f(toPercent(stock.dividendGrowth5yr)),
    shareholderYield: f(toPercent(stock.shareholderYieldPct)),
    pbRatio: f(toRatio(stock.pbRatio)),
    ptbv: f(stock.ptbv),
    netCashRatio: safety.netCashRatio,
    evToEbitda: f(stock.evToEbitda),
    debtEquity: f(toRatio(stock.debtEquityRatio)),
    peRatio: f(stock.peRatio),
  };

  // Classification
  const classification = isValueCandidate
    ? classify(stock, pillars, metrics)
    : null;

  // Reasoning
  const thesis = isValueCandidate
    ? buildThesis(stock, metrics, classification)
    : "Does not meet value play criteria.";
  const risks = isValueCandidate ? buildRisks(stock, metrics) : [];
  const catalyst = isValueCandidate ? buildCatalyst(stock, metrics) : "";
  const timeHorizon = classification ? TIME_HORIZONS[classification] : "";

  // Entry/Exit
  const entryExit = isValueCandidate
    ? buildEntryExit(stock, grade, classification)
    : { approach: "", conviction: "LOW", accumulationZone: [0, 0], triggers: [], reviewPeriod: "QUARTERLY", targetPrice: null, stopPrice: null, timeHorizonDays: null };

  return {
    isValueCandidate,
    valuePlayScore: totalScore,
    grade,
    classification,
    pillars,
    thesis,
    risks,
    catalyst,
    timeHorizon,
    entry: {
      approach: entryExit.approach,
      conviction: entryExit.conviction,
      accumulationZone: entryExit.accumulationZone,
      targetPrice: entryExit.targetPrice,
      stopPrice: entryExit.stopPrice,
      timeHorizonDays: entryExit.timeHorizonDays,
    },
    exit: {
      triggers: entryExit.triggers,
      reviewPeriod: entryExit.reviewPeriod,
    },
    metrics,
  };
}
