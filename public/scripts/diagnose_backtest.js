#!/usr/bin/env node
/**
 * diagnose_backtest.js
 * Node.js analyzer for your backtest output (the JSON your backtest.js returns).
 *
 * Usage:
 *   node diagnose_backtest.js path/to/backtest.json --out metrics.json --md report.md
 *
 * What it does:
 * - Reads the backtest JSON.
 * - Pulls all trades (or byTicker[].trades if present), WITHOUT listing tickers.
 * - Computes:
 *    * Overall metrics: winRate, PF, avgReturn, holding, exits.
 *    * Feature deciles + win/ret by decile for: rsi, atrPct, volZ, pxVsMA25Pct, gapPct, maStackScore.
 *    * Simple Pearson correlations vs win (1/0) and returnPct.
 *    * Sentiment (LT, ST) actual vs rejected (best/worst by winRate).
 *    * Regime metrics (STRONG_UP/UP/RANGE/DOWN).
 *    * Cross-lag metrics (DAILY/WEEKLY by lag).
 * - Prints a concise diagnosis to console.
 * - Optionally writes JSON (--out) and Markdown (--md) summaries.
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
  // fallback to global (some builds return globalTrades inline; yours returns only aggregates)
  // We’ll reconstruct from strategy if trades aren’t present
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
    // include top in last bin
    if (i === bounds.length - 2) {
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

// -------------------- main --------------------
const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const allTrades = safeGetAllTrades(raw);

// Guard: if no trades with analytics, explain and exit gracefully
const withAnalytics = allTrades.filter(
  (t) => t && t.analytics && typeof t.analytics === "object"
);
if (!withAnalytics.length) {
  console.log(
    "[diagnose] No trades with `analytics` found. Ensure you applied the patch to store analytics on each trade."
  );
  process.exit(0);
}

// Features to analyze (present in the patch you added)
const FEATURES = [
  "rsi", // 14-period RSI at entry
  "atrPct", // ATR(14) as % of entry
  "volZ", // 20-day volume Z-score
  "pxVsMA25Pct", // price vs MA25 in %
  "gapPct", // open-vs-prev-close gap in %
  "maStackScore", // 0..3 (MA5>MA25, MA25>MA75, price>MA25)
];

// Build arrays for correlations
const yWin = withAnalytics.map((t) => (t.result === "WIN" ? 1 : 0));
const yRet = withAnalytics.map((t) => +t.returnPct || 0);

// Per-feature deciles + correlation
const featureResults = {};
for (const f of FEATURES) {
  const values = withAnalytics.map((t) => {
    const v = t.analytics?.[f];
    return Number.isFinite(v) ? +v : NaN;
  });
  const finiteVals = values.filter(Number.isFinite);
  const { bounds } = deciles(finiteVals);

  // bucket each trade
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

  // correlations
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

// Sentiment rollups (actual + rejected already in backtest)
const sentiActual = raw?.sentiment?.bestByWinRate?.actual || [];
const sentiRejected = raw?.sentiment?.bestByWinRate?.rejected || [];

// Regime metrics
const regime = raw?.regime?.metrics || {};

// Cross-lag metrics
const xlag = raw?.crossing?.byLag || { WEEKLY: {}, DAILY: {} };
const dipAfter = raw?.dipAfterFreshCrossing || { WEEKLY: null, DAILY: null };

// Overall
const overall = summarizeMetrics(withAnalytics);

// -------------------- Compose concise diagnosis text --------------------
function pickFeatureTakeaways(fr) {
  const out = [];
  for (const [name, obj] of Object.entries(fr)) {
    const d = obj.deciles;
    if (!d.length) continue;
    const low = d[0],
      high = d[9];
    const wrDiff = r2(high.winRate - low.winRate);
    const retDiff = r2(high.avgReturnPct - low.avgReturnPct);
    const cWin = obj.corr.win,
      cRet = obj.corr.ret;

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

// Sentiment snippets
function summarizeSenti(list, label) {
  const top = list
    .slice(0, 5)
    .map((r) => `${r.key} (WR ${r.winRate}%, n=${r.count})`)
    .join("; ");
  return `${label}: ${top || "n/a"}`;
}
const sentiSummary = [
  summarizeSenti(sentiActual, "Best actual LT-ST"),
  summarizeSenti(sentiRejected, "Best rejected LT-ST"),
];

// Regime summary
function fmtRegime(name) {
  const m = regime?.[name] || {};
  if (!m || !("trades" in m)) return `${name}: n/a`;
  return `${name}: WR ${m.winRate}% | PF ${m.profitFactor} | AvgRet ${m.avgReturnPct}% | n=${m.trades}`;
}
const regimeSummary = ["STRONG_UP", "UP", "RANGE", "DOWN"].map(fmtRegime);

// Cross-lag summary
function summarizeLag(side) {
  const m = xlag?.[side] || {};
  const keys = Object.keys(m)
    .map((k) => +k)
    .sort((a, b) => a - b);
  if (!keys.length) return `${side}: n/a`;
  const first = m[keys[0]],
    bestLag = keys.reduce((best, k) => {
      const wr = m[k]?.winRate ?? -1;
      return wr > (m[best]?.winRate ?? -1) ? k : best;
    }, keys[0]);
  return `${side}: early lag ${keys[0]} → WR ${
    first?.winRate ?? "n/a"
  }%, best lag ${bestLag} → WR ${m[bestLag]?.winRate ?? "n/a"}%`;
}
const lagSummary = [summarizeLag("DAILY"), summarizeLag("WEEKLY")];

// -------------------- Console output --------------------
console.log("=== OVERALL ===");
console.log(
  `Trades ${overall.trades} | WinRate ${overall.winRate}% | PF ${overall.profitFactor} | AvgRet ${overall.avgReturnPct}% | AvgHold ${overall.avgHoldingDays} bars`
);
console.log("\n=== FEATURE SIGNALS (decile10 vs decile1 & correlations) ===");
takeaways.forEach((s) => console.log("- " + s));
console.log("\n=== SENTIMENT ===");
sentiSummary.forEach((s) => console.log("- " + s));
console.log("\n=== REGIME ===");
regimeSummary.forEach((s) => console.log("- " + s));
console.log("\n=== CROSS-LAG ===");
lagSummary.forEach((s) => console.log("- " + s));
console.log("\n=== DIP AFTER FRESH CROSS ===");
function fmtDipAfter(label, m) {
  if (!m || typeof m !== "object" || !("trades" in m)) {
    return `- ${label}: n/a`;
  }
  return `- ${label}: trades ${m.trades} | WinRate ${m.winRate}% | PF ${m.profitFactor} | AvgRet ${m.avgReturnPct}%`;
}
console.log(fmtDipAfter("WEEKLY", dipAfter.WEEKLY));
console.log(fmtDipAfter("DAILY", dipAfter.DAILY));


// -------------------- Optional outputs --------------------
const exportObj = {
  overall,
  features: featureResults,
  sentiment: {
    bestActual: sentiActual,
    bestRejected: sentiRejected,
  },
  regime: raw?.regime?.metrics || {},
  crossLag: xlag,
  dipAfterFreshCross: dipAfter, // <-- NEW
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
  lines.push("## Feature Takeaways");
  for (const s of takeaways) lines.push(`- ${s}`);
  lines.push("");
  lines.push("## Sentiment (Top by WinRate)");
  lines.push(`- ${sentiSummary[0]}`);
  lines.push(`- ${sentiSummary[1]}`);
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

  fs.writeFileSync(mdPath, lines.join("\n"), "utf8");
  console.log(`[write] Markdown report -> ${mdPath}`);
}
