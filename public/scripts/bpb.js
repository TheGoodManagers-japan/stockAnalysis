// /scripts/bpb.js — Breakout–Pullback–Bounce (BPB)
// After a recent breakout, wait for a controlled pullback to the breakout area/base top,
// then enter on a reclaim/bounce with defined risk below the pullback low / level.

export function detectBPB(stock, data, cfg, U) {
  const n = Array.isArray(data) ? data.length : 0;
  if (n < 50) {
    return {
      trigger: false,
      why: "",
      waitReason: "Insufficient bars for BPB.",
      stop: NaN,
      target: NaN,
      nearestRes: NaN,
      diagnostics: {},
    };
  }

  const last = data[n - 1];
  const px = Number(stock.currentPrice ?? last.close) || 0;
  const prev = data[n - 2] || last;

  const atr = Math.max(Number(stock.atr14) || 0, px * 0.005, 1e-6);
  const rsi = Number(stock.rsi14) || U.rsiFromData(data, 14);

  // Simple MAs for context
  const sma = (k) => {
    if (n < k) return 0;
    let s = 0;
    for (let i = n - k; i < n; i++) s += Number(data[i].close) || 0;
    return s / k;
  };
  const ma25 = Number(stock.movingAverage25d) || sma(25);
  const ma50 = Number(stock.movingAverage50d) || sma(50);

  // ---- 1) Find a recent breakout (within lookback L), then pullback to its level ----
  const L = 25; // lookback for breakout event
  const winL = data.slice(-Math.max(L + 15, 40));

  const localHighs = [];
  for (let i = 2; i < winL.length - 2; i++) {
    const b = winL[i];
    if (b.high > winL[i - 1].high && b.high > winL[i + 1].high) {
      localHighs.push({ idx: i, price: Number(b.high) || 0 });
    }
  }

  // Recent breakout reference = last significant local high that price closed above
  let breakoutIdx = -1;
  let breakoutLevel = NaN;
  for (let k = localHighs.length - 1; k >= 0; k--) {
    const h = localHighs[k];
    const absIdx = n - winL.length + h.idx;
    // Did we close above this high in the last L bars?
    let broke = false;
    for (let j = Math.max(absIdx + 1, n - L); j < n; j++) {
      if ((Number(data[j].close) || 0) > h.price * 1.0015) {
        broke = true;
        break;
      }
    }
    if (broke) {
      breakoutIdx = absIdx;
      breakoutLevel = h.price;
      break;
    }
  }

  if (breakoutIdx < 0 || !Number.isFinite(breakoutLevel)) {
    return {
      trigger: false,
      why: "",
      waitReason: "no identifiable recent breakout to retest.",
      stop: NaN,
      target: NaN,
      nearestRes: NaN,
      diagnostics: {},
    };
  }

  // ---- 2) Pullback quality: retreat toward the breakout level, hold above/bounce ----
  // "Near" band: within X*ATR below/above breakout level
  const nearBandATR = 0.8; // how far under the level we still consider "near"
  const pulledNearLevel =
    Number(last.low) <= breakoutLevel + 0.2 * atr &&
    Number(last.low) >= breakoutLevel - nearBandATR * atr;

  // Basic “bounce” day: close back above open/prev close, small upper headroom check later
  const dayUp = px >= Math.max(Number(last.open) || 0, Number(prev.close) || 0);

  // Avoid overheated/extended
  const distFromMA25_ATR = (px - ma25) / Math.max(atr, 1e-9);
  const tooExtended = distFromMA25_ATR > (cfg.maxATRfromMA25 ?? 3.5) + 0.2;
  const rsiTooHot = rsi >= Math.min((cfg.softRSI ?? 74) + 2, 78);

  // Headroom above: resistances (avoid buying under a tight lid)
  const resistances = U.findResistancesAbove(data, px, stock);
  let nearestRes = resistances[0];
  let headroomATR = Number.isFinite(nearestRes)
    ? (nearestRes - px) / Math.max(atr, 1e-9)
    : Infinity;
  if (Number.isFinite(nearestRes) && headroomATR < 0.6 && resistances[1]) {
    nearestRes = resistances[1];
    headroomATR = (nearestRes - px) / Math.max(atr, 1e-9);
  }
  const headroomOK =
    headroomATR >= Math.max(0.55, (cfg.nearResVetoATR ?? 0.22) - 0.06);

  // Trend filter: prefer px ≥ ma25 and ma25 ≥ ma50 (friendly tape)
  const trendOK = px >= ma25 && ma25 >= ma50 && ma50 > 0;

  // Volume confirmation if available (lenient)
  const volNow = Math.max(1, Number(last.volume) || 1);
  const volAvg20 = Math.max(
    1,
    data.slice(-20).reduce((a, b) => a + (Number(b.volume) || 0), 0) / 20
  );
  const volExp = volNow / volAvg20;
  const volOK = !Number.isFinite(Number(last.volume)) || volExp >= 0.95;

  let trigger =
    trendOK &&
    pulledNearLevel &&
    dayUp &&
    !tooExtended &&
    !rsiTooHot &&
    headroomOK &&
    volOK;

  let waitReason = "";
  if (!trendOK) waitReason = "trend not up enough for BPB.";
  else if (!pulledNearLevel)
    waitReason = "no clean pullback test at breakout level.";
  else if (!dayUp) waitReason = "no bounce/reclaim on test.";
  else if (tooExtended)
    waitReason = "already recovered > cap (too extended for BPB).";
  else if (rsiTooHot) waitReason = "RSI too hot for BPB.";
  else if (!headroomOK) waitReason = "headroom too small post-retest.";
  else if (!volOK) waitReason = "no/weak volume confirmation.";

  if (!trigger) {
    return {
      trigger: false,
      why: "",
      waitReason,
      stop: NaN,
      target: NaN,
      nearestRes,
      diagnostics: {
        breakoutLevel,
        pulledNearLevel,
        dayUp,
        rsi: +rsi.toFixed(1),
        distFromMA25_ATR: +distFromMA25_ATR.toFixed(2),
        headroomATR: Number.isFinite(headroomATR)
          ? +headroomATR.toFixed(2)
          : null,
        volExp: +volExp.toFixed(2),
      },
    };
  }

  // ---- 3) Plan: stop under pullback low / level, target at next shelf or measured push ----
  const pullbackLow = Number(last.low) || px;
  const stopLevel = Math.min(
    pullbackLow - 0.4 * atr,
    breakoutLevel - 0.6 * atr
  );
  let stop = stopLevel;

  // Target: next resistance or measured drift above breakout (ATR-based)
  let target = Number.isFinite(nearestRes) ? nearestRes : px + 2.2 * atr;
  if (
    Number.isFinite(nearestRes) &&
    (nearestRes - px) / Math.max(atr, 1e-9) < 0.75 &&
    resistances[1]
  ) {
    target = Math.max(target, resistances[1]);
  }

  return {
    trigger: true,
    why: "BPB: first pullback/retest to breakout level, bounce/reclaim.",
    stop,
    target,
    nearestRes,
    diagnostics: {
      breakoutLevel,
      pullbackLow,
      rsi: +rsi.toFixed(1),
      distFromMA25_ATR: +distFromMA25_ATR.toFixed(2),
      headroomATR: Number.isFinite(headroomATR)
        ? +headroomATR.toFixed(2)
        : null,
      volExp: +volExp.toFixed(2),
    },
  };
}
