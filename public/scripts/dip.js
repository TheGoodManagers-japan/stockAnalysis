// /scripts/dip.js — DIP detector (pullback + bounce) — Looser for more signals
export function detectDipBounce(stock, data, cfg, U) {
  const { num, avg, near, sma, findResistancesAbove } = U;
  const reasonTrace = [];

  if (!Array.isArray(data) || data.length < 25) {
    const why = "insufficient data (<25 bars)";
    return {
      trigger: false,
      waitReason: why,
      diagnostics: {},
      reasonTrace: [why],
    };
  }

  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const atr = Math.max(num(stock.atr14), px * 0.005, 1e-9);

  // --- MAs (add MA20 as valid support; soften MA25 slope gate) ---
  const ma5 = num(stock.movingAverage5d) || sma(data, 5);
  const ma20 = sma(data, 20);
  const ma25 = num(stock.movingAverage25d) || sma(data, 25);
  const ma50 = num(stock.movingAverage50d) || sma(data, 50);

  // Soften: only veto if MA25 is clearly rolling down AND price is below MA25
  const ma25Prev = sma(data.slice(0, -1), 25);
  const ma25SoftUp = ma25Prev > 0 && (ma25 >= ma25Prev * 0.997 || px >= ma25);
  if (!ma25SoftUp) {
    reasonTrace.push("MA25 not rising and price below MA25 (weak base)");
    // Soft gate: don't return yet — continue, but this will weigh against bounce later
  }

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
    pullbackPct >= Math.min(cfg.dipMinPullbackPct, 1.0) ||
    pullbackATR >= Math.max(cfg.dipMinPullbackATR, 0.4); // was 0.5

  if (!hadPullback) {
    const why = `no meaningful pullback (${pullbackPct.toFixed(
      1
    )}% / ${pullbackATR.toFixed(1)} ATR)`;
    reasonTrace.push(why);
    return {
      trigger: false,
      waitReason: why,
      diagnostics: { pullbackPct, pullbackATR, recentHigh, dipLow },
      reasonTrace,
    };
  }

  const depthOK = recentHigh - dipLow >= Math.max(0.6 * atr, px * 0.003); // was 0.9 ATR / 0.4%
  if (!depthOK) {
    const why = "dip too shallow (<0.6 ATR or <0.3%)";
    reasonTrace.push(why);
    return {
      trigger: false,
      waitReason: why,
      diagnostics: { recentHigh, dipLow, atr },
      reasonTrace,
    };
  }

  // --- Fib window (looser + alternative path) ---
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
  const swingRange = Math.max(
    1e-9,
    Math.max(recentHigh - swingLow, Math.max(0.7 * atr, px * 0.003))
  );
  const retracePct = ((recentHigh - dipLow) / swingRange) * 100;

  const tol = Math.max(cfg.fibTolerancePct ?? 10, 12);
  const fibLow = 50 - tol;
  const fibHigh = 61.8 + tol;
  const fibOK = retracePct >= fibLow && retracePct <= fibHigh;

  // --- Bounce freshness (slightly wider) ---
  let lowBarIndex = -1;
  const ageWin = Math.min(
    Math.max(cfg.dipMaxBounceAgeBars, 8),
    recentBars.length
  ); // allow up to 8
  for (let i = 0; i < ageWin; i++) {
    const lowVal = num(recentBars.at(-(i + 1)).low);
    if (near(lowVal, dipLow, Math.max(atr * 0.05, 1e-6))) {
      lowBarIndex = i;
      break;
    }
  }
  if (lowBarIndex < 0 || lowBarIndex > ageWin - 1) {
    const why = `bounce too old (${lowBarIndex + 1} bars ago)`;
    reasonTrace.push(why);
    return {
      trigger: false,
      waitReason: why,
      diagnostics: { lowBarIndex, dipLow },
      reasonTrace,
    };
  }

  // --- Support (add MA20 and relax structure touches) ---
  const band = Math.max(cfg.dipMaSupportPctBand, 9); // wider ±%
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
      cfg.dipStructTolATR * atr,
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
    const why = "not at MA20/25/50 or tested structure";
    reasonTrace.push(why);
    return {
      trigger: false,
      waitReason: why,
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
  const dryPullback =
    pullbackVol > 0
      ? pullbackVol <= avgVol20 * Math.max(cfg.pullbackDryFactor, 1.3)
      : true;

  const d0 = data.at(-1),
    d1 = data.at(-2);
  const bounceHotX = Math.min(cfg.bounceHotFactor || 1.0, 1.18);
  const bounceVolHot =
    avgVol20 > 0 ? num(d0.volume) >= avgVol20 * bounceHotX : true;

  // --- Bounce confirmation (looser + extra path) ---
  const bounceStrengthATR = (px - dipLow) / Math.max(atr, 1e-9);
  const minStr = Math.min(Math.max(cfg.dipMinBounceStrengthATR, 0.6), 0.65);

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

  // Easier: reclaim MA5 + green close OR clear Y-high without hot vol if strength is high
  const basicCloseUp =
    (num(d0.close) > num(d0.open) &&
      num(d0.close) >= ma5 &&
      bounceStrengthATR >= Math.max(0.65, minStr)) ||
    (num(d0.close) > num(d1.high) && bounceStrengthATR >= 0.85);

  const bounceOK =
    closeAboveYHigh || hammer || engulf || twoBarRev || basicCloseUp;
  if (!bounceOK) {
    const why = `bounce weak (${bounceStrengthATR.toFixed(
      2
    )} ATR) / no pattern`;
    reasonTrace.push(why);
    return {
      trigger: false,
      waitReason: why,
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

  // If Fib not OK, allow alt path: strong bounce or very dry pullback
  const fibAltOK =
    !fibOK && (bounceStrengthATR >= 0.9 || (dryPullback && closeAboveYHigh));

  // --- Recovery cap (looser) ---
  const spanRaw = recentHigh - dipLow;
  const span = Math.max(spanRaw, Math.max(0.7 * atr, px * 0.003));
  const recoveryPct = span > 0 ? ((px - dipLow) / span) * 100 : 0;
  const recoveryPctCapped = Math.min(recoveryPct, 140);
  const maxRec = Math.max(cfg.dipMaxRecoveryPct, 115); // was 100
  if (recoveryPctCapped > maxRec) {
    const why = `already recovered ${recoveryPctCapped.toFixed(
      0
    )}% > ${maxRec}%`;
    reasonTrace.push(why);
    return {
      trigger: false,
      waitReason: why,
      diagnostics: { recoveryPct: recoveryPctCapped, px, dipLow, recentHigh },
      reasonTrace,
    };
  }

  // --- Higher low (looser) & volume acceptance (OR instead of AND) ---
  const prevLow = Math.min(...data.slice(-15, -5).map((d) => num(d.low)));
  const higherLow = dipLow >= prevLow * 0.992 || dipLow >= prevLow - 0.35 * atr;

  const volumeRegimeOK =
    dryPullback || bounceVolHot || bounceStrengthATR >= 0.85;
  if (!volumeRegimeOK) {
    const why = "volume regime weak (need dry pullback or hot/strong bounce)";
    reasonTrace.push(why);
    return {
      trigger: false,
      waitReason: why,
      diagnostics: { dryPullback, bounceVolHot, bounceStrengthATR },
      reasonTrace,
    };
  }

  // --- Pre-entry headroom veto (looser) ---
  const resListEarly = findResistancesAbove(data, px, stock);
  const nearestResEarly = resListEarly.length ? resListEarly[0] : null;
  if (nearestResEarly) {
    const headroomATR = (nearestResEarly - px) / Math.max(atr, 1e-9);
    const headroomPct = ((nearestResEarly - px) / Math.max(px, 1e-9)) * 100;
    const minATR = Math.min(Math.max(cfg.nearResVetoATR, 0.35), 0.5); // 0.35–0.5 ATR
    const minPct = Math.min(Math.max(cfg.nearResVetoPct, 0.9), 1.2); // 0.9%–1.2%
    if (headroomATR < minATR || headroomPct < minPct) {
      const why = "Headroom too small pre-entry";
      reasonTrace.push(why);
      return {
        trigger: false,
        waitReason: why,
        diagnostics: { headroomATR, headroomPct, nearestResEarly },
        reasonTrace,
      };
    }
  }

  // --- Final trigger (allow fib OR fibAlt) ---
  const trigger =
    hadPullback && (fibOK || fibAltOK) && nearSupport && bounceOK && higherLow;

  if (!trigger) {
    const why = "DIP conditions not fully met";
    reasonTrace.push(why);
    return {
      trigger: false,
      waitReason: why,
      diagnostics: {
        hadPullback,
        fibOK,
        fibAltOK,
        nearSupport,
        bounceOK,
        higherLow,
        lowBarIndex,
        recoveryPct: recoveryPctCapped,
      },
      reasonTrace,
    };
  }

  // --- Targets & stops (slightly easier) ---
  const resList = findResistancesAbove(data, px, stock);
  const nearestRes = resList.length ? resList[0] : null;
  const recentHigh20 = Math.max(...data.slice(-20).map((d) => num(d.high)));

  let target = Math.max(px + Math.max(1.9 * atr, px * 0.018), recentHigh20); // was 2.2 ATR
  if (nearestRes && nearestRes - px < 0.9 * atr) {
    target = Math.min(target, nearestRes);
  } else if (resList.length && resList[0] - px < 0.6 * atr && resList[1]) {
    target = Math.min(Math.max(target, resList[1]), px + 2.5 * atr);
  }

  const stop = dipLow - 0.45 * atr; // a touch tighter than 0.5 to help RR pass

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
      atr,
    },
    reasonTrace,
  };
}
