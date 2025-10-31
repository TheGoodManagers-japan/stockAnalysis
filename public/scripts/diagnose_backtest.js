#!/usr/bin/env node
/**
 * diagnose_backtest.js
 *
 * Extended version:
 * - Everything from your original diagnostic pipeline
 * - Adds sector / liquidity / price buckets
 * - Adds per-ticker combo profiling using those buckets
 * - Adds ticker PF ladder (best/worst tickers by PF)
 *
 * Usage:
 *   node diagnose_backtest.js path/to/backtest.json --out metrics.json --md report.md
 */

const fs = require("fs");

// -------------------- CLI --------------------
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error(
    "Usage: node diagnose_backtest.js path/to/backtest.json [--out metrics.json] [--md report.md]"
  );
  process.exit(1);
}
const inputPath = args[0];
const outIdx = args.indexOf("--out");
const mdIdx = args.indexOf("--md");
const outPath = outIdx !== -1 ? args[outIdx + 1] : null;
const mdPath = mdIdx !== -1 ? args[mdIdx + 1] : null;

// -------------------- utils --------------------
const r2 = (v) => Math.round((+v || 0) * 100) / 100;

function safeGetAllTrades(obj) {
  if (Array.isArray(obj?.byTicker) && obj.byTicker.length) {
    return obj.byTicker.flatMap((t) =>
      Array.isArray(t.trades) ? t.trades : []
    );
  }
  if (Array.isArray(obj?.globalTrades)) return obj.globalTrades;
  console.warn(
    "[info] No byTicker/globalTrades array found. This analyzer expects trades with `analytics`."
  );
  return [];
}

function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function deciles(arr) {
  const s = [...arr].filter(Number.isFinite).sort((a, b) => a - b);
  const bounds = [];
  for (let i = 0; i <= 10; i++) bounds.push(percentile(s, i / 10));
  return { bounds, sorted: s };
}

function bucketIndex(value, bounds) {
  if (!Number.isFinite(value)) return -1;
  // bounds length 11 for deciles; bin = [i, i+1)
  for (let i = 0; i < bounds.length - 1; i++) {
    const lo = bounds[i],
      hi = bounds[i + 1];
    if (i === bounds.length - 2) {
      // last bin inclusive on top
      if (value >= lo && value <= hi) return i;
    } else if (value >= lo && value < hi) {
      return i;
    }
  }
  return -1;
}

function pearson(x, y) {
  const n = Math.min(x.length, y.length);
  if (!n) return NaN;
  let sx = 0,
    sy = 0,
    sxx = 0,
    syy = 0,
    sxy = 0,
    m = 0;
  for (let i = 0; i < n; i++) {
    const xi = +x[i];
    const yi = +y[i];
    if (!Number.isFinite(xi) || !Number.isFinite(yi)) continue;
    m++;
    sx += xi;
    sy += yi;
    sxx += xi * xi;
    syy += yi * yi;
    sxy += xi * yi;
  }
  if (m < 2) return NaN;
  const cov = sxy / m - (sx / m) * (sy / m);
  const vx = sxx / m - (sx / m) * (sx / m);
  const vy = syy / m - (sy / m) * (sy / m);
  const denom = Math.sqrt(vx * vy);
  return denom ? cov / denom : NaN;
}

function summarizeMetrics(trades) {
  const n = trades.length;
  const wins = trades.filter((t) => t.result === "WIN");
  const losses = trades.filter((t) => t.result === "LOSS");

  const wr = n ? (wins.length / n) * 100 : 0;
  const avgRet = n
    ? trades.reduce((a, t) => a + (+t.returnPct || 0), 0) / n
    : 0;
  const avgHold = n
    ? trades.reduce((a, t) => a + (+t.holdingDays || 0), 0) / n
    : 0;

  const gw = wins.reduce((a, t) => a + (+t.returnPct || 0), 0);
  const gl = Math.abs(losses.reduce((a, t) => a + (+t.returnPct || 0), 0));
  const pf = gl ? gw / gl : wins.length ? Infinity : 0;

  return {
    trades: n,
    winRate: r2(wr),
    avgReturnPct: r2(avgRet),
    avgHoldingDays: r2(avgHold),
    profitFactor: r2(pf),
  };
}

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

// --- basic stats for arrays ---
function basicStats(arr) {
  const clean = arr.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) {
    return { avg: NaN, med: NaN, p90: NaN, p10: NaN };
  }
  const avg = clean.reduce((a, b) => a + b, 0) / clean.length;
  const med = percentile(clean, 0.5);
  const p90 = percentile(clean, 0.9);
  const p10 = percentile(clean, 0.1);
  return {
    avg: r2(avg),
    med: r2(med),
    p90: r2(p90),
    p10: r2(p10),
  };
}

// --- subset summary ---
function summarizeSubset(trades) {
  const m = summarizeMetrics(trades);

  const wins = trades
    .filter((t) => t.result === "WIN")
    .map((t) => +t.returnPct || 0);
  const losses = trades
    .filter((t) => t.result === "LOSS")
    .map((t) => +t.returnPct || 0);

  const winStats = basicStats(wins);
  const lossStats = basicStats(losses);

  const holdStats = basicStats(trades.map((t) => +t.holdingDays || 0));

  return {
    metrics: m,
    winStats,
    lossStats,
    holdStats,
  };
}

// --- time-to-target stats for target_only ---
function summarizeTimeToTarget(trades) {
  const hits = trades.filter((t) => t.exitType === "TARGET");

  const daysArr = hits.map((t) => +t.holdingDays || 0);
  const retArr = hits.map((t) => +t.returnPct || 0);

  const dayStats = basicStats(daysArr);
  const retStats = basicStats(retArr);

  const wr = hits.length
    ? r2(
        (100 *
          hits.filter((t) => {
            return t.result === "WIN";
          }).length) /
          hits.length
      )
    : 0;

  return {
    count: hits.length,
    winRate: wr,
    days: dayStats,
    returns: retStats,
  };
}

// -------------------- NEW BUCKET HELPERS --------------------

// Cross lag bucket: how "stale" the cross was
function bucketLag(lagVal) {
  if (!Number.isFinite(lagVal)) return "lag:n/a";
  if (lagVal < 2) return "lag:early(<2)";
  if (lagVal <= 5) return "lag:mid(2-5)";
  return "lag:late(>5)";
}

