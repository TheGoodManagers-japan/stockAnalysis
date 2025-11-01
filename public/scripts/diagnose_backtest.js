#!/usr/bin/env node
/**
 * diagnose_backtest.js (enhanced with per-playbook strategy breakdown)
 *
 * Usage:
 *   node diagnose_backtest.js path/to/backtest.json
 *
 * Input:
 *   The JSON returned by runBacktest(...) in /scripts/backtest.js
 *
 * Output:
 *   ONE clean JSON with:
 *    - performance / flow / regime
 *    - bestSetup (playbook-ish slice with best PF)
 *    - lossAnalysis / lossReasons
 *    - stopRisk (stop tightness guidance)
 *    - missedOpportunities (what we blocked that would've worked)
 *    - tickers.focus & tickers.avoid
 *    - bucket tiers (sector, liquidity, px extension, etc.)
 *    - bestSetups (human-readable situational edges)
 *    - singleProfile summary (your unified "target_only (with 15% floor)")
 *    - targetOnly (basically entire strategy now)
 *    - strategyBreakdown (NEW: PF / WR per playbook name like "WEEKLY CROSS +VOLUME")
 */

const fs = require("fs");

/* -------------------- CLI -------------------- */
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node diagnose_backtest.js path/to/backtest.json");
  process.exit(1);
}
const inputPath = args[0];

/* -------------------- utils -------------------- */
const r2 = (v) => Math.round((+v || 0) * 100) / 100;

