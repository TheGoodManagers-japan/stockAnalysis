// swingTradeEntryTiming.js — DIP-only version
// Returns: { buyNow, reason, stopLoss, priceTarget, smartStopLoss, smartPriceTarget, timeline?, debug? }
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
      stopLoss: round0(prov.stop),
      priceTarget: round0(prov.target),
      smartStopLoss: round0(prov.stop),
      smartPriceTarget: round0(prov.target),
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
      stopLoss: round0(prov.stop),
      priceTarget: round0(prov.target),
      smartStopLoss: round0(prov.stop),
      smartPriceTarget: round0(prov.target),
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

  const ms = getMarketStructure(stock, data); // { trend, recentHigh, recentLow, ma5, ma25, ma50, ma75, ma200, stackedBull }
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

  // Perfect mode: MA stack gate (applies to DIP)
  const stackedOk =
    !cfg.perfectMode || !cfg.requireStackedMAs || !!ms.stackedBull;

  const candidates = [];
  const checks = {};

  // ======================= DIP (pullback + bounce) =======================
  if (!stackedOk) {
    reasons.push("DIP blocked (Perfect gate): MAs not stacked bullishly.");
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
            target: rr.target,
            rr,
            guard: gv.details,
          });
        }
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
      ? Math.max(resList[0], pxNow + 2.3 * atr)
      : pxNow + 2.6 * atr;

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
      reason, // why it's not an entry *now*
      stopLoss: round0(rr0.stop),
      priceTarget: round0(rr0.target),
      smartStopLoss: round0(rr0.stop),
      smartPriceTarget: round0(rr0.target),
      timeline: [],
      debug,
    };
  }

  // === Positive path: only DIP ===
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
    reason: `${best.kind}: ${best.why} RR ${best.rr.ratio.toFixed(2)}:1.`,
    stopLoss: round0(best.stop),
    priceTarget: round0(best.target),
    smartStopLoss: round0(best.stop),
    smartPriceTarget: round0(best.target),
    timeline: swingTimeline,
    debug,
  };
} // ← CLOSES analyzeSwingTradeEntry

/* ============================ Config (DIP-only) ============================ */
function getConfig(opts) {
  return {
    // --- Perfect Setup mode (STRICT) ---
    perfectMode: false, // set to true for only A+ setups
    requireStackedMAs: true, // applies to DIP

    // Price-action gate (looser)
    allowSmallRed: true,
    redDayMaxDownPct: -2.5,

    // Guards & thresholds
    maxATRfromMA25: 2.2,
    maxConsecUp: 6,
    nearResVetoATR: 0.45,
    hardRSI: 78,
    softRSI: 74,

    // RR thresholds (perfectMode overrides to ≥3R)
    minRRbase: 1.2,
    minRRstrongUp: 1.05,
    minRRweakUp: 1.3,

    // —— DIP-specific knobs ——
    dipMinPullbackPct: 2.5,
    dipMinPullbackATR: 1.5,
    dipMaxBounceAgeBars: 3, // low must be within last N bars
    dipMaSupportPctBand: 2.0, // ±% band around MA25/50 counts as support
    dipStructMinTouches: 2, // tested structure touches
    dipStructTolATR: 0.5, // ATR tolerance for structure touch
    dipStructTolPct: 1.0, // OR ±% tolerance for structure touch
    dipMinBounceStrengthATR: 0.5, // bounce from low must be ≥ this (ATR)
    dipMaxRecoveryPct: 60, // if recovered more than this, it's late
    fibTolerancePct: 2, // 50%±tol to 61.8%+tol band for DIP

    // Volume regime: dry pullback + hot bounce
    pullbackDryFactor: 0.9, // pullback/base vol ≤ 0.9× 20d
    bounceHotFactor: 1.2, // bounce vol ≥ 1.2× 20d

    debug: !!opts.debug,
  };
}

