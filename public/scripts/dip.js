// /scripts/dip.js — DIP detector (pullback + bounce) — Looser, with reasonTrace
export function detectDipBounce(stock, data, cfg, U) {
  const { num, avg, near, sma, findResistancesAbove } = U;
  const reasonTrace = []; // collect “why not” breadcrumbs

  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const atr = Math.max(num(stock.atr14), px * 0.005, 1e-9);

  // --- MAs (add MA20 support option) ---
  const ma5 = num(stock.movingAverage5d) || sma(data, 5);
  const ma20 = sma(data, 20);
  const ma25 = num(stock.movingAverage25d) || sma(data, 25);
  const ma50 = num(stock.movingAverage50d) || sma(data, 50);

  // --- Pullback depth (looser) ---
  const recentBars = data.slice(-10);
  const recentHigh = Math.max(
    ...recentBars.slice(0, 5).map((d) => num(d.high))
  );
  const dipLow = Math.min(...recentBars.slice(-5).map((d) => num(d.low)));

  const pullbackPct =
    recentHigh > 0 ? ((recentHigh - dipLow) / recentHigh) * 100 : 0;
  const pullbackATR = (recentHigh - dipLow) / Math.max(atr, 1e-9);
  const hadPullback =
    pullbackPct >= Math.min(cfg.dipMinPullbackPct, 1.0) || // cap strictness
    pullbackATR >= Math.max(cfg.dipMinPullbackATR, 0.35); // allow shallower ATR

  if (!hadPullback) {
    reasonTrace.push(
      `no meaningful pullback (${pullbackPct.toFixed(
        1
      )}% / ${pullbackATR.toFixed(1)} ATR)`
    );
    return {
      trigger: false,
      waitReason: reasonTrace.at(-1),
      diagnostics: { pullbackPct, pullbackATR, recentHigh, dipLow },
      reasonTrace,
    };
  }

  // Loosen “too shallow” check (allow 0.6*ATR or 0.3%)
  const depthOK = recentHigh - dipLow >= Math.max(0.6 * atr, px * 0.003);
  if (!depthOK) {
    reasonTrace.push("dip too shallow (<0.6 ATR or <0.3%)");
    return {
      trigger: false,
      waitReason: reasonTrace.at(-1),
      diagnostics: { recentHigh, dipLow, atr },
      reasonTrace,
    };
  }

  // --- Fib window (make optional if very strong bounce + tight support) ---
  // previous swing low search
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
  const swingMin = Math.max(0.7 * atr, px * 0.003); // a bit looser
  const swingRange = Math.max(1e-9, Math.max(swingRangeRaw, swingMin));
  const retracePct = ((recentHigh - dipLow) / swingRange) * 100;

  // widen fib tolerance
  const fibLow = 50 - Math.max(cfg.fibTolerancePct, 12);
  const fibHigh = 61.8 + Math.max(cfg.fibTolerancePct, 12);
  const fibOK = retracePct >= fibLow && retracePct <= fibHigh;

  // --- Bounce freshness (looser) ---
  let lowBarIndex = -1;
  const ageWin = Math.min(
    Math.max(cfg.dipMaxBounceAgeBars, 9),
    recentBars.length
  ); // allow up to 9 bars
  for (let i = 0; i < ageWin; i++) {
    const lowVal = num(recentBars.at(-(i + 1)).low);
    if (near(lowVal, dipLow, Math.max(atr * 0.05, 1e-6))) {
      lowBarIndex = i;
      break;
    }
  }
  if (lowBarIndex < 0 || lowBarIndex > ageWin - 1) {
    reasonTrace.push(`bounce too old (${lowBarIndex + 1} bars ago)`);
    return {
      trigger: false,
      waitReason: reasonTrace.at(-1),
      diagnostics: { lowBarIndex, dipLow },
      reasonTrace,
    };
  }

  // --- Support (add MA20 and relax structure touches to >=1) ---
  const band = Math.max(cfg.dipMaSupportPctBand, 7.5); // wider ±%
  const nearMA20 =
    ma20 > 0 &&
    dipLow <= ma20 * (1 + band / 100) &&
    dipLow >= ma20 * (1 - band / 100);
  const nearMA25 =
    ma25 > 0 &&
    dipLow <= ma25 * (1 + band / 100) &&
    dipLow >= ma25 * (1 - band / 100);
  const nearMA50 =
    ma50 > 0 &&
    dipLow <= ma50 * (1 + band / 100) &&
    dipLow >= ma50 * (1 - band / 100);

  const structureSupport = (() => {
    const lookback = data.slice(-80, -10);
    const tolAbs = Math.max(
      Math.min(cfg.dipStructTolATR, 1.0) * atr,
      dipLow * (Math.max(cfg.dipStructTolPct, 3.5) / 100)
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
        i - lastTouchIdx >= 2
      ) {
        touches++;
        lastTouchIdx = i;
        if (touches >= Math.min(cfg.dipStructMinTouches, 1)) return true; // allow 1 touch
      }
    }
    return false;
  })();

  const nearSupport = nearMA20 || nearMA25 || nearMA50 || structureSupport;
  if (!nearSupport) {
    reasonTrace.push("not at MA20/25/50 or tested structure");
    return {
      trigger: false,
      waitReason: reasonTrace.at(-1),
      diagnostics: {
        dipLow,
        ma20,
        ma25,
        ma50,
        nearMA20,
        nearMA25,
        nearMA50,
        structureSupport,
      },
      reasonTrace,
    };
  }

  // --- Volume regime (looser) ---
  const avgVol20 = avg(data.slice(-20).map((d) => num(d.volume)));
  const pullbackBars = recentBars.filter(
    (b) => num(b.high) <= recentHigh && num(b.low) >= dipLow
  );
  const pullbackVol = avg(pullbackBars.map((b) => num(b.volume)));
  const dryFactor = Math.max(cfg.pullbackDryFactor, 1.6); // allow “less dry” pullbacks
  const dryPullback =
    pullbackVol > 0 ? pullbackVol <= avgVol20 * dryFactor : true;

  const d0 = data.at(-1),
    d1 = data.at(-2);
  const bounceHotX = Math.min(cfg.bounceHotFactor || 1.0, 1.18); // lower the heat requirement
  const bounceVolHot =
    avgVol20 > 0 ? num(d0.volume) >= avgVol20 * bounceHotX : true;

  // --- Bounce confirmation (add easier alternatives) ---
  const bounceStrengthATR = (px - dipLow) / Math.max(atr, 1e-9);
  const minStr = Math.min(Math.max(cfg.dipMinBounceStrengthATR, 0.5), 0.65); // allow 0.5–0.65 ATR

  const closeAboveYHigh =
    num(d0.close) > num(d1.high) && bounceStrengthATR >= minStr;

  const hammer = (() => {
    const range = num(d0.high) - num(d0.low);
    const body = Math.abs(num(d0.close) - num(d0.open));
    const lower = Math.min(num(d0.close), num(d0.open)) - num(d0.low);
    return (
      range > 0 &&
      body < 0.45 * range &&
      lower > 1.3 * body &&
      num(d0.close) >= num(d0.open) &&
      bounceStrengthATR >= minStr
    );
  })();

  const engulf =
    num(d1.close) < num(d1.open) &&
    num(d0.close) > num(d0.open) &&
    num(d0.open) <= num(d1.close) &&
    num(d0.close) > num(d1.open) &&
    bounceStrengthATR >= Math.max(minStr, 0.55);

  const twoBarRev =
    num(d0.close) > num(d1.close) &&
    num(d0.low) > num(d1.low) &&
    num(d0.close) > num(d0.open) &&
    bounceStrengthATR >= Math.max(0.7, minStr);

  const basicCloseUp =
    num(d0.close) > num(d0.open) &&
    num(d0.close) > num(d1.close) &&
    bounceStrengthATR >= Math.max(0.65, minStr) &&
    (bounceVolHot || num(d0.close) >= ma5); // let MA5 close substitute for hot volume

  // If Fib isn’t OK, allow strong alternative: very tight pullback + strong bounce
  const fibAltOK =
    !fibOK && (bounceStrengthATR >= 0.9 || (dryPullback && closeAboveYHigh));

  const bounceOK =
    closeAboveYHigh || hammer || engulf || twoBarRev || basicCloseUp;
  if (!bounceOK) {
    reasonTrace.push(
      `bounce weak (${bounceStrengthATR.toFixed(2)} ATR) / no pattern`
    );
    return {
      trigger: false,
      waitReason: reasonTrace.at(-1),
      diagnostics: {
        bounceStrengthATR,
        closeAboveYHigh,
        hammer,
        engulf,
        twoBarRev,
        basicCloseUp,
      },
      reasonTrace,
    };
  }

  // --- Recovery cap (looser) ---
  const spanRaw = recentHigh - dipLow;
  const span = Math.max(spanRaw, Math.max(0.7 * atr, px * 0.003));
  const recoveryPct = span > 0 ? ((px - dipLow) / span) * 100 : 0;
  const recoveryPctCapped = Math.min(recoveryPct, 140);
  const maxRec = Math.max(cfg.dipMaxRecoveryPct, 92); // allow more recovered bounces
  if (recoveryPctCapped > maxRec) {
    reasonTrace.push(
      `already recovered ${recoveryPctCapped.toFixed(0)}% > ${maxRec}%`
    );
    return {
      trigger: false,
      waitReason: reasonTrace.at(-1),
      diagnostics: { recoveryPct: recoveryPctCapped, px, dipLow, recentHigh },
      reasonTrace,
    };
  }

  // --- Higher low (looser) & volume regime quality (looser) ---
  const prevLow = Math.min(...data.slice(-15, -5).map((d) => num(d.low)));
  const higherLow = dipLow >= prevLow * 0.992 || dipLow >= prevLow - 0.35 * atr;

  const volumeRegimeOK =
    dryPullback &&
    (bounceVolHot ||
      (bounceStrengthATR >= 0.7 && (closeAboveYHigh || num(d0.close) >= ma5)));

  // Final trigger (OR-in the fibAltOK)
  const trigger =
    hadPullback &&
    (fibOK || fibAltOK) &&
    nearSupport &&
    bounceOK &&
    higherLow &&
    volumeRegimeOK &&
    recoveryPctCapped <= maxRec;

  if (!trigger) {
    reasonTrace.push("DIP conditions not fully met");
    return {
      trigger: false,
      waitReason: reasonTrace.at(-1),
      diagnostics: {
        hadPullback,
        fibOK,
        fibAltOK,
        nearSupport,
        bounceOK,
        higherLow,
        dryPullback,
        bounceVolHot,
        volumeRegimeOK,
        lowBarIndex,
        recoveryPct: recoveryPctCapped,
      },
      reasonTrace,
    };
  }

  // --- Targets & stops (slightly easier to hit) ---
  const resList = findResistancesAbove(data, px, stock);
  const recentHigh20 = Math.max(...data.slice(-20).map((d) => num(d.high)));
  let target = Math.max(px + Math.max(2.0 * atr, px * 0.018), recentHigh20); // 2.0 ATR / 1.8%
  const nearestRes = resList.length ? resList[0] : null;

  if (nearestRes && nearestRes - px < 0.9 * atr) {
    // if resistance is close, prefer taking it (helps target hits)
    target = Math.min(target, nearestRes);
  } else if (resList.length && resList[0] - px < 0.6 * atr && resList[1]) {
    target = Math.min(Math.max(target, resList[1]), px + 2.5 * atr);
  }

  const stop = dipLow - 0.45 * atr; // a hair tighter
  const why = `Retrace at MA/structure; dry-ish pullback + strong bounce (${bounceStrengthATR.toFixed(
    2
  )} ATR); recovery ${recoveryPctCapped.toFixed(0)}%.`;

  return {
    trigger: true,
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
    reasonTrace,
  };
}
