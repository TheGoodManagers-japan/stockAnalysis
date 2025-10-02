// /scripts/dip.js — DIP detector (pullback + bounce) — tuned for better fill rate on TSE
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

  // --- MAs (MA20 as valid support; track slopes for a light veto) ---
  const ma5 = num(stock.movingAverage5d) || sma(data, 5);
  const ma20 = sma(data, 20);
  const ma25 = num(stock.movingAverage25d) || sma(data, 25);
  const ma50 = num(stock.movingAverage50d) || sma(data, 50);
  const ma200 = num(stock.movingAverage200d) || sma(data, 200);

  const ma20Prev = sma(data.slice(0, -1), 20);
  const ma25Prev = sma(data.slice(0, -1), 25);

  // Original "soft" note on MA25
  const ma25SoftUp = ma25Prev > 0 && (ma25 >= ma25Prev * 0.997 || px >= ma25);
  if (!ma25SoftUp) {
    reasonTrace.push("MA25 not rising and price below MA25 (weak base)");
  }

  // Gentle slope flags (we'll allow a strong-bounce override later)
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
      diagnostics: { pullbackPct, pullbackATR, recentHigh, dipLow },
      reasonTrace,
    };
  }

  const depthOK = recentHigh - dipLow >= Math.max(0.5 * atr, px * 0.0025); // was 0.6 ATR / 0.3%
  if (!depthOK) {
    const why = "dip too shallow (<0.5 ATR or <0.25%)";
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
  const fibOK = retracePct >= 50 - tol && retracePct <= 61.8 + tol;

  // --- Bounce freshness ---
  let lowBarIndex = -1;
  const ageWin = Math.min(
    Math.max(cfg.dipMaxBounceAgeBars, 8),
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
      diagnostics: { lowBarIndex, dipLow },
      reasonTrace,
    };
  }

  // --- Support (MA20/25/50 or tested structure) ---
  const band = Math.max(cfg.dipMaSupportPctBand, 9);
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

  const d0 = data.at(-1),
    d1 = data.at(-2);
  const bounceHotX = Math.min(cfg.bounceHotFactor || 1.0, 1.18);
  const bounceVolHot =
    avgVol20 > 0 ? num(d0.volume) >= avgVol20 * bounceHotX : true;

  // --- Bounce confirmation (quality, slightly relaxed) ---
  const bounceStrengthATR = (px - dipLow) / Math.max(atr, 1e-9);


  // "Immature" bounce handling: allow green seed bars to continue to quality checks.
  // This reduces false negatives when the low forms today and the close ≈ low.
  if (bounceStrengthATR <= 0.03) {
    // extremely small reclaim off the low
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
        diagnostics: { bounceStrengthATR },
        reasonTrace,
      };
    }

    // Soft-pass note for trace; still must clear bar/volume quality below.
    reasonTrace.push(
      "immature bounce soft-pass (green seed; proceeding to quality gates)"
    );
  }

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

  // Easier path (old):
  const basicCloseUp =
    (num(d0.close) > num(d0.open) &&
      num(d0.close) >= ma5 &&
      bounceStrengthATR >= Math.max(0.62, minStr)) || // was 0.65
    (num(d0.close) > num(d1.high) && bounceStrengthATR >= 0.8); // was 0.85

  // Bar/volume quality gate (RELAXED a touch)
  const barRange = num(d0.high) - num(d0.low);
  const body = Math.abs(num(d0.close) - num(d0.open));
  const midPrev = (num(d1.high) + num(d1.low)) / 2;

  const rangeQuality = barRange >= 0.55 * atr; // was 0.6 * ATR
  const bodyQuality = body >= 0.28 * barRange; // was 0.30 * range
  const closeQuality =
    num(d0.close) >= Math.max(ma5, midPrev) && num(d0.close) > num(d0.open);
  const v20ok = avgVol20 > 0 ? num(d0.volume) >= 0.95 * avgVol20 : true; // was 1.0

  const patternOK =
    closeAboveYHigh || hammer || engulf || twoBarRev || basicCloseUp;
  const bounceOK =
    patternOK &&
    bodyQuality &&
    rangeQuality &&
    (v20ok || (dryPullback && closeAboveYHigh)) &&
    closeQuality;

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
      },
      reasonTrace,
    };
  }

  // If Fib not OK, allow alt path: strong bounce or very dry pullback + clear Y-high
  const fibAltOK =
    !fibOK &&
    (bounceStrengthATR >= 0.9 ||
      (dryPullback && (closeAboveYHigh || bounceStrengthATR >= 0.85)));

  // --- Optional: very light RSI divergence veto (now soft, with override) ---
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
        diagnostics: { p1, p2, r1, r2 },
        reasonTrace,
      };
    }
    // soft-pass note (no veto) when reclaimed
    if (bearishDiv && (closeAboveYHigh || bounceStrengthATR >= 1.05)) {
      reasonTrace.push(
        "bearish RSI divergence (soft-pass via reclaim/strength)"
      );
    }
  }

  // --- Recovery cap (regime-aware, a touch wider) ---
  const spanRaw = recentHigh - dipLow;
  const span = Math.max(spanRaw, Math.max(0.7 * atr, px * 0.003));
  const recoveryPct = span > 0 ? ((px - dipLow) / span) * 100 : 0;

  const recoveryPctCapped = Math.min(recoveryPct, 200); // telemetry cap

  // Infer simple regime from MAs (no ms needed)
  const strongUpLike =
    (ma25 > ma50 && ma50 > ma200) || (ma20 > ma25 && ma25 > ma50);
  const upLike = (ma25 >= ma50 && ma50 >= 0) || ma20 >= ma25;

  let maxRec = cfg.dipMaxRecoveryPct; // baseline 135
  if (strongUpLike)
    maxRec = Math.max(maxRec, cfg.dipMaxRecoveryStrongUp || 175); // was 165
  else if (upLike) maxRec = Math.max(maxRec, 160); // was 155
  else maxRec = Math.max(maxRec, 140); // was 130

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

  // --- Higher low (looser) & volume acceptance ---
  const prevLow = Math.min(...data.slice(-15, -5).map((d) => num(d.low)));
  const higherLow = dipLow >= prevLow * 0.992 || dipLow >= prevLow - 0.35 * atr;

  const volumeRegimeOK =
    dryPullback || bounceVolHot || closeAboveYHigh || bounceStrengthATR >= 0.85; // allow reclaim as volume substitute
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

  // --- Resistance helpers (cluster nearby levels to avoid micro-lids) ---
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

  // --- Pre-entry headroom check (DIAGNOSTIC ONLY; veto is handled in guard) ---
  const rawResEarly = findResistancesAbove(data, px, stock);
  const resListEarly = clusterLevels(rawResEarly, atr, 0.3);
  const nearestResEarly = resListEarly.length ? resListEarly[0] : null;
  let headroomATR = null,
    headroomPct = null;
  if (nearestResEarly) {
    headroomATR = (nearestResEarly - px) / Math.max(atr, 1e-9);
    headroomPct = ((nearestResEarly - px) / Math.max(px, 1e-9)) * 100;
    // no veto here — guardVeto() decides
  }

  // ---- Slope combo veto (now *after* bounce/volume with override) ----
  if (
    slopeComboFlag &&
    !(closeAboveYHigh || (bounceStrengthATR >= 1.05 && v20ok))
  ) {
    const why = "MA20 & MA25 both rolling down with price below MA20";
    reasonTrace.push(why);
    return {
      trigger: false,
      waitReason: why,
      diagnostics: { ma20, ma25 },
      reasonTrace,
    };
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

  // --- Targets & stops (smarter structure-aware) ---
  const rawRes = findResistancesAbove(data, px, stock);
  const resList = clusterLevels(rawRes, atr, 0.3);
  const nearestRes = resList.length ? resList[0] : null;
  const recentHigh20 = Math.max(...data.slice(-20).map((d) => num(d.high)));

  // Smarter stop: tuck under local swing near dip; fallback under MA25; enforce min ATR distance
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
  let stop = Math.min(
       swingLowNear - 0.35 * atr,
       ma25 > 0 ? ma25 - 0.65 * atr : Infinity
     );
     if (px - stop < 1.4 * atr) stop = px - 1.4 * atr;

  // Target: respect clustered resistances; otherwise ATR/structure hybrid
  let target = Math.max(px + Math.max(2.4 * atr, px * 0.022), recentHigh20);
  if (nearestRes && nearestRes - px < 0.9 * atr) {
    target = Math.min(target, nearestRes);
  } else if (resList.length >= 2) {
    const r0 = resList[0],
      r1 = resList[1];
      if (r0 - px < 0.6 * atr && r1 - px <= 3.4 * atr) {
             target = Math.max(target, Math.min(r1, px + 3.4 * atr));
    }
  }

  const why = `Retrace at MA/structure; quality bounce (${bounceStrengthATR.toFixed(
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
    },
    reasonTrace,
  };
}
