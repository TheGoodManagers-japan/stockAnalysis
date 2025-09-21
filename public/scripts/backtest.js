// /scripts/backtest.js — swing-period backtest (browser) with breakout simulation & strategy comparison
// DIP: enter on buyNow=true; BO: place stop-(market|limit) and fill on trigger; exit on stop/target/time-limit.
// NOTE: Breakouts are ALWAYS ENABLED in this build. ST/LT sentiment gating happens here (no changes to analyzers).

import { analyzeSwingTradeEntry } from "./swingTradeEntryTiming.js";
import { enrichForTechnicalScore } from "./main.js";
import { allTickers } from "./tickers.js";
import { getComprehensiveMarketSentiment } from "./marketSentimentOrchestrator.js";

const API_BASE =
  "https://stock-analysis-thegoodmanagers-japan-aymerics-projects-60f33831.vercel.app";
const toISO = (d) => new Date(d).toISOString().slice(0, 10);
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/* ---------------- Small helpers for telemetry aggregation ---------------- */
const add = (obj, key, inc = 1) => {
  if (!key && key !== 0) return;
  const k = String(key);
  obj[k] = (obj[k] || 0) + inc;
};
const pushIf = (arr, v) => {
  if (v !== undefined) arr.push(v);
};
const mean = (arr) =>
  arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
const pct = (n) => Math.round(n * 100) / 100;
const bucket = (x, edges) => {
  // returns a label like "<=1.0", "(1.0,2.0]", ">5.0"
  if (!Number.isFinite(x)) return "NaN";
  for (let i = 0; i < edges.length; i++) {
    if (x <= edges[i]) return `<=${edges[i]}`;
  }
  return `>${edges[edges.length - 1]}`;
};

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
function shouldAllow(kind, ST, LT) {
  const st = Number.isFinite(ST) ? ST : 4;
  const lt = Number.isFinite(LT) ? LT : 4;

  if (kind === "BO") {
    return lt <= 7 && st >= 1 && st <= 7;
  }
  return lt <= 7 && st >= 1 && st <= 7;
}

