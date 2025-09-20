// swingTradeEntryTiming.js — DIP + (looser) PRE-BREAKOUT
// Returns: { buyNow, reason, stopLoss, priceTarget, smartStopLoss, smartPriceTarget, trigger?, suggestedOrder?, timeline?, debug? }
// Usage: analyzeSwingTradeEntry(stock, candles, { debug:true })

export function analyzeSwingTradeEntry(stock, historicalData, opts = {}) {
  const cfg = getConfig(opts);
  const reasons = [];

  // ---- Validate & prep ----
  if (!Array.isArray(historicalData) || historicalData.length < 25) {
    const r = "Insufficient historical data (need ≥25 bars).";
    const data = Array.isArray(historicalData) ? historicalData : [];
    const pxNow =
      num(stock.currentPrice) ||
      num(data.at?.(-1)?.close) ||
      num(stock.prevClosePrice) ||
      num(stock.openPrice) ||
      1;
    const ms0 = getMarketStructure(stock || {}, data || []);
    const prov = provisionalPlan(stock || {}, data || [], ms0, pxNow, cfg);
    return {
      buyNow: false,
      reason: r,
      stopLoss: deRound(toTick(round0(prov.stop), stock)),
      priceTarget: deRound(toTick(round0(prov.target), stock)),
      smartStopLoss: deRound(toTick(round0(prov.stop), stock)),
      smartPriceTarget: deRound(toTick(round0(prov.target), stock)),
      timeline: [],
      debug: opts.debug
        ? { reasons: [r], pxNow, ms: ms0, provisional: prov }
        : undefined,
    };
  }

  const data = [...historicalData].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );
  const last = data[data.length - 1];
  if (
    !isFiniteN(last.open) ||
    !isFiniteN(last.high) ||
    !isFiniteN(last.low) ||
    !isFiniteN(last.close) ||
    !isFiniteN(last.volume)
  ) {
    const r = "Invalid last bar OHLCV.";
    const pxNow =
      num(stock.currentPrice) ||
      num(stock.prevClosePrice) ||
      num(stock.openPrice) ||
      1;
    const ms0 = getMarketStructure(stock || {}, data || []);
    const prov = provisionalPlan(stock || {}, data || [], ms0, pxNow, cfg);
    return {
      buyNow: false,
      reason: r,
      stopLoss: deRound(toTick(round0(prov.stop), stock)),
      priceTarget: deRound(toTick(round0(prov.target), stock)),
      smartStopLoss: deRound(toTick(round0(prov.stop), stock)),
      smartPriceTarget: deRound(toTick(round0(prov.target), stock)),
      timeline: [],
      debug: opts.debug
        ? { reasons: [r], pxNow, ms: ms0, provisional: prov }
        : undefined,
    };
  }

  // Robust context
  const px = num(stock.currentPrice) || num(last.close);
  const openPx = num(stock.openPrice) || num(last.open) || px;
  const prevClose = num(stock.prevClosePrice) || num(last.close) || openPx;
  const dayPct = openPx ? ((px - openPx) / openPx) * 100 : 0;

  const ms = getMarketStructure(stock, data);

  // Regime presets
  const presets = {
    STRONG_UP: {
      minRRbase: 1.35,
      bounceHotFactor: Math.max(cfg.bounceHotFactor, 1.3),
      nearResVetoATR: Math.min(cfg.nearResVetoATR, 0.25),
    },
    UP: {
      minRRbase: Math.max(cfg.minRRbase, 1.4),
      bounceHotFactor: Math.max(cfg.bounceHotFactor, 1.32),
    },
    WEAK_UP: {
      minRRbase: Math.max(cfg.minRRbase, 1.45),
      bounceHotFactor: Math.max(cfg.bounceHotFactor, 1.35),
      nearResVetoATR: Math.max(cfg.nearResVetoATR, 0.3),
    },
    DOWN: {
      minRRbase: Math.max(cfg.minRRbase, 1.6),
      allowSmallRed: false,
      redDayMaxDownPct: Math.min(cfg.redDayMaxDownPct, -0.2),
    },
  };
  Object.assign(cfg, presets[ms.trend] || {});

  const priceActionGate =
    px > Math.max(openPx, prevClose) ||
    (cfg.allowSmallRed && dayPct >= cfg.redDayMaxDownPct);

  const gateWhy = !priceActionGate
    ? `Price action gate failed: px ${fmt(px)} <= max(open ${fmt(
        openPx
      )}, prevClose ${fmt(prevClose)}) and dayPct ${dayPct.toFixed(2)}% < ${
        cfg.redDayMaxDownPct
      }% threshold.`
    : "";

  // Structure gate — require uptrend & price ≥ MA5 (tolerance)
  const structureGateOk =
    !cfg.requireUptrend ||
    ((ms.trend === "UP" ||
      ms.trend === "STRONG_UP" ||
      ms.trend === "WEAK_UP") &&
      px >= (ms.ma5 || 0) * 0.998);

  // Perfect mode: MA stack gate (applies to DIP)
  const stackedOk =
    !cfg.perfectMode || !cfg.requireStackedMAs || !!ms.stackedBull;

  const candidates = [];
  const checks = {};

  // ======================= DIP (pullback + bounce) =======================
  if (!stackedOk) {
    reasons.push("DIP blocked (Perfect gate): MAs not stacked bullishly.");
  } else if (!structureGateOk) {
    reasons.push("Structure gate: trend not up or price < MA5.");
  } else {
    const dip = detectDipBounce(stock, data, cfg);
    checks.dip = dip;
    if (!dip.trigger) {
      reasons.push(`DIP not ready: ${dip.waitReason}`);
    } else if (!priceActionGate) {
      reasons.push(`DIP blocked by gate: ${gateWhy}`);
    } else {
      const rr = analyzeRR(px, dip.stop, dip.target, stock, ms, cfg, {
        kind: "DIP",
        data,
      });
      if (!rr.acceptable) {
        reasons.push(
          `DIP RR too low: ratio ${rr.ratio.toFixed(
            2
          )} < need ${rr.need.toFixed(2)} (risk ${fmt(rr.risk)}, reward ${fmt(
            rr.reward
          )}).`
        );
      } else {
        const gv = guardVeto(
          stock,
          data,
          px,
          rr,
          ms,
          cfg,
          dip.nearestRes,
          "DIP"
        );
        if (gv.veto) {
          reasons.push(
            `DIP guard veto: ${gv.reason} ${summarizeGuardDetails(gv.details)}.`
          );
        } else {
          candidates.push({
            kind: "DIP ENTRY",
            why: dip.why,
            stop: rr.stop,
            target: rr.target, // softened inside detectDipBounce
            rr,
            guard: gv.details,
          });
        }
      }
    }
  }

  // ======================= PRE-BREAKOUT SETUP (stop-limit plan) =======================
  if (candidates.length === 0) {
    if (ms.trend !== "DOWN") {
      const bo = detectPreBreakoutSetup(stock, data, cfg);
      checks.preBreakout = bo;

      if (bo.ready) {
        const debug = opts.debug
          ? {
              ms,
              dayPct,
              priceActionGate,
              checks,
              px,
              openPx,
              prevClose,
              cfg,
              preBreakout: bo,
            }
          : undefined;

        return {
          buyNow: false,
          reason: `PRE_BREAKOUT SETUP: place stop-limit. ${bo.why}`,
          stopLoss: deRound(toTick(round0(bo.initialStop), stock)),
          priceTarget: deRound(toTick(round0(bo.firstTarget), stock)),
          smartStopLoss: deRound(toTick(round0(bo.initialStop), stock)),
          smartPriceTarget: deRound(toTick(round0(bo.firstTarget), stock)),
          trigger: deRound(toTick(round0(bo.entryTrigger), stock)),
          timeline: [
            {
              when: "ON TRIGGER",
              condition: `price ≥ ${deRound(
                toTick(round0(bo.entryTrigger), stock)
              )}`,
              note: "Place/keep stop-limit pending breakout",
            },
            {
              when: "ON FILL",
              condition: "Order executes (prefer volume surge, strong close)",
              stopLoss: deRound(toTick(round0(bo.initialStop), stock)),
              priceTarget: deRound(toTick(round0(bo.firstTarget), stock)),
              note: "Initial plan applied; if weak follow-through, consider reduce",
            },
            {
              when: "D+1 ~ D+3",
              condition: "Holds (closes) above breakout zone midpoint",
              note: "Follow-through check; if not, reduce/exit",
            },
          ],
          suggestedOrder: {
            type: "BUY_STOP_LIMIT",
            trigger: deRound(toTick(round0(bo.entryTrigger), stock)),
            limit: deRound(toTick(round0(bo.entryLimit), stock)),
            initialStop: deRound(toTick(round0(bo.initialStop), stock)),
            firstTarget: deRound(toTick(round0(bo.firstTarget), stock)),
          },
          debug,
        };
      }
    }
  }

  // ---- Final decision ----
  if (candidates.length === 0) {
    const top = [];
    if (!priceActionGate) top.push(gateWhy);
    if (cfg.perfectMode && !ms.stackedBull)
      top.push(
        "Perfect gate: MAs not stacked (5 > 25 > 50 > 75 > 200) with price above."
      );
    if (ms.trend === "DOWN")
      top.push("Trend is DOWN (signals allowed, but RR/guards may reject).");

    const reason = buildNoReason(top, reasons);

    // Provisional stop/target even when not buyable
    const atr = Math.max(
      num(stock.atr14),
      (num(stock.currentPrice) || num(last.close)) * 0.005,
      1e-6
    );
    const pxNow = num(stock.currentPrice) || num(last.close) || 1;
    const supports = findSupportsBelow(data, pxNow);
    const stopFromSwing = supports[0] != null ? supports[0] - 0.5 * atr : NaN;
    const stopFromMA25 =
      ms.ma25 > 0 && ms.ma25 < pxNow ? ms.ma25 - 0.6 * atr : NaN;

    let provisionalStop = [stopFromSwing, stopFromMA25, pxNow - 1.2 * atr]
      .filter(Number.isFinite)
      .reduce((m, v) => Math.min(m, v), Infinity);
    if (!Number.isFinite(provisionalStop)) provisionalStop = pxNow - 1.2 * atr;

    const resList = findResistancesAbove(data, pxNow, stock);
    let provisionalTarget = resList[0]
      ? Math.max(resList[0], pxNow + 2.2 * atr) // softened fallback
      : pxNow + 2.4 * atr;

    const rr0 = analyzeRR(
      pxNow,
      provisionalStop,
      provisionalTarget,
      stock,
      ms,
      cfg,
      {
        kind: "FALLBACK",
        data,
      }
    );

    const debug = opts.debug
      ? {
          ms,
          dayPct,
          priceActionGate,
          reasons,
          checks,
          px: pxNow,
          openPx,
          prevClose,
          cfg,
          provisional: { atr, supports, resList, rr0 },
        }
      : undefined;

    return {
      buyNow: false,
      reason,
      stopLoss: deRound(toTick(round0(rr0.stop), stock)),
      priceTarget: deRound(toTick(round0(rr0.target), stock)),
      smartStopLoss: deRound(toTick(round0(rr0.stop), stock)),
      smartPriceTarget: deRound(toTick(round0(rr0.target), stock)),
      timeline: [],
      debug,
    };
  }

  // === Positive path: DIP ===
  const best = candidates[0];
  const debug = opts.debug
    ? {
        ms,
        dayPct,
        priceActionGate,
        chosen: best.kind,
        rr: best.rr,
        guard: best.guard,
        checks,
        px,
        openPx,
        prevClose,
        cfg,
      }
    : undefined;

  const swingTimeline = buildSwingTimeline(px, best, best.rr, ms);

  return {
    buyNow: true,
    reason: `${best.kind}: ${best.rr ? best.rr.ratio.toFixed(2) : "?"}:1. ${
      best.why
    }`,
    stopLoss: deRound(toTick(round0(best.stop), stock)),
    priceTarget: deRound(toTick(round0(best.target), stock)),
    smartStopLoss: deRound(toTick(round0(best.stop), stock)),
    smartPriceTarget: deRound(toTick(round0(best.target), stock)),
    timeline: swingTimeline,
    debug,
  };
} // ← CLOSES analyzeSwingTradeEntry

