export function detectPreBreakoutSetup(stock, data, cfg, U) {
  const { num, avg, findResistancesAbove } = U;

  if (!Array.isArray(data) || data.length < 25) {
    return { ready: false, waitReason: "insufficient data" };
  }

  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const atr = Math.max(num(stock.atr14), px * 0.005, 1e-9);

  // ---------- 1) Resistance (real or synthetic) ----------
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

  // ---------- 2) Must be *near* resistance (loosened slightly) ----------
  const dist = resistance - px;
  const nearByATR = dist / atr <= Math.max(cfg.boNearResATR, 1.8);
  const nearByPct =
    (dist / Math.max(resistance, 1e-9)) * 100 <=
    Math.max(cfg.boNearResPct, 2.5);
  if (!(nearByATR || nearByPct) || dist <= 0) {
    return { ready: false, waitReason: "not coiled near resistance" };
  }

  // ---------- 3) Contraction & base structure ----------
  const tr = (b) =>
    Math.max(num(b.high) - num(b.low), Math.abs(num(b.close) - num(b.open)));

  const last20 = data.slice(-20);
  const recentTR = avg(data.slice(-6).map(tr));
  const avgTR = avg(last20.map(tr)) || 1e-9;
  const medTR = last20.length
    ? last20.map(tr).sort((a, b) => a - b)[Math.floor(last20.length / 2)]
    : avgTR;
  const baseTR = Math.max(avgTR, medTR);
  const tightening = recentTR <= Math.max(cfg.boTightenFactor, 0.92) * baseTR;

  // Higher-lows OR tight flat base
  const baseWin = data.slice(-10);
  const baseHi = Math.max(...baseWin.map((b) => num(b.high)));
  const baseLo = Math.min(...baseWin.map((b) => num(b.low)));
  const baseRangeATR = (baseHi - baseLo) / Math.max(atr, 1e-9);

  const lows = data.slice(-12).map((b) => num(b.low));
  let higherLows = 0;
  for (let i = 2; i < lows.length; i++) {
    if (lows[i] > lows[i - 1] && lows[i - 1] > lows[i - 2]) higherLows++;
  }

  const flatBaseOK = baseWin.length >= 6 && baseRangeATR <= 1.05;
  const structureOK =
    higherLows >= Math.max(cfg.boHigherLowsMin, 1) || flatBaseOK;

  // ---------- 4) Volume regime (loosen neutral, reward thrust) ----------
  const avgVol20 = avg(data.slice(-20).map((d) => num(d.volume)));
  const pullbackBars = data
    .slice(-10)
    .filter((b) => num(b.close) < num(b.open));
  const pullbackVol = avg(pullbackBars.map((b) => num(b.volume)));
  const dryPullback =
    pullbackVol <= avgVol20 * Math.max(cfg.boMinDryPullback, 1.05) ||
    !avgVol20 ||
    (tightening && baseRangeATR <= 0.9);

  // ---------- 5) Entry trigger & stop/target planning ----------
  const recentHigh3 = Math.max(...data.slice(-3).map((b) => num(b.high)));
  const triggerPrimary = Math.max(
    resistance + Math.max(0.005, 0.05 * atr),
    recentHigh3 + Math.max(0.003, 0.02 * atr)
  );

  const entryTrigger = triggerPrimary;
  const entryLimit = entryTrigger * (1 + (cfg.boSlipTicks ?? 0.006));
  const useStopMarket = !!cfg.boUseStopMarketOnTrigger;

  // Stop under breakout line, not entire base — TIGHT stop
  const lineStop = resistance - 0.5 * atr;
  const initialStop = Math.max(lineStop, baseLo - 0.15 * atr);

  // First target: easier to hit → more winners, let trailing capture the rest
  const boxHeight = Math.max(resistance - baseLo, 1.0 * atr);
  let firstTarget = resistance + Math.max(0.6 * boxHeight, 1.8 * atr);
  if (resList[1]) firstTarget = Math.max(firstTarget, resList[1]);

  // ---------- 6) Thrust quality ----------
  const d0 = data.at(-1);
  const closeThroughOK =
    num(d0.close) >= resistance + Math.max(cfg.boCloseThroughATR, 0.08) * atr;
  const volThrustOK =
    avgVol20 > 0 &&
    num(d0.volume) >= Math.max(cfg.boVolThrustX, 1.35) * avgVol20;

  const thrustOK = closeThroughOK || volThrustOK;
  const tightBaseExceptional = tightening && baseRangeATR <= 0.8;

  // ---------- 7) RR filters ----------
  const needRR = thrustOK
    ? Math.max(cfg.boMinRRThrust ?? cfg.boMinRR ?? 1.35, 1.35)
    : Math.max(cfg.boMinRRNoThrust ?? 1.6, 1.6);

  const risk = Math.max(0.01, entryTrigger - initialStop);
  const reward = Math.max(0, firstTarget - entryTrigger);
  const ratio = reward / risk;

  const readyCore =
    structureOK && (tightening || flatBaseOK) && dryPullback && ratio >= needRR;

  if (!readyCore) {
    return {
      ready: false,
      waitReason: `tight=${tightening}, struct=${structureOK}, dry=${dryPullback}, RR=${ratio.toFixed(
        2
      )}/${needRR.toFixed(2)}`,
    };
  }

  if (!thrustOK && !tightBaseExceptional) {
    return {
      ready: false,
      waitReason: "no thrust and base not exceptionally tight",
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
    why: `Coil near ${resistance.toFixed(0)}; ${
      tightening ? "contracting" : "steady"
    } base; RR ${ratio.toFixed(2)}; ${
      thrustOK ? "thrust present" : "no thrust (very tight base)"
    }`,
    diagnostics: {
      resistance,
      baseLow: baseLo,
      boxHeight,
      baseRangeATR,
      recentTR,
      avgTR,
      medTR,
      ratio,
      thrustOK,
      closeThroughOK,
      volThrustOK,
    },
    retestPlan: null,
  };
}
