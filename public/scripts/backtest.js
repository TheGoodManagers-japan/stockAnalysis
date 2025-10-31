// /scripts/backtest.js — swing-period backtest (browser) — RAW LEVELS + REGIME
// Next-bar-open entries, optional time-based exit,
// optional ATR trailing stop (no lookahead),
// sentiment gates, and Nikkei-based market regime tagging & metrics.
//
// Options you may pass to window.backtest(..., opts):
//   - holdBars: 0 (default = disabled). Set >0 to enforce hard time exit.
//   - maxConcurrent: 0 (default = unlimited global positions)
//   - simulateRejectedBuys: true
//   - months/from/to/limit/warmupBars/cooldownDays/appendTickers/... (unchanged)
//   - regimeTicker: "1321.T" (default Nikkei 225 ETF proxy)
//   - allowedRegimes: ["UP","STRONG_UP"] to only trade in those regimes
//
// NOTE: This build supports two profiles:
// - raw_signal_levels: use signal's raw stop/target (no adjustments)
// - atr_trail: same entry levels but updates stop with an ATR chandelier trail (no lookahead)
// Toggle with opts.useTrailing (default true). Profile IDs are returned.


import {
  analyzeSwingTradeEntry,
  analyseCrossing,
} from "./swingTradeEntryTiming.js";
import {
  enrichForTechnicalScore,
  getSentimentCombinationRank,
} from "./main.js";
import { allTickers } from "./tickers.js";
import { getComprehensiveMarketSentiment } from "./marketSentimentOrchestrator.js";

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
function median(arr){ if(!arr.length) return NaN; const a=[...arr].sort((x,y)=>x-y); const m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2; }
function pct(n,d){ return d? +(((n/d)*100).toFixed(2)) : 0; }

function buildTickerAnalysis(ticker, trades){
  if(!trades.length) return {summary:`No trades for ${ticker}.`, detail:{}};

  const wins = trades.filter(t=>t.result==="WIN");
  const losses = trades.filter(t=>t.result==="LOSS");
  const n = trades.length;

  // Regime breakdown
  const regimes = ["STRONG_UP","UP","RANGE","DOWN"];
  const regCount = (list)=>Object.fromEntries(regimes.map(r=>[r, list.filter(t=>t.regime===r).length]));
  const regWins = regCount(wins);
  const regLoss = regCount(losses);

  // Exit breakdown
  const exitCount = (list, type)=>list.filter(t=>t.exitType===type).length;

  // Cross type/lag
  const lagVals = (list, typ)=>list.filter(t=>t.crossType===typ && Number.isFinite(t.crossLag)).map(t=>t.crossLag);
  const wLagW = median(lagVals(wins, "WEEKLY"));
  const wLagD = median(lagVals(wins, "DAILY"));
  const lLagW = median(lagVals(losses, "WEEKLY"));
  const lLagD = median(lagVals(losses, "DAILY"));

  // R & holding
  const medRwin = median(wins.map(t=>t.R||0));
  const medRloss = median(losses.map(t=>t.R||0));
  const medHoldWin = median(wins.map(t=>t.holdingDays||0));
  const medHoldLoss = median(losses.map(t=>t.holdingDays||0));

  // Risk/target geometry at entry
  const riskAtEntry = (t)=>Math.max(0.01, t.entry - t.stop);
  const rrAtEntry   = (t)=> (t.target - t.entry) / Math.max(0.01, t.entry - t.stop);
  const medRRwin = median(wins.map(rrAtEntry));
  const medRRloss = median(losses.map(rrAtEntry));
  const tightStopsLossPct = pct(losses.filter(t=>riskAtEntry(t) <= (t.entry*0.008)).length, losses.length); // ≤0.8% risk

  // Sentiment combos
  const key = (t)=>`LT${Number.isFinite(t.LT)?t.LT:4}-ST${Number.isFinite(t.ST)?t.ST:4}`;
  const topSenti = (list)=>{
    const m = new Map();
    for(const t of list){ const k=key(t); m.set(k, (m.get(k)||0)+1); }
    return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,c])=>`${k} (${c})`);
  };

  // Exit types
  const stopL = exitCount(losses,"STOP"), tgtW = exitCount(wins,"TARGET");
  const timeW = exitCount(wins,"TIME"), timeL = exitCount(losses,"TIME");

  // Concise bullets (kept for UI if you want to show them)
  const bullets = [];
  const worstReg = regimes.sort((a,b)=> (regLoss[b]-regLoss[a]))[0];
  const bestReg  = regimes.sort((a,b)=> (regWins[b]-regWins[a]))[0];
  if(regWins[bestReg]) bullets.push(`Wins clustered in **${bestReg}** (wins ${regWins[bestReg]}/${wins.length}).`);
  if(regLoss[worstReg]) bullets.push(`Losses clustered in **${worstReg}** (losses ${regLoss[worstReg]}/${losses.length}).`);

  const lagBits = [];
  if(Number.isFinite(wLagW)) lagBits.push(`weekly lag≈${wLagW}`);
  if(Number.isFinite(wLagD)) lagBits.push(`daily lag≈${wLagD}`);
  if(lagBits.length) bullets.push(`Winning entries tended to be **fresh**: ${lagBits.join(", ")}.`);
  const lagLossBits = [];
  if(Number.isFinite(lLagW)) lagLossBits.push(`weekly lag≈${lLagW}`);
  if(Number.isFinite(lLagD)) lagLossBits.push(`daily lag≈${lLagD}`);
  if(lagLossBits.length) bullets.push(`Losing entries were **late**: ${lagLossBits.join(", ")}.`);

  if(Number.isFinite(medRRwin) && Number.isFinite(medRRloss)){
    bullets.push(`Median RR at entry — wins **${medRRwin.toFixed(2)}:1**, losses **${medRRloss.toFixed(2)}:1**.`);
  }
  bullets.push(`Stops hit on **${pct(stopL, losses.length)}%** of losses; targets hit on **${pct(tgtW, wins.length)}%** of wins.`);
  if(Number.isFinite(medHoldWin) && Number.isFinite(medHoldLoss)){
    bullets.push(`Holding: wins median **${medHoldWin} bars**, losses **${medHoldLoss} bars**.`);
  }
  if(losses.length) bullets.push(`Atypical tight-risk losses: **${tightStopsLossPct}%** (risk ≤0.8% of entry).`);
  const topW = topSenti(wins), topL = topSenti(losses);
  if(topW.length) bullets.push(`Winning sentiment combos: ${topW.join(", ")}.`);
  if(topL.length) bullets.push(`Losing sentiment combos: ${topL.join(", ")}.`);

  const wr = pct(wins.length, n);
  const pf = (()=>{
    const gw = wins.reduce((a,t)=>a+(t.returnPct||0),0);
    const gl = Math.abs(losses.reduce((a,t)=>a+(t.returnPct||0),0));
    return gl? +(gw/gl).toFixed(2) : (wins.length? Infinity:0);
  })();

  const summary = `${ticker}: ${n} trades | winRate ${wr}% | PF ${pf}. ` +
    `Wins concentrated in ${bestReg}; losses in ${worstReg}. ` +
    (Number.isFinite(wLagD)||Number.isFinite(wLagW) ? `Fresh-cross lags helped winners; ` : ``) +
    (Number.isFinite(lLagD)||Number.isFinite(lLagW) ? `late lags hurt losers. ` : ``) +
    `Median RR (win vs loss): ${Number.isFinite(medRRwin)?medRRwin.toFixed(2):"?"}:${Number.isFinite(medRRloss)?medRRloss.toFixed(2):"?"}.`;

  return {
    summary,
    detail: {
      count: n,
      wins: wins.length,
      losses: losses.length,
      regimes: { wins: regWins, losses: regLoss },
      rr: { medianWin: medRRwin, medianLoss: medRRloss },
      holdingDays: { medianWin: medHoldWin, medianLoss: medHoldLoss },
      crossLag: { win: { weekly:wLagW, daily:wLagD }, loss: { weekly:lLagW, daily:lLagD } },
      exits: { stopLosses: stopL, targetWins: tgtW, timeWins: timeW, timeLosses: timeL },
      tightRiskLossPct: tightStopsLossPct,
      topSentiment: { wins: topW, losses: topL },
      bullets, // optional for UI
    }
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

/* ---------------------- REGIME HELPERS (Nikkei-based) ---------------------- */
const DEFAULT_REGIME_TICKER = "1321.T"; // Nikkei 225 ETF (you can change via opts.regimeTicker)

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

/* ---------------- Analytics helpers (for per-trade 'analytics' block) ---------------- */
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
  let gain = 0, loss = 0;
  for (let i = 1; i <= p; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) gain += ch; else loss -= ch;
  }
  gain /= p; loss /= p;
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