// ATR% at entry bucket (volatility style)
function bucketAtrPct(v) {
  if (!Number.isFinite(v)) return "ATR:n/a";
  if (v < 1.0) return "ATR:low(<1%)";
  if (v < 3.0) return "ATR:med(1-3%)";
  return "ATR:high(>3%)";
}

// Distance above MA25 bucket (extension / chase risk)
function bucketPxVsMA25(distPct) {
  if (!Number.isFinite(distPct)) return "pxMA25:n/a";
  // distPct = how far above MA25 in %
  if (distPct < 0) return "pxMA25:below";
  if (distPct <= 2) return "pxMA25:0-2%";
  if (distPct <= 6) return "pxMA25:2-6%";
  return "pxMA25:>6%";
}

// Sector bucket (just echo sector for now)
function bucketSector(sec) {
  if (!sec) return "sector:n/a";
  return `sector:${sec}`;
}

// Liquidity bucket (turnoverJPY ~ avgVol20 * entryPx)
function bucketLiquidity(turnoverJPY) {
  if (!Number.isFinite(turnoverJPY)) return "liq:n/a";
  if (turnoverJPY < 5_000_000) return "liq:<5M";
  if (turnoverJPY < 50_000_000) return "liq:5-50M";
  if (turnoverJPY < 200_000_000) return "liq:50-200M";
  return "liq:200M+";
}

// Price bucket (cash price per share)
function bucketPrice(entryPx) {
  if (!Number.isFinite(entryPx)) return "px:n/a";
  if (entryPx < 200) return "px:<200";
  if (entryPx < 500) return "px:200-500";
  if (entryPx < 1000) return "px:500-1000";
  if (entryPx < 3000) return "px:1k-3k";
  return "px:3k+";
}

// -------------------- LOAD & PREP DATA --------------------
const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const allTradesRaw = safeGetAllTrades(raw);

// Guard
const withAnalytics = allTradesRaw.filter(
  (t) => t && t.analytics && typeof t.analytics === "object"
);
if (!withAnalytics.length) {
  console.log(
    "[diagnose] No trades with `analytics` found. Ensure trades store analytics."
  );
  process.exit(0);
}

// -------------------- OVERALL / DISTRIBUTIONS --------------------
const overall = summarizeMetrics(withAnalytics);
const spotlight = raw?.spotlight || {};

// Return distribution
const winReturns = withAnalytics
  .filter((t) => t.result === "WIN")
  .map((t) => +t.returnPct || 0);
const lossReturns = withAnalytics
  .filter((t) => t.result === "LOSS")
  .map((t) => +t.returnPct || 0);
const winStatsAll = basicStats(winReturns);
const lossStatsAll = basicStats(lossReturns);

// Holding behavior
const holdsWin = basicStats(
  withAnalytics
    .filter((t) => t.result === "WIN")
    .map((t) => +t.holdingDays || 0)
);
const holdsLoss = basicStats(
  withAnalytics
    .filter((t) => t.result === "LOSS")
    .map((t) => +t.holdingDays || 0)
);

// -------------------- FEATURE ANALYSIS --------------------
const FEATURES = [
  "rsi",
  "atrPct",
  "volZ",
  "pxVsMA25Pct",
  "gapPct",
  "maStackScore",
];

const yWin = withAnalytics.map((t) => (t.result === "WIN" ? 1 : 0));
const yRet = withAnalytics.map((t) => +t.returnPct || 0);

const featureResults = {};
for (const f of FEATURES) {
  const values = withAnalytics.map((t) => {
    const v = t.analytics?.[f];
    return Number.isFinite(v) ? +v : NaN;
  });
  const finiteVals = values.filter(Number.isFinite);
  const { bounds } = deciles(finiteVals);

  // bucket each trade into deciles
  const bins = Array.from({ length: 10 }, () => ({
    count: 0,
    wins: 0,
    sumRet: 0,
  }));
  withAnalytics.forEach((t, idx) => {
    const v = Number(t.analytics?.[f]);
    const b = bucketIndex(v, bounds);
    if (b >= 0) {
      bins[b].count++;
      if (t.result === "WIN") bins[b].wins++;
      bins[b].sumRet += +t.returnPct || 0;
    }
  });

  const decileTable = bins.map((b, i) => ({
    decile: i + 1,
    count: b.count,
    winRate: b.count ? r2((b.wins / b.count) * 100) : 0,
    avgReturnPct: b.count ? r2(b.sumRet / b.count) : 0,
  }));

  const x = withAnalytics.map((t) =>
    Number.isFinite(+t.analytics?.[f]) ? +t.analytics[f] : NaN
  );
  const rhoWin = pearson(x, yWin);
  const rhoRet = pearson(x, yRet);

  featureResults[f] = {
    deciles: decileTable,
    corr: { win: r2(rhoWin), ret: r2(rhoRet) },
    sample: finiteVals.length,
  };
}

function pickFeatureTakeaways(fr) {
  const out = [];
  for (const [name, obj] of Object.entries(fr)) {
    const d = obj.deciles;
    if (!d.length) continue;
    const low = d[0],
      high = d[9];
    const wrDiff = r2(high.winRate - low.winRate);
    const retDiff = r2(high.avgReturnPct - low.avgReturnPct);
    const cWin = obj.corr.win;
    const cRet = obj.corr.ret;
    const dir =
      cWin > 0.1 || retDiff > 0.2
        ? "↑"
        : cWin < -0.1 || retDiff < -0.2
        ? "↓"
        : "≈";
    out.push(
      `${name}: decile10 vs decile1 — ΔWR ${wrDiff}pp, ΔAvgRet ${retDiff}pp, ρ(win) ${cWin}, ρ(ret) ${cRet} (${dir})`
    );
  }
  return out;
}
const takeaways = pickFeatureTakeaways(featureResults);

// -------------------- SENTIMENT --------------------
const sentiPairsActual =
  raw?.sentiment?.combos?.bestByWinRate?.actual ||
  raw?.sentiment?.bestByWinRate?.actual ||
  [];

const sentiPairsRejected =
  raw?.sentiment?.combos?.bestByWinRate?.rejected ||
  raw?.sentiment?.bestByWinRate?.rejected ||
  [];

