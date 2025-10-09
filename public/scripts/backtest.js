// ===============================
// NEW TRAIL ENGINE (profile-free)
// Long-only; ATR-based initial stop + chandelier trail
// Exits: TRAIL, STOP (if never trailed), TIME
// Metrics compute true P&L (no negative "wins").
// ===============================

/* -------- Params (tune as needed) -------- */
export const trailParams = {
  atrLen: 14,          // ATR lookback
  initATR: 1.3,        // initial risk: entry - 1.3*ATR
  trailATR: 3.0,       // chandelier: stop = highestHighSinceEntry - 3.0*ATR
  holdBars: 0,         // 0 = no time exit; otherwise force exit after N bars
  slippagePct: 0.000,  // optional slippage per trade (fraction), e.g. 0.0005 = 5bp
  maxConcurrent: 0     // 0 = unlimited. If you cap, engine ignores new signals while full.
};

/* -------- Data contracts --------
bars[i] must have: { time, open, high, low, close, atr? } 
If `atr` missing, we compute it from high/low/close using Wilder ATR.
signals: array of { iBar, ticker, entryPrice? } meaning "go long at next bar open" (or same-bar close if you prefer)
----------------------------------*/

/* -------- ATR helper (Wilder) -------- */
function computeATR(bars, len) {
  if (bars.length === 0) return;
  // True Range
  const tr = new Array(bars.length).fill(0);
  for (let i = 0; i < bars.length; i++) {
    const h = bars[i].high, l = bars[i].low;
    if (i === 0) tr[i] = h - l;
    else tr[i] = Math.max(h - l, Math.abs(h - bars[i-1].close), Math.abs(l - bars[i-1].close));
  }
  // Wilder smoothing
  const atr = new Array(bars.length).fill(0);
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    if (i < len) {
      sum += tr[i];
      if (i === len - 1) atr[i] = sum / len;
    } else {
      atr[i] = (atr[i-1] * (len - 1) + tr[i]) / len;
    }
  }
  // Attach
  for (let i = 0; i < bars.length; i++) bars[i].atr = bars[i].atr ?? atr[i];
}

/* -------- Position shape --------
{
  id, ticker,
  iOpen, entry, stop, stopInit,
  highestHigh, wasTrailed, barsHeld,
  result: null|"WIN"|"LOSS",
  exitType: null|"TRAIL"|"STOP"|"TIME",
  exitPrice: null, iClose: null
}
----------------------------------*/

let _nextId = 1;
function openPosition(ticker, iBar, entry, atr, p) {
  const stopInit = entry - p.initATR * atr;
  return {
    id: _nextId++,
    ticker,
    iOpen: iBar,
    entry,
    stop: stopInit,
    stopInit,
    highestHigh: Number.NEGATIVE_INFINITY,
    wasTrailed: false,
    barsHeld: 0,
    result: null,
    exitType: null,
    exitPrice: null,
    iClose: null
  };
}

/* ----- Apply chandelier trail (raise-only) ----- */
function trailStop(pos, bar, atr, p) {
  // Update highest high since entry (use today's high too)
  if (bar.high > pos.highestHigh) pos.highestHigh = bar.high;

  // Chandelier long stop
  const chStop = pos.highestHigh - p.trailATR * atr;

  const newStop = Math.max(pos.stop, chStop);
  if (newStop > pos.stop + 1e-9) {
    pos.stop = newStop;
    if (pos.stop > pos.stopInit + 1e-9) pos.wasTrailed = true;
  }
}

/* ----- Per-bar exit check ----- */
function checkExit(pos, bar, p) {
  // Stop hit?
  if (bar.low <= pos.stop) {
    const fill = pos.stop; // conservative
    const pnl = (fill - pos.entry) / pos.entry - p.slippagePct;
    pos.exitPrice = fill;
    pos.exitType  = pos.wasTrailed ? "TRAIL" : "STOP";
    pos.result    = pnl >= 0 ? "WIN" : "LOSS";
    return true;
  }

  // Time exit (if enabled)
  if (p.holdBars > 0 && pos.barsHeld >= p.holdBars) {
    const fill = bar.close; // time exit at close
    const pnl = (fill - pos.entry) / pos.entry - p.slippagePct;
    pos.exitPrice = fill;
    pos.exitType  = "TIME";
    pos.result    = pnl >= 0 ? "WIN" : "LOSS";
    return true;
  }

  return false;
}

