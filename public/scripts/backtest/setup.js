#!/usr/bin/env node
/**
 * setup.js — learn data-driven setups using **all** available dims, then auto-coarsen
 * Usage: node setup.js backtest.json
 *
 * Input: { last36m, last12m, last6m, last3m, last1m } from window.backtest(...)
 * Output:
 *  - stdout summary (coverage + tier totals + top patterns)
 *  - backtest-newbuckets.json (same folder as input)
 */

const fs = require("fs");
const path = require("path");

const WINDOWS = ["last36m", "last12m", "last6m", "last3m", "last1m"];
const LEARN_WINDOW = "last36m";

/* ---------------- thresholds (tweakable) ---------------- */
const MIN_TRADES_LEARN_BASE = 8; // min trades per setup in learn window (level 0)
const MIN_TRADES_WINDOW = 10; // min trades per setup to count in window summaries
const PF_ELITE = 1.8,
  WR_ELITE = 60; // S on learn window
const PF_STRONG = 1.3,
  WR_STRONG = 55; // A on learn window
const PF_FLOOR_ALL = 0.95; // stability: worst PF across windows
const TARGET_COVERAGE = 0.95; // learn-window coverage target
const MAX_COARSEN_LEVEL = 4; // how far we allow coarsening

/* -------------- helpers -------------- */
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function writeJSON(p, o) {
  fs.writeFileSync(p, JSON.stringify(o, null, 2), "utf8");
}

function collectTrades(windowPayload) {
  const list = [];
  const byTicker = Array.isArray(windowPayload?.byTicker)
    ? windowPayload.byTicker
    : [];
  for (const row of byTicker) {
    const ts = Array.isArray(row.trades) ? row.trades : [];
    for (const t of ts) list.push({ ...t, ticker: row.ticker || t.ticker });
  }
  return list;
}

function computeMetrics(trades) {
  if (!trades.length) {
    return {
      trades: 0,
      winRate: 0,
      avgReturnPct: 0,
      profitFactor: 0,
      profitFactorLabel: "0",
    };
  }
  const wins = trades.filter((t) => t.result === "WIN");
  const losses = trades.filter((t) => t.result === "LOSS");
  const n = trades.length;
  const wr = (wins.length / n) * 100;
  const avgRet = trades.reduce((a, t) => a + (Number(t.returnPct) || 0), 0) / n;
  const gw = wins.reduce((a, t) => a + (Number(t.returnPct) || 0), 0);
  const gl = Math.abs(
    losses.reduce((a, t) => a + (Number(t.returnPct) || 0), 0)
  );
  const pfRaw = gl ? gw / gl : wins.length ? Infinity : 0;
  return {
    trades: n,
    winRate: r2(wr),
    avgReturnPct: r2(avgRet),
    profitFactor: Number.isFinite(pfRaw) ? r2(pfRaw) : 1e9,
    profitFactorLabel: Number.isFinite(pfRaw) ? String(r2(pfRaw)) : "Infinity",
  };
}

/* ---------------- feature binning (we use EVERYTHING we have) ---------------- */

function binLag(lag) {
  if (!Number.isFinite(lag)) return "LAG:NOLAG";
  if (lag <= 1) return "LAG:EARLY";
  if (lag <= 4) return "LAG:MID";
  return "LAG:LATE";
}

function binExt(pxVsMA25Pct, isDip) {
  if (!Number.isFinite(pxVsMA25Pct)) return "EXT:NA";
  if (pxVsMA25Pct > 6) return "EXT:>6";
  if (pxVsMA25Pct > 2) return "EXT:2-6";
  if (isDip && pxVsMA25Pct < -2) return "EXT:PANIC";
  return "EXT:NEAR";
}

function binATR(atrPct) {
  if (!Number.isFinite(atrPct)) return "VOL:NA";
  if (atrPct < 2) return "VOL:TAME";
  if (atrPct <= 3) return "VOL:MED";
  return "VOL:HIGH";
}