/* ======================= Market Structure ======================= */
function getMarketStructure(stock, data) {
  const px = num(stock.currentPrice) || num(data.at?.(-1)?.close);

  // MA fallbacks from data if missing on stock
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
// Enhanced with: real pullback, Fib(50–61.8), support, fresh bounce, dry pullback + hot bounce
function detectDipBounce(stock, data, cfg) {
  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const atr = Math.max(num(stock.atr14), px * 0.005);

  // MAs (fallbacks)
  const ma5 = num(stock.movingAverage5d) || sma(data, 5);
  const ma25 = num(stock.movingAverage25d) || sma(data, 25);
  const ma50 = num(stock.movingAverage50d) || sma(data, 50);

  // 1) Must have a meaningful pullback (lookback 10 bars: high from older 5 vs. low from last 5)
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

  // 1b) Fib retracement 50–61.8% (± tolerance)
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
  const swingRange = Math.max(1e-9, recentHigh - swingLow);
  const retracePct = ((recentHigh - dipLow) / swingRange) * 100;
  const fibLow = 50 - cfg.fibTolerancePct;
  const fibHigh = 61.8 + cfg.fibTolerancePct;
  const fibOK = retracePct >= fibLow && retracePct <= fibHigh;

  // 2) Bounce must be fresh — where did the low occur?
  let lowBarIndex = -1; // 0=last bar, 1=prev bar, ...
  for (let i = 0; i < 5; i++) {
    if (num(recentBars.at(-(i + 1)).low) === dipLow) {
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

  // 3) Support must be meaningful: MA25/50 band OR tested structure
  const nearMA25 =
    ma25 > 0 &&
    dipLow <= ma25 * (1 + cfg.dipMaSupportPctBand / 100) &&
    dipLow >= ma25 * (1 - cfg.dipMaSupportPctBand / 100);
  const nearMA50 =
    ma50 > 0 &&
    dipLow <= ma50 * (1 + cfg.dipMaSupportPctBand / 100) &&
    dipLow >= ma50 * (1 - cfg.dipMaSupportPctBand / 100);

  const structureSupport = (() => {
    const lookback = data.slice(-60, -10); // avoid ultra-recent noise
    const tolAbs = Math.max(
      cfg.dipStructTolATR * atr,
      dipLow * (cfg.dipStructTolPct / 100)
    );
    let touches = 0;
    for (const bar of lookback) {
      if (
        Math.abs(num(bar.low) - dipLow) <= tolAbs ||
        Math.abs(num(bar.high) - dipLow) <= tolAbs
      ) {
        touches++;
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

  // 3b) Volume regime: dry pullback + hot bounce
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

  // 4) Bounce confirmation + minimum strength (≥ X ATR off the low)
  const bounceStrengthATR = (px - dipLow) / Math.max(atr, 1e-9);
  const minStr = cfg.dipMinBounceStrengthATR;

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
    bounceStrengthATR >= minStr;

  const bounceOK = closeAboveYHigh || hammer || engulf || twoBarRev;
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
      },
    };
  }

  // 5) Don't enter if most of the move is already gone
  const recoveryPct =
    recentHigh - dipLow > 0 ? ((px - dipLow) / (recentHigh - dipLow)) * 100 : 0;
  if (recoveryPct > cfg.dipMaxRecoveryPct) {
    return {
      trigger: false,
      waitReason: `already recovered ${recoveryPct.toFixed(0)}%`,
      diagnostics: { recoveryPct, px, dipLow, recentHigh },
    };
  }

  // 6) Higher-low confirmation
  const prevLow = Math.min(...data.slice(-15, -5).map((d) => num(d.low)));
  const higherLow = dipLow > prevLow * 0.99; // small tolerance

  const trigger =
    hadPullback &&
    fibOK &&
    nearSupport &&
    bounceOK &&
    higherLow &&
    dryPullback &&
    bounceVolHot &&
    recoveryPct <= cfg.dipMaxRecoveryPct;

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
        lowBarIndex,
        recoveryPct,
      },
    };
  }

  // Targets & stops
  const resList = findResistancesAbove(data, px, stock);
  let target = Math.max(
    px + Math.max(2.4 * atr, px * 0.022),
    Math.max(...data.slice(-20).map((d) => num(d.high)))
  );
  if (resList.length && resList[0] - px < 0.6 * atr && resList[1]) {
    target = Math.max(target, resList[1]);
  }

  const stop = dipLow - 0.5 * atr;
  const nearestRes = resList.length ? resList[0] : null;
  const why = `Fresh 50–61.8% retrace at support; dry pullback + hot bounce; bounce ${bounceStrengthATR.toFixed(
    1
  )} ATR; recovery ${recoveryPct.toFixed(0)}%.`;

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
      recoveryPct,
      nearSupport,
      dryPullback,
      bounceVolHot,
      atr,
    },
  };
}

