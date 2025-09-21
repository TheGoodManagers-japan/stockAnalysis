// /scripts/dip.js — DIP detector (pullback + bounce) — Volatility-adaptive and cleaner confirmation
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

  // ---------------- Core context ----------------
  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const atr = Math.max(num(stock.atr14), px * 0.005, 1e-9);
  const atrPct = atr / Math.max(px, 1e-9); // as fraction of price
  const volBucket = atrPct <= 0.012 ? "low" : atrPct >= 0.03 ? "high" : "mid";

  const ma5 = num(stock.movingAverage5d) || sma(data, 5);
  const ma20 = sma(data, 20);
  const ma25 = num(stock.movingAverage25d) || sma(data, 25);
  const ma50 = num(stock.movingAverage50d) || sma(data, 50);

  // Soft slope check for MA25
  const ma25Prev = sma(data.slice(0, -1), 25);
  const ma25SoftUp = ma25Prev > 0 && (ma25 >= ma25Prev * 0.997 || px >= ma25);
  if (!ma25SoftUp)
    reasonTrace.push("MA25 not rising and price below MA25 (weak base)");

  // ---------------- Pullback detection (ATR-adaptive) ----------------
  const recentBars = data.slice(-12);
  const recentHigh = Math.max(
    ...recentBars.slice(0, 6).map((d) => num(d.high))
  );
  const dipLow = Math.min(...recentBars.slice(-6).map((d) => num(d.low)));

  const pullbackAbs = Math.max(0, recentHigh - dipLow);
  const pullbackPct = recentHigh > 0 ? (pullbackAbs / recentHigh) * 100 : 0;
  const pullbackATR = pullbackAbs / Math.max(atr, 1e-9);

  // Volatility-adaptive minimums
  const minPBpct =
    volBucket === "low"
      ? Math.min(cfg.dipMinPullbackPct, 0.7)
      : volBucket === "high"
      ? Math.max(cfg.dipMinPullbackPct, 1.0)
      : cfg.dipMinPullbackPct;
  const minPBatr =
    volBucket === "low"
      ? Math.max(cfg.dipMinPullbackATR, 0.35)
      : volBucket === "high"
      ? Math.max(cfg.dipMinPullbackATR, 0.5)
      : cfg.dipMinPullbackATR;

  const hadPullback = pullbackPct >= minPBpct || pullbackATR >= minPBatr;
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

  const depthOK = pullbackAbs >= Math.max(0.55 * atr, px * 0.003);
  if (!depthOK) {
    const why = "dip too shallow (<0.55 ATR or <0.3%)";
    reasonTrace.push(why);
    return {
      trigger: false,
      waitReason: why,
      diagnostics: { recentHigh, dipLow, atr },
      reasonTrace,
    };
  }

  // ---------------- Fib window (with alternative path) ----------------
  function lastSwingLowBeforeHigh(arr) {
    const win = arr.slice(-30, -6);
    let low = Infinity;
    for (let i = 2; i < win.length - 2; i++) {
      const isPivot =
        num(win[i].low) < num(win[i - 1].low) &&
        num(win[i].low) < num(win[i + 1].low);
      if (isPivot) low = Math.min(low, num(win[i].low));
    }
    return Number.isFinite(low)
      ? low
      : Math.min(...arr.slice(-30, -6).map((d) => num(d.low)));
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

  // ---------------- Bounce freshness ----------------
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

  // ---------------- Support proximity (bands adapt by vol) ----------------
  const bandPct = (() => {
    const base = Math.max(cfg.dipMaSupportPctBand, 9);
    return volBucket === "low"
      ? Math.max(7, base - 2)
      : volBucket === "high"
      ? Math.min(12, base + 2)
      : base;
  })();

  const nearMA20 =
    ma20 > 0 &&
    dipLow <= ma20 * (1 + bandPct / 100) &&
    dipLow >= ma20 * (1 - bandPct / 100);
  const nearMA25 =
    ma25 > 0 &&
    dipLow <= ma25 * (1 + bandPct / 100) &&
    dipLow >= ma25 * (1 - bandPct / 100);
  const nearMA50 =
    ma50 > 0 &&
    dipLow <= ma50 * (1 + bandPct / 100) &&
    dipLow >= ma50 * (1 - bandPct / 100);

  const structureSupport = (() => {
    const look = data.slice(-90, -8);
    const tolAbs = Math.max(
      (cfg.dipStructTolATR ?? 1.2) * atr,
      dipLow * ((cfg.dipStructTolPct ?? 3.5) / 100)
    );
    let touches = 0,
      lastIdx = -999;
    for (let i = 2; i < look.length - 2; i++) {
      const L = num(look[i].low);
      const isPivotLow = L < num(look[i - 1].low) && L < num(look[i + 1].low);
      if (isPivotLow && Math.abs(L - dipLow) <= tolAbs && i - lastIdx >= 2) {
        touches++;
        lastIdx = i;
        if (touches >= Math.min(cfg.dipStructMinTouches, 1)) return true;
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

  // ---------------- Volume regime ----------------
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
  const bounceStrengthATR = (px - dipLow) / Math.max(atr, 1e-9);

  // ---------------- Bounce confirmation (cleaner) ----------------
  // Adaptive strength floor
  const minStr = (() => {
    if (volBucket === "low") return Math.max(cfg.dipMinBounceStrengthATR, 0.55);
    if (volBucket === "high") return Math.max(cfg.dipMinBounceStrengthATR, 0.7);
    return Math.max(cfg.dipMinBounceStrengthATR, 0.6);
  })();

  // Signals we accept (prefer reclaim/engulfing with thrust)
  const reclaimMA5 =
    num(d0.close) >= ma5 &&
    num(d0.open) <= ma5 * 1.005 &&
    bounceStrengthATR >= minStr;
  const closeAbovePrevHigh =
    num(d0.close) > num(d1.high) && bounceStrengthATR >= minStr;
  const bullishEngulf =
    num(d1.close) <= num(d1.open) &&
    num(d0.close) > num(d0.open) &&
    num(d0.open) <= num(d1.close) &&
    num(d0.close) >= num(d1.open) &&
    bounceStrengthATR >= minStr;

  const range = Math.max(0, num(d0.high) - num(d0.low));
  const realBody = Math.abs(num(d0.close) - num(d0.open));
  const rangeExpansion = (() => {
    // compare to last 6 bars' avg range
    const r6 = recentBars
      .slice(-7, -1)
      .map((b) => Math.max(0, num(b.high) - num(b.low)));
    const rAvg = avg(r6) || 0;
    return (
      rAvg > 0 &&
      range > rAvg * (volBucket === "high" ? 1.3 : 1.2) &&
      realBody > range * 0.55
    );
  })();

  const volAssist =
    avgVol20 > 0
      ? num(d0.volume) >= avgVol20 * (volBucket === "high" ? 1.05 : 0.95)
      : true;

  const bounceOK =
    (reclaimMA5 || bullishEngulf || closeAbovePrevHigh) &&
    rangeExpansion &&
    volAssist;

  if (!bounceOK) {
    const why = `bounce weak/unclean (str ${bounceStrengthATR.toFixed(
      2
    )} ATR, rangeExp=${rangeExpansion}, volOK=${!!volAssist})`;
    reasonTrace.push(why);
    return {
      trigger: false,
      waitReason: why,
      diagnostics: {
        bounceStrengthATR,
        reclaimMA5,
        bullishEngulf,
        closeAbovePrevHigh,
        rangeExpansion,
        volAssist,
      },
      reasonTrace,
    };
  }

  // Fib alternative path: allow strong thrust or very dry pullback
  const fibAltOK =
    !fibOK &&
    (bounceStrengthATR >= (volBucket === "high" ? 0.95 : 0.9) ||
      (dryPullback && closeAbovePrevHigh));

  // ---------------- Recovery cap ----------------
  const span = Math.max(recentHigh - dipLow, Math.max(0.7 * atr, px * 0.003));
  const recoveryPct = span > 0 ? ((px - dipLow) / span) * 100 : 0;
  const recCap = Math.min(recoveryPct, 135);
  const maxRec = Math.max(cfg.dipMaxRecoveryPct, 115);
  if (recCap > maxRec) {
    const why = `already recovered ${recCap.toFixed(0)}% > ${maxRec}%`;
    reasonTrace.push(why);
    return {
      trigger: false,
      waitReason: why,
      diagnostics: { recoveryPct: recCap, px, dipLow, recentHigh },
      reasonTrace,
    };
  }

  // ---------------- Higher low (lenient but bounded by ATR) ----------------
  const prevLow = Math.min(...data.slice(-18, -6).map((d) => num(d.low)));
  const higherLow = dipLow >= prevLow * 0.992 || dipLow >= prevLow - 0.35 * atr;

  // ---------------- Volume regime must not be hostile ----------------
  const volumeRegimeOK =
    dryPullback ||
    num(d0.volume) >= avgVol20 * 1.0 ||
    bounceStrengthATR >= (volBucket === "high" ? 0.9 : 0.85);
  if (!volumeRegimeOK) {
    const why =
      "volume regime weak (need dry pullback or decent thrust/volume)";
    reasonTrace.push(why);
    return {
      trigger: false,
      waitReason: why,
      diagnostics: { dryPullback, avgVol20, v0: num(d0.volume) },
      reasonTrace,
    };
  }

  // ---------------- Headroom veto (pre-entry), ATR-adaptive ----------------
  const resListEarly = findResistancesAbove(data, px, stock);
  const nearestResEarly = resListEarly.length ? resListEarly[0] : null;
  if (nearestResEarly) {
    const headroomATR = (nearestResEarly - px) / Math.max(atr, 1e-9);
    const headroomPct = ((nearestResEarly - px) / Math.max(px, 1e-9)) * 100;
    const minATR = (() => {
      const base = Math.max(cfg.nearResVetoATR, 0.35);
      return volBucket === "high"
        ? Math.min(0.55, base + 0.1)
        : volBucket === "low"
        ? Math.max(0.3, base - 0.05)
        : base;
    })();
    const minPct = Math.min(Math.max(cfg.nearResVetoPct, 0.9), 1.2);
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

  // ---------------- Post-bounce overextension guard ----------------
  if (ma25 > 0) {
    const distMA25_ATR = (px - ma25) / Math.max(atr, 1e-9);
    const maxOk = volBucket === "high" ? 2.1 : 2.4;
    if (distMA25_ATR > maxOk) {
      const why = `too far above MA25 after bounce (${distMA25_ATR.toFixed(
        2
      )} ATR > ${maxOk})`;
      reasonTrace.push(why);
      return {
        trigger: false,
        waitReason: why,
        diagnostics: { distMA25_ATR, ma25 },
        reasonTrace,
      };
    }
  }

  // ---------------- Final trigger ----------------
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
        recoveryPct: recCap,
      },
      reasonTrace,
    };
  }

  // ---------------- Targets & stops (ATR/cluster aware) ----------------
  const resList = findResistancesAbove(data, px, stock);
  const nearestRes = resList.length ? resList[0] : null;
  const recentHigh20 = Math.max(...data.slice(-20).map((d) => num(d.high)));

  // base target: ATR or recent high
  let target = Math.max(
    px + Math.max(volBucket === "high" ? 2.1 * atr : 1.9 * atr, px * 0.018),
    recentHigh20
  );

  if (nearestRes) {
    // if first lid is tight, try next; otherwise cap to lid
    if (nearestRes - px < 0.8 * atr && resList[1]) {
      target = Math.max(target, resList[1]);
    } else {
      target = Math.min(target, nearestRes);
    }
  }

  const stop = dipLow - (volBucket === "high" ? 0.5 * atr : 0.45 * atr);

  const why = `Retrace near MA/structure; clean bounce (range expansion + thrust); recovery ${recCap.toFixed(
    0
  )}%.`;
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
      recoveryPct: recCap,
      nearSupport,
      dryPullback,
      atr,
      volBucket,
    },
    reasonTrace,
  };
}