/* ============================ Config ============================ */
function getConfig(opts = {}) {
  const debug = !!opts.debug;
  return {
    // --- DIP config (softened a touch) ---
    perfectMode: false,
    requireStackedMAs: false,
    requireUptrend: true,
    allowSmallRed: true,
    redDayMaxDownPct: -0.6,
    maxATRfromMA25: 3.0,
    maxConsecUp: 9,
    nearResVetoATR: 0.3,
    nearResVetoPct: 0.8,
    hardRSI: 78,
    softRSI: 72,
    minRRbase: 1.25,
    minRRstrongUp: 1.35,
    minRRweakUp: 1.45,
    dipMinPullbackPct: 0.8,
    dipMinPullbackATR: 0.5,
    dipMaxBounceAgeBars: 6,
    dipMaSupportPctBand: 5.0,
    dipStructMinTouches: 2,
    dipStructTolATR: 1.2,
    dipStructTolPct: 2.5,
    dipMinBounceStrengthATR: 0.6,
    dipMaxRecoveryPct: 85,
    fibTolerancePct: 8,
    pullbackDryFactor: 1.3,
    bounceHotFactor: 1.28, // ↓ from 1.35

    // --- Pre-breakout setup (looser, but guarded) ---
    boLookbackBars: 55, // ↑ a bit to find structure
    boNearResATR: 1.4, // ↑ allow slightly farther coil
    boNearResPct: 1.8, // ↑ percent window
    boTightenFactor: 0.8, // ↓ less strict tightening
    boHigherLowsMin: 1, // ↓ allow 1 clear HL
    boMinDryPullback: 1.05, // ↓ tolerate a bit heavier pullback
    boMinRR: 1.35, // ↓ from 1.50
    boSlipTicks: 0.004, // ↑ small extra slip to avoid misses
    boStopUnderLowsATR: 0.6, // ↓ closer stop
    boTargetATR: 2.2, // ↓ slightly easier first target
    boAltTriggerBars: 3, // new: 3-bar high alternative trigger
    boAllowInsideBreak: true, // new: inside-day break qualifies if near res & tight
    debug,
  };
}

