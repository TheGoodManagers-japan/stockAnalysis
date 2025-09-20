// /scripts/backtest.js — swing-period backtest (browser)
// No trade management; entry on buyNow=true; exit on stop/target/time-limit.

import { analyzeSwingTradeEntry } from "./swingTradeEntryTiming.js";
import { enrichForTechnicalScore } from "./main.js";
import { allTickers } from "./tickers.js";

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

/**
 * Backtest (swing period).
 * @param {string[]|object} tickersOrOpts [] or options-only
 * @param {object} [maybeOpts] if first arg is array
 * opts: { months=6, from, to, limit=0, warmupBars=60, holdBars=10, cooldownDays=10 }
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
  const COOLDOWN = Number.isFinite(opts.cooldownDays) ? opts.cooldownDays : 10;

  if (!tickers.length)
    tickers = allTickers.map((t) => t.code).slice(0, limit || undefined);
  const codes = tickers.map((c) =>
    c.endsWith(".T")
      ? c.toUpperCase()
      : `${String(c).toUpperCase().replace(/\..*$/, "")}.T`
  );

  const byTicker = [];
  const globalTrades = [];

  console.log(
    `[BT] window ${FROM}→${TO} | hold=${HOLD_BARS} bars | warmup=${WARMUP} | cooldown=${COOLDOWN}`
  );
  console.log(`[BT] total stocks: ${codes.length}`);

  const pct = (n) => Math.round(n * 100) / 100;

  for (let ti = 0; ti < codes.length; ti++) {
    const code = codes[ti];
    console.log(`[BT] processing stock ${ti + 1}/${codes.length}: ${code}`);

    try {
      const candles = await fetchHistory(code, FROM, TO);
      if (candles.length < WARMUP + 2) {
        byTicker.push({ ticker: code, trades: [], error: "not enough data" });
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
              entryDate: candles[open.entryIdx].date.toISOString().slice(0, 10),
              exitDate: today.date.toISOString().slice(0, 10),
              holdingDays: daysHeld,
              entry: Math.round(open.entry * 100) / 100,
              exit: Math.round(exit.price * 100) / 100,
              stop: open.stopInit,
              target: open.target,
              result: exit.result,
              exitType: exit.type, // <-- new
              R: Math.round(((exit.price - open.entry) / risk) * 100) / 100,
              returnPct: Math.round(pctRet * 100) / 100,
            };
            trades.push(trade);
            globalTrades.push(trade);
            open = null;
            cooldownUntil = i + COOLDOWN;
          }
        }

        // look for entry
        if (!open && i >= WARMUP && i > cooldownUntil) {
          const sig = analyzeSwingTradeEntry(stock, hist, { debug: false });
          if (sig?.buyNow) {
            const stop = Number(sig.smartStopLoss ?? sig.stopLoss);
            const target = Number(sig.smartPriceTarget ?? sig.priceTarget);
            if (
              Number.isFinite(stop) &&
              Number.isFinite(target) &&
              stop < today.close
            ) {
              open = {
                entryIdx: i,
                entry: today.close,
                stop: Math.round(stop),
                stopInit: Math.round(stop),
                target: Math.round(target),
              };
            }
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
      });
      console.log(
        `[BT] finished ${ti + 1}/${codes.length}: ${code} | error: ${String(
          e?.message || e
        )}`
      );
    }
  }

  // final summary
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

  // global exit counts
  const hitTargetCount = all.filter((t) => t.exitType === "TARGET").length;
  const hitStopCount = all.filter((t) => t.exitType === "STOP").length;
  const timeExitCount = all.filter((t) => t.exitType === "TIME").length;
  const timeExitWins = all.filter(
    (t) => t.exitType === "TIME" && t.result === "WIN"
  ).length;
  const timeExitLosses = all.filter(
    (t) => t.exitType === "TIME" && t.result === "LOSS"
  ).length;

  console.log(
    `[BT] COMPLETE | trades=${totalTrades} | winRate=${winRate}% | avgReturn=${avgReturnPct}% | avgHold=${avgHoldingDays} bars | exits — target:${hitTargetCount} stop:${hitStopCount} time:${timeExitCount} (win:${timeExitWins}/loss:${timeExitLosses})`
  );

  return {
    from: FROM,
    to: TO,
    params: { holdBars: HOLD_BARS, warmupBars: WARMUP, cooldownDays: COOLDOWN },
    totalTrades,
    winRate,
    avgReturnPct,
    avgHoldingDays,
    exitCounts: {
      target: hitTargetCount,
      stop: hitStopCount,
      time: timeExitCount,
      timeWins: timeExitWins,
      timeLosses: timeExitLosses,
    },
    byTicker,
  };
}

// Expose for Bubble
// Usage:
//   window.backtest().then(...)
//   window.backtest({ holdBars: 8, months: 3 }).then(...)
//   window.backtest(["8058","6981"]).then(...)
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
      exitCounts: { target: 0, stop: 0, time: 0, timeWins: 0, timeLosses: 0 },
      byTicker: [],
      error: String(e?.message || e),
    };
  }
};