function binTurnover(turnJPY) {
  if (!Number.isFinite(turnJPY)) return "LIQ:NA";
  if (turnJPY >= 200_000_000) return "LIQ:VLIQ";
  if (turnJPY >= 50_000_000) return "LIQ:OK";
  return "LIQ:ILL";
}

function normStr(s) {
  return String(s || "NA").replace(/\s+/g, "_");
}

function binRSI(rsi) {
  if (!Number.isFinite(rsi)) return "RSI:NA";
  if (rsi <= 30) return "RSI:OS"; // oversold
  if (rsi >= 70) return "RSI:OB"; // overbought
  return "RSI:NORM";
}

function binVolZ(z) {
  if (!Number.isFinite(z)) return "VOLZ:NA";
  if (z >= 2) return "VOLZ:HOT";
  if (z <= -2) return "VOLZ:COLD";
  return "VOLZ:NORM";
}

function binMAStack(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "MASTACK:NA";
  if (x >= 3) return "MASTACK:3";
  if (x >= 2) return "MASTACK:2";
  if (x >= 1) return "MASTACK:1";
  return "MASTACK:0";
}

function binAboveMA(b) {
  return b ? "ABV:YES" : "ABV:NO";
}

function binGap(g) {
  if (!Number.isFinite(g)) return "GAP:NA";
  if (g >= 1.5) return "GAP:UP_BIG";
  if (g > 0.2) return "GAP:UP_SM";
  if (g <= -1.5) return "GAP:DN_BIG";
  if (g < -0.2) return "GAP:DN_SM";
  return "GAP:FLAT";
}

function binSentimentLT(LT) {
  if (!Number.isFinite(LT)) return "LT:NA";
  return LT >= 6 ? "LT:Hi" : "LT:Lo";
}
function binSentimentST(ST) {
  if (!Number.isFinite(ST)) return "ST:NA";
  return ST >= 6 ? "ST:Hi" : "ST:Lo";
}

function binR(R) {
  if (!Number.isFinite(R)) return "R:NA";
  if (R >= 1.5) return "R:>=1.5";
  if (R >= 0.5) return "R:0.5-1.5";
  if (R >= 0) return "R:0-0.5";
  return "R:<0";
}

/**
 * Sector coarse bucket (keeps sector info but reduces cardinality).
 * You can refine this mapping as you like.
 */
function mapSector(secRaw) {
  const s = String(secRaw || "NA").toLowerCase();
  if (s.includes("technology")) return "SEC:Tech";
  if (s.includes("communication") || s.includes("telecom")) return "SEC:Comm";
  if (s.includes("consumer defensive") || s.includes("staples"))
    return "SEC:Staples";
  if (s.includes("consumer cyclical") || s.includes("discretionary"))
    return "SEC:Disc";
  if (s.includes("financial")) return "SEC:Fin";
  if (s.includes("real estate")) return "SEC:RE";
  if (s.includes("health")) return "SEC:Health";
  if (s.includes("industrial")) return "SEC:Ind";
  if (s.includes("energy")) return "SEC:Energy";
  if (s.includes("utilities")) return "SEC:Util";
  if (s.includes("basic") || s.includes("materials")) return "SEC:Materials";
  return "SEC:Other";
}

/**
 * Strategy family
 */
function stratFamily(strategy) {
  const s = String(strategy || "").toUpperCase();
  if (s.includes("WEEKLY")) return "STRAT:WEEKLY";
  if (s.includes("DAILY")) return "STRAT:DAILY";
  if (s.includes("DIP")) return "STRAT:DIP";
  return "STRAT:OTHER";
}