function summarizeSentiPairs(list, label) {
  const top = list
    .slice(0, 5)
    .map((r) => `${r.key} (WR ${r.winRate}%, n=${r.count})`)
    .join("; ");
  return `${label}: ${top || "n/a"}`;
}
const sentiPairSummaryActual = summarizeSentiPairs(
  sentiPairsActual,
  "actual LT-ST"
);
const sentiPairSummaryRejected = summarizeSentiPairs(
  sentiPairsRejected,
  "rejected LT-ST"
);

const sentiLTActual = raw?.sentiment?.byLT?.bestByWinRateActual || [];
const sentiLTRejected = raw?.sentiment?.byLT?.bestByWinRateRejected || [];
const sentiSTActual = raw?.sentiment?.byST?.bestByWinRateActual || [];
const sentiSTRejected = raw?.sentiment?.byST?.bestByWinRateRejected || [];

function summarizeSingleAxis(list, label) {
  const top = list
    .slice(0, 5)
    .map((r) => `${r.key} (WR ${r.winRate}%, n=${r.count})`)
    .join("; ");
  return `${label}: ${top || "n/a"}`;
}

const sentiLTActualSummary = summarizeSingleAxis(sentiLTActual, "actual LT");
const sentiLTRejectedSummary = summarizeSingleAxis(
  sentiLTRejected,
  "rejected LT"
);
const sentiSTActualSummary = summarizeSingleAxis(sentiSTActual, "actual ST");
const sentiSTRejectedSummary = summarizeSingleAxis(
  sentiSTRejected,
  "rejected ST"
);

// -------------------- REGIME --------------------
const regime = raw?.regime?.metrics || {};
function fmtRegime(name) {
  const m = regime?.[name] || {};
  if (!m || !("trades" in m)) return `${name}: n/a`;
  return `${name}: WR ${m.winRate}% | PF ${m.profitFactor} | AvgRet ${m.avgReturnPct}% | n=${m.trades}`;
}
const regimeSummary = ["STRONG_UP", "UP", "RANGE", "DOWN"].map(fmtRegime);

// -------------------- CROSS-LAG --------------------
const xlag = raw?.crossing?.byLag || { WEEKLY: {}, DAILY: {} };
function summarizeLag(side) {
  const m = xlag?.[side] || {};
  const keys = Object.keys(m)
    .map((k) => +k)
    .sort((a, b) => a - b);
  if (!keys.length) return `${side}: n/a`;
  const first = m[keys[0]];
  const bestLag = keys.reduce((best, k) => {
    const wr = m[k]?.winRate ?? -1;
    return wr > (m[best]?.winRate ?? -1) ? k : best;
  }, keys[0]);
  return `${side}: early lag ${keys[0]} → WR ${
    first?.winRate ?? "n/a"
  }%, best lag ${bestLag} → WR ${m[bestLag]?.winRate ?? "n/a"}%`;
}
const lagSummary = [summarizeLag("DAILY"), summarizeLag("WEEKLY")];

// -------------------- DIP AFTER FRESH CROSS --------------------
const dipAfter = raw?.dipAfterFreshCrossing || { WEEKLY: null, DAILY: null };
function fmtDipAfter(label, m) {
  if (!m || typeof m !== "object" || !("trades" in m)) {
    return `- ${label}: n/a`;
  }
  return `- ${label}: trades ${m.trades} | WinRate ${m.winRate}% | PF ${m.profitFactor} | AvgRet ${m.avgReturnPct}%`;
}

// -------------------- PROFILES --------------------
const profiles = raw?.profiles || {};
const bestProfiles = raw?.bestProfiles || {};
function summarizeProfile(id, obj) {
  if (!obj || !obj.metrics) return null;
  const m = obj.metrics;
  return {
    id,
    label: obj.label || id,
    trades: m.trades,
    winRate: m.winRate,
    pf: m.profitFactor,
    avgRet: m.avgReturnPct,
    hold: m.avgHoldingDays,
    exits: obj.exits || { target: 0, stop: 0, time: 0 },
  };
}
const profileSummaries = Object.entries(profiles)
  .map(([id, obj]) => summarizeProfile(id, obj))
  .filter(Boolean);

// -------------------- COMPOSITE SCORE --------------------
function metricsByScore(allTrades) {
  const buckets = {}; // score -> trades[]
  for (const t of allTrades) {
    const s = Number.isFinite(t.score) ? t.score : null;
    if (s === null) continue;
    if (!buckets[s]) buckets[s] = [];
    buckets[s].push(t);
  }
  const scored = Object.keys(buckets)
    .map((k) => +k)
    .sort((a, b) => a - b)
    .map((s) => {
      const arr = buckets[s];
      const m = summarizeMetrics(arr);
      return {
        score: s,
        n: arr.length,
        winRate: m.winRate,
        pf: m.profitFactor,
        avgRet: m.avgReturnPct,
      };
    });
  return { buckets, scored };
}

function corrScore(allTrades) {
  const xs = [];
  const winArr = [];
  const retArr = [];
  for (const t of allTrades) {
    if (!Number.isFinite(t.score)) continue;
    xs.push(+t.score);
    winArr.push(t.result === "WIN" ? 1 : 0);
    retArr.push(+t.returnPct || 0);
  }
  return {
    win: pearson(xs, winArr),
    ret: pearson(xs, retArr),
  };
}

const scoreInfo = metricsByScore(withAnalytics);
const scoreCorr = corrScore(withAnalytics);

// -------------------- PLAYBOOK SLICES --------------------
function slice_HIGH_SCORE_6plus(t) {
  return Number.isFinite(t.score) && t.score >= 6;
}
function slice_DOWN_regime_ST_panic_weekly_flip(t) {
  // DOWN regime, strong ST capitulation, flip lag >=2 bars
  return (
    t.regime === "DOWN" &&
    Number.isFinite(t.ST) &&
    t.ST >= 6 &&
    (t.crossType === "WEEKLY" ||
      t.crossType === "DAILY" ||
      t.crossType === "BOTH") &&
    Number.isFinite(t.crossLag) &&
    t.crossLag >= 2
  );
}
function slice_RANGE_regime_gap_up_near_MA25(t) {
  const a = t.analytics || {};
  return (
    t.regime === "RANGE" &&
    Number.isFinite(a.gapPct) &&
    a.gapPct > 0 &&
    Number.isFinite(a.pxVsMA25Pct) &&
    a.pxVsMA25Pct <= 4
  );
}

