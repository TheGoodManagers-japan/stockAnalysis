// /scripts/breakout.js — Pre-breakout setup detector (stop-market/limit + optional retest)
// Drop-in replacement: same signature & return shape, stricter quality & "near-term" alignment.
export function detectPreBreakoutSetup(stock, data, cfg, U) {
  const { num, avg, findResistancesAbove } = U;
  const smaLocal =
    U && typeof U.sma === "function"
      ? U.sma
      : (arr, n, f = "close") => {
          if (!Array.isArray(arr) || arr.length < n) return 0;
          let s = 0;
          for (let i = arr.length - n; i < arr.length; i++)
            s += Number(arr[i][f]) || 0;
          return s / n;
        };

  const reasonTrace = [];

  // ---- sanity
  if (!Array.isArray(data) || data.length < 25) {
    return { ready: false, waitReason: "insufficient data" };
  }

  // ---- context
  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const atr = Math.max(num(stock.atr14), px * 0.005, 1e-9);

  // Basic trend filter (soft): prefer px>MA25>MA50; allow weak trend if very tight & very near res
  const ma20 = num(stock.movingAverage20d) || smaLocal(data, 20);
  const ma25 = num(stock.movingAverage25d) || smaLocal(data, 25);
  const ma50 = num(stock.movingAverage50d) || smaLocal(data, 50);
  const stackedUp = px > ma25 && ma25 > ma50 && ma20 >= ma25 * 0.98;

  // ---- 1) Resistance (real or synthetic)
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

  // ---- 2) Near-term alignment (must be soon reachable)
  // keep “near” tight enough that a trigger is plausible within a few bars
  const dist = resistance - px;
  const nearByATR = dist / atr <= Math.min(cfg.boNearResATR, 1.25);
  const nearByPct =
    (dist / Math.max(resistance, 1e-9)) * 100 <=
    Math.min(cfg.boNearResPct, 1.75);
  if (dist <= 0 || !(nearByATR || nearByPct)) {
    return { ready: false, waitReason: "not coiled near resistance" };
  }

  // If trend is not stackedUp, require even nearer
  if (!stackedUp) {
    const stricter =
      dist / atr <= 0.9 || (dist / Math.max(resistance, 1e-9)) * 100 <= 1.0;
    if (!stricter) {
      return {
        ready: false,
        waitReason: "weak trend & not near enough to resistance",
      };
    }
  }

  // ---- 3) Tightening + structure
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

  const baseWin = data.slice(-10);
  const baseHi = Math.max(...baseWin.map((b) => num(b.high)));
  const baseLo = Math.min(...baseWin.map((b) => num(b.low)));
  const baseRangeATR = (baseHi - baseLo) / Math.max(atr, 1e-9);

  // count higher lows
  const lows = data.slice(-12).map((b) => num(b.low));
  let higherLows = 0;
  for (let i = 2; i < lows.length; i++) {
    if (lows[i] > lows[i - 1] && lows[i - 1] > lows[i - 2]) higherLows++;
  }
  const flatBaseOK = baseWin.length >= 6 && baseRangeATR <= 1.1; // slightly stricter flatness
  const structureOK = higherLows >= cfg.boHigherLowsMin || flatBaseOK;

  // ---- 4) Volume regime with distribution veto
  const avgVol20 = avg(data.slice(-20).map((d) => num(d.volume)));
  const pullbackBars = data
    .slice(-10)
    .filter((b) => num(b.close) < num(b.open));
  const pullbackVol = avg(pullbackBars.map((b) => num(b.volume)));
  const dryPullback =
    pullbackVol <= avgVol20 * cfg.boMinDryPullback ||
    !avgVol20 ||
    (tightening && baseRangeATR <= 1.0);

  // distribution veto: avoid bases with repeated heavy down-volume
  const heavyDownBars = pullbackBars.filter(
    (b) =>
      num(b.volume) >= 1.6 * (avgVol20 || 1) &&
      num(b.open) - num(b.close) > 0.4 * atr
  ).length;
  const distributionOK = heavyDownBars <= 1; // allow at most one heavy distribution day in last ~10

  // ---- 5) Plan (trigger/stop/target)
  const baseLow = baseLo;
  const boxHeight = Math.max(1.2 * atr, resistance - baseLow); // measured move base
  const initialStop = baseLow - cfg.boStopUnderLowsATR * atr;

  // primary trigger a hair through resistance, also allow a short inside-break option
  const triggerPrimary =
    resistance + Math.max(0.01, Math.min(0.14 * atr, 0.004 * px));
  const altRecentHigh = Math.max(
    ...data.slice(-cfg.boAltTriggerBars).map((b) => num(b.high))
  );
  const triggerAlt = cfg.boAllowInsideBreak
    ? Math.max(
        triggerPrimary,
        altRecentHigh + Math.max(0.01, Math.min(0.06 * atr, 0.0025 * px))
      )
    : null;
  const entryTrigger = triggerAlt
    ? Math.min(triggerPrimary, triggerAlt)
    : triggerPrimary;

  const entryLimit = entryTrigger * (1 + (cfg.boSlipTicks ?? 0));
  const useStopMarket = !!cfg.boUseStopMarketOnTrigger;

  // Thrust checks on last bar (close-through or volume surge)
  const d0 = data.at(-1);
  const closeThroughOK =
    num(d0.close) >= resistance + cfg.boCloseThroughATR * atr;
  const volThrustOK =
    avgVol20 > 0 && num(d0.volume) >= cfg.boVolThrustX * avgVol20;

  // Headroom to next supply: require some space beyond the first level
  const nextRes = resList[1] ?? null;
  const minHeadroomATR = 0.6; // need ~0.6 ATR of air beyond entry
  let firstTarget =
    resistance + Math.max(boxHeight * 0.8, cfg.boTargetATR * atr);
  if (nextRes) firstTarget = Math.max(firstTarget, nextRes);

  // If next resistance is too close, clamp target to it and re-check RR (this avoids “nowhere to go”)
  if (
    nextRes &&
    (nextRes - entryTrigger) / Math.max(atr, 1e-9) < minHeadroomATR
  ) {
    firstTarget = nextRes; // smaller target, but realistic
  }

  // RR at trigger (include a tiny slippage buffer even for market)
  const assumedFill = useStopMarket ? entryTrigger * 1.001 : entryTrigger; // +0.1% skid
  const risk = Math.max(0.01, assumedFill - initialStop);
  const reward = Math.max(0, firstTarget - assumedFill);
  const ratio = reward / risk;

  // ---- ready gates
  const rrOK = ratio >= Math.max(cfg.boMinRR, 1.35);
  const coreOK =
    tightening && structureOK && dryPullback && distributionOK && rrOK;

  if (!coreOK) {
    return {
      ready: false,
      waitReason: `tight=${tightening}, struct=${structureOK}, dry=${dryPullback}, distOK=${distributionOK}, RR=${ratio.toFixed(
        2
      )}`,
    };
  }

  // Optional retest plan when thrust is weak
  let retest = null;
  if (cfg.boUseRetestPlan && !(closeThroughOK || volThrustOK)) {
    const zoneMid = resistance;
    const buyLo = zoneMid - cfg.boRetestDepthATR * atr;
    const buyHi = zoneMid + Math.max(0.05 * atr, 0.01);
    retest = {
      retestTrigger: buyLo,
      retestLimit: buyHi,
      cancelIfCloseBackInBaseATR: cfg.boRetestInvalidATE,
      note: "Breakout lacked thrust; buy the retest of the breakout zone.",
    };
  }

  // Explain
  const whyBits = [];
  whyBits.push(`near ${resistance.toFixed(0)}`);
  if (tightening) whyBits.push("tight");
  if (structureOK) whyBits.push("HL/base OK");
  if (distributionOK) whyBits.push("no heavy distribution");
  whyBits.push(`RR ${ratio.toFixed(2)}`);
  if (closeThroughOK || volThrustOK) whyBits.push("thrust");

  return {
    ready: true,
    waitReason: "",
    entryTrigger,
    entryLimit,
    useStopMarket,
    initialStop,
    firstTarget,
    nearestRes: resistance,
    why: `Coil ${whyBits.join(", ")}`,
    diagnostics: {
      resistance,
      nextRes,
      baseLow,
      boxHeight,
      baseRangeATR,
      recentTR,
      avgTR,
      medTR,
      ratio,
      closeThroughOK,
      volThrustOK,
      distributionOK,
      stackedUp,
    },
    retestPlan: retest,
  };
}