/**
 * Build a coarsening-aware setup key **using all available dims**.
 *
 * Coarsen levels:
 * 0 — full detail: STRAT + EXT(5) + LAG(4) + VOL(3) + LIQ(3) + REG + SECTORc + RSI + VOLZ + MASTACK + ABV(MA25/75) + GAP + LT/ST + Rbin + ARCH
 * 1 — drop REG, keep everything else
 * 2 — merge: EXT -> {>6|2-6|PANIC|NEAR/NA}, VOL -> {TAME|MEDHIGH|NA}, LIQ -> {VLIQ|OK|ILL|NA}; keep LT/ST, RSI, VOLZ, MASTACK, MA flags, GAP, SECTORc
 * 3 — drop SECTOR, keep LT/ST + RSI + MASTACK + MA flags + GAP
 * 4 — very coarse: STRAT + EXT coarse + LAG + VOL2 + LIQ2 + LT/ST
 */
function buildSetupKey(trade, level = 0) {
  const fam = stratFamily(trade.strategy);
  const reg = `REG:${String(trade.regime || "RANGE").toUpperCase()}`;
  const lag = binLag(Number(trade.crossLag));
  const arch = `ARCH:${String(trade.entryArchetype || "NA").toUpperCase()}`;

  const a = trade.analytics || {};
  const ext = binExt(
    Number(a.pxVsMA25Pct),
    /DIP/i.test(String(trade.strategy || ""))
  );
  const vol = binATR(Number(a.atrPct));
  const liq = binTurnover(Number(a.turnoverJPY));
  const rsi = binRSI(Number(a.rsi));
  const volz = binVolZ(Number(a.volZ));
  const mstk = binMAStack(Number(a.maStackScore));
  const abv25 = `ABV25:${binAboveMA(!!a.pxAboveMA25).split(":")[1]}`;
  const abv75 = `ABV75:${binAboveMA(!!a.pxAboveMA75).split(":")[1]}`;
  const gap = binGap(Number(a.gapPct));

  const ltBin = binSentimentLT(trade.LT);
  const stBin = binSentimentST(trade.ST);
  const rBin = binR(trade.R);

  const sectorCoarse = mapSector(trade.sector);

  // Coarse variants
  const vol2 =
    vol === "VOL:TAME"
      ? "VOL2:TAME"
      : vol === "VOL:NA"
      ? "VOL2:NA"
      : "VOL2:MEDHIGH";
  const liq2 =
    liq === "LIQ:ILL" ? "LIQ2:ILL" : liq === "LIQ:NA" ? "LIQ2:NA" : "LIQ2:LIQ";
  const ext2 =
    ext === "EXT:>6"
      ? "EXT2:>6"
      : ext === "EXT:2-6"
      ? "EXT2:2-6"
      : ext === "EXT:PANIC"
      ? "EXT2:PANIC"
      : "EXT2:NEAR";

  let parts = [
    fam,
    ext,
    lag,
    vol,
    liq,
    reg,
    sectorCoarse,
    rsi,
    volz,
    mstk,
    abv25,
    abv75,
    gap,
    ltBin,
    stBin,
    rBin,
    arch,
  ];

  if (level === 1) {
    // drop REG only
    parts = [
      fam,
      ext,
      lag,
      vol,
      liq,
      sectorCoarse,
      rsi,
      volz,
      mstk,
      abv25,
      abv75,
      gap,
      ltBin,
      stBin,
      rBin,
      arch,
    ];
  } else if (level === 2) {
    // coarse merges for robustness; keep SECTOR, sentiment, RSI, volZ, MA stack/flags, GAP
    parts = [
      fam,
      ext2,
      lag,
      vol2,
      liq2,
      sectorCoarse,
      rsi,
      volz,
      mstk,
      abv25,
      abv75,
      gap,
      ltBin,
      stBin,
      rBin,
      arch,
    ];
  } else if (level === 3) {
    // drop sector to raise coverage; still rich on market-tech features
    parts = [
      fam,
      ext2,
      lag,
      vol2,
      liq2,
      rsi,
      volz,
      mstk,
      abv25,
      abv75,
      gap,
      ltBin,
      stBin,
      rBin,
      arch,
    ];
  } else if (level >= 4) {
    // very coarse but still uses multiple dims + sentiment
    parts = [fam, ext2, lag, vol2, liq2, ltBin, stBin];
  }

  return parts.join("_");
}

