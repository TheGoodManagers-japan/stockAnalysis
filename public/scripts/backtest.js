// /scripts/backtest.js — ultra-simplified 36m backtest that outputs one big JSON
// - Logs per-ticker progress
// - Exposes window.__backtest36m for "Copy object"
// - Download button for JSON (picker when clicked; blob fallback otherwise)

import { analyseCrossing } from "./swingTradeEntryTiming.js";
import { enrichForTechnicalScore, getShortLongSentiment } from "./main.js";
import { allTickers } from "./tickers.js";
import { attachBranchScores } from "./branch-scorer.js";


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

/* ---------- indicators (snapshot-at-entry only) ---------- */

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
    const g = Math.max(ch, 0),
      l = Math.max(-ch, 0);

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

/* ---------- simple regime via TOPIX proxy ---------- */

const DEFAULT_REGIME_TICKER = "1306.T";

function computeRegimeLabels(candles) {
  if (!Array.isArray(candles) || candles.length < 30)
    return new Array(candles.length).fill("RANGE");

  const closes = candles.map((c) => Number(c.close) || 0);
  const ma25 = smaArr(closes, 25);
  const ma75 = smaArr(closes, 75);

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
    const px = closes[i],
      m25 = ma25[i],
      m75 = ma75[i],
      a14 = atr[i] || 0;

    let slope = 0;

    if (i >= 5 && Number.isFinite(m25) && m25 > 0) {
      const prev = ma25[i - 5];
      if (Number.isFinite(prev) && prev > 0) slope = (m25 - prev) / prev / 5;
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

/* ---------- simulation ---------- */

function simulateTradeForward(
  candles,
  startIdx,
  entry,
  stop,
  target,
  holdBars = 8
) {
  const risk = Math.max(0.01, entry - stop);

  let lowestSeenPx = entry,
    highestSeenPx = entry;

  const endIdx = Math.min(candles.length - 1, startIdx + holdBars);

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

/* ---------- save helpers (picker if gesture, else Blob fallback) ---------- */

async function saveLargeJson(data, suggestedName = "backtest.json") {
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const fname = suggestedName.replace(/\.json$/i, `_${ts}.json`);
  const hasFS = typeof window.showSaveFilePicker === "function";

  const userGesture =
    self.isSecureContext &&
    document.hasFocus() &&
    navigator.userActivation &&
    navigator.userActivation.isActive;

  const { events = [], ...head } = data;

  // Path A: File picker streaming (only with real user gesture)
  if (hasFS && userGesture) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fname,
        types: [
          { description: "JSON", accept: { "application/json": [".json"] } },
        ],
      });

      const writable = await handle.createWritable();
      const enc = new TextEncoder();
      const W = (s) => writable.write(enc.encode(s));

      await W('{"version":');
      await W(JSON.stringify(head.version ?? null));
      await W(',"from":');
      await W(JSON.stringify(head.from ?? null));
      await W(',"to":');
      await W(JSON.stringify(head.to ?? null));
      await W(',"params":');
      await W(JSON.stringify(head.params ?? {}));
      await W(',"skipped":');
      await W(JSON.stringify(head.skipped ?? []));
      await W(',"events":[');

      for (let i = 0; i < events.length; i++) {
        if (i) await W(",");
        await W(JSON.stringify(events[i]));
        if (i % 1000 === 0) await new Promise((r) => setTimeout(r, 0));
      }

      await W('],"summaries":');
      await W(JSON.stringify(head.summaries ?? []));
      await W(',"raw":');
      await W(JSON.stringify(head.raw ?? {}));
      await W("}");
      await writable.close();
      

      console.log(`[SAVE] File written: ${handle.name}`);
      return { ok: true, method: "picker", filename: handle.name || fname };
    } catch (e) {
      console.warn("[SAVE] Picker path failed, falling back to Blob:", e);
    }
  }

  // Path B: Chunked Blob fallback
  const parts = [];
  const P = (s) => parts.push(s);

  P('{"version":');
  P(JSON.stringify(head.version ?? null));
  P(',"from":');
  P(JSON.stringify(head.from ?? null));
  P(',"to":');
  P(JSON.stringify(head.to ?? null));
  P(',"params":');
  P(JSON.stringify(head.params ?? {}));
  P(',"skipped":');
  P(JSON.stringify(head.skipped ?? []));
  P(',"events":[');

  for (let i = 0; i < events.length; i++) {
    if (i) P(",");
    P(JSON.stringify(events[i]));
    if (i % 2000 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  P('],"summaries":');
  P(JSON.stringify(head.summaries ?? []));
  P(',"raw":');
  P(JSON.stringify(head.raw ?? {}));
  P("}");


  const blob = new Blob(parts, { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = fname;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);

  console.log(`[SAVE] Fallback download started: ${fname}`);
  return { ok: true, method: "blob", filename: fname };
}

// Optional: visible save button (ensures user gesture → picker path)
function injectSaveButton(getDataFn) {
  const id = "__bt_save_btn__";
  if (document.getElementById(id)) return;

  const btn = document.createElement("button");
  btn.id = id;
  btn.textContent = "Download backtest JSON";

  Object.assign(btn.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    zIndex: 999999,
    padding: "10px 12px",
    borderRadius: "10px",
    border: "1px solid #ccc",
    background: "#fff",
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
  });

  btn.addEventListener("click", async () => {
    try {
      const data =
        typeof getDataFn === "function"
          ? await getDataFn()
          : window.__backtest36m;

      if (!data) {
        console.warn(
          "No backtest data in memory yet. Run window.backtest() first."
        );
        return;
      }

      const res = await saveLargeJson(data);
      console.log(`[SAVE] Done via ${res.method}: ${res.filename}`);
    } catch (e) {
      console.error("[SAVE] Failed:", e);
    }
  });

  document.body.appendChild(btn);
}

// === OVERLAPPING: keep every buyNow=true entry (no de-dup, no hold blocking)
function extractAllEntries(tickerEvents) {
  return tickerEvents.filter((e) => e?.signal?.buyNow && e?.simulation);
}


function summarizeTradesQuick(trades) {
  // chronological just in case
  trades = trades.slice().sort((a, b) => new Date(a.date) - new Date(b.date));

  const wins = trades.filter((t) => t.simulation?.result === "WIN");
  const losses = trades.filter((t) => t.simulation?.result === "LOSS");

  const take = (arr, f) => arr.reduce((a, b) => a + (f(b) || 0), 0);

  const n = trades.length;
  const nW = wins.length;
  const nL = losses.length;

  // Profit Factor on R (unchanged)
  const grossWinR = take(wins, (t) => t.simulation?.R);
  const grossLossRAbs = Math.abs(take(losses, (t) => t.simulation?.R));
  const PF = grossLossRAbs ? grossWinR / grossLossRAbs : null;

  // Arithmetic (non-compounded) averages on % return
  const avgAllPct = n
    ? take(trades, (t) => t.simulation?.returnPct || 0) / n
    : 0;
  const avgWinPct = nW
    ? take(wins, (t) => t.simulation?.returnPct || 0) / nW
    : 0;
  const avgLossPct = nL
    ? take(losses, (t) => t.simulation?.returnPct || 0) / nL
    : 0;

  // Win rate
  const winRatePct = n ? (nW / n) * 100 : 0;

  // Expectancy per trade
  // E = p(win)*avgWin + p(loss)*avgLoss
  const pW = n ? nW / n : 0;
  const expectancyPct = pW * avgWinPct + (1 - pW) * avgLossPct;

  return {
    trades: n,
    wins: nW,
    losses: nL,
    winRatePct: +winRatePct.toFixed(1),
    PF: PF != null ? +PF.toFixed(2) : null,
    avgReturnPct: +avgAllPct.toFixed(2), // average per trade (all)
    avgWinPct: +avgWinPct.toFixed(2), // average of winners only
    avgLossPct: +avgLossPct.toFixed(2), // average of losers only (negative)
    expectancyPct: +expectancyPct.toFixed(2),
  };
}

/* ---------- main (single 36m run, no options) ---------- */

async function runBacktest36m() {
  const VERSION = "bt-max-2"; // bumped

  const MONTHS = 36;
  const HOLD_BARS = 8;
  const HARD_STOP_PCT = 0.07;
  const WARMUP = 60;
  const PREFETCH_WARMUP_DAYS = 120;

const now = new Date();

const TO = toISO(
  new Date(now.getFullYear(), now.getMonth() - 36, now.getDate())
);

const fromDate = new Date(
  now.getFullYear(),
  now.getMonth() - 72,
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
  const summaries = [];

  const total = codes.length;

  console.log(`[BT] Starting 36m backtest: ${FROM} → ${TO} | tickers=${total}`);

  for (let ti = 0; ti < codes.length; ti++) {
    const code = codes[ti];
    const tStart = performance.now?.() ?? Date.now();
    let localEvents = 0;

    // remember where this ticker's events will start
    const evBase = events.length;

    try {
      const candles = await fetchHistory(code, FROM_PREFETCH, TO);
      if (candles.length < WARMUP + 2) {
        skipped.push({
          ticker: code,
          reason: `not enough data (${candles.length} bars)`,
        });

        const tMs = Math.round((performance.now?.() ?? Date.now()) - tStart);
        const pct = (((ti + 1) / total) * 100).toFixed(1);

        // per-ticker summary (successful path) — OVERLAPPING
        {
          const tickerEvents = events.slice(evBase);

          // Use ALL buyNow=true entries (overlaps allowed)
          const entries = extractAllEntries(tickerEvents);
          const s = summarizeTradesQuick(entries);
          const rawEntries = entries.length;

          console.log(
            `[BT][PERF][RAW] ${code} — entries_taken=${rawEntries} ` +
              `| WinRate=${s.winRatePct}% | PF=${s.PF} ` +
              `| Avg/Trade=${s.avgReturnPct}% | AvgWin=${s.avgWinPct}% | AvgLoss=${s.avgLossPct}% ` +
              `| Expectancy=${s.expectancyPct}%`
          );

          // Store overlapping summary to keep it explicit
          summaries.push({ ticker: code, overlapping: s, rawEntries });
        }

        continue;
      }

      for (let i = 0; i < candles.length; i++) {
        const today = candles[i];

        const inWindow =
          today.date >= new Date(FROM) && today.date <= new Date(TO);
        if (!inWindow) continue;

        const hist = candles.slice(0, i + 1);
        if (hist.length < 75) continue;

        // Efficient rolling 52w extremes (last 252 bars)
        const start252 = Math.max(0, hist.length - 252);

        let fiftyTwoWeekHigh = -Infinity,
          fiftyTwoWeekLow = Infinity;

        for (let k = start252; k < hist.length; k++) {
          const hh = hist[k].high,
            ll = hist[k].low;
          if (hh > fiftyTwoWeekHigh) fiftyTwoWeekHigh = hh;
          if (ll < fiftyTwoWeekLow) fiftyTwoWeekLow = ll;
        }

        if (!Number.isFinite(fiftyTwoWeekHigh)) fiftyTwoWeekHigh = today.high;
        if (!Number.isFinite(fiftyTwoWeekLow)) fiftyTwoWeekLow = today.low;

        const stock = {
          ticker: code,
          currentPrice: today.close,
          highPrice: today.high,
          lowPrice: today.low,
          openPrice: today.open,
          prevClosePrice: candles[i - 1] ? candles[i - 1].close : today.close,
          fiftyTwoWeekHigh,
          fiftyTwoWeekLow,
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

        const lane = sig?.meta?.cross?.selected ?? "NONE";
        const reasonText =
          sig?.reason || (sig?.buyNow ? "signal: buy" : "signal: no-buy");

        // Flip ages / lag (prefer explicit last* fields if analyseCrossing exposes them; fallback to fresh flip ages)
        const daysSinceDailyFlip = Number.isFinite(
          sig?.meta?.cross?.lastDailyFlipBarsAgo
        )
          ? sig.meta.cross.lastDailyFlipBarsAgo
          : Number.isFinite(sig?.meta?.cross?.daily?.barsAgo)
          ? sig.meta.cross.daily.barsAgo
          : null;

        const weeksSinceWeeklyFlip = Number.isFinite(
          sig?.meta?.cross?.lastWeeklyFlipWeeksAgo
        )
          ? sig.meta.cross.lastWeeklyFlipWeeksAgo
          : Number.isFinite(sig?.meta?.cross?.weekly?.barsAgo)
          ? sig.meta.cross.weekly.barsAgo
          : null;

        const lagBarsSinceCross = Number.isFinite(
          sig?.meta?.cross?.daily?.barsAgo
        )
          ? sig.meta.cross.daily.barsAgo
          : null;

        const guardDetails = sig?.telemetry?.guard?.details || null;
        const dipDiag = sig?.telemetry?.dip || null;

        // Compute rr shortfall (if any)
        const rrTel = sig?.telemetry?.rr;
        const rrShortfall =
          rrTel && Number.isFinite(rrTel.need) && Number.isFinite(rrTel.ratio)
            ? r2(rrTel.need - rrTel.ratio)
            : null;

        const rejectedCount = Array.isArray(sig?.rejectedCandidates)
          ? sig.rejectedCandidates.length
          : 0;

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
          range52w: { high: fiftyTwoWeekHigh, low: fiftyTwoWeekLow },
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
                : lane
                ? String(lane)
                : "NONE",
            reason: reasonText,

            // richer RR snapshot (incl. probation & shortfall)
            rr: Number.isFinite(sig?.telemetry?.rr?.ratio)
              ? {
                  ratio: r2(sig.telemetry.rr.ratio),
                  need: r2(sig.telemetry.rr.need || 0),
                  acceptable: !!sig.telemetry.rr.acceptable,
                  probation: !!sig.telemetry.rr.probation,
                  shortfall: rrShortfall,
                }
              : null,

            // lane & flip metadata + lag
            crossMeta: {
              selected: lane,
              weekly: sig?.meta?.cross?.weekly || null,
              daily: sig?.meta?.cross?.daily || null,
              lagBarsSinceCross: Number.isFinite(lagBarsSinceCross)
                ? lagBarsSinceCross
                : null,
              daysSinceDailyFlip: Number.isFinite(daysSinceDailyFlip)
                ? daysSinceDailyFlip
                : null,
              weeksSinceWeeklyFlip: Number.isFinite(weeksSinceWeeklyFlip)
                ? weeksSinceWeeklyFlip
                : null,
              lastDailyFlipBarsAgo:
                sig?.meta?.cross?.lastDailyFlipBarsAgo ?? null,
              lastWeeklyFlipWeeksAgo:
                sig?.meta?.cross?.lastWeeklyFlipWeeksAgo ?? null,
            },

            // carry guard diagnostics compactly
            guard: {
              veto: !!sig?.telemetry?.guard?.veto,
              reason: sig?.telemetry?.guard?.reason || null,
              details: guardDetails
                ? {
                    rsi:
                      Number.isFinite(guardDetails.rsi) &&
                      guardDetails.rsi !== null
                        ? r2(guardDetails.rsi)
                        : null,
                    headroomATR:
                      Number.isFinite(guardDetails.headroomATR) &&
                      guardDetails.headroomATR !== null
                        ? r2(guardDetails.headroomATR)
                        : null,
                    headroomPct:
                      Number.isFinite(guardDetails.headroomPct) &&
                      guardDetails.headroomPct !== null
                        ? r2(guardDetails.headroomPct)
                        : null,
                    nearestRes:
                      Number.isFinite(guardDetails.nearestRes) &&
                      guardDetails.nearestRes !== null
                        ? r2(guardDetails.nearestRes)
                        : guardDetails.nearestRes ?? null,
                    distFromMA25_ATR:
                      Number.isFinite(guardDetails.distFromMA25_ATR) &&
                      guardDetails.distFromMA25_ATR !== null
                        ? r2(guardDetails.distFromMA25_ATR)
                        : null,
                    consecUp:
                      Number.isFinite(guardDetails.consecUp) &&
                      guardDetails.consecUp !== null
                        ? guardDetails.consecUp
                        : null,
                  }
                : null,
            },

            // volatility snapshot at signal time
            volatility: sig?.volatility
              ? {
                  atr: r2(sig.volatility.atr),
                  atrPct: r2(sig.volatility.atrPct),
                  bucket: sig.volatility.bucket,
                }
              : null,

            // DIP quick diag (lane + bounce freshness if available)
            dip: dipDiag
              ? {
                  lane: String(lane || "").startsWith("DIP")
                    ? lane.includes("WEEKLY")
                      ? "WEEKLY"
                      : lane.includes("DAILY")
                      ? "DAILY"
                      : null
                    : null,
                  trigger: !!dipDiag.trigger,
                  bounceAgeBars: Number.isFinite(
                    dipDiag?.diagnostics?.bounceAgeBars
                  )
                    ? dipDiag.diagnostics.bounceAgeBars
                    : null,
                }
              : null,

            // how many plausible candidates were rejected upstream
            rejected_count: rejectedCount,
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

      // per-ticker summary (successful path) — OVERLAPPING
      {
        const tickerEvents = events.slice(evBase);

        // Use ALL buyNow=true entries (overlaps allowed)
        const entries = extractAllEntries(tickerEvents);
        const s = summarizeTradesQuick(entries);
        const rawEntries = entries.length;

        console.log(
          `[BT][PERF][RAW] ${code} — entries_taken=${rawEntries} ` +
            `| WinRate=${s.winRatePct}% | PF=${s.PF} ` +
            `| Avg/Trade=${s.avgReturnPct}% | AvgWin=${s.avgWinPct}% | AvgLoss=${s.avgLossPct}% ` +
            `| Expectancy=${s.expectancyPct}%`
        );

        // Store overlapping summary to keep it explicit
        summaries.push({ ticker: code, overlapping: s, rawEntries });
      }

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

      // summarize partial results even on error — OVERLAPPING
      {
        const tickerEvents = events.slice(evBase);

        const entries = extractAllEntries(tickerEvents);
        const s = summarizeTradesQuick(entries);
        const rawEntries = entries.length;

        console.log(
          `[BT][PERF][RAW][ERROR] ${code} — entries_taken=${rawEntries} ` +
            `| WinRate=${s.winRatePct}% | PF=${s.PF} ` +
            `| Avg/Trade=${s.avgReturnPct}% | AvgWin=${s.avgWinPct}% | AvgLoss=${s.avgLossPct}% ` +
            `| Expectancy=${s.expectancyPct}%`
        );

        summaries.push({
          ticker: code,
          overlapping: s,
          rawEntries,
          error: String(e).slice(0, 120),
        });
      }
    }
  }

  // === GLOBAL overlapping entries count ===
  const totalRawEntries = extractAllEntries(events).length;
  console.log(`[BT][RAW][GLOBAL] entries_taken=${totalRawEntries}`);

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
    summaries,
    raw: { entriesTaken: totalRawEntries },
  };

  // === attach branch tokens + scores (0 if no match) ===
  try {
    await attachBranchScores(out); // mutates out.events[..] and out.raw.branchTotals
  } catch (e) {
    console.warn("[BRANCH] Failed to attach branch scores:", e);
  }

  // Expose for "Copy object"
  if (typeof window !== "undefined") window.__backtest36m = out;

  // Compact summary (avoid logging huge object)
  console.log(
    `[BT] Done. Total events=${events.length}, skipped=${skipped.length}`
  );

  // Auto-download JSON (uses Blob fallback if no user gesture)
  try {
    const res = await saveLargeJson(out, `backtest_${out.from}_${out.to}.json`);
    console.log(`[SAVE] Completed via ${res.method}: ${res.filename}`);
  } catch (err) {
    console.warn("[SAVE] Failed to save automatically:", err);
  }

  return out;
}

// Public API: window.backtest() with no options
window.backtest = async () => {
  return await runBacktest36m();
};

// Add a visible save button (lets you force the picker with a click)
injectSaveButton(() => window.__backtest36m);