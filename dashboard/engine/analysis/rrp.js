// /scripts/rrp.js — Playbook 5: Risk/Reward Probation (tighter than DIP probation)
// Purpose: rescue high-quality "RR just under need" setups in friendly regimes.
//
// API: detectRRProbation(stock, data, cfg, U) -> {
//   trigger: boolean,
//   why: string,            // set when trigger=true
//   waitReason: string,     // set when trigger=false
//   stop: number,
//   target: number,
//   nearestRes: number|null,
//   diagnostics: { ... }    // telemetry-style fields for the orchestrator
// }
//
// Notes:
// - Keep this conservative; it is evaluated only if earlier playbooks didn’t
//   produce a candidate. The orchestrator will still run analyzeRR() and guards.

export function detectRRProbation(stock, data, cfg = {}, U = {}) {
  const out = baseOut();
  try {
    if (!Array.isArray(data) || data.length < 25) {
      out.waitReason = "Insufficient data for RRP (need ≥25 bars).";
      return out;
    }

    // ---- Basic inputs / helpers
    const num = (v) => (Number.isFinite(v) ? Number(v) : 0);
    const px = num(stock.currentPrice) || num(data.at(-1)?.close);
    const openPx = num(stock.openPrice) || num(data.at(-1)?.open) || px;
    const prevClose =
      num(stock.prevClosePrice) || num(data.at(-2)?.close) || openPx;
    const atr = Math.max(num(stock.atr14), px * 0.005, 1e-6);

    // Volume context (lenient)
    const vol = num(data.at(-1)?.volume);
    const avg20 = avgVol(data, 20);

    // ---- Trend regime (match your getMarketStructure heuristic)
    const ma = {
      ma5: num(stock.movingAverage5d) || U.sma?.(data, 5) || smaLocal(data, 5),
      ma25:
        num(stock.movingAverage25d) || U.sma?.(data, 25) || smaLocal(data, 25),
      ma50:
        num(stock.movingAverage50d) || U.sma?.(data, 50) || smaLocal(data, 50),
      ma75:
        num(stock.movingAverage75d) || U.sma?.(data, 75) || smaLocal(data, 75),
      ma200:
        num(stock.movingAverage200d) ||
        U.sma?.(data, 200) ||
        smaLocal(data, 200),
    };

    let score = 0;
    if (px > ma.ma25 && ma.ma25 > 0) score++;
    if (px > ma.ma50 && ma.ma50 > 0) score++;
    if (ma.ma25 > ma.ma50 && ma.ma50 > 0) score++;
    if (ma.ma50 > ma.ma200 && ma.ma200 > 0) score++;

    const trend =
      score >= 3
        ? "STRONG_UP"
        : score === 2
        ? "UP"
        : score === 1
        ? "WEAK_UP"
        : "DOWN";

    // Friendly regime only
    if (!(trend === "STRONG_UP" || trend === "UP")) {
      out.waitReason = "Regime not friendly (need UP or STRONG_UP).";
      out.diagnostics.trend = trend;
      return out;
    }

    // ---- Price action (constructive close)
    const dayGreen = px >= Math.max(openPx, prevClose);
    if (!dayGreen) {
      out.waitReason =
        "Price action not constructive (close < max(open, prevClose)).";
      return out;
    }

    // ---- RSI / Overheat & distance constraints (tighter than DIP)
    const rsi =
      num(stock.rsi14) ||
      (U.rsiFromData ? U.rsiFromData(data, 14) : rsiLocal(data, 14));
    const distMA25_ATR = ma.ma25 > 0 ? (px - ma.ma25) / atr : 0;
    const consecUp = countConsecutiveUp(data);

    if (rsi >= 62) {
      out.waitReason = `RSI too hot (${rsi.toFixed(1)} ≥ 62).`;
      setDiag(out, { rsi, distMA25_ATR, consecUp });
      return out;
    }
    if (distMA25_ATR > 2.6) {
      out.waitReason = `Too far above MA25 (${distMA25_ATR.toFixed(
        2
      )} ATR > 2.6).`;
      setDiag(out, { rsi, distMA25_ATR, consecUp });
      return out;
    }
    if (consecUp > 6) {
      out.waitReason = `Consecutive up days ${consecUp} > 6.`;
      setDiag(out, { rsi, distMA25_ATR, consecUp });
      return out;
    }

    // ---- Support / reclaim quality (need one)
    const supports =
      (U.findSupportsBelow
        ? U.findSupportsBelow(data, px)
        : findSupportsBelowLocal(data, px)) || [];
    const stopFromSwing = Number.isFinite(supports?.[0])
      ? supports[0] - 0.4 * atr
      : NaN;
    const stopFromMA25 =
      ma.ma25 > 0 && ma.ma25 < px ? ma.ma25 - 0.6 * atr : NaN;

    // Provisional stop (must end below price)
    let stop = [stopFromSwing, stopFromMA25, px - 1.2 * atr]
      .filter((v) => Number.isFinite(v))
      .reduce((m, v) => Math.min(m, v), Infinity);
    if (!Number.isFinite(stop)) stop = px - 1.2 * atr;
    if (stop >= px) stop = px - 1.2 * atr;

    // Reclaim / bounce-strength
    const yHigh = num(data.at(-2)?.high);
    const closeAboveYHigh = yHigh > 0 && px > yHigh;
    const bounceStrengthATR = calcBounceStrengthATR(data, atr);

    // Require one of: near support + solid bounce OR clear reclaim
    const nearSupport = isNearSupport(px, supports, atr, 1.2);
    const bounceGood = bounceStrengthATR >= 1.0 || closeAboveYHigh === true;

    if (!((nearSupport && bounceGood) || closeAboveYHigh)) {
      out.waitReason = "No strong reclaim or quality bounce near support.";
      setDiag(out, {
        nearSupport,
        bounceStrengthATR,
        closeAboveYHigh,
        supports: supports.slice(0, 3),
      });
      return out;
    }

    // ---- Resistances / target promotion logic
    const resListRaw = U.findResistancesAbove
      ? U.findResistancesAbove(data, px, stock)
      : findResistancesAboveLocal(data, px, stock, atr);
    const resList = Array.isArray(resListRaw) ? resListRaw.slice() : [];
    let nearestRes = Number.isFinite(resList[0]) ? resList[0] : null;

    // Base target proposal = nearest effective resistance or px + 2.4*ATR
    let target = Number.isFinite(nearestRes) ? nearestRes : px + 2.4 * atr;

    // If nearest headroom is too tight, consider next cluster
    const headroomATR0 = Number.isFinite(nearestRes)
      ? (nearestRes - px) / atr
      : Infinity;
    if (headroomATR0 < 0.65 && Number.isFinite(resList[1])) {
      target = Math.max(target, resList[1]);
      nearestRes = resList[1];
    }

    // ---- Lenient volume confirmation (optional)
    const volOK = avg20 > 0 ? vol / avg20 >= 0.95 : true;

    // All pre-screen checks passed → trigger
    out.trigger = true;
    out.stop = round2(stop);
    out.target = round2(target);
    out.nearestRes = Number.isFinite(nearestRes) ? nearestRes : null;

    out.why = [
      "RRP lane:",
      closeAboveYHigh ? "reclaim(Y-high)" : nearSupport ? "nearSupport" : "",
      bounceStrengthATR >= 1.0
        ? `bounce=${bounceStrengthATR.toFixed(2)} ATR`
        : "",
      volOK ? "vol~ok" : "",
    ]
      .filter(Boolean)
      .join(" ");

    setDiag(out, {
      trend,
      rsi,
      distMA25_ATR,
      consecUp,
      nearSupport,
      bounceStrengthATR,
      closeAboveYHigh,
      vol,
      avg20,
      resList: resList.slice(0, 4),
      headroomATR0: Number.isFinite(headroomATR0)
        ? +headroomATR0.toFixed(2)
        : null,
    });

    return out;
  } catch (e) {
    out.waitReason = `RRP error: ${String(e?.message || e)}`;
    return out;
  }
}