/* ======================== Risk / Reward ======================== */
function analyzeRR(entryPx, stop, target, stock, ms, cfg, ctx = {}) {
  const atr = Math.max(num(stock.atr14), entryPx * 0.005, 1e-6);
  const minStopDist = 1.1 * atr;

  // Ensure minimum stop distance
  let adjStop = stop;
  if (entryPx - adjStop < minStopDist) adjStop = entryPx - minStopDist;
  stop = adjStop;

  // Perfect mode: clamp risk to ~3% of price
  if (cfg.perfectMode) {
    const riskPct = ((entryPx - stop) / Math.max(1e-9, entryPx)) * 100;
    if (riskPct > 3) stop = entryPx * (1 - 0.03);
  }

  // If first resistance is very close, jump further for target
  if (ctx && ctx.data) {
    const resList = findResistancesAbove(ctx.data, entryPx, stock);
    if (resList.length) {
      const head0 = resList[0] - entryPx;
      if (head0 < 0.6 * atr && resList[1])
        target = Math.max(target, resList[1]);
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
function guardVeto(
  stock,
  data,
  px,
  rr,
  ms,
  cfg,
  nearestRes,
  _kind /* always "DIP" here */
) {
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

  // Dynamic near-resistance veto — slightly easier if trend up & RSI < 60
  let nearResMin = cfg.nearResVetoATR;
  if (ms.trend !== "DOWN" && rsi < 60) nearResMin = Math.min(nearResMin, 0.25);

  if (nearestRes) {
    const headroom = (nearestRes - px) / atr;
    details.nearestRes = nearestRes;
    details.headroomATR = headroom;
    if (headroom < nearResMin)
      return {
        veto: true,
        reason: `Headroom ${headroom.toFixed(
          2
        )} ATR < ${nearResMin} ATR to resistance`,
        details,
      };
  } else {
    details.nearestRes = null;
  }

  if (ma25 > 0) {
    const distMA25 = (px - ma25) / atr;
    details.ma25 = ma25;
    details.distFromMA25_ATR = distMA25;
    const maxDist = cfg.maxATRfromMA25 + 0.3; // DIP gets a small allowance
    if (distMA25 > maxDist)
      return {
        veto: true,
        reason: `Too far above MA25 (${distMA25.toFixed(2)} ATR > ${maxDist})`,
        details,
      };
  }

  if (
    cfg.perfectMode &&
    details.distFromMA25_ATR != null &&
    details.distFromMA25_ATR > 2.0
  ) {
    return {
      veto: true,
      reason: `Extended > 2 ATR above MA25 (Perfect gate)`,
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
    ? Math.max(resList[0], px + 2.3 * atr)
    : px + 2.6 * atr;

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

function rsiFromData(data, length = 14) {
  const n = data.length;
  if (n < length + 1) return 50; // neutral fallback
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
  ); // nearest first
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
  if (typeof d.distFromMA25_ATR === "number")
    bits.push(`distMA25=${d.distFromMA25_ATR.toFixed(2)} ATR`);
  if (typeof d.consecUp === "number") bits.push(`consecUp=${d.consecUp}`);
  return bits.length ? `(${bits.join(", ")})` : "";
}

/* ============================ Safe withNo (never null)  ============================ */
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
    stopLoss: round0(prov.stop),
    priceTarget: round0(prov.target),
    smartStopLoss: round0(prov.stop),
    smartPriceTarget: round0(prov.target),
    timeline: [],
    debug,
  };
}
