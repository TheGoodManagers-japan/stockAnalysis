// /scripts/backtest.js — swing-period backtest (browser) — PARITY + REGIME
// Next-bar-open entries, optional time-based exit, single-profile-by-default,
// sentiment gates, and NEW: Nikkei-based market regime tagging & metrics.
//
// Options you may pass to window.backtest(..., opts):
//   - profileId: "no_progress_N5bars_creep_to_BE" (default; pick from EXIT_PROFILES)
//   - profileIds: ["idA","idB"] (run multiple)
//   - holdBars: 0 (default = disabled). Set >0 to enforce hard time exit.
//   - allowedSentiments: ["LT7-ST4","LT1-ST3", ...]  (omit/empty => allow all)
//   - allowedSentiRanks: [1,2,3] (default when omitted; [] disables rank gate)
//   - maxConcurrent: 0 (default = unlimited global positions)
//   - simulateRejectedBuys: true (unchanged)
//   - months/from/to/limit/warmupBars/cooldownDays/appendTickers/... (unchanged)
//   - regimeTicker: "1321.T" (default Nikkei 225 ETF proxy)
//   - allowedRegimes: ["UP","STRONG_UP"] to only trade in those regimes

import { analyzeSwingTradeEntry } from "./swingTradeEntryTiming.js";
import {
  enrichForTechnicalScore,
  getSentimentCombinationRank,
} from "./main.js";
import { allTickers } from "./tickers.js";
import { getComprehensiveMarketSentiment } from "./marketSentimentOrchestrator.js";
import { EXIT_PROFILES } from "./exit_profiles.js"; // external profiles

const API_BASE =
  "https://stock-analysis-thegoodmanagers-japan-aymerics-projects-60f33831.vercel.app";

const toISO = (d) => new Date(d).toISOString().slice(0, 10);
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/* ---------------- tick helpers (match swingTradeEntryTiming ladder) ---------------- */
function inferTickFromPrice(p) {
  const x = Number(p) || 0;
  if (x >= 5000) return 1;
  if (x >= 1000) return 0.5;
  if (x >= 100) return 0.1;
  if (x >= 10) return 0.05;
  return 0.01;
}
function toTick(v, stock) {
  const tick = Number(stock?.tickSize) || inferTickFromPrice(v) || 0.1;
  const x = Number(v) || 0;
  return Math.round(x / tick) * tick;
}

/* ---------------- data ---------------- */
async function fetchHistory(ticker, fromISO, toISO) {
  const r = await fetch(
    `${API_BASE}/api/history?ticker=${encodeURIComponent(ticker)}`
  );
  const text = await r.text();
  if (!r.ok)
    throw new Error(
      `history ${ticker} HTTP ${r.status}: ${text.slice(0, 200)}`
    );
  const j = JSON.parse(text);
  if (!j?.success || !Array.isArray(j.data))
    throw new Error(`bad history payload for ${ticker}`);
  return j.data
    .map((d) => ({
      date: new Date(d.date),
      open: Number(d.open ?? d.close ?? 0),
      high: Number(d.high ?? d.close ?? 0),
      low: Number(d.low ?? d.close ?? 0),
      close: Number(d.close ?? 0),
      volume: Number(d.volume ?? 0),
    }))
    .filter(
      (d) =>
        (!fromISO || d.date >= new Date(fromISO)) &&
        (!toISO || d.date <= new Date(toISO))
    );
}

/* ---------------- sentiment gate (optional) ---------------- */
function mkSentimentGate(allowedList, allowedRanks) {
  // Default: rank gate 1..3 ON
  const ranksDefault = [1, 2, 3];
  const useList = Array.isArray(allowedList) && allowedList.length > 0;
  const ranksArg = Array.isArray(allowedRanks) ? allowedRanks : undefined;
  // empty array => disable rank gate; undefined => default 1..3
  const ranks = ranksArg === undefined ? ranksDefault : ranksArg;
  const useRanks = Array.isArray(ranks) && ranks.length > 0;

  if (!useList && !useRanks) return () => true; // no gate at all

  const listSet = useList ? new Set(allowedList) : null;
  const rankSet = useRanks ? new Set(ranks.map(Number)) : null;

  return (ST, LT) => {
    const st = Number.isFinite(ST) ? ST : 4;
    const lt = Number.isFinite(LT) ? LT : 4;
    const key = `LT${lt}-ST${st}`;
    const passList = !useList || listSet.has(key);
    const rank = getSentimentCombinationRank(st, lt); // 1..5
    const passRank = !useRanks || rankSet.has(rank);
    return passList && passRank;
  };
}