const SLICES = [
  {
    name: "HIGH_SCORE_6plus",
    desc: "Composite score >= 6",
    fn: slice_HIGH_SCORE_6plus,
  },
  {
    name: "DOWN_regime_ST_panic_weekly_flip",
    desc: "Regime DOWN, ST>=6 (panic pullback), WEEKLY/DAILY/BOTH crossLag>=2",
    fn: slice_DOWN_regime_ST_panic_weekly_flip,
  },
  {
    name: "RANGE_regime_gap_up_near_MA25",
    desc: "Regime RANGE, gap up >0%, px ≤4% above MA25",
    fn: slice_RANGE_regime_gap_up_near_MA25,
  },
];

function analyzeSlice(name, desc, trades, tradingDaysGuess = 1) {
  const n = trades.length;
  const m = summarizeMetrics(trades);

  const winSide = trades
    .filter((t) => t.result === "WIN")
    .map((t) => +t.returnPct || 0);
  const lossSide = trades
    .filter((t) => t.result === "LOSS")
    .map((t) => +t.returnPct || 0);

  const winStats = basicStats(winSide);
  const lossStats = basicStats(lossSide);

  const holdStats = basicStats(trades.map((t) => +t.holdingDays || 0));

  const perDay = tradingDaysGuess ? r2(n / tradingDaysGuess) : r2(n);

  return {
    name,
    desc,
    n,
    metrics: m,
    winStats,
    lossStats,
    holdStats,
    perDay,
  };
}

const tradingDaysGuess = raw?.tradingDays || 1;
const sliceResults = SLICES.map((s) => {
  const subset = withAnalytics.filter((t) => s.fn(t));
  return analyzeSlice(s.name, s.desc, subset, tradingDaysGuess);
});

// -------------------- BEST SLICE PROFILE BREAKDOWN --------------------
function profileBreakdownForSlice(sliceTrades) {
  const byProfile = groupBy(sliceTrades, (t) => t.profile || "unknown");
  const out = [];
  for (const [profile, arr] of byProfile.entries()) {
    const m = summarizeMetrics(arr);
    out.push({
      profile,
      n: arr.length,
      winRate: m.winRate,
      pf: m.profitFactor,
      avgRet: m.avgReturnPct,
      hold: m.avgHoldingDays,
    });
  }
  return out.sort((a, b) => b.n - a.n);
}

const bestSlice = sliceResults[0];
const bestSliceTrades = withAnalytics.filter((t) => SLICES[0].fn(t));
const bestSliceProfiles = profileBreakdownForSlice(bestSliceTrades);

// -------------------- TARGET_ONLY DEEP DIVE --------------------
const targetOnlyAll = withAnalytics.filter((t) => t.profile === "target_only");
const targetHits = targetOnlyAll.filter((t) => t.exitType === "TARGET");
const targetEnd = targetOnlyAll.filter((t) => t.exitType === "END");

const targetAllStats = summarizeSubset(targetOnlyAll);
const targetHitStats = summarizeSubset(targetHits);
const targetEndStats = summarizeSubset(targetEnd);

const ttt = summarizeTimeToTarget(targetOnlyAll); // time-to-target

// -------------------- ENTRY ORIGIN COUNTS (crossType) --------------------
const crossCounts = {};
withAnalytics.forEach((t) => {
  const ct = t.crossType || "NONE";
  if (!crossCounts[ct]) {
    crossCounts[ct] = { trades: 0, wins: 0, sumRet: 0 };
  }
  crossCounts[ct].trades++;
  if (t.result === "WIN") crossCounts[ct].wins++;
  crossCounts[ct].sumRet += +t.returnPct || 0;
});
const crossStats = Object.entries(crossCounts).map(([ct, info]) => {
  const wr = info.trades ? r2((info.wins / info.trades) * 100) : 0;
  const avgR = info.trades ? r2(info.sumRet / info.trades) : 0;
  return {
    crossType: ct,
    trades: info.trades,
    winRate: wr,
    avgReturnPct: avgR,
  };
});

// -------------------- LOSS AUTOPSY --------------------
function isExtendedPx(t) {
  const a = t.analytics || {};
  return Number.isFinite(a.pxVsMA25Pct) && a.pxVsMA25Pct > 6;
}
function isEarlyLag(t) {
  return (
    (t.crossType === "WEEKLY" ||
      t.crossType === "DAILY" ||
      t.crossType === "BOTH") &&
    Number.isFinite(t.crossLag) &&
    t.crossLag < 2
  );
}
function isBadRegime(t) {
  // heuristic: buying late strength blowoff
  return t.regime === "STRONG_UP";
}
function weakPullback(t) {
  return Number.isFinite(t.ST) && t.ST < 6;
}

const losers = withAnalytics.filter((t) => t.result === "LOSS");
const lossReasons = {
  extendedPx: losers.filter(isExtendedPx).length,
  earlyLag: losers.filter(isEarlyLag).length,
  badRegime: losers.filter(isBadRegime).length,
  weakPullback: losers.filter(weakPullback).length,
};

// -------------------------------------------------------------------------
// NEW PART 1: Per-ticker combo breakdown (with sector/liquidity/price buckets)
// -------------------------------------------------------------------------

// We'll group trades by ticker first.
const perTickerRaw = {};
withAnalytics.forEach((t) => {
  const tick = t.ticker || t.symbol || "UNKNOWN";
  if (!perTickerRaw[tick]) perTickerRaw[tick] = [];
  perTickerRaw[tick].push(t);
});

// helper to build a "combo row" for each trade with bucketed context
function makeComboRow(t) {
  const a = t.analytics || {};
  return {
    regime: t.regime || "n/a",
    crossType: t.crossType || "NONE",
    lagBucket: bucketLag(t.crossLag),
    atrBucket: bucketAtrPct(a.atrPct),
    pxMA25Bucket: bucketPxVsMA25(a.pxVsMA25Pct),
    sectorBucket: bucketSector(t.sector),
    liqBucket: bucketLiquidity(a.turnoverJPY),
    priceBucket: bucketPrice(a.entryPx || t.entryPrice),
    result: t.result,
    ret: +t.returnPct || 0,
  };
}

