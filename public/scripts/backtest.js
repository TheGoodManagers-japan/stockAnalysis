// /scripts/backtest.js — ultra-simplified 36m backtest that logs one big JSON
// Adds per-ticker progress logs: after each ticker finishes you’ll see status in the console.

import { analyseCrossing } from "./swingTradeEntryTiming.js";
import { enrichForTechnicalScore, getShortLongSentiment } from "./main.js";
import { allTickers } from "./tickers.js";

const API_BASE =
  "https://stock-analysis-thegoodmanagers-japan-aymerics-projects-60f33831.vercel.app";

const toISO = (d) => new Date(d).toISOString().slice(0, 10);
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

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

async function fetchHistory(ticker, fromISO, toISOstr) {
  try {
    const r = await fetch(
      `${API_BASE}/api/history?ticker=${encodeURIComponent(ticker)}`
    );
    const text = await r.text();
    if (!r.ok) return [];
    const j = JSON.parse(text);
    if (!j?.success || !Array.isArray(j.data)) return [];
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
          (!toISOstr || d.date <= new Date(toISOstr))
      );
  } catch {
    return [];
  }
}

// ---- indicators (snapshot-at-entry only) ----
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
function rsiArr(closes, p = 14) {
  const out = new Array(closes.length).fill(NaN);
  if (closes.length <= p) return out;
  let gain = 0,
    loss = 0;
  for (let i = 1; i <= p; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }
  gain /= p;
  loss /= p;
  out[p] = 100 - 100 / (1 + (loss === 0 ? Infinity : gain / loss));
  for (let i = p + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = Math.max(ch, 0);
    const l = Math.max(-ch, 0);
    gain = (gain * (p - 1) + g) / p;
    loss = (loss * (p - 1) + l) / p;
    const rs = loss === 0 ? Infinity : gain / loss;
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}
function atrArr(candles, p = 14) {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  const out = new Array(candles.length).fill(NaN);
  const tr = (i) => {
    const h = Number(candles[i].high ?? candles[i].close ?? 0);
    const l = Number(candles[i].low ?? candles[i].close ?? 0);
    const pc = Number(candles[i - 1]?.close ?? 0);
    return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  };
  if (candles.length <= p) return out;
  let atr = 0;
  for (let i = 1; i <= p; i++) atr += tr(i);
  atr /= p;
  out[p] = atr;
  for (let i = p + 1; i < candles.length; i++) {
    atr = (out[i - 1] * (p - 1) + tr(i)) / p;
    out[i] = atr;
  }
  return out;
}
function rollingMeanStd(arr, win = 20) {
  const n = arr.length;
  const mean = new Array(n).fill(NaN);
  const stdev = new Array(n).fill(NaN);
  let sum = 0,
    sumsq = 0,
    q = [];
  for (let i = 0; i < n; i++) {
    const x = Number(arr[i]) || 0;
    q.push(x);
    sum += x;
    sumsq += x * x;
    if (q.length > win) {
      const y = q.shift();
      sum -= y;
      sumsq -= y * y;
    }
    const m = sum / q.length;
    const v = Math.max(0, sumsq / q.length - m * m);
    mean[i] = m;
    stdev[i] = Math.sqrt(v);
  }
  return { mean, stdev };
}
function computeIndicatorsAt(candles, idx, entryPx) {
  const closes = candles.map((c) => Number(c.close) || 0);
  const vols = candles.map((c) => Number(c.volume) || 0);
  const ma5 = smaArr(closes, 5);
  const ma25 = smaArr(closes, 25);
  const ma75 = smaArr(closes, 75);
  const rsi14 = rsiArr(closes, 14);
  const atr14 = atrArr(candles, 14);
  const { mean: vMean, stdev: vStd } = rollingMeanStd(vols, 20);

  const px = Number(entryPx) || closes[idx];
  const prevC = idx > 0 ? closes[idx - 1] : closes[idx];
  const m25 = Number(ma25[idx]);
  const m75 = Number(ma75[idx]);
  const rsi = Number(rsi14[idx]);
  const atr = Number(atr14[idx]) || 0;

  const atrPct = atr && px ? (atr / px) * 100 : 0;
  const vmu = Number(vMean[idx]) || 0;
  const vsd = Number(vStd[idx]) || 0;
  const vol = Number(vols[idx]) || 0;
  const volZ = vsd > 0 ? (vol - vmu) / vsd : 0;
  const gapPct = prevC ? ((px - prevC) / prevC) * 100 : 0;

  // liquidity proxy
  let avgVol20 = 0;
  {
    const start = Math.max(0, idx - 19);
    const slice = vols.slice(start, idx + 1).filter((v) => Number.isFinite(v));
    avgVol20 = slice.length
      ? slice.reduce((a, b) => a + b, 0) / slice.length
      : 0;
  }
  const turnoverJPY = avgVol20 * px;

  const vsMA25Pct =
    Number.isFinite(m25) && m25 !== 0 ? ((px - m25) / m25) * 100 : null;
  const vsMA75Pct =
    Number.isFinite(m75) && m75 !== 0 ? ((px - m75) / m75) * 100 : null;

  return {
    rsi14: Number.isFinite(rsi) ? r2(rsi) : null,
    atr: { atr14: r2(atr), atrPct: r2(atrPct) },
    ma: {
      m5: Number.isFinite(ma5[idx]) ? r2(ma5[idx]) : null,
      m25: Number.isFinite(m25) ? r2(m25) : null,
      m75: Number.isFinite(m75) ? r2(m75) : null,
    },
    pxVsMA: {
      vsMA25Pct: Number.isFinite(vsMA25Pct) ? r2(vsMA25Pct) : null,
      vsMA75Pct: Number.isFinite(vsMA75Pct) ? r2(vsMA75Pct) : null,
    },
    vol: { avg20: Math.round(avgVol20), z20: r2(volZ) },
    gapPct: r2(gapPct),
    turnoverJPY: Math.round(turnoverJPY),
  };
}

// ---- simple regime via TOPIX proxy ----
const DEFAULT_REGIME_TICKER = "1306.T";
function computeRegimeLabels(candles) {
  if (!Array.isArray(candles) || candles.length < 30)
    return new Array(candles.length).fill("RANGE");
  const closes = candles.map((c) => Number(c.close) || 0);
  const ma25 = smaArr(closes, 25);
  const ma75 = smaArr(closes, 75);

  // cheap ATR
  const atr = (() => {
    if (candles.length < 15) return candles.map(() => 0);
    const out = new Array(candles.length).fill(0);
    for (let i = 1; i < candles.length; i++) {
      const h = candles[i].high,
        l = candles[i].low,
        pc = candles[i - 1].close;
      const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
      if (i < 15) {
        const start = Math.max(1, i - 14);
        const w = candles.slice(start, i + 1);
        const sum = w.reduce((s, _, k) => {
          const idx = start + k;
          const h2 = candles[idx].high,
            l2 = candles[idx].low,
            pc2 = candles[idx - 1]?.close ?? 0;
          const tr2 = Math.max(h2 - l2, Math.abs(h2 - pc2), Math.abs(l2 - pc2));
          return s + tr2;
        }, 0);
        out[i] = sum / Math.min(14, i);
      } else {
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

    let slope = 0;
    if (i >= 5 && Number.isFinite(m25) && m25 > 0) {
      const prev = ma25[i - 5];
      if (Number.isFinite(prev) && prev > 0) {
        slope = (m25 - prev) / prev / 5;
      }
    }
    const aboveMA = Number.isFinite(m25) && px > m25;
    const strong =
      aboveMA && slope > 0.0002 && Number.isFinite(m75) && m25 > m75;
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

// ---- simulation ----
function simulateTradeForward(
  candles,
  startIdx,
  entry,
  stop,
  target,
  holdBars = 8
) {
  const risk = Math.max(0.01, entry - stop);
  let lowestSeenPx = entry;
  let highestSeenPx = entry;

  const endIdx = Math.min(candles.length - 1, startIdx + holdBars); // TIME exit at holdBars

  for (let j = startIdx + 1; j <= endIdx; j++) {
    const bar = candles[j];
    lowestSeenPx = Math.min(lowestSeenPx, bar.low);
    highestSeenPx = Math.max(highestSeenPx, bar.high);

    if (bar.low <= stop) {
      return {
        exitType: "STOP",
        exitPrice: stop,
        exitDate: toISO(bar.date),
        holdingDays: j - startIdx,
        result: "LOSS",
        R: r2((stop - entry) / risk),
        returnPct: r2(((stop - entry) / entry) * 100),
        maePct: r2(((lowestSeenPx - entry) / entry) * 100),
        mfePct: r2(((highestSeenPx - entry) / entry) * 100),
      };
    }
    if (Number.isFinite(target) && bar.high >= target) {
      return {
        exitType: "TARGET",
        exitPrice: target,
        exitDate: toISO(bar.date),
        holdingDays: j - startIdx,
        result: "WIN",
        R: r2((target - entry) / risk),
        returnPct: r2(((target - entry) / entry) * 100),
        maePct: r2(((lowestSeenPx - entry) / entry) * 100),
        mfePct: r2(((highestSeenPx - entry) / entry) * 100),
      };
    }
  }

  // TIME exit
  const last = candles[endIdx];
  lowestSeenPx = Math.min(lowestSeenPx, last.low);
  highestSeenPx = Math.max(highestSeenPx, last.high);

  const rawPnL = last.close - entry;
  return {
    exitType: "TIME",
    exitPrice: last.close,
    exitDate: toISO(last.date),
    holdingDays: endIdx - startIdx,
    result: rawPnL >= 0 ? "WIN" : "LOSS",
    R: r2(rawPnL / risk),
    returnPct: r2((rawPnL / entry) * 100),
    maePct: r2(((lowestSeenPx - entry) / entry) * 100),
    mfePct: r2(((highestSeenPx - entry) / entry) * 100),
  };
}

// ---- main (single 36m run, no options) ----
async function runBacktest36m() {
  const VERSION = "bt-max-1";
  const MONTHS = 36;
  const HOLD_BARS = 8;
  const HARD_STOP_PCT = 0.07;
  const WARMUP = 60;
  const PREFETCH_WARMUP_DAYS = 120;

  const now = new Date();
  const TO = toISO(now);
  const fromDate = new Date(
    now.getFullYear(),
    now.getMonth() - MONTHS,
    now.getDate()
  );
  const FROM = toISO(fromDate);
  const FROM_PREFETCH = toISO(addDays(fromDate, -PREFETCH_WARMUP_DAYS));

  // Regime reference
  const topix = await fetchHistory(DEFAULT_REGIME_TICKER, FROM_PREFETCH, TO);
  const topixLabels = computeRegimeLabels(topix);
  const topixDateToLabel = Object.create(null);
  for (let i = 0; i < topix.length; i++) {
    topixDateToLabel[toISO(topix[i].date)] = topixLabels[i] || "RANGE";
  }

  const codes = [
    ...new Set(
      allTickers.map((t) =>
        t.code?.toUpperCase().endsWith(".T")
          ? t.code.toUpperCase()
          : `${String(t.code || "")
              .toUpperCase()
              .replace(/\..*$/, "")}.T`
      )
    ),
  ];

  const tickerInfo = Object.create(null);
  for (const t of allTickers) {
    if (!t?.code) continue;
    tickerInfo[t.code.toUpperCase()] = t; // {code,name,sector,tickSize}
  }

  const events = [];
  const skipped = [];

  const total = codes.length;
  console.log(`[BT] Starting 36m backtest: ${FROM} → ${TO} | tickers=${total}`);

  for (let ti = 0; ti < codes.length; ti++) {
    const code = codes[ti];
    const tStart = performance.now?.() ?? Date.now();
    let localEvents = 0;

    try {
      const candles = await fetchHistory(code, FROM_PREFETCH, TO);
      if (candles.length < WARMUP + 2) {
        skipped.push({
          ticker: code,
          reason: `not enough data (${candles.length} bars)`,
        });
        // progress log (skipped)
        const tMs = Math.round((performance.now?.() ?? Date.now()) - tStart);
        const pct = (((ti + 1) / total) * 100).toFixed(1);
        console.log(
          `[BT] ${ti + 1}/${total} (${pct}%) ${code} — SKIPPED (${
            candles.length
          } bars) in ${tMs}ms`
        );
        continue;
      }

      for (let i = 0; i < candles.length; i++) {
        const today = candles[i];
        const inWindow =
          today.date >= new Date(FROM) && today.date <= new Date(TO);
        if (!inWindow) continue;

        const hist = candles.slice(0, i + 1);
        if (hist.length < 75) continue;

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

        const sig = analyseCrossing(stock, hist, {
          debug: true,
          debugLevel: "verbose",
          dataForGates: hist,
        });

        const { ST, LT } = getShortLongSentiment(stock, hist) || {};
        const dayISO = toISO(today.date);
        const regime = topixDateToLabel[dayISO] || "RANGE";

        const hasNext = i + 1 < candles.length;
        const entryIdx = hasNext ? i + 1 : i;
        const entryBar = hasNext ? candles[entryIdx] : today;
        const entryKind = hasNext ? "nextOpen" : "sameClose";
        const rawEntry = hasNext ? entryBar.open : today.close;

        const meta = tickerInfo[code] || {};
        const tickSize = Number(meta.tickSize) || inferTickFromPrice(rawEntry);

        const rawStop = rawEntry * (1 - HARD_STOP_PCT);
        const sigTarget = Number(sig?.smartPriceTarget ?? sig?.priceTarget);
        const risk = Math.max(0.01, rawEntry - rawStop);
        const fallbackTarget = rawEntry + 1.5 * risk;
        const rawTarget = Number.isFinite(sigTarget)
          ? sigTarget
          : fallbackTarget;

        const entry = toTick(rawEntry, { tickSize });
        const stop = toTick(rawStop, { tickSize });
        const target = toTick(rawTarget, { tickSize });

        const indicators = computeIndicatorsAt(candles, entryIdx, entry);
        const rrAtEntry = (target - entry) / Math.max(0.01, entry - stop);

        const crossSel = sig?.meta?.cross?.selected ?? null;
        const reasonText =
          sig?.reason || (sig?.buyNow ? "signal: buy" : "signal: no-buy");

        const sim = simulateTradeForward(
          candles,
          entryIdx,
          entry,
          stop,
          target,
          HOLD_BARS
        );

        events.push({
          date: dayISO,
          ticker: code,
          name: meta.name || null,
          sector: meta.sector || null,
          tickSize,
          uid: `${code}@${dayISO}`,
          barIndex: i,
          ohlcv: {
            open: today.open,
            high: today.high,
            low: today.low,
            close: today.close,
            volume: today.volume,
            prevClose: candles[i - 1]?.close ?? today.close,
          },
          range52w: {
            high: stock.fiftyTwoWeekHigh,
            low: stock.fiftyTwoWeekLow,
          },
          regime,
          sentiment: {
            ST: Number.isFinite(ST) ? ST : null,
            LT: Number.isFinite(LT) ? LT : null,
          },
          sentimentKey: `LT${Number.isFinite(LT) ? LT : 4}-ST${
            Number.isFinite(ST) ? ST : 4
          }`,
          signal: {
            buyNow: !!sig?.buyNow,
            type:
              typeof reasonText === "string" && reasonText.includes(":")
                ? reasonText.split(":")[0]
                : crossSel
                ? String(crossSel)
                : "NONE",
            reason: reasonText,
            rr: Number.isFinite(sig?.telemetry?.rr?.ratio)
              ? {
                  ratio: r2(sig.telemetry.rr.ratio),
                  need: r2(sig.telemetry.rr.need || 0),
                  acceptable: !!sig.telemetry.rr.acceptable,
                }
              : null,
            crossMeta: {
              selected: crossSel,
              weekly: sig?.meta?.cross?.weekly || null,
              daily: sig?.meta?.cross?.daily || null,
            },
            guard: {
              veto: !!sig?.telemetry?.guard?.veto,
              reason: sig?.telemetry?.guard?.reason || null,
            },
          },
          indicators,
          plan: {
            entry: r2(entry),
            stop: r2(stop),
            target: r2(target),
            entryKind,
            tickSize,
          },
          risk: {
            perShare: r2(entry - stop),
            rrAtEntry: r2(rrAtEntry),
          },
          simulation: {
            exitType: sim.exitType,
            exitPrice: r2(sim.exitPrice),
            exitDate: sim.exitDate,
            holdingDays: sim.holdingDays,
            result: sim.result,
            R: r2(sim.R),
            returnPct: r2(sim.returnPct),
            maePct: r2(sim.maePct),
            mfePct: r2(sim.mfePct),
          },
        });

        localEvents++;
      }

      // --- per-ticker progress log ---
      const tMs = Math.round((performance.now?.() ?? Date.now()) - tStart);
      const pct = (((ti + 1) / total) * 100).toFixed(1);
      console.log(
        `[BT] ${
          ti + 1
        }/${total} (${pct}%) ${code} — events=${localEvents} • ${tMs}ms`
      );
    } catch (e) {
      skipped.push({
        ticker: code,
        reason: `exception: ${String(e).slice(0, 120)}`,
      });
      const tMs = Math.round((performance.now?.() ?? Date.now()) - tStart);
      const pct = (((ti + 1) / total) * 100).toFixed(1);
      console.log(
        `[BT] ${
          ti + 1
        }/${total} (${pct}%) ${code} — ERROR in ${tMs}ms: ${String(e).slice(
          0,
          120
        )}`
      );
    }
  }

  const out = {
    version: VERSION,
    from: FROM,
    to: TO,
    params: {
      months: MONTHS,
      holdBars: HOLD_BARS,
      hardStopPct: HARD_STOP_PCT,
      warmupBars: WARMUP,
      prefetchWarmupDays: PREFETCH_WARMUP_DAYS,
    },
    skipped,
    events,
  };

  // Expose and log as an object for easy "Copy object"
  if (typeof window !== "undefined") {
    window.__backtest36m = out;
  }
  console.log(
    "%c✅ Backtest complete — object below.\nRight-click → Copy object, or use window.__backtest36m",
    "font-weight:bold"
  );
  console.log(out);

  return out;
}

// Public API: window.backtest() with no options
window.backtest = async () => {
  return await runBacktest36m();
};