/* ---------------- small helpers ---------------- */
function inc(map, key, by = 1) {
  if (!key && key !== 0) return;
  map[key] = (map[key] || 0) + by;
}
function bucketize(x, edges = [1.2, 1.4, 1.6, 2.0, 3.0, 5.0]) {
  if (!Number.isFinite(x)) return "na";
  for (let i = 0; i < edges.length; i++) {
    if (x < edges[i]) return `<${edges[i]}`;
  }
  return `≥${edges[edges.length - 1]}`;
}
function extractGuardReason(s) {
  if (!s) return "";
  const m = String(s).match(
    /^(DIP|SPC|OXR|BPB|RRP)\s+guard veto:\s*([^()]+?)(?:\s*\(|$)/i
  );
  return m ? m[2].trim() : s;
}
function afterColon(s, head) {
  const idx = String(s).indexOf(head);
  if (idx === -1) return "";
  return String(s)
    .slice(idx + head.length)
    .trim();
}

/* ---------------- counterfactual lane helpers ---------------- */
function simulateTradeForward(candles, startIdx, entry, stop, target) {
  const risk = Math.max(0.01, entry - stop);
  for (let j = startIdx + 1; j < candles.length; j++) {
    const bar = candles[j];
    if (bar.low <= stop) {
      return {
        exitType: "STOP",
        exitPrice: stop,
        holdingDays: j - startIdx,
        result: "LOSS",
        R: (stop - entry) / risk,
        returnPct: ((stop - entry) / entry) * 100,
      };
    }
    if (bar.high >= target) {
      return {
        exitType: "TARGET",
        exitPrice: target,
        holdingDays: j - startIdx,
        result: "WIN",
        R: (target - entry) / risk,
        returnPct: ((target - entry) / entry) * 100,
      };
    }
  }
  const last = candles[candles.length - 1];
  return {
    exitType: "OPEN",
    exitPrice: last.close,
    holdingDays: candles.length - 1 - startIdx,
    result: "OPEN",
    R: 0,
    returnPct: ((last.close - entry) / entry) * 100,
  };
}
function cfInitAgg() {
  return { total: 0, winners: 0, rPos: 0, rNeg: 0, winR: [], lossR: [] };
}
function cfUpdateAgg(agg, outcome) {
  if (outcome.result === "OPEN") return;
  agg.total++;
  if (outcome.result === "WIN") {
    agg.winners++;
    agg.rPos += Math.max(0, outcome.R || 0);
    agg.winR.push(outcome.R || 0);
  } else {
    agg.rNeg += Math.abs(Math.min(0, outcome.R || 0));
    agg.lossR.push(outcome.R || 0);
  }
}
function cfFinalizeAgg(agg) {
  const p = agg.total ? agg.winners / agg.total : 0;
  const avgRwin = agg.winR.length
    ? agg.winR.reduce((a, b) => a + b, 0) / agg.winR.length
    : 0;
  const avgRloss = agg.lossR.length
    ? agg.lossR.reduce((a, b) => a + b, 0) / agg.lossR.length
    : 0;
  const expR = p * avgRwin + (1 - p) * avgRloss;
  const pf = agg.rNeg ? agg.rPos / agg.rNeg : agg.winners ? Infinity : 0;
  return {
    total: agg.total,
    winners: agg.winners,
    winRate: +(p * 100).toFixed(2),
    expR: +expR.toFixed(2),
    profitFactor: Number.isFinite(pf) ? +pf.toFixed(2) : Infinity,
  };
}

/* ----------- reason normalizer ----------- */
function normalizeRejectedReason(reasonRaw) {
  if (!reasonRaw) return "unspecified";
  let r = String(reasonRaw).trim();

  // normalize "[PLAYBOOK] not ready:"
  r = r.replace(/^(DIP|SPC|OXR|BPB|RRP)\s+not ready:\s*/i, "");

  if (/^bounce weak/i.test(r)) return "bounce weak / no quality pattern";
  if (/^no meaningful pullback/i.test(r)) return "no meaningful pullback";
  if (/^already recovered/i.test(r)) return "already recovered > cap";
  if (/^Headroom too small/i.test(r)) return "headroom too small pre-entry";
  if (/^bearish RSI divergence/i.test(r)) return "bearish RSI divergence";
  if (/^MA20 & MA25 both rolling down/i.test(r))
    return "MA20 & MA25 rolling down (px < MA20)";
  if (/^not at MA20\/25\/50 or tested structure/i.test(r))
    return "no MA/structure support";
  if (/^DIP conditions not fully met/i.test(r))
    return "conditions not fully met";
  if (/^Structure gate/i.test(r)) return "structure gate";
  if (/^(DIP|SPC|OXR|BPB|RRP)\s+blocked \(Perfect gate\)/i.test(r))
    return "perfect-mode gate";
  if (/^(DIP|SPC|OXR|BPB|RRP)\s+guard veto:/i.test(reasonRaw))
    return "guard veto";
  if (/^(DIP|SPC|OXR|BPB|RRP)\s+RR too low:/i.test(reasonRaw))
    return "RR too low";

  // Clean parentheticals like (RSI=..., headroom=...)
  r = r.replace(/\([^)]*\)/g, "");
  r = r.replace(/\s{2,}/g, " ").trim();
  return r.toLowerCase();
}

/* ---------------- sentiment aggregation ---------------- */
function sentiKey(ST, LT) {
  const st = Number.isFinite(ST) ? ST : 4;
  const lt = Number.isFinite(LT) ? LT : 4;
  return `LT${lt}-ST${st}`;
}
function sentiInit() {
  return { total: 0, wins: 0, sumRetPct: 0, sumR: 0 };
}
function sentiUpdate(agg, outcome) {
  agg.total++;
  if (outcome.result === "WIN") agg.wins++;
  agg.sumRetPct += outcome.returnPct || 0;
  agg.sumR += outcome.R || 0;
}
function sentiFinalize(agg) {
  const wr = agg.total ? (agg.wins / agg.total) * 100 : 0;
  const avgRet = agg.total ? agg.sumRetPct / agg.total : 0;
  const expR = agg.total ? agg.sumR / agg.total : 0;
  return {
    count: agg.total,
    wins: agg.wins,
    winRate: +wr.toFixed(2),
    avgReturnPct: +avgRet.toFixed(2),
    expR: +expR.toFixed(2),
  };
}

/* ---------------------- REGIME HELPERS (Nikkei-based) ---------------------- */
const DEFAULT_REGIME_TICKER = "1321.T"; // Nikkei 225 ETF (you can change via opts.regimeTicker)

function smaArr(arr, p) {
  if (arr.length < p) return Array(arr.length).fill(NaN);
  const out = new Array(arr.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= p) sum -= arr[i - p];
    if (i >= p - 1) out[i] = sum / p;
  }
  return out;
}

/**
 * Compute simple daily regime labels from a Nikkei proxy candles array.
 * Logic:
 *  - STRONG_UP: px>MA25 & MA25 slope > +0.02%/bar & MA25>MA75
 *  - UP:        px>MA25 & slope >= 0
 *  - RANGE:     abs(slope) < 0.02%/bar (near-flat) OR |px-MA25| <= 1*ATR(14)
 *  - DOWN:      otherwise
 */