// summarize combos inside a ticker
function summarizeCombos(rows) {
  // rows: [{ regime, crossType, lagBucket,..., result, ret }, ...]
  const map = new Map();
  for (const tr of rows) {
    const key = [
      tr.regime,
      tr.crossType,
      tr.lagBucket,
      tr.atrBucket,
      tr.pxMA25Bucket,
      tr.sectorBucket,
      tr.liqBucket,
      tr.priceBucket,
    ].join("|");

    if (!map.has(key)) {
      map.set(key, {
        count: 0,
        wins: 0,
        sumRet: 0,
        regime: tr.regime,
        crossType: tr.crossType,
        lagBucket: tr.lagBucket,
        atrBucket: tr.atrBucket,
        pxMA25Bucket: tr.pxMA25Bucket,
        sectorBucket: tr.sectorBucket,
        liqBucket: tr.liqBucket,
        priceBucket: tr.priceBucket,
      });
    }
    const agg = map.get(key);
    agg.count++;
    if (tr.result === "WIN") agg.wins++;
    agg.sumRet += tr.ret;
  }
  const list = [];
  for (const [key, agg] of map.entries()) {
    const losses = agg.count - agg.wins;
    const avgRet = agg.sumRet / agg.count;
    const gw = agg.sumRet > 0 ? agg.sumRet : 0;
    const gl = agg.sumRet < 0 ? -agg.sumRet : 0;
    // Profit factor here is crude because we don't have per-trade P/L breakdown inside agg.
    // Let's approximate PF using wins/loses avg instead:
    // We'll need per-trade data to do PF right; this is a shortcut.
    // For ranking, avgRet & winRate are already very informative.
    const wrPct = (agg.wins / agg.count) * 100;
    list.push({
      key,
      count: agg.count,
      winRate: r2(wrPct),
      avgRet: r2(avgRet),
      approxPF:
        losses > 0 ? r2(wrPct / 100 / (1 - wrPct / 100 || 1e-9)) : Infinity,
      regime: agg.regime,
      crossType: agg.crossType,
      lagBucket: agg.lagBucket,
      atrBucket: agg.atrBucket,
      pxMA25Bucket: agg.pxMA25Bucket,
      sectorBucket: agg.sectorBucket,
      liqBucket: agg.liqBucket,
      priceBucket: agg.priceBucket,
    });
  }

  // sort best first by PF-ish, then WR, then avgRet
  const sorted = list.sort((a, b) => {
    const pfA = Number.isFinite(a.approxPF) ? a.approxPF : -1;
    const pfB = Number.isFinite(b.approxPF) ? b.approxPF : -1;
    if (pfB !== pfA) return pfB - pfA;
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    return b.avgRet - a.avgRet;
  });
  return sorted;
}

// Build breakdown per ticker
const perTickerCombos = {};
Object.entries(perTickerRaw).forEach(([ticker, trades]) => {
  const rows = trades.map(makeComboRow);
  const combos = summarizeCombos(rows);

  // Take best 3 and worst 3 with sample size filter (count >= 10 for trust)
  const best3 = combos.filter((c) => c.count >= 10).slice(0, 3);
  const worst3 = combos
    .filter((c) => c.count >= 10)
    .sort((a, b) => {
      // reverse sort: worst PF / WR / avgRet
      const pfA = Number.isFinite(a.approxPF) ? a.approxPF : -1;
      const pfB = Number.isFinite(b.approxPF) ? b.approxPF : -1;
      if (pfA !== pfB) return pfA - pfB;
      if (a.winRate !== b.winRate) return a.winRate - b.winRate;
      return a.avgRet - b.avgRet;
    })
    .slice(0, 3);

  // overall ticker metrics
  const m = summarizeMetrics(trades);

  perTickerCombos[ticker] = {
    overall: {
      trades: m.trades,
      winRate: m.winRate,
      profitFactor: m.profitFactor,
      avgRet: m.avgReturnPct,
    },
    bestCombos: best3,
    worstCombos: worst3,
  };
});

// -------------------------------------------------------------------------
// NEW PART 2: Ticker PF ladder (global best/worst tickers)
// -------------------------------------------------------------------------
const tickerPF = [];
if (Array.isArray(raw.byTicker)) {
  for (const rec of raw.byTicker) {
    const sym = rec.ticker || rec.symbol || "UNKNOWN";
    const tradesArr = Array.isArray(rec.trades) ? rec.trades : [];
    if (!tradesArr.length) continue;
    const m = summarizeMetrics(tradesArr);
    tickerPF.push({
      ticker: sym,
      trades: m.trades,
      winRate: m.winRate,
      pf: m.profitFactor,
      avgRet: m.avgReturnPct,
    });
  }
}

const worstTickers = [...tickerPF]
  .filter((t) => t.trades >= 30)
  .sort((a, b) => (a.pf || 0) - (b.pf || 0))
  .slice(0, 15);

const bestTickers = [...tickerPF]
  .filter((t) => t.trades >= 30)
  .sort((a, b) => (b.pf || 0) - (a.pf || 0))
  .slice(0, 15);

// -------------------------------------------------------------------------
// CONSOLE OUTPUT
// -------------------------------------------------------------------------

console.log("=== OVERALL ===");
console.log(
  `Trades ${overall.trades} | WinRate ${overall.winRate}% | PF ${overall.profitFactor} | AvgRet ${overall.avgReturnPct}% | AvgHold ${overall.avgHoldingDays} bars`
);

if (spotlight && (spotlight.best || spotlight.worst)) {
  console.log("\n=== SPOTLIGHT TICKERS ===");
  if (spotlight.best) {
    console.log(
      `Best: ${spotlight.best.ticker} | PF ${spotlight.best.pf} | WR ${spotlight.best.winRate}%`
    );
    console.log(`  Why: ${spotlight.best.why}`);
  }
  if (spotlight.worst) {
    console.log(
      `Worst: ${spotlight.worst.ticker} | PF ${spotlight.worst.pf} | WR ${spotlight.worst.winRate}%`
    );
    console.log(`  Why: ${spotlight.worst.why}`);
  }
}