/* ======================= Market Structure ======================= */
function getMarketStructure(stock, data) {
  const px = num(stock.currentPrice) || num(data.at?.(-1)?.close);
  const ma5 = num(stock.movingAverage5d) || sma(data, 5);
  const ma25 = num(stock.movingAverage25d) || sma(data, 25);
  const ma50 = num(stock.movingAverage50d) || sma(data, 50);
  const ma75 = num(stock.movingAverage75d) || sma(data, 75);
  const ma200 = num(stock.movingAverage200d) || sma(data, 200);

  let score = 0;
  if (px > ma25 && ma25 > 0) score++;
  if (px > ma50 && ma50 > 0) score++;
  if (ma25 > ma50 && ma50 > 0) score++;
  if (ma50 > ma200 && ma200 > 0) score++;
  const trend =
    score >= 3
      ? "STRONG_UP"
      : score === 2
      ? "UP"
      : score === 1
      ? "WEAK_UP"
      : "DOWN";

  const stackedBull =
    (px > ma5 && ma5 > ma25 && ma25 > ma50 && ma50 > ma75 && ma75 > ma200) ||
    (px > ma25 && ma25 > ma50 && ma50 > ma75 && ma75 > ma200);

  const w = data.slice(-20);
  const recentHigh = Math.max(...w.map((d) => d.high ?? -Infinity));
  const recentLow = Math.min(...w.map((d) => d.low ?? Infinity));
  return {
    trend,
    recentHigh,
    recentLow,
    ma5,
    ma25,
    ma50,
    ma75,
    ma200,
    stackedBull,
  };
}

