// /scripts/backtest.js — swing-period backtest (browser) — MULTI playbooks
// Runs ALL exit profiles in parallel per signal. Enforces hard time-based exits.

import { analyzeSwingTradeEntry } from "./swingTradeEntryTiming.js";
import { enrichForTechnicalScore } from "./main.js";
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

/* ---------------- ST/LT gating policy (1..7 where 1=strong bull) ---------------- */
function shouldAllowDIP(ST, LT) {
  const st = Number.isFinite(ST) ? ST : 4;
  const lt = Number.isFinite(LT) ? LT : 4;
  return lt <= 7 && st >= 1 && st <= 7;
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
  // Generalize beyond "DIP guard veto:"
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

/**
 * Backtest (swing period) — MULTI playbooks.
 * opts:
 *   { months=6, from, to, limit=0, warmupBars=60, holdBars=10, cooldownDays=2,
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

  const INCLUDE_BY_TICKER = false;
  const INCLUDE_PROFILE_SAMPLES = !!opts.includeProfileSamples; // default off
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
  const HOLD_BARS = 20; // enforced time exit (locked to 20 bars)
  const COOLDOWN = Number.isFinite(opts.cooldownDays) ? opts.cooldownDays : 2;

  const append = Array.isArray(opts.appendTickers) ? opts.appendTickers : [];
  if (!tickers.length) tickers = allTickers.map((t) => t.code);
  tickers = [...new Set([...tickers, ...append])];
  if (limit > 0) tickers = tickers.slice(0, limit);

  const codes = tickers.map((c) =>
    c.endsWith(".T")
      ? c.toUpperCase()
      : `${String(c).toUpperCase().replace(/\..*$/, "")}.T`
  );

  // diagnostics
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

  // track how many positions remain open across all tickers at the end
  let globalOpenPositions = 0;

  console.log(
    `[BT] window ${FROM}→${TO} | hold=${HOLD_BARS} bars (HARD time-exit) | warmup=${WARMUP} | cooldown=${COOLDOWN} | strategy=MULTI (DIP/SPC/OXR/BPB/RRP)`
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
      const tradesByProfile = Object.fromEntries(
        EXIT_PROFILES.map((p) => [p.id, []])
      );
      const openByProfile = Object.create(null); // id -> open state
      const cooldownUntilByProfile = Object.create(null);
      for (const p of EXIT_PROFILES) cooldownUntilByProfile[p.id] = -1;

      // per-ticker loop
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
          // safer if no transpile:
          prevClosePrice: candles[i - 1] ? candles[i - 1].close : today.close,
          fiftyTwoWeekHigh: Math.max(...hist.map((c) => c.high)),
          fiftyTwoWeekLow: Math.min(...hist.map((c) => c.low)),
          historicalData: hist,
        };
        enrichForTechnicalScore(stock);

        // blocked counters (optional, per profile)
        if (COUNT_BLOCKED) {
          for (const p of EXIT_PROFILES) {
            if (openByProfile[p.id]) blockedInTrade++;
            else if (i <= cooldownUntilByProfile[p.id]) blockedCooldown++;
          }
          if (i < WARMUP) blockedWarmup++;
        }

        // manage open positions per profile
        for (const p of EXIT_PROFILES) {
          const st = openByProfile[p.id];
          if (!st) continue;

          // dynamic rule hook
          if (typeof p.advance === "function") {
            p.advance({ bar: today, state: st, hist, stock });

            // ensure any updated levels remain on the tick grid
            if (Number.isFinite(st.stop)) st.stop = toTick(st.stop, stock);
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

          // 2) hard time exit at HOLD_BARS (close of the current bar)
          //    If still open by bar N => exit at today's close and label by P&L
          if (!exit) {
            const ageBars = i - st.entryIdx;
            if (HOLD_BARS > 0 && ageBars >= HOLD_BARS) {
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

            openByProfile[p.id] = null;
            cooldownUntilByProfile[p.id] = i + COOLDOWN;
          }
        }

        // try new entries if any profile is free and warmup passed
        const anyProfileEligible =
          i >= WARMUP &&
          EXIT_PROFILES.some(
            (p) => !openByProfile[p.id] && i > cooldownUntilByProfile[p.id]
          );

        if (anyProfileEligible) {
          const sig = analyzeSwingTradeEntry(stock, hist, {
            debug: true,
            debugLevel: "verbose",
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
            // Gate by sentiment (kept as your original DIP policy)
            signalsTotal++;
            signalsAfterWarmup++;
            signalsWhileFlat++;

            if (!shouldAllowDIP(ST, LT)) {
              blockedBySentiment_DIP++;
              continue;
            }

            // RR telemetry (same analyzer RR for all profiles)
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

            // open one virtual trade PER profile
            for (const p of EXIT_PROFILES) {
              if (openByProfile[p.id]) continue;
              if (i <= cooldownUntilByProfile[p.id]) continue;

              const entry = today.close;
              const plan = p.compute({ entry, stock, sig, today, hist }) || {};
              const stop = Number(plan.stop);
              const target = Number(plan.target);

              if (!Number.isFinite(stop) || !Number.isFinite(target)) {
                signalsInvalid++;
                continue;
              }
              if (stop >= entry) {
                signalsRiskBad++;
                continue;
              }

              // snap execution levels to tick grid (no integer rounding)
              const qStop = toTick(stop, stock);
              const qTarget = toTick(target, stock);

              openByProfile[p.id] = {
                entryIdx: i,
                entry,
                stop: qStop,
                stopInit: qStop,
                target: qTarget,
                ST,
                LT,
                // record playbook kind for trade labeling
                kind:
                  String(sig?.debug?.chosen || sig?.reason || "")
                    .split(":")[0]
                    .trim() || "UNKNOWN",
              };
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
          // ✅ are any profiles still open for this ticker?
          openAtEnd: EXIT_PROFILES.some((p) => !!openByProfile[p.id]),
        });
      }

      // count how many profiles are still open at the end of this ticker
      const stillOpenCount = EXIT_PROFILES.reduce(
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
        } | current avg win=${winRateSoFar}% | current avg return=${avgRetSoFar}% | ticker exits — target:${tTargets} stop:${tStops} time:${tTimes}`
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

  // per-profile metrics
  const profiles = {};
  for (const p of EXIT_PROFILES) {
    const list = globalTrades.filter((t) => t.profile === p.id);
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
    },
    totalTrades,
    winRate,
    avgReturnPct,
    avgHoldingDays,
    tradesPerDay,
    tradingDays: days,
    openAtEnd: globalOpenPositions, // ✅ real count of open positions at end
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
      executed: signalsExecuted, // counts profile entries
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
      dip: dipMetrics, // legacy key
      ...strategyBreakdown, // e.g., DIP/SPC/OXR/BPB/RRP
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
    // We run a single backtest with HOLD_BARS hard-locked to 20 inside runBacktest.
    // Still pass through other options the UI may set.
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
      error: String(e?.message || e),
    };
  }
};

