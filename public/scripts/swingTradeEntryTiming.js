// swingTradeEntryTiming.js — flexible + looser + more entries (DIP, RETEST, MA25 RECLAIM, INSIDE, BREAKOUT)
// Returns: { buyNow, reason, stopLoss, priceTarget, timeline?, debug? }
// Usage: analyzeSwingTradeEntry(stock, candles, { debug:true, allowedKinds:["DIP","RETEST","RECLAIM","INSIDE","BREAKOUT"] })

export function analyzeSwingTradeEntry(stock, historicalData, opts = {}) {
  const cfg = getConfig(opts);
  const reasons = [];

  // ---- Validate & prep ----
  if (!Array.isArray(historicalData) || historicalData.length < 25) {
    const r = "Insufficient historical data (need ≥25 bars).";
    return withNo(r, { reasons: [r] });
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
    return withNo(r, { reasons: [r] });
  }

  // Robust context
  const px = num(stock.currentPrice) || num(last.close);
  const openPx = num(stock.openPrice) || num(last.open) || px;
  const prevClose = num(stock.prevClosePrice) || num(last.close) || openPx;
  const dayPct = openPx ? ((px - openPx) / openPx) * 100 : 0;

  const ms = getMarketStructure(stock, data); // { trend, recentHigh, recentLow, ma25, ma50, ma200 }
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

  // Allowed paths (default: all)
  const allow =
    Array.isArray(opts.allowedKinds) && opts.allowedKinds.length
      ? new Set(opts.allowedKinds.map((s) => s.toUpperCase()))
      : new Set(["DIP", "RETEST", "RECLAIM", "INSIDE", "BREAKOUT"]);

  const candidates = [];
  const checks = {};

  // ======================= DIP (pullback + bounce) =======================
  if (allow.has("DIP")) {
    const dip = detectDipBounce(stock, data, cfg);
    checks.dip = dip;
    if (!dip.trigger) reasons.push(`DIP not ready: ${dip.waitReason}`);
    else if (!priceActionGate) reasons.push(`DIP blocked by gate: ${gateWhy}`);
    else {
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

  // ======================= RETEST (breakout retest) =======================
  if (allow.has("RETEST")) {
    const rt = detectRetest(stock, data, cfg);
    checks.retest = rt;
    if (!rt.trigger) reasons.push(`RETEST not ready: ${rt.waitReason}`);
    else if (!priceActionGate)
      reasons.push(`RETEST blocked by gate: ${gateWhy}`);
    else {
      const rr = analyzeRR(px, rt.stop, rt.target, stock, ms, cfg, {
        kind: "RETEST",
        data,
      });
      if (!rr.acceptable) {
        reasons.push(
          `RETEST RR too low: ratio ${rr.ratio.toFixed(
            2
          )} < need ${rr.need.toFixed(2)}.`
        );
      } else {
        const gv = guardVeto(
          stock,
          data,
          px,
          rr,
          ms,
          cfg,
          rt.nearestRes,
          "RETEST"
        );
        if (gv.veto) {
          reasons.push(
            `RETEST guard veto: ${gv.reason} ${summarizeGuardDetails(
              gv.details
            )}.`
          );
        } else {
          candidates.push({
            kind: "RETEST ENTRY",
            why: rt.why,
            stop: rr.stop,
            target: rr.target,
            rr,
            guard: gv.details,
          });
        }
      }
    }
  }

  // ======================= RECLAIM (MA25 reclaim) =======================
  if (allow.has("RECLAIM")) {
    const rc = detectMA25Reclaim(stock, data, cfg);
    checks.reclaim = rc;
    if (!rc.trigger) reasons.push(`RECLAIM not ready: ${rc.waitReason}`);
    else if (!priceActionGate)
      reasons.push(`RECLAIM blocked by gate: ${gateWhy}`);
    else {
      const rr = analyzeRR(px, rc.stop, rc.target, stock, ms, cfg, {
        kind: "RECLAIM",
        data,
      });
      if (!rr.acceptable) {
        reasons.push(
          `RECLAIM RR too low: ratio ${rr.ratio.toFixed(
            2
          )} < need ${rr.need.toFixed(2)}.`
        );
      } else {
        const gv = guardVeto(
          stock,
          data,
          px,
          rr,
          ms,
          cfg,
          rc.nearestRes,
          "RECLAIM"
        );
        if (gv.veto) {
          reasons.push(
            `RECLAIM guard veto: ${gv.reason} ${summarizeGuardDetails(
              gv.details
            )}.`
          );
        } else {
          candidates.push({
            kind: "MA25 RECLAIM",
            why: rc.why,
            stop: rr.stop,
            target: rr.target,
            rr,
            guard: gv.details,
          });
        }
      }
    }
  }

  // ======================= INSIDE (inside-day continuation) =======================
  if (allow.has("INSIDE")) {
    const idc = detectInsideDayContinuation(stock, data, cfg, ms);
    checks.inside = idc;
    if (!idc.trigger) reasons.push(`INSIDE not ready: ${idc.waitReason}`);
    else if (!priceActionGate)
      reasons.push(`INSIDE blocked by gate: ${gateWhy}`);
    else {
      const rr = analyzeRR(px, idc.stop, idc.target, stock, ms, cfg, {
        kind: "INSIDE",
        data,
      });
      if (!rr.acceptable) {
        reasons.push(
          `INSIDE RR too low: ratio ${rr.ratio.toFixed(
            2
          )} < need ${rr.need.toFixed(2)}.`
        );
      } else {
        const gv = guardVeto(
          stock,
          data,
          px,
          rr,
          ms,
          cfg,
          idc.nearestRes,
          "INSIDE"
        );
        if (gv.veto) {
          reasons.push(
            `INSIDE guard veto: ${gv.reason} ${summarizeGuardDetails(
              gv.details
            )}.`
          );
        } else {
          candidates.push({
            kind: "INSIDE CONTINUATION",
            why: idc.why,
            stop: rr.stop,
            target: rr.target,
            rr,
            guard: gv.details,
          });
        }
      }
    }
  }

  // ======================= BREAKOUT (adaptive & slightly looser) =======================
  if (allow.has("BREAKOUT")) {
    const bo = detectBreakoutLegacy(stock, data, cfg);
    checks.breakout = bo;
    if (!bo.trigger) reasons.push(`BREAKOUT not ready: ${bo.waitReason}`);
    else if (!priceActionGate)
      reasons.push(`BREAKOUT blocked by gate: ${gateWhy}`);
    else {
      const rr = analyzeRR(px, bo.stop, bo.target, stock, ms, cfg, {
        kind: "BREAKOUT",
        data,
      });
      if (!rr.acceptable) {
        reasons.push(
          `BREAKOUT RR too low: ratio ${rr.ratio.toFixed(
            2
          )} < need ${rr.need.toFixed(2)}.`
        );
      } else {
        const gv = guardVeto(
          stock,
          data,
          px,
          rr,
          ms,
          cfg,
          bo.nearestRes,
          "BREAKOUT"
        );
        if (gv.veto) {
          reasons.push(
            `BREAKOUT guard veto: ${gv.reason} ${summarizeGuardDetails(
              gv.details
            )}.`
          );
        } else {
          candidates.push({
            kind: "BREAKOUT",
            why: bo.why,
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
    if (ms.trend === "DOWN")
      top.push("Trend is DOWN (signals allowed, but RR/guards may reject).");
    const reason = buildNoReason(top, reasons);
    const debug = opts.debug
      ? {
          ms,
          dayPct,
          priceActionGate,
          reasons,
          checks,
          px,
          openPx,
          prevClose,
          cfg,
        }
      : undefined;
    // No referencing `best` here:
    return withNo(reason, debug);
  }

  // prioritize: DIP > RETEST > RECLAIM > INSIDE > highest RR (BREAKOUT mixed in)
  const priority = (k) =>
    k === "DIP ENTRY"
      ? 5
      : k === "RETEST ENTRY"
      ? 4
      : k === "MA25 RECLAIM"
      ? 3
      : k === "INSIDE CONTINUATION"
      ? 2
      : 1;

  candidates.sort((a, b) => {
    const p = priority(b.kind) - priority(a.kind);
    return p !== 0 ? p : b.rr.ratio - a.rr.ratio;
  });

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

  // Build a swing-trade strategy timeline (R-based milestones + trailing rule)
  const swingTimeline = buildSwingTimeline(px, best, best.rr, ms);

  return {
    buyNow: true,
    reason: `${best.kind}: ${best.why} RR ${best.rr.ratio.toFixed(2)}:1.`,
    stopLoss: best.stop,
    priceTarget: best.target,
    smartStopLoss: best.stop, // expose convenience fields
    smartPriceTarget: best.target, // "
    timeline: swingTimeline,
    debug,
  };
}

/* ============================ Config ============================ */
function getConfig(opts) {
  return {
    // Price-action gate (looser)
    allowSmallRed: true,
    redDayMaxDownPct: -2.5, // was -1.6

    // Guards & thresholds (looser)
    maxATRfromMA25: 2.2, // was 1.8
    maxConsecUp: 6, // was 5
    nearResVetoATR: 0.45, // base; dynamic relax below
    hardRSI: 78, // was 77
    softRSI: 74, // was 72

    // RR thresholds (looser)
    minRRbase: 1.2, // was 1.5
    minRRstrongUp: 1.05, // was 1.2
    minRRweakUp: 1.3, // was 1.6

    // Breakout strictness (looser)
    breakoutMinThroughPct: 0.2, // 0.20% above flat-top
    breakoutMaxGapPct: 4.0, // was 3.5
    breakoutTapsMin: 2, // keep 2 taps min

    // Near-support sizing (looser, volatility-aware)
    hiVolATRpct: 0.02,
    nearSupportATRNormal: 2.6, // was 2.2
    nearSupportATRHigh: 3.2, // was 2.8

    // Bounce volume (looser)
    volBounce20x: 0.85, // was 0.90
    volBounce5x: 0.9, // was 0.95

    // Reclaim / inside-day knobs
    reclaimMA25MinPct: 0.1, // 0.10% reclaim buffer
    insideDayUpperFrac: 0.66, // close in top 1/3 of range

    // —— Breakout relax knobs (new) ——
    breakoutTapBandPct: 1.25, // % band around flat-top to count a "tap"
    breakoutBaseTightPct: 4.0, // if base range <= this %, treat as tight
    breakoutMinThroughPctTight: 0.1, // smaller push-through for tight bases
    breakoutAllowIntradayCloseFrac: 0.998, // allow intraday through + strong close near top
    breakoutAltGapATR: 1.8, // allow bigger % gap if <= this many ATR
    breakoutAllowHotRSIwithVol: true, // relax RSI if volume expands
    breakoutMaxRSIwithVol: 76, // upper RSI cap when volume expands
    breakoutMinVolExpansion: 1.15, // avgVol5 / avgVol20 ≥ this to relax RSI

    debug: !!opts.debug,
  };
}

/* ======================= Market Structure ======================= */
function getMarketStructure(stock, data) {
  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const ma25 = num(stock.movingAverage25d),
    ma50 = num(stock.movingAverage50d),
    ma200 = num(stock.movingAverage200d);

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

  const w = data.slice(-20);
  const recentHigh = Math.max(...w.map((d) => d.high));
  const recentLow = Math.min(...w.map((d) => d.low));
  return { trend, recentHigh, recentLow, ma25, ma50, ma200 };
}

/* ===================== DIP + BOUNCE DETECTOR ===================== */
function detectDipBounce(stock, data, cfg) {
  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const atr = Math.max(num(stock.atr14), px * 0.005);
  const ma5 = num(stock.movingAverage5d);
  const ma25 = num(stock.movingAverage25d),
    ma50 = num(stock.movingAverage50d);

  const last5 = data.slice(-5);
  const d0 = last5.at(-1),
    d1 = last5.at(-2);
  const avgVol20 = avg(data.slice(-20).map((d) => num(d.volume)));
  const avgVol5 = avg(data.slice(-5).map((d) => num(d.volume)));
  const hiVol = atr / Math.max(1, px) > cfg.hiVolATRpct;

  // Near support (MA25/50 OR swing/flip zone), looser distance
  const nearMA =
    (ma25 > 0 &&
      Math.abs(px - ma25) <=
        (hiVol ? cfg.nearSupportATRHigh : cfg.nearSupportATRNormal) * atr) ||
    (ma50 > 0 &&
      Math.abs(px - ma50) <=
        (hiVol ? cfg.nearSupportATRHigh : cfg.nearSupportATRNormal) * atr);
  const nearSwing = nearRecentSupportOrPivot(data, px, atr, { pct: 0.03 }); // widen band to 3%
  const nearSupport = nearMA || nearSwing;

  // Higher low OR small dbl-bottom allowance (1.5%)
  const pivotLow = Math.min(...last5.map((d) => num(d.low)));
  const prevZoneLow = Math.min(...data.slice(-10, -5).map((d) => num(d.low)));
  const higherLow =
    pivotLow >= prevZoneLow * 0.97 ||
    Math.abs(pivotLow - prevZoneLow) / Math.max(1, prevZoneLow) <= 0.015;

  // Bounce confirmation (looser + MA5 reclaim)
  const closeAboveYHigh = num(d0.close) > num(d1.high);
  const hammer = (() => {
    const range = num(d0.high) - num(d0.low);
    const body = Math.abs(num(d0.close) - num(d0.open));
    const lower = Math.min(num(d0.close), num(d0.open)) - num(d0.low);
    return (
      range > 0 &&
      body < 0.6 * range &&
      lower > body * 1.0 &&
      num(d0.close) >= num(d0.open)
    );
  })();
  const engulf =
    num(d1.close) < num(d1.open) &&
    num(d0.close) > num(d0.open) &&
    num(d0.open) <= num(d1.close) &&
    num(d0.close) > num(d1.open);
  const twoBarRev =
    num(d0.close) > num(d1.close) &&
    num(d0.low) > num(d1.low) &&
    num(d0.close) > num(d0.open);
  const ma5Reclaim =
    ma5 > 0 && num(d0.close) > ma5 && num(d0.close) > num(d0.open);

  const bounceOK =
    closeAboveYHigh || hammer || engulf || twoBarRev || ma5Reclaim;

  // Volume (looser)
  const obv = num(stock.obv);
  const volOK =
    num(d0.volume) >= avgVol20 * cfg.volBounce20x ||
    avgVol5 >= avgVol20 * cfg.volBounce5x ||
    obv > 0;

  const trigger = nearSupport && higherLow && bounceOK && volOK;

  // Target/stop (smarter target using resistances list)
  const resList = findResistancesAbove(data, px, stock);
  let target = Math.max(
    px + Math.max(2.4 * atr, px * 0.022),
    Math.max(...data.slice(-20).map((d) => num(d.high)))
  );
  if (resList.length) {
    const head0 = resList[0] - px;
    if (head0 < 0.6 * atr && resList[1]) target = Math.max(target, resList[1]);
  }
  let stop = pivotLow - 0.5 * atr;

  const nearestRes = resList.length ? resList[0] : null;
  const why = `Near support (MA/structure), higher low/dbl-bottom, bounce confirmed (pattern/MA5), volume OK.`;

  const waitReason = trigger
    ? ""
    : !nearSupport
    ? "price not near support (MA25/50 or swing/flip zone)"
    : !higherLow
    ? "no higher low or dbl-bottom yet"
    : !bounceOK
    ? "bounce candle not confirmed"
    : "bounce volume below relaxed threshold";

  return {
    trigger,
    stop,
    target,
    nearestRes,
    why,
    waitReason,
    diagnostics: {
      nearMA,
      nearSwing,
      higherLow,
      closeAboveYHigh,
      hammer,
      engulf,
      twoBarRev,
      ma5Reclaim,
      volOK,
      atr,
    },
  };
}

/* ====================== RETEST (breakout retest) ====================== */
function detectRetest(stock, data, cfg) {
  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const last = data.at(-1);
  const atr = Math.max(num(stock.atr14), px * 0.005);
  const avgVol20 = avg(data.slice(-20).map((d) => num(d.volume)));

  const win = data.slice(-22, -2);
  if (win.length < 10) return { trigger: false, waitReason: "base too short" };
  const pivot = Math.max(...win.map((d) => num(d.high)));

  // Recent breakout within last 7 bars with volume
  const recent = data.slice(-9, -1);
  const hadBreak = recent.some(
    (d) => num(d.close) > pivot * 1.002 && num(d.volume) >= avgVol20 * 1.1
  );

  // Now retesting near pivot and holding/bouncing
  const nearPivot =
    Math.abs(px - pivot) <= 1.3 * atr ||
    Math.abs(px - pivot) / Math.max(1, pivot) <= 0.012;
  const holdAbove = num(last.low) >= pivot - 0.6 * atr;
  const greenish = num(last.close) >= Math.max(num(last.open), pivot);

  const trigger =
    hadBreak &&
    nearPivot &&
    holdAbove &&
    greenish &&
    num(stock.rsi14) < cfg.softRSI;

  if (!trigger) {
    const wr = !hadBreak
      ? "no recent breakout to retest"
      : !nearPivot
      ? "not near prior pivot"
      : !holdAbove
      ? "not holding pivot zone"
      : !greenish
      ? "no bounce yet"
      : "RSI too hot";
    return {
      trigger: false,
      waitReason: wr,
      diagnostics: { pivot, hadBreak, nearPivot, holdAbove, greenish },
    };
  }

  const stop = pivot - 0.65 * atr;
  const resList = findResistancesAbove(data, px, stock);
  const target = resList[0]
    ? Math.max(resList[0], px + 2.3 * atr)
    : px + 2.6 * atr;
  const nearestRes = resList.length ? resList[0] : null;
  const why = `Recent breakout retest at pivot, holding and bouncing with acceptable RSI.`;
  return { trigger, stop, target, nearestRes, why, waitReason: "" };
}

/* ====================== MA25 RECLAIM (trend resume) ====================== */
function detectMA25Reclaim(stock, data, cfg) {
  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const ma25 = num(stock.movingAverage25d);
  if (!(ma25 > 0)) return { trigger: false, waitReason: "MA25 unavailable" };

  const d0 = data.at(-1),
    d1 = data.at(-2);
  const reclaim =
    num(d1.close) < ma25 &&
    num(d0.close) > ma25 * (1 + cfg.reclaimMA25MinPct / 100);
  const rsi = num(stock.rsi14);
  const okRSI = rsi >= 42 && rsi <= cfg.softRSI;
  const avgVol20 = avg(data.slice(-20).map((d) => num(d.volume)));
  const volOK =
    num(d0.volume) >= avgVol20 * 0.95 ||
    avg(data.slice(-5).map((d) => num(d.volume))) >= avgVol20 * 0.95;

  const trigger = reclaim && okRSI && volOK;

  if (!trigger) {
    const wr = !reclaim
      ? "no MA25 reclaim"
      : !okRSI
      ? "RSI not in sweet spot"
      : "volume not supportive";
    return {
      trigger: false,
      waitReason: wr,
      diagnostics: { reclaim, rsi, volOK },
    };
  }

  const atr = Math.max(num(stock.atr14), px * 0.005);
  const stop = ma25 - 0.6 * atr;
  const resList = findResistancesAbove(data, px, stock);
  const target = resList[0]
    ? Math.max(resList[0], px + 2.3 * atr)
    : px + 2.5 * atr;
  const nearestRes = resList.length ? resList[0] : null;
  const why = `MA25 reclaim with healthy RSI and supportive volume.`;
  return { trigger, stop, target, nearestRes, why, waitReason: "" };
}

/* ====================== INSIDE-DAY CONTINUATION ====================== */
function detectInsideDayContinuation(stock, data, cfg, ms) {
  if (data.length < 3) return { trigger: false, waitReason: "not enough bars" };
  const d0 = data.at(-1),
    d1 = data.at(-2);
  const inside = num(d0.high) <= num(d1.high) && num(d0.low) >= num(d1.low);

  const range = Math.max(0.01, num(d0.high) - num(d0.low));
  const posFrac = (num(d0.close) - num(d0.low)) / range; // 0..1
  const upperThird = posFrac >= cfg.insideDayUpperFrac;

  const trendOK = ms.trend === "UP" || ms.trend === "STRONG_UP";
  const rsi = num(stock.rsi14);
  const okRSI = rsi >= 45 && rsi <= cfg.softRSI;

  const trigger = inside && upperThird && trendOK && okRSI;

  if (!trigger) {
    const wr = !inside
      ? "not an inside bar"
      : !upperThird
      ? "close not in upper third"
      : !trendOK
      ? "trend not favorable"
      : "RSI not supportive";
    return {
      trigger: false,
      waitReason: wr,
      diagnostics: { inside, posFrac, trendOK, rsi },
    };
  }

  const px = num(stock.currentPrice) || num(d0.close);
  const atr = Math.max(num(stock.atr14), px * 0.005);
  const stop = num(d0.low) - 0.5 * atr;
  const resList = findResistancesAbove(data, px, stock);
  const target = resList[0]
    ? Math.max(resList[0], px + 2.2 * atr)
    : px + 2.4 * atr;
  const nearestRes = resList.length ? resList[0] : null;
  const why = `Inside bar closing strong in an uptrend with acceptable RSI.`;
  return { trigger, stop, target, nearestRes, why, waitReason: "" };
}

/* =================== BREAKOUT (adaptive & slightly looser) =================== */
function detectBreakoutLegacy(stock, data, cfg) {
  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const d0 = data.at(-1);
  const d1 = data.at(-2);
  const atr = Math.max(num(stock.atr14), px * 0.005);
  const rsi = num(stock.rsi14);

  // Build the flat-top window
  const win = data.slice(-22, -2);
  if (win.length < 10) return { trigger: false, waitReason: "base too short" };

  const highs = win.map((d) => num(d.high));
  const lows = win.map((d) => num(d.low));
  const top = Math.max(...highs);
  const bottom = Math.min(...lows);

  // How tight is the base?
  const baseRangePct = top > 0 ? ((top - bottom) / top) * 100 : 999;
  const isTightBase = baseRangePct <= cfg.breakoutBaseTightPct;

  // Count taps near the flat top using a percent band
  const band = top * (cfg.breakoutTapBandPct / 100); // e.g. 1.25%
  const touches = highs.filter((h) => Math.abs(h - top) <= band).length;

  // Dynamic through requirement
  const minThroughPct = isTightBase
    ? cfg.breakoutMinThroughPctTight
    : cfg.breakoutMinThroughPct;

  const needPx = top * (1 + minThroughPct / 100);

  // Permit: (A) current price through OR (B) intraday pierced & closed very near top
  const intradayPierceAndHold =
    num(d0.high) >= needPx &&
    num(d0.close) >= top * cfg.breakoutAllowIntradayCloseFrac;

  const through = px >= needPx || intradayPierceAndHold;

  // Slightly looser gap rule
  const prevClose = num(d1?.close);
  const gapOK =
    prevClose > 0
      ? ((px - prevClose) / prevClose) * 100 <= cfg.breakoutMaxGapPct ||
        px - prevClose <= cfg.breakoutAltGapATR * atr
      : true;

  // Volume expansion + RSI allowance
  const avgVol20 = avg(data.slice(-20).map((d) => num(d.volume)));
  const avgVol5 = avg(data.slice(-5).map((d) => num(d.volume)));
  const volExp = avgVol20 > 0 ? avgVol5 / avgVol20 : 1.0;

  const notHot =
    rsi < cfg.softRSI ||
    (cfg.breakoutAllowHotRSIwithVol &&
      rsi < cfg.breakoutMaxRSIwithVol &&
      volExp >= cfg.breakoutMinVolExpansion);

  // Tight base exception
  const higherLows3 =
    num(d0.low) > num(d1.low) && num(d1.low) > num(data.at(-3).low);

  const setupOK =
    touches >= cfg.breakoutTapsMin ||
    (isTightBase && touches >= 1 && higherLows3);

  const trigger = setupOK && through && gapOK && notHot;

  if (!trigger) {
    const wr = !setupOK
      ? touches < cfg.breakoutTapsMin
        ? isTightBase
          ? "tight base but not enough taps/higher-lows"
          : "not enough flat-top taps"
        : "setup not confirmed"
      : !through
      ? "not decisively through flat-top"
      : !gapOK
      ? "gap too large vs rules"
      : "RSI too hot without volume expansion";
    return {
      trigger: false,
      waitReason: wr,
      diagnostics: {
        touches,
        top,
        bottom,
        baseRangePct,
        isTightBase,
        minThroughPct,
        through,
        intradayPierceAndHold,
        gapOK,
        rsi,
        volExp,
        atr,
      },
    };
  }

  // Stops/targets
  const stop = top - 0.65 * atr;
  const resList = findResistancesAbove(data, px, stock);
  const target = resList[0]
    ? Math.max(resList[0], px + 2.3 * atr)
    : px + 2.6 * atr;
  const nearestRes = resList.length ? resList[0] : null;

  const why = `Flat-top breakout (taps=${touches}${
    isTightBase ? ", tight base" : ""
  }), through≥${minThroughPct.toFixed(2)}%${
    intradayPierceAndHold ? " (intraday pierce+hold)" : ""
  }${
    volExp >= cfg.breakoutMinVolExpansion
      ? `, volExp~${volExp.toFixed(2)}x`
      : ""
  }${rsi >= cfg.softRSI ? `, RSI ${rsi.toFixed(1)}` : ""}.`;

  return {
    trigger,
    stop,
    target,
    nearestRes,
    why,
    waitReason: "",
    diagnostics: {
      touches,
      top,
      bottom,
      baseRangePct,
      isTightBase,
      minThroughPct,
      through,
      intradayPierceAndHold,
      gapOK,
      rsi,
      volExp,
      atr,
    },
  };
}

/* ======================== Risk / Reward ======================== */
function analyzeRR(entryPx, stop, target, stock, ms, cfg, ctx = {}) {
  const atr = Math.max(num(stock.atr14), entryPx * 0.005);
  const minStopDist = 1.1 * atr;
  if (entryPx - stop < minStopDist) stop = entryPx - minStopDist;

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
  if (ms.trend === "STRONG_UP") need = cfg.minRRstrongUp;
  if (ms.trend === "WEAK_UP") need = cfg.minRRweakUp;

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
function guardVeto(stock, data, px, rr, ms, cfg, nearestRes, kind) {
  const details = {};
  const atr = Math.max(num(stock.atr14), px * 0.005);
  const rsi = num(stock.rsi14);
  const ma25 = num(stock.movingAverage25d);

  details.rsi = rsi;
  if (rsi >= cfg.hardRSI)
    return {
      veto: true,
      reason: `RSI ${rsi.toFixed(1)} ≥ ${cfg.hardRSI}`,
      details,
    };

  let nearResMin = cfg.nearResVetoATR;
  if (ms.trend !== "DOWN" && rsi < 60) nearResMin = Math.min(nearResMin, 0.3);
  if ((kind === "DIP" || kind === "RETEST") && rsi < 58)
    nearResMin = Math.min(nearResMin, 0.25);

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
    const maxDist =
      kind === "DIP" || kind === "RETEST"
        ? cfg.maxATRfromMA25 + 0.3
        : cfg.maxATRfromMA25;
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
/**
 * Builds a swing trade strategy timeline with R-based milestones and a trailing rule.
 * @param {number} entryPx
 * @param {{kind:string, stop:number, target:number}} candidate
 * @param {{atr:number, risk:number}} rr
 * @param {{ma25:number}} ms
 * @returns {Array<{when:string, condition:string, stopLoss?:number, stopLossRule?:string, stopLossHint?:number, priceTarget:number, note:string}>}
 */
function buildSwingTimeline(entryPx, candidate, rr, ms) {
  const steps = [];
  const atr = Number(rr?.atr) || 0;
  const initialStop = Number(candidate.stop);
  const finalTarget = Number(candidate.target);
  const risk = Math.max(0.01, entryPx - initialStop); // R
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
    stopLossRule: "max( last swing low − 0.5*ATR, MA25 − 0.6*ATR )",
    stopLossHint: Math.max(
      ms?.ma25 ? ms.ma25 - 0.6 * atr : initialStop,
      initialStop
    ),
    priceTarget: finalTarget,
    note: "Trail with structure/MA; keep final target unless momentum justifies holding",
  });

  return steps;
}

/* =========================== Utilities =========================== */
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

function nearRecentSupportOrPivot(data, px, atr, cfg2 = { pct: 0.02 }) {
  const win = data.slice(-40);
  const swingLows = [],
    swingHighs = [];
  for (let i = 2; i < win.length - 2; i++) {
    if (
      num(win[i].low) < num(win[i - 1].low) &&
      num(win[i].low) < num(win[i + 1].low)
    )
      swingLows.push(num(win[i].low));
    if (
      num(win[i].high) > num(win[i - 1].high) &&
      num(win[i].high) > num(win[i + 1].high)
    )
      swingHighs.push(num(win[i].high));
  }
  const pivots = swingLows.concat(swingHighs);
  const pctBand = cfg2.pct ?? 0.02;
  return pivots.some(
    (p) =>
      (px >= p && px - p <= 3.2 * atr) ||
      Math.abs(px - p) / Math.max(1, p) <= pctBand
  );
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

function withNo(reason, debug) {
  return {
    buyNow: false,
    reason,
    stopLoss: null,
    priceTarget: null,
    smartStopLoss: null,
    smartPriceTarget: null,
    timeline: [],
    debug,
  };
}
