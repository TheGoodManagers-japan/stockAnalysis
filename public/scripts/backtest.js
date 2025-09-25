// /scripts/backtest.js — swing-period backtest (browser) — DIP-only (TRAIL after target)
// DIP: enter on buyNow=true; exit on stop or TRAIL after target (NO time-based exits).
// ST/LT sentiment gating happens here (no changes to analyzers).

import { analyzeSwingTradeEntry } from "./swingTradeEntryTiming.js";
import { enrichForTechnicalScore } from "./main.js";
import { allTickers } from "./tickers.js";
import { getComprehensiveMarketSentiment } from "./marketSentimentOrchestrator.js";

const API_BASE =
  "https://stock-analysis-thegoodmanagers-japan-aymerics-projects-60f33831.vercel.app";
const toISO = (d) => new Date(d).toISOString().slice(0, 10);
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

// === Regime controls (top-level flags only; NO fetching here) ===
const REGIME_TICKER = "1306.T"; // TOPIX ETF as market regime proxy
const USE_REGIME = true; // master toggle for regime feature

function normalizeCode(t) {
  let s = String(t).trim().toUpperCase();
  if (!/\.T$/.test(s)) s = s.replace(/\..*$/, "") + ".T";
  return s;
}
function defaultTickerCodes(limit = 0) {
  const arr = allTickers.map((t) => t.code);
  return limit > 0 ? arr.slice(0, limit) : arr;
}

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
      low: Number(d.low ?? 0),
      close: Number(d.close ?? 0),
      volume: Number(d.volume ?? 0),
    }))
    .filter(
      (d) =>
        (!fromISO || d.date >= new Date(fromISO)) &&
        (!toISO || d.date <= new Date(toISO))
    );
}

/* ---------------- ST/LT gating policy (1..7 where 1=strong bull) ---------------- */
function shouldAllowDIP(ST, LT) {
  const st = Number.isFinite(ST) ? ST : 4;
  const lt = Number.isFinite(LT) ? LT : 4;
  return lt <= 7 && st >= 1 && st <= 7;
}

/* ---------------- Small helpers ---------------- */
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
  const m = String(s).match(/^DIP guard veto:\s*([^()]+?)(?:\s*\(|$)/i);
  return m ? m[1].trim() : s;
}
function afterColon(s, head) {
  const idx = String(s).indexOf(head);
  if (idx === -1) return "";
  return String(s)
    .slice(idx + head.length)
    .trim();
}

/* --------- TRAILING helpers (swing-low + simple ATR/MA for CF sims) --------- */
function lastSwingLow(candles, endIdx, lookback = 8) {
  // Return the most recent local pivot low in [endIdx - lookback, endIdx]
  const a = Math.max(2, endIdx - lookback);
  const b = endIdx - 1;
  let pivot = null;
  for (let i = b; i >= a; i--) {
    const l = candles[i].low, lPrev = candles[i - 1].low, lNext = candles[i + 1]?.low ?? l;
    if (l < lPrev && l < lNext) {
      pivot = l;
      break;
    }
  }
  // Fallback to min low over window if no clean pivot
  if (pivot == null) {
    let m = Infinity;
    for (let i = a; i <= b; i++) m = Math.min(m, candles[i].low);
    pivot = Number.isFinite(m) ? m : candles[endIdx - 1].low;
  }
  return pivot;
}
function simpleMA(candles, endIdx, n = 25) {
  if (endIdx + 1 < n) return candles[endIdx].close;
  let s = 0;
  for (let i = endIdx - n + 1; i <= endIdx; i++) s += candles[i].close;
  return s / n;
}
function simpleATR14(candles, endIdx, n = 14) {
  if (endIdx < 1) return Math.max(candles[endIdx].close * 0.005, 1e-6);
  const start = Math.max(1, endIdx - n + 1);
  let trSum = 0;
  for (let i = start; i <= endIdx; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trSum += tr;
  }
  const atr = trSum / (endIdx - start + 1);
  // tiny floor like elsewhere
  return Math.max(atr, candles[endIdx].close * 0.005, 1e-6);
}

