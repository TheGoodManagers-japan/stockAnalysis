// /scripts/backtest.js — swing-period backtest (browser)

import { analyseCrossing } from "./swingTradeEntryTiming.js";
import { enrichForTechnicalScore, getShortLongSentiment } from "./main.js";
import { allTickers } from "./tickers.js";

const API_BASE =
  "https://stock-analysis-thegoodmanagers-japan-aymerics-projects-60f33831.vercel.app";

const toISO = (d) => new Date(d).toISOString().slice(0, 10);
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/* ---------------- tick helpers ---------------- */
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
  try {
    const r = await fetch(
      `${API_BASE}/api/history?ticker=${encodeURIComponent(ticker)}`
    );
    const text = await r.text();

    if (!r.ok) {
      console.warn(
        `[BT] fetchHistory: ${ticker} HTTP ${r.status}: ${text.slice(0, 200)}`
      );
      return [];
    }

    let j;
    try {
      j = JSON.parse(text);
    } catch (e) {
      console.warn(
        `[BT] fetchHistory: bad JSON for ${ticker}: ${String(e).slice(0, 200)}`
      );
      return [];
    }

    if (!j?.success || !Array.isArray(j.data)) {
      console.warn(`[BT] fetchHistory: bad payload for ${ticker}`);
      return [];
    }

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
  } catch (err) {
    console.warn(
      `[BT] fetchHistory: exception for ${ticker}: ${String(err).slice(0, 200)}`
    );
    return [];
  }
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