const sig = raw?.signals || {};
if (sig && Object.keys(sig).length) {
  console.log("\n=== SIGNALS / FLOW ===");
  console.log(
    `Signals total=${sig.total}, afterWarmup=${sig.afterWarmup}, whileFlat=${sig.whileFlat}, executed=${sig.executed}`
  );
  console.log(`Invalid=${sig.invalid}, riskStop>=px=${sig.riskStopGtePx}`);
  if (sig.blocked) {
    console.log(
      `Blocked: inTrade=${sig.blocked.inTrade}, cooldown=${sig.blocked.cooldown}, warmup=${sig.blocked.warmup}`
    );
  }
  if (Number.isFinite(raw.tradesPerDay)) {
    console.log(
      `Throughput: ${r2(raw.tradesPerDay)} trades/day over ${
        raw.tradingDays
      } trading days`
    );
  }
}

console.log("\n=== RETURN DISTRIBUTION (all trades) ===");
console.log(
  `Win median ${winStatsAll.med}% | Win 90th ${winStatsAll.p90}% | Loss median ${lossStatsAll.med}% | Loss 10th ${lossStatsAll.p10}%`
);

console.log("\n=== HOLDING BEHAVIOR (all trades) ===");
console.log(
  `WIN avgHold ${holdsWin.avg} bars (med ${holdsWin.med}) | LOSS avgHold ${holdsLoss.avg} bars (med ${holdsLoss.med})`
);

console.log("\n=== FEATURE SIGNALS (decile10 vs decile1 & correlations) ===");
takeaways.forEach((s) => console.log("- " + s));

console.log("\n=== SENTIMENT (LT-ST pairs) ===");
console.log("- " + sentiPairSummaryActual);
console.log("- " + sentiPairSummaryRejected);

console.log("\n=== SENTIMENT (LT only) ===");
console.log("- " + sentiLTActualSummary);
console.log("- " + sentiLTRejectedSummary);

console.log("\n=== SENTIMENT (ST only) ===");
console.log("- " + sentiSTActualSummary);
console.log("- " + sentiSTRejectedSummary);

console.log("\n=== REGIME ===");
regimeSummary.forEach((s) => console.log("- " + s));

console.log("\n=== CROSS-LAG ===");
lagSummary.forEach((s) => console.log("- " + s));

console.log("\n=== DIP AFTER FRESH CROSS ===");
console.log(fmtDipAfter("WEEKLY", dipAfter.WEEKLY));
console.log(fmtDipAfter("DAILY", dipAfter.DAILY));

console.log("\n=== ENTRY ORIGIN BY CROSSTYPE ===");
crossStats.forEach((row) => {
  console.log(
    `${row.crossType}: n=${row.trades}, WR ${row.winRate}%, AvgRet ${row.avgReturnPct}%`
  );
});

const volBuckets = raw?.volatility?.byAtrPctBucket || {};
console.log("\n=== VOLATILITY BUCKETS (ATR% at entry) ===");
Object.entries(volBuckets).forEach(([bucket, m]) => {
  if (!m) return;
  console.log(
    `${bucket}: n=${m.trades}, WR ${m.winRate}%, PF ${m.profitFactor}, AvgRet ${m.avgReturnPct}%`
  );
});

console.log("\n=== PROFILES ===");
profileSummaries.forEach((p) => {
  const exits = raw?.profiles?.[p.id]?.exits || {};
  console.log(
    `- ${p.label} (${p.id}): trades ${p.trades}, WR ${p.winRate}%, PF ${p.pf}, AvgRet ${p.avgRet}%, Hold ${p.hold} bars`
  );
  console.log(
    `    exits: TARGET=${exits.target ?? 0}, STOP=${exits.stop ?? 0}, TIME=${
      exits.time ?? 0
    }`
  );
});
console.log(
  `  best by WR: ${bestProfiles.byWinRate}, best by PF: ${bestProfiles.byProfitFactor}, best by expR: ${bestProfiles.byExpR}`
);

console.log("\n=== COMPOSITE SCORE (your rule-based score) ===");
scoreInfo.scored.forEach((row) => {
  console.log(
    `score ${row.score}: n=${row.n}, WR ${row.winRate}%, PF ${row.pf}, AvgRet ${row.avgRet}%`
  );
});
console.log(
  `corr(score, win)=${r2(scoreCorr.win)}, corr(score, ret)=${r2(scoreCorr.ret)}`
);

console.log(
  "\n=== PLAYBOOK SLICES (candidate entry rules; already AND-filtered) ==="
);
sliceResults.forEach((s) => {
  console.log(
    `- ${s.name} :: ${s.desc}\n` +
      `  n=${s.n} (~${s.perDay} trades/day), WR=${s.metrics.winRate}%, PF=${s.metrics.profitFactor}, AvgRet=${s.metrics.avgReturnPct}%, HoldAvg=${s.metrics.avgHoldingDays} bars`
  );
  console.log(
    `  dist: winMed=${s.winStats.med}% win90=${s.winStats.p90}% | lossMed=${s.lossStats.med}% loss10=${s.lossStats.p10}%`
  );
  console.log(`  hold(med all=${s.holdStats.med} bars)`);
});

// rejected / blocked alpha
const rej = raw?.parallel?.rejectedBuys;
if (rej && rej.summary) {
  console.log("\n=== REJECTED BUYS (SIM ONLY) ===");
  console.log(
    `Simulated=${rej.summary.total}, WinRate=${rej.summary.winRate}%, Winners=${rej.summary.winners}`
  );
  const topReasons = Object.entries(rej.byReason || {}).slice(0, 5);
  topReasons.forEach(([reason, stats]) => {
    if (!stats) return;
    console.log(
      `- ${reason}: n=${stats.total}, WR ${stats.winRate}%, expR ${stats.expR}, PF ${stats.profitFactor}`
    );
  });
}

// best slice profile breakdown
console.log("\n=== BEST SLICE PROFILE BREAKDOWN ===");
console.log(
  `Slice "${bestSlice.name}" (${bestSlice.desc}) :: n=${bestSlice.n}, WR=${bestSlice.metrics.winRate}%, PF=${bestSlice.metrics.profitFactor}`
);
bestSliceProfiles.forEach((bp) => {
  console.log(
    `- ${bp.profile}: n=${bp.n}, WR ${bp.winRate}%, PF ${bp.pf}, AvgRet ${bp.avgRet}%, Hold ${bp.hold} bars`
  );
});