// ATR(14) (Wilder's smoothing), returned in ABSOLUTE POINTS
function atrArr(candles, p = 14) {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  const out = new Array(candles.length).fill(NaN);
  const tr = (i) => {
    const h = Number(candles[i].high ?? candles[i].close ?? 0);
    const l = Number(candles[i].low ?? candles[i].close ?? 0);
    const pc = Number(candles[i - 1]?.close ?? h);
    return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  };
  if (candles.length <= p) return out;
  // First TR average
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

// rolling mean/std for Z-score (volume)
function rollingMeanStd(arr, win = 20) {
  const n = arr.length;
  const mean = new Array(n).fill(NaN);
  const stdev = new Array(n).fill(NaN);
  if (n === 0) return { mean, stdev };
  let sum = 0, sumsq = 0, q = [];
  for (let i = 0; i < n; i++) {
    const x = Number(arr[i]) || 0;
    q.push(x);
    sum += x;
    sumsq += x * x;
    if (q.length > win) {
      const y = q.shift();
      sum -= y; sumsq -= y * y;
    }
    const m = sum / q.length;
    const v = Math.max(0, sumsq / q.length - m * m);
    mean[i] = m;
    stdev[i] = Math.sqrt(v);
  }
  return { mean, stdev };
}

/**
 * Compute per-entry analytics at bar index `idx` using the price we actually enter (next open).
 * Returns an object with the fields expected by the analyzer.
 */
function computeAnalytics(candles, idx, entry) {
  const closes = candles.map(c => Number(c.close) || 0);
  const vols   = candles.map(c => Number(c.volume) || 0);

  const ma5  = smaArr(closes, 5);
  const ma25 = smaArr(closes, 25);
  const ma75 = smaArr(closes, 75);
  const rsi14 = rsiArr(closes, 14);
  const atr14 = atrArr(candles, 14);
  const { mean: vMean, stdev: vStd } = rollingMeanStd(vols, 20);

  const px    = Number(entry) || closes[idx];
  const prevC = idx > 0 ? closes[idx - 1] : closes[idx];

  const m25 = Number(ma25[idx]);
  const m75 = Number(ma75[idx]);
  const m5  = Number(ma5[idx]);
  const atr = Number(atr14[idx]) || 0;

  const rsi = Number(rsi14[idx]);
  const atrPct = atr && px ? (atr / px) * 100 : 0;

  const vmu = Number(vMean[idx]) || 0;
  const vsd = Number(vStd[idx]) || 0;
  const vol = Number(vols[idx]) || 0;
  const volZ = vsd > 0 ? (vol - vmu) / vsd : 0;

  const gapPct = prevC ? ((px - prevC) / prevC) * 100 : 0;
  const pxVsMA25Pct = Number.isFinite(m25) && m25 !== 0 ? ((px - m25) / m25) * 100 : NaN;

  // Simple stacking score: +1 if MA5>MA25, +1 if MA25>MA75, +1 if price>MA25
  let maStackScore = 0;
  if (Number.isFinite(m5) && Number.isFinite(m25) && m5 > m25) maStackScore += 1;
  if (Number.isFinite(m25) && Number.isFinite(m75) && m25 > m75) maStackScore += 1;
  if (Number.isFinite(m25) && px > m25) maStackScore += 1;

  const pxAboveMA25 = Number.isFinite(m25) ? px > m25 : false;
  const pxAboveMA75 = Number.isFinite(m75) ? px > m75 : false;

  return {
    rsi: Number.isFinite(rsi) ? +rsi.toFixed(2) : null,
    atrPct: +atrPct.toFixed(2),
    volZ: Number.isFinite(volZ) ? +volZ.toFixed(2) : null,
    gapPct: +gapPct.toFixed(2),
    pxVsMA25Pct: Number.isFinite(pxVsMA25Pct) ? +pxVsMA25Pct.toFixed(2) : null,
    maStackScore,
    pxAboveMA25,
    pxAboveMA75
  };
}


// === SCORING (uses your observed lifts; higher is better) ===
// Weights reflect your analysis:
// - Regime: DOWN > UP (STRONG_UP/RANGE neutral)
// - Cross-lag: WEEKLY lag>=2 strong; DAILY lag>=4 helpful
// - Sentiment: LT in 3–5 (bullish), ST in 6–7 (bearish = pullback)
// - Analytics: gap>0, RSI>=60 (top-ish tercile), pxVsMA25Pct<=+4% (not extended)
// - Small penalty if pxVsMA25Pct is very extended (>+6%)
function computeScore({ analytics, regime, crossType, crossLag, ST, LT }) {
  let s = 0;

  // Regime
  if (regime === "DOWN") s += 2;
  else if (regime === "UP") s += 1;

  // Cross lag (prefer some delay; WEEKLY carries more weight in your data)
  const lag = Number.isFinite(crossLag) ? crossLag : null;
  if (crossType === "WEEKLY" || crossType === "BOTH") {
    if (lag !== null && lag >= 2) s += 2;
  } else if (crossType === "DAILY") {
    if (lag !== null && lag >= 4) s += 1;
  }

  // Sentiment (you clarified: LT1=most bullish, LT7=most bearish; same for ST)
  if (Number.isFinite(LT) && LT >= 3 && LT <= 5) s += 1; // mild-bullish long-term
  if (Number.isFinite(ST) && ST >= 6 && ST <= 7) s += 1; // short-term bearish (pullback)

  // Analytics
  const a = analytics || {};
  if (Number.isFinite(a.gapPct) && a.gapPct > 0) s += 1;
  if (Number.isFinite(a.rsi) && a.rsi >= 60) s += 1;
  if (Number.isFinite(a.pxVsMA25Pct) && a.pxVsMA25Pct <= 4) s += 1;
  if (Number.isFinite(a.pxVsMA25Pct) && a.pxVsMA25Pct > 6) s -= 1; // penalty for being too extended

  return s;
}



/**
 * Compute simple daily regime labels from a Nikkei proxy candles array.
 * Logic:
 *  - STRONG_UP: px>MA25 & MA25 slope > +0.02%/bar & MA25>MA75
 *  - UP:        px>MA25 & slope >= 0
 *  - RANGE:     abs(slope) < 0.02%/bar (near-flat) OR |px-MA25| <= 1*ATR(14)
 *  - DOWN:      otherwise
 */
function computeRegimeLabels(candles) {
  if (!Array.isArray(candles) || candles.length < 30) {
    return candles.map(() => "RANGE");
  }

  const closes = candles.map((c) => Number(c.close) || 0);
  const ma25 = smaArr(closes, 25);
  const ma75 = smaArr(closes, 75);

  // ATR(14) for RANGE tie-break
  const atr = (() => {
    if (candles.length < 15) return candles.map(() => 0);
    const out = new Array(candles.length).fill(0);
    for (let i = 1; i < candles.length; i++) {
      const h = Number(candles[i].high ?? candles[i].close ?? 0);
      const l = Number(candles[i].low ?? candles[i].close ?? 0);
      const pc = Number(candles[i - 1].close ?? 0);
      const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
      if (i < 15) {
        // warmup simple average
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
        // Wilder smoothing-ish: reuse previous ATR for smoothness
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

    // slope of MA25 over last 5 bars (% per bar relative to MA25)
    let slope = 0;
    if (i >= 5 && Number.isFinite(m25) && m25 > 0) {
      const prev = ma25[i - 5];
      if (Number.isFinite(prev) && prev > 0) {
        slope = (m25 - prev) / prev / 5; // per bar
      }
    }

    const aboveMA = Number.isFinite(m25) && px > m25;
    const strong =
      aboveMA && slope > 0.0002 && Number.isFinite(m75) && m25 > m75; // > +0.02%/bar
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

/** Build a { "YYYY-MM-DD": "REGIME" } map for quick lookup */
function buildRegimeMap(candles) {
  const labels = computeRegimeLabels(candles);
  const map = Object.create(null);
  for (let i = 0; i < candles.length; i++) {
    map[toISO(candles[i].date)] = labels[i];
  }
  return map;
}

/* ------------------ MAIN: Backtest (swing-period) — RAW LEVELS ------------------ */
/**
 * Backtest (swing period) — RAW signal-levels (no adjustments after entry).
 * opts:
 *   { months=36, from, to, limit=0, warmupBars=60, holdBars=0 (disabled),
 *     cooldownDays=2, appendTickers?: string[],
 *     allowedSentiments?: string[], allowedSentiRanks?: number[],
 *     maxConcurrent?: number, targetTradesPerDay?: number, countBlockedSignals?: boolean,
 *     includeByTicker?: boolean, simulateRejectedBuys?: boolean,
 *     topRejectedReasons?: number, examplesCap?: number,
 *     regimeTicker?: string, allowedRegimes?: string[] // NEW
 *   }
 */
async function runBacktest(tickersOrOpts, maybeOpts) {
  let tickers = Array.isArray(tickersOrOpts) ? tickersOrOpts : [];
  const opts = Array.isArray(tickersOrOpts)
    ? maybeOpts || {}
    : tickersOrOpts || {};
  // default false if omitted
  const USE_LIVE_BAR = true;

  const INCLUDE_BY_TICKER = true;
  const INCLUDE_PROFILE_SAMPLES = !!opts.includeProfileSamples; // harmless, still supported
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
  const HOLD_BARS = Number.isFinite(opts.holdBars)
    ? Math.max(0, opts.holdBars)
    : 0; // default: off
  const COOLDOWN = 0;
  const MAX_CONCURRENT = Number.isFinite(opts.maxConcurrent)
    ? Math.max(0, opts.maxConcurrent)
    : 0; // 0 = unlimited

  const append = Array.isArray(opts.appendTickers) ? opts.appendTickers : [];
  if (!tickers.length) tickers = allTickers.map((t) => t.code);
  tickers = [...new Set([...tickers, ...append])];
  if (limit > 0) tickers = tickers.slice(0, limit);

  const codes = tickers.map((c) =>
    c.endsWith(".T")
      ? c.toUpperCase()
      : `${String(c).toUpperCase().replace(/\..*$/, "")}.T`
  );

  // --- Fixed RAW profile: take the signal's suggested stop/target and never change them
  const RAW_PROFILE = {
    id: "raw_signal_levels",
    label: "Raw signal (no retune)",
    compute: ({ sig }) => ({
      stop: Number(sig?.smartStopLoss ?? sig?.stopLoss),
      target: Number(sig?.smartPriceTarget ?? sig?.priceTarget),
    }),

    // no advance(): never modify stop/target after entry
  };

  // ---- Add alongside RAW_PROFILE ----
  function lastATR(hist, p = 14) {
    const a = atrArr(hist, p);
    return Number(a[a.length - 1]) || 0;
  }
  function highestCloseSince(hist, startIdx) {
    let hi = -Infinity;
    for (let k = startIdx; k < hist.length; k++)
      hi = Math.max(hi, Number(hist[k].close) || 0);
    return hi;
  }

  function quantizeToTick(px, refPx) {
    const tick = inferTickFromPrice(refPx);
    return Math.round(px / tick) * tick;
  }

  // ---- NEW PROFILE: target-only (no stop, hold for target) ----
  const TARGET_ONLY_PROFILE = {
    id: "target_only",
    label: "Target only (no stop, no time exit)",
    compute: ({ entry, sig }) => ({
      // we must return a numeric stop for plumbing; set to 0 but it will be ignored
      stop: 0,
      target: Number(sig?.smartPriceTarget ?? sig?.priceTarget),
    }),
    // no advance(): never trails; we also skip time exits for this profile
  };

  const ATR_TRAIL_PROFILE = {
    id: "atr_trail",
    label: "ATR trail (Chandelier, arm at target)",

    // Seed with the signal's levels; we use the target only as the *arming* threshold.
    compute: ({ sig }) => ({
      stop: Number(sig?.smartStopLoss ?? sig?.stopLoss),
      target: Number(sig?.smartPriceTarget ?? sig?.priceTarget), // used only to ARM trailing
    }),

    /**
     * advance()
     * - Before target is reached: do *nothing* (use original stop).
     * - Once today's high crosses target: ARM the trailing stop = target - armBuffer.
     * - After armed: ratchet stop = max(previous stop, (highestHighSinceArm - atrMult*ATR), armFloor)
     *
     * Options (from opts):
     *   - atrMult:               how loose the chandelier trail is (default 3.5 is gentler)
     *   - armUnderTargetAtrMult: how far below the initial target to drop the FIRST armed stop, in ATRs (default 1.0)
     *   - armUnderTargetPct:     fallback % if ATR is missing (e.g., 1.5 means 1.5% of price)
     */
    advance: ({
      state,
      hist,
      i,
      atrMult = 3.5,
      startAfterBars = 0, // ignored until armed
      breakevenR = 1.0, // optional: jump to breakeven if big cushion before arming
      armUnderTargetAtrMult = 1.0,
      armUnderTargetPct = 1.5,
      todayHigh, // <- pass today's high from caller
    }) => {
      const lookHist = hist.slice(0, i + 1); // include today for arming check
      if (!lookHist.length) return;

      // Compute latest ATR on completed data (up to i-1)
      const completed = hist.slice(0, Math.max(0, i));
      const atr = lastATR(completed.length ? completed : lookHist, 14) || 0;

      // 1) Not armed yet: see if we should arm now (today hit or exceeded the target)
      if (!state.trailArmed) {
        // Optional: if move already >= breakevenR, lift floor to breakeven even before arming
        if (breakevenR != null) {
          const risk = Math.max(0.01, state.entry - state.stopInit);
          const lastClose = completed.length
            ? completed[completed.length - 1].close
            : state.entry;
          const unrealizedR = (lastClose - state.entry) / risk;
          if (unrealizedR >= breakevenR)
            state.stop = Math.max(state.stop, state.entry);
        }

        // Arm when today's high tags/passes the original target
        if (
          Number.isFinite(state.target) &&
          Number.isFinite(todayHigh) &&
          todayHigh >= state.target
        ) {
          const armBufAtr = atr ? armUnderTargetAtrMult * atr : 0;
          const armBufPct = (armUnderTargetPct / 100) * state.entry;
          const armBuffer = Math.max(armBufAtr, armBufPct); // choose the larger for safety

          const armStop = state.target - armBuffer;
          state.stop = quantizeToTick(
            Math.max(state.stop, armStop),
            state.entry
          );

          state.trailArmed = true;
          state.armIdx = i;
          // We trail off highs after arming
          state.hiSinceArm = Math.max(
            todayHigh || -Infinity,
            highestHighSince(lookHist, state.entryIdx)
          );
          // No longer use the target for exiting once armed
          state.skipTarget = true;
        }
        return; // nothing else until we are armed
      }

      // 2) Already armed: trail as chandelier off the highest *high* since arming
      // Update hiSinceArm with today's high
      if (Number.isFinite(todayHigh)) {
        state.hiSinceArm = Math.max(state.hiSinceArm || -Infinity, todayHigh);
      } else {
        // fallback to completed highs if needed
        const hi = highestHighSince(lookHist, state.armIdx ?? state.entryIdx);
        state.hiSinceArm = Math.max(state.hiSinceArm || -Infinity, hi);
      }

      // Chandelier stop (loose leash)
      if (atr) {
        const trailCandidate = state.hiSinceArm - atrMult * atr;
        // Never loosen; respect the initial armed floor near target
        const armFloor = state.targetInit
          ? Math.min(state.targetInit, state.hiSinceArm) -
            Math.max(
              armUnderTargetAtrMult * atr,
              (armUnderTargetPct / 100) * state.entry
            )
          : -Infinity;
        const rawNewStop = Math.max(trailCandidate, armFloor, state.stop);
        state.stop = quantizeToTick(rawNewStop, state.entry);
      }
      // Safety clamp: never place stop above today's actual tradable range
      if (Number.isFinite(todayHigh)) {
        state.stop = Math.min(state.stop, todayHigh);
      }
    },
  };

  const USE_TRAIL = true; // opts.useTrailing = true/false
  const activeProfiles = USE_TRAIL
    ? [RAW_PROFILE, ATR_TRAIL_PROFILE, TARGET_ONLY_PROFILE] // <-- NEW
    : [RAW_PROFILE, TARGET_ONLY_PROFILE]; // <-- NEW

  // --- NEW: regime options ---
  const REGIME_TICKER =
    opts && typeof opts.regimeTicker === "string" && opts.regimeTicker.trim()
      ? opts.regimeTicker.trim().toUpperCase()
      : DEFAULT_REGIME_TICKER;

  // Gate by regime labels if provided (["STRONG_UP","UP","RANGE","DOWN"])
  const allowedRegimes =
    Array.isArray(opts.allowedRegimes) && opts.allowedRegimes.length
      ? new Set(opts.allowedRegimes.map(String))
      : null;

  // Fetch regime reference history once (same FROM/TO window)
  let regimeMap = null;
  try {
    const nikkeiRef = await fetchHistory(REGIME_TICKER, FROM, TO);
    if (nikkeiRef && nikkeiRef.length) {
      regimeMap = buildRegimeMap(nikkeiRef);
      console.log(
        `[BT] Regime ready from ${REGIME_TICKER} with ${nikkeiRef.length} bars`
      );
    } else {
      console.log(`[BT] Regime disabled: no candles for ${REGIME_TICKER}`);
    }
  } catch (e) {
    console.log(
      `[BT] Regime disabled: failed to load ${REGIME_TICKER} — ${String(
        e?.message || e
      )}`
    );
  }

  // Aggregation per regime
  const regimeAgg = {
    STRONG_UP: [],
    UP: [],
    RANGE: [],
    DOWN: [],
  };

  // Aggregation for DIP after fresh crosses
  // We’ll count a trade here if its strategy is a DIP and crossType says which flip was fresh.
  const dipAfterAgg = {
    WEEKLY: [],
    DAILY: [],
  };

  // diagnostics
  const byTicker = [];
  const globalTrades = [];
  const tradingDays = new Set();
  let globalOpenPositions = 0;

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

  // sentiment aggregation
  const sentiment = {
    // LT/ST combos (existing behavior)
    actual: Object.create(null),
    rejected: Object.create(null),

    // NEW: LT-only buckets, ST-only buckets
    actualLT: Object.create(null), // key = LT score only
    rejectedLT: Object.create(null),
    actualST: Object.create(null), // key = ST score only
    rejectedST: Object.create(null),

    bestByWinRate: { actual: [], rejected: [] }, // will still be filled later
  };

  console.log(
    `[BT] window ${FROM}→${TO} | holdBars=${
      HOLD_BARS || "off"
    } | warmup=${WARMUP} | cooldown=${COOLDOWN} | profile=${activeProfiles
      .map((p) => p.id)
      .join(",")}`
  );
  console.log(`[BT] total stocks: ${codes.length}`);

  const pct = (n) => Math.round(n * 100) / 100;

  // global position cap
  let globalOpenCount = 0;

  for (let ti = 0; ti < codes.length; ti++) {
    const code = codes[ti];
    console.log(`[BT] processing stock ${ti + 1}/${codes.length}: ${code}`);

    try {
      const candles = await fetchHistory(code, FROM, TO);
      if (candles.length < WARMUP + 2) {
        if (INCLUDE_BY_TICKER) {
          const emptyMetrics = computeMetrics([]);
          const emptyAnalysis = buildTickerAnalysis(code, []);
          byTicker.push({
            ticker: code,
            trades: [],
            metrics: emptyMetrics,
            analysis: emptyAnalysis,
            error: "not enough data",
          });
        }
        console.log(
          `[BT] finished ${ti + 1}/${codes.length}: ${code} (not enough data)`
        );
        continue;
      }

      const trades = [];
      const tradesByProfile = Object.fromEntries(
        activeProfiles.map((p) => [p.id, []])
      );
      const openByProfile = Object.create(null); // id -> open state
      const cooldownUntilByProfile = Object.create(null);
      for (const p of activeProfiles) cooldownUntilByProfile[p.id] = -1;

      // per-ticker loop
      for (let i = 0; i < candles.length; i++) {
        const today = candles[i];
        tradingDays.add(toISO(today.date));
        const hist = candles.slice(0, i + 1);

        // NEW: regime tag for this day (based on reference map)
        const dayISO = toISO(today.date);
        const dayRegime = regimeMap ? regimeMap[dayISO] || "RANGE" : "RANGE";

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

        // blocked counters (optional, per profile)
        if (COUNT_BLOCKED) {
          for (const p of activeProfiles) {
            if (i <= cooldownUntilByProfile[p.id]) blockedCooldown++;
          }
          if (i < WARMUP) blockedWarmup++;
        }

        // manage open positions per profile (trailing BEFORE exit checks)
        for (const p of activeProfiles) {
          const list = openByProfile[p.id] || [];
          if (!list.length) continue;

          for (let k = list.length - 1; k >= 0; k--) {
            const st = list[k];

            // NEW: update trailing stop using only completed data (up to i-1)
            if (typeof p.advance === "function") {
              p.advance({
                state: st,
                hist: candles, // p.advance will only use data up to i-1
                i,
                atrMult: opts.atrMult ?? 3,
                startAfterBars: opts.trailStartAfterBars ?? 2,
                breakevenR: 1.0,
                todayHigh: today.high, // <-- add this
              });
            }

            // now do your normal exit checks on today's bar i
            let exit = null;

            // 1) price-based exits first (gap-aware, realistic fill)
            const stopTouched = !st.noStop && today.low <= st.stop;
            if (stopTouched) {
              // If we gapped below the stop, worst plausible fill is today's open.
              // If intrabar touch, fill at the stop but never above today's high.
              const stopFill =
                today.open < st.stop
                  ? today.open
                  : Math.min(st.stop, today.high);

              const isProfit = stopFill >= st.entry; // count ≥entry as WIN; change to '>' if you prefer BE as LOSS
              exit = {
                type: "STOP",
                price: stopFill,
                result: isProfit ? "WIN" : "LOSS",
              };
            } else if (!st.skipTarget && today.high >= st.target) {
              exit = { type: "TARGET", price: st.target, result: "WIN" };
            }

            // 2) optional time exit (only if this profile allows it)
            if (!exit && HOLD_BARS > 0 && !st.ignoreTimeExit) {
              // <-- NEW guard
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

            // (rest of your existing exit handling unchanged)

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
                R: st.noStop ? null : r2((exit.price - st.entry) / risk),
                returnPct: r2(pctRet),
                ST: st.ST,
                LT: st.LT,
                regime: st.regime || "RANGE",
                crossType: st.crossType || null,
                crossLag: Number.isFinite(st.crossLag) ? st.crossLag : null,
                analytics: st.analytics || null, // <<< adds RSI/ATR/VolumeZ/Gap/MA info
                score: Number.isFinite(st.score) ? st.score : null, // <<< NEW
              };

              tradesByProfile[p.id].push(trade);
              trades.push(trade);
              globalTrades.push(trade);

              const kKey = sentiKey(st.ST, st.LT);
              if (!sentiment.actual[kKey]) sentiment.actual[kKey] = sentiInit();
              sentiUpdate(sentiment.actual[kKey], {
                result: trade.result,
                returnPct: trade.returnPct,
                R: trade.R,
              });
              // --- NEW: LT-only aggregation for ACTUAL trades ---
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

              // --- NEW: ST-only aggregation for ACTUAL trades ---
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

              // Bucket: DIP after fresh DAILY/WEEKLY flips
              // We treat anything whose strategy contains "DIP" as a DIP lane trade.
              if (trade.strategy && /DIP/i.test(trade.strategy)) {
                if (trade.crossType === "WEEKLY") {
                  dipAfterAgg.WEEKLY.push(trade);
                } else if (trade.crossType === "DAILY") {
                  dipAfterAgg.DAILY.push(trade);
                } else if (trade.crossType === "BOTH") {
                  // If analyseCrossing flagged BOTH, count it in both buckets.
                  dipAfterAgg.WEEKLY.push(trade);
                  dipAfterAgg.DAILY.push(trade);
                }
              }

              list.splice(k, 1);
              cooldownUntilByProfile[p.id] = i + COOLDOWN;
              globalOpenCount = Math.max(0, globalOpenCount - 1);
            }
          }

          openByProfile[p.id] = list;
        }

        // ---------------- ALWAYS detect first (parity with live scanner) ----------------
        const gatesData = USE_LIVE_BAR ? hist : hist.slice(0, -1);
        const sig = analyseCrossing(stock, hist, {
          debug: true,
          debugLevel: "verbose",
          dataForGates: gatesData, // prevents analyseCrossing from slicing
        });

        // 👇 Add this here (moved up from the else-branch)
        const senti = getComprehensiveMarketSentiment(stock, hist);
        const ST = senti?.shortTerm?.score ?? 4;
        const LT = senti?.longTerm?.score ?? 4;

        // Count raw signals for the day exactly when they happen (regardless of eligibility/gates)
        if (sig?.buyNow) {
          signalsTotal++;
          if (i >= WARMUP) signalsAfterWarmup++;
          const dayISOforSig = toISO(today.date);
          signalsByDay.set(
            dayISOforSig,
            (signalsByDay.get(dayISOforSig) || 0) + 1
          );
        }

        // Trend/telemetry bookkeeping (same as before)
        const trend = sig?.debug?.ms?.trend;
        if (trend && telemetry.trends.hasOwnProperty(trend))
          telemetry.trends[trend]++;

        if (!sig?.buyNow) {
          // collect reasons for "no buy" (same as your old code)
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

          // parallel “rejected buys” simulation (unchanged)
          if (SIM_REJECTED) {
            const entry = today.close; // same-bar for CF simplicity
            const simStop = Number(sig?.smartStopLoss ?? sig?.stopLoss);
            const simTarget = Number(sig?.smartPriceTarget ?? sig?.priceTarget);

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

              // combo-level sentiment stats for rejected sims
              const k = sentiKey(ST, LT);
              if (!sentiment.rejected[k]) sentiment.rejected[k] = sentiInit();
              if (outcome.result !== "OPEN") {
                sentiUpdate(sentiment.rejected[k], outcome);
                parallel.rejectedBuys.totalSimulated++;
                if (outcome.result === "WIN") parallel.rejectedBuys.winners++;
              }

              // --- NEW: LT-only aggregation for REJECTED sims (moved here) ---
              if (Number.isFinite(LT)) {
                if (!sentiment.rejectedLT[LT]) {
                  sentiment.rejectedLT[LT] = sentiInit();
                }
                if (outcome.result !== "OPEN") {
                  sentiUpdate(sentiment.rejectedLT[LT], outcome);
                }
              }

              // --- NEW: ST-only aggregation for REJECTED sims (moved here) ---
              if (Number.isFinite(ST)) {
                if (!sentiment.rejectedST[ST]) {
                  sentiment.rejectedST[ST] = sentiInit();
                }
                if (outcome.result !== "OPEN") {
                  sentiUpdate(sentiment.rejectedST[ST], outcome);
                }
              }

              // now do byReason breakdown + examples
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
                  if (
                    parallel.rejectedBuys.examples[key].length < EXAMPLE_MAX
                  ) {
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
        } else {
          // ---------------- After detection, decide if we can actually ENTER ----------------
          const anyProfileEligible =
            i >= WARMUP &&
            activeProfiles.some((p) => i > cooldownUntilByProfile[p.id]) &&
            (MAX_CONCURRENT === 0 || globalOpenCount < MAX_CONCURRENT);

          // RR telemetry bucket (same as before)
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

          // optional sentiment gate (now disabled by default due to change #1)
          if (anyProfileEligible) {
            // optional regime gate ...
            if (!allowedRegimes || allowedRegimes.has(dayRegime)) {
              // ENTRY = next-bar open (fallback close)
              const hasNext = i + 1 < candles.length;
              const entryBarIdx = hasNext ? i + 1 : i;
              const entryBar = candles[entryBarIdx];
              const entry = hasNext ? entryBar.open : today.close;

              for (const p of activeProfiles) {
                if (i <= cooldownUntilByProfile[p.id]) continue;
                if (MAX_CONCURRENT > 0 && globalOpenCount >= MAX_CONCURRENT)
                  break;

                const plan =
                  p.compute({
                    entry,
                    stock: { ...stock, currentPrice: entry },
                    sig,
                    today: entryBar,
                    hist: candles.slice(0, entryBarIdx + 1),
                  }) || {};
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

                const qStop = toTick(stop, stock);
                const qTarget = toTick(target, stock);

                // derive cross type & lag from analyseCrossing meta
                const cm = sig?.meta?.cross || {};
                const selected =
                  cm?.selected ||
                  (cm?.weekly && cm?.daily
                    ? "BOTH"
                    : cm?.weekly
                    ? "WEEKLY"
                    : cm?.daily
                    ? "DAILY"
                    : null);

                const lag =
                  selected === "WEEKLY" && cm.weekly
                    ? cm.weekly.barsAgo
                    : selected === "DAILY" && cm.daily
                    ? cm.daily.barsAgo
                    : selected === "BOTH"
                    ? Math.min(
                        cm.weekly ? cm.weekly.barsAgo : Infinity,
                        cm.daily ? cm.daily.barsAgo : Infinity
                      )
                    : null;

                if (!openByProfile[p.id]) openByProfile[p.id] = [];

                const analytics = computeAnalytics(candles, entryBarIdx, entry);
                const score = computeScore({
                  analytics,
                  regime: dayRegime,
                  crossType: selected,
                  crossLag: Number.isFinite(lag) ? lag : null,
                  ST,
                  LT,
                });

                const entryATR =
                  lastATR(candles.slice(0, entryBarIdx + 1), 14) || 0;

                openByProfile[p.id].push({
                  entryIdx: entryBarIdx,
                  entry,
                  stop: qStop,
                  stopInit: qStop,
                  target: qTarget,

                  // NEW for trailing profile:
                  targetInit: qTarget,
                  entryATR,
                  trailArmed: false,
                  skipTarget: p.id === "atr_trail", // <— never take fixed target on the trailing profile

                  // ---- NEW flags for target-only profile ----
                  noStop: p.id === "target_only", // ignore stop checks
                  ignoreTimeExit: p.id === "target_only", // ignore HOLD_BARS exits

                  ST,
                  LT,
                  regime: dayRegime,
                  kind:
                    String(sig?.debug?.chosen || sig?.reason || "")
                      .split(":")[0]
                      .trim() || "UNKNOWN",
                  crossType: selected,
                  crossLag: Number.isFinite(lag) ? lag : null,
                  analytics,
                  score,
                });

                globalOpenCount++;
                signalsExecuted++;
              }
            }
          }
        } // <-- end of if (!sig?.buyNow) { ... } else { ... }
      } // <-- end of per-candle loop: for (let i = 0; i < candles.length; i++)

      // --- Force-close any remaining open positions at end-of-data (bookkeeping only)
      for (const p of activeProfiles) {
        const list = openByProfile[p.id] || [];
        if (!list.length) continue;

        const lastIdx = candles.length - 1;
        const lastBar = candles[lastIdx];

        for (const st of list) {
          // Close at last close; mark as WIN if >= entry, else LOSS.
          const endExitPrice = lastBar.close;
          const endResult = endExitPrice >= st.entry ? "WIN" : "LOSS";

          const risk = Math.max(0.01, st.entry - st.stopInit);
          const trade = {
            ticker: code,
            profile: p.id,
            strategy: st.kind || "DIP",
            entryDate: toISO(candles[st.entryIdx].date),
            exitDate: toISO(lastBar.date),
            holdingDays: lastIdx - st.entryIdx,
            entry: r2(st.entry),
            exit: r2(endExitPrice),
            stop: st.stopInit,
            target: st.target,
            result: endResult,
            exitType: "END", // <- distinct from TIME
            // If noStop, R is meaningless → set to null; else compute normally
            R: st.noStop ? null : r2((endExitPrice - st.entry) / risk),
            returnPct: r2(((endExitPrice - st.entry) / st.entry) * 100),
            ST: st.ST,
            LT: st.LT,
            regime: st.regime || "RANGE",
            crossType: st.crossType || null,
            crossLag: Number.isFinite(st.crossLag) ? st.crossLag : null,
            analytics: st.analytics || null,
            score: Number.isFinite(st.score) ? st.score : null,
          };

          tradesByProfile[p.id].push(trade);
          trades.push(trade);
          globalTrades.push(trade);
        }

        openByProfile[p.id] = [];
      }

      // Per-ticker snapshot: win % and profit %
      const m = computeMetrics(trades);
      console.log(
        `[BT] finished ${ti + 1}/${codes.length}: ${code} | trades=${
          trades.length
        } | winRate=${m.winRate}% | avgRet=${m.avgReturnPct}% | PF=${
          m.profitFactor
        }`
      );

      const analysis = buildTickerAnalysis(code, trades);

      if (INCLUDE_BY_TICKER) {
        byTicker.push({ ticker: code, trades, metrics: m, analysis });
      }
    } catch (e) {
      // <-- close the per-ticker try
      if (INCLUDE_BY_TICKER) {
        const emptyMetrics = computeMetrics([]);
        const emptyAnalysis = buildTickerAnalysis(code, []);
        byTicker.push({
          ticker: code,
          trades: [],
          metrics: emptyMetrics,
          analysis: emptyAnalysis,
          error: String(e?.message || e),
        });
      }

      console.log(
        `[BT] failed ${ti + 1}/${codes.length}: ${code} — ${String(
          e?.message || e
        )}`
      );
    }
  } // <-- end of per-ticker loop: for (let ti = 0; ti < codes.length; ti++)

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

  // --- NEW: finalize LT-only and ST-only views ---
  const sentiActualLT = finalizeSentiTable(sentiment.actualLT);
  const sentiRejectedLT = finalizeSentiTable(sentiment.rejectedLT);
  const sentiActualST = finalizeSentiTable(sentiment.actualST);
  const sentiRejectedST = finalizeSentiTable(sentiment.rejectedST);

  // per-profile metrics (only RAW profile)
  const profiles = {};
  for (const p of activeProfiles) {
    const list = all.filter((t) => t.profile === p.id);
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
  // With a single profile, "best" is trivially that profile:
  function pickBest(by) {
    let bestId = null,
      bestVal = -Infinity;
    for (const [id, obj] of Object.entries(profiles)) {
      const m = obj.metrics || {};
      const val =
        by === "winRate"
          ? m.winRate ?? -Infinity
          : by === "expR"
          ? m.expR ?? -Infinity
          : m.profitFactor ?? -Infinity;
      if (val > bestVal) {
        bestVal = val;
        bestId = id;
      }
    }
    return bestId || "raw_signal_levels";
  }
  const bestProfiles = {
    byWinRate: pickBest("winRate"),
    byExpR: pickBest("expR"),
    byProfitFactor: pickBest("pf"),
  };

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

  // --- NEW: per-regime metrics ---
  const regimeMetrics = {};
  for (const key of Object.keys(regimeAgg)) {
    regimeMetrics[key] = computeMetrics(regimeAgg[key]);
  }

  // --- NEW: DIP-after-cross metrics ---
  const dipAfterMetrics = {
    WEEKLY: computeMetrics(dipAfterAgg.WEEKLY),
    DAILY: computeMetrics(dipAfterAgg.DAILY),
  };

  // --- NEW: CROSSING by-lag metrics (global) ---
  // Buckets: WEEKLY and DAILY, each keyed by "lag" (# completed bars after flip)
  const crossLagBuckets = { WEEKLY: {}, DAILY: {} };
  for (const t of all) {
    const typ = t.crossType;
    if (typ === "WEEKLY" || typ === "DAILY") {
      const lag = Number.isFinite(t.crossLag) ? t.crossLag : -1; // -1 = unknown
      if (!crossLagBuckets[typ][lag]) crossLagBuckets[typ][lag] = [];
      crossLagBuckets[typ][lag].push(t);
    } else if (typ === "BOTH") {
      // If BOTH, attribute to each bucket using the same lag
      const lag = Number.isFinite(t.crossLag) ? t.crossLag : -1;
      if (!crossLagBuckets.WEEKLY[lag]) crossLagBuckets.WEEKLY[lag] = [];
      if (!crossLagBuckets.DAILY[lag]) crossLagBuckets.DAILY[lag] = [];
      crossLagBuckets.WEEKLY[lag].push(t);
      crossLagBuckets.DAILY[lag].push(t);
    }
  }

  // Turn buckets into metrics
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

  function metricsByScore(allTrades) {
    const buckets = {}; // score -> trades[]
    for (const t of allTrades) {
      const s = Number.isFinite(t.score) ? t.score : null;
      if (s === null) continue;
      if (!buckets[s]) buckets[s] = [];
      buckets[s].push(t);
    }
    const scored = Object.keys(buckets)
      .map((k) => +k)
      .sort((a, b) => a - b)
      .map((s) => [s, computeMetrics(buckets[s])]);
    return { buckets, scored };
  }
  function pearson(xs, ys) {
    const n = Math.min(xs.length, ys.length);
    if (n === 0) return NaN;
    let sx = 0,
      sy = 0,
      sxx = 0,
      syy = 0,
      sxy = 0;
    for (let i = 0; i < n; i++) {
      const x = Number(xs[i]) || 0,
        y = Number(ys[i]) || 0;
      sx += x;
      sy += y;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
    }
    const cov = sxy / n - (sx / n) * (sy / n);
    const vx = sxx / n - (sx / n) * (sx / n);
    const vy = syy / n - (sy / n) * (sy / n);
    const denom = Math.sqrt(Math.max(vx, 0)) * Math.sqrt(Math.max(vy, 0));
    return denom ? +(cov / denom).toFixed(3) : NaN;
  }

  // --- NEW: scoring diagnostics ---
  const scored = metricsByScore(all);
  const scoreLevels = scored.scored.map(([s, m]) => ({
    score: s,
    trades: m.trades,
    winRate: m.winRate,
    profitFactor: m.profitFactor,
    avgReturnPct: m.avgReturnPct,
  }));

  // correlations: score vs win (0/1) and vs returnPct
  const _scoreArr = [];
  const _winArr = [];
  const _retArr = [];
  for (const t of all) {
    if (!Number.isFinite(t.score)) continue;
    _scoreArr.push(t.score);
    _winArr.push(t.result === "WIN" ? 1 : 0);
    _retArr.push(Number(t.returnPct) || 0);
  }
  const scoreCorr = {
    win: pearson(_scoreArr, _winArr),
    ret: pearson(_scoreArr, _retArr),
  };

  // Console snapshot
  console.log("[BT] SCORE STATS (score -> trades, WR, PF, AvgRet)");
  for (const row of scoreLevels) {
    console.log(
      `[BT] score=${String(row.score).padStart(2)} | trades=${
        row.trades
      } | WR=${row.winRate}% | PF=${row.profitFactor} | AvgRet=${
        row.avgReturnPct
      }%`
    );
  }
  console.log(
    `[BT] SCORE CORR | ρ(score, win)=${scoreCorr.win} | ρ(score, ret)=${scoreCorr.ret}`
  );

  console.log("[BT] CROSS-LAG STATS (WEEKLY)");
  for (const k of Object.keys(crossingByLag.WEEKLY)) {
    const m = crossingByLag.WEEKLY[k];
    console.log(
      `[BT] WEEKLY lag=${k} | trades=${m.trades} | winRate=${m.winRate}% | avgRet=${m.avgReturnPct}% | PF=${m.profitFactor}`
    );
  }
  console.log("[BT] CROSS-LAG STATS (DAILY)");
  for (const k of Object.keys(crossingByLag.DAILY)) {
    const m = crossingByLag.DAILY[k];
    console.log(
      `[BT] DAILY  lag=${k} | trades=${m.trades} | winRate=${m.winRate}% | avgRet=${m.avgReturnPct}% | PF=${m.profitFactor}`
    );
  }

  // Console snapshot for regimes
  console.log("[BT] DIP AFTER FRESH CROSS STATS");
  console.log(
    `[BT] DIP@WEEKLY | trades=${dipAfterMetrics.WEEKLY.trades} | winRate=${dipAfterMetrics.WEEKLY.winRate}% | avgRet=${dipAfterMetrics.WEEKLY.avgReturnPct}% | PF=${dipAfterMetrics.WEEKLY.profitFactor}`
  );
  console.log(
    `[BT] DIP@DAILY  | trades=${dipAfterMetrics.DAILY.trades} | winRate=${dipAfterMetrics.DAILY.winRate}% | avgRet=${dipAfterMetrics.DAILY.avgReturnPct}% | PF=${dipAfterMetrics.DAILY.profitFactor}`
  );

  for (const k of ["STRONG_UP", "UP", "RANGE", "DOWN"]) {
    const m = regimeMetrics[k];
    console.log(
      `[BT] ${k.padEnd(10)} | trades=${m.trades} | winRate=${
        m.winRate
      }% | avgRet=${m.avgReturnPct}% | PF=${m.profitFactor}`
    );
  }

  // logs
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

  // legacy "dip" key preserved if present
  const dipMetrics = strategyBreakdown.DIP || computeMetrics(all);
  const signalsDayCount = signalsByDay.size || days || 1;
  const signalsPerDayRaw = signalsDayCount
    ? Array.from(signalsByDay.values()).reduce((a, b) => a + b, 0) /
      signalsDayCount
    : 0;

  // Build a best/worst spotlight by profit factor (fall back to global trades if byTicker is not requested)
  const spotlightRankBase = byTicker.length
    ? byTicker.filter((r) => r.trades && r.trades.length)
    : [
        {
          ticker: "ALL",
          trades: globalTrades,
          metrics: computeMetrics(globalTrades),
          analysis: buildTickerAnalysis("ALL", globalTrades),
        },
      ];

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
      // Kept for UI compatibility; this build always uses the RAW profile only
      profileIds: activeProfiles.map((p) => p.id),
      useTrailing: USE_TRAIL,
      atrMult: 3.5,
      trailStartAfterBars: 0,
      breakevenR: opts.breakevenR ?? 0.8,

      maxConcurrent: MAX_CONCURRENT,
      regimeTicker: REGIME_TICKER,
      allowedRegimes: allowedRegimes ? Array.from(allowedRegimes) : [],
    },
    totalTrades,
    winRate,
    avgReturnPct,
    scoring: {
      schema: {
        regime: { DOWN: 2, UP: 1 },
        crossLag: { WEEKLY_ge2: 2, DAILY_ge4: 1 },
        sentiment: { LT_3to5: 1, ST_6to7: 1 },
        analytics: {
          gapPos: 1,
          rsiGe60: 1,
          pxVsMA25Le4: 1,
          pxVsMA25Gt6_penalty: -1,
        },
      },
      byScore: scoreLevels, // from your computed `scoreLevels`
      correlation: scoreCorr, // from your computed `scoreCorr`
    },

    spotlight,
    avgHoldingDays,
    tradesPerDay,
    tradingDays: days,
    openAtEnd: globalOpenCount,
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
      executed: signalsExecuted,
      invalid: signalsInvalid,
      riskStopGtePx: signalsRiskBad,
      perDay: +signalsPerDayRaw.toFixed(2),
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
      // Full LT/ST combo stats (same as before)
      combos: {
        actual: sentiActual.combos,
        rejected: sentiRejected.combos,
        bestByWinRate: sentiment.bestByWinRate, // top LT/ST pairs
      },

      // NEW: LT-only breakdown
      byLT: {
        actual: sentiActualLT.combos, // e.g. LT3: {count, winRate, ...}
        rejected: sentiRejectedLT.combos,
        bestByWinRateActual: sentiActualLT.bestByWinRate,
        bestByWinRateRejected: sentiRejectedLT.bestByWinRate,
      },

      // NEW: ST-only breakdown
      byST: {
        actual: sentiActualST.combos, // e.g. ST7: {count, winRate, ...}
        rejected: sentiRejectedST.combos,
        bestByWinRateActual: sentiActualST.bestByWinRate,
        bestByWinRateRejected: sentiRejectedST.bestByWinRate,
      },
    },

    profiles,
    bestProfiles,
    regime: {
      ticker: REGIME_TICKER,
      metrics: regimeMetrics,
    },
    crossing: {
      byLag: crossingByLag, // { WEEKLY: {lag: metrics}, DAILY: {lag: metrics} }
    },
    dipAfterFreshCrossing: {
      WEEKLY: dipAfterMetrics.WEEKLY, // DIP entries after fresh WEEKLY flip
      DAILY: dipAfterMetrics.DAILY, // DIP entries after fresh DAILY flip
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

     const rWins = wins.map((t) => Number.isFinite(t.R) ? t.R : null).filter(Number.isFinite);
     const rLosses = losses.map((t) => Number.isFinite(t.R) ? t.R : null).filter(Number.isFinite);
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

  // Count exits over ALL trades
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
    profitFactor: Number.isFinite(profitFactor) ? r2(profitFactor) : "Infinity",
    exits,
  };
}
function sum(arr) {
  return arr.reduce((a, b) => a + (Number(b) || 0), 0);
}

/* --------------------------- expose for Bubble -------------------------- */
window.backtest = async (tickersOrOpts, maybeOpts) => {
  try {
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
      scoring: {
        schema: {
          regime: { DOWN: 2, UP: 1 },
          crossLag: { WEEKLY_ge2: 2, DAILY_ge4: 1 },
          sentiment: { LT_3to5: 1, ST_6to7: 1 },
          analytics: {
            gapPos: 1,
            rsiGe60: 1,
            pxVsMA25Le4: 1,
            pxVsMA25Gt6_penalty: -1,
          },
        },
        byScore: [], // <-- was scoreLevels
        correlation: { win: null, ret: null }, // <-- was scoreCorr
      },

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
      regime: { ticker: "", metrics: {} },
      profiles: {},
      bestProfiles: {},
      error: String(e?.message || e),
    };
  }
};
