// /scripts/dip.js — DIP detector (pullback + bounce) — tuned for better fill rate on TSE
export function detectDipBounce(stock, data, cfg, U) {
  const { num, avg, near, sma, findResistancesAbove } = U;
  const reasonTrace = [];

  if (!Array.isArray(data) || data.length < 25) {
    const why = "insufficient data (<25 bars)";
    return {
      trigger: false,
      waitReason: why,
      diagnostics: { passedPreBounce: false, code: "NOT_DIP_DATA" },
      reasonTrace: [why],
    };
  }

  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const atr = Math.max(num(stock.atr14), px * 0.005, 1e-9);

  // --- MAs (MA20 as valid support; track slopes for a light veto) ---
  const ma5 = num(stock.movingAverage5d) || sma(data, 5);
  const ma20 = sma(data, 20);
  const ma25 = num(stock.movingAverage25d) || sma(data, 25);
  const ma50 = num(stock.movingAverage50d) || sma(data, 50);
  const ma200 = num(stock.movingAverage200d) || sma(data, 200);

  const ma20Prev = sma(data.slice(0, -1), 20);
  const ma25Prev = sma(data.slice(0, -1), 25);

  const ma25SoftUp = ma25Prev > 0 && (ma25 >= ma25Prev * 0.997 || px >= ma25);
  if (!ma25SoftUp)
    reasonTrace.push("MA25 not rising and price below MA25 (weak base)");

  const slopeDown20 = ma20Prev > 0 && ma20 < ma20Prev * 0.998;
  const slopeDown25 = ma25Prev > 0 && ma25 < ma25Prev * 0.998;
  const slopeComboFlag = slopeDown20 && slopeDown25 && px < ma20;

  // --- Pullback depth (slightly looser) ---
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
    pullbackATR >= Math.max(cfg.dipMinPullbackATR, 0.4);

  if (!hadPullback) {
    const why = `no meaningful pullback (${pullbackPct.toFixed(
      1
    )}% / ${pullbackATR.toFixed(1)} ATR)`;
    reasonTrace.push(why);
    return {
      trigger: false,
      waitReason: why,
      diagnostics: {
        pullbackPct,
        pullbackATR,
        recentHigh,
        dipLow,
        passedPreBounce: false,
        code: "NOT_DIP_PULLBACK",
      },
      reasonTrace,
    };
  }

  const depthOK = recentHigh - dipLow >= Math.max(0.5 * atr, px * 0.0025);
  if (!depthOK) {
    const why = "dip too shallow (<0.5 ATR or <0.25%)";
    reasonTrace.push(why);
    return {
      trigger: false,
      waitReason: why,
      diagnostics: {
        recentHigh,
        dipLow,
        atr,
        passedPreBounce: false,
        code: "NOT_DIP_DEPTH",
      },
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
  const fibOK = retracePct >= 50 - tol && retracePct <= 61.8 + tol;

  // --- Bounce freshness ---
  let lowBarIndex = -1;
  const ageWin = Math.min(
    Math.max((cfg.dipMaxBounceAgeBars ?? 6) + 1, 9),
    recentBars.length
  );
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
      diagnostics: {
        lowBarIndex,
        dipLow,
        passedPreBounce: false,
        code: "NOT_DIP_BOUNCE_OLD",
      },
      reasonTrace,
    };
  }

  // --- Prepare bar refs & bounce strength early (shared) ---
  const d0 = data.at(-1),
    d1 = data.at(-2);
  const bounceStrengthATR = (px - dipLow) / Math.max(atr, 1e-9);

  // --- Support (ATR-based MA bands OR tested/micro structure) ---
  const bandATR = Math.max(cfg.dipMaSupportATRBands ?? 1.0, 0.6) * atr; // widened to 1.0 ATR
  const nearMA20 = ma20 > 0 && Math.abs(dipLow - ma20) <= bandATR;
  const nearMA25 = ma25 > 0 && Math.abs(dipLow - ma25) <= bandATR;
  const nearMA50 =
    ma50 > 0 && Math.abs(dipLow - ma50) <= Math.max(bandATR, 1.2 * atr);

  const structureSupport = (() => {
    const lookback = data.slice(-120, -8);
    const tolAbs = Math.max(
      (cfg.dipStructTolATR ?? 1.0) * atr,
      dipLow * ((cfg.dipStructTolPct ?? 3.5) / 100)
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
        if (touches >= Math.min(cfg.dipStructMinTouches ?? 1, 2)) return true;
      }
    }
    return false;
  })();

  const microBase = (() => {
    const win = data.slice(-20);
    let hits = 0;
    for (let i = 2; i < win.length - 2; i++) {
      const L = num(win[i].low);
      const isPivot = L < num(win[i - 1].low) && L < num(win[i + 1].low);
      if (isPivot && Math.abs(L - dipLow) <= 0.5 * atr) hits++;
    }
    return hits >= 2;
  })();

  const strongBounceOverride =
    (bounceStrengthATR >= 1.0 && num(d0.close) > num(d1.high)) ||
    bounceStrengthATR >= 1.15;

  const nearSupport =
    nearMA20 ||
    nearMA25 ||
    nearMA50 ||
    structureSupport ||
    microBase ||
    strongBounceOverride;

  // mark whether we've completed all pre-bounce prerequisites
  const passedPreBounce =
    hadPullback &&
    depthOK &&
    lowBarIndex >= 0 &&
    lowBarIndex <= ageWin - 1 &&
    !!nearSupport;

  if (!nearSupport) {
    const why = "not at adaptive support (MA±ATR / structure)";
    reasonTrace.push(why);
    return {
      trigger: false,
      waitReason: why,
      diagnostics: {
        dipLow,
        ma20,
        ma25,
        ma50,
        bandATR,
        distMA20_ATR: ma20 > 0 ? (dipLow - ma20) / Math.max(atr, 1e-9) : null,
        distMA25_ATR: ma25 > 0 ? (dipLow - ma25) / Math.max(atr, 1e-9) : null,
        distMA50_ATR: ma50 > 0 ? (dipLow - ma50) / Math.max(atr, 1e-9) : null,
        nearMA20,
        nearMA25,
        nearMA50,
        structureSupport,
        microBase,
        strongBounceOverride,
        passedPreBounce: false,
        code: "NOT_DIP_SUPPORT",
      },
      reasonTrace,
    };
  }

  // --- Volume regime ---
  const avgVol20 = avg(data.slice(-20).map((d) => num(d.volume)));
  const pullbackBars = recentBars.filter(
    (b) => num(b.high) <= recentHigh && num(b.low) >= dipLow
  );
  const pullbackVol = avg(pullbackBars.map((b) => num(b.volume)));
  const dryPullback =
    pullbackVol > 0
      ? pullbackVol <= avgVol20 * Math.max(cfg.pullbackDryFactor, 1.3)
      : true;

  const bounceHotX = Math.min(cfg.bounceHotFactor || 1.0, 1.18);
  const bounceVolHot =
    avgVol20 > 0 ? num(d0.volume) >= avgVol20 * bounceHotX : true;

  // --- Bounce confirmation (quality, slightly relaxed) ---
  if (bounceStrengthATR <= 0.03) {
    const midPrev = (num(d1.high) + num(d1.low)) / 2;
    const greenSeed =
      num(d0.close) > num(d0.open) &&
      (num(d0.close) >= ma5 || num(d0.close) >= midPrev);
    if (!greenSeed) {
      const why = `bounce immature (${bounceStrengthATR.toFixed(2)} ATR)`;
      reasonTrace.push(why);
      return {
        trigger: false,
        waitReason: why,
        diagnostics: {
          bounceStrengthATR,
          passedPreBounce: false,
          code: "NOT_DIP_IMMATURE",
        },
        reasonTrace,
      };
    }
    reasonTrace.push(
      "immature bounce soft-pass (green seed; proceeding to quality gates)"
    );
  }

  const minStr = Math.min(
    Math.max(cfg.dipMinBounceStrengthATR ?? 0.55, 0.55),
    0.62
  );

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
    (num(d0.close) > num(d0.open) &&
      num(d0.close) >= Math.min(ma5, ma20) &&
      bounceStrengthATR >= Math.max(0.58, minStr)) ||
    (num(d0.close) > num(d1.high) && bounceStrengthATR >= 0.75);

  const barRange = num(d0.high) - num(d0.low);
  const body = Math.abs(num(d0.close) - num(d0.open));
  const midPrev = (num(d1.high) + num(d1.low)) / 2;

  const rangeQuality = barRange >= 0.55 * atr;
  const bodyQuality = body >= 0.28 * barRange;
  const closeQuality =
    num(d0.close) >= Math.max(midPrev, ma5 * 0.995, ma20) &&
    (num(d0.close) > num(d0.open) || strongBounceOverride);
  const v20ok = avgVol20 > 0 ? num(d0.volume) >= 0.95 * avgVol20 : true;

  const patternOK =
    closeAboveYHigh || hammer || engulf || twoBarRev || basicCloseUp;

  // Accept if (a) bounce itself is powerful OR (b) classical conditions met
  const bounceOK =
    strongBounceOverride ||
    (patternOK &&
      bodyQuality &&
      rangeQuality &&
      (v20ok || dryPullback || closeAboveYHigh) &&
      closeQuality);

  if (!bounceOK) {
    const why = `bounce weak (${bounceStrengthATR.toFixed(
      2
    )} ATR) / no quality pattern`;
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
        bodyQuality,
        rangeQuality,
        closeQuality,
        v20ok,
        passedPreBounce: true,
        code: "DIP_BOUNCE_WEAK",
      },
      reasonTrace,
    };
  }

  // If Fib not OK, allow alt path: strong bounce or very dry pullback + clear Y-high
  const fibAltOK =
    !fibOK &&
    (bounceStrengthATR >= 0.9 ||
      (dryPullback && (closeAboveYHigh || bounceStrengthATR >= 0.85)));

  // --- Optional: very light RSI divergence veto (soft, with override) ---
  function rsiFromDataLocal(arr, length = 14) {
    const n = arr.length;
    if (n < length + 1) return 50;
    let gains = 0,
      losses = 0;
    for (let i = n - length; i < n; i++) {
      const prev = num(arr[i - 1].close),
        curr = num(arr[i].close);
      const diff = curr - prev;
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / length,
      avgLoss = losses / length || 1e-9;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }
  function recentHighIdx(arr, k = 8) {
    let idx = -1,
      mx = -Infinity,
      start = Math.max(0, arr.length - k);
    for (let i = start; i < arr.length; i++) {
      const h = num(arr[i].high);
      if (h > mx) {
        mx = h;
        idx = i;
      }
    }
    return idx;
  }
  const rsiSeries = [];
  for (let i = Math.max(15, data.length - 40); i < data.length; i++) {
    rsiSeries.push(rsiFromDataLocal(data.slice(0, i), 14));
  }
  const hi1 = recentHighIdx(data.slice(0, -2));
  const hi2 = recentHighIdx(data.slice(0, -10));
  let bearishDiv = false;
  if (hi1 > 0 && hi2 > 0 && rsiSeries.length >= 8) {
    const p1 = num(data[hi1].high),
      p2 = num(data[hi2].high);
    const r1 = rsiSeries[rsiSeries.length - 1],
      r2 = rsiSeries[Math.max(0, rsiSeries.length - 8)];
    bearishDiv = p1 <= p2 * 1.01 && r1 < r2 - 3;
    if (bearishDiv && !(closeAboveYHigh || bounceStrengthATR >= 1.05)) {
      const why = "bearish RSI divergence into resistance";
      reasonTrace.push(why);
      return {
        trigger: false,
        waitReason: why,
        diagnostics: {
          p1,
          p2,
          r1,
          r2,
          passedPreBounce: true,
          code: "DIP_RSI_DIVERGENCE",
        },
        reasonTrace,
      };
    }
    if (bearishDiv && (closeAboveYHigh || bounceStrengthATR >= 1.05)) {
      reasonTrace.push(
        "bearish RSI divergence (soft-pass via reclaim/strength)"
      );
    }
  }

  // --- Pre-entry headroom (diagnostic only) ---
  function clusterLevels(levels, atrVal, thMul = 0.3) {
    const th = thMul * atrVal;
    const uniq = Array.from(
      new Set(levels.map((v) => +Number(v).toFixed(2)))
    ).sort((a, b) => a - b);
    const out = [];
    let bucket = [];
    for (let i = 0; i < uniq.length; i++) {
      if (!bucket.length || Math.abs(uniq[i] - bucket[bucket.length - 1]) <= th)
        bucket.push(uniq[i]);
      else {
        out.push(avg(bucket));
        bucket = [uniq[i]];
      }
    }
    if (bucket.length) out.push(avg(bucket));
    return out;
  }
  const rawResEarly = findResistancesAbove(data, px, stock);
  const resListEarly = clusterLevels(rawResEarly, atr, 0.3);
  const nearestResEarly = resListEarly.length ? resListEarly[0] : null;
  let headroomATR = null,
    headroomPct = null;
  if (nearestResEarly) {
    headroomATR = (nearestResEarly - px) / Math.max(atr, 1e-9);
    headroomPct = ((nearestResEarly - px) / Math.max(px, 1e-9)) * 100;
  }

  // --- Recovery cap (regime-aware, with headroom override) ---
  const spanRaw = recentHigh - dipLow;
  const span = Math.max(spanRaw, Math.max(0.7 * atr, px * 0.003));
  const recoveryPct = span > 0 ? ((px - dipLow) / span) * 100 : 0;
  const recoveryPctCapped = Math.min(recoveryPct, 200);

  const strongUpLike =
    (ma25 > ma50 && ma50 > ma200) || (ma20 > ma25 && ma25 > ma50);
  const upLike = (ma25 >= ma50 && ma50 >= 0) || ma20 >= ma25;

  let maxRec = cfg.dipMaxRecoveryPct;
  if (strongUpLike)
    maxRec = Math.max(maxRec, cfg.dipMaxRecoveryStrongUp || 185);
  else if (upLike) maxRec = Math.max(maxRec, 160);
  else maxRec = Math.max(maxRec, 140);

  // Soft-pass if over-recovered *but* still decent headroom and strength
  if (recoveryPctCapped > maxRec) {
    if (headroomATR != null && headroomATR >= 1.2 && bounceStrengthATR >= 1.0) {
      reasonTrace.push(
        `over-recovery soft-pass (headroom ${headroomATR.toFixed(2)} ATR)`
      );
    } else {
      const why = `already recovered ${recoveryPctCapped.toFixed(
        0
      )}% > ${maxRec}%`;
      reasonTrace.push(why);
      return {
        trigger: false,
        waitReason: why,
        diagnostics: {
          recoveryPct: recoveryPctCapped,
          px,
          dipLow,
          recentHigh,
          passedPreBounce: true,
          code: "DIP_OVERRECOVERED",
        },
        reasonTrace,
      };
    }
  }

  // --- Higher low (looser) & volume acceptance ---
  const prevLow = Math.min(...data.slice(-15, -5).map((d) => num(d.low)));
  const higherLow = dipLow >= prevLow * 0.988 || dipLow >= prevLow - 0.5 * atr;
  const higherLowOK = higherLow || strongBounceOverride || closeAboveYHigh;

  const volumeRegimeOK =
    dryPullback || bounceVolHot || closeAboveYHigh || bounceStrengthATR >= 0.85;
  if (!volumeRegimeOK) {
    const why = "volume regime weak (need dry pullback or hot/strong bounce)";
    reasonTrace.push(why);
    return {
      trigger: false,
      waitReason: why,
      diagnostics: {
        dryPullback,
        bounceVolHot,
        bounceStrengthATR,
        passedPreBounce: true,
        code: "DIP_VOL_WEAK",
      },
      reasonTrace,
    };
  }

  // ---- Slope combo veto (after bounce/volume with override) ----
  if (
    slopeComboFlag &&
    !(closeAboveYHigh || (bounceStrengthATR >= 1.05 && v20ok))
  ) {
    const why = "MA20 & MA25 both rolling down with price below MA20";
    reasonTrace.push(why);
    return {
      trigger: false,
      waitReason: why,
      diagnostics: {
        ma20,
        ma25,
        passedPreBounce: true,
        code: "DIP_SLOPE_VETO",
      },
      reasonTrace,
    };
  }

  // --- Final trigger (allow fib OR fibAlt) ---
  const trigger =
    hadPullback &&
    (fibOK || fibAltOK) &&
    nearSupport &&
    bounceOK &&
    higherLowOK;

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
        higherLow: higherLow,
        higherLowOK,
        lowBarIndex,
        recoveryPct: recoveryPctCapped,
        passedPreBounce: true,
        code: "DIP_CONDS_INCOMPLETE",
      },
      reasonTrace,
    };
  }

  // --- Targets & stops (smarter structure-aware; improved RR) ---
  const rawRes = findResistancesAbove(data, px, stock);
  const resList = clusterLevels(rawRes, atr, 0.3);
  const nearestRes = resList.length ? resList[0] : null;
  const recentHigh20 = Math.max(...data.slice(-20).map((d) => num(d.high)));

  const recent = data.slice(-14);
  let swingLowNear = dipLow;
  for (let i = 2; i < recent.length - 2; i++) {
    const L = num(recent[i].low);
    const isPivotLow =
      L <= dipLow * 1.01 &&
      L < num(recent[i - 1].low) &&
      L < num(recent[i + 1].low);
    if (isPivotLow) swingLowNear = Math.min(swingLowNear, L);
  }

  // Tighter default stop to help RR; still sane
  let stop = Math.min(
    swingLowNear - 0.35 * atr,
    ma25 > 0 ? ma25 - 0.65 * atr : Infinity
  );
  const minRiskATR = strongBounceOverride ? 1.15 : 1.2;
  if (px - stop < minRiskATR * atr) stop = px - minRiskATR * atr;

  // Grow target; skip too-near first resistance when second is reasonable
  let target = Math.max(px + Math.max(2.8 * atr, px * 0.024), recentHigh20);
  if (nearestRes && nearestRes - px < 1.1 * atr) {
    if (resList.length >= 2) {
      const r1 = resList[1];
      target = Math.max(target, Math.min(r1, px + 3.6 * atr));
    } else {
      // If only one very close res, push beyond by ATR multiple (guard will still check headroom later)
      target = Math.max(target, px + 3.2 * atr);
    }
  } else if (resList.length >= 2) {
    const r0 = resList[0],
      r1 = resList[1];
    if (r0 - px < 0.8 * atr && r1 - px <= 3.8 * atr) {
      target = Math.max(target, Math.min(r1, px + 3.8 * atr));
    }
  }

  const why = `Retrace at MA/structure; quality/strong bounce (${bounceStrengthATR.toFixed(
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
      closeAboveYHigh,
      headroomATR,
      headroomPct,
      nearestResEarly,
      passedPreBounce: true,
      code: "DIP_TRIGGER",
    },
    reasonTrace,
  };
}
