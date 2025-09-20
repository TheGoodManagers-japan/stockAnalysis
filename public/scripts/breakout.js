// /scripts/breakout.js — Pre-breakout setup detector (quality-biased for bigger wins/returns)
export function detectPreBreakoutSetup(stock, data, cfg, U) {
  const { num, avg, findResistancesAbove } = U;

  if (!Array.isArray(data) || data.length < 25) {
    return { ready: false, waitReason: "insufficient data" };
  }

  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const atr = Math.max(num(stock.atr14), px * 0.005, 1e-9);
  const atrPct = atr / Math.max(px, 1e-9);

  // ---------- Tunables (favor bigger winners) ----------
  // If you want even bigger wins, raise these slightly; if throughput falls too much, lower a hair.
  const MIN_ATR_PCT = Math.max(cfg.boMinAtrPct || 0.0075, 0.006); // >= 0.75% daily ATR
  const TIGHTEN_FACTOR = Math.min(cfg.boTightenFactor || 0.8, 0.85); // tighter than before
  const MIN_RR = Math.max(cfg.boMinRR || 1.6, 1.5); // demand better RR at trigger
  const CLOSE_THROUGH_ATR = Math.max(cfg.boCloseThroughATR || 0.15, 0.12);
  const VOL_THRUST_X = Math.max(cfg.boVolThrustX || 1.8, 1.6);
  const MIN_HEADROOM_ATR = Math.max(cfg.boMinHeadroomATR || 1.2, 1.0); // to next objective past entry
  const MAX_BASE_ATR = cfg.boMaxBaseATR || 2.0; // avoid huge bases (stops too wide)
  const MEASURED_MOVE_MULT = cfg.boMeasuredMoveMult || 1.0; // 1.0× measured move floor
  const TARGET_ATR_WEAK = Math.max(cfg.boTargetATR || 2.2, 2.2);
  const TARGET_ATR_STRONG = Math.max(cfg.boTargetATRStrong || 2.8, 2.6);
  const STOP_UNDER_ATR = Math.max(cfg.boStopUnderLowsATR || 0.55, 0.5);
  const LOOKBACK = Math.max(cfg.boLookbackBars || 55, 40);
  const HL_MIN = Math.max(cfg.boHigherLowsMin || 1, 1); // minimal higher-lows
  const USE_RETEST = cfg.boUseRetestPlan !== false; // default true
  const RETEST_DEPTH_ATR = Math.max(cfg.boRetestDepthATR || 0.3, 0.25);
  const RETEST_CANCEL_ATE = Math.max(cfg.boRetestInvalidATE || 0.5, 0.4);
  const ALT_BARS = Math.max(cfg.boAltTriggerBars || 3, 2);
  const ALLOW_INSIDE = cfg.boAllowInsideBreak !== false; // allow inside-break alt
  const SLIP_TICKS = Math.max(cfg.boSlipTicks || 0.006, 0.004);
  const USE_STOP_MKT = cfg.boUseStopMarketOnTrigger !== false; // default stop-market

  // 0) Filter for names that can actually give bigger % wins (ATR floor)
  if (atrPct < MIN_ATR_PCT) {
    return {
      ready: false,
      waitReason: `ATR too small (${(atrPct * 100).toFixed(2)}% < ${(
        MIN_ATR_PCT * 100
      ).toFixed(2)}%)`,
    };
  }

  // 1) Resistance (real or synthetic)
  const look = data.slice(-LOOKBACK);
  let resList = findResistancesAbove(look, px, stock);
  let resistance = resList[0];
  if (!Number.isFinite(resistance)) {
    const synthHigh = Math.max(...look.map((b) => num(b.high)));
    if (synthHigh > px) {
      resistance = synthHigh;
      resList = [synthHigh];
    }
  }
  if (!Number.isFinite(resistance)) {
    return {
      ready: false,
      waitReason: "no clear/synthetic resistance overhead",
    };
  }

  // 2) Near resistance (must be a near-term breakout, not weeks away)
  const dist = resistance - px;
  const nearByATR = dist / atr <= (cfg.boNearResATR || 1.6);
  const nearByPct =
    (dist / Math.max(resistance, 1e-9)) * 100 <= (cfg.boNearResPct || 2.0);
  if (!(nearByATR || nearByPct) || dist <= 0) {
    return { ready: false, waitReason: "not coiled near resistance" };
  }

  // 3) Tightening / structure
  const tr = (b) =>
    Math.max(num(b.high) - num(b.low), Math.abs(num(b.close) - num(b.open)));
  const last20 = data.slice(-20);
  const recentTR = avg(data.slice(-6).map(tr));
  const avgTR = avg(last20.map(tr)) || 1e-9;
  const medTR = last20.length
    ? last20.map(tr).sort((a, b) => a - b)[Math.floor(last20.length / 2)]
    : avgTR;
  const baseTR = Math.max(avgTR, medTR);
  const tightening = recentTR <= TIGHTEN_FACTOR * baseTR;

  const baseWin = data.slice(-10);
  const baseHi = Math.max(...baseWin.map((b) => num(b.high)));
  const baseLo = Math.min(...baseWin.map((b) => num(b.low)));
  const baseRangeATR = (baseHi - baseLo) / Math.max(atr, 1e-9);
  const flatBaseOK = baseWin.length >= 6 && baseRangeATR <= 1.2;

  // reject overly wide bases (keeps stops tighter => higher R, bigger win%)
  if (baseRangeATR > MAX_BASE_ATR) {
    return {
      ready: false,
      waitReason: `base too wide (${baseRangeATR.toFixed(
        2
      )} ATR > ${MAX_BASE_ATR})`,
    };
  }

  const lows = data.slice(-12).map((b) => num(b.low));
  let higherLows = 0;
  for (let i = 2; i < lows.length; i++) {
    if (lows[i] > lows[i - 1] && lows[i - 1] > lows[i - 2]) higherLows++;
  }
  const structureOK = higherLows >= HL_MIN || flatBaseOK;
  if (!(tightening && structureOK)) {
    return {
      ready: false,
      waitReason: `tight=${tightening}, struct=${structureOK}`,
    };
  }

  // 4) Volume regime (allow neutral if super tight)
  const avgVol20 = avg(data.slice(-20).map((d) => num(d.volume)));
  const pullbackBars = data
    .slice(-10)
    .filter((b) => num(b.close) < num(b.open));
  const pullbackVol = avg(pullbackBars.map((b) => num(b.volume)));
  const dryPullback =
    pullbackVol <= avgVol20 * (cfg.boMinDryPullback || 1.05) ||
    !avgVol20 ||
    (tightening && baseRangeATR <= 1.0);
  if (!dryPullback) {
    return { ready: false, waitReason: "pullbacks not dry" };
  }

  // 5) Plan
  const baseLow = baseLo;
  const measuredMove =
    Math.max(resistance - baseLow, 1.2 * atr) * MEASURED_MOVE_MULT;
  const initialStop = baseLow - STOP_UNDER_ATR * atr;

  const triggerPrimary = resistance + Math.max(0.02, 0.12 * atr);
  const altRecentHigh = Math.max(
    ...data.slice(-ALT_BARS).map((b) => num(b.high))
  );
  const triggerAlt = ALLOW_INSIDE
    ? Math.max(triggerPrimary, altRecentHigh + Math.max(0.01, 0.06 * atr))
    : null;
  const entryTrigger = triggerAlt
    ? Math.min(triggerPrimary, triggerAlt)
    : triggerPrimary;

  const entryLimit = entryTrigger * (1 + SLIP_TICKS);
  const useStopMarket = !!USE_STOP_MKT;

  // Thrust checks (for momentum mode)
  const d0 = data.at(-1);
  const closeThroughOK = num(d0.close) >= resistance + CLOSE_THROUGH_ATR * atr;
  const volThrustOK = avgVol20 > 0 && num(d0.volume) >= VOL_THRUST_X * avgVol20;
  const thrustStrong = closeThroughOK || volThrustOK;

  // Headroom check: ensure there is space after entry to hit an expanded target
  // Use next resistance if available; otherwise ensure ATR-based room
  const resAhead = findResistancesAbove(
    data.slice(-LOOKBACK),
    entryTrigger,
    stock
  );
  const nextRes = resAhead.find((r) => r > entryTrigger);
  const headroom = Number.isFinite(nextRes)
    ? (nextRes - entryTrigger) / atr
    : Infinity;
  if (headroom < MIN_HEADROOM_ATR) {
    return {
      ready: false,
      waitReason: `headroom too small (${headroom.toFixed(
        2
      )} ATR < ${MIN_HEADROOM_ATR})`,
    };
  }

  // Targets — bias bigger when thrust is strong
  let firstTarget =
    resistance +
    Math.max(
      thrustStrong ? TARGET_ATR_STRONG * atr : TARGET_ATR_WEAK * atr,
      thrustStrong ? measuredMove : measuredMove * 0.8
    );
  if (Number.isFinite(nextRes)) firstTarget = Math.max(firstTarget, nextRes);

  // RR at trigger
  const risk = Math.max(0.01, entryTrigger - initialStop);
  const reward = Math.max(0, firstTarget - entryTrigger);
  const ratio = reward / risk;
  if (ratio < MIN_RR) {
    return {
      ready: false,
      waitReason: `RR ${ratio.toFixed(2)} < ${MIN_RR.toFixed(2)}`,
    };
  }

  // Retest plan if thrust is weak — improves entry, boosts average R/win
  let retest = null;
  if (USE_RETEST && !thrustStrong) {
    const zoneMid = resistance;
    const buyLo = zoneMid - RETEST_DEPTH_ATR * atr;
    const buyHi = zoneMid + Math.max(0.05 * atr, 0.01);
    retest = {
      retestTrigger: buyLo,
      retestLimit: buyHi,
      cancelIfCloseBackInBaseATR: RETEST_CANCEL_ATE,
      note: "Weak thrust; prefer retest to improve entry and R.",
    };
  }

  return {
    ready: true,
    waitReason: "",
    entryTrigger,
    entryLimit,
    useStopMarket,
    initialStop,
    firstTarget,
    nearestRes: resistance,
    why: `Coil near ${resistance.toFixed(0)}; tight=${
      tightening ? "OK" : "weak"
    }, struct=${structureOK ? "OK" : "weak"}; RR ${ratio.toFixed(2)}${
      thrustStrong ? " with thrust" : " (prefer retest)"
    }`,
    diagnostics: {
      atrPct,
      resistance,
      baseLow,
      baseRangeATR,
      measuredMove,
      recentTR,
      avgTR,
      medTR,
      ratio,
      headroomATR: headroom,
      closeThroughOK,
      volThrustOK,
    },
    retestPlan: retest,
  };
}
