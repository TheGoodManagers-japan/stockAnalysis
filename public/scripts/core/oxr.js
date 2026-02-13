// /scripts/oxr.js — Over-recovery / Breakout (OXR) — TIGHTER VERSION
// Breakout after shallow/base consolidation or rapid over-recovery.
// Exports: detectOXR(stock, data, cfg, U)

export function detectOXR(stock, data, cfg, U) {
  const n = Array.isArray(data) ? data.length : 0;
  if (n < 40) {
    return {
      trigger: false,
      why: "",
      waitReason: "Insufficient bars for OXR.",
      stop: NaN,
      target: NaN,
      nearestRes: NaN,
      diagnostics: {},
    };
  }

  const px = Number(stock.currentPrice ?? data[n - 1].close) || 0;
  const last = data[n - 1];
  const prev = data[n - 2] || last;

  // helpers
  const sma = (k) => {
    if (n < k) return 0;
    let s = 0;
    for (let i = n - k; i < n; i++) s += Number(data[i].close) || 0;
    return s / k;
  };
  const ma5 = Number(stock.movingAverage5d) || sma(5);
  const ma25 = Number(stock.movingAverage25d) || sma(25);
  const ma50 = Number(stock.movingAverage50d) || sma(50);

  const atr = Math.max(Number(stock.atr14) || 0, px * 0.005, 1e-6);
  const rsi = Number(stock.rsi14) || U.rsiFromData(data, 14);

  // recent highs/lows
  const win20 = data.slice(-20);
  const win40 = data.slice(-40);
  const recentHigh20 = Math.max(
    ...win20.map((b) => Number(b.high) || -Infinity)
  );
  const recentLow20 = Math.min(...win20.map((b) => Number(b.low) || Infinity));
  const recentHigh40 = Math.max(
    ...win40.map((b) => Number(b.high) || -Infinity)
  );
  const recentLow40 = Math.min(...win40.map((b) => Number(b.low) || Infinity));

  // Simple “base” quality: contraction & tight closes
  const trueRange = (b, p) => {
    const hi = Number(b.high) || 0,
      lo = Number(b.low) || 0,
      pc = Number(p?.close) || lo;
    return Math.max(hi - lo, Math.abs(hi - pc), Math.abs(lo - pc));
  };
  const atr5 = Math.max(
    1e-9,
    data.slice(-5).reduce((a, b, i, arr) => a + trueRange(b, arr[i - 1]), 0) / 5
  );
  const atr15 = Math.max(
    1e-9,
    data.slice(-15).reduce((a, b, i, arr) => a + trueRange(b, arr[i - 1]), 0) /
      15
  );
  const contraction = atr5 / atr15; // < 1 ⇒ volatility contracted

  // Volume expansion proxy (if volume available)
  const volAvg20 = Math.max(
    1,
    data.slice(-20).reduce((a, b) => a + (Number(b.volume) || 0), 0) / 20
  );
  const volNow = Math.max(1, Number(last.volume) || 1);
  const volExp = volNow / volAvg20;

  // Trend/range context
  const trendIsUp = px > ma25 && ma25 > ma50 && ma50 > 0;
  const dayUp = px >= Math.max(Number(last.open) || 0, Number(prev.close) || 0);

  // ======================= TIGHTER DEFINITIONS =======================

  // Breakout definition: must clear **40-bar high** with cushion, on a green day
  const breakoutCushionPct = 0.4; // was 0.15%
  const above20 = px >= recentHigh20 * (1 + breakoutCushionPct / 100);
  const above40 = px >= recentHigh40 * (1 + breakoutCushionPct / 100);

  // NOTE: we no longer accept reclaimedYHigh as a standalone trigger.
  const breakout = above40 && dayUp;

  // Guardrails/overheat — OXR stricter than global
  const distFromMA25_ATR = (px - ma25) / Math.max(atr, 1e-9);
  const tooExtended = distFromMA25_ATR > (cfg.maxATRfromMA25_OXR ?? 1.8);
  const rsiTooHot = rsi >= (cfg.oxrRSI ?? 72);

  // Headroom / resistances above — need ≥ 1.0 ATR of air
  const resistances = U.findResistancesAbove(data, px, stock);
  let nearestRes = resistances[0];
  let headroomATR = Number.isFinite(nearestRes)
    ? (nearestRes - px) / Math.max(atr, 1e-9)
    : Infinity;
  // If first lid is too close, look to next
  if (Number.isFinite(nearestRes) && headroomATR < 0.8 && resistances[1]) {
    nearestRes = resistances[1];
    headroomATR = (nearestRes - px) / Math.max(atr, 1e-9);
  }
  const headroomOK = headroomATR >= (cfg.oxrHeadroomATR ?? 1.0);

  // Base/structure quality — real box (tight + not too shallow/loose)
  const baseDepthPct =
    ((recentHigh20 - recentLow20) / Math.max(recentHigh20, 1e-9)) * 100;
  const baseDepthATR = (recentHigh20 - recentLow20) / Math.max(atr, 1e-9);
  // require real contraction and 1.0–2.5 ATR deep base
  const baseTightEnough =
    contraction <= 0.7 && baseDepthATR >= 1.0 && baseDepthATR <= 2.5;

  // Volume: require a real pop if volume exists
  const volExpNeed = 1.5; // was 1.15
  const volGood = Number.isFinite(last.volume) ? volExp >= volExpNeed : true;

  // ======================= TRIGGER =======================
  let trigger =
    trendIsUp &&
    breakout &&
    dayUp &&
    !tooExtended &&
    !rsiTooHot &&
    headroomOK &&
    baseTightEnough &&
    volGood;

  let waitReason = "";
  if (!trendIsUp) waitReason = "trend not up enough for OXR.";
  else if (!breakout)
    waitReason = "no breakout above 40-bar high with cushion.";
  else if (tooExtended)
    waitReason = "already recovered > cap (too extended for OXR).";
  else if (rsiTooHot) waitReason = "RSI too hot for OXR.";
  else if (!headroomOK)
    waitReason = "headroom too small post-breakout (need ≥1.0 ATR).";
  else if (!baseTightEnough)
    waitReason =
      "base not tight/deep enough (need contraction ≤0.70 & 1–2.5 ATR depth).";
  else if (!volGood)
    waitReason = "no volume expansion on breakout (need ≥1.5× 20d).";

  if (!trigger) {
    return {
      trigger: false,
      why: "",
      waitReason,
      stop: NaN,
      target: NaN,
      nearestRes,
      diagnostics: {
        breakout,
        above20,
        above40,
        dayUp,
        contraction: +contraction.toFixed(2),
        baseDepthPct: +baseDepthPct.toFixed(2),
        baseDepthATR: +baseDepthATR.toFixed(2),
        volExp: +volExp.toFixed(2),
        rsi: +rsi.toFixed(1),
        distFromMA25_ATR: +distFromMA25_ATR.toFixed(2),
        headroomATR: Number.isFinite(headroomATR)
          ? +headroomATR.toFixed(2)
          : null,
      },
    };
  }

  // ======================= PLAN =======================
  // Stop under **base low** or MA25-band; measured move ≥ 2.2 ATR
  const baseTop = recentHigh20;
  const baseLow = recentLow20;
  const measured = Math.max(2.2 * atr, baseTop - baseLow); // was 1.8*ATR

  const stopBase = baseLow - 0.5 * atr; // below base, not top
  const stopMA25 = ma25 > 0 ? ma25 - 0.8 * atr : px - 1.6 * atr;
  let stop = Math.min(stopBase, stopMA25);

  // Target honors shelves but never less than measured
  let target = Number.isFinite(nearestRes)
    ? Math.max(nearestRes, px + measured)
    : px + Math.max(2.4 * atr, measured);

  // If the first shelf is still too close, try the next one
  if (
    Number.isFinite(nearestRes) &&
    (nearestRes - px) / Math.max(atr, 1e-9) < 0.8 &&
    resistances[1]
  ) {
    target = Math.max(target, resistances[1]);
  }

  return {
    trigger: true,
    why: "OXR breakout: volatility contraction + clean 40-bar high reclaim.",
    stop,
    target,
    nearestRes,
    diagnostics: {
      breakout,
      contraction: +contraction.toFixed(2),
      baseDepthPct: +baseDepthPct.toFixed(2),
      baseDepthATR: +baseDepthATR.toFixed(2),
      volExp: +volExp.toFixed(2),
      rsi: +rsi.toFixed(1),
      distFromMA25_ATR: +distFromMA25_ATR.toFixed(2),
      headroomATR: Number.isFinite(headroomATR)
        ? +headroomATR.toFixed(2)
        : null,
    },
  };
}