function computeRegimeLabels(candles) {
  if (!Array.isArray(candles) || candles.length < 30) {
    return candles.map(() => "RANGE");
  }

  const closes = candles.map((c) => Number(c.close) || 0);
  const ma25 = smaArr(closes, 25);
  const ma75 = smaArr(closes, 75);

  // ATR(14) for RANGE tie-break
  const atr = (() => {
    if (candles.length < 15) return candles.map(() => 0);
    const out = new Array(candles.length).fill(0);
    for (let i = 1; i < candles.length; i++) {
      const h = Number(candles[i].high ?? candles[i].close ?? 0);
      const l = Number(candles[i].low ?? candles[i].close ?? 0);
      const pc = Number(candles[i - 1].close ?? 0);
      const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
      if (i < 15) {
        // warmup simple average
        const start = Math.max(1, i - 14);
        const w = candles.slice(start, i + 1);
        const sum = w.reduce((s, _, k) => {
          const idx = start + k;
          const h2 = Number(candles[idx].high ?? candles[idx].close ?? 0);
          const l2 = Number(candles[idx].low ?? candles[idx].close ?? 0);
          const pc2 = Number(candles[idx - 1]?.close ?? 0);
          const tr2 = Math.max(h2 - l2, Math.abs(h2 - pc2), Math.abs(l2 - pc2));
          return s + tr2;
        }, 0);
        out[i] = sum / Math.min(14, i);
      } else {
        // Wilder smoothing-ish: reuse previous ATR for smoothness
        out[i] = (out[i - 1] * 13 + tr) / 14;
      }
    }
    return out;
  })();

  const labels = [];
  for (let i = 0; i < candles.length; i++) {
    const px = closes[i];
    const m25 = ma25[i];
    const m75 = ma75[i];
    const a14 = atr[i] || 0;

    // slope of MA25 over last 5 bars (% per bar relative to MA25)
    let slope = 0;
    if (i >= 5 && Number.isFinite(m25) && m25 > 0) {
      const prev = ma25[i - 5];
      if (Number.isFinite(prev) && prev > 0) {
        slope = (m25 - prev) / prev / 5; // per bar
      }
    }

    const aboveMA = Number.isFinite(m25) && px > m25;
    const strong =
      aboveMA && slope > 0.0002 && Number.isFinite(m75) && m25 > m75; // > +0.02%/bar
    const flatish =
      Math.abs(slope) < 0.0002 ||
      (Number.isFinite(m25) && Math.abs(px - m25) <= a14);

    if (strong) labels.push("STRONG_UP");
    else if (aboveMA && slope >= 0) labels.push("UP");
    else if (flatish) labels.push("RANGE");
    else labels.push("DOWN");
  }
  return labels;
}

/** Build a { "YYYY-MM-DD": "REGIME" } map for quick lookup */
function buildRegimeMap(candles) {
  const labels = computeRegimeLabels(candles);
  const map = Object.create(null);
  for (let i = 0; i < candles.length; i++) {
    map[toISO(candles[i].date)] = labels[i];
  }
  return map;
}

/* ------------------ MAIN: Backtest (swing-period) — PARITY ------------------ */
/**
 * Backtest (swing period) — PARITY oriented.
 * opts:
 *   { months=36, from, to, limit=0, warmupBars=60, holdBars=0 (disabled),
 *     cooldownDays=2, appendTickers?: string[], profileId?: string,
 *     profileIds?: string[], allowedSentiments?: string[], allowedSentiRanks?: number[],
 *     maxConcurrent?: number, targetTradesPerDay?: number, countBlockedSignals?: boolean,
 *     includeByTicker?: boolean, simulateRejectedBuys?: boolean,
 *     topRejectedReasons?: number, examplesCap?: number,
 *     regimeTicker?: string, allowedRegimes?: string[] // NEW
 *   }
 */