/* ---------------- learning + bucketing ---------------- */

function learnBucketsAtLevel(bundle, level, minTradesLearn) {
  const learn = bundle?.[LEARN_WINDOW];
  if (!learn) throw new Error(`Missing ${LEARN_WINDOW} in input`);

  const learnTradesAll = collectTrades(learn);

  // group by setup in learn window
  const setups = new Map(); // key => { learn:{trades,metrics}, perWindow:{} }
  for (const tr of learnTradesAll) {
    const key = buildSetupKey(tr, level);
    if (!setups.has(key))
      setups.set(key, { learn: { trades: [] }, perWindow: {} });
    setups.get(key).learn.trades.push(tr);
  }

  // filter low-support & compute learn metrics
  let covered = 0;
  for (const [key, obj] of [...setups.entries()]) {
    const n = obj.learn.trades?.length || 0;
    if (n < minTradesLearn) {
      setups.delete(key);
      continue;
    }
    obj.learn.metrics = computeMetrics(obj.learn.trades);
    covered += n;
  }
  const learnCoverage = learnTradesAll.length
    ? covered / learnTradesAll.length
    : 0;

  // metrics per window (stability)
  for (const [key, obj] of setups.entries()) {
    for (const winKey of WINDOWS) {
      const win = bundle?.[winKey];
      if (!win) continue;
      const allTrades = collectTrades(win).filter(
        (t) => buildSetupKey(t, level) === key
      );
      const mets = computeMetrics(allTrades);
      obj.perWindow[winKey] =
        mets.trades >= MIN_TRADES_WINDOW
          ? mets
          : {
              trades: mets.trades,
              winRate: 0,
              avgReturnPct: 0,
              profitFactor: 0,
              profitFactorLabel: "0",
            };
    }
  }

  // assign buckets by performance + stability
  const buckets = { S: [], A: [], B: [], C: [] };
  for (const [key, obj] of setups.entries()) {
    const L = obj.learn.metrics;

    // worst PF across supported windows
    let worstPF = Infinity;
    let anySupported = false;
    for (const winKey of WINDOWS) {
      const m = obj.perWindow[winKey];
      if (!m) continue;
      if (m.trades >= MIN_TRADES_WINDOW) {
        anySupported = true;
        const pf = Number.isFinite(m.profitFactor) ? m.profitFactor : 1e9;
        worstPF = Math.min(worstPF, pf);
      }
    }
    if (!anySupported) worstPF = L.profitFactor;

    let tier;
    if (
      L.profitFactor >= PF_ELITE &&
      L.winRate >= WR_ELITE &&
      worstPF >= PF_FLOOR_ALL
    ) {
      tier = "S";
    } else if (
      L.profitFactor >= PF_STRONG &&
      L.winRate >= WR_STRONG &&
      worstPF >= 0.9
    ) {
      tier = "A";
    } else if (L.profitFactor >= 1.0) {
      tier = "B";
    } else {
      tier = "C";
    }

    buckets[tier].push({
      key,
      learn: L,
      worstPF: r2(worstPF),
      perWindow: obj.perWindow,
      __learnCount: obj.learn.trades.length,
    });
  }

  // sort for readability
  for (const t of ["S", "A", "B", "C"]) {
    buckets[t].sort((x, y) => {
      if (y.learn.profitFactor !== x.learn.profitFactor)
        return y.learn.profitFactor - x.learn.profitFactor;
      if (y.learn.winRate !== x.learn.winRate)
        return y.learn.winRate - x.learn.winRate;
      return (y.learn.trades || 0) - (x.learn.trades || 0);
    });
  }

  // tier totals (learn window)
  const learnTierTotals = {};
  for (const t of ["S", "A", "B", "C"]) {
    learnTierTotals[t] = buckets[t].reduce(
      (acc, s) => acc + (s.__learnCount || 0),
      0
    );
  }

  return {
    buckets,
    learnCoverage,
    learnTierTotals,
    learnTotal: learnTradesAll.length,
  };
}