/* ---------------- Counterfactual helpers (parallel lane) ---------------- */
// Updated CF simulator: when target is touched, switch to TRAIL instead of exiting
function simulateTradeForward(candles, startIdx, entry, stopInit, target) {
  const risk = Math.max(0.01, entry - stopInit);
  let trailing = false;
  let trailStop = stopInit;

  for (let j = startIdx + 1; j < candles.length; j++) {
    const bar = candles[j];

    // Conservative order: stop first (worst-case for long)
    if (bar.low <= (trailing ? trailStop : stopInit)) {
      const px = trailing ? trailStop : stopInit;
      return {
        exitType: trailing ? "TRAIL" : "STOP",
        exitPrice: px,
        holdingDays: j - startIdx,
        result: "LOSS",
        R: (px - entry) / risk,
        returnPct: ((px - entry) / entry) * 100,
      };
    }

    // If not trailing yet and we hit target → enable trailing on this bar
    if (!trailing && bar.high >= target) {
      trailing = true;
      const atr = simpleATR14(candles, j);
      const ma25 = simpleMA(candles, j, 25);
      const swing = lastSwingLow(candles, j, 8);
      const cand = Math.max(swing - 0.5 * atr, ma25 - 0.6 * atr, stopInit);
      trailStop = Math.max(trailStop, cand);

      // Same-bar fall through the new trail?
      if (bar.low <= trailStop) {
        return {
          exitType: "TRAIL",
          exitPrice: trailStop,
          holdingDays: j - startIdx,
          result: trailStop >= entry ? "WIN" : "LOSS",
          R: (trailStop - entry) / risk,
          returnPct: ((trailStop - entry) / entry) * 100,
        };
      }
    }

    // Already trailing — update trail and check break
    if (trailing) {
      const atr = simpleATR14(candles, j);
      const ma25 = simpleMA(candles, j, 25);
      const swing = lastSwingLow(candles, j, 8);
      const cand = Math.max(swing - 0.5 * atr, ma25 - 0.6 * atr, stopInit);
      trailStop = Math.max(trailStop, cand);

      if (bar.low <= trailStop) {
        return {
          exitType: "TRAIL",
          exitPrice: trailStop,
          holdingDays: j - startIdx,
          result: trailStop >= entry ? "WIN" : "LOSS",
          R: (trailStop - entry) / risk,
          returnPct: ((trailStop - entry) / entry) * 100,
        };
      }
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

/* ----------- NORMALIZER: collapse verbose reasons into buckets ----------- */
function normalizeRejectedReason(reasonRaw) {
  if (!reasonRaw) return "unspecified";
  let r = String(reasonRaw).trim();
  r = r.replace(/^DIP not ready:\s*/i, "");
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
  if (/^DIP blocked \(Perfect gate\)/i.test(r)) return "perfect-mode gate";
  if (/^DIP guard veto:/i.test(reasonRaw)) return "guard veto";
  if (/^DIP RR too low:/i.test(reasonRaw)) return "RR too low";
  r = r.replace(/\([^)]*\)/g, "");
  r = r.replace(/\s{2,}/g, " ").trim();
  return r.toLowerCase();
}

/* ---------------- Sentiment combo aggregation ---------------- */
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

/**
 * Backtest (swing period) — DIP only (TRAIL after target).
 * opts:
 *   { months=6, from, to, limit=0, warmupBars=60, holdBars=10, cooldownDays=5,
 *     appendTickers?: string[],
 *     targetTradesPerDay?: number,
 *     countBlockedSignals?: boolean,
 *     includeByTicker?: boolean,
 *     simulateRejectedBuys?: boolean,     // default true
 *     topRejectedReasons?: number,        // default 12
 *     examplesCap?: number                // default 5
 *   }
 */
async function runBacktest(tickersOrOpts, maybeOpts) {
  let tickers = Array.isArray(tickersOrOpts) ? tickersOrOpts : [];
  const opts = Array.isArray(tickersOrOpts)
    ? maybeOpts || {}
    : tickersOrOpts || {};

  const INCLUDE_BY_TICKER = !!opts.includeByTicker;
  const SIM_REJECTED = opts.simulateRejectedBuys ?? true;
  const TOP_K = Number.isFinite(opts.topRejectedReasons)
    ? Math.max(1, opts.topRejectedReasons)
    : 12;
  const EX_CAP = Number.isFinite(opts.examplesCap) ? opts.examplesCap : 5;

  const months = Number.isFinite(opts.months) ? Number(opts.months) : 6;
  const to = opts.to ? new Date(opts.to) : new Date();
  const from = opts.from
    ? new Date(opts.from)
    : new Date(to.getFullYear(), to.getMonth() - months, to.getDate()));
  const FROM = new Date(from).toISOString().slice(0, 10);
  const TO = new Date(to).toISOString().slice(0, 10);

  // --- Regime benchmark (MUST be inside runBacktest, AFTER FROM/TO) ---
  let benchCandles = [];
  let benchIdx = new Map();
  if (USE_REGIME) {
    benchCandles = await fetchHistory(REGIME_TICKER, FROM, TO);
    benchIdx = new Map(benchCandles.map((b, i) => [toISO(b.date), i]));
  }
  function isGreen(bar) {
    return Number(bar.close) > Number(bar.open);
  }
  // true = good tape (easier RR); false = bad tape (stricter RR); null = no signal
  function getRegimeFlagForDate(dateISO) {
    if (!USE_REGIME) return null;
    const i = benchIdx.get(dateISO);
    if (i == null || i < 3) return null; // need 3 prior days
    const d0 = benchCandles[i];
    const d1 = benchCandles[i - 1];
    const d2 = benchCandles[i - 2];
    const d3 = benchCandles[i - 3];
    if (!d0 || !d1 || !d2 || !d3) return null;
    const threeGreen = isGreen(d1) && isGreen(d2) && isGreen(d3);
    const openStrong = Number(d0.open) >= Number(d1.close);
    return threeGreen && openStrong;
  }

  const limit = Number(opts.limit) || 0;
  const WARMUP = Number.isFinite(opts.warmupBars) ? opts.warmupBars : 60;
  const HOLD_BARS = Number.isFinite(opts.holdBars) ? opts.holdBars : 10; // kept for logs/compat
  const COOLDOWN = Number.isFinite(opts.cooldownDays) ? opts.cooldownDays : 5;

  const append = Array.isArray(opts.appendTickers) ? opts.appendTickers : [];
  if (!tickers.length) tickers = allTickers.map((t) => t.code);
  tickers = [...new Set([...tickers, ...append])];
  if (limit > 0) tickers = tickers.slice(0, limit);

  const codes = tickers.map((c) =>
    c.endsWith(".T")
      ? c.toUpperCase()
      : `${String(c).toUpperCase().replace(/\..*$/, "")}.T`
  );

  // Diagnostics
  const byTicker = [];
  const globalTrades = [];
  const tradingDays = new Set();

  let signalsTotal = 0;
  let signalsAfterWarmup = 0;
  let signalsWhileFlat = 0;
  let signalsInvalid = 0;
  let signalsRiskBad = 0;
  let signalsExecuted = 0;

  let blockedInTrade = 0;
  let blockedCooldown = 0;
  let blockedWarmup = 0;
  let blockedBySentiment_DIP = 0;

  const COUNT_BLOCKED = !!opts.countBlockedSignals;

  // -------- Telemetry aggregation (compact) --------
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
    rr: {
      rejected: {},
      accepted: {},
    },
    examples: {
      buyNow: [],
      rejected: [],
    },
  };
  const EXAMPLE_MAX = 5;

  // -------- Parallel results (buyNow=false counterfactuals) --------
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

  // -------- Sentiment combo aggregation --------
  const sentiment = {
    actual: Object.create(null),
    rejected: Object.create(null),
    bestByWinRate: { actual: [], rejected: [] },
  };

  let globalOpenPositions = 0;

  console.log(
    `[BT] window ${FROM}→${TO} | hold=${HOLD_BARS} bars (ignored for exit) | warmup=${WARMUP} | cooldown=${COOLDOWN} | strategy=DIP (TRAIL after target)`
  );
  console.log(`[BT] total stocks: ${codes.length}`);

  const pct = (n) => Math.round(n * 100) / 100;

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
      let open = null;
      let cooldownUntil = -1;

      for (let i = 0; i < candles.length; i++) {
        const today = candles[i];
        tradingDays.add(toISO(today.date));
        const hist = candles.slice(0, i + 1);

        const stock = {
          ticker: code,
          currentPrice: today.close,
          highPrice: today.high,
          lowPrice: today.low,
          openPrice: today.open,
          prevClosePrice: candles[i - 1]?.close ?? today.close,
          fiftyTwoWeekHigh: Math.max(...hist.map((c) => c.high)),
          fiftyTwoWeekLow: Math.min(...hist.map((c) => c.low)),
          historicalData: hist,
        };
        enrichForTechnicalScore(stock);

        // blocker counters
        if (open) blockedInTrade++;
        else if (i <= cooldownUntil) blockedCooldown++;
        else if (i < WARMUP) blockedWarmup++;

        // ---------------- Manage open position (STOP / TRAIL) ----------------
        if (open) {
          let exit = null;

          // Conservative: hard stop always first
          if (today.low <= open.stop) {
            exit = { type: open.trailing ? "TRAIL" : "STOP", price: open.stop, result: "LOSS" };
          } else {
            // If not trailing yet and target touched today, enable trailing
            if (!open.trailing && today.high >= open.target) {
              open.trailing = true;
              // initialize trail on this bar using orchestrator-style rule
              const atr = Number(stock.atr14) || Math.max(today.close * 0.005, 1e-6);
              const ma25 = Number(stock.movingAverage25d) || simpleMA(candles, i, 25);
              const swing = lastSwingLow(candles, i, 8);
              const cand = Math.max(swing - 0.5 * atr, ma25 - 0.6 * atr, open.stopInit);
              open.trailStop = Math.max(open.stop, Math.round(cand));
            }

            // Update trailing stop if trailing
            if (open.trailing) {
              const atr = Number(stock.atr14) || Math.max(today.close * 0.005, 1e-6);
              const ma25 = Number(stock.movingAverage25d) || simpleMA(candles, i, 25);
              const swing = lastSwingLow(candles, i, 8);
              const cand = Math.max(swing - 0.5 * atr, ma25 - 0.6 * atr, open.stopInit);
              const newTrail = Math.round(Math.max(open.stopInit, cand));
              open.trailStop = Math.max(open.trailStop || open.stop, newTrail);
              // The active stop while trailing is the trail
              open.stop = open.trailStop;

              // Check break of trail in this bar
              if (today.low <= open.trailStop) {
                exit = { type: "TRAIL", price: open.trailStop, result: open.trailStop >= open.entry ? "WIN" : "LOSS" };
              }
            }
          }

          if (exit) {
            const pctRet =
              ((exit.price - open.entry) / Math.max(1e-9, open.entry)) * 100;
            const risk = Math.max(0.01, open.entry - open.stopInit);
            const trade = {
              ticker: code,
              strategy: "DIP",
              entryDate: toISO(candles[open.entryIdx].date),
              exitDate: toISO(today.date),
              holdingDays: i - open.entryIdx,
              entry: r2(open.entry),
              exit: r2(exit.price),
              stop: open.stopInit,
              target: open.target,
              result: exit.result,
              exitType: exit.type, // STOP or TRAIL
              R: r2((exit.price - open.entry) / risk),
              returnPct: r2(pctRet),
              ST: open.ST,
              LT: open.LT,
            };
            trades.push(trade);
            globalTrades.push(trade);

            // sentiment aggregation (actual lane)
            const k = sentiKey(open.ST, open.LT);
            if (!sentiment.actual[k]) sentiment.actual[k] = sentiInit();
            sentiUpdate(sentiment.actual[k], {
              result: trade.result,
              returnPct: trade.returnPct,
              R: trade.R,
            });

            open = null;
            cooldownUntil = i + COOLDOWN;
          }
        }

        // ---------------- Look for entry (eligible state) ----------------
        const eligible = !open && i >= WARMUP && i > cooldownUntil;

        if (eligible) {
          const todayISO = toISO(today.date);
          const regimeGood = getRegimeFlagForDate(todayISO); // true/false/null

          const sig = analyzeSwingTradeEntry(
            stock,
            hist,
            { debug: true, debugLevel: "verbose" },
            regimeGood
          );

          // compute sentiment once here so both lanes use the same snapshot
          const senti = getComprehensiveMarketSentiment(stock, hist);
          const ST = senti?.shortTerm?.score ?? 4;
          const LT = senti?.longTerm?.score ?? 4;

          // --- Telemetry: trend observed
          const trend = sig?.debug?.ms?.trend;
          if (trend && telemetry.trends.hasOwnProperty(trend))
            telemetry.trends[trend]++;

          if (sig?.buyNow) {
            // DIP — gate by ST/LT before entering
            signalsTotal++;
            signalsAfterWarmup++;
            signalsWhileFlat++;

            if (!shouldAllowDIP(ST, LT)) {
              blockedBySentiment_DIP++;
              continue;
            }

            const stop = Number(sig.smartStopLoss ?? sig.stopLoss);
            const target = Number(sig.smartPriceTarget ?? sig.priceTarget);

            if (!Number.isFinite(stop) || !Number.isFinite(target)) {
              signalsInvalid++;
              continue;
            }
            if (stop >= today.close) {
              signalsRiskBad++;
              continue;
            }

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

            open = {
              entryIdx: i,
              entry: today.close,
              stop: Math.round(stop),
              stopInit: Math.round(stop),
              target: Math.round(target),
              ST,
              LT,
              trailing: false,
              trailStop: null,
            };
            signalsExecuted++;
          } else {
            // --- Telemetry: why not?
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
                if (r.startsWith("DIP guard veto:")) {
                  const reason = extractGuardReason(r);
                  inc(telemetry.dip.guardVetoReasons, reason || "guard");
                }
                if (r.startsWith("DIP RR too low:")) {
                  const m = r.match(/need\s+([0-9.]+)/i);
                  const need = m ? parseFloat(m[1]) : NaN;
                  inc(telemetry.rr.rejected, bucketize(need));
                }
              }
            }

            // ----- PARALLEL: simulate buyNow === false as if we entered anyway (TRAIL after target) -----
            if (SIM_REJECTED) {
              const entry = today.close;
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

                // sentiment aggregation (rejected lane)
                const k = sentiKey(ST, LT);
                if (!sentiment.rejected[k]) sentiment.rejected[k] = sentiInit();
                if (outcome.result !== "OPEN") {
                  sentiUpdate(sentiment.rejected[k], outcome);
                }

                if (outcome.result !== "OPEN") {
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
                    if (parallel.rejectedBuys.examples[key].length < EX_CAP) {
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
          const sig = analyzeSwingTradeEntry(stock, hist, {
            debug: true,
            debugLevel: "verbose",
          });
          if (sig?.buyNow) {
            signalsTotal++;
            if (i >= WARMUP) signalsAfterWarmup++;
          }
        }
      } // end bars loop

      if (open) {
        globalOpenPositions++;
      }

      const tStops = trades.filter((x) => x.exitType === "STOP").length;
      const tTrails = trades.filter((x) => x.exitType === "TRAIL").length;
      const tTargets = trades.filter((x) => x.exitType === "TARGET").length; // should be 0 now
      const tTimes = trades.filter((x) => x.exitType === "TIME").length; // should be 0

      if (INCLUDE_BY_TICKER) {
        byTicker.push({
          ticker: code,
          trades,
          counts: { target: tTargets, stop: tStops, trail: tTrails, time: tTimes },
          openAtEnd: !!open,
        });
      }

      const total = globalTrades.length;
      const winsSoFar = globalTrades.filter((x) => x.result === "WIN").length;
      const winRateSoFar = total ? pct((winsSoFar / total) * 100) : 0;
      const avgRetSoFar = total
        ? pct(globalTrades.reduce((a, b) => a + (b.returnPct || 0), 0) / total)
        : 0;

      console.log(
        `[BT] finished ${ti + 1}/${codes.length}: ${code} | finished stocks=${
          ti + 1
        } | current avg win=${winRateSoFar}% | current avg return=${avgRetSoFar}% | ticker exits — trail:${tTrails} stop:${tStops} target:${tTargets} time:${tTimes} | openAtEnd=${!!open}`
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
  const winRate = totalTrades ? pct((wins / totalTrades) * 100) : 0;
  const avgReturnPct = totalTrades
    ? pct(all.reduce((a, b) => a + (b.returnPct || 0), 0) / totalTrades)
    : 0;
  const avgHoldingDays = totalTrades
    ? pct(all.reduce((a, b) => a + (b.holdingDays || 0), 0) / totalTrades)
    : 0;

  // exits
  const hitTargetCount = all.filter((t) => t.exitType === "TARGET").length; // should be 0 now
  const hitStopCount = all.filter((t) => t.exitType === "STOP").length;
  const trailExitCount = all.filter((t) => t.exitType === "TRAIL").length;
  const timeExitCount = all.filter((t) => t.exitType === "TIME").length; // 0
  const timeExitWins = all.filter(
    (t) => t.exitType === "TIME" && t.result === "WIN"
  ).length; // 0
  const timeExitLosses = all.filter(
    (t) => t.exitType === "TIME" && t.result === "LOSS"
  ).length; // 0

  // throughput
  const days = tradingDays.size;
  const tradesPerDay = days ? totalTrades / days : 0;
  const targetTPD =
    Number.isFinite(opts.targetTradesPerDay) && opts.targetTradesPerDay > 0
      ? Number(opts.targetTradesPerDay)
      : null;

  // ---- finalize & TRIM parallel aggregates ----
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

  // ---- finalize sentiment tables ----
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

  // ---- logs ----
  console.log(
    `[BT] COMPLETE | trades=${totalTrades} | winRate=${winRate}% | avgReturn=${avgReturnPct}% | avgHold=${avgHoldingDays} bars | exits — trail:${trailExitCount} stop:${hitStopCount} target:${hitTargetCount} time:${timeExitCount} (win:${timeExitWins}/loss:${timeExitLosses}) | openAtEnd=${globalOpenPositions}`
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

  const result = {
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
      trail: trailExitCount,
      time: timeExitCount,
      timeWins: timeExitWins,
      timeLosses: timeExitLosses,
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
      dip: computeMetrics(all),
    },
    telemetry,
    parallel,
    sentiment: {
      actual: sentiActual.combos,
      rejected: sentiRejected.combos,
      bestByWinRate: sentiment.bestByWinRate,
    },
    ...(INCLUDE_BY_TICKER ? { byTicker } : {}),
  };

  return result;
}

/* ------------------------ Metrics Helpers & Logs ------------------------ */
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

  const exits = {
    target: trades.filter((t) => t.exitType === "TARGET").length,
    stop: trades.filter((t) => t.exitType === "STOP").length,
    trail: trades.filter((t) => t.exitType === "TRAIL").length,
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

/* --------------------------- Expose for Bubble -------------------------- */
window.backtest = async (tickersOrOpts, maybeOpts) => {
  try {
    return await runBacktest(tickersOrOpts, maybeOpts);
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
      exitCounts: { target: 0, stop: 0, trail: 0, time: 0, timeWins: 0, timeLosses: 0 },
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
      ...(!!(
        maybeOpts?.includeByTicker ||
        (typeof tickersOrOpts === "object" && tickersOrOpts?.includeByTicker)
      )
        ? { byTicker: [] }
        : {}),
      error: String(e?.message || e),
    };
  }
};