async function runBacktest(tickersOrOpts, maybeOpts) {
  let tickers = Array.isArray(tickersOrOpts) ? tickersOrOpts : [];
  const opts = Array.isArray(tickersOrOpts)
    ? maybeOpts || {}
    : tickersOrOpts || {};

  const INCLUDE_BY_TICKER = !!opts.includeByTicker;
  const INCLUDE_PROFILE_SAMPLES = !!opts.includeProfileSamples;
  const SIM_REJECTED = opts.simulateRejectedBuys ?? true;
  const TOP_K = Number.isFinite(opts.topRejectedReasons)
    ? Math.max(1, opts.topRejectedReasons)
    : 12;
  const EX_CAP = Number.isFinite(opts.examplesCap) ? opts.examplesCap : 5;

  const months = Number.isFinite(opts.months) ? Number(opts.months) : 36;
  const to = opts.to ? new Date(opts.to) : new Date();
  const from = opts.from
    ? new Date(opts.from)
    : new Date(to.getFullYear(), to.getMonth() - months, to.getDate());
  const FROM = new Date(from).toISOString().slice(0, 10);
  const TO = new Date(to).toISOString().slice(0, 10);

  const limit = Number(opts.limit) || 0;
  const WARMUP = Number.isFinite(opts.warmupBars) ? opts.warmupBars : 60;
  const HOLD_BARS = Number.isFinite(opts.holdBars)
    ? Math.max(0, opts.holdBars)
    : 0; // default: off
  const COOLDOWN = Number.isFinite(opts.cooldownDays) ? opts.cooldownDays : 2;
  const MAX_CONCURRENT = Number.isFinite(opts.maxConcurrent)
    ? Math.max(0, opts.maxConcurrent)
    : 0; // 0 = unlimited

  const append = Array.isArray(opts.appendTickers) ? opts.appendTickers : [];
  if (!tickers.length) tickers = allTickers.map((t) => t.code);
  tickers = [...new Set([...tickers, ...append])];
  if (limit > 0) tickers = tickers.slice(0, limit);

  const codes = tickers.map((c) =>
    c.endsWith(".T")
      ? c.toUpperCase()
      : `${String(c).toUpperCase().replace(/\..*$/, "")}.T`
  );

  // choose active profiles (single by default)
  let activeProfiles = [];
  if (Array.isArray(opts.profileIds) && opts.profileIds.length) {
    activeProfiles = EXIT_PROFILES.filter((p) =>
      opts.profileIds.includes(p.id)
    );
  } else {
    const requested = opts.profileId || "no_progress_N5bars_creep_to_BE";
    const chosen =
      EXIT_PROFILES.find((p) => p.id === requested) ||
      EXIT_PROFILES.find((p) => p.id === "no_progress_N5bars_creep_to_BE") ||
      EXIT_PROFILES[0];
    activeProfiles = [chosen];
  }

  // optional sentiment gate: accepts explicit combos AND/OR rank list
  const allowBySentiment = mkSentimentGate(
    opts.allowedSentiments,
    opts.allowedSentiRanks // undefined => defaults to [1,2,3]
  );

  // --- NEW: regime options ---
  const REGIME_TICKER =
    opts && typeof opts.regimeTicker === "string" && opts.regimeTicker.trim()
      ? opts.regimeTicker.trim().toUpperCase()
      : DEFAULT_REGIME_TICKER;

  // Gate by regime labels if provided (["STRONG_UP","UP","RANGE","DOWN"])
  const allowedRegimes =
    Array.isArray(opts.allowedRegimes) && opts.allowedRegimes.length
      ? new Set(opts.allowedRegimes.map(String))
      : null;

  // Fetch regime reference history once (same FROM/TO window)
  let regimeMap = null;
  try {
    const nikkeiRef = await fetchHistory(REGIME_TICKER, FROM, TO);
    if (nikkeiRef && nikkeiRef.length) {
      regimeMap = buildRegimeMap(nikkeiRef);
      console.log(
        `[BT] Regime ready from ${REGIME_TICKER} with ${nikkeiRef.length} bars`
      );
    } else {
      console.log(`[BT] Regime disabled: no candles for ${REGIME_TICKER}`);
    }
  } catch (e) {
    console.log(
      `[BT] Regime disabled: failed to load ${REGIME_TICKER} — ${String(
        e?.message || e
      )}`
    );
  }

  // Aggregation per regime
  const regimeAgg = {
    STRONG_UP: [],
    UP: [],
    RANGE: [],
    DOWN: [],
  };

  // diagnostics
  const byTicker = [];
  const globalTrades = [];
  const tradingDays = new Set();
  let globalOpenPositions = 0;

  let signalsTotal = 0;
  let signalsAfterWarmup = 0;
  let signalsWhileFlat = 0;
  let signalsInvalid = 0;
  let signalsRiskBad = 0; // kept for telemetry compatibility (won't be used now)
  let signalsExecuted = 0;

  let blockedInTrade = 0;
  let blockedCooldown = 0;
  let blockedWarmup = 0;
  let blockedBySentiment_DIP = 0;

  const COUNT_BLOCKED = !!opts.countBlockedSignals;

  // telemetry
  const telemetry = {
    trends: { STRONG_UP: 0, UP: 0, WEAK_UP: 0, DOWN: 0 },
    gates: {
      priceActionGateFailed: 0,
      structureGateFailed: 0,
      stackedGateFailed: 0,
    },
    dip: {
      notReadyReasons: {},
      guardVetoReasons: {},
    },
    rr: { rejected: {}, accepted: {} },
    examples: { buyNow: [], rejected: [] },
  };
  const EXAMPLE_MAX = 5;

  // parallel (buyNow=false sims)
  const parallel = {
    rejectedBuys: {
      totalSimulated: 0,
      winners: 0,
      byReasonRaw: Object.create(null),
      examples: Object.create(null),
      summary: { total: 0, winners: 0, winRate: 0 },
      topK: TOP_K,
    },
  };

  // sentiment tables
  const sentiment = {
    actual: Object.create(null),
    rejected: Object.create(null),
    bestByWinRate: { actual: [], rejected: [] },
  };

  console.log(
    `[BT] window ${FROM}→${TO} | holdBars=${
      HOLD_BARS || "off"
    } | warmup=${WARMUP} | cooldown=${COOLDOWN} | profiles=${activeProfiles
      .map((p) => p.id)
      .join(",")}`
  );
  console.log(`[BT] total stocks: ${codes.length}`);

  const pct = (n) => Math.round(n * 100) / 100;

  // global position cap
  let globalOpenCount = 0;

  for (let ti = 0; ti < codes.length; ti++) {
    const code = codes[ti];
    console.log(`[BT] processing stock ${ti + 1}/${codes.length}: ${code}`);

    try {
      const candles = await fetchHistory(code, FROM, TO);
      if (candles.length < WARMUP + 2) {
        if (INCLUDE_BY_TICKER) {
          byTicker.push({ ticker: code, trades: [], error: "not enough data" });
        }
        console.log(
          `[BT] finished ${ti + 1}/${codes.length}: ${code} (not enough data)`
        );
        continue;
      }

      const trades = [];
      const tradesByProfile = Object.fromEntries(
        activeProfiles.map((p) => [p.id, []])
      );
      const openByProfile = Object.create(null); // id -> open state
      const cooldownUntilByProfile = Object.create(null);
      for (const p of activeProfiles) cooldownUntilByProfile[p.id] = -1;

      // per-ticker loop
      for (let i = 0; i < candles.length; i++) {
        const today = candles[i];
        tradingDays.add(toISO(today.date));
        const hist = candles.slice(0, i + 1);

        // --- NEW: regime tag for this day (based on reference map) ---
        const dayISO = toISO(today.date);
        const dayRegime = regimeMap ? regimeMap[dayISO] || "RANGE" : "RANGE";

        const stock = {
          ticker: code,
          currentPrice: today.close,
          highPrice: today.high,
          lowPrice: today.low,
          openPrice: today.open,
          prevClosePrice: candles[i - 1] ? candles[i - 1].close : today.close,
          fiftyTwoWeekHigh: Math.max(...hist.map((c) => c.high)),
          fiftyTwoWeekLow: Math.min(...hist.map((c) => c.low)),
          historicalData: hist,
        };
        enrichForTechnicalScore(stock);

        // blocked counters (optional, per profile)
        if (COUNT_BLOCKED) {
          for (const p of activeProfiles) {
            if (openByProfile[p.id]) blockedInTrade++;
            else if (i <= cooldownUntilByProfile[p.id]) blockedCooldown++;
          }
          if (i < WARMUP) blockedWarmup++;
        }

        // manage open positions per profile
        for (const p of activeProfiles) {
          const st = openByProfile[p.id];
          if (!st) continue;

          // dynamic rule hook
          if (typeof p.advance === "function") {
            p.advance({ bar: today, state: st, hist, stock });

            // ⛔ Never allow the stop to change — re-pin to initial fixed stop
            st.stop = st.stopInit;

            // Target may still update; snap it to tick if present
            if (Number.isFinite(st.target))
              st.target = toTick(st.target, stock);
          }

          let exit = null;

          // 1) price-based exits first (priority: stop/target)
          if (today.low <= st.stop) {
            exit = { type: "STOP", price: st.stop, result: "LOSS" };
          } else if (today.high >= st.target) {
            exit = { type: "TARGET", price: st.target, result: "WIN" };
          }

          // 2) optional hard time exit at HOLD_BARS
          if (!exit && HOLD_BARS > 0) {
            const ageBars = i - st.entryIdx;
            if (ageBars >= HOLD_BARS) {
              const rawPnL = today.close - st.entry;
              exit = {
                type: "TIME",
                price: today.close,
                result: rawPnL >= 0 ? "WIN" : "LOSS",
              };
            }
          }

          if (exit) {
            const pctRet =
              ((exit.price - st.entry) / Math.max(1e-9, st.entry)) * 100;
            const risk = Math.max(0.01, st.entry - st.stopInit);
            const trade = {
              ticker: code,
              profile: p.id,
              strategy: st.kind || "DIP",
              entryDate: toISO(candles[st.entryIdx].date),
              exitDate: toISO(today.date),
              holdingDays: i - st.entryIdx,
              entry: r2(st.entry),
              exit: r2(exit.price),
              stop: st.stopInit,
              target: st.target,
              result: exit.result,
              exitType: exit.type,
              R: r2((exit.price - st.entry) / risk),
              returnPct: r2(pctRet),
              ST: st.ST,
              LT: st.LT,
              regime: st.regime || "RANGE", // NEW
            };

            tradesByProfile[p.id].push(trade);
            trades.push(trade);
            globalTrades.push(trade);

            // sentiment (actual)
            const k = sentiKey(st.ST, st.LT);
            if (!sentiment.actual[k]) sentiment.actual[k] = sentiInit();
            sentiUpdate(sentiment.actual[k], {
              result: trade.result,
              returnPct: trade.returnPct,
              R: trade.R,
            });

            // NEW: collect per-regime
            if (trade.regime && regimeAgg[trade.regime]) {
              regimeAgg[trade.regime].push(trade);
            }

            openByProfile[p.id] = null;
            cooldownUntilByProfile[p.id] = i + COOLDOWN;
            globalOpenCount = Math.max(0, globalOpenCount - 1);
          }
        }

        // try new entries if any profile is free and warmup passed
        const anyProfileEligible =
          i >= WARMUP &&
          activeProfiles.some(
            (p) => !openByProfile[p.id] && i > cooldownUntilByProfile[p.id]
          ) &&
          (MAX_CONCURRENT === 0 || globalOpenCount < MAX_CONCURRENT);

        if (anyProfileEligible) {
          // evaluate signal on the current bar
          const sig = analyzeSwingTradeEntry(stock, hist, {
            debug: true,
            debugLevel: "verbose",
            // cfg: { ...inject your live analyzer config here if needed ... }
          });

          // snapshot sentiment once
          const senti = getComprehensiveMarketSentiment(stock, hist);
          const ST = senti?.shortTerm?.score ?? 4;
          const LT = senti?.longTerm?.score ?? 4;

          // trend telemetry
          const trend = sig?.debug?.ms?.trend;
          if (trend && telemetry.trends.hasOwnProperty(trend))
            telemetry.trends[trend]++;

          if (sig?.buyNow) {
            signalsTotal++;
            signalsAfterWarmup++;
            signalsWhileFlat++;

            // optional sentiment gate
            if (!allowBySentiment(ST, LT)) {
              blockedBySentiment_DIP++;
              continue;
            }

            // NEW: optional regime gate
            if (allowedRegimes && !allowedRegimes.has(dayRegime)) {
              continue;
            }

            // RR telemetry (ratio here is for diagnostics, we still accept/ignore)
            const rRatio = Number(sig?.debug?.rr?.ratio);
            inc(telemetry.rr.accepted, bucketize(rRatio));
            if (telemetry.examples.buyNow.length < EXAMPLE_MAX) {
              telemetry.examples.buyNow.push({
                ticker: code,
                date: toISO(today.date),
                reason: sig?.reason || "",
                rr: Number.isFinite(rRatio) ? r2(rRatio) : null,
              });
            }

            // >>> ENTRY = next-bar open (fallback: today's close if no next bar)
            const hasNext = i + 1 < candles.length;
            const entryBarIdx = hasNext ? i + 1 : i;
            const entryBar = candles[entryBarIdx];
            const entry = hasNext ? entryBar.open : today.close;

            // open per active profile
            for (const p of activeProfiles) {
              if (openByProfile[p.id]) continue;
              if (i <= cooldownUntilByProfile[p.id]) continue;
              if (MAX_CONCURRENT > 0 && globalOpenCount >= MAX_CONCURRENT)
                break;

              // compute plan (for TARGET etc.). We IGNORE any suggested stop here.
              const plan =
                p.compute({
                  entry,
                  stock: { ...stock, currentPrice: entry },
                  sig,
                  today: entryBar,
                  hist: candles.slice(0, entryBarIdx + 1),
                }) || {};
              const target = Number(plan.target);

              // must have a valid target; stop is fixed below
              if (!Number.isFinite(target)) {
                signalsInvalid++;
                continue;
              }

              // ✅ Fixed stop: -10% from entry, snapped to tick — and locked forever
              const fixedStop = entry * 0.9;
              const qStop = toTick(fixedStop, stock);
              const qTarget = toTick(target, stock);

              openByProfile[p.id] = {
                entryIdx: entryBarIdx,
                entry,
                stop: qStop, // always equals stopInit; never changes
                stopInit: qStop, // used for risk and re-pinning later
                target: qTarget,
                ST,
                LT,
                regime: dayRegime, // NEW
                kind:
                  String(sig?.debug?.chosen || sig?.reason || "")
                    .split(":")[0]
                    .trim() || "UNKNOWN",
              };
              globalOpenCount++;
              signalsExecuted++;
            }
          } else {
            // why not buy? (telemetry)
            const dbg = sig?.debug || {};
            if (dbg && dbg.priceActionGate === false) {
              telemetry.gates.priceActionGateFailed++;
            }
            if (Array.isArray(dbg.reasons)) {
              for (const r of dbg.reasons) {
                if (typeof r === "string" && r.startsWith("DIP not ready:")) {
                  const why = afterColon(r, "DIP not ready:").replace(
                    /^[:\s]+/,
                    ""
                  );
                  inc(telemetry.dip.notReadyReasons, why || "unspecified");
                }
                if (r === "Structure gate: trend not up or price < MA5.") {
                  telemetry.gates.structureGateFailed++;
                }
                if (
                  r === "DIP blocked (Perfect gate): MAs not stacked bullishly."
                ) {
                  telemetry.gates.stackedGateFailed++;
                }
                if (r.match(/^(DIP|SPC|OXR|BPB|RRP)\s+guard veto:/i)) {
                  const reason = extractGuardReason(r);
                  inc(telemetry.dip.guardVetoReasons, reason || "guard");
                }
                if (r.match(/^(DIP|SPC|OXR|BPB|RRP)\s+RR too low:/i)) {
                  const m = r.match(/need\s+([0-9.]+)/i);
                  const need = m ? parseFloat(m[1]) : NaN;
                  inc(telemetry.rr.rejected, bucketize(need));
                }
              }
            }

            // parallel: simulate rejected buys using candidate levels when available
            if (SIM_REJECTED) {
              const entry = today.close; // same-bar for CF simplicity
              const simStop = Number(sig?.smartStopLoss ?? sig?.stopLoss);
              const simTarget = Number(
                sig?.smartPriceTarget ?? sig?.priceTarget
              );

              if (
                Number.isFinite(simStop) &&
                Number.isFinite(simTarget) &&
                simStop < entry
              ) {
                const outcome = simulateTradeForward(
                  candles,
                  i,
                  entry,
                  simStop,
                  simTarget
                );

                const k = sentiKey(ST, LT);
                if (!sentiment.rejected[k]) sentiment.rejected[k] = sentiInit();
                if (outcome.result !== "OPEN") {
                  sentiUpdate(sentiment.rejected[k], outcome);
                  parallel.rejectedBuys.totalSimulated++;
                  if (outcome.result === "WIN") parallel.rejectedBuys.winners++;
                }

                const reasonsRaw = Array.isArray(sig?.debug?.reasons)
                  ? sig.debug.reasons.slice(0, 2)
                  : [sig?.reason || "unspecified"];

                for (const rr of reasonsRaw) {
                  const key = normalizeRejectedReason(rr);
                  if (!parallel.rejectedBuys.byReasonRaw[key]) {
                    parallel.rejectedBuys.byReasonRaw[key] = cfInitAgg();
                  }
                  cfUpdateAgg(parallel.rejectedBuys.byReasonRaw[key], outcome);

                  if (outcome.result === "WIN") {
                    if (!parallel.rejectedBuys.examples[key])
                      parallel.rejectedBuys.examples[key] = [];
                    if (
                      parallel.rejectedBuys.examples[key].length < EXAMPLE_MAX
                    ) {
                      parallel.rejectedBuys.examples[key].push({
                        ticker: code,
                        date: toISO(today.date),
                        entry: r2(entry),
                        stop: r2(simStop),
                        target: r2(simTarget),
                        exitType: outcome.exitType,
                        R: +(outcome.R || 0).toFixed(2),
                        returnPct: +(outcome.returnPct || 0).toFixed(2),
                        ST,
                        LT,
                      });
                    }
                  }
                }
              }
            }
          }
        } else if (COUNT_BLOCKED) {
          // Count signals even when blocked by warmup/cooldown/in-trade (optional)
          const sig = analyzeSwingTradeEntry(stock, hist, {
            debug: true,
            debugLevel: "verbose",
          });
          if (sig?.buyNow) {
            signalsTotal++;
            if (i >= WARMUP) signalsAfterWarmup++;
          }
        }
      } // bars loop

      // per-ticker summary
      const tStops = trades.filter((x) => x.exitType === "STOP").length;
      const tTargets = trades.filter((x) => x.exitType === "TARGET").length;
      const tTimes = trades.filter((x) => x.exitType === "TIME").length;

      if (INCLUDE_BY_TICKER) {
        byTicker.push({
          ticker: code,
          trades,
          counts: { target: tTargets, stop: tStops, time: tTimes },
          openAtEnd: activeProfiles.some((p) => !!openByProfile[p.id]),
        });
      }

      const stillOpenCount = activeProfiles.reduce(
        (a, p) => a + (openByProfile[p.id] ? 1 : 0),
        0
      );
      globalOpenPositions += stillOpenCount;

      const total = globalTrades.length;
      const winsSoFar = globalTrades.filter((x) => x.result === "WIN").length;
      const winRateSoFar = total ? pct((winsSoFar / total) * 100) : 0;
      const avgRetSoFar = total
        ? pct(globalTrades.reduce((a, b) => a + (b.returnPct || 0), 0) / total)
        : 0;

      console.log(
        `[BT] finished ${ti + 1}/${codes.length}: ${code} | finished stocks=${
          ti + 1
        } | current avg win=${winRateSoFar}% | current avg return=${avgRetSoFar}% | exits — target:${tTargets} stop:${tStops} time:${tTimes}`
      );
    } catch (e) {
      if (INCLUDE_BY_TICKER) {
        byTicker.push({
          ticker: code,
          trades: [],
          error: String(e?.message || e),
        });
      }
      console.log(
        `[BT] finished ${ti + 1}/${codes.length}: ${code} | error: ${String(
          e?.message || e
        )}`
      );
    }
  }

  // ---- final metrics ----
  const all = byTicker.length
    ? byTicker.flatMap((t) => t.trades)
    : globalTrades;
  const totalTrades = all.length;
  const wins = all.filter((t) => t.result === "WIN").length;
  const winRate = totalTrades ? r2((wins / totalTrades) * 100) : 0;
  const avgReturnPct = totalTrades
    ? r2(all.reduce((a, b) => a + (b.returnPct || 0), 0) / totalTrades)
    : 0;
  const avgHoldingDays = totalTrades
    ? r2(all.reduce((a, b) => a + (b.holdingDays || 0), 0) / totalTrades)
    : 0;

  const hitTargetCount = all.filter((t) => t.exitType === "TARGET").length;
  const hitStopCount = all.filter((t) => t.exitType === "STOP").length;
  const timeExitCount = all.filter((t) => t.exitType === "TIME").length;
  const timeWins = all.filter(
    (t) => t.exitType === "TIME" && t.result === "WIN"
  ).length;
  const timeLosses = all.filter(
    (t) => t.exitType === "TIME" && t.result === "LOSS"
  ).length;

  const days = tradingDays.size;
  const tradesPerDay = days ? totalTrades / days : 0;
  const targetTPD =
    Number.isFinite(opts.targetTradesPerDay) && opts.targetTradesPerDay > 0
      ? Number(opts.targetTradesPerDay)
      : null;

  // rejected-buys aggregation
  const raw = parallel.rejectedBuys.byReasonRaw;
  const rows = Object.keys(raw).map((k) => ({
    reason: k,
    agg: raw[k],
    fin: cfFinalizeAgg(raw[k]),
  }));
  rows.sort((a, b) => {
    if (b.fin.winners !== a.fin.winners) return b.fin.winners - a.fin.winners;
    return b.fin.total - a.fin.total;
  });

  const top = rows.slice(0, parallel.rejectedBuys.topK);
  const rest = rows.slice(parallel.rejectedBuys.topK);
  const byReason = {};
  for (const r of top) byReason[r.reason] = r.fin;

  if (rest.length) {
    const otherAgg = cfInitAgg();
    for (const r of rest) {
      otherAgg.total += r.agg.total;
      otherAgg.winners += r.agg.winners;
      otherAgg.rPos += r.agg.rPos;
      otherAgg.rNeg += r.agg.rNeg;
    }
    byReason.OTHER = cfFinalizeAgg(otherAgg);
  }

  const examples = {};
  for (const r of top) {
    examples[r.reason] = (parallel.rejectedBuys.examples[r.reason] || []).slice(
      0,
      EX_CAP
    );
  }

  const cfTotal = rows.reduce((a, r) => a + r.fin.total, 0);
  const cfWins = rows.reduce((a, r) => a + r.fin.winners, 0);
  const summary = {
    total: cfTotal,
    winners: cfWins,
    winRate: cfTotal ? +((cfWins / cfTotal) * 100).toFixed(2) : 0,
  };
  parallel.rejectedBuys = {
    totalSimulated: cfTotal,
    winners: cfWins,
    summary,
    topK: TOP_K,
    byReason,
    examples,
  };

  // sentiment tables
  function finalizeSentiTable(obj) {
    const out = {};
    for (const k of Object.keys(obj)) out[k] = sentiFinalize(obj[k]);
    const ranked = Object.entries(out)
      .map(([k, v]) => ({ key: k, ...v }))
      .sort((a, b) =>
        b.winRate !== a.winRate ? b.winRate - a.winRate : b.count - a.count
      );
    return { combos: out, bestByWinRate: ranked.slice(0, 15) };
  }
  const sentiActual = finalizeSentiTable(sentiment.actual);
  const sentiRejected = finalizeSentiTable(sentiment.rejected);
  sentiment.bestByWinRate.actual = sentiActual.bestByWinRate;
  sentiment.bestByWinRate.rejected = sentiRejected.bestByWinRate;

  // per-profile metrics (computed over all EXIT_PROFILES to keep UI stable)
  const profiles = {};
  for (const p of EXIT_PROFILES) {
    const list = all.filter((t) => t.profile === p.id);
    profiles[p.id] = {
      label: p.label,
      metrics: computeMetrics(list),
      exits: {
        target: list.filter((t) => t.exitType === "TARGET").length,
        stop: list.filter((t) => t.exitType === "STOP").length,
        time: list.filter((t) => t.exitType === "TIME").length,
      },
      ...(INCLUDE_PROFILE_SAMPLES ? { samples: list.slice(0, 8) } : {}),
    };
  }
  function bestProfileKey(get) {
    let k = null,
      v = -Infinity;
    for (const id of Object.keys(profiles)) {
      const m = profiles[id].metrics || {};
      const score = get(m);
      if (Number.isFinite(score) && score > v) {
        v = score;
        k = id;
      }
    }
    return k;
  }
  const bestByWinRate = bestProfileKey((m) => m.winRate ?? -Infinity);
  const bestByExpR = bestProfileKey((m) => m.expR ?? -Infinity);
  const bestByPF = bestProfileKey((m) => m.profitFactor ?? -Infinity);

  // optional: per-playbook breakdown (DIP/SPC/OXR/BPB/RRP)
  const byKind = {};
  for (const t of all) {
    const k = t.strategy || "DIP";
    if (!byKind[k]) byKind[k] = [];
    byKind[k].push(t);
  }
  const strategyBreakdown = Object.fromEntries(
    Object.entries(byKind).map(([k, v]) => [k, computeMetrics(v)])
  );

  // --- NEW: per-regime metrics ---
  const regimeMetrics = {};
  for (const key of Object.keys(regimeAgg)) {
    regimeMetrics[key] = computeMetrics(regimeAgg[key]);
  }

  // Console snapshot for regimes
  console.log("[BT] REGIME STATS");
  for (const k of ["STRONG_UP", "UP", "RANGE", "DOWN"]) {
    const m = regimeMetrics[k];
    console.log(
      `[BT] ${k.padEnd(10)} | trades=${m.trades} | winRate=${
        m.winRate
      }% | avgRet=${m.avgReturnPct}% | PF=${m.profitFactor}`
    );
  }

  // logs
  console.log(
    `[BT] COMPLETE | trades=${totalTrades} | winRate=${winRate}% | avgReturn=${avgReturnPct}% | avgHold=${avgHoldingDays} bars | exits — target:${hitTargetCount} stop:${hitStopCount} time:${timeExitCount}`
  );
  console.log(
    `[BT] SIGNALS | total=${signalsTotal} | afterWarmup=${signalsAfterWarmup} | whileFlat=${signalsWhileFlat} | executed=${signalsExecuted} | invalid=${signalsInvalid} | riskStop>=px=${signalsRiskBad} | blocked: inTrade=${blockedInTrade} cooldown=${blockedCooldown} warmup=${blockedWarmup} | stlt: DIP=${blockedBySentiment_DIP}`
  );
  console.log(
    `[BT] DAILY AVG | tradingDays=${days} | trades/day=${tradesPerDay.toFixed(
      3
    )}${targetTPD ? ` | target=${targetTPD}` : ""}`
  );

  if (targetTPD) {
    const diff = tradesPerDay - targetTPD;
    if (diff >= 0) {
      console.log(
        `[BT] TARGET ✅ above target by +${diff.toFixed(3)} trades/day.`
      );
    } else {
      const needed = Math.ceil(Math.abs(diff) * days);
      console.log(
        `[BT] TARGET ⚠️ below target by ${(-diff).toFixed(
          3
        )} trades/day (~${needed} more trades over ${days} days).`
      );
    }
  }

  // legacy "dip" key preserved if present
  const dipMetrics = strategyBreakdown.DIP || computeMetrics(all);

  return {
    from: FROM,
    to: TO,
    params: {
      holdBars: HOLD_BARS,
      warmupBars: WARMUP,
      cooldownDays: COOLDOWN,
      targetTradesPerDay: targetTPD,
      countBlockedSignals: COUNT_BLOCKED,
      includeByTicker: INCLUDE_BY_TICKER,
      simulateRejectedBuys: SIM_REJECTED,
      topRejectedReasons: TOP_K,
      examplesCap: EX_CAP,
      includeProfileSamples: INCLUDE_PROFILE_SAMPLES,
      profileIds: activeProfiles.map((p) => p.id),
      allowedSentiments: Array.isArray(opts.allowedSentiments)
        ? opts.allowedSentiments
        : [],
      allowedSentiRanks: Array.isArray(opts.allowedSentiRanks)
        ? opts.allowedSentiRanks
        : undefined,
      maxConcurrent: MAX_CONCURRENT,
      regimeTicker: REGIME_TICKER,
      allowedRegimes: allowedRegimes ? Array.from(allowedRegimes) : [],
    },
    totalTrades,
    winRate,
    avgReturnPct,
    avgHoldingDays,
    tradesPerDay,
    tradingDays: days,
    openAtEnd: globalOpenPositions,
    exitCounts: {
      target: hitTargetCount,
      stop: hitStopCount,
      time: timeExitCount,
      timeWins,
      timeLosses,
    },
    signals: {
      total: signalsTotal,
      afterWarmup: signalsAfterWarmup,
      whileFlat: signalsWhileFlat,
      executed: signalsExecuted,
      invalid: signalsInvalid,
      riskStopGtePx: signalsRiskBad,
      blocked: {
        inTrade: blockedInTrade,
        cooldown: blockedCooldown,
        warmup: blockedWarmup,
        stlt: { dip: blockedBySentiment_DIP },
      },
    },
    strategy: {
      all: computeMetrics(all),
      dip: dipMetrics,
      ...strategyBreakdown,
    },
    telemetry,
    parallel,
    sentiment: {
      actual: sentiActual.combos,
      rejected: sentiRejected.combos,
      bestByWinRate: sentiment.bestByWinRate,
    },
    profiles,
    bestProfiles: {
      byWinRate: bestByWinRate,
      byExpR: bestByExpR,
      byProfitFactor: bestByPF,
    },
    regime: {
      ticker: REGIME_TICKER,
      metrics: regimeMetrics, // NEW
    },
    ...(INCLUDE_BY_TICKER ? { byTicker } : {}),
  };
}