/* ===================== Internals & small helpers ===================== */

function baseOut() {
  return {
    trigger: false,
    why: "",
    waitReason: "",
    stop: NaN,
    target: NaN,
    nearestRes: null,
    diagnostics: Object.create(null),
  };
}
function setDiag(out, obj) {
  Object.assign(out.diagnostics, obj || {});
}
function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function smaLocal(data, n, field = "close") {
  if (!Array.isArray(data) || data.length < n) return 0;
  let s = 0;
  for (let i = data.length - n; i < data.length; i++)
    s += Number(data[i][field]) || 0;
  return s / n;
}
function rsiLocal(data, length = 14) {
  const n = data.length;
  if (n < length + 1) return 50;
  let gains = 0,
    losses = 0;
  for (let i = n - length; i < n; i++) {
    const prev = Number(data[i - 1].close) || 0;
    const curr = Number(data[i].close) || 0;
    const diff = curr - prev;
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / length;
  const avgLoss = losses / length || 1e-9;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
function countConsecutiveUp(data, k = 8) {
  let c = 0;
  for (let i = data.length - 1; i > 0 && c < k; i--) {
    const prev = Number(data[i - 1].close) || 0;
    const curr = Number(data[i].close) || 0;
    if (curr > prev) c++;
    else break;
  }
  return c;
}
function avgVol(data, n) {
  if (!Array.isArray(data) || data.length < 1) return 0;
  const start = Math.max(0, data.length - n);
  let s = 0,
    c = 0;
  for (let i = start; i < data.length; i++) {
    s += Number(data[i].volume) || 0;
    c++;
  }
  return c ? s / c : 0;
}
function isNearSupport(px, supports, atr, thATR = 1.2) {
  if (!Array.isArray(supports) || !supports.length) return false;
  const d = Math.abs(px - supports[0]) / Math.max(atr, 1e-6);
  return d <= thATR;
}

// crude, robust bounce estimate: reclaim relative to recent pivot low
function calcBounceStrengthATR(data, atr) {
  if (!Array.isArray(data) || data.length < 5) return 0;
  const last = data.at(-1);
  const lows = data.slice(-6).map((d) => Number(d.low) || Number(d.close) || 0);
  const recentLow = Math.min(...lows);
  const px = Number(last.close) || 0;
  return (px - recentLow) / Math.max(atr, 1e-6);
}

function findSupportsBelowLocal(data, px) {
  const downs = [];
  const win = data.slice(-60);
  for (let i = 2; i < win.length - 2; i++) {
    const l = Number(win[i].low) || 0;
    if (
      l < px &&
      l < (Number(win[i - 1].low) || 0) &&
      l < (Number(win[i + 1].low) || 0)
    )
      downs.push(l);
  }
  const uniq = Array.from(
    new Set(downs.map((v) => +Number(v).toFixed(2)))
  ).sort((a, b) => b - a);
  return uniq;
}

function findResistancesAboveLocal(data, px, stock, atr) {
  const ups = [];
  const win = data.slice(-60);
  for (let i = 2; i < win.length - 2; i++) {
    const h = Number(win[i].high) || 0;
    if (
      h > px &&
      h > (Number(win[i - 1].high) || 0) &&
      h > (Number(win[i + 1].high) || 0)
    )
      ups.push(h);
  }
  const yHigh = Number(stock?.fiftyTwoWeekHigh) || 0;
  if (yHigh > px) ups.push(yHigh);
  // cluster nearby lids to avoid micro-resistances
  return clusterLevelsLocal(ups, atr, 0.3);
}

function clusterLevelsLocal(levels, atrVal, thMul = 0.3) {
  const th = thMul * Math.max(atrVal, 1e-9);
  const uniq = Array.from(
    new Set(levels.map((v) => +Number(v).toFixed(2)))
  ).sort((a, b) => a - b);
  const out = [];
  let bucket = [];
  for (let i = 0; i < uniq.length; i++) {
    if (!bucket.length || Math.abs(uniq[i] - bucket[bucket.length - 1]) <= th)
      bucket.push(uniq[i]);
    else {
      out.push(avg(bucket));
      bucket = [uniq[i]];
    }
  }
  if (bucket.length) out.push(avg(bucket));
  return out;
}
function avg(arr) {
  return arr.length
    ? arr.reduce((a, b) => a + (Number(b) || 0), 0) / arr.length
    : 0;
}
