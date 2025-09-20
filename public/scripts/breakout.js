// /scripts/dip.js — DIP detector (pullback + bounce)
export function detectDipBounce(stock, data, cfg, U) {
  const { num, avg, near, sma, findResistancesAbove } = U;

  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const atr = Math.max(num(stock.atr14), px * 0.005, 1e-9);

  const ma25 = num(stock.movingAverage25d) || sma(data, 25);
  const ma50 = num(stock.movingAverage50d) || sma(data, 50);

  const recentBars = data.slice(-10);
  const recentHigh = Math.max(
    ...recentBars.slice(0, 5).map((d) => num(d.high))
  );
  const dipLow = Math.min(...recentBars.slice(-5).map((d) => num(d.low)));

  const pullbackPct =
    recentHigh > 0 ? ((recentHigh - dipLow) / recentHigh) * 100 : 0;
  const pullbackATR = (recentHigh - dipLow) / Math.max(atr, 1e-9);
  const hadPullback =
    pullbackPct >= cfg.dipMinPullbackPct ||
    pullbackATR >= cfg.dipMinPullbackATR;
  if (!hadPullback) {
    return {
      trigger: false,
      waitReason: `no meaningful pullback (${pullbackPct.toFixed(
        1
      )}% / ${pullbackATR.toFixed(1)} ATR)`,
      diagnostics: { pullbackPct, pullbackATR, recentHigh, dipLow },
    };
  }

  const depthOK = recentHigh - dipLow >= Math.max(0.9 * atr, px * 0.004);
  if (!depthOK) {
    return {
      trigger: false,
      waitReason: "dip too shallow (<0.9 ATR or <0.4%)",
      diagnostics: { recentHigh, dipLow, atr },
    };
  }

  // Fib window
  function lastSwingLowBeforeHigh(arr) {
    const win = arr.slice(-25, -5);
    let low = Infinity;
    for (let i = 2; i < win.length - 2; i++) {
      const isPivot =
        num(win[i].low) < num(win[i - 1].low) &&
        num(win[i].low) < num(win[i + 1].low);
      if (isPivot) low = Math.min(low, num(win[i].low));
    }
    return Number.isFinite(low)
      ? low
      : Math.min(...arr.slice(-25, -5).map((d) => num(d.low)));
  }
  const swingLow = lastSwingLowBeforeHigh(data);
  const swingRangeRaw = recentHigh - swingLow;
  const swingMin = Math.max(0.8 * atr, px * 0.004);
  const swingRange = Math.max(1e-9, Math.max(swingRangeRaw, swingMin));
  const retracePct = ((recentHigh - dipLow) / swingRange) * 100;
  const fibLow = 50 - cfg.fibTolerancePct;
  const fibHigh = 61.8 + cfg.fibTolerancePct;
  const fibOK = retracePct >= fibLow && retracePct <= fibHigh;

  // Bounce freshness
  let lowBarIndex = -1;
  const ageWin = Math.min(cfg.dipMaxBounceAgeBars, recentBars.length);
  for (let i = 0; i < ageWin; i++) {
    const lowVal = num(recentBars.at(-(i + 1)).low);
    if (near(lowVal, dipLow, Math.max(atr * 0.05, 1e-6))) {
      lowBarIndex = i;
      break;
    }
  }
  if (lowBarIndex < 0 || lowBarIndex > cfg.dipMaxBounceAgeBars - 1) {
    return {
      trigger: false,
      waitReason: `bounce too old (${lowBarIndex + 1} bars ago)`,
      diagnostics: { lowBarIndex, dipLow },
    };
  }

  // Support
  const nearMA25 =
    ma25 > 0 &&
    dipLow <= ma25 * (1 + cfg.dipMaSupportPctBand / 100) &&
    dipLow >= ma25 * (1 - cfg.dipMaSupportPctBand / 100);
  const nearMA50 =
    ma50 > 0 &&
    dipLow <= ma50 * (1 + cfg.dipMaSupportPctBand / 100) &&
    dipLow >= ma50 * (1 - cfg.dipMaSupportPctBand / 100);

  const structureSupport = (() => {
    const lookback = data.slice(-80, -10);
    const tolAbs = Math.max(
      cfg.dipStructTolATR * atr,
      dipLow * (cfg.dipStructTolPct / 100)
    );
    let touches = 0,
      lastTouchIdx = -999;
    for (let i = 2; i < lookback.length - 2; i++) {
      const L = num(lookback[i].low);
      const isPivotLow =
        L < num(lookback[i - 1].low) && L < num(lookback[i + 1].low);
      if (
        isPivotLow &&
        Math.abs(L - dipLow) <= tolAbs &&
        i - lastTouchIdx >= 3
      ) {
        touches++;
        lastTouchIdx = i;
        if (touches >= cfg.dipStructMinTouches) return true;
      }
    }
    return false;
  })();

  const nearSupport = nearMA25 || nearMA50 || structureSupport;
  if (!nearSupport) {
    return {
      trigger: false,
      waitReason: "pullback not at MA25/50 or tested structure",
      diagnostics: { dipLow, ma25, ma50, nearMA25, nearMA50, structureSupport },
    };
  }

  // Volume regime
  const avgVol20 = avg(data.slice(-20).map((d) => num(d.volume)));
  const pullbackBars = recentBars.filter(
    (b) => num(b.high) <= recentHigh && num(b.low) >= dipLow
  );
  const pullbackVol = avg(pullbackBars.map((b) => num(b.volume)));
  const dryPullback =
    pullbackVol > 0 ? pullbackVol <= avgVol20 * cfg.pullbackDryFactor : true;
  const d0 = data.at(-1),
    d1 = data.at(-2);
  const bounceVolHot = num(d0.volume) >= avgVol20 * cfg.bounceHotFactor;

  // Bounce confirmation
  const bounceStrengthATR = (px - dipLow) / Math.max(atr, 1e-9);
  const minStr = Math.max(cfg.dipMinBounceStrengthATR, 0.6);

  const closeAboveYHigh =
    num(d0.close) > num(d1.high) && bounceStrengthATR >= minStr;

  const hammer = (() => {
    const range = num(d0.high) - num(d0.low);
    const body = Math.abs(num(d0.close) - num(d0.open));
    const lower = Math.min(num(d0.close), num(d0.open)) - num(d0.low);
    return (
      range > 0 &&
      body < 0.4 * range &&
      lower > 1.5 * body &&
      num(d0.close) >= num(d0.open) &&
      bounceStrengthATR >= minStr
    );
  })();

  const engulf =
    num(d1.close) < num(d1.open) &&
    num(d0.close) > num(d0.open) &&
    num(d0.open) <= num(d1.close) &&
    num(d0.close) > num(d1.open) &&
    num(d0.close) > num(d1.high) &&
    bounceStrengthATR >= minStr;

  const twoBarRev =
    num(d0.close) > num(d1.close) &&
    num(d0.low) > num(d1.low) &&
    num(d0.close) > num(d0.open) &&
    bounceStrengthATR >= Math.max(0.8, cfg.dipMinBounceStrengthATR);

  const basicCloseUp =
    num(d0.close) > num(d0.open) &&
    num(d0.close) > num(d1.close) &&
    bounceVolHot &&
    bounceStrengthATR >= Math.max(0.8, cfg.dipMinBounceStrengthATR);

  const bounceOK =
    closeAboveYHigh || hammer || engulf || twoBarRev || basicCloseUp;
  if (!bounceOK) {
    return {
      trigger: false,
      waitReason: `bounce not strong enough (${bounceStrengthATR.toFixed(
        2
      )} ATR) / no pattern`,
      diagnostics: {
        bounceStrengthATR,
        closeAboveYHigh,
        hammer,
        engulf,
        twoBarRev,
        basicCloseUp,
      },
    };
  }

  // Recovery cap
  const spanRaw = recentHigh - dipLow;
  const span = Math.max(spanRaw, Math.max(0.8 * atr, px * 0.004));
  const recoveryPct = span > 0 ? ((px - dipLow) / span) * 100 : 0;
  const recoveryPctCapped = Math.min(recoveryPct, 120);
  if (recoveryPctCapped > cfg.dipMaxRecoveryPct) {
    return {
      trigger: false,
      waitReason: `already recovered ${recoveryPctCapped.toFixed(0)}%`,
      diagnostics: { recoveryPct: recoveryPctCapped, px, dipLow, recentHigh },
    };
  }

  // Higher low & volume regime quality
  const prevLow = Math.min(...data.slice(-15, -5).map((d) => num(d.low)));
  const higherLow = dipLow >= prevLow * 0.995 || dipLow >= prevLow - 0.25 * atr;
  const volumeRegimeOK =
    dryPullback &&
    (bounceVolHot || (bounceStrengthATR >= 0.8 && closeAboveYHigh));

  const trigger =
    hadPullback &&
    fibOK &&
    nearSupport &&
    bounceOK &&
    higherLow &&
    volumeRegimeOK &&
    recoveryPctCapped <= cfg.dipMaxRecoveryPct;
  if (!trigger) {
    return {
      trigger: false,
      waitReason: "DIP conditions not fully met",
      diagnostics: {
        hadPullback,
        fibOK,
        nearSupport,
        bounceOK,
        higherLow,
        dryPullback,
        bounceVolHot,
        volumeRegimeOK,
        lowBarIndex,
        recoveryPct: recoveryPctCapped,
      },
    };
  }

  // Targets & stops (softened)
  const resList = findResistancesAbove(data, px, stock);
  const recentHigh20 = Math.max(...data.slice(-20).map((d) => num(d.high)));
  let target = Math.max(px + Math.max(2.2 * atr, px * 0.02), recentHigh20);
  const nearestRes = resList.length ? resList[0] : null;

  if (nearestRes && nearestRes - px < 0.8 * atr) {
    target = Math.min(target, nearestRes);
  } else if (resList.length && resList[0] - px < 0.6 * atr && resList[1]) {
    target = Math.min(Math.max(target, resList[1]), px + 2.6 * atr);
  }

  const stop = dipLow - 0.5 * atr;
  const why = `Fresh retrace at support; dry pullback + strong bounce; bounce ${bounceStrengthATR.toFixed(
    1
  )} ATR; recovery ${recoveryPctCapped.toFixed(0)}%.`;

  return {
    trigger,
    stop,
    target,
    nearestRes,
    why,
    waitReason: "",
    diagnostics: {
      pullbackPct,
      pullbackATR,
      retracePct,
      lowBarIndex,
      bounceStrengthATR,
      recoveryPct: recoveryPctCapped,
      nearSupport,
      dryPullback,
      bounceVolHot,
      volumeRegimeOK,
      atr,
    },
  };
}