// target_only dive
console.log("\n=== TARGET_ONLY PROFILE DEEP DIVE ===");
console.log(
  `All target_only trades: n=${targetOnlyAll.length}, WR ${targetAllStats.metrics.winRate}%, PF ${targetAllStats.metrics.profitFactor}, AvgRet ${targetAllStats.metrics.avgReturnPct}%, HoldAvg ${targetAllStats.metrics.avgHoldingDays} bars`
);
console.log(
  ` Volatility snapshot: wins med ${targetAllStats.winStats.med}% (p90 ${targetAllStats.winStats.p90}%) | losses med ${targetAllStats.lossStats.med}% (p10 ${targetAllStats.lossStats.p10}%)`
);
console.log(
  ` HoldingDays dist: med ${targetAllStats.holdStats.med} bars, p90 ${targetAllStats.holdStats.p90} bars`
);

console.log(
  `\n When it actually tags TARGET early (exitType=TARGET): n=${targetHits.length} | WR ${targetHitStats.metrics.winRate}% | PF ${targetHitStats.metrics.profitFactor} | AvgRet ${targetHitStats.metrics.avgReturnPct}%`
);
console.log(
  ` Time-to-target (only trades that hit TARGET): median ${ttt.days.med} bars, avg ${ttt.days.avg} bars, p90 ${ttt.days.p90} bars`
);
console.log(
  ` Return on those hits: median ${ttt.returns.med}% , p90 ${ttt.returns.p90}%`
);

console.log(
  `\n The slow grinders / never-hit-target (exitType=END): n=${targetEnd.length} | WR ${targetEndStats.metrics.winRate}%, PF ${targetEndStats.metrics.profitFactor} | AvgRet ${targetEndStats.metrics.avgReturnPct}%`
);
console.log(
  ` These held longer: Hold med ${targetEndStats.holdStats.med} bars, p90 ${targetEndStats.holdStats.p90} bars`
);

// loss autopsy
console.log("\n=== LOSS AUTOPSY (why did losers lose?) ===");
console.log(
  `Total losses ${losers.length}:\n` +
    ` - extendedPx (>6% above MA25): ${lossReasons.extendedPx}\n` +
    ` - earlyLag (too soon after flip): ${lossReasons.earlyLag}\n` +
    ` - badRegime (STRONG_UP blowoff risk): ${lossReasons.badRegime}\n` +
    ` - weakPullback (ST<6, not enough 'panic'): ${lossReasons.weakPullback}`
);

// new ladder output
console.log("\n=== WORST TICKERS BY PF (n>=30 trades) ===");
worstTickers.forEach((row) => {
  console.log(
    `[AVOID] ${row.ticker}: PF ${row.pf}, WR ${row.winRate}% , AvgRet ${row.avgRet}% , n=${row.trades}`
  );
});

console.log("\n=== BEST TICKERS BY PF (n>=30 trades) ===");
bestTickers.forEach((row) => {
  console.log(
    `[FOCUS] ${row.ticker}: PF ${row.pf}, WR ${row.winRate}% , AvgRet ${row.avgRet}% , n=${row.trades}`
  );
});

// per-ticker combo summary (top/worst combos inside each ticker)
console.log("\n=== PER-TICKER BEST/WORST COMBOS (sample>=10) ===");
Object.entries(perTickerCombos).forEach(([ticker, info]) => {
  const o = info.overall;
  console.log(
    `\n[ticker ${ticker}] overall PF ${o.profitFactor} | WR ${o.winRate}% | AvgRet ${o.avgRet}% | n=${o.trades}`
  );
  if (info.bestCombos.length) {
    console.log("  BEST COMBOS:");
    info.bestCombos.forEach((c) => {
      console.log(
        `    n=${c.count} | WR ${c.winRate}% | PF~${c.approxPF} | AvgRet ${c.avgRet}% :: ${c.regime}, ${c.crossType}, ${c.lagBucket}, ${c.atrBucket}, ${c.pxMA25Bucket}, ${c.sectorBucket}, ${c.liqBucket}, ${c.priceBucket}`
      );
    });
  }
  if (info.worstCombos.length) {
    console.log("  WORST COMBOS:");
    info.worstCombos.forEach((c) => {
      console.log(
        `    n=${c.count} | WR ${c.winRate}% | PF~${c.approxPF} | AvgRet ${c.avgRet}% :: ${c.regime}, ${c.crossType}, ${c.lagBucket}, ${c.atrBucket}, ${c.pxMA25Bucket}, ${c.sectorBucket}, ${c.liqBucket}, ${c.priceBucket}`
      );
    });
  }
});

// -------------------- Optional outputs --------------------
const exportObj = {
  overall,
  spotlight: spotlight || {},
  featureResults,
  sentiment: {
    pairs: {
      actual: sentiPairsActual,
      rejected: sentiPairsRejected,
    },
    LT: {
      actual: sentiLTActual,
      rejected: sentiLTRejected,
    },
    ST: {
      actual: sentiSTActual,
      rejected: sentiSTRejected,
    },
  },
  regime: raw?.regime?.metrics || {},
  crossLag: xlag,
  dipAfterFreshCross: dipAfter,
  entryOriginByCrossType: crossStats,
  volatilityBuckets: raw?.volatility?.byAtrPctBucket || {},
  profiles: profileSummaries,
  bestProfiles,
  scoreLadder: scoreInfo.scored,
  scoreCorr,
  slices: sliceResults,
  bestSliceProfileBreakdown: bestSliceProfiles,
  targetOnlyDeepDive: {
    all: targetAllStats,
    hits: targetHitStats,
    end: targetEndStats,
    timeToTarget: ttt,
  },
  signals: sig,
  rejectedBuys: rej || null,
  lossAutopsy: lossReasons,

  // NEW
  tickerPFAll: tickerPF,
  worstTickers,
  bestTickers,
  perTickerCombos,
};

if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify(exportObj, null, 2), "utf8");
  console.log(`\n[write] JSON metrics -> ${outPath}`);
}