/* ------------------------ metrics helpers ------------------------ */
function computeMetrics(trades) {
  const n = trades.length;
  const wins = trades.filter((t) => t.result === "WIN");
  const losses = trades.filter((t) => t.result === "LOSS");

  const winRate = n ? (wins.length / n) * 100 : 0;
  const avgReturnPct = n ? sum(trades.map((t) => t.returnPct || 0)) / n : 0;
  const avgHoldingDays = n ? sum(trades.map((t) => t.holdingDays || 0)) / n : 0;

  const avgWinPct = wins.length
    ? sum(wins.map((t) => t.returnPct || 0)) / wins.length
    : 0;
  const avgLossPct = losses.length
    ? sum(losses.map((t) => t.returnPct || 0)) / losses.length
    : 0;

  const rWins = wins.map((t) => t.R || 0);
  const rLosses = losses.map((t) => t.R || 0);
  const avgRwin = rWins.length ? sum(rWins) / rWins.length : 0;
  const avgRloss = rLosses.length ? sum(rLosses) / rLosses.length : 0;
  const p = n ? wins.length / n : 0;
  const expR = p * avgRwin + (1 - p) * avgRloss;

  const grossWin = sum(wins.map((t) => t.returnPct || 0));
  const grossLossAbs = Math.abs(sum(losses.map((t) => t.returnPct || 0)));
  const profitFactor = grossLossAbs
    ? grossWin / grossLossAbs
    : wins.length
    ? Infinity
    : 0;

  // ✅ Count exits over ALL trades
  const exits = {
    target: trades.filter((t) => t.exitType === "TARGET").length,
    stop: trades.filter((t) => t.exitType === "STOP").length,
    time: trades.filter((t) => t.exitType === "TIME").length,
  };

  return {
    trades: r2(n),
    winRate: r2(winRate),
    avgReturnPct: r2(avgReturnPct),
    avgHoldingDays: r2(avgHoldingDays),
    avgWinPct: r2(avgWinPct),
    avgLossPct: r2(avgLossPct),
    avgRwin: r2(avgRwin),
    avgRloss: r2(avgRloss),
    expR: r2(expR),
    profitFactor: Number.isFinite(profitFactor) ? r2(profitFactor) : Infinity,
    exits,
  };
}
function sum(arr) {
  return arr.reduce((a, b) => a + (Number(b) || 0), 0);
}

