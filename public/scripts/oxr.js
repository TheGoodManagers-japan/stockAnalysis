// /scripts/oxr.js — Over-recovery / Breakout (OXR)
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
  const reclaimedYHigh = px > (Number(prev.high) || 0) + 1e-8;
  const dayUp = px >= Math.max(Number(last.open) || 0, Number(prev.close) || 0);

  // Breakout definition: close above recent high with some cushion OR strong reclaim
  const breakoutCushionPct = 0.15; // 0.15% above recent high
  const above20 = px >= recentHigh20 * (1 + breakoutCushionPct / 100);
  const above40 = px >= recentHigh40 * (1 + breakoutCushionPct / 100);
  const breakout = above20 || above40 || reclaimedYHigh;

  // Guardrails/overheat
  const distFromMA25_ATR = (px - ma25) / Math.max(atr, 1e-9);
  const tooExtended = distFromMA25_ATR > (cfg.maxATRfromMA25 ?? 3.5) + 0.4;
  const rsiTooHot = rsi >= (cfg.softRSI ?? 74) + 4; // OXR tolerates a bit more, but still cap

  // Headroom / resistances above
  const resistances = U.findResistancesAbove(data, px, stock);
  let nearestRes = resistances[0];
  let headroomATR = Number.isFinite(nearestRes)
    ? (nearestRes - px) / Math.max(atr, 1e-9)
    : Infinity;
  // If first lid is too close, look to next
  if (Number.isFinite(nearestRes) && headroomATR < 0.6 && resistances[1]) {
    nearestRes = resistances[1];
    headroomATR = (nearestRes - px) / Math.max(atr, 1e-9);
  }
  const headroomOK =
    headroomATR >= Math.max(0.55, (cfg.nearResVetoATR ?? 0.22) - 0.06);

  // Base/structure quality
  const baseDepthPct =
    ((recentHigh20 - recentLow20) / Math.max(recentHigh20, 1e-9)) * 100;
  const baseTightEnough = contraction < 0.9 && baseDepthPct <= 8; // not too loose

  // Trigger logic (lenient on vol if no volume data)
  let trigger =
    trendIsUp &&
    breakout &&
    (dayUp || reclaimedYHigh) &&
    !tooExtended &&
    !rsiTooHot &&
    headroomOK &&
    (baseTightEnough || contraction < 1.0) &&
    (Number.isFinite(last.volume) ? volExp >= 1.15 : true);

  let waitReason = "";
  if (!trendIsUp) waitReason = "trend not up enough for OXR.";
  else if (!breakout) waitReason = "no breakout above recent highs.";
  else if (tooExtended)
    waitReason = "already recovered > cap (too extended for OXR).";
  else if (rsiTooHot) waitReason = "RSI too hot for OXR.";
  else if (!headroomOK) waitReason = "headroom too small post-breakout.";
  else if (!(baseTightEnough || contraction < 1.0))
    waitReason = "base not tight/contracting.";
  else if (Number.isFinite(last.volume) && volExp < 1.15)
    waitReason = "no volume expansion on breakout.";

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
        reclaimedYHigh,
        dayUp,
        contraction: +contraction.toFixed(2),
        baseDepthPct: +baseDepthPct.toFixed(2),
        volExp: +volExp.toFixed(2),
        rsi: +rsi.toFixed(1),
        distFromMA25_ATR: +distFromMA25_ATR.toFixed(2),
        headroomATR: Number.isFinite(headroomATR)
          ? +headroomATR.toFixed(2)
          : null,
      },
    };
  }

  // Plan: stop under breakout level / base top, target via next shelf or measured move
  const baseTop = recentHigh20;
  const baseLow = recentLow20;
  const measured = Math.max(1.8 * atr, baseTop - baseLow); // simple measured move
  const stopBase = baseTop - 0.6 * atr; // fail of breakout
  const stopMA25 = ma25 > 0 ? ma25 - 0.8 * atr : px - 1.6 * atr;
  let stop = Math.min(stopBase, stopMA25);

  let target = Number.isFinite(nearestRes)
    ? Math.max(nearestRes, px + measured)
    : px + 2.4 * atr;
  // If target still too close, try next resistance
  if (
    Number.isFinite(nearestRes) &&
    (nearestRes - px) / Math.max(atr, 1e-9) < 0.8 &&
    resistances[1]
  ) {
    target = Math.max(target, resistances[1]);
  }

  return {
    trigger: true,
    why: "OXR breakout: volatility contraction + high reclaim.",
    stop,
    target,
    nearestRes,
    diagnostics: {
      breakout,
      contraction: +contraction.toFixed(2),
      baseDepthPct: +baseDepthPct.toFixed(2),
      volExp: +volExp.toFixed(2),
      rsi: +rsi.toFixed(1),
      distFromMA25_ATR: +distFromMA25_ATR.toFixed(2),
      headroomATR: Number.isFinite(headroomATR)
        ? +headroomATR.toFixed(2)
        : null,
    },
  };
}
