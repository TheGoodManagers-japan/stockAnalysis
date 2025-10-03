// /scripts/spc.js — Shallow Pullback / Continuation (SPC)
// Detects “no meaningful pullback” style continuation entries.
// Exports: detectSPC(stock, data, cfg, U)

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

  // --- Lite market structure & helpers ---
  const sma = (k) => {
    if (n < k) return 0;
    let s = 0;
    for (let i = n - k; i < n; i++) s += Number(data[i].close) || 0;
    return s / k;
  };
  const ma5 = Number(stock.movingAverage5d) || sma(5);
  const ma25 = Number(stock.movingAverage25d) || sma(25);

  const atr = Math.max(Number(stock.atr14) || 0, px * 0.005, 1e-6);
  const dayUp = px >= Math.max(Number(last.open) || 0, Number(prev.close) || 0);
  const yHigh = Number(prev.high) || 0;
  const closeAboveYHigh = px > yHigh + 1e-8;

  // --- SPC idea: tiny dip or “no meaningful pullback” then continuation ---
  // pullback size estimate: distance from recent swing or MA5 band
  const tinyDipPctMax = 0.7; // ≤0.7% qualifies as “tiny”
  const tinyDipATRMax = 0.7; // ≤0.7 ATR qualifies as “tiny”
  const pullbackFromMA5 = Math.max(0, (ma5 ? ma5 - px : 0) / (px || 1)) * 100;

  // recent minor dip (lookback few bars) — crude but robust:
  const loN = Math.min(5, n - 1);
  const recentLow = Math.min(
    ...data.slice(n - loN).map((b) => Number(b.low) || Infinity)
  );
  const dipPct = ((px - recentLow) / Math.max(px, 1e-9)) * 100;
  const dipATR = (px - recentLow) / Math.max(atr, 1e-9);

  // trend filter: favor up regimes (the orchestrator ensures this, but double check)
  const trendIsUp = px > ma25 && ma25 > 0;

  // Extension/overheat checks (SPC is sensitive to chasing)
  const rsi = Number(stock.rsi14) || U.rsiFromData(data, 14);
  const distFromMA25_ATR = (px - ma25) / Math.max(atr, 1e-9);
  const tooExtended = distFromMA25_ATR > (cfg.maxATRfromMA25 ?? 3.5) + 0.2;
  const rsiTooHot = rsi >= (cfg.softRSI ?? 74);

  // Headroom: we need a lid far enough to justify a small momentum pop
  const resistances = U.findResistancesAbove(data, px, stock);
  const nearestRes = resistances[0];
  const headroomATR = Number.isFinite(nearestRes)
    ? (nearestRes - px) / Math.max(atr, 1e-9)
    : Infinity;

  // Basic SPC trigger:
  //  1) Up-trend-ish AND (close above Y-high OR day is green)
  //  2) The recent “dip” was small (tiny pullback)
  //  3) Not too extended / overheated
  //  4) Some headroom exists
  const tinyDipOK =
    pullbackFromMA5 <= tinyDipPctMax ||
    (dipPct <= tinyDipPctMax && dipATR <= tinyDipATRMax);

  const momentumOK = closeAboveYHigh || dayUp;
  const headroomOK =
    headroomATR >= Math.max(0.6, (cfg.nearResVetoATR ?? 0.22) - 0.04);

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
    waitReason = "no SPC momentum (need green day or Y-high reclaim).";
  else if (tooExtended) waitReason = "too extended above MA25 for SPC.";
  else if (rsiTooHot) waitReason = "RSI too hot for SPC.";
  else if (!headroomOK) waitReason = "headroom too small for SPC.";

  // --- Continuation override (no meaningful pullback, but momentum/structure strong)
  // Fire SPC when tinyDip fails but tape is friendly and momentum is clean.
  if (
    !trigger && // only if base SPC didn't pass
    trendIsUp && // must be above MA25
    !tooExtended &&
    !rsiTooHot && // not overheated/extended
    momentumOK && // green day or Y-high reclaim
    headroomOK // enough room to a lid
  ) {
    // crude momentum proxy (no ADX here): strong close near day high, HH/HL
    const range = Math.max(1e-9, (last.high ?? px) - (last.low ?? px));
    const body = Math.abs(px - (last.open ?? px));
    const strongClose = body >= 0.55 * range && px >= (last.high ?? px) * 0.98;
    const higherHigh = (last.high ?? 0) > (prev.high ?? 0);
    const higherLow = (last.low ?? 0) >= (prev.low ?? 0) * 0.99;

    if (strongClose && higherHigh && higherLow) {
      // Accept continuation without a textbook tiny dip
      trigger = true;

      // Tight, structure-first stop; keep SPC-style modest target
      const stopSwing = recentLow - 0.4 * atr;
      const stopMA5 = ma5 > 0 ? ma5 - 0.5 * atr : px - 1.0 * atr;
      stop = Math.min(stopSwing, stopMA5);

      // Prefer nearest usable resistance; if micro-lid too close, hop to next
      target = Number.isFinite(nearestRes) ? nearestRes : px + 1.9 * atr;
      if (
        Number.isFinite(nearestRes) &&
        (nearestRes - px) / Math.max(atr, 1e-9) < 0.7 &&
        resistances[1]
      ) {
        target = Math.max(target, resistances[1]);
      }

      // Keep the explanatory 'why' concise
      return {
        trigger: true,
        why: `SPC continuation override: strong close, HH/HL; tiny-dip missing.`,
        stop,
        target,
        nearestRes,
        diagnostics: {
          closeAboveYHigh,
          dayUp,
          dipPct: +dipPct.toFixed(2),
          dipATR: +dipATR.toFixed(2),
          pullbackFromMA5: +pullbackFromMA5.toFixed(2),
          rsi: +rsi.toFixed(1),
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

  // If not triggering, return with diagnostics for telemetry
  if (!trigger) {
    return {
      trigger: false,
      why: "",
      waitReason,
      stop: NaN,
      target: NaN,
      nearestRes,
      diagnostics: {
        closeAboveYHigh,
        dayUp,
        dipPct: +dipPct.toFixed(2),
        dipATR: +dipATR.toFixed(2),
        pullbackFromMA5: +pullbackFromMA5.toFixed(2),
        rsi: +rsi.toFixed(1),
        distFromMA25_ATR: +distFromMA25_ATR.toFixed(2),
        headroomATR: Number.isFinite(headroomATR)
          ? +headroomATR.toFixed(2)
          : null,
      },
    };
  }

  // --- Plan (SPC stops/targets are tighter than DIP) ---
  // Stop: below MA5 or minor swing low (tighter of the two, minus a small buffer)
  const stopSwing = recentLow - 0.4 * atr;
  const stopMA5 = ma5 > 0 ? ma5 - 0.5 * atr : px - 1.0 * atr;
  let stop = Math.min(stopSwing, stopMA5);

  // Target: nearest resistance that still gives some reward; if the first lid is too close, use the next
  let target = Number.isFinite(nearestRes) ? nearestRes : px + 1.8 * atr;
  if (
    Number.isFinite(nearestRes) &&
    (nearestRes - px) / Math.max(atr, 1e-9) < 0.7 &&
    resistances[1]
  ) {
    target = Math.max(target, resistances[1]);
  }
  if (!Number.isFinite(target)) target = px + 2.0 * atr;

  return {
    trigger: true,
    why: `SPC continuation: ${
      closeAboveYHigh ? "Y-high reclaim" : "green day"
    }, tiny-dip OK.`,
    stop,
    target,
    nearestRes,
    diagnostics: {
      closeAboveYHigh,
      dayUp,
      dipPct: +dipPct.toFixed(2),
      dipATR: +dipATR.toFixed(2),
      pullbackFromMA5: +pullbackFromMA5.toFixed(2),
      rsi: +rsi.toFixed(1),
      distFromMA25_ATR: +distFromMA25_ATR.toFixed(2),
      headroomATR: Number.isFinite(headroomATR)
        ? +headroomATR.toFixed(2)
        : null,
    },
  };
}