/* --------------------------- expose for Bubble -------------------------- */
window.backtest = async (tickersOrOpts, maybeOpts) => {
  try {
    return Array.isArray(tickersOrOpts)
      ? await runBacktest(tickersOrOpts, { ...maybeOpts })
      : await runBacktest({ ...(tickersOrOpts || {}) });
  } catch (e) {
    console.error("[backtest] error:", e);
    return {
      from: "",
      to: "",
      totalTrades: 0,
      winRate: 0,
      avgReturnPct: 0,
      avgHoldingDays: 0,
      tradesPerDay: 0,
      tradingDays: 0,
      openAtEnd: 0,
      exitCounts: { target: 0, stop: 0, time: 0, timeWins: 0, timeLosses: 0 },
      signals: {
        total: 0,
        afterWarmup: 0,
        whileFlat: 0,
        executed: 0,
        invalid: 0,
        riskStopGtePx: 0,
        blocked: {
          inTrade: 0,
          cooldown: 0,
          warmup: 0,
          stlt: { dip: 0 },
        },
      },
      strategy: {
        all: computeMetrics([]),
        dip: computeMetrics([]),
      },
      telemetry: {
        trends: { STRONG_UP: 0, UP: 0, WEAK_UP: 0, DOWN: 0 },
        gates: {
          priceActionGateFailed: 0,
          structureGateFailed: 0,
          stackedGateFailed: 0,
        },
        dip: { notReadyReasons: {}, guardVetoReasons: {} },
        rr: { rejected: {}, accepted: {} },
        examples: { buyNow: [], rejected: [] },
      },
      parallel: {
        rejectedBuys: {
          totalSimulated: 0,
          winners: 0,
          summary: { total: 0, winners: 0, winRate: 0 },
          topK: 12,
          byReason: {},
          examples: {},
        },
      },
      sentiment: {
        actual: {},
        rejected: {},
        bestByWinRate: { actual: [], rejected: [] },
      },
      regime: { ticker: "", metrics: {} },
      error: String(e?.message || e),
    };
  }
};
