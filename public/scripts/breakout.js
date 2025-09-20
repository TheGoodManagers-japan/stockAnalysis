// /scripts/breakout.js — Pre-breakout setup detector (stop-market/limit + optional retest)
export function detectPreBreakoutSetup(stock, data, cfg, U) {
  const { num, avg, findResistancesAbove } = U;

  if (!Array.isArray(data) || data.length < 25) {
    return { ready: false, waitReason: "insufficient data" };
  }
  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const atr = Math.max(num(stock.atr14), px * 0.005, 1e-9);

  // 1) Resistance (real or synthetic)
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

  // 2) Near resistance
  const dist = resistance - px;
  const nearByATR = dist / atr <= cfg.boNearResATR;
  const nearByPct =
    (dist / Math.max(resistance, 1e-9)) * 100 <= cfg.boNearResPct;
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
  const tightening = recentTR <= cfg.boTightenFactor * baseTR;

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
  const structureOK = higherLows >= cfg.boHigherLowsMin || flatBaseOK;

  // 4) Volume regime
  const avgVol20 = avg(data.slice(-20).map((d) => num(d.volume)));
  const pullbackBars = data
    .slice(-10)
    .filter((b) => num(b.close) < num(b.open));
  const pullbackVol = avg(pullbackBars.map((b) => num(b.volume)));
  const dryPullback =
    pullbackVol <= avgVol20 * cfg.boMinDryPullback ||
    !avgVol20 ||
    (tightening && baseRangeATR <= 1.0);

  // 5) Plan
  const baseLow = baseLo;
  const boxHeight = Math.max(atr * 1.2, resistance - baseLow);
  const initialStop = baseLow - cfg.boStopUnderLowsATR * atr;

  const triggerPrimary = resistance + Math.max(0.02, 0.12 * atr);
  const altRecentHigh = Math.max(
    ...data.slice(-cfg.boAltTriggerBars).map((b) => num(b.high))
  );
  const triggerAlt = cfg.boAllowInsideBreak
    ? Math.max(triggerPrimary, altRecentHigh + Math.max(0.01, 0.06 * atr))
    : null;
  const entryTrigger = triggerAlt
    ? Math.min(triggerPrimary, triggerAlt)
    : triggerPrimary;

  const entryLimit = entryTrigger * (1 + cfg.boSlipTicks);
  const useStopMarket = !!cfg.boUseStopMarketOnTrigger;

  // Thrust checks
  const d0 = data.at(-1);
  const closeThroughOK =
    num(d0.close) >= resistance + cfg.boCloseThroughATR * atr;
  const volThrustOK =
    avgVol20 > 0 && num(d0.volume) >= cfg.boVolThrustX * avgVol20;

  // First target
  let firstTarget =
    resistance + Math.max(boxHeight * 0.8, cfg.boTargetATR * atr);
  if (resList[1]) firstTarget = Math.max(firstTarget, resList[1]);

  // RR at trigger
  const risk = Math.max(0.01, entryTrigger - initialStop);
  const reward = Math.max(0, firstTarget - entryTrigger);
  const ratio = reward / risk;

  const readyCore =
    tightening &&
    structureOK &&
    dryPullback &&
    ratio >= Math.max(cfg.boMinRR, 1.25);
  if (!readyCore) {
    return {
      ready: false,
      waitReason: `tight=${tightening}, struct=${structureOK}, dry=${dryPullback}, RR=${ratio.toFixed(
        2
      )}`,
    };
  }

  // Retest plan if weak thrust
  let retest = null;
  if (cfg.boUseRetestPlan && !(closeThroughOK || volThrustOK)) {
    const zoneMid = resistance;
    const buyLo = zoneMid - cfg.boRetestDepthATR * atr;
    const buyHi = zoneMid + Math.max(0.05 * atr, 0.01);
    retest = {
      retestTrigger: buyLo,
      retestLimit: buyHi,
      cancelIfCloseBackInBaseATR: cfg.boRetestInvalidATE,
      note: "Breakout lacked thrust; buy the retest of the zone.",
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
      closeThroughOK,
      volThrustOK,
    },
    retestPlan: retest,
  };
}
