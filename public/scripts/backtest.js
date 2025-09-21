// /scripts/backtest.js — swing-period backtest (browser) — DIP-only
// DIP: enter on buyNow=true; exit on stop/target/time-limit.
// ST/LT sentiment gating happens here (no changes to analyzers).

import { analyzeSwingTradeEntry } from "./swingTradeEntryTiming.js";
import { enrichForTechnicalScore } from "./main.js";
import { allTickers } from "./tickers.js";
import { getComprehensiveMarketSentiment } from "./marketSentimentOrchestrator.js";

const API_BASE =
  "https://stock-analysis-thegoodmanagers-japan-aymerics-projects-60f33831.vercel.app";
const toISO = (d) => new Date(d).toISOString().slice(0, 10);
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

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
function shouldAllowDIP(ST, LT) {
  const st = Number.isFinite(ST) ? ST : 4;
  const lt = Number.isFinite(LT) ? LT : 4;
  // Keep simple permissive policy; customize if you want to gate harder.
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
  // e.g. "DIP guard veto: Too far above MA25 (2.45 ATR > 3.3) (RSI=..., ...)."
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

/**
 * Backtest (swing period) — DIP only.
 * opts:
 *   { months=6, from, to, limit=0, warmupBars=60, holdBars=10, cooldownDays=5,
 *     appendTickers?: string[],
 *     targetTradesPerDay?: number,
 *     countBlockedSignals?: boolean,
 *     includeByTicker?: boolean        // default false
 *   }
 */
async function runBacktest(tickersOrOpts, maybeOpts) {
  let tickers = Array.isArray(tickersOrOpts) ? tickersOrOpts : [];
  const opts = Array.isArray(tickersOrOpts)
    ? maybeOpts || {}
    : tickersOrOpts || {};

  const INCLUDE_BY_TICKER = !!opts.includeByTicker;

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

  // Diagnostics
  const byTicker = []; // returned only if INCLUDE_BY_TICKER
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
      notReadyReasons: {}, // reason -> count
      guardVetoReasons: {}, // reason -> count
    },
    rr: {
      rejected: {}, // needBucket -> count
      accepted: {}, // ratioBucket -> count
    },
    examples: {
      buyNow: [], // small sample
      rejected: [], // small sample
    },
  };
  const EXAMPLE_MAX = 5;

  console.log(
    `[BT] window ${FROM}→${TO} | hold=${HOLD_BARS} bars | warmup=${WARMUP} | cooldown=${COOLDOWN} | strategy=DIP`
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
              strategy: "DIP",
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
          const sig = analyzeSwingTradeEntry(stock, hist, {
            debug: true,
            debugLevel: "verbose",
          });

          // --- Telemetry: trend observed
          const trend = sig?.debug?.ms?.trend;
          if (trend && telemetry.trends.hasOwnProperty(trend))
            telemetry.trends[trend]++;

          if (sig?.buyNow) {
            // DIP — gate by ST/LT before entering
            signalsTotal++;
            signalsAfterWarmup++;
            signalsWhileFlat++;

            const senti = getComprehensiveMarketSentiment(stock, hist);
            const ST = senti?.shortTerm?.score ?? 4;
            const LT = senti?.longTerm?.score ?? 4;
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

            // Telemetry: accepted RR bucket
            const rRatio = Number(sig?.debug?.rr?.ratio);
            inc(telemetry.rr.accepted, bucketize(rRatio));

            // Example (small sample)
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
                // DIP not ready
                if (typeof r === "string" && r.startsWith("DIP not ready:")) {
                  const why = afterColon(r, "DIP not ready:").replace(
                    /^[:\s]+/,
                    ""
                  );
                  inc(telemetry.dip.notReadyReasons, why || "unspecified");
                }
                // Structure/stacked gates
                if (r === "Structure gate: trend not up or price < MA5.") {
                  telemetry.gates.structureGateFailed++;
                }
                if (
                  r === "DIP blocked (Perfect gate): MAs not stacked bullishly."
                ) {
                  telemetry.gates.stackedGateFailed++;
                }
                // Guard veto
                if (r.startsWith("DIP guard veto:")) {
                  const reason = extractGuardReason(r);
                  inc(telemetry.dip.guardVetoReasons, reason || "guard");
                }
                // RR too low
                if (r.startsWith("DIP RR too low:")) {
                  // e.g. "... need 1.40 ..."
                  const m = r.match(/need\s+([0-9.]+)/i);
                  const need = m ? parseFloat(m[1]) : NaN;
                  inc(telemetry.rr.rejected, bucketize(need));
                }
              }
            }

            // Example rejected (small sample)
            if (telemetry.examples.rejected.length < EXAMPLE_MAX) {
              telemetry.examples.rejected.push({
                ticker: code,
                date: toISO(today.date),
                topReasons: Array.isArray(sig?.debug?.reasons)
                  ? sig.debug.reasons.slice(0, 2)
                  : [sig?.reason || ""],
              });
            }
          }
        } else if (COUNT_BLOCKED) {
          // Optional: count buyNow signals even when blocked
          const sig = analyzeSwingTradeEntry(stock, hist, {
            debug: true,
            debugLevel: "verbose",
          });
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

      if (INCLUDE_BY_TICKER) {
        byTicker.push({
          ticker: code,
          trades,
          counts: { target: tTargets, stop: tStops, time: tTimes },
        });
      }

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

  // ---- metrics log ----
  console.log(
    `[BT] COMPLETE | trades=${totalTrades} | winRate=${winRate}% | avgReturn=${avgReturnPct}% | avgHold=${avgHoldingDays} bars | exits — target:${hitTargetCount} stop:${hitStopCount} time:${timeExitCount} (win:${timeExitWins}/loss:${timeExitLosses})`
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
        stlt: { dip: blockedBySentiment_DIP },
      },
    },
    strategy: {
      all: computeMetrics(all),
      dip: computeMetrics(all), // identical (DIP-only)
    },
    telemetry, // compact, high-signal debug summary
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

function sum(arr) {
  return arr.reduce((a, b) => a + (Number(b) || 0), 0);
}

/* --------------------------- Expose for Bubble -------------------------- */
// Examples:
//   window.backtest().then(console.log)
//   window.backtest({ warmupBars: 40, cooldownDays: 2 })
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
