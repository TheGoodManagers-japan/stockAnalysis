// /scripts/breakout.js — Pre-breakout setup detector (trigger-only tuned)
export function detectPreBreakoutSetup(stock, data, cfg, U) {
  const { num, avg, findResistancesAbove } = U;

  if (!Array.isArray(data) || data.length < 25) {
    return { ready: false, waitReason: "insufficient data" };
  }
  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const atr = Math.max(num(stock.atr14), px * 0.005, 1e-9);

  // 1) Resistance (prefer real; allow synthetic)
  const look = data.slice(-Math.max(40, cfg.boLookbackBars || 55));
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
    return { ready: false, waitReason: "no clear resistance overhead" };
  }

  // 2) Must be *near* resistance (tighter than before)
  const dist = resistance - px;
  const nearByATR = dist / atr <= Math.min(cfg.boNearResATR || 1.2, 1.2);
  const nearByPct =
    (dist / Math.max(resistance, 1e-9)) * 100 <=
    Math.min(cfg.boNearResPct || 1.8, 1.8);
  if (!(nearByATR || nearByPct) || dist <= 0) {
    return { ready: false, waitReason: "not coiled near resistance" };
  }

  // 3) Contraction / structure
  const tr = (b) =>
    Math.max(num(b.high) - num(b.low), Math.abs(num(b.close) - num(b.open)));
  const last20 = data.slice(-20);
  const recentTR = avg(data.slice(-6).map(tr));
  const avgTR = avg(last20.map(tr)) || 1e-9;
  const medTR = last20.length
    ? last20.map(tr).sort((a, b) => a - b)[Math.floor(last20.length / 2)]
    : avgTR;
  const baseTR = Math.max(avgTR, medTR);
  const tightenFactor = Math.min(cfg.boTightenFactor || 0.85, 0.85);
  const tightening = recentTR <= tightenFactor * baseTR;

  // structure: 1+ higher lows OR tight flat base
  const lows = data.slice(-12).map((b) => num(b.low));
  let higherLows = 0;
  for (let i = 2; i < lows.length; i++) {
    if (lows[i] > lows[i - 1] && lows[i - 1] > lows[i - 2]) higherLows++;
  }
  const baseWin = data.slice(-10);
  const baseHi = Math.max(...baseWin.map((b) => num(b.high)));
  const baseLo = Math.min(...baseWin.map((b) => num(b.low)));
  const baseRangeATR = (baseHi - baseLo) / Math.max(atr, 1e-9);
  const flatBaseOK = baseWin.length >= 6 && baseRangeATR <= 1.15;
  const structureOK =
    higherLows >= Math.max(cfg.boHigherLowsMin || 1, 1) || flatBaseOK;

  // 4) Volume regime (allow neutral if very tight)
  const avgVol20 = avg(data.slice(-20).map((d) => num(d.volume)));
  const pullbackBars = data
    .slice(-10)
    .filter((b) => num(b.close) < num(b.open));
  const pullbackVol = avg(pullbackBars.map((b) => num(b.volume)));
  const dryPullback =
    pullbackVol <= avgVol20 * Math.max(cfg.boMinDryPullback || 1.05, 1.05) ||
    !avgVol20 ||
    (tightening && baseRangeATR <= 1.0);

  // 5) Plan — entry, stop, target
  const recentSwingLow = Math.min(...data.slice(-6).map((b) => num(b.low)));
  const baseLow = baseLo;
  const boxHeight = Math.max(atr * 1.1, resistance - baseLow);

  // tighter initial stop boosts R and reduces drift losses
  const initialStop = Math.min(baseLow, recentSwingLow) - 0.4 * atr;

  // trigger a bit closer than before
  const triggerPrimary = resistance + Math.max(0.02, 0.1 * atr);
  const altRecentHigh = Math.max(
    ...data
      .slice(-Math.max(cfg.boAltTriggerBars || 3, 3))
      .map((b) => num(b.high))
  );
  const triggerAlt =
    cfg.boAllowInsideBreak !== false
      ? Math.max(triggerPrimary, altRecentHigh + Math.max(0.01, 0.06 * atr))
      : null;
  const entryTrigger = triggerAlt
    ? Math.min(triggerPrimary, triggerAlt)
    : triggerPrimary;

  const entryLimit = entryTrigger * (1 + (cfg.boSlipTicks ?? 0.006));
  const useStopMarket = cfg.boUseStopMarketOnTrigger !== false;

  // thrust check (to pick a closer target if weak)
  const d0 = data.at(-1);
  const closeThroughOK =
    num(d0.close) >= resistance + (cfg.boCloseThroughATR ?? 0.1) * atr;
  const volThrustOK =
    avgVol20 > 0 && num(d0.volume) >= (cfg.boVolThrustX ?? 1.6) * avgVol20;
  const thrustStrong = closeThroughOK || volThrustOK;

  // first target — closer default to raise hit rate; extend if thrustStrong or next resistance exists
  let firstTarget = entryTrigger + 2.1 * atr; // closer than old 2.4
  if (resList[1]) firstTarget = Math.max(firstTarget, resList[1]);
  if (thrustStrong) firstTarget = Math.max(firstTarget, resistance + 2.4 * atr);

  // RR check at trigger
  const risk = Math.max(0.01, entryTrigger - initialStop);
  const reward = Math.max(0, firstTarget - entryTrigger);
  const ratio = reward / risk;
  const minRR = Math.max(cfg.boMinRR || 1.3, 1.3);

  const readyCore = tightening && structureOK && dryPullback && ratio >= minRR;
  if (!readyCore) {
    return {
      ready: false,
      waitReason: `tight=${tightening}, struct=${structureOK}, dry=${dryPullback}, RR=${ratio.toFixed(
        2
      )}`,
    };
  }

  return {
    ready: true,
    waitReason: "",
    entryTrigger,
    entryLimit,
    useStopMarket,
    initialStop: Math.round(initialStop),
    firstTarget: Math.round(firstTarget),
    nearestRes: resistance,
    why: `Near ${resistance.toFixed(
      0
    )}; tight=${tightening}, struct=${structureOK}; RR ${ratio.toFixed(2)}${
      thrustStrong ? " with thrust" : ""
    }`,
    diagnostics: {
      resistance,
      baseLow,
      recentSwingLow,
      boxHeight,
      baseRangeATR,
      recentTR,
      avgTR,
      medTR,
      ratio,
      thrustStrong,
    },
    retestPlan: null, // not used in current backtest executor
  };
}