/* ============================ Telemetry containers ============================ */
function makeAgg() {
  return {
    signalsSeen: 0, // total calls to analyzer in eligible states
    signalsBuyNow: 0, // how many returned buyNow=true (before st/lt gate)
    reasons: {}, // text reasons histogram (from analyze outcome list)
    gates: {
      // pass/fail tallies
      priceAction: { pass: 0, fail: 0 },
      structure: { pass: 0, fail: 0 },
      stacked: { pass: 0, fail: 0 },
    },
    dip: {
      triggered: 0,
      notReady: 0,
      waitReasons: {}, // DIP-specific waitReason histogram
      checks: {}, // optional stage flags if dip.js exposes diagnostics.checks
    },
    rr: {
      checked: 0,
      acceptable: 0,
      rejected: 0,
      ratioDist: {}, // buckets of rr.ratio
      needDist: {}, // buckets of rr.need
      riskDist: {}, // buckets of rr.risk (absolute)
      rewardDist: {}, // buckets of rr.reward (absolute)
      ratios: [], // raw numbers (for mean)
      needs: [],
    },
    guard: {
      checked: 0,
      veto: 0,
      ok: 0,
      reasons: {}, // veto reason histogram
      rsiOnVeto: [], // sample RSI when vetoed
      headroomATR_onVeto: [], // sample headroom when vetoed
      distMA25_onVeto: [], // sample distFromMA25_ATR when vetoed
    },
    // optional per-signal log for debugging (kept small)
    signals: [], // populated only if keepSignals=true
  };
}
function tallyTelemetry(agg, ticker, isoDate, tele, keepSignals = false) {
  if (!tele || typeof tele !== "object") return;

  agg.signalsSeen++;

  // Gates
  const g = tele.gates || {};
  const bump = (gate, pass) => {
    if (!gate || !agg.gates[gate]) return;
    if (pass) agg.gates[gate].pass++;
    else agg.gates[gate].fail++;
  };
  bump("priceAction", !!g.priceAction?.pass);
  bump("structure", !!g.structure?.pass);
  bump("stacked", !!g.stacked?.pass);

  // DIP
  if (tele.dip) {
    if (tele.dip.trigger) agg.dip.triggered++;
    else {
      agg.dip.notReady++;
      add(agg.dip.waitReasons, tele.dip.waitReason || "unknown");
    }
    // optional stage flags from dip.diagnostics.checks (if you added them)
    const checks = tele.dip.diagnostics?.checks || {};
    for (const [k, v] of Object.entries(checks)) {
      const kk = `check:${k}:${v ? "pass" : "fail"}`;
      add(agg.dip.checks, kk);
    }
  }

  // RR
  if (tele.rr?.checked) {
    agg.rr.checked++;
    if (tele.rr.acceptable) {
      agg.rr.acceptable++;
    } else {
      agg.rr.rejected++;
    }
    const ratio = Number(tele.rr.ratio);
    const need = Number(tele.rr.need);
    const risk = Number(tele.rr.risk);
    const reward = Number(tele.rr.reward);
    add(agg.rr.ratioDist, bucket(ratio, [1.0, 1.2, 1.4, 1.6, 2.0, 3.0]));
    add(agg.rr.needDist, bucket(need, [1.1, 1.2, 1.3, 1.5, 2.0, 3.0]));
    add(agg.rr.riskDist, bucket(risk, [0.25, 0.5, 0.75, 1.0, 1.5, 2.0]));
    add(agg.rr.rewardDist, bucket(reward, [0.5, 1.0, 1.5, 2.0, 3.0, 5.0]));
    pushIf(agg.rr.ratios, Number.isFinite(ratio) ? ratio : undefined);
    pushIf(agg.rr.needs, Number.isFinite(need) ? need : undefined);
  }

  // Guard veto
  if (tele.guard?.checked) {
    agg.guard.checked++;
    if (tele.guard.veto) {
      agg.guard.veto++;
      add(agg.guard.reasons, tele.guard.reason || "unknown");
      const d = tele.guard.details || {};
      pushIf(agg.guard.rsiOnVeto, Number.isFinite(d.rsi) ? d.rsi : undefined);
      pushIf(
        agg.guard.headroomATR_onVeto,
        Number.isFinite(d.headroomATR) ? d.headroomATR : undefined
      );
      pushIf(
        agg.guard.distMA25_onVeto,
        Number.isFinite(d.distFromMA25_ATR) ? d.distFromMA25_ATR : undefined
      );
    } else {
      agg.guard.ok++;
    }
  }

  // Outcome reasons (human-readable)
  if (Array.isArray(tele.reasons)) {
    tele.reasons.forEach((r) => add(agg.reasons, r));
  }

  // Lightweight per-signal log (optional)
  if (keepSignals) {
    agg.signals.push({
      ticker,
      date: isoDate,
      buyNow: !!tele.outcome?.buyNow,
      reason: tele.outcome?.reason || "",
      gates: {
        priceAction: !!g.priceAction?.pass,
        structure: !!g.structure?.pass,
        stacked: !!g.stacked?.pass,
      },
      dip: {
        trigger: !!tele.dip?.trigger,
        waitReason: tele.dip?.waitReason || "",
      },
      rr: tele.rr?.checked
        ? {
            acceptable: !!tele.rr.acceptable,
            ratio: tele.rr.ratio,
            need: tele.rr.need,
            risk: tele.rr.risk,
            reward: tele.rr.reward,
          }
        : null,
      guard: tele.guard?.checked
        ? { veto: !!tele.guard.veto, reason: tele.guard.reason || "" }
        : null,
    });
  }

  if (tele.outcome?.buyNow) agg.signalsBuyNow++;
}

