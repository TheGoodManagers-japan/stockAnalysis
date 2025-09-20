// /scripts/breakout.js — Pre-breakout setup detector (tighter coil, closer res, bigger through-trigger, farther targets)
export function detectPreBreakoutSetup(stock, data, cfg, U) {
  const { num, avg, findResistancesAbove } = U;

  if (!Array.isArray(data) || data.length < 25) {
    return { ready: false, waitReason: "insufficient data" };
  }

  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const atr = Math.max(num(stock.atr14), px * 0.005, 1e-9);

  // ---------------- 1) Resistance (real or synthetic) ----------------
  const look = data.slice(-cfg.boLookbackBars);
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

  // ---------------- 2) Near resistance (tighter) ----------------
  // Force a stricter coil: <= 1.2 ATR or <= cfg.boNearResATR (whichever is tighter), or <= cfg.boNearResPct%
  const dist = resistance - px;
  const nearATRcap = Math.min(
    Number.isFinite(cfg.boNearResATR) ? cfg.boNearResATR : 1.6,
    1.2
  );
  const nearByATR = dist / atr <= nearATRcap;
  const nearByPct =
    (dist / Math.max(resistance, 1e-9)) * 100 <=
    Math.min(Number.isFinite(cfg.boNearResPct) ? cfg.boNearResPct : 2.0, 2.0);
  if (!(nearByATR || nearByPct) || dist <= 0) {
    return { ready: false, waitReason: "not coiled near resistance" };
  }

  // ---------------- 3) Tightening / structure (tighter) ----------------
  const tr = (b) =>
    Math.max(num(b.high) - num(b.low), Math.abs(num(b.close) - num(b.open)));
  const last20 = data.slice(-20);
  const recentTR = avg(data.slice(-6).map(tr));
  const avgTR = avg(last20.map(tr)) || 1e-9;
  const medTR = last20.length
    ? last20.map(tr).sort((a, b) => a - b)[Math.floor(last20.length / 2)]
    : avgTR;
  const baseTR = Math.max(avgTR, medTR);

  // Require stronger contraction: factor <= 0.75 (and not looser than cfg)
  const tightenFactorEff = Math.min(
    Number.isFinite(cfg.boTightenFactor) ? cfg.boTightenFactor : 0.85,
    0.75
  );
  const tightening = recentTR <= tightenFactorEff * baseTR;

  // Structure: at least 2 higher-lows (or flat base)
  const lows = data.slice(-12).map((b) => num(b.low));
  let higherLows = 0;
  for (let i = 2; i < lows.length; i++) {
    if (lows[i] > lows[i - 1] && lows[i - 1] > lows[i - 2]) higherLows++;
  }
  const baseWin = data.slice(-10);
  const baseHi = Math.max(...baseWin.map((b) => num(b.high)));
  const baseLo = Math.min(...baseWin.map((b) => num(b.low)));
  const baseRangeATR = (baseHi - baseLo) / Math.max(atr, 1e-9);
  const flatBaseOK = baseWin.length >= 6 && baseRangeATR <= 1.2;

  const higherLowsMinEff = Math.max(
    Number.isFinite(cfg.boHigherLowsMin) ? cfg.boHigherLowsMin : 1,
    2
  );
  const structureOK = higherLows >= higherLowsMinEff || flatBaseOK;

  // ---------------- 4) Volume regime (unchanged logic, still allows “tight+neutral”) ----------------
  const avgVol20 = avg(data.slice(-20).map((d) => num(d.volume)));
  const pullbackBars = data
    .slice(-10)
    .filter((b) => num(b.close) < num(b.open));
  const pullbackVol = avg(pullbackBars.map((b) => num(b.volume)));
  const dryPullback =
    pullbackVol <=
      avgVol20 *
        (Number.isFinite(cfg.boMinDryPullback) ? cfg.boMinDryPullback : 1.05) ||
    !avgVol20 ||
    (tightening && baseRangeATR <= 1.0);

  // ---------------- 5) Plan (bigger through-trigger, farther target) ----------------
  const baseLow = baseLo;
  const boxHeight = Math.max(atr * 1.2, resistance - baseLow);
  const initialStop =
    baseLow -
    (Number.isFinite(cfg.boStopUnderLowsATR) ? cfg.boStopUnderLowsATR : 0.6) *
      atr;

  // Larger through: ~0.15 ATR (min 0.03) to avoid weak/false breaks
  const throughATR = Math.max(
    Number.isFinite(cfg.boCloseThroughATR) ? cfg.boCloseThroughATR : 0.1,
    0.15
  );
  const triggerPrimary = resistance + Math.max(0.03, throughATR * atr);

  // Optional inside/3-bar helper, but never below the stronger primary
  const altBars = Math.max(
    Number.isFinite(cfg.boAltTriggerBars) ? cfg.boAltTriggerBars : 3,
    3
  );
  const altRecentHigh = Math.max(
    ...data.slice(-altBars).map((b) => num(b.high))
  );
  const triggerAlt = cfg.boAllowInsideBreak
    ? Math.max(triggerPrimary, altRecentHigh + Math.max(0.01, 0.06 * atr))
    : null;

  const entryTrigger = triggerAlt
    ? Math.min(triggerPrimary, triggerAlt)
    : triggerPrimary;

  // Limit slip: prefer smaller slip to keep avg % high (if caller uses stop-limit)
  const slipEff = Math.min(
    Number.isFinite(cfg.boSlipTicks) ? cfg.boSlipTicks : 0.006,
    0.005
  );
  const entryLimit = entryTrigger * (1 + slipEff);

  // Suggest stop-market setting but it’s enforced by the backtester options
  const useStopMarket = !!cfg.boUseStopMarketOnTrigger;

  // Thrust checks (for retest logic only; we can’t enforce at setup-time)
  const d0 = data.at(-1);
  const volX = Math.max(
    Number.isFinite(cfg.boVolThrustX) ? cfg.boVolThrustX : 1.4,
    1.8
  ); // stronger volume thrust threshold
  const closeThroughOK = num(d0.close) >= resistance + throughATR * atr;
  const volThrustOK = avgVol20 > 0 && num(d0.volume) >= volX * avgVol20;

  // Farther first target: max(next resistance, resistance + max(boxHeight, 2.6*ATR))
  const targetATRmin = Math.max(
    Number.isFinite(cfg.boTargetATR) ? cfg.boTargetATR : 2.2,
    2.6
  );
  let firstTarget = resistance + Math.max(boxHeight, targetATRmin * atr);
  if (resList[1]) firstTarget = Math.max(firstTarget, resList[1]);

  // RR at trigger (stricter min)
  const risk = Math.max(0.01, entryTrigger - initialStop);
  const reward = Math.max(0, firstTarget - entryTrigger);
  const ratio = reward / risk;
  const rrMinEff = Math.max(
    Number.isFinite(cfg.boMinRR) ? cfg.boMinRR : 1.35,
    1.5
  );

  const readyCore =
    tightening && structureOK && dryPullback && ratio >= rrMinEff;
  if (!readyCore) {
    return {
      ready: false,
      waitReason: `tight=${tightening}, struct=${structureOK}, dry=${dryPullback}, RR=${ratio.toFixed(
        2
      )} (need ≥${rrMinEff})`,
    };
  }

  // Retest plan if no obvious thrust on the setup bar
  let retest = null;
  if (cfg.boUseRetestPlan && !(closeThroughOK || volThrustOK)) {
    const zoneMid = resistance;
    const buyLo =
      zoneMid -
      (Number.isFinite(cfg.boRetestDepthATR) ? cfg.boRetestDepthATR : 0.3) *
        atr;
    const buyHi = zoneMid + Math.max(0.05 * atr, 0.01);
    retest = {
      retestTrigger: buyLo,
      retestLimit: buyHi,
      cancelIfCloseBackInBaseATR: Number.isFinite(cfg.boRetestInvalidATE)
        ? cfg.boRetestInvalidATE
        : 0.5,
      note: "Breakout lacked thrust; buy the retest of the breakout zone.",
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
    why: `Coil near ${resistance.toFixed(0)}; contraction ${
      tightening ? "OK" : "weak"
    }, structure ${structureOK ? "OK" : "weak"}; RR ${ratio.toFixed(2)}${
      closeThroughOK || volThrustOK ? " with thrust" : " (plan retest)"
    }`,
    diagnostics: {
      resistance,
      baseLow,
      boxHeight,
      baseRangeATR,
      recentTR,
      avgTR,
      medTR,
      ratio,
      rrMin: rrMinEff,
      throughATR,
      volX,
      closeThroughOK,
      volThrustOK,
      nearATRcap,
      tightenFactorEff,
      higherLows,
      higherLowsMinEff,
    },
    // Hint to executor: consider 8–10 bars as max age for pending orders
    staleAfterBars: 10,
    retestPlan: retest,
  };
}
