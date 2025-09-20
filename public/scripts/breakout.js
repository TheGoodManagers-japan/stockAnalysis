// /scripts/breakout.js — Pre-breakout setup detector (thrust-first + tight-base fallback)
// Goals: more fills, higher avg win/return, tight risk.
// - Prefer *thrust* breakouts (close-through or strong volume)
// - Allow *very tight bases* without thrust as a fallback
// - Stop under the breakout line (tighter than base-low stops)
// - Larger first target (measure + ATR, or next resistance if higher)

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
  const nearByATR = dist / atr <= Math.max(cfg.boNearResATR, 1.8); // widen window
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
  const tightening = recentTR <= Math.max(cfg.boTightenFactor, 0.92) * baseTR; // allow modest contraction

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

  const flatBaseOK = baseWin.length >= 6 && baseRangeATR <= 1.05; // tighter flat-base bar
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
  // Entry trigger: just above resistance (slightly eased) or recent high + small cushion
  const recentHigh3 = Math.max(...data.slice(-3).map((b) => num(b.high)));
  const triggerPrimary = Math.max(
    resistance + Math.max(0.01, 0.08 * atr), // smaller cushion than 0.12*ATR
    recentHigh3 + Math.max(0.005, 0.04 * atr)
  );

  const entryTrigger = triggerPrimary;
  const entryLimit = entryTrigger * (1 + (cfg.boSlipTicks ?? 0.006)); // used if stop-limit
  const useStopMarket = !!cfg.boUseStopMarketOnTrigger;

  // Stop under breakout line, not entire base — improves R and reduces time-outs
  const lineStop = resistance - 0.5 * atr;
  const initialStop = Math.min(lineStop, baseLo - 0.15 * atr); // ensure below line; give a little room to wick

  // First target: push for larger winners
  //  - measured move from base OR 2.6 ATR above resistance (whichever larger)
  const boxHeight = Math.max(resistance - baseLo, 1.0 * atr);
  let firstTarget = resistance + Math.max(0.9 * boxHeight, 2.6 * atr);
  if (resList[1]) firstTarget = Math.max(firstTarget, resList[1]); // if next resistance is higher, aim for it

  // ---------- 6) Thrust quality (prefer higher quality fills) ----------
  const d0 = data.at(-1);
  const closeThroughOK =
    num(d0.close) >= resistance + Math.max(cfg.boCloseThroughATR, 0.08) * atr;
  const volThrustOK =
    avgVol20 > 0 &&
    num(d0.volume) >= Math.max(cfg.boVolThrustX, 1.35) * avgVol20;

  const thrustOK = closeThroughOK || volThrustOK;
  const tightBaseExceptional = tightening && baseRangeATR <= 0.8; // allow without thrust if *very* tight

  // ---------- 7) RR filters: stricter for weak thrust, easier for strong thrust ----------
  const risk = Math.max(0.01, entryTrigger - initialStop);
  const reward = Math.max(0, firstTarget - entryTrigger);
  const ratio = reward / risk;

  const needRR = thrustOK ? Math.max(cfg.boMinRR, 1.55) : 1.4; // demand more when thrust present

  // Core readiness: base + contraction + volume not hostile + RR OK
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

  // If no thrust, require the exceptional tight base to avoid weak pops
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
    retestPlan: null, // we avoid retest orders to align with your “trigger soon or skip” rule
  };
}
