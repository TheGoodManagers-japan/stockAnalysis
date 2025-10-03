// /scripts/spc.js — SPC v2 (friendlier gates + sturdier stop)

export function detectSPC(stock, data, cfg, U) {
  const T = U?.tracer || (() => {});
  const n = data?.length || 0;
  if (n < 25) {
    return {
      trigger: false,
      why: "",
      waitReason: "Insufficient bars for SPC.",
      stop: NaN,
      target: NaN,
      nearestRes: NaN,
      diagnostics: {},
    };
  }

  const px = Number(stock.currentPrice ?? data[n - 1].close) || 0;
  const last = data[n - 1];
  const prev = data[n - 2] || last;

  // --- helpers ---
  const sma = (k) => {
    if (n < k) return 0;
    let s = 0;
    for (let i = n - k; i < n; i++) s += Number(data[i].close) || 0;
    return s / k;
  };
  const ma5 = Number(stock.movingAverage5d) || sma(5);
  const ma20 = Number(stock.movingAverage20d) || sma(20);
  const ma25 = Number(stock.movingAverage25d) || sma(25);

  const atr = Math.max(Number(stock.atr14) || 0, px * 0.005, 1e-6);
  const yHigh = Number(prev.high) || 0;
  const d2High = Math.max(
    Number(prev.high) || 0,
    Number(data[n - 3]?.high) || 0
  );
  const closeAboveYHigh = px > yHigh + 1e-8;
  const closeAbove2dHigh = px > d2High + 1e-8;
  const dayUp = px >= Math.max(Number(last.open) || 0, Number(prev.close) || 0);

  // friendlier tape flag
  const friendlyTape = closeAboveYHigh || closeAbove2dHigh || dayUp;

  // dip sizing
  const loN = Math.min(5, n - 1);
  const recentLow = Math.min(
    ...data.slice(n - loN).map((b) => Number(b.low) || Infinity)
  );
  const dipPct = ((px - recentLow) / Math.max(px, 1e-9)) * 100;
  const dipATR = (px - recentLow) / Math.max(atr, 1e-9);
  const pullbackFromMA5 =
    Math.max(0, (ma5 ? ma5 - px : 0) / Math.max(px, 1e-9)) * 100;

  // trend filter (softer near MA25)
  const ma25Prev =
    n >= 30
      ? Number(data[n - 6]?.close)
        ? data.slice(n - 30, n - 5).reduce((s, b) => s + (b.close || 0), 0) / 25
        : ma25
      : ma25;
  const ma25SlopeNonDown = ma25 - ma25Prev >= -0.02 * atr; // roughly flat or up
  const nearMA25 = px - ma25 >= -0.1 * atr; // within 0.1 ATR below allowed
  const trendIsUp =
    (px > ma25 && ma25 > 0) ||
    (nearMA25 && ma25SlopeNonDown) ||
    (px > ma20 && ma25SlopeNonDown);

  // extension / heat
  const rsi = Number(stock.rsi14) || U.rsiFromData(data, 14);
  const distFromMA25_ATR = (px - ma25) / Math.max(atr, 1e-9);
  const tooExtended = distFromMA25_ATR > (cfg.maxATRfromMA25 ?? 3.5) + 0.2;
  const rsiSoftCapBase = (cfg.softRSI ?? 74) + (closeAboveYHigh ? 2 : 0);
  const rsiSoftCap = rsiSoftCapBase + (distFromMA25_ATR < 1.0 ? 1 : 0); // tiny extra room if not far from MA25
  const rsiTooHot = rsi >= rsiSoftCap;

  // resistance & headroom
  const resistances = U.findResistancesAbove(data, px, stock);
  const nearestRes = resistances[0];
  const headroomATR = Number.isFinite(nearestRes)
    ? (nearestRes - px) / Math.max(atr, 1e-9)
    : Infinity;

  // bar micro-structure
  const dayRange = Math.max(1e-9, (last.high ?? px) - (last.low ?? px));
  const bodyPct =
    (Math.abs((last.close ?? px) - (last.open ?? px)) / Math.max(px, 1e-9)) *
    100;
  const rangeATR = dayRange / Math.max(atr, 1e-9);
  const insideBar =
    (last.high ?? 0) <= (prev.high ?? 0) && (last.low ?? 0) >= (prev.low ?? 0);
  const tightDrift = rangeATR <= 0.6 && bodyPct <= 0.5;

  // tiny-dip thresholds (friendlier in friendly tape)
  const tinyDipPctMax = friendlyTape ? 1.1 : 0.7; // was 0.9 / 0.7
  const tinyDipATRMax = friendlyTape ? 1.0 : 0.7; // was 0.9 / 0.7

  const tinyDipOK =
    pullbackFromMA5 <= tinyDipPctMax ||
    (dipPct <= tinyDipPctMax && dipATR <= tinyDipATRMax) ||
    insideBar ||
    tightDrift;

  // momentum & headroom gates
  const momentumOK = closeAboveYHigh || closeAbove2dHigh || dayUp;
  const baseHeadroomReq = Math.max(0.6, (cfg.nearResVetoATR ?? 0.22) - 0.04);
  const easedHeadroomReq = 0.5; // new eased floor
  const headroomOK =
    headroomATR >=
    (closeAboveYHigh || insideBar || tightDrift
      ? easedHeadroomReq
      : baseHeadroomReq);

  let trigger =
    trendIsUp &&
    tinyDipOK &&
    momentumOK &&
    !tooExtended &&
    !rsiTooHot &&
    headroomOK;

  let waitReason = "";
  if (!trendIsUp) waitReason = "trend not up enough for SPC.";
  else if (!tinyDipOK)
    waitReason = "no meaningful pullback (SPC needs tiny dip/inside).";
  else if (!momentumOK)
    waitReason = "no SPC momentum (need green day or recent high reclaim).";
  else if (tooExtended) waitReason = "too extended above MA25 for SPC.";
  else if (rsiTooHot) waitReason = "RSI too hot for SPC.";
  else if (!headroomOK) waitReason = "headroom too small for SPC.";

  // --- continuation override (looser strong-close & allow 2d-high reclaim) ---
  if (
    !trigger &&
    trendIsUp &&
    !tooExtended &&
    !rsiTooHot &&
    (closeAboveYHigh || closeAbove2dHigh || dayUp) &&
    headroomOK
  ) {
    const range = Math.max(1e-9, (last.high ?? px) - (last.low ?? px));
    const body = Math.abs(px - (last.open ?? px));
    const strongClose = body >= 0.45 * range && px >= (last.high ?? px) * 0.96; // was 0.55 & 0.98
    const higherHigh = (last.high ?? 0) > (prev.high ?? 0);
    const higherLow = (last.low ?? 0) >= (prev.low ?? 0) * 0.99;

    if (strongClose && higherHigh && higherLow) {
      const stopSwing = recentLow - 0.55 * atr; // was 0.4
      const stopMA5 = ma5 > 0 ? ma5 - 0.6 * atr : px - 1.0 * atr; // was 0.5
      let overrideStop = Math.min(stopSwing, stopMA5);

      // prefer next lid sooner if micro-lid too close
      let overrideTarget = Number.isFinite(nearestRes)
        ? nearestRes
        : px + 1.9 * atr;
      if (Number.isFinite(nearestRes)) {
        const nearLidATR = (nearestRes - px) / Math.max(atr, 1e-9);
        if (nearLidATR < 0.6 && resistances[1]) {
          // was 0.70
          overrideTarget = Math.max(overrideTarget, resistances[1]);
        }
      }

      return {
        trigger: true,
        why: `SPC continuation override: strong close, HH/HL; tiny-dip missing.`,
        stop: overrideStop,
        target: overrideTarget,
        nearestRes,
        diagnostics: {
          friendlyTape,
          insideBar,
          tightDrift,
          closeAboveYHigh,
          closeAbove2dHigh,
          dayUp,
          dipPct: +dipPct.toFixed(2),
          dipATR: +dipATR.toFixed(2),
          pullbackFromMA5: +pullbackFromMA5.toFixed(2),
          rsi: +rsi.toFixed(1),
          rsiSoftCap,
          distFromMA25_ATR: +distFromMA25_ATR.toFixed(2),
          headroomATR: Number.isFinite(headroomATR)
            ? +headroomATR.toFixed(2)
            : null,
          override: true,
          strongClose,
          higherHigh,
          higherLow,
        },
      };
    }
  }

  if (!trigger) {
    return {
      trigger: false,
      why: "",
      waitReason,
      stop: NaN,
      target: NaN,
      nearestRes,
      diagnostics: {
        friendlyTape,
        insideBar,
        tightDrift,
        closeAboveYHigh,
        closeAbove2dHigh,
        dayUp,
        dipPct: +dipPct.toFixed(2),
        dipATR: +dipATR.toFixed(2),
        pullbackFromMA5: +pullbackFromMA5.toFixed(2),
        rsi: +rsi.toFixed(1),
        rsiSoftCap,
        distFromMA25_ATR: +distFromMA25_ATR.toFixed(2),
        headroomATR: Number.isFinite(headroomATR)
          ? +headroomATR.toFixed(2)
          : null,
      },
    };
  }

  // --- base plan (slightly wider stop) ---
  const stopSwing = recentLow - 0.55 * atr; // was 0.4
  const stopMA5 = ma5 > 0 ? ma5 - 0.6 * atr : px - 1.0 * atr; // was 0.5
  let stop = Math.min(stopSwing, stopMA5);

  let target = Number.isFinite(nearestRes) ? nearestRes : px + 1.8 * atr;
  if (Number.isFinite(nearestRes)) {
    const nearLidATR = (nearestRes - px) / Math.max(atr, 1e-9);
    if (nearLidATR < 0.6 && resistances[1]) {
      // was 0.70
      target = Math.max(target, resistances[1]);
    }
  }
  if (!Number.isFinite(target)) target = px + 2.0 * atr;

  return {
    trigger: true,
    why: `SPC continuation: ${
      closeAboveYHigh || closeAbove2dHigh ? "recent-high reclaim" : "green day"
    }, tiny-dip OK.`,
    stop,
    target,
    nearestRes,
    diagnostics: {
      friendlyTape,
      insideBar,
      tightDrift,
      closeAboveYHigh,
      closeAbove2dHigh,
      dayUp,
      dipPct: +dipPct.toFixed(2),
      dipATR: +dipATR.toFixed(2),
      pullbackFromMA5: +pullbackFromMA5.toFixed(2),
      rsi: +rsi.toFixed(1),
      rsiSoftCap,
      distFromMA25_ATR: +distFromMA25_ATR.toFixed(2),
      headroomATR: Number.isFinite(headroomATR)
        ? +headroomATR.toFixed(2)
        : null,
    },
  };
}