function safeGetAllTrades(obj) {
  // Preferred: byTicker[].trades
  if (Array.isArray(obj?.byTicker) && obj.byTicker.length) {
    return obj.byTicker.flatMap((t) =>
      Array.isArray(t.trades) ? t.trades : []
    );
  }
  // Fallback if you ever expose a globalTrades array
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

/* -------------------- BUCKET HELPERS -------------------- */

// Volume Z-score at entry (how loud the day was)
function bucketVolZ(z) {
  if (!Number.isFinite(z)) return "volZ:n/a";
  if (z < 0) return "volZ:quiet(<0)";
  if (z < 1) return "volZ:norm(0-1)";
  if (z < 2) return "volZ:elevated(1-2)";
  return "volZ:hot(>2)";
}

// Cross lag bucket (fresh vs stale)
function bucketLag(lagVal) {
  if (!Number.isFinite(lagVal)) return "lag:n/a";
  if (lagVal < 2) return "lag:early(<2)";
  if (lagVal <= 5) return "lag:mid(2-5)";
  return "lag:late(>5)";
}

// ATR% bucket (volatility style)
function bucketAtrPct(v) {
  if (!Number.isFinite(v)) return "ATR:n/a";
  if (v < 1.0) return "ATR:low(<1%)";
  if (v < 3.0) return "ATR:med(1-3%)";
  return "ATR:high(>3%)";
}

// Distance above MA25 bucket (extension/chase risk)
function bucketPxVsMA25(distPct) {
  if (!Number.isFinite(distPct)) return "pxMA25:n/a";
  if (distPct < 0) return "pxMA25:below";
  if (distPct <= 2) return "pxMA25:0-2%";
  if (distPct <= 6) return "pxMA25:2-6%";
  return "pxMA25:>6%";
}

// Sector bucket
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

// Price bucket (absolute share price)
function bucketPrice(entryPx) {
  if (!Number.isFinite(entryPx)) return "px:n/a";
  if (entryPx < 200) return "px:<200";
  if (entryPx < 500) return "px:200-500";
  if (entryPx < 1000) return "px:500-1000";
  if (entryPx < 3000) return "px:1k-3k";
  return "px:3k+";
}

/* -------------------- STOP TIGHTNESS ANALYSIS -------------------- */

// Bucket loss magnitude so we can see depth of losers
function bucketLossSize(pct) {
  // pct is negative or zero for losers
  if (!Number.isFinite(pct)) return "n/a";
  if (pct > -5) return "0% to -5%";
  if (pct > -8) return "-5% to -8%";
  if (pct > -10) return "-8% to -10%";
  if (pct > -12) return "-10% to -12%";
  if (pct > -15) return "-12% to -15%";
  return "<= -15%";
}

// Analyze how painful STOP exits are under the ~15% floor
function analyzeStopSeverity(losersArr) {
  const out = {
    allLosingTrades: losersArr.length,
    stopLosses: 0,
    timeLosses: 0,
    endLosses: 0,
    bucketsAll: {},
    bucketsStopOnly: {},
    tail: {
      p90LossPct: null,
      p95LossPct: null,
      worstLossPct: null,
    },
    stopProfile: {
      shallowStopsUnder10pct: 0,
      deepStopsOver10pct: 0,
      shallowSharePct: 0,
      deepSharePct: 0,
    },
  };

  const lossPcts = [];

  for (const t of losersArr) {
    const lp = +t.returnPct || 0; // negative
    lossPcts.push(lp);

    if (t.exitType === "STOP") out.stopLosses++;
    else if (t.exitType === "TIME") out.timeLosses++;
    else if (t.exitType === "END") out.endLosses++;

    const bAll = bucketLossSize(lp);
    out.bucketsAll[bAll] = (out.bucketsAll[bAll] || 0) + 1;

    if (t.exitType === "STOP") {
      const bStop = bucketLossSize(lp);
      out.bucketsStopOnly[bStop] = (out.bucketsStopOnly[bStop] || 0) + 1;
    }
  }

  const sorted = lossPcts.filter(Number.isFinite).sort((a, b) => a - b); // most negative first

  function pctileLocal(p) {
    if (!sorted.length) return null;
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    const w = idx - lo;
    return sorted[lo] * (1 - w) + sorted[hi] * w;
  }

  out.tail.p90LossPct = r2(pctileLocal(0.1));
  out.tail.p95LossPct = r2(pctileLocal(0.05));
  out.tail.worstLossPct = r2(sorted[0] || 0);

  let shallowStopCount = 0;
  let deepStopCount = 0;
  for (const t of losersArr) {
    if (t.exitType !== "STOP") continue;
    const lp = +t.returnPct || 0;
    if (lp > -10) shallowStopCount++;
    else deepStopCount++;
  }

  out.stopProfile = {
    shallowStopsUnder10pct: shallowStopCount,
    deepStopsOver10pct: deepStopCount,
    shallowSharePct: out.stopLosses
      ? r2((100 * shallowStopCount) / out.stopLosses)
      : 0,
    deepSharePct: out.stopLosses
      ? r2((100 * deepStopCount) / out.stopLosses)
      : 0,
  };

  return out;
}

/* -------------------- LOAD & PREP DATA -------------------- */

const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const allTradesRaw = safeGetAllTrades(raw);

// Guard
const withAnalytics = allTradesRaw.filter(
  (t) => t && t.analytics && typeof t.analytics === "object"
);

if (!withAnalytics.length) {
  console.log(
    JSON.stringify(
      {
        error:
          "No trades with `analytics` found. Ensure trades store analytics.",
      },
      null,
      2
    )
  );
  process.exit(0);
}

/* -------------------- OVERALL / HIGH-LEVEL STATS -------------------- */

const overall = summarizeMetrics(withAnalytics);

// regime metrics come straight from backtest
const regimeMetrics = raw?.regime?.metrics || {};

/**
 * Score correlation stuff stays for backward compat,
 * but score may not exist anymore.
 */
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

const hasScore = withAnalytics.some((t) => Number.isFinite(t.score));
const scoreInfo = hasScore ? metricsByScore(withAnalytics) : { scored: [] };
const scoreCorr = hasScore ? corrScore(withAnalytics) : { win: NaN, ret: NaN };

/* -------------------- PLAYBOOK SLICES (macro situational edges) -------------------- */

/**
 * Slices model 'conditions we like' rather than literal playbook strings.
 * You can add more slices here as you learn patterns.
 */

function slice_DOWN_regime_ST_panic_weekly_flip(t) {
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
    name: "DOWN_regime_ST_panic_weekly_flip",
    desc: "Regime DOWN, ST>=6 panic dip, WEEKLY/DAILY/BOTH crossLag>=2",
    fn: slice_DOWN_regime_ST_panic_weekly_flip,
  },
  {
    name: "RANGE_regime_gap_up_near_MA25",
    desc: "RANGE regime, gap up >0%, entry ≤4% above MA25 (controlled bounce not chased)",
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

  const perDay = tradingDaysGuess ? r2(n / tradingDaysGuess) : r2(n);

  return {
    name,
    desc,
    n,
    perDay,
    metrics: m,
    winStats,
    lossStats,
  };
}

const tradingDaysGuess = raw?.tradingDays || 1;
const sliceResults = SLICES.map((s) => {
  const subset = withAnalytics.filter((t) => s.fn(t));
  return analyzeSlice(s.name, s.desc, subset, tradingDaysGuess);
});

// pick best slice by PF then winRate
const rankedSlices = [...sliceResults].sort((a, b) => {
  const pfA = Number.isFinite(a.metrics.profitFactor)
    ? a.metrics.profitFactor
    : -1;
  const pfB = Number.isFinite(b.metrics.profitFactor)
    ? b.metrics.profitFactor
    : -1;
  if (pfB !== pfA) return pfB - pfA;
  return b.metrics.winRate - a.metrics.winRate;
});
const topSlice = rankedSlices[0] || null;

/* -------------------- LOSS AUTOPSY -------------------- */

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
  // "badRegime" here: blowoff entries in STRONG_UP, where pullbacks don't stick
  return t.regime === "STRONG_UP";
}
function weakPullback(t) {
  return Number.isFinite(t.ST) && t.ST < 6;
}