/* ----- Metrics ----- */
function computeMetrics(closed) {
  const trades = closed.length;
  if (!trades) {
    return {
      trades: 0, winRate: 0, avgReturnPct: 0, avgHoldingDays: 0,
      avgWinPct: 0, avgLossPct: 0, expR: 0, profitFactor: 0,
      exits: { target: 0, stop: 0, trail: 0, time: 0 }
    };
  }

  let wins = 0, sumRet = 0, sumDays = 0;
  let sumWin = 0, nWin = 0, sumLoss = 0, nLoss = 0;
  let grossWin = 0, grossLoss = 0;

  let exitCounts = { target: 0, stop: 0, trail: 0, time: 0 }; // target always 0 here

  for (const t of closed) {
    const r = (t.exitPrice - t.entry) / t.entry;
    const retPct = r * 100;
    sumRet += retPct;
    sumDays += t.barsHeld;

    if (t.result === "WIN") {
      wins += 1;
      sumWin += retPct;
      nWin += 1;
      grossWin += Math.max(0, r);
    } else {
      sumLoss += retPct;
      nLoss += 1;
      grossLoss += Math.max(0, -r);
    }

    if (t.exitType === "STOP")  exitCounts.stop++;
    if (t.exitType === "TRAIL") exitCounts.trail++;
    if (t.exitType === "TIME")  exitCounts.time++;
  }

  const winRate = (wins / trades) * 100;
  const avgReturnPct = sumRet / trades;
  const avgHoldingDays = sumDays / trades;
  const avgWinPct = nWin ? (sumWin / nWin) : 0;
  const avgLossPct = nLoss ? (sumLoss / nLoss) : 0;

  // Expectancy (per trade) in R-terms is not meaningful without a uniform R.
  // Report a simple profit factor from gross win/loss (in raw R if you want, but here we use return fractions).
  const profitFactor = grossLoss > 0 ? (grossWin / grossLoss) : (grossWin > 0 ? Infinity : 0);

  return {
    trades,
    winRate: +winRate.toFixed(2),
    avgReturnPct: +avgReturnPct.toFixed(2),
    avgHoldingDays: +avgHoldingDays.toFixed(2),
    avgWinPct: +avgWinPct.toFixed(2),
    avgLossPct: +avgLossPct.toFixed(2),
    expR: 0, // left 0 since we didn’t normalize to fixed R here
    profitFactor: +(Number.isFinite(profitFactor) ? profitFactor : 0).toFixed(2),
    exits: exitCounts
  };
}

/* ----- Main run ----- */
export function runBacktest({ bars, signals, params = {} }) {
  const p = { ...trailParams, ...params };

  // Ensure ATR
  const needATR = bars.some(b => b.atr == null);
  if (needATR) computeATR(bars, p.atrLen);

  const open = [];
  const closed = [];

  // To enforce maxConcurrent: on each bar, we can only open if open.length < cap.
  const signalsByBar = new Map();
  for (const s of signals) {
    const arr = signalsByBar.get(s.iBar) || [];
    arr.push(s);
    signalsByBar.set(s.iBar, arr);
  }

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const atr = bar.atr ?? 0;

    // 1) Advance existing positions (trail + check exit)
    for (let j = open.length - 1; j >= 0; j--) {
      const pos = open[j];

      // Raise stop (chandelier) — DO NOT re-pin to stopInit
      trailStop(pos, bar, atr, p);

      // Age
      pos.barsHeld += 1;

      // Exit checks
      if (checkExit(pos, bar, p)) {
        pos.iClose = i;
        closed.push(pos);
        open.splice(j, 1);
      }
    }

    // 2) Open new positions for signals at this bar (respect maxConcurrent)
    const barSignals = signalsByBar.get(i) || [];
    for (const sig of barSignals) {
      if (p.maxConcurrent > 0 && open.length >= p.maxConcurrent) break;

      // You can choose entry at close or next open; here we use close for simplicity
      const entry = sig.entryPrice ?? bar.close;
      if (!Number.isFinite(entry) || !Number.isFinite(atr)) continue;

      const pos = openPosition(sig.ticker, i, entry, atr, p);
      pos.highestHigh = bar.high; // initialize with today’s high
      open.push(pos);
    }
  }

  // Whatever remains is open-at-end; we keep them as "open"
  const summary = computeMetrics(closed);

  return {
    params: p,
    totals: {
      closed: closed.length,
      open: open.length
    },
    summary,
    openPositions: open,
    closedPositions: closed
  };
}

/* ----- Example usage -----
const result = runNewTrailEngine({
  bars, // [{time, open, high, low, close, atr?}, ...]
  signals, // [{iBar: 123, ticker: "4502.T"}, ...]
  params: {
    atrLen: 14,
    initATR: 1.3,
    trailATR: 3.0,
    holdBars: 20,     // try 20 to avoid endless holds; set 0 to disable
    maxConcurrent: 15 // or 0 for unlimited
  }
});
console.log(result.summary, result.totals);
-------------------------------------------*/