function highestHighSince(hist, startIdx) {
  let hi = -Infinity;
  for (let k = startIdx; k < hist.length; k++)
    hi = Math.max(hi, Number(hist[k].high) || 0);
  return hi;
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

/* ---------------- per-ticker analysis helpers ---------------- */
function median(arr) {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function pct(n, d) {
  return d ? +((n / d) * 100).toFixed(2) : 0;
}

function buildTickerAnalysis(ticker, trades) {
  if (!trades.length)
    return { summary: `No trades for ${ticker}.`, detail: {} };

  const wins = trades.filter((t) => t.result === "WIN");
  const losses = trades.filter((t) => t.result === "LOSS");
  const n = trades.length;

  // Regime breakdown
  const regimesList = ["STRONG_UP", "UP", "RANGE", "DOWN"];
  const regCount = (list) =>
    Object.fromEntries(
      regimesList.map((r) => [r, list.filter((t) => t.regime === r).length])
    );
  const regWins = regCount(wins);
  const regLoss = regCount(losses);

  // Exit breakdown
  const exitCount = (list, type) =>
    list.filter((t) => t.exitType === type).length;

  // Cross type/lag
  const lagVals = (list, typ) =>
    list
      .filter((t) => t.crossType === typ && Number.isFinite(t.crossLag))
      .map((t) => t.crossLag);
  const wLagW = median(lagVals(wins, "WEEKLY"));
  const wLagD = median(lagVals(wins, "DAILY"));
  const lLagW = median(lagVals(losses, "WEEKLY"));
  const lLagD = median(lagVals(losses, "DAILY"));

  // R & holding
  const medRwin = median(wins.map((t) => t.R || 0));
  const medRloss = median(losses.map((t) => t.R || 0));
  const medHoldWin = median(wins.map((t) => t.holdingDays || 0));
  const medHoldLoss = median(losses.map((t) => t.holdingDays || 0));

  // Risk/target geometry at entry
  const riskAtEntry = (t) => {
    const base = Number.isFinite(t.stop) ? t.entry - t.stop : 0.01;
    return Math.max(0.01, base);
  };
  const rrAtEntry = (t) => {
    const den = riskAtEntry(t);
    return (t.target - t.entry) / den;
  };

  const medRRwin = median(wins.map(rrAtEntry));
  const medRRloss = median(losses.map(rrAtEntry));
  const tightStopsLossPct = pct(
    losses.filter((t) => riskAtEntry(t) <= t.entry * 0.008).length,
    losses.length
  ); // ≤0.8% risk

  // Sentiment combos
  const key = (t) =>
    `LT${Number.isFinite(t.LT) ? t.LT : 4}-ST${
      Number.isFinite(t.ST) ? t.ST : 4
    }`;
  const topSenti = (list) => {
    const m = new Map();
    for (const t of list) {
      const k = key(t);
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, c]) => `${k} (${c})`);
  };

  // Exit types
  const stopL = exitCount(losses, "STOP"),
    tgtW = exitCount(wins, "TARGET");
  const timeW = exitCount(wins, "TIME"),
    timeL = exitCount(losses, "TIME");

  const bullets = [];
  const bestReg = [...regimesList].sort((a, b) => regWins[b] - regWins[a])[0];
  const worstReg = [...regimesList].sort((a, b) => regLoss[b] - regLoss[a])[0];

  if (regWins[bestReg])
    bullets.push(
      `Wins clustered in **${bestReg}** (wins ${regWins[bestReg]}/${wins.length}).`
    );
  if (regLoss[worstReg])
    bullets.push(
      `Losses clustered in **${worstReg}** (losses ${regLoss[worstReg]}/${losses.length}).`
    );

  const lagBits = [];
  if (Number.isFinite(wLagW)) lagBits.push(`weekly lag≈${wLagW}`);
  if (Number.isFinite(wLagD)) lagBits.push(`daily lag≈${wLagD}`);
  if (lagBits.length)
    bullets.push(
      `Winning entries tended to be **fresh**: ${lagBits.join(", ")}.`
    );
  const lagLossBits = [];
  if (Number.isFinite(lLagW)) lagLossBits.push(`weekly lag≈${lLagW}`);
  if (Number.isFinite(lLagD)) lagLossBits.push(`daily lag≈${lLagD}`);
  if (lagLossBits.length)
    bullets.push(`Losing entries were **late**: ${lagLossBits.join(", ")}.`);

  if (Number.isFinite(medRRwin) && Number.isFinite(medRRloss)) {
    bullets.push(
      `Median RR at entry — wins **${medRRwin.toFixed(
        2
      )}:1**, losses **${medRRloss.toFixed(2)}:1**.`
    );
  }
  bullets.push(
    `Stops hit on **${pct(
      stopL,
      losses.length
    )}%** of losses; targets hit on **${pct(tgtW, wins.length)}%** of wins.`
  );
  if (Number.isFinite(medHoldWin) && Number.isFinite(medHoldLoss)) {
    bullets.push(
      `Holding: wins median **${medHoldWin} bars**, losses **${medHoldLoss} bars**.`
    );
  }
  if (losses.length)
    bullets.push(
      `Atypical tight-risk losses: **${tightStopsLossPct}%** (risk ≤0.8% of entry).`
    );
  const topW = topSenti(wins),
    topL = topSenti(losses);
  if (topW.length)
    bullets.push(`Winning sentiment combos: ${topW.join(", ")}.`);
  if (topL.length) bullets.push(`Losing sentiment combos: ${topL.join(", ")}.`);

  const wr = pct(wins.length, n);
  const pf = (() => {
    const gw = wins.reduce((a, t) => a + (t.returnPct || 0), 0);
    const gl = Math.abs(losses.reduce((a, t) => a + (t.returnPct || 0), 0));
    return gl ? +(gw / gl).toFixed(2) : wins.length ? Infinity : 0;
  })();

  const summary =
    `${ticker}: ${n} trades | winRate ${wr}% | PF ${pf}. ` +
    `Wins concentrated in ${bestReg}; losses in ${worstReg}. ` +
    (Number.isFinite(wLagD) || Number.isFinite(wLagW)
      ? `Fresh-cross lags helped winners; `
      : ``) +
    (Number.isFinite(lLagD) || Number.isFinite(lLagW)
      ? `late lags hurt losers. `
      : ``) +
    `Median RR (win vs loss): ${
      Number.isFinite(medRRwin) ? medRRwin.toFixed(2) : "?"
    }:${Number.isFinite(medRRloss) ? medRRloss.toFixed(2) : "?"}.`;

  return {
    summary,
    detail: {
      count: n,
      wins: wins.length,
      losses: losses.length,
      regimes: { wins: regWins, losses: regLoss },
      rr: { medianWin: medRwin, medianLoss: medRloss },
      holdingDays: { medianWin: medHoldWin, medianLoss: medHoldLoss },
      crossLag: {
        win: { weekly: wLagW, daily: wLagD },
        loss: { weekly: lLagW, daily: lLagD },
      },
      exits: {
        stopLosses: stopL,
        targetWins: tgtW,
        timeWins: timeW,
        timeLosses: timeL,
      },
      tightRiskLossPct: tightStopsLossPct,
      topSentiment: { wins: topW, losses: topL },
      bullets,
    },
  };
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

/* ---------------------- REGIME HELPERS (topixi-based) ---------------------- */
const DEFAULT_REGIME_TICKER = "1306.T"; // TOPIX ETF proxy

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

/* ---------------- Analytics helpers ---------------- */
function emaArr(arr, p) {
  if (!arr.length) return [];
  const k = 2 / (p + 1);
  const out = new Array(arr.length).fill(NaN);
  let ema = arr[0];
  out[0] = ema;
  for (let i = 1; i < arr.length; i++) {
    ema = arr[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

// Wilder-style RSI(14)
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

// ATR(14)
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

// rolling mean/std for volume Z
function rollingMeanStd(arr, win = 20) {
  const n = arr.length;
  const mean = new Array(n).fill(NaN);
  const stdev = new Array(n).fill(NaN);
  if (n === 0) return { mean, stdev };
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

function computeAnalytics(candles, idx, entry) {
  const closes = candles.map((c) => Number(c.close) || 0);
  const vols = candles.map((c) => Number(c.volume) || 0);

  const ma5 = smaArr(closes, 5);
  const ma25 = smaArr(closes, 25);
  const ma75 = smaArr(closes, 75);
  const rsi14 = rsiArr(closes, 14);
  const atr14 = atrArr(candles, 14);
  const { mean: vMean, stdev: vStd } = rollingMeanStd(vols, 20);

  const px = Number(entry) || closes[idx];
  const prevC = idx > 0 ? closes[idx - 1] : closes[idx];

  const m25 = Number(ma25[idx]);
  const m75 = Number(ma75[idx]);
  const m5 = Number(ma5[idx]);
  const atr = Number(atr14[idx]) || 0;

  const rsi = Number(rsi14[idx]);
  const atrPct = atr && px ? (atr / px) * 100 : 0;

  const vmu = Number(vMean[idx]) || 0;
  const vsd = Number(vStd[idx]) || 0;
  const vol = Number(vols[idx]) || 0;
  const volZ = vsd > 0 ? (vol - vmu) / vsd : 0;

  const gapPct = prevC ? ((px - prevC) / prevC) * 100 : 0;
  const pxVsMA25Pct =
    Number.isFinite(m25) && m25 !== 0 ? ((px - m25) / m25) * 100 : NaN;

  let maStackScore = 0;
  if (Number.isFinite(m5) && Number.isFinite(m25) && m5 > m25)
    maStackScore += 1;
  if (Number.isFinite(m25) && Number.isFinite(m75) && m25 > m75)
    maStackScore += 1;
  if (Number.isFinite(m25) && px > m25) maStackScore += 1;

  const pxAboveMA25 = Number.isFinite(m25) ? px > m25 : false;
  const pxAboveMA75 = Number.isFinite(m75) ? px > m75 : false;

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

  return {
    rsi: Number.isFinite(rsi) ? +rsi.toFixed(2) : null,
    atrPct: +atrPct.toFixed(2),
    volZ: Number.isFinite(volZ) ? +volZ.toFixed(2) : null,
    gapPct: +gapPct.toFixed(2),
    pxVsMA25Pct: Number.isFinite(pxVsMA25Pct) ? +pxVsMA25Pct.toFixed(2) : null,
    maStackScore,
    pxAboveMA25,
    pxAboveMA75,

    entryPx: px,
    turnoverJPY: Number.isFinite(turnoverJPY) ? +turnoverJPY.toFixed(2) : null,
  };
}

/**
 * Compute regime labels for Topix proxy candles.
 */
function computeRegimeLabels(candles) {
  if (!Array.isArray(candles) || candles.length < 30) {
    return candles.map(() => "RANGE");
  }

  const closes = candles.map((c) => Number(c.close) || 0);
  const ma25 = smaArr(closes, 25);
  const ma75 = smaArr(closes, 75);

  // ATR(14) approximation to judge "RANGE"
  const atr = (() => {
    if (candles.length < 15) return candles.map(() => 0);
    const out = new Array(candles.length).fill(0);
    for (let i = 1; i < candles.length; i++) {
      const h = Number(candles[i].high ?? candles[i].close ?? 0);
      const l = Number(candles[i].low ?? candles[i].close ?? 0);
      const pc = Number(candles[i - 1].close ?? 0);
      const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
      if (i < 15) {
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
        slope = (m25 - prev) / prev / 5; // per bar
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

/** Build date->regime map */
function buildRegimeMap(candles) {
  const labels = computeRegimeLabels(candles);
  const map = Object.create(null);
  for (let i = 0; i < candles.length; i++) {
    map[toISO(candles[i].date)] = labels[i];
  }
  return map;
}

/* ------------------ MAIN BACKTEST (single profile, no scoring) ------------------ */
async function runBacktest(tickersOrOpts, maybeOpts) {
  let tickers = Array.isArray(tickersOrOpts) ? tickersOrOpts : [];
  const opts = Array.isArray(tickersOrOpts)
    ? maybeOpts || {}
    : tickersOrOpts || {};
  const USE_LIVE_BAR = true;

  const INCLUDE_BY_TICKER = true;
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
  const HOLD_BARS = Number.isFinite(opts.holdBars) ? opts.holdBars : 20;
  const COOLDOWN = 0;

  const MAX_CONCURRENT = Number.isFinite(opts.maxConcurrent)
    ? Math.max(0, opts.maxConcurrent)
    : 0; // telemetry only

  // volatility cap (telemetry only)
  const MAX_ATR_PCT = Number.isFinite(opts.maxAtrPct)
    ? opts.maxAtrPct
    : Infinity;

  const append = Array.isArray(opts.appendTickers) ? opts.appendTickers : [];
  if (!tickers.length) tickers = allTickers.map((t) => t.code);
  tickers = [...new Set([...tickers, ...append])];
  if (limit > 0) tickers = tickers.slice(0, limit);

  const codes = tickers.map((c) =>
    c.endsWith(".T")
      ? c.toUpperCase()
      : `${String(c).toUpperCase().replace(/\..*$/, "")}.T`
  );

  // map ticker -> { code, sector }
  const tickerInfoMap = Object.create(null);
  for (const t of allTickers) {
    if (!t || !t.code) continue;
    tickerInfoMap[t.code.toUpperCase()] = t;
  }

  // ---- PROFILE LOGIC ----
  // hard stop floor: 15% below entry
  const HARD_STOP_PCT = 0.15;
  function computePlannedLevels({ entry, sig }) {
    const tgt = Number(sig?.smartPriceTarget ?? sig?.priceTarget);
    const floorStop = Number(entry) * (1 - HARD_STOP_PCT);
    return {
      stop: floorStop,
      target: tgt,
    };
  }

  // --- regime setup ---
  const REGIME_TICKER =
    opts && typeof opts.regimeTicker === "string" && opts.regimeTicker.trim()
      ? opts.regimeTicker.trim().toUpperCase()
      : DEFAULT_REGIME_TICKER;

  const allowedRegimes =
    Array.isArray(opts.allowedRegimes) && opts.allowedRegimes.length
      ? new Set(opts.allowedRegimes.map(String))
      : null;
  // allowedRegimes is NOT used to block, just logged

  const topixRef = await fetchHistory(REGIME_TICKER, FROM, TO);
  if (!topixRef || !topixRef.length) {
    console.warn(
      `[BT] Regime fetch failed or empty for ${REGIME_TICKER} (${FROM}→${TO})`
    );
  }
  const regimeMap =
    topixRef && topixRef.length
      ? buildRegimeMap(topixRef)
      : Object.create(null);
  console.log(
    `[BT] Regime ready from ${REGIME_TICKER} with ${
      topixRef ? topixRef.length : 0
    } bars`
  );

  // Aggregation per regime
  const regimeAgg = {
    STRONG_UP: [],
    UP: [],
    RANGE: [],
    DOWN: [],
  };

  // Aggregation for "DIP AFTER WEEKLY"/"DIP AFTER DAILY" following fresh cross
  const dipAfterAgg = {
    WEEKLY: [],
    DAILY: [],
  };

  // diagnostics
  const byTicker = [];
  const globalTrades = [];
  const tradingDays = new Set();
  const skippedTickers = [];

  let signalsTotal = 0;
  let signalsAfterWarmup = 0;
  let signalsWhileFlat = 0;
  let signalsInvalid = 0;
  let signalsRiskBad = 0;
  let signalsExecuted = 0;
  const signalsByDay = new Map(); // ISO date -> count of buyNow signals

  let blockedInTrade = 0;
  let blockedCooldown = 0;
  let blockedWarmup = 0;

  const COUNT_BLOCKED = true;

  const telemetry = {
    trends: { STRONG_UP: 0, UP: 0, WEAK_UP: 0, DOWN: 0, RANGE: 0 },

    gates: {
      // these are legacy counters; keep shape
      priceActionGateFailed: 0,
      structureGateFailed: 0,
      stackedGateFailed: 0,
      tooWildAtr: 0, // not blocking
      regimeFiltered: 0, // not blocking
    },

    dip: {
      notReadyReasons: {},
      guardVetoReasons: {},
    },

    rr: { rejected: {}, accepted: {} },

    examples: { buyNow: [], rejected: [] },
  };

  const EXAMPLE_MAX = 5;

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

  const sentiment = {
    actual: Object.create(null),
    rejected: Object.create(null),

    actualLT: Object.create(null),
    rejectedLT: Object.create(null),

    actualST: Object.create(null),
    rejectedST: Object.create(null),

    bestByWinRate: { actual: [], rejected: [] },
  };

  console.log(
    `[BT] window ${FROM}→${TO} | holdBars=${
      HOLD_BARS || "off"
    } | warmup=${WARMUP} | cooldown=${COOLDOWN}`
  );
  console.log(`[BT] total stocks: ${codes.length}`);

  const pct2 = (n) => Math.round(n * 100) / 100;

  // position cap telemetry
  let globalOpenCount = 0;

  for (let ti = 0; ti < codes.length; ti++) {
    const code = codes[ti];
    console.log(`[BT] processing stock ${ti + 1}/${codes.length}: ${code}`);

    try {
      // per-stock state
      let openPositions = [];
      let cooldownUntil = -1; // tracked, but no longer enforced

      const candles = await fetchHistory(code, FROM, TO);
      if (candles.length < WARMUP + 2) {
        console.warn(
          `[BT] not enough data for ${code} (${candles.length} < ${
            WARMUP + 2
          }) — skipping`
        );
        skippedTickers.push({
          ticker: code,
          reason: `not enough data (${candles.length} bars)`,
        });
        continue;
      }

      const trades = [];

      for (let i = 0; i < candles.length; i++) {
        const today = candles[i];
        tradingDays.add(toISO(today.date));
        const hist = candles.slice(0, i + 1);

        // regime for this day
        const dayISO = toISO(today.date);
        const dayRegime = regimeMap[dayISO] || "RANGE";

        if (dayRegime && telemetry.trends.hasOwnProperty(dayRegime)) {
          telemetry.trends[dayRegime]++;
        }

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

        // manage open positions
        if (openPositions.length) {
          for (let k = openPositions.length - 1; k >= 0; k--) {
            const st = openPositions[k];

            let exit = null;
            const canStop = Number.isFinite(st.stop);
            const stopTouched = canStop && today.low <= st.stop;

            if (stopTouched) {
              let stopFill =
                today.open < st.stop
                  ? today.open
                  : Math.min(st.stop, today.high);

              // enforce 15% floor
              if (Number.isFinite(st.maxLossFloor)) {
                stopFill = Math.max(stopFill, st.maxLossFloor);
              }

              const isProfit = stopFill >= st.entry;
              exit = {
                type: "STOP",
                price: stopFill,
                result: isProfit ? "WIN" : "LOSS",
              };
            } else if (Number.isFinite(st.target) && today.high >= st.target) {
              exit = { type: "TARGET", price: st.target, result: "WIN" };
            }

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

              const baseRisk = st.entry - st.initialStop;
              const risk = Math.max(0.01, baseRisk);
              const Rval = r2((exit.price - st.entry) / risk);

              const isDipAfterFreshCrossSignal =
                /DIP/i.test(st.kind || "") &&
                (st.crossType === "WEEKLY" ||
                  st.crossType === "DAILY" ||
                  st.crossType === "BOTH") &&
                Number.isFinite(st.crossLag) &&
                st.crossLag <= 3;

              const trade = {
                ticker: code,
                strategy: st.kind || "DIP",

                entryDate: toISO(candles[st.entryIdx].date),
                exitDate: toISO(today.date),
                returnPct: r2(pctRet),
                result: exit.result,
                holdingDays: i - st.entryIdx,
                exitType: exit.type,

                entry: r2(st.entry),
                exit: r2(exit.price),
                stop: st.initialStop,
                target: st.target,
                R: Rval,

                ST: st.ST,
                LT: st.LT,
                regime: st.regime || "RANGE",
                crossType: st.crossType || null,
                crossLag: Number.isFinite(st.crossLag) ? st.crossLag : null,
                analytics: st.analytics || null,

                sector: tickerInfoMap[code]?.sector || null,

                dipAfterFreshCross: isDipAfterFreshCrossSignal,
              };

              trade.entryArchetype = trade.dipAfterFreshCross
                ? "DIP_AFTER_FRESH_CROSS"
                : trade.crossType || "OTHER";

              trades.push(trade);
              globalTrades.push(trade);

              // sentiment aggregation
              const kKey = sentiKey(st.ST, st.LT);
              if (!sentiment.actual[kKey]) sentiment.actual[kKey] = sentiInit();
              sentiUpdate(sentiment.actual[kKey], {
                result: trade.result,
                returnPct: trade.returnPct,
                R: trade.R,
              });

              if (Number.isFinite(st.LT)) {
                if (!sentiment.actualLT[st.LT]) {
                  sentiment.actualLT[st.LT] = sentiInit();
                }
                sentiUpdate(sentiment.actualLT[st.LT], {
                  result: trade.result,
                  returnPct: trade.returnPct,
                  R: trade.R,
                });
              }

              if (Number.isFinite(st.ST)) {
                if (!sentiment.actualST[st.ST]) {
                  sentiment.actualST[st.ST] = sentiInit();
                }
                sentiUpdate(sentiment.actualST[st.ST], {
                  result: trade.result,
                  returnPct: trade.returnPct,
                  R: trade.R,
                });
              }

              if (trade.regime && regimeAgg[trade.regime]) {
                regimeAgg[trade.regime].push(trade);
              }

              if (trade.dipAfterFreshCross) {
                if (trade.crossType === "WEEKLY") {
                  dipAfterAgg.WEEKLY.push(trade);
                } else if (trade.crossType === "DAILY") {
                  dipAfterAgg.DAILY.push(trade);
                } else if (trade.crossType === "BOTH") {
                  dipAfterAgg.WEEKLY.push(trade);
                  dipAfterAgg.DAILY.push(trade);
                }
              }

              openPositions.splice(k, 1);
              cooldownUntil = i + COOLDOWN; // telemetry only
              globalOpenCount = Math.max(0, globalOpenCount - 1);
            }
          }
        }

        // detect signal
        const gatesData = USE_LIVE_BAR ? hist : hist.slice(0, -1);
        const sig = analyseCrossing(stock, hist, {
          debug: true,
          debugLevel: "verbose",
          dataForGates: gatesData,
        });

        const teleSig = sig?.telemetry || {};
        const { ST, LT } = getShortLongSentiment(stock, hist) || {};

        // bookkeeping for raw signal counts
        if (sig?.buyNow) {
          signalsTotal++;
          if (i >= WARMUP) signalsAfterWarmup++;
          const dayISOforSig = toISO(today.date);
          signalsByDay.set(
            dayISOforSig,
            (signalsByDay.get(dayISOforSig) || 0) + 1
          );
        }

        // trend telemetry from new output
        const trendNow = teleSig?.context?.trend;
        if (trendNow && telemetry.trends.hasOwnProperty(trendNow)) {
          telemetry.trends[trendNow]++;
        }

        if (!sig?.buyNow) {
          // record rejection reasons & simulate "what if we ignored the no?"
          const reasonsArr = Array.isArray(teleSig.reasons)
            ? teleSig.reasons.slice(0, 2)
            : [sig?.reason || "unspecified"];

          // structure gate fail?
          if (teleSig?.gates && teleSig.gates.structure) {
            if (!teleSig.gates.structure.pass) {
              telemetry.gates.structureGateFailed++;
            }
          }

          // gather dip/guard/RR stats from reasons text
          for (const r of reasonsArr) {
            if (typeof r !== "string") continue;

            // dip not ready / waitReason
            if (r.startsWith("DIP not ready:")) {
              const why = afterColon(r, "DIP not ready:").replace(
                /^[:\s]+/,
                ""
              );
              inc(telemetry.dip.notReadyReasons, why || "unspecified");
            }

            if (r === "Structure gate: trend not up or price < MA5.") {
              telemetry.gates.structureGateFailed++;
            }

            if (r.match(/^(DIP|SPC|OXR|BPB|RRP)\s+guard veto:/i)) {
              const gr = extractGuardReason(r);
              inc(telemetry.dip.guardVetoReasons, gr || "guard");
            }

            if (r.match(/^(DIP|SPC|OXR|BPB|RRP)\s+RR too low:/i)) {
              const m = r.match(/need\s+([0-9.]+)/i);
              const need = m ? parseFloat(m[1]) : NaN;
              inc(telemetry.rr.rejected, bucketize(need));
            }
          }

          // simulate rejected trade (counterfactual)
          if (SIM_REJECTED) {
            const entry = today.close;

            // planned target/stop using floor stop
            const simTarget = Number(sig?.smartPriceTarget ?? sig?.priceTarget);
            const simStop = entry * (1 - HARD_STOP_PCT);

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

              const kKey = sentiKey(ST, LT);
              if (!sentiment.rejected[kKey])
                sentiment.rejected[kKey] = sentiInit();
              if (outcome.result !== "OPEN") {
                sentiUpdate(sentiment.rejected[kKey], outcome);
                parallel.rejectedBuys.totalSimulated++;
                if (outcome.result === "WIN") {
                  parallel.rejectedBuys.winners++;
                }
              }

              if (Number.isFinite(LT)) {
                if (!sentiment.rejectedLT[LT]) {
                  sentiment.rejectedLT[LT] = sentiInit();
                }
                if (outcome.result !== "OPEN") {
                  sentiUpdate(sentiment.rejectedLT[LT], outcome);
                }
              }

              if (Number.isFinite(ST)) {
                if (!sentiment.rejectedST[ST]) {
                  sentiment.rejectedST[ST] = sentiInit();
                }
                if (outcome.result !== "OPEN") {
                  sentiUpdate(sentiment.rejectedST[ST], outcome);
                }
              }

              for (const rawReason of reasonsArr) {
                const norm = normalizeRejectedReason(rawReason);
                if (!parallel.rejectedBuys.byReasonRaw[norm]) {
                  parallel.rejectedBuys.byReasonRaw[norm] = cfInitAgg();
                }
                cfUpdateAgg(parallel.rejectedBuys.byReasonRaw[norm], outcome);

                if (outcome.result === "WIN") {
                  if (!parallel.rejectedBuys.examples[norm])
                    parallel.rejectedBuys.examples[norm] = [];
                  if (
                    parallel.rejectedBuys.examples[norm].length < EXAMPLE_MAX
                  ) {
                    parallel.rejectedBuys.examples[norm].push({
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

          // also stash examples of "rejected" for debugging
          if (
            telemetry.examples.rejected.length < EXAMPLE_MAX &&
            reasonsArr.length
          ) {
            telemetry.examples.rejected.push({
              ticker: code,
              date: toISO(today.date),
              reasons: reasonsArr,
            });
          }
        } else {
          // buyNow === true

          // estimated RR for telemetry
          let rRatio = Number(teleSig?.rr?.ratio);
          if (!Number.isFinite(rRatio)) {
            const pxNow = today.close;
            const rawTarget = Number(sig?.smartPriceTarget ?? sig?.priceTarget);
            const rawStop = pxNow * (1 - HARD_STOP_PCT);
            if (
              Number.isFinite(rawStop) &&
              Number.isFinite(rawTarget) &&
              rawStop < pxNow &&
              rawTarget > pxNow
            ) {
              const reward = rawTarget - pxNow;
              const risk = pxNow - rawStop;
              if (risk > 0) {
                rRatio = reward / risk;
              }
            }
          }
          inc(telemetry.rr.accepted, bucketize(rRatio));

          if (telemetry.examples.buyNow.length < EXAMPLE_MAX) {
            telemetry.examples.buyNow.push({
              ticker: code,
              date: toISO(today.date),
              reason: sig?.reason || "",
              rr: Number.isFinite(rRatio) ? r2(rRatio) : null,
            });
          }

          // warmup is the only blocker now
          const eligibleNow = i >= WARMUP;

          if (eligibleNow) {
            signalsWhileFlat++;
          } else {
            if (COUNT_BLOCKED) {
              if (i < WARMUP) blockedWarmup++;
            }
          }

          if (eligibleNow) {
            // Enter next bar open (or same bar if no next bar)
            const hasNext = i + 1 < candles.length;
            const entryBarIdx = hasNext ? i + 1 : i;
            const entryBar = hasNext ? candles[i + 1] : today;
            const entry = hasNext ? entryBar.open : today.close;

            // planned stop/target (15% floor stop)
            const planned = computePlannedLevels({
              entry,
              sig,
            });
            const stop = Number(planned.stop);
            const target = Number(planned.target);

            if (
              !Number.isFinite(stop) ||
              !Number.isFinite(target) ||
              stop >= entry
            ) {
              signalsInvalid++;
            } else {
              const qStop = toTick(stop, stock);
              const qTarget = toTick(target, stock);

              // cross meta from new API
              const cm = sig?.meta?.cross || {};
              // selected could now be WEEKLY, DAILY, BOTH, DIP_WEEKLY, DIP_DAILY, or NONE
              const selectedRaw = cm?.selected || null;

              // pick crossType we store in trade:
              // - WEEKLY / DAILY / BOTH => keep that
              // - DIP_WEEKLY => treat as WEEKLY for attribution
              // - DIP_DAILY  => treat as DAILY for attribution
              // - NONE or anything else => "OTHER"
              let crossTypeForTrade = null;
              if (
                selectedRaw === "WEEKLY" ||
                selectedRaw === "DAILY" ||
                selectedRaw === "BOTH"
              ) {
                crossTypeForTrade = selectedRaw;
              } else if (selectedRaw === "DIP_WEEKLY") {
                crossTypeForTrade = "WEEKLY";
              } else if (selectedRaw === "DIP_DAILY") {
                crossTypeForTrade = "DAILY";
              } else {
                crossTypeForTrade = "OTHER";
              }

              // lag:
              // WEEKLY => weeksAgo
              // DAILY => daysAgo
              // BOTH  => min of both
              // DIP_WEEKLY -> use weekly.weeksAgo
              // DIP_DAILY -> use daily.daysAgo
              // OTHER/NONE -> null
              let lag = null;
              if (selectedRaw === "WEEKLY" && cm.weekly) {
                lag = cm.weekly.barsAgo ?? cm.weekly.weeksAgo ?? null;
              } else if (selectedRaw === "DAILY" && cm.daily) {
                lag = cm.daily.barsAgo ?? cm.daily.daysAgo ?? null;
              } else if (selectedRaw === "BOTH") {
                const wLag =
                  cm.weekly?.barsAgo ?? cm.weekly?.weeksAgo ?? Infinity;
                const dLag = cm.daily?.barsAgo ?? cm.daily?.daysAgo ?? Infinity;
                const bestLag = Math.min(wLag, dLag);
                lag = Number.isFinite(bestLag) ? bestLag : null;
              } else if (selectedRaw === "DIP_WEEKLY" && cm.weekly) {
                lag = cm.weekly.barsAgo ?? cm.weekly.weeksAgo ?? null;
              } else if (selectedRaw === "DIP_DAILY" && cm.daily) {
                lag = cm.daily.barsAgo ?? cm.daily.daysAgo ?? null;
              }

              // analytics snapshot
              const analytics = computeAnalytics(candles, entryBarIdx, entry);

              // ATR % telemetry only
              const entryATR =
                (atrArr(candles.slice(0, entryBarIdx + 1), 14) || [])[ // expensive but ok
                  entryBarIdx
                ] || 0;
              const atrPctNow =
                analytics.atrPct ??
                (entryATR && entry ? (entryATR / entry) * 100 : 0);

              const tooWild =
                Number.isFinite(atrPctNow) && atrPctNow > MAX_ATR_PCT;
              if (tooWild) {
                telemetry.gates.tooWildAtr++;
              }

              // regimeFiltered telemetry only
              if (
                allowedRegimes &&
                !allowedRegimes.has(dayRegime) &&
                COUNT_BLOCKED
              ) {
                telemetry.gates.regimeFiltered++;
              }

              // build "kind" label for trade from sig.reason prefix
              // e.g. "WEEKLY CROSS: 1.8:1 ..." -> "WEEKLY CROSS"
              let kindLabel = "UNKNOWN";
              if (typeof sig?.reason === "string" && sig.reason.length) {
                const firstColon = sig.reason.indexOf(":");
                kindLabel =
                  firstColon === -1
                    ? sig.reason.trim()
                    : sig.reason.slice(0, firstColon).trim();
              }

              openPositions.push({
                entryIdx: entryBarIdx,
                entry,
                stop: qStop,
                initialStop: qStop,
                target: qTarget,

                maxLossFloor: qStop, // 15% floor

                ST,
                LT,
                regime: dayRegime,
                kind: kindLabel,
                crossType: crossTypeForTrade,
                crossLag: Number.isFinite(lag) ? lag : null,

                analytics,
                sector: tickerInfoMap[code]?.sector || null,
              });

              globalOpenCount++;
              signalsExecuted++;
            }
          }
        }
      } // candle loop

      // force close leftovers at the end
      if (openPositions.length) {
        const lastIdx = candles.length - 1;
        const lastBar = candles[lastIdx];
        const rawLastClose = lastBar.close;

        for (const st of openPositions) {
          const ageBars = lastIdx - st.entryIdx;
          let realizedExitPx = rawLastClose;
          if (Number.isFinite(st.maxLossFloor)) {
            realizedExitPx = Math.max(realizedExitPx, st.maxLossFloor);
          }

          const overMaxHold = HOLD_BARS > 0 && ageBars >= HOLD_BARS;
          const exitTypeFinal = overMaxHold ? "TIME" : "END";
          const endResult = realizedExitPx >= st.entry ? "WIN" : "LOSS";

          const holdingBarsFinal =
            HOLD_BARS > 0 ? Math.min(ageBars, HOLD_BARS) : ageBars;

          const baseRisk = st.entry - st.initialStop;
          const risk = Math.max(0.01, baseRisk);
          const Rval = r2((realizedExitPx - st.entry) / risk);

          const isDipAfterFreshCrossSignal =
            /DIP/i.test(st.kind || "") &&
            (st.crossType === "WEEKLY" ||
              st.crossType === "DAILY" ||
              st.crossType === "BOTH") &&
            Number.isFinite(st.crossLag) &&
            st.crossLag <= 3;

          const trade = {
            ticker: code,
            strategy: st.kind || "DIP",

            entryDate: toISO(candles[st.entryIdx].date),
            exitDate: toISO(lastBar.date),
            returnPct: r2(((realizedExitPx - st.entry) / st.entry) * 100),
            result: endResult,

            holdingDays: holdingBarsFinal,
            exitType: exitTypeFinal,

            entry: r2(st.entry),
            exit: r2(realizedExitPx),
            stop: st.initialStop,
            target: st.target,
            R: Rval,

            ST: st.ST,
            LT: st.LT,
            regime: st.regime || "RANGE",
            crossType: st.crossType || null,
            crossLag: Number.isFinite(st.crossLag) ? st.crossLag : null,
            analytics: st.analytics || null,

            sector: tickerInfoMap[code]?.sector || st.sector || null,

            dipAfterFreshCross: isDipAfterFreshCrossSignal,
          };

          trade.entryArchetype = trade.dipAfterFreshCross
            ? "DIP_AFTER_FRESH_CROSS"
            : trade.crossType || "OTHER";

          trades.push(trade);
          globalTrades.push(trade);
        }

        globalOpenCount = Math.max(0, globalOpenCount - openPositions.length);
        openPositions = [];
      }

      // per-ticker summary
      const m = computeMetrics(trades);
      console.log(
        `[BT] finished ${ti + 1}/${codes.length}: ${code} | trades=${
          trades.length
        } | winRate=${m.winRate}% | avgRet=${m.avgReturnPct}% | PF=${
          m.profitFactor
        }`
      );

      const analysis = buildTickerAnalysis(code, trades);

      byTicker.push({ ticker: code, trades, metrics: m, analysis });
    } catch (errTicker) {
      console.warn(
        `[BT] ERROR processing ${code}: ${String(errTicker).slice(0, 200)}`
      );
      skippedTickers.push({
        ticker: code,
        reason: `exception: ${String(errTicker).slice(0, 200)}`,
      });
      // continue loop
    }
  } // tickers loop

  // ---- final aggregation ----
  const all = byTicker.length
    ? byTicker.flatMap((t) => t.trades)
    : globalTrades;

  const days = tradingDays.size;
  const targetTPD =
    Number.isFinite(opts.targetTradesPerDay) && opts.targetTradesPerDay > 0
      ? Number(opts.targetTradesPerDay)
      : null;

  // rejected buys aggregation
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

  const sentiActualLT = finalizeSentiTable(sentiment.actualLT);
  const sentiRejectedLT = finalizeSentiTable(sentiment.rejectedLT);
  const sentiActualST = finalizeSentiTable(sentiment.actualST);
  const sentiRejectedST = finalizeSentiTable(sentiment.rejectedST);

  // "profile" == everything
  const thisProfileTrades = all;
  const thisProfileMetrics = computeMetrics(thisProfileTrades);

  // catastrophic stop suggestion
  let catastrophicStopSuggestion = null;
  if (
    thisProfileMetrics.lossTail &&
    thisProfileMetrics.lossTail.countLosses > 5 &&
    Number.isFinite(thisProfileMetrics.lossTail.p90LossPct)
  ) {
    catastrophicStopSuggestion = {
      killAtPct: thisProfileMetrics.lossTail.p90LossPct,
      comment:
        "If you hard-stop at this %, ~90% of losers are capped before turning catastrophic.",
    };
  }

  // strategy breakdown (WEEKLY CROSS, DAILY CROSS, DIP AFTER WEEKLY, etc.)
  const byKind = {};
  for (const t of all) {
    const k = t.strategy || "DIP";
    if (!byKind[k]) byKind[k] = [];
    byKind[k].push(t);
  }
  const strategyBreakdown = Object.fromEntries(
    Object.entries(byKind).map(([k, v]) => [k, computeMetrics(v)])
  );

  // regime metrics
  const regimeMetrics = {};
  for (const key of Object.keys(regimeAgg)) {
    regimeMetrics[key] = computeMetrics(regimeAgg[key]);
  }

  // DIP-after-cross metrics
  const dipAfterMetrics = {
    WEEKLY: computeMetrics(dipAfterAgg.WEEKLY),
    DAILY: computeMetrics(dipAfterAgg.DAILY),
  };

  // CROSSING by lag
  const crossLagBuckets = { WEEKLY: {}, DAILY: {} };

  for (const t of all) {
    const typ = t.crossType;
    if (typ === "WEEKLY" || typ === "DAILY") {
      const lag = Number.isFinite(t.crossLag) ? t.crossLag : -1;
      if (!crossLagBuckets[typ][lag]) crossLagBuckets[typ][lag] = [];
      crossLagBuckets[typ][lag].push(t);
    } else if (typ === "BOTH") {
      const lag = Number.isFinite(t.crossLag) ? t.crossLag : -1;

      if (!crossLagBuckets.WEEKLY[lag]) crossLagBuckets.WEEKLY[lag] = [];
      if (!crossLagBuckets.DAILY[lag]) crossLagBuckets.DAILY[lag] = [];

      crossLagBuckets.WEEKLY[lag].push(t);
      crossLagBuckets.DAILY[lag].push(t);
    }
    // "OTHER" we don't bucket by lag
  }

  function toMetricsMap(buckets) {
    const out = {};
    for (const lagStr of Object.keys(buckets).sort(
      (a, b) => Number(a) - Number(b)
    )) {
      const lag = +lagStr;
      out[lag] = computeMetrics(buckets[lagStr]);
    }
    return out;
  }
  const crossingByLag = {
    WEEKLY: toMetricsMap(crossLagBuckets.WEEKLY),
    DAILY: toMetricsMap(crossLagBuckets.DAILY),
  };

  // Volatility buckets
  function bucketAtrPct(v) {
    if (!Number.isFinite(v)) return "na";
    if (v < 2) return "<2%";
    if (v < 4) return "2-4%";
    if (v < 6) return "4-6%";
    return ">=6%";
  }

  const volBuckets = {};
  for (const t of all) {
    const ap = t.analytics?.atrPct;
    const b = bucketAtrPct(ap);
    if (!volBuckets[b]) volBuckets[b] = [];
    volBuckets[b].push(t);
  }

  const volatilityBuckets = Object.fromEntries(
    Object.entries(volBuckets).map(([bucket, list]) => [
      bucket,
      computeMetrics(list),
    ])
  );

  const globalMetrics = computeMetrics(all);

  const totalTrades = globalMetrics.trades;
  const winRate = globalMetrics.winRate;
  const avgReturnPct = globalMetrics.avgReturnPct;
  const avgHoldingDays = globalMetrics.avgHoldingDays;

  const hitTargetCount = globalMetrics.exits.target;
  const hitStopCount = globalMetrics.exits.stop;
  const timeExitCount = globalMetrics.exits.time;

  const tradesPerDay = days ? totalTrades / days : 0;

  console.log(
    `[BT] COMPLETE | trades=${totalTrades} | winRate=${winRate}% | avgReturn=${avgReturnPct}% | avgHold=${avgHoldingDays} bars | exits — target:${hitTargetCount} stop:${hitStopCount} time:${timeExitCount}`
  );
  console.log(
    `[BT] SIGNALS | total=${signalsTotal} | afterWarmup=${signalsAfterWarmup} | whileFlat=${signalsWhileFlat} | executed=${signalsExecuted} | invalid=${signalsInvalid} | riskStop>=px=${signalsRiskBad} | blocked: inTrade=${blockedInTrade} cooldown=${blockedCooldown} warmup=${blockedWarmup}`
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

  const dipMetrics = strategyBreakdown.DIP || computeMetrics(all);
  const signalsDayCount = signalsByDay.size || days || 1;
  void signalsDayCount; // (kept for any future per-day calc)

  // spotlight best/worst ticker by PF
  const spotlightRankBase = byTicker.filter((r) => r.trades && r.trades.length);
  const ranked = [...spotlightRankBase].sort(
    (a, b) => b.metrics.profitFactor - a.metrics.profitFactor
  );
  const spotlight = {
    best: ranked[0]
      ? {
          ticker: ranked[0].ticker,
          pf: ranked[0].metrics.profitFactor,
          winRate: ranked[0].metrics.winRate,
          why: ranked[0].analysis.summary,
        }
      : null,
    worst:
      ranked.length > 1
        ? {
            ticker: ranked[ranked.length - 1].ticker,
            pf: ranked[ranked.length - 1].metrics.profitFactor,
            winRate: ranked[ranked.length - 1].metrics.winRate,
            why: ranked[ranked.length - 1].analysis.summary,
          }
        : null,
  };

  return {
    from: FROM,
    to: TO,

    totalTrades: totalTrades,
    winRate: winRate,
    avgReturnPct: avgReturnPct,
    avgHoldingDays: avgHoldingDays,
    tradesPerDay: tradesPerDay,
    tradingDays: days,

    skippedTickers, // <--- tickers we couldn't process

    params: {
      holdBars: HOLD_BARS,
      warmupBars: WARMUP,
      cooldownDays: COOLDOWN,
      targetTradesPerDay: targetTPD,
      countBlockedSignals: COUNT_BLOCKED,
      includeByTicker: INCLUDE_BY_TICKER,
      maxAtrPct: MAX_ATR_PCT,
      simulateRejectedBuys: SIM_REJECTED,
      topRejectedReasons: TOP_K,
      examplesCap: EX_CAP,
      includeProfileSamples: INCLUDE_PROFILE_SAMPLES,

      breakevenR: opts.breakevenR ?? 0.8,

      maxConcurrent: MAX_CONCURRENT, // telemetry only
      regimeTicker: REGIME_TICKER,
      allowedRegimes: allowedRegimes ? Array.from(allowedRegimes) : [],
    },

    spotlight,

    signals: {
      total: signalsTotal,
      afterWarmup: signalsAfterWarmup,
      whileFlat: signalsWhileFlat,
      executed: signalsExecuted,
      invalid: signalsInvalid,
      riskStopGtePx: signalsRiskBad,
      perDay: +(
        Array.from(signalsByDay.values()).reduce((a, b) => a + b, 0) /
        (signalsByDay.size || days || 1)
      ).toFixed(2),
      blocked: {
        inTrade: blockedInTrade,
        cooldown: blockedCooldown,
        warmup: blockedWarmup,
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
      combos: {
        actual: sentiActual.combos,
        rejected: sentiRejected.combos,
        bestByWinRate: sentiment.bestByWinRate,
      },
      byLT: {
        actual: sentiActualLT.combos,
        rejected: sentiRejectedLT.combos,
        bestByWinRateActual: sentiActualLT.bestByWinRate,
        bestByWinRateRejected: sentiRejectedLT.bestByWinRate,
      },
      byST: {
        actual: sentiActualST.combos,
        rejected: sentiRejectedST.combos,
        bestByWinRateActual: sentiActualST.bestByWinRate,
        bestByWinRateRejected: sentiRejectedST.bestByWinRate,
      },
    },

    regime: {
      ticker: REGIME_TICKER,
      metrics: regimeMetrics,
    },

    crossing: {
      byLag: crossingByLag,
    },

    dipAfterFreshCrossing: {
      WEEKLY: dipAfterMetrics.WEEKLY,
      DAILY: dipAfterMetrics.DAILY,
    },

    volatility: {
      byAtrPctBucket: volatilityBuckets,
    },

    singleProfile: {
      label: "target_only (with 15% floor)",
      metrics: thisProfileMetrics,
      exits: {
        target: thisProfileTrades.filter((t) => t.exitType === "TARGET").length,
        stop: thisProfileTrades.filter((t) => t.exitType === "STOP").length,
        time: thisProfileTrades.filter((t) => t.exitType === "TIME").length,
        end: thisProfileTrades.filter((t) => t.exitType === "END").length,
      },
      catastrophicStopSuggestion,
      ...(INCLUDE_PROFILE_SAMPLES
        ? { samples: thisProfileTrades.slice(0, 8) }
        : {}),
    },

    ...(INCLUDE_BY_TICKER ? { byTicker } : {}),
  };
}

/* ------------------------ metrics helpers ------------------------ */

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b); // ascending
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  const w = rank - low;
  return sorted[low] * (1 - w) + sorted[high] * w;
}

function computeMetrics(trades) {
  const capped = trades.map((t) => {
    const rp = Number(t.returnPct) || 0;
    const cappedRet = Math.max(-50, Math.min(50, rp));
    return { ...t, _retPctForStats: cappedRet };
  });

  const n = capped.length;
  const wins = capped.filter((t) => t.result === "WIN");
  const losses = capped.filter((t) => t.result === "LOSS");

  const winRate = n ? (wins.length / n) * 100 : 0;
  const avgReturnPct = n ? sum(capped.map((t) => t._retPctForStats)) / n : 0;
  const avgHoldingDays = n ? sum(capped.map((t) => t.holdingDays || 0)) / n : 0;

  const avgWinPct = wins.length
    ? sum(wins.map((t) => t._retPctForStats)) / wins.length
    : 0;

  const avgLossPct = losses.length
    ? sum(losses.map((t) => t._retPctForStats)) / losses.length
    : 0;

  const lossPcts = losses.map((t) => t._retPctForStats);
  const maxLossPct = lossPcts.length ? Math.min(...lossPcts) : 0;
  const minLossPct = lossPcts.length ? Math.max(...lossPcts) : 0;
  const p90LossPct = lossPcts.length ? percentile(lossPcts, 10) : 0;
  const p95LossPct = lossPcts.length ? percentile(lossPcts, 5) : 0;

  const rWins = wins
    .map((t) => (Number.isFinite(t.R) ? t.R : null))
    .filter(Number.isFinite);
  const rLosses = losses
    .map((t) => (Number.isFinite(t.R) ? t.R : null))
    .filter(Number.isFinite);

  const avgRwin = rWins.length ? sum(rWins) / rWins.length : 0;
  const avgRloss = rLosses.length ? sum(rLosses) / rLosses.length : 0;
  const p = n ? wins.length / n : 0;
  const expR = p * avgRwin + (1 - p) * avgRloss;

  const grossWin = sum(wins.map((t) => t._retPctForStats));
  const grossLossAbs = Math.abs(sum(losses.map((t) => t._retPctForStats)));
  const profitFactor = grossLossAbs
    ? grossWin / grossLossAbs
    : wins.length
    ? Infinity
    : 0;

  const exits = {
    target: trades.filter((t) => t.exitType === "TARGET").length,
    stop: trades.filter((t) => t.exitType === "STOP").length,
    time: trades.filter((t) => t.exitType === "TIME").length,
    end: trades.filter((t) => t.exitType === "END").length,
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
    profitFactor: Number.isFinite(profitFactor) ? r2(profitFactor) : "Infinity",
    exits,
    lossTail: {
      minLossPct: r2(minLossPct),
      maxLossPct: r2(maxLossPct),
      p90LossPct: r2(p90LossPct),
      p95LossPct: r2(p95LossPct),
      countLosses: losses.length,
    },
  };
}

function sum(arr) {
  return arr.reduce((a, b) => a + (Number(b) || 0), 0);
}

/* --------------------------- expose for Bubble -------------------------- */
window.backtest = async (tickersOrOpts, maybeOpts) => {
  // let it throw if runBacktest throws
  return Array.isArray(tickersOrOpts)
    ? await runBacktest(tickersOrOpts, { ...maybeOpts })
    : await runBacktest({ ...(tickersOrOpts || {}) });
};