function summarizeLosingPatterns(losersArr) {
  const totalL = losersArr.length || 1;

  const buckets = [
    {
      key: "chasingExtended",
      desc: "Entry was >6% above MA25 (chasing stretched price / breakout FOMO).",
      count: losersArr.filter(isExtendedPx).length,
    },
    {
      key: "tooEarlyAfterFlip",
      desc: "Bought <2 bars after a cross flip (jumped in before letting it settle).",
      count: losersArr.filter(isEarlyLag).length,
    },
    {
      key: "blowoffRegime",
      desc: "Bought in STRONG_UP regime / blowoff, where pullbacks don't stick.",
      count: losersArr.filter(isBadRegime).length,
    },
    {
      key: "notRealPanic",
      desc: "Short-term sentiment ST<6 (not a true panic, just meh pullback).",
      count: losersArr.filter(weakPullback).length,
    },
  ];

  const ranked = buckets
    .map((b) => ({
      key: b.key,
      desc: b.desc,
      count: b.count,
      shareOfLossesPct: r2((b.count / totalL) * 100),
    }))
    .sort((a, b) => b.count - a.count);

  return {
    totalLosingTrades: losersArr.length,
    topLossPatterns: ranked.slice(0, 5),
  };
}

const losers = withAnalytics.filter((t) => t.result === "LOSS");
const losingPatterns = summarizeLosingPatterns(losers);
const lossReasons = {
  extendedPx: losers.filter(isExtendedPx).length,
  earlyLag: losers.filter(isEarlyLag).length,
  badRegime: losers.filter(isBadRegime).length,
  weakPullback: losers.filter(weakPullback).length,
};

// stop tightness insight from losers
const stopTightnessInsight = analyzeStopSeverity(losers);

/* -------------------- PER-TICKER COMBOS / bestSetups -------------------- */