/* ===================== DIP + BOUNCE DETECTOR ===================== */
function detectDipBounce(stock, data, cfg) {
  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const atr = Math.max(num(stock.atr14), px * 0.005, 1e-9);

  const ma5 = num(stock.movingAverage5d) || sma(data, 5);
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

  // Higher low
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

  // Targets & stops (SOFTENED)
  const resList = findResistancesAbove(data, px, stock);
  const recentHigh20 = Math.max(...data.slice(-20).map((d) => num(d.high)));
  let target = Math.max(px + Math.max(2.2 * atr, px * 0.02), recentHigh20); // 2.2ATR vs 2.4ATR
  const nearestRes = resList.length ? resList[0] : null;

  // If very close resistance, bias target to that resistance (easier to get hit)
  if (nearestRes && nearestRes - px < 0.8 * atr) {
    target = Math.min(target, nearestRes);
  } else if (resList.length && resList[0] - px < 0.6 * atr && resList[1]) {
    // if ultra-close first res, aim for the next one only if it's not too far
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

/* ======================== Risk / Reward ======================== */
function analyzeRR(entryPx, stop, target, stock, ms, cfg, ctx = {}) {
  const atr = Math.max(num(stock.atr14), entryPx * 0.005, 1e-6);
  const minStopDist = 1.25 * atr;
  let adjStop = stop;
  if (entryPx - adjStop < minStopDist) adjStop = entryPx - minStopDist;
  stop = adjStop;

  if (cfg.perfectMode) {
    const riskPct = ((entryPx - stop) / Math.max(1e-9, entryPx)) * 100;
    if (riskPct > 3) stop = entryPx * (1 - 0.03);
  }

  if (ctx && ctx.data) {
    const resList = findResistancesAbove(ctx.data, entryPx, stock);
    if (resList.length) {
      const head0 = resList[0] - entryPx;
      if (head0 < 0.6 * atr && resList[1]) {
        target = Math.max(target, resList[1]);
      }
    }
  }

  const risk = Math.max(0.01, entryPx - stop);
  const reward = Math.max(0, target - entryPx);
  const ratio = reward / risk;

  let need = cfg.minRRbase;
  if (ms.trend === "STRONG_UP") need = Math.max(need, cfg.minRRstrongUp);
  if (ms.trend === "WEAK_UP") need = Math.max(need, cfg.minRRweakUp);
  if (cfg.perfectMode) need = Math.max(need, 3.0);

  return {
    acceptable: ratio >= need,
    ratio,
    stop,
    target,
    need,
    atr,
    risk,
    reward,
  };
}

/* ============================ Guards ============================ */
function guardVeto(stock, data, px, rr, ms, cfg, nearestRes, _kind) {
  const details = {};
  const atr = Math.max(num(stock.atr14), px * 0.005);
  const rsi = num(stock.rsi14) || rsiFromData(data, 14);
  const ma25 = num(stock.movingAverage25d) || sma(data, 25);

  details.rsi = rsi;
  if (rsi >= cfg.hardRSI)
    return {
      veto: true,
      reason: `RSI ${rsi.toFixed(1)} ≥ ${cfg.hardRSI}`,
      details,
    };

  let nearResMin = cfg.nearResVetoATR;
  if (ms.trend !== "DOWN" && rsi < 60) nearResMin = Math.min(nearResMin, 0.25);

  if (nearestRes) {
    const headroom = (nearestRes - px) / atr;
    const headroomPct = ((nearestRes - px) / Math.max(px, 1e-9)) * 100;
    details.nearestRes = nearestRes;
    details.headroomATR = headroom;
    details.headroomPct = headroomPct;
    if (headroom < nearResMin || headroomPct < cfg.nearResVetoPct)
      return {
        veto: true,
        reason: `Headroom too small (${headroom.toFixed(
          2
        )} ATR / ${headroomPct.toFixed(2)}%)`,
        details,
      };
  } else {
    details.nearestRes = null;
  }

  if (ma25 > 0) {
    const distMA25 = (px - ma25) / atr;
    details.ma25 = ma25;
    details.distFromMA25_ATR = distMA25;
    const maxDist = cfg.maxATRfromMA25 + 0.3;
    if (distMA25 > maxDist)
      return {
        veto: true,
        reason: `Too far above MA25 (${distMA25.toFixed(2)} ATR > ${maxDist})`,
        details,
      };
  }

  const ups = countConsecutiveUpDays(data);
  details.consecUp = ups;
  if (ups > cfg.maxConsecUp)
    return {
      veto: true,
      reason: `Consecutive up days ${ups} > ${cfg.maxConsecUp}`,
      details,
    };

  return { veto: false, reason: "", details };
}

/* ============================ Timeline ============================ */
function buildSwingTimeline(entryPx, candidate, rr, ms) {
  const steps = [];
  const atr = Number(rr?.atr) || 0;
  const initialStop = Number(candidate.stop);
  const finalTarget = Number(candidate.target);
  const risk = Math.max(0.01, entryPx - initialStop);
  const kind = candidate.kind || "ENTRY";

  if (!(risk > 0)) {
    steps.push({
      when: "T+0",
      condition: "On fill",
      stopLoss: initialStop,
      priceTarget: finalTarget,
      note: `${kind}: invalid R fallback`,
    });
    return steps;
  }

  steps.push({
    when: "T+0",
    condition: "On fill",
    stopLoss: initialStop,
    priceTarget: finalTarget,
    note: `${kind}: initial plan`,
  });
  steps.push({
    when: "+1R",
    condition: `price ≥ ${entryPx + 1 * risk}`,
    stopLoss: entryPx,
    priceTarget: finalTarget,
    note: "Lock risk: move stop to breakeven",
  });
  steps.push({
    when: "+1.5R",
    condition: `price ≥ ${entryPx + 1.5 * risk}`,
    stopLoss: entryPx + 0.5 * risk,
    priceTarget: finalTarget,
    note: "Protect gains: stop = entry + 0.5R",
  });
  steps.push({
    when: "+2R",
    condition: `price ≥ ${entryPx + 2 * risk}`,
    stopLoss: entryPx + 1.2 * risk,
    priceTarget: finalTarget,
    note: "Convert to runner: stop = entry + 1.2R",
  });
  steps.push({
    when: "TRAIL",
    condition: "After +2R (or if momentum remains strong)",
    stopLossRule: "max( last swing low - 0.5*ATR, MA25 - 0.6*ATR )",
    stopLossHint: Math.max(
      ms?.ma25 ? ms.ma25 - 0.6 * atr : initialStop,
      initialStop
    ),
    priceTarget: finalTarget,
    note: "Trail with structure/MA; keep final target unless momentum justifies holding",
  });

  return steps;
}

/* =========================== Provisional plan =========================== */
function provisionalPlan(stock, data, ms, pxNow, cfg) {
  const px = num(pxNow) || 1;
  const atr = Math.max(num(stock.atr14), px * 0.005, 1e-6);

  const supports = Array.isArray(data) ? findSupportsBelow(data, px) : [];
  const stopFromSwing = Number.isFinite(supports?.[0])
    ? supports[0] - 0.5 * atr
    : NaN;
  const stopFromMA25 =
    ms && ms.ma25 > 0 && ms.ma25 < px ? ms.ma25 - 0.6 * atr : NaN;

  let stop = [stopFromSwing, stopFromMA25, px - 1.2 * atr]
    .filter(Number.isFinite)
    .reduce((m, v) => Math.min(m, v), Infinity);
  if (!Number.isFinite(stop)) stop = px - 1.2 * atr;

  const resList = Array.isArray(data)
    ? findResistancesAbove(data, px, stock)
    : [];
  let target = Number.isFinite(resList?.[0])
    ? Math.max(resList[0], px + 2.2 * atr)
    : px + 2.4 * atr;

  const rr = analyzeRR(
    px,
    stop,
    target,
    stock,
    ms || { trend: "UP" },
    cfg || getConfig({}),
    { kind: "FALLBACK", data }
  );
  return { stop: rr.stop, target: rr.target, rr };
}

/* =========================== Breakout detector =========================== */
function detectPreBreakoutSetup(stock, data, cfg) {
  if (!Array.isArray(data) || data.length < 25) {
    return { ready: false, waitReason: "insufficient data" };
  }
  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const atr = Math.max(num(stock.atr14), px * 0.005, 1e-9);

  // 1) Resistance: real pivot OR synthetic (recent swing high)
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

  // 2) Must be "near" resistance but not through it yet
  const dist = resistance - px;
  const nearByATR = dist / atr <= cfg.boNearResATR;
  const nearByPct =
    (dist / Math.max(resistance, 1e-9)) * 100 <= cfg.boNearResPct;
  if (!(nearByATR || nearByPct) || dist <= 0) {
    return { ready: false, waitReason: "not coiled near resistance" };
  }

  // 3) Tightening volatility (use median as fallback for robustness)
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

  // 4) Structure: allow either ≥1 higher-low OR a flat mini-base
  const lows = data.slice(-12).map((b) => num(b.low));
  let higherLows = 0;
  for (let i = 2; i < lows.length; i++) {
    if (lows[i] > lows[i - 1] && lows[i - 1] > lows[i - 2]) higherLows++;
  }
  const baseWin = data.slice(-10);
  const baseRange =
    (Math.max(...baseWin.map((b) => num(b.high))) -
      Math.min(...baseWin.map((b) => num(b.low)))) /
    Math.max(atr, 1e-9);
  const flatBaseOK = baseWin.length >= 6 && baseRange <= 1.2; // ≤1.2 ATR tight base
  const structureOK = higherLows >= cfg.boHigherLowsMin || flatBaseOK;

  // 5) Volume regime: prefer dry pullback, but allow neutral if very tight
  const avgVol20 = avg(data.slice(-20).map((d) => num(d.volume)));
  const pullbackBars = data
    .slice(-10)
    .filter((b) => num(b.close) < num(b.open));
  const pullbackVol = avg(pullbackBars.map((b) => num(b.volume)));
  const dryPullback =
    pullbackVol <= avgVol20 * cfg.boMinDryPullback ||
    !avgVol20 ||
    (tightening && baseRange <= 1.0);

  // 6) Build plan and RR
  const baseLow = Math.min(...data.slice(-10).map((b) => num(b.low)));
  const initialStop = baseLow - cfg.boStopUnderLowsATR * atr;

  let firstTarget = resList[1];
  if (!Number.isFinite(firstTarget)) firstTarget = px + cfg.boTargetATR * atr;

  // Primary trigger: a hair through resistance
  const trigger = resistance + Math.max(0.02, 0.12 * atr);
  const limit = trigger * (1 + cfg.boSlipTicks);

  // Alternative trigger: 3-bar high / inside-day break when super tight & near res
  let altTrigger = null;
  if (cfg.boAllowInsideBreak && (tightening || baseRange <= 1.0)) {
    const recentHighN = Math.max(
      ...data.slice(-cfg.boAltTriggerBars).map((b) => num(b.high))
    );
    altTrigger = Math.max(trigger, recentHighN + Math.max(0.01, 0.06 * atr));
  }

  const useTrigger = altTrigger ? Math.min(altTrigger, trigger) : trigger;

  const risk = Math.max(0.01, useTrigger - initialStop);
  const reward = Math.max(0, firstTarget - useTrigger);
  const ratio = reward / risk;

  const ready =
    tightening &&
    structureOK &&
    dryPullback &&
    ratio >= Math.max(cfg.boMinRR, 1.25);

  return {
    ready,
    waitReason: ready
      ? ""
      : `tight=${tightening}, struct=${structureOK}, dry=${dryPullback}, RR=${ratio.toFixed(
          2
        )}`,
    entryTrigger: useTrigger,
    entryLimit: useTrigger * (1 + cfg.boSlipTicks),
    initialStop,
    firstTarget,
    nearestRes: resistance,
    why: ready
      ? `Coil near ${resistance.toFixed(
          0
        )} with tightening ranges, higher lows/flat base; RR ${ratio.toFixed(
          2
        )}`
      : "",
    diagnostics: {
      resistance,
      nearByATR,
      nearByPct,
      recentTR,
      avgTR,
      medTR,
      baseTR,
      baseRange,
      higherLows,
      atr,
      ratio,
      altTriggerUsed: !!altTrigger,
    },
  };
}

/* =========================== Utilities =========================== */
function sma(data, n, field = "close") {
  if (!Array.isArray(data) || data.length < n) return 0;
  let s = 0;
  for (let i = data.length - n; i < data.length; i++)
    s += Number(data[i][field]) || 0;
  return s / n;
}

function round0(v) {
  return Math.round(Number(v) || 0);
}

function toTick(v, stock) {
  const tick =
    Number(stock?.tickSize) || inferTickFromPrice(Number(v) || 0) || 0.1;
  const x = Number(v) || 0;
  return Math.round(x / tick) * tick;
}
function inferTickFromPrice(p) {
  if (p >= 5000) return 1;
  if (p >= 1000) return 0.5;
  if (p >= 100) return 0.1;
  if (p >= 10) return 0.05;
  return 0.01;
}
function deRound(v) {
  const s = String(Math.round(v));
  if (/(00|50|25|75)$/.test(s)) return v - 3 * (inferTickFromPrice(v) || 0.1);
  return v;
}

function rsiFromData(data, length = 14) {
  const n = data.length;
  if (n < length + 1) return 50;
  let gains = 0,
    losses = 0;
  for (let i = n - length; i < n; i++) {
    const prev = Number(data[i - 1].close) || 0;
    const curr = Number(data[i].close) || 0;
    const diff = curr - prev;
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / length;
  const avgLoss = losses / length || 1e-9;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function num(v) {
  return Number.isFinite(v) ? v : 0;
}
function isFiniteN(v) {
  return Number.isFinite(v);
}
function avg(arr) {
  return arr.length
    ? arr.reduce((a, b) => a + (Number(b) || 0), 0) / arr.length
    : 0;
}
function fmt(x) {
  return Number.isFinite(x) ? x.toFixed(2) : String(x);
}
function near(a, b, eps = 1e-8) {
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) <= eps;
}

function countConsecutiveUpDays(data, k = 8) {
  let c = 0;
  for (let i = data.length - 1; i > 0 && c < k; i--) {
    if (num(data[i].close) > num(data[i - 1].close)) c++;
    else break;
  }
  return c;
}

function findResistancesAbove(data, px, stock) {
  const ups = [];
  const win = data.slice(-60);
  for (let i = 2; i < win.length - 2; i++) {
    const h = num(win[i].high);
    if (h > px && h > num(win[i - 1].high) && h > num(win[i + 1].high))
      ups.push(h);
  }
  const yHigh = num(stock.fiftyTwoWeekHigh);
  if (yHigh > px) ups.push(yHigh);
  const uniq = Array.from(new Set(ups.map((v) => +v.toFixed(2)))).sort(
    (a, b) => a - b
  );
  return uniq;
}

function findSupportsBelow(data, px) {
  const downs = [];
  const win = data.slice(-60);
  for (let i = 2; i < win.length - 2; i++) {
    const l = num(win[i].low);
    if (l < px && l < num(win[i - 1].low) && l < num(win[i + 1].low))
      downs.push(l);
  }
  const uniq = Array.from(new Set(downs.map((v) => +v.toFixed(2)))).sort(
    (a, b) => b - a
  );
  return uniq;
}

function buildNoReason(top, list) {
  const head = top.filter(Boolean).join(" | ");
  const uniq = Array.from(new Set(list.filter(Boolean)));
  const bullet = uniq
    .slice(0, 8)
    .map((r) => `- ${r}`)
    .join("\n");
  return [head, bullet].filter(Boolean).join("\n");
}

function summarizeGuardDetails(d) {
  if (!d || typeof d !== "object") return "";
  const bits = [];
  if (typeof d.rsi === "number") bits.push(`RSI=${d.rsi.toFixed(1)}`);
  if (typeof d.headroomATR === "number")
    bits.push(`headroom=${d.headroomATR.toFixed(2)} ATR`);
  if (typeof d.headroomPct === "number")
    bits.push(`headroomPct=${d.headroomPct.toFixed(2)}%`);
  if (typeof d.distFromMA25_ATR === "number")
    bits.push(`distMA25=${d.distFromMA25_ATR.toFixed(2)} ATR`);
  if (typeof d.consecUp === "number") bits.push(`consecUp=${d.consecUp}`);
  return bits.length ? `(${bits.join(", ")})` : "";
}

/* ============================ Safe withNo ============================ */
function withNo(reason, ctx = {}) {
  const stock = ctx.stock || {};
  const data = Array.isArray(ctx.data) ? ctx.data : [];
  const cfg = getConfig({});
  const ms = getMarketStructure(stock, data);
  const pxNow =
    num(stock.currentPrice) ||
    num(data.at?.(-1)?.close) ||
    num(stock.prevClosePrice) ||
    num(stock.openPrice) ||
    1;
  const prov = provisionalPlan(stock, data, ms, pxNow, cfg);
  const debug = ctx;
  return {
    buyNow: false,
    reason,
    stopLoss: deRound(toTick(round0(prov.stop), stock)),
    priceTarget: deRound(toTick(round0(prov.target), stock)),
    smartStopLoss: deRound(toTick(round0(prov.stop), stock)),
    smartPriceTarget: deRound(toTick(round0(prov.target), stock)),
    timeline: [],
    debug,
  };
}
