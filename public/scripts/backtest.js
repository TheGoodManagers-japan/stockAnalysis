// /scripts/backtest.js (ESM, runs in the browser)
import { analyzeSwingTradeEntry } from "./swingTradeEntryTiming.js";
import {
  enrichForTechnicalScore,
  getTradeManagementSignal_V3,
} from "./main.js";
import { allTickers } from "./tickers.js"; // ← use same universe as main

const API_BASE =
  "https://stock-analysis-thegoodmanagers-japan-aymerics-projects-60f33831.vercel.app";

const toISO = (d) => new Date(d).toISOString().slice(0, 10);
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

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
 * Backtest in the browser.
 * @param {string[]|object} tickersOrOpts   [] or options-only
 * @param {object} [maybeOpts]              only if first arg is array
 *  opts: { months=6, from, to, useMgmt=false, limit=0 }
 */
async function runBacktest(tickersOrOpts, maybeOpts) {
  let tickers = Array.isArray(tickersOrOpts) ? tickersOrOpts : [];
  const opts = Array.isArray(tickersOrOpts)
    ? maybeOpts || {}
    : tickersOrOpts || {};

  // defaults
  const months = Number.isFinite(opts.months) ? Number(opts.months) : 6;
  const to = opts.to ? new Date(opts.to) : new Date();
  const from = opts.from
    ? new Date(opts.from)
    : new Date(to.getFullYear(), to.getMonth() - months, to.getDate());
  const FROM = toISO(from);
  const TO = toISO(to);
  const useMgmt = !!opts.useMgmt;
  const limit = Number(opts.limit) || 0;

  // if no tickers provided → use the same universe as main
  if (!tickers.length) {
    tickers = defaultTickerCodes(limit);
  }
  const codes = tickers.map(normalizeCode);

  // params
  const WARMUP_BARS = 60;
  const COOLDOWN_DAYS = 10;

  const byTicker = [];

  for (const code of codes) {
    try {
      const candles = await fetchHistory(code, FROM, TO);
      if (candles.length < WARMUP_BARS + 2) {
        byTicker.push({ ticker: code, trades: [], error: "not enough data" });
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

        // manage open trade
        if (open) {
          let exit = null;
          if (today.low <= open.stop) {
            exit = { price: open.stop, reason: "Stop hit" };
          } else if (today.high >= open.target) {
            if (useMgmt && !open.scaled) {
              open.scaled = true;
              open.scalePrice = open.target; // 50% at target
            } else {
              exit = { price: open.target, reason: "Target hit" };
            }
          }

          if (!exit && useMgmt) {
            const mgmt = getTradeManagementSignal_V3(
              stock,
              {
                entryPrice: open.entry,
                stopLoss: open.stop,
                priceTarget: open.target,
                initialStop: open.initialStop,
              },
              hist,
              {
                entryKind: open.entryKind,
                sentimentScore: 4,
                isExtended:
                  Number.isFinite(stock.bollingerMid) && stock.bollingerMid > 0
                    ? (stock.currentPrice - stock.bollingerMid) /
                        stock.bollingerMid >
                      0.15
                    : false,
              }
            );
            if (
              Number.isFinite(mgmt?.updatedStopLoss) &&
              mgmt.updatedStopLoss > open.stop
            ) {
              open.stop = Math.round(mgmt.updatedStopLoss);
            }
            if (!exit && mgmt?.status === "Sell Now") {
              exit = { price: today.close, reason: mgmt.reason || "Mgmt sell" };
            }
          }

          if (exit) {
            const risk = Math.max(0.01, open.entry - open.initialStop);
            let pnl;
            if (open.scaled && Number.isFinite(open.scalePrice)) {
              pnl =
                (open.scalePrice - open.entry) * 0.5 +
                (exit.price - open.entry) * 0.5;
            } else {
              pnl = exit.price - open.entry;
            }
            trades.push({
              entryDate: toISO(open.entryDate),
              exitDate: toISO(today.date),
              entry: round2(open.entry),
              exit: round2(exit.price),
              stop: open.stop,
              target: open.target,
              reason: exit.reason,
              R: round2((exit.price - open.entry) / risk),
              pnl: round2(pnl),
              scaled: !!open.scaled,
              kind: open.entryKind,
            });
            open = null;
            cooldownUntil = i + COOLDOWN_DAYS;
          }
        }

        // look for a new entry
        if (!open && i >= WARMUP_BARS && i > cooldownUntil) {
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
                entryDate: today.date,
                entry: today.close,
                stop: Math.round(stop),
                initialStop: Math.round(stop),
                target: Math.round(target),
                scaled: false,
                scalePrice: null,
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

  // aggregate
  const all = byTicker.flatMap((t) => t.trades);
  const total = all.length;
  const wins = all.filter((t) => t.pnl > 0).length;
  const winRate = total ? Math.round((wins / total) * 10000) / 100 : 0;
  const avgR = total
    ? round2(all.reduce((a, b) => a + (b.R || 0), 0) / total)
    : 0;

  return { winRate, avgR, totalTrades: total, byTicker, from: FROM, to: TO };
}

// Expose to Bubble. Call patterns:
//   await window.backtest()
//   await window.backtest(["8058","6981"])
//   await window.backtest({ months: 3, useMgmt: true, limit: 200 })
window.backtest = async (tickersOrOpts, maybeOpts) => {
  try {
    return await runBacktest(tickersOrOpts, maybeOpts);
  } catch (e) {
    console.error("[backtest] error:", e);
    return {
      winRate: 0,
      avgR: 0,
      totalTrades: 0,
      byTicker: [],
      error: String(e?.message || e),
    };
  }
};