function makeComboRow(t) {
  const a = t.analytics || {};
  return {
    ticker: t.ticker || t.symbol || "UNKNOWN",
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

function summarizeCombos(rows) {
  const map = new Map();
  for (const tr of rows) {
    const key = [
      tr.ticker,
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
        ...tr,
      });
    }
    const agg = map.get(key);
    agg.count++;
    if (tr.result === "WIN") agg.wins++;
    agg.sumRet += tr.ret;
  }

  const list = [];
  for (const agg of map.values()) {
    const wrPct = (agg.wins / agg.count) * 100;
    const avgRet = agg.sumRet / agg.count;
    const losses = agg.count - agg.wins;
    const approxPF =
      losses > 0 ? r2(wrPct / 100 / (1 - wrPct / 100 || 1e-9)) : Infinity;

    list.push({
      ticker: agg.ticker,
      n: agg.count,
      winRate: r2(wrPct),
      avgRet: r2(avgRet),
      approxPF,
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

  list.sort((a, b) => {
    const pfA = Number.isFinite(a.approxPF) ? a.approxPF : -1;
    const pfB = Number.isFinite(b.approxPF) ? b.approxPF : -1;
    if (pfB !== pfA) return pfB - pfA;
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    return b.avgRet - a.avgRet;
  });

  return list;
}

// group trades per ticker
const perTickerRaw = {};
withAnalytics.forEach((t) => {
  const tick = t.ticker || t.symbol || "UNKNOWN";
  if (!perTickerRaw[tick]) perTickerRaw[tick] = [];
  perTickerRaw[tick].push(t);
});

// build combos per ticker
const perTickerCombosTmp = {};
Object.entries(perTickerRaw).forEach(([ticker, trades]) => {
  const rows = trades.map(makeComboRow);
  const combos = summarizeCombos(rows);

  // choose best combos with decent sample size (>=10)
  const best3 = combos.filter((c) => c.n >= 10).slice(0, 3);

  perTickerCombosTmp[ticker] = {
    bestCombos: best3,
  };
});

// ticker PF ladder (for focus/avoid)
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

/* -------------------- Human-readable best setups -------------------- */

function humanLabelLag(lagBucket) {
  if (lagBucket.startsWith("lag:early")) return "early flip (<2 bars)";
  if (lagBucket.startsWith("lag:mid")) return "mid flip (2-5 bars after cross)";
  if (lagBucket.startsWith("lag:late")) return "late flip (>5 bars)";
  return lagBucket;
}
function humanLabelAtr(atrBucket) {
  if (atrBucket.startsWith("ATR:low")) return "low vol (<1% ATR)";
  if (atrBucket.startsWith("ATR:med")) return "medium vol (1-3% ATR)";
  if (atrBucket.startsWith("ATR:high")) return "high vol (>3% ATR)";
  return atrBucket;
}
function humanLabelPxMA25(pxB) {
  if (pxB === "pxMA25:below") return "below MA25 (pullback)";
  if (pxB === "pxMA25:0-2%") return "near MA25 (0-2% above)";
  if (pxB === "pxMA25:2-6%") return "moderately extended (2-6% above)";
  if (pxB === "pxMA25:>6%") return "chasing (>6% above MA25)";
  return pxB;
}
function humanLabelLiq(liqB) {
  if (liqB === "liq:<5M") return "illiquid (<5M JPY turnover)";
  if (liqB === "liq:5-50M") return "thin (5-50M JPY)";
  if (liqB === "liq:50-200M") return "mid liquidity (50-200M JPY)";
  if (liqB === "liq:200M+") return "very liquid (200M+ JPY)";
  return liqB;
}
function humanLabelPx(pxB) {
  if (pxB === "px:<200") return "ultra cheap (<¥200/share)";
  if (pxB === "px:200-500") return "cheap (¥200-¥500)";
  if (pxB === "px:500-1000") return "mid (¥500-¥1k)";
  if (pxB === "px:1k-3k") return "mid-high (¥1k-¥3k)";
  if (pxB === "px:3k+") return "expensive (¥3k+/share)";
  return pxB;
}

function buildBestSetups(perTickerCombosTmp) {
  // flatten all best combos for all tickers
  const flat = [];
  Object.values(perTickerCombosTmp).forEach((rec) => {
    (rec.bestCombos || []).forEach((c) => flat.push(c));
  });

  // rank by approxPF, then winRate, then avgRet
  flat.sort((a, b) => {
    const pfA = Number.isFinite(a.approxPF) ? a.approxPF : -1;
    const pfB = Number.isFinite(b.approxPF) ? b.approxPF : -1;
    if (pfB !== pfA) return pfB - pfA;
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    return b.avgRet - a.avgRet;
  });

  // top ~5 patterns only
  const topCombos = flat.slice(0, 5);

  // transform into human-readable playbook entries
  return topCombos.map((c) => ({
    sector: c.sectorBucket.replace("sector:", ""),
    regime: c.regime,
    crossOrigin: c.crossType,
    crossTiming: humanLabelLag(c.lagBucket),
    volatility: humanLabelAtr(c.atrBucket),
    distanceFromMA25: humanLabelPxMA25(c.pxMA25Bucket),
    liquidity: humanLabelLiq(c.liqBucket),
    pricePerShare: humanLabelPx(c.priceBucket),

    sample: c.n,
    winRate: c.winRate,
    avgRet: c.avgRet,
    pfApprox: c.approxPF,
  }));
}

const bestSetups = buildBestSetups(perTickerCombosTmp);

/* -------------------- GLOBAL BUCKET SUMMARIES -------------------- */

function summarizeCategoryPerformance(tradesArrByKey) {
  const rows = [];
  for (const [key, arr] of Object.entries(tradesArrByKey)) {
    if (!arr.length) continue;
    const m = summarizeMetrics(arr);
    rows.push({
      key,
      trades: m.trades,
      winRate: m.winRate,
      pf: m.profitFactor,
      avgRet: m.avgReturnPct,
    });
  }
  return rows;
}

function qualityScore(row) {
  const pfPart = (Number.isFinite(row.pf) ? row.pf : 0) * 2;
  const wrPart = (Number.isFinite(row.winRate) ? row.winRate : 0) / 10;
  const retPart = Number.isFinite(row.avgRet) ? row.avgRet : 0;
  return r2(pfPart + wrPart + retPart);
}

function splitIntoQuartileBuckets(rows, minTrades = 50) {
  const filtered = rows
    .filter((r) => r.trades >= minTrades)
    .map((r) => ({ ...r, qualityScore: qualityScore(r) }))
    .sort((a, b) => b.qualityScore - a.qualityScore);

  const n = filtered.length;
  if (!n) {
    return { top: [], ok: [], weak: [], losing: [] };
  }

  const q1 = Math.floor(n * 0.25);
  const q2 = Math.floor(n * 0.5);
  const q3 = Math.floor(n * 0.75);

  const topRows = filtered.slice(0, q1 || 1);
  const okRows = filtered.slice(q1 || 1, q2 || q1 + 1);
  const weakRows = filtered.slice(q2 || q1 + 1, q3 || q2 + 1);
  const losingRows = filtered.slice(q3 || q2 + 1);

  function strip(rArr) {
    return rArr.map((s) => ({
      bucket: s.key
        .replace("sector:", "")
        .replace("pxMA25:", "pxMA25:")
        .replace("ATR:", "ATR:")
        .replace("lag:", "lag:")
        .replace("liq:", "liq:")
        .replace("px:", "px:"),
      trades: s.trades,
      winRate: s.winRate,
      pf: s.pf,
      avgRet: s.avgRet,
    }));
  }

  return {
    top: strip(topRows),
    ok: strip(okRows),
    weak: strip(weakRows),
    losing: strip(losingRows),
  };
}

function summarizeTierAverages(tiersObj) {
  function avgOne(arr) {
    if (!arr || !arr.length) {
      return { trades: 0, winRate: 0, pf: 0, avgRet: 0 };
    }
    const sumTrades = arr.reduce((a, r) => a + (r.trades || 0), 0);
    const sumWR = arr.reduce((a, r) => a + (r.winRate || 0), 0);
    const sumPF = arr.reduce((a, r) => a + (r.pf || 0), 0);
    const sumRet = arr.reduce((a, r) => a + (r.avgRet || 0), 0);
    const n = arr.length;

    return {
      trades: r2(sumTrades / n),
      winRate: r2(sumWR / n),
      pf: r2(sumPF / n),
      avgRet: r2(sumRet / n),
    };
  }

  return {
    top: avgOne(tiersObj.top),
    ok: avgOne(tiersObj.ok),
    weak: avgOne(tiersObj.weak),
    losing: avgOne(tiersObj.losing),
  };
}

// sectorBuckets
const tradesBySector = {};
withAnalytics.forEach((t) => {
  const sec = t.sector || "UNKNOWN";
  if (!tradesBySector[sec]) tradesBySector[sec] = [];
  tradesBySector[sec].push(t);
});
const sectorRows = summarizeCategoryPerformance(tradesBySector);
const sectorBuckets = splitIntoQuartileBuckets(sectorRows, 50);
const sectorTierStats = summarizeTierAverages(sectorBuckets);

// priceBuckets
const tradesByPriceBucket = {};
withAnalytics.forEach((t) => {
  const a = t.analytics || {};
  const priceB = bucketPrice(a.entryPx || t.entryPrice);
  if (!tradesByPriceBucket[priceB]) tradesByPriceBucket[priceB] = [];
  tradesByPriceBucket[priceB].push(t);
});
const priceRows = summarizeCategoryPerformance(tradesByPriceBucket);
const priceBuckets = splitIntoQuartileBuckets(priceRows, 50);
const priceTierStats = summarizeTierAverages(priceBuckets);

// liquidityBuckets
const tradesByLiqBucket = {};
withAnalytics.forEach((t) => {
  const a = t.analytics || {};
  const liqB = bucketLiquidity(a.turnoverJPY);
  if (!tradesByLiqBucket[liqB]) tradesByLiqBucket[liqB] = [];
  tradesByLiqBucket[liqB].push(t);
});
const liqRows = summarizeCategoryPerformance(tradesByLiqBucket);
const liquidityBuckets = splitIntoQuartileBuckets(liqRows, 50);
const liquidityTierStats = summarizeTierAverages(liquidityBuckets);

// lagBuckets (freshness after cross)
const tradesByLagBucket = {};
withAnalytics.forEach((t) => {
  const lagB = bucketLag(t.crossLag);
  if (!tradesByLagBucket[lagB]) tradesByLagBucket[lagB] = [];
  tradesByLagBucket[lagB].push(t);
});
const lagRows = summarizeCategoryPerformance(tradesByLagBucket);
const lagBuckets = splitIntoQuartileBuckets(lagRows, 50);
const lagTierStats = summarizeTierAverages(lagBuckets);

// atrBuckets (volatility style)
const tradesByAtrBucket = {};
withAnalytics.forEach((t) => {
  const a = t.analytics || {};
  const atrB = bucketAtrPct(a.atrPct);
  if (!tradesByAtrBucket[atrB]) tradesByAtrBucket[atrB] = [];
  tradesByAtrBucket[atrB].push(t);
});
const atrRows = summarizeCategoryPerformance(tradesByAtrBucket);
theAtrBuckets = splitIntoQuartileBuckets(atrRows, 50);
const atrTierStats = summarizeTierAverages(theAtrBuckets);

// pxMA25Buckets (extension/chasing)
const tradesByPxMA25Bucket = {};
withAnalytics.forEach((t) => {
  const a = t.analytics || {};
  const extB = bucketPxVsMA25(a.pxVsMA25Pct);
  if (!tradesByPxMA25Bucket[extB]) tradesByPxMA25Bucket[extB] = [];
  tradesByPxMA25Bucket[extB].push(t);
});
const pxMA25Rows = summarizeCategoryPerformance(tradesByPxMA25Bucket);
const pxMA25Buckets = splitIntoQuartileBuckets(pxMA25Rows, 50);
const pxMA25TierStats = summarizeTierAverages(pxMA25Buckets);

// volZBuckets (volume attention / quiet pullback quality)
const tradesByVolZBucket = {};
withAnalytics.forEach((t) => {
  const z = t.analytics?.volZ;
  const b = bucketVolZ(z);
  if (!tradesByVolZBucket[b]) tradesByVolZBucket[b] = [];
  tradesByVolZBucket[b].push(t);
});
const volZRows = summarizeCategoryPerformance(tradesByVolZBucket);
const volZBuckets = splitIntoQuartileBuckets(volZRows, 50);
const volZTierStats = summarizeTierAverages(volZBuckets);

/* -------------------- missedOpportunities (rejectedBuys sim) -------------------- */

let missedOpportunities = null;
if (raw?.parallel?.rejectedBuys) {
  const rb = raw.parallel.rejectedBuys;

  const headline = {
    simulatedTotal: rb.summary?.total ?? 0,
    simulatedWinners: rb.summary?.winners ?? 0,
    simulatedWinRate: rb.summary?.winRate ?? 0,
  };

  const topReasons = [];
  if (rb.byReason) {
    Object.entries(rb.byReason).forEach(([reason, stats]) => {
      topReasons.push({
        reason,
        total: stats.total,
        winners: stats.winners,
        winRate: stats.winRate,
        expR: stats.expR,
        profitFactor: stats.profitFactor,
      });
    });

    topReasons.sort((a, b) => {
      if (b.winners !== a.winners) return b.winners - a.winners;
      return (b.profitFactor || 0) - (a.profitFactor || 0);
    });
  }

  const bestRejectedCombos =
    raw?.sentiment?.bestByWinRate?.rejected ||
    (raw?.sentiment?.combos?.bestByWinRate?.rejected ?? []);

  missedOpportunities = {
    headline,
    painReasons: topReasons.slice(0, 5),
    sentimentCombos: bestRejectedCombos.slice(0, 5),
  };
}

/* -------------------- singleProfile summary -------------------- */

const profilesSummary = {};
if (raw.singleProfile) {
  const sp = raw.singleProfile;
  profilesSummary.singleProfile = {
    label: sp.label,
    trades: sp.metrics?.trades,
    winRate: sp.metrics?.winRate,
    profitFactor: sp.metrics?.profitFactor,
    avgReturnPct: sp.metrics?.avgReturnPct,
    avgHoldBars: sp.metrics?.avgHoldingDays,
    exits: sp.exits || null,
    catastrophicStopSuggestion: sp.catastrophicStopSuggestion || null,
    lossTail: sp.metrics?.lossTail || null,
  };
}

/* -------------------- targetOnly block -------------------- */
/**
 * In the new engine, the whole strategy is basically "target_only style"
 * with a 15% floor stop. So we just treat all trades as targetOnlyAll.
 */

const targetOnlyAll = withAnalytics.slice(); // all trades

const targetAllStats = summarizeSubset(targetOnlyAll);
const ttt = summarizeTimeToTarget(targetOnlyAll);

const sp = raw.singleProfile || null;

const targetOnlyExport = {
  trades: targetOnlyAll.length,
  winRate: targetAllStats.metrics.winRate,
  pf: targetAllStats.metrics.profitFactor,
  avgRet: targetAllStats.metrics.avgReturnPct,
  holdAvgBars: targetAllStats.metrics.avgHoldingDays,

  timeToTargetMedianBars: ttt.days.med,
  timeToTargetP90Bars: ttt.days.p90,

  lossTail: sp?.metrics?.lossTail
    ? {
        minLossPct: sp.metrics.lossTail.minLossPct,
        maxLossPct: sp.metrics.lossTail.maxLossPct,
        p90LossPct: sp.metrics.lossTail.p90LossPct,
        p95LossPct: sp.metrics.lossTail.p95LossPct,
        countLosses: sp.metrics.lossTail.countLosses,
      }
    : null,

  catastrophicStopSuggestion: sp?.catastrophicStopSuggestion
    ? {
        killAtPct: sp.catastrophicStopSuggestion.killAtPct,
        comment: sp.catastrophicStopSuggestion.comment,
      }
    : null,
};

/* -------------------- strategyBreakdown (NEW) -------------------- */
/**
 * Group trades by literal playbook string (`trade.strategy`),
 * e.g. "WEEKLY CROSS", "WEEKLY CROSS +VOLUME", "DIP AFTER WEEKLY", etc.
 * This preserves the distinct candidate types from analyseCrossing().
 */

const tradesByStrategy = {};
withAnalytics.forEach((t) => {
  const s = t.strategy || "UNKNOWN";
  if (!tradesByStrategy[s]) tradesByStrategy[s] = [];
  tradesByStrategy[s].push(t);
});

const strategyRowsRaw = Object.entries(tradesByStrategy).map(
  ([strategyName, arr]) => {
    const m = summarizeMetrics(arr);
    return {
      strategy: strategyName,
      trades: m.trades,
      winRate: m.winRate,
      pf: m.profitFactor,
      avgRet: m.avgReturnPct,
      avgHoldBars: m.avgHoldingDays,
    };
  }
);

// rank strategies by PF, then winRate, then avgRet
strategyRowsRaw.sort((a, b) => {
  const pfA = Number.isFinite(a.pf) ? a.pf : -1;
  const pfB = Number.isFinite(b.pf) ? b.pf : -1;
  if (pfB !== pfA) return pfB - pfA;
  if (b.winRate !== a.winRate) return b.winRate - a.winRate;
  return b.avgRet - a.avgRet;
});

const strategyBreakdown = {
  perPlaybook: strategyRowsRaw,
  topPlaybooks: strategyRowsRaw.slice(0, 5),
};

/* -------------------- FINAL EXPORT -------------------- */

const exportObj = {
  window: {
    from: raw?.from || raw?.window?.from || raw?.startDate || null,
    to: raw?.to || raw?.window?.to || raw?.endDate || null,
  },

  // Global performance of everything we actually traded
  performance: {
    trades: overall.trades,
    winRate: overall.winRate,
    profitFactor: overall.profitFactor,
    avgReturnPct: overall.avgReturnPct,
    avgHoldBars: overall.avgHoldingDays,
  },

  flow: {
    signalsPerDay: raw?.signals?.perDay != null ? r2(raw.signals.perDay) : null,
    tradingDays: raw?.tradingDays,
    signalsTotal: raw?.signals?.total,
    signalsExecuted: raw?.signals?.executed,
    blocked: raw?.signals?.blocked || null,

    gates: raw?.telemetry?.gates || null,
    rrAcceptedBuckets: raw?.telemetry?.rr?.accepted || null,
    rrRejectedBuckets: raw?.telemetry?.rr?.rejected || null,
  },

  // The best situational slice (macro condition) we detected
  bestSetup: topSlice
    ? {
        name: topSlice.name,
        desc: topSlice.desc,
        trades: topSlice.n,
        tradesPerDay: topSlice.perDay,
        winRate: topSlice.metrics.winRate,
        profitFactor: topSlice.metrics.profitFactor,
        avgRet: topSlice.metrics.avgReturnPct,
        holdAvgBars: topSlice.metrics.avgHoldingDays,
      }
    : null,

  // Why we lose money (patterns among losers we *did* take)
  lossAnalysis: losingPatterns,
  lossReasons,

  // Stop tightness / catastrophic tail behavior
  stopRisk: {
    summary: {
      totalLosingTrades: stopTightnessInsight.allLosingTrades,
      stopLosses: stopTightnessInsight.stopLosses,
      timeLosses: stopTightnessInsight.timeLosses,
      endLosses: stopTightnessInsight.endLosses,
    },
    distributionAllLosses: stopTightnessInsight.bucketsAll,
    distributionStopLossesOnly: stopTightnessInsight.bucketsStopOnly,

    tailLossPct: stopTightnessInsight.tail, // { p90LossPct, p95LossPct, worstLossPct }

    stopProfile: stopTightnessInsight.stopProfile,
    guidance:
      "If most STOP losses sit in '-8% to -10%' instead of '-12% to -15%', you can likely tighten max stop below 15%. " +
      "If shallowStopsUnder10pct is high and shallowSharePct is high, a ~10% kill-stop will behave almost the same as 15%, " +
      "just earlier. If deepStopsOver10pct dominates and p95LossPct is very negative, cutting earlier will materially change behavior; " +
      "you may need to filter those setups/tickers instead of only tightening.",
  },

  missedOpportunities: missedOpportunities,

  // Market context & structural performance
  regime: regimeMetrics,
  dipAfterFreshCrossing: raw?.dipAfterFreshCrossing || null,
  crossingByLag: raw?.crossing?.byLag || null,

  // Score system health (if score still exists in trades)
  scoreQuality: hasScore
    ? {
        corrWin: r2(scoreCorr.win),
        corrRet: r2(scoreCorr.ret),
        ladder: scoreInfo.scored,
        ladderTop: scoreInfo.scored.slice(-10).reverse(),
      }
    : null,

  // Which tickers tend to help/hurt (global-only, filtered >=30 trades)
  tickers: {
    focus: bestTickers.slice(0, 5),
    avoid: worstTickers.slice(0, 5),
  },

  // Per-playbook PF / WR leaderboard (NEW)
  strategyBreakdown,

  // singleProfile summary (your unified "target_only (with 15% floor)")
  profiles: profilesSummary,

  // Bucket performance tiers (quartiles based on PF/winRate/avgRet),
  // plus tier averages to understand edge clusters.
  buckets: {
    sector: {
      tiers: sectorBuckets,
      tierAverages: sectorTierStats,
    },
    price: {
      tiers: priceBuckets,
      tierAverages: priceTierStats,
    },
    liquidity: {
      tiers: liquidityBuckets,
      tierAverages: liquidityTierStats,
    },
    volumeZ: {
      tiers: volZBuckets,
      tierAverages: volZTierStats,
    },
    lagFreshness: {
      tiers: lagBuckets,
      tierAverages: lagTierStats,
    },
    atrVolatility: {
      tiers: theAtrBuckets,
      tierAverages: atrTierStats,
    },
    pxExtensionVsMA25: {
      tiers: pxMA25Buckets,
      tierAverages: pxMA25TierStats,
    },
  },

  // Repeated high-performing situational patterns (human readable)
  bestSetups,

  // Deep dive for the unified style (aka "target_only" legacy name)
  targetOnly: targetOnlyExport,
};

/* -------------------- PRINT -------------------- */
console.log(JSON.stringify(exportObj, null, 2));