function printTier(label, list, max = 10) {
  const top = list.slice(0, max);
  console.log(`\n${label}  (top ${top.length} of ${list.length})`);
  for (const s of top) {
    const L = s.learn;
    console.log(`  • ${s.key}
      learn: trades:${L.trades}  WR:${L.winRate}%  PF:${L.profitFactorLabel}  avg:${L.avgReturnPct}%  | worstPF(all)=${s.worstPF}`);
  }
}

/* ---------------- main ---------------- */
(function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: node setup.js backtest.json");
    process.exit(1);
  }

  const data = readJSON(inputPath);
  for (const k of WINDOWS) {
    if (!data[k]) {
      console.error(
        `Input missing ${k}. Export the full bundle from window.backtest(...)`
      );
      process.exit(1);
    }
  }

  console.log(`\nReading: ${inputPath}`);
  console.log(`Learning window: ${LEARN_WINDOW}`);
  console.log(
    `Targets: coverage >= ${(TARGET_COVERAGE * 100).toFixed(
      0
    )}%, minTradesLearn starts at ${MIN_TRADES_LEARN_BASE}`
  );
  console.log(
    `Features: strategy, lag, regime, sector(coarse), LT/ST, Rbin, ATR-vol, liquidity, extension vs MA25, RSI, volZ, MA stack, aboveMA25/75, gap, archetype.`
  );

  // auto-coarsen loop
  let best = null;
  for (let level = 0; level <= MAX_COARSEN_LEVEL; level++) {
    // relax min trades slightly as we coarsen
    const minTradesLearn = Math.max(4, MIN_TRADES_LEARN_BASE - level * 2);

    const attempt = learnBucketsAtLevel(data, level, minTradesLearn);
    best = attempt; // keep latest; stop when target met
    const covPct = (attempt.learnCoverage * 100).toFixed(2);

    console.log(
      `\nCoarsen level ${level}: coverage=${covPct}% | minTradesLearn=${minTradesLearn}`
    );
    console.log(
      `Tier totals (learn window): S=${attempt.learnTierTotals.S}  A=${attempt.learnTierTotals.A}  B=${attempt.learnTierTotals.B}  C=${attempt.learnTierTotals.C}  (total=${attempt.learnTotal})`
    );

    if (attempt.learnCoverage >= TARGET_COVERAGE) {
      console.log(`Reached target coverage at level ${level}.`);
      break;
    }
  }

  const { buckets, learnCoverage, learnTierTotals, learnTotal } = best;

  console.log(
    `\nFINAL learn-window coverage: ${(learnCoverage * 100).toFixed(2)}% (${
      learnTierTotals.S +
      learnTierTotals.A +
      learnTierTotals.B +
      learnTierTotals.C
    }/${learnTotal} trades covered)`
  );

  printTier("S (Elite)", buckets.S);
  printTier("A (Strong)", buckets.A);
  printTier("B (Neutral)", buckets.B);
  printTier("C (Avoid)", buckets.C);

  const out = {
    learnWindow: LEARN_WINDOW,
    thresholds: {
      minTradesLearnBase: MIN_TRADES_LEARN_BASE,
      minTradesWindow: MIN_TRADES_WINDOW,
      pfElite: PF_ELITE,
      wrElite: WR_ELITE,
      pfStrong: PF_STRONG,
      wrStrong: WR_STRONG,
      pfFloorAll: PF_FLOOR_ALL,
      targetCoverage: TARGET_COVERAGE,
      maxCoarsenLevel: MAX_COARSEN_LEVEL,
    },
    coverage: { learnCoverage, learnTierTotals, learnTotal },
    buckets,
  };

  const outPath = path.join(
    path.dirname(inputPath),
    `${path.basename(inputPath, path.extname(inputPath))}-newbuckets.json`
  );
  writeJSON(outPath, out);
  console.log(`\nWrote: ${outPath}\n`);
})();