if (mdPath) {
  const lines = [];
  lines.push("# Backtest Diagnosis");
  lines.push("");
  lines.push(
    `**Trades**: ${overall.trades}  |  **WinRate**: ${overall.winRate}%  |  **PF**: ${overall.profitFactor}  |  **AvgRet**: ${overall.avgReturnPct}%  |  **AvgHold**: ${overall.avgHoldingDays} bars`
  );
  lines.push("");

  if (spotlight && (spotlight.best || spotlight.worst)) {
    lines.push("## Spotlight Tickers");
    if (spotlight.best) {
      lines.push(
        `- Best ${spotlight.best.ticker}: PF ${spotlight.best.pf}, WR ${spotlight.best.winRate}%`
      );
      lines.push(`  Why: ${spotlight.best.why}`);
    }
    if (spotlight.worst) {
      lines.push(
        `- Worst ${spotlight.worst.ticker}: PF ${spotlight.worst.pf}, WR ${spotlight.worst.winRate}%`
      );
      lines.push(`  Why: ${spotlight.worst.why}`);
    }
    lines.push("");
  }

  lines.push("## Feature Takeaways");
  for (const s of takeaways) lines.push(`- ${s}`);
  lines.push("");

  lines.push("## Regime");
  for (const s of regimeSummary) lines.push(`- ${s}`);
  lines.push("");

  lines.push("## Cross-Lag");
  for (const s of lagSummary) lines.push(`- ${s}`);
  lines.push("");

  lines.push("## DIP After Fresh Cross");
  lines.push(fmtDipAfter("WEEKLY", dipAfter.WEEKLY));
  lines.push(fmtDipAfter("DAILY", dipAfter.DAILY));
  lines.push("");

  lines.push("## Entry Origin By CrossType");
  crossStats.forEach((row) => {
    lines.push(
      `- ${row.crossType}: n=${row.trades}, WR ${row.winRate}%, AvgRet ${row.avgReturnPct}%`
    );
  });
  lines.push("");

  if (rej && rej.summary) {
    lines.push("## Rejected Buys (Sim Only)");
    lines.push(
      `Simulated=${rej.summary.total}, WinRate=${rej.summary.winRate}%, Winners=${rej.summary.winners}`
    );
    const topReasons = Object.entries(rej.byReason || {}).slice(0, 5);
    topReasons.forEach(([reason, stats]) => {
      if (!stats) return;
      lines.push(
        `- ${reason}: n=${stats.total}, WR ${stats.winRate}%, expR ${stats.expR}, PF ${stats.profitFactor}`
      );
    });
    lines.push("");
  }

  lines.push("## Volatility Buckets (ATR% at entry)");
  const volBucketsKeys = Object.keys(volBuckets || {});
  if (!volBucketsKeys.length) {
    lines.push("- n/a");
  } else {
    volBucketsKeys.forEach((bucket) => {
      const m = volBuckets[bucket];
      if (!m) return;
      lines.push(
        `- ${bucket}: n=${m.trades}, WR ${m.winRate}%, PF ${m.profitFactor}, AvgRet ${m.avgReturnPct}%`
      );
    });
  }
  lines.push("");

  lines.push("## Ticker PF Ladder (n>=30 trades)");
  lines.push("### Worst");
  worstTickers.forEach((row) => {
    lines.push(
      `- [AVOID] ${row.ticker}: PF ${row.pf}, WR ${row.winRate}%, AvgRet ${row.avgRet}%, n=${row.trades}`
    );
  });
  lines.push("### Best");
  bestTickers.forEach((row) => {
    lines.push(
      `- [FOCUS] ${row.ticker}: PF ${row.pf}, WR ${row.winRate}%, AvgRet ${row.avgRet}%, n=${row.trades}`
    );
  });
  lines.push("");

  lines.push("## Per-Ticker Best/Worst Combos (sample>=10)");
  Object.entries(perTickerCombos).forEach(([ticker, info]) => {
    lines.push(
      `### ${ticker} :: PF ${info.overall.profitFactor}, WR ${info.overall.winRate}%, AvgRet ${info.overall.avgRet}%, n=${info.overall.trades}`
    );
    if (info.bestCombos.length) {
      lines.push(" Best:");
      info.bestCombos.forEach((c) => {
        lines.push(
          `  - n=${c.count} | WR ${c.winRate}% | PF~${c.approxPF} | AvgRet ${c.avgRet}% :: ${c.regime}, ${c.crossType}, ${c.lagBucket}, ${c.atrBucket}, ${c.pxMA25Bucket}, ${c.sectorBucket}, ${c.liqBucket}, ${c.priceBucket}`
        );
      });
    }
    if (info.worstCombos.length) {
      lines.push(" Worst:");
      info.worstCombos.forEach((c) => {
        lines.push(
          `  - n=${c.count} | WR ${c.winRate}% | PF~${c.approxPF} | AvgRet ${c.avgRet}% :: ${c.regime}, ${c.crossType}, ${c.lagBucket}, ${c.atrBucket}, ${c.pxMA25Bucket}, ${c.sectorBucket}, ${c.liqBucket}, ${c.priceBucket}`
        );
      });
    }
  });
  lines.push("");

  lines.push("## Target Only Deep Dive");
  lines.push(
    `All target_only trades: n=${targetOnlyAll.length}, WR ${targetAllStats.metrics.winRate}%, PF ${targetAllStats.metrics.profitFactor}, AvgRet ${targetAllStats.metrics.avgReturnPct}%, HoldAvg ${targetAllStats.metrics.avgHoldingDays} bars`
  );
  lines.push(
    `Time-to-target (only trades that hit TARGET): median ${ttt.days.med} bars (avg ${ttt.days.avg}, p90 ${ttt.days.p90})`
  );
  lines.push(
    `Never-hit (END exits): n=${targetEnd.length}, Hold med ${targetEndStats.holdStats.med} bars`
  );

  if (sig && Object.keys(sig).length) {
    lines.push("");
    lines.push("## Signals / Flow");
    lines.push(
      `Signals: total=${sig.total}, executed=${sig.executed}, blocked.inTrade=${sig.blocked?.inTrade}, cooldown=${sig.blocked?.cooldown}, warmup=${sig.blocked?.warmup}`
    );
    if (Number.isFinite(raw.tradesPerDay)) {
      lines.push(
        `Throughput: ${r2(raw.tradesPerDay)} trades/day over ${
          raw.tradingDays
        } trading days`
      );
    }
  }

  fs.writeFileSync(mdPath, lines.join("\n"), "utf8");
  console.log(`[write] Markdown report -> ${mdPath}`);
}