/**
 * Backtest (swing period).
 * opts:
 *   { months=6, from, to, limit=0, warmupBars=60, holdBars=10, cooldownDays=10,
 *     appendTickers?: string[],
 *     targetTradesPerDay?: number,
 *     countBlockedSignals?: boolean,
 *     keepSignals?: boolean,           // NEW: keep per-signal rows in the result
 *     // Breakouts are ALWAYS enabled in this build:
 *     boMaxAgeBars?: number,           // default: 15
 *     boUseLimit?: boolean,            // default: false (stop-market)
 *     boSlipTicks?: number,            // default: 0.006 (limit mode only)
 *     boGapCapPct?: number }           // default: 0.010 = 1% max gap for market fills
 */
async function runBacktest(tickersOrOpts, maybeOpts) {
  let tickers = Array.isArray(tickersOrOpts) ? tickersOrOpts : [];
  const opts = Array.isArray(tickersOrOpts)
    ? maybeOpts || {}
    : tickersOrOpts || {};

  const months = Number.isFinite(opts.months) ? Number(opts.months) : 6;
  const to = opts.to ? new Date(opts.to) : new Date();
  const from = opts.from
    ? new Date(opts.from)
    : new Date(to.getFullYear(), to.getMonth() - months, to.getDate());
  const FROM = new Date(from).toISOString().slice(0, 10);
  const TO = new Date(to).toISOString().slice(0, 10);

  const limit = Number(opts.limit) || 0;
  const WARMUP = Number.isFinite(opts.warmupBars) ? opts.warmupBars : 60;
  const HOLD_BARS = Number.isFinite(opts.holdBars) ? opts.holdBars : 10;
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

  // Breakout execution options (ALWAYS ON)
  const ENABLE_BO = false;
  const BO_MAX_AGE = Number.isFinite(opts.boMaxAgeBars)
    ? opts.boMaxAgeBars
    : 15;
  const BO_USE_LIMIT = !!opts.boUseLimit; // default false (use stop-market)
  const BO_SLIP_TICKS = Number.isFinite(opts.boSlipTicks)
    ? opts.boSlipTicks
    : 0.006; // only used if limit enabled
  const BO_GAP_CAP = Number.isFinite(opts.boGapCapPct)
    ? opts.boGapCapPct
    : 0.01; // 1% max allowable gap for market fills

  // Diagnostics
  const byTicker = [];
  const globalTrades = [];
  const tradingDays = new Set();

  // NEW telemetry aggregates (global + per-ticker)
  const aggGlobal = makeAgg();

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
  let blockedBySentiment_BO = 0;

  const COUNT_BLOCKED = !!opts.countBlockedSignals;
  const KEEP_SIGNALS = !!opts.keepSignals;

  // Breakout diagnostics
  let boPlanned = 0;
  let boFilled = 0;
  let boExpired = 0;
  let boMissedLimit = 0;
  let boReplaced = 0;
  let boGapTooWide = 0;

  console.log(
    `[BT] window ${FROM}→${TO} | hold=${HOLD_BARS} bars | warmup=${WARMUP} | cooldown=${COOLDOWN} | breakouts=ON (${
      BO_USE_LIMIT ? "stop-limit" : "stop-market"
    })`
  );
  console.log(`[BT] total stocks: ${codes.length}`);

  for (let ti = 0; ti < codes.length; ti++) {
    const code = codes[ti];
    console.log(`[BT] processing stock ${ti + 1}/${codes.length}: ${code}`);

    // per-ticker telemetry
    const aggTicker = makeAgg();

    try {
      const candles = await fetchHistory(code, FROM, TO);
      if (candles.length < WARMUP + 2) {
        byTicker.push({
          ticker: code,
          trades: [],
          error: "not enough data",
          telemetry: aggTicker,
        });
        console.log(
          `[BT] finished ${ti + 1}/${codes.length}: ${code} (not enough data)`
        );
        continue;
      }

      const trades = [];
      let open = null;
      let cooldownUntil = -1;

      /** @type {{trigger:number, limit:number, stop:number, target:number, createdIdx:number, age:number} | null} */
      let pendingBO = null;

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

        // --- Handle pending breakout before seeking new signals (unchanged)
        if (!open && pendingBO) {
          pendingBO.age++;

          if (today.high >= pendingBO.trigger) {
            const fillIfTriggered =
              today.open >= pendingBO.trigger ? today.open : pendingBO.trigger;

            if (!BO_USE_LIMIT) {
              const gapPct =
                (fillIfTriggered - pendingBO.trigger) /
                Math.max(1e-9, pendingBO.trigger);
              if (gapPct > BO_GAP_CAP) {
                boGapTooWide++;
                console.log(
                  `[BT][BO] gap too wide ${code} (gap ${(gapPct * 100).toFixed(
                    2
                  )}% > cap ${(BO_GAP_CAP * 100).toFixed(2)}%)`
                );
                pendingBO = null;
              } else {
                const senti = getComprehensiveMarketSentiment(stock, hist);
                const ST = senti?.shortTerm?.score ?? 4;
                const LT = senti?.longTerm?.score ?? 4;
                if (!shouldAllow("BO", ST, LT)) {
                  blockedBySentiment_BO++;
                  pendingBO = null;
                } else {
                  open = {
                    entryIdx: i,
                    entry: r2(fillIfTriggered),
                    stop: Math.round(pendingBO.stop),
                    stopInit: Math.round(pendingBO.stop),
                    target: Math.round(pendingBO.target),
                    strategy: "BO",
                  };
                  boFilled++;
                  console.log(
                    `[BT][BO] fill  ${code} @${open.entry.toFixed(
                      2
                    )} (trigger ${pendingBO.trigger.toFixed(2)} | stop-market)`
                  );
                  pendingBO = null;
                }
              }
            } else {
              const lim = pendingBO.limit;
              if (Number.isFinite(lim) && fillIfTriggered > lim) {
                boMissedLimit++;
                console.log(
                  `[BT][BO] miss  ${code} (open ${fillIfTriggered.toFixed(
                    2
                  )} > limit ${lim.toFixed(2)})`
                );
                pendingBO = null;
              } else {
                const senti = getComprehensiveMarketSentiment(stock, hist);
                const ST = senti?.shortTerm?.score ?? 4;
                const LT = senti?.longTerm?.score ?? 4;
                if (!shouldAllow("BO", ST, LT)) {
                  blockedBySentiment_BO++;
                  pendingBO = null;
                } else {
                  const actualFill =
                    today.open >= pendingBO.trigger
                      ? Math.min(today.open, lim)
                      : pendingBO.trigger;

                  open = {
                    entryIdx: i,
                    entry: r2(actualFill),
                    stop: Math.round(pendingBO.stop),
                    stopInit: Math.round(pendingBO.stop),
                    target: Math.round(pendingBO.target),
                    strategy: "BO",
                  };
                  boFilled++;
                  console.log(
                    `[BT][BO] fill  ${code} @${open.entry.toFixed(
                      2
                    )} (trigger ${pendingBO.trigger.toFixed(2)} | stop-limit)`
                  );
                  pendingBO = null;
                }
              }
            }
          } else if (pendingBO.age > BO_MAX_AGE) {
            boExpired++;
            console.log(`[BT][BO] expire ${code} after ${BO_MAX_AGE} bars`);
            pendingBO = null;
          }
        }

        // manage open (stop → target → time exit)
        if (open) {
          const daysHeld = i - open.entryIdx;
          let exit = null;

          if (today.low <= open.stop) {
            exit = { type: "STOP", price: open.stop, result: "LOSS" };
          } else if (today.high >= open.target) {
            exit = { type: "TARGET", price: open.target, result: "WIN" };
          } else if (daysHeld >= HOLD_BARS) {
            exit = {
              type: "TIME",
              price: today.close,
              result: today.close > open.entry ? "WIN" : "LOSS",
            };
          }

          if (exit) {
            const pctRet =
              ((exit.price - open.entry) / Math.max(1e-9, open.entry)) * 100;
            const risk = Math.max(0.01, open.entry - open.stopInit);
            const trade = {
              ticker: code,
              strategy: open.strategy || "DIP",
              entryDate: toISO(candles[open.entryIdx].date),
              exitDate: toISO(today.date),
              holdingDays: daysHeld,
              entry: r2(open.entry),
              exit: r2(exit.price),
              stop: open.stopInit,
              target: open.target,
              result: exit.result,
              exitType: exit.type,
              R: r2((exit.price - open.entry) / risk),
              returnPct: r2(pctRet),
            };
            trades.push(trade);
            globalTrades.push(trade);
            open = null;
            cooldownUntil = i + COOLDOWN;
          }
        }

        // look for entry (eligible state)
        const eligible = !open && i >= WARMUP && i > cooldownUntil;

        if (eligible) {
          // NOTE: analyzer now always includes a `telemetry` block
          const sig = analyzeSwingTradeEntry(stock, hist, { debug: false });
          const tele = sig?.telemetry || null;

          // tally telemetry (global + per-ticker), regardless of buyNow
          tallyTelemetry(
            aggGlobal,
            code,
            toISO(today.date),
            tele,
            KEEP_SIGNALS
          );
          tallyTelemetry(
            aggTicker,
            code,
            toISO(today.date),
            tele,
            KEEP_SIGNALS
          );

          if (sig?.buyNow) {
            // DIP — gate by ST/LT before entering
            signalsTotal++;
            signalsAfterWarmup++;
            signalsWhileFlat++;

            const senti = getComprehensiveMarketSentiment(stock, hist);
            const ST = senti?.shortTerm?.score ?? 4;
            const LT = senti?.longTerm?.score ?? 4;
            if (!shouldAllow("DIP", ST, LT)) {
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

            open = {
              entryIdx: i,
              entry: today.close,
              stop: Math.round(stop),
              stopInit: Math.round(stop),
              target: Math.round(target),
              strategy: "DIP",
            };
            signalsExecuted++;
          } else {
            // -------- PRE-BREAKOUT (CREATE/REPLACE ONLY) ---------- (unchanged)
            const trigger = Number(
              sig?.trigger ?? sig?.suggestedOrder?.trigger
            );
            const baseLimit = Number(sig?.suggestedOrder?.limit);
            const iStop = Number(
              sig?.smartStopLoss ??
                sig?.stopLoss ??
                sig?.suggestedOrder?.initialStop
            );
            const fTarget = Number(
              sig?.smartPriceTarget ??
                sig?.priceTarget ??
                sig?.suggestedOrder?.firstTarget
            );

            if (
              Number.isFinite(trigger) &&
              Number.isFinite(iStop) &&
              Number.isFinite(fTarget)
            ) {
              if (today.close >= trigger) {
                // already through; wait for next coil
              } else if (!pendingBO) {
                const senti = getComprehensiveMarketSentiment(stock, hist);
                const ST = senti?.shortTerm?.score ?? 4;
                const LT = senti?.longTerm?.score ?? 4;
                if (!shouldAllow("BO", ST, LT)) {
                  blockedBySentiment_BO++;
                } else {
                  const limit = BO_USE_LIMIT
                    ? Number.isFinite(baseLimit)
                      ? baseLimit
                      : trigger * (1 + BO_SLIP_TICKS)
                    : Infinity;

                  pendingBO = {
                    trigger,
                    limit,
                    stop: Math.round(iStop),
                    stopInit: Math.round(iStop),
                    target: Math.round(fTarget),
                    createdIdx: i,
                    age: 0,
                  };
                  boPlanned++;
                  const limMsg = BO_USE_LIMIT ? ` lim=${limit.toFixed(2)}` : "";
                  console.log(
                    `[BT][BO] place ${code} @trigger=${trigger.toFixed(
                      2
                    )}${limMsg} stop=${pendingBO.stop} tgt=${
                      pendingBO.target
                    } age=0`
                  );
                }
              } else {
                const bump = trigger - pendingBO.trigger;
                if (bump > Math.max(0.02, pendingBO.trigger * 0.002)) {
                  const senti = getComprehensiveMarketSentiment(stock, hist);
                  const ST = senti?.shortTerm?.score ?? 4;
                  const LT = senti?.longTerm?.score ?? 4;

                  if (!shouldAllow("BO", ST, LT)) {
                    blockedBySentiment_BO++;
                  } else {
                    const newLimit = BO_USE_LIMIT
                      ? Number.isFinite(baseLimit)
                        ? baseLimit
                        : trigger * (1 + BO_SLIP_TICKS)
                      : Infinity;

                    pendingBO = {
                      trigger,
                      limit: newLimit,
                      stop: Math.round(iStop),
                      stopInit: Math.round(iStop),
                      target: Math.round(fTarget),
                      createdIdx: i,
                      age: 0,
                    };
                    boReplaced++;
                    const limMsg = BO_USE_LIMIT
                      ? ` lim=${newLimit.toFixed(2)}`
                      : "";
                    console.log(
                      `[BT][BO] repl. ${code} @trigger=${trigger.toFixed(
                        2
                      )}${limMsg} stop=${pendingBO.stop} tgt=${
                        pendingBO.target
                      } age=0`
                    );
                  }
                }
              }
            }
          }
        } else if (COUNT_BLOCKED) {
          // Count buyNow signals even when we can't act,
          // and also collect telemetry to understand *why* they fired while blocked.
          const sig = analyzeSwingTradeEntry(stock, hist, { debug: false });
          const tele = sig?.telemetry || null;
          tallyTelemetry(aggGlobal, code, toISO(today.date), tele, false);
          tallyTelemetry(aggTicker, code, toISO(today.date), tele, false);

          if (sig?.buyNow) {
            signalsTotal++;
            if (i >= WARMUP) signalsAfterWarmup++;
          }
        }
      }

      // per-ticker exit counts
      const tStops = trades.filter((x) => x.exitType === "STOP").length;
      const tTargets = trades.filter((x) => x.exitType === "TARGET").length;
      const tTimes = trades.filter((x) => x.exitType === "TIME").length;

      byTicker.push({
        ticker: code,
        trades,
        counts: { target: tTargets, stop: tStops, time: tTimes },
        telemetry: aggTicker, // NEW: per-ticker telemetry summary
      });

      // running averages after finishing this ticker
      const total = globalTrades.length;
      const wins = globalTrades.filter((x) => x.result === "WIN").length;
      const winRate = total ? pct((wins / total) * 100) : 0;
      const avgRet = total
        ? pct(globalTrades.reduce((a, b) => a + (b.returnPct || 0), 0) / total)
        : 0;

      console.log(
        `[BT] finished ${ti + 1}/${codes.length}: ${code} | finished stocks=${
          ti + 1
        } | current avg win=${winRate}% | current avg return=${avgRet}% | ticker exits — target:${tTargets} stop:${tStops} time:${tTimes}`
      );
    } catch (e) {
      byTicker.push({
        ticker: code,
        trades: [],
        error: String(e?.message || e),
        telemetry: aggTicker,
      });
      console.log(
        `[BT] finished ${ti + 1}/${codes.length}: ${code} | error: ${String(
          e?.message || e
        )}`
      );
    }
  }

  // ---- final metrics ----
  const all = byTicker.flatMap((t) => t.trades);
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
  const hitTargetCount = all.filter((t) => t.exitType === "TARGET").length;
  const hitStopCount = all.filter((t) => t.exitType === "STOP").length;
  const timeExitCount = all.filter((t) => t.exitType === "TIME").length;
  const timeExitWins = all.filter(
    (t) => t.exitType === "TIME" && t.result === "WIN"
  ).length;
  const timeExitLosses = all.filter(
    (t) => t.exitType === "TIME" && t.result === "LOSS"
  ).length;

  // throughput
  const days = tradingDays.size;
  const tradesPerDay = days ? totalTrades / days : 0;
  const targetTPD =
    Number.isFinite(opts.targetTradesPerDay) && opts.targetTradesPerDay > 0
      ? Number(opts.targetTradesPerDay)
      : null;

  // ---- strategy split (DIP vs BO) ----
  const trDIP = all.filter((t) => t.strategy === "DIP");
  const trBO = all.filter((t) => t.strategy === "BO");

  const mAll = computeMetrics(all);
  const mDIP = computeMetrics(trDIP);
  const mBO = computeMetrics(trBO);

  // ---- logs ----
  console.log(
    `[BT] COMPLETE | trades=${totalTrades} | winRate=${winRate}% | avgReturn=${avgReturnPct}% | avgHold=${avgHoldingDays} bars | exits — target:${hitTargetCount} stop:${hitStopCount} time:${timeExitCount} (win:${timeExitWins}/loss:${timeExitLosses})`
  );

  console.log(
    `[BT] SIGNALS | total=${signalsTotal} | afterWarmup=${signalsAfterWarmup} | whileFlat=${signalsWhileFlat} | executed=${signalsExecuted} | invalid=${signalsInvalid} | riskStop>=px=${signalsRiskBad} | blocked: inTrade=${blockedInTrade} cooldown=${blockedCooldown} warmup=${blockedWarmup} | stlt: DIP=${blockedBySentiment_DIP} BO=${blockedBySentiment_BO}`
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

  console.log(
    `[BT][BO] SUMMARY | planned=${boPlanned} | filled=${boFilled} | expired=${boExpired} | missedLimit=${boMissedLimit} | replaced=${boReplaced} | gapTooWide=${boGapTooWide}`
  );

  // Strategy-level logs
  logStrategyStats("DIP", mDIP);
  logStrategyStats("BO ", mBO);

  // Comparison deltas (BO vs DIP)
  console.log(
    `[BT] STRATEGY Δ (BO - DIP) | winRate=${delta(
      mBO.winRate,
      mDIP.winRate
    )} pp | avgRet=${delta(mBO.avgReturnPct, mDIP.avgReturnPct)}% | PF=${delta(
      mBO.profitFactor,
      mDIP.profitFactor
    )} | ExpR=${delta(mBO.expR, mDIP.expR)} | avgHold=${delta(
      mBO.avgHoldingDays,
      mDIP.avgHoldingDays
    )} bars`
  );

  // ---- build the final diagnostic summary from telemetry ----
  const diag = {
    // high-level
    signalsSeen: aggGlobal.signalsSeen,
    signalsBuyNow: aggGlobal.signalsBuyNow,
    gates: aggGlobal.gates,
    reasonsTop: Object.entries(aggGlobal.reasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([reason, count]) => ({ reason, count })),
    dip: {
      triggered: aggGlobal.dip.triggered,
      notReady: aggGlobal.dip.notReady,
      topWaitReasons: Object.entries(aggGlobal.dip.waitReasons)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([why, count]) => ({ why, count })),
      checks: aggGlobal.dip.checks,
    },
    rr: {
      checked: aggGlobal.rr.checked,
      acceptable: aggGlobal.rr.acceptable,
      rejected: aggGlobal.rr.rejected,
      ratioDist: aggGlobal.rr.ratioDist,
      needDist: aggGlobal.rr.needDist,
      riskDist: aggGlobal.rr.riskDist,
      rewardDist: aggGlobal.rr.rewardDist,
      meanRatio: pct(mean(aggGlobal.rr.ratios)),
      meanNeed: pct(mean(aggGlobal.rr.needs)),
    },
    guard: {
      checked: aggGlobal.guard.checked,
      veto: aggGlobal.guard.veto,
      ok: aggGlobal.guard.ok,
      topReasons: Object.entries(aggGlobal.guard.reasons)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([why, count]) => ({ why, count })),
      avgRSI_onVeto: pct(mean(aggGlobal.guard.rsiOnVeto)),
      avgHeadroomATR_onVeto: pct(mean(aggGlobal.guard.headroomATR_onVeto)),
      avgDistMA25ATR_onVeto: pct(mean(aggGlobal.guard.distMA25_onVeto)),
    },
    // optional full per-signal rows (disabled by default)
    signals:
      KEEP_SIGNALS && Array.isArray(aggGlobal.signals) ? aggGlobal.signals : [],
  };

  return {
    from: FROM,
    to: TO,
    params: {
      holdBars: HOLD_BARS,
      warmupBars: WARMUP,
      cooldownDays: COOLDOWN,
      boMaxAgeBars: BO_MAX_AGE,
      boUseLimit: BO_USE_LIMIT,
      boSlipTicks: BO_SLIP_TICKS,
      boGapCapPct: BO_GAP_CAP,
      targetTradesPerDay: targetTPD,
      countBlockedSignals: COUNT_BLOCKED,
      keepSignals: KEEP_SIGNALS,
    },
    totalTrades,
    winRate,
    avgReturnPct,
    avgHoldingDays,
    tradesPerDay,
    tradingDays: days,
    exitCounts: {
      target: hitTargetCount,
      stop: hitStopCount,
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
        stlt: { dip: blockedBySentiment_DIP, bo: blockedBySentiment_BO },
      },
    },
    breakouts: {
      planned: boPlanned,
      filled: boFilled,
      expired: boExpired,
      missedLimit: boMissedLimit,
      replaced: boReplaced,
      gapTooWide: boGapTooWide,
      maxAgeBars: BO_MAX_AGE,
      useLimit: BO_USE_LIMIT,
      gapCapPct: BO_GAP_CAP,
      enabled: true,
    },
    strategy: {
      all: mAll,
      dip: mDIP,
      bo: mBO,
    },
    diagnostics: diag, // NEW: global telemetry summary
    byTicker, // includes per-ticker telemetry at byTicker[i].telemetry
  };
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
    time: trades.filter((t) => t.exitType === "TIME").length,
  };

  return {
    trades: n,
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

function logStrategyStats(label, m) {
  console.log(
    `[BT][${label}] trades=${m.trades} | winRate=${m.winRate}% | avgRet=${
      m.avgReturnPct
    }% | PF=${fmtInf(m.profitFactor)} | ExpR=${m.expR} | avgHold=${
      m.avgHoldingDays
    } bars | exits — target:${m.exits.target} stop:${m.exits.stop} time:${
      m.exits.time
    }`
  );
}

function delta(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b))
    return ("" + (a - b)).toString();
  const d = a - b;
  return `${d >= 0 ? "+" : ""}${r2(d)}`;
}

function sum(arr) {
  return arr.reduce((a, b) => a + (Number(b) || 0), 0);
}
function fmtInf(x) {
  return x === Infinity ? "∞" : String(x);
}

/* --------------------------- Expose for Bubble -------------------------- */
// Examples:
//   window.backtest().then(console.log)
//   window.backtest({ boUseLimit: true, boGapCapPct: 0.015 })
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
          stlt: { dip: 0, bo: 0 },
        },
      },
      breakouts: {
        planned: 0,
        filled: 0,
        expired: 0,
        missedLimit: 0,
        replaced: 0,
        gapTooWide: 0,
        maxAgeBars: 15,
        useLimit: false,
        gapCapPct: 0.01,
        enabled: true,
      },
      strategy: {
        all: computeMetrics([]),
        dip: computeMetrics([]),
        bo: computeMetrics([]),
      },
      diagnostics: makeAgg(), // empty telemetry structure for consistency
      byTicker: [],
      error: String(e?.message || e),
    };
  }
};
