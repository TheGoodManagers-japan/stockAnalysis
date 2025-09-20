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
  const FROM = toISO(from),
    TO = toISO(to);

  const limit = Number(opts.limit) || 0;
  const WARMUP = Number.isFinite(opts.warmupBars) ? opts.warmupBars : 60;
  const HOLD_BARS = Number.isFinite(opts.holdBars) ? opts.holdBars : 10; // swing window in trading days
  const COOLDOWN = Number.isFinite(opts.cooldownDays) ? opts.cooldownDays : 10;

  if (!tickers.length) tickers = defaultTickerCodes(limit);
  const codes = tickers.map(normalizeCode);

  const byTicker = [];

  for (const code of codes) {
    try {
      const candles = await fetchHistory(code, FROM, TO);
      if (candles.length < WARMUP + 2) {
        byTicker.push({ ticker: code, trades: [], error: "not enough data" });
        continue;
      }

      const trades = [];
      let open = null;
      let cooldownUntil = -1;

      for (let i = 0; i < candles.length; i++) {
        const today = candles[i];
        const hist = candles.slice(0, i + 1);

        // Snapshot for entry engine
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

        // Manage open position (stop/target/time-limit)
        if (open) {
          const daysHeld = i - open.entryIdx; // trading bars since entry
          let exit = null;

          // Priority: stop first, then target, then time-limit
          if (today.low <= open.stop) {
            exit = { price: open.stop, reason: "Stop hit", result: "LOSS" };
          } else if (today.high >= open.target) {
            exit = { price: open.target, reason: "Target hit", result: "WIN" };
          } else if (daysHeld >= HOLD_BARS) {
            // Time exit at close — classify by P&L
            const price = today.close;
            exit = {
              price,
              reason: `Time exit (${HOLD_BARS} bars)`,
              result: price > open.entry ? "WIN" : "LOSS",
            };
          }

          if (exit) {
            const pct =
              ((exit.price - open.entry) / Math.max(1e-9, open.entry)) * 100;
            const risk = Math.max(0.01, open.entry - open.stopInit);
            trades.push({
              entryDate: toISO(candles[open.entryIdx].date),
              exitDate: toISO(today.date),
              holdingDays: daysHeld,
              entry: r2(open.entry),
              exit: r2(exit.price),
              stop: open.stopInit,
              target: open.target,
              result: exit.result,
              reason: exit.reason,
              R: r2((exit.price - open.entry) / risk),
              returnPct: r2(pct),
              kind: open.entryKind,
            });
            open = null;
            cooldownUntil = i + COOLDOWN;
          }
        }

        // Look for new entry
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
                entry: today.close, // fill at signal close
                stop: Math.round(stop), // fixed for this simple test
                stopInit: Math.round(stop),
                target: Math.round(target),
                entryKind: (sig.reason || "").split(":")[0].toUpperCase(),
              };
            }
          }
        }
      }

      byTicker.push({ ticker: code, trades });
    } catch (e) {
      byTicker.push({
        ticker: code,
        trades: [],
        error: String(e?.message || e),
      });
    }
  }

  // Aggregate stats
  const all = byTicker.flatMap((t) => t.trades);
  const totalTrades = all.length;
  const wins = all.filter((t) => t.result === "WIN");
  const losses = all.filter((t) => t.result === "LOSS");
  const winRate = totalTrades ? r2((wins.length / totalTrades) * 100) : 0;

  const avgReturnPct = totalTrades
    ? r2(all.reduce((a, b) => a + (b.returnPct || 0), 0) / totalTrades)
    : 0;
  const avgGainPct = wins.length
    ? r2(wins.reduce((a, b) => a + (b.returnPct || 0), 0) / wins.length)
    : 0;
  const avgLossPct = losses.length
    ? r2(losses.reduce((a, b) => a + (b.returnPct || 0), 0) / losses.length)
    : 0;
  const avgHoldingDays = totalTrades
    ? r2(all.reduce((a, b) => a + (b.holdingDays || 0), 0) / totalTrades)
    : 0;

  return {
    from: FROM,
    to: TO,
    params: { holdBars: HOLD_BARS, warmupBars: WARMUP, cooldownDays: COOLDOWN },
    totalTrades,
    winRate, // e.g., 63.0 (%)
    avgReturnPct, // e.g., +3.0 (% across all trades)
    avgGainPct, // average % of winning trades
    avgLossPct, // average % of losing trades (negative)
    avgHoldingDays, // average bars to exit
    byTicker,
  };
}

// Expose for Bubble
// Usage:
//   await window.backtest()                          // allTickers, last 6 months, holdBars=10
//   await window.backtest({ holdBars: 8, months: 3 })// custom swing window / range
//   await window.backtest(["8058","6981"])           // custom list
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
      byTicker: [],
      error: String(e?.message || e),
    };
  }
};
