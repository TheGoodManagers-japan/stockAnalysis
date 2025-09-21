// /scripts/swingTradeEntryTiming.js — MAIN orchestrator (DIP-only, tuned to match upgraded dip.js)
import { detectDipBounce } from "./dip.js";

/* ============================ Telemetry ============================ */
function teleInit() {
  return {
    context: {},
    gates: {
      priceAction: { pass: false, why: "" },
      structure: { pass: false, why: "" },
      stacked: { pass: false, why: "" },
    },
    dip: { trigger: false, waitReason: "", why: "", diagnostics: {} },
    rr: {
      checked: false,
      acceptable: false,
      ratio: NaN,
      need: NaN,
      risk: NaN,
      reward: NaN,
      stop: NaN,
      target: NaN,
      probation: false,
    },
    guard: { checked: false, veto: false, reason: "", details: {} },
    outcome: { buyNow: false, reason: "" },
    reasons: [],
    trace: [], // copies tracer logs when debug is on
  };
}

/* ============================ Tracing Utils ============================ */
function mkTracer(opts = {}) {
  const level = opts.debugLevel || "normal"; // "off" | "normal" | "verbose"
  const logs = [];
  const emit = (e) => {
    logs.push(e);
    try {
      if (typeof opts.onTrace === "function") opts.onTrace(e);
    } catch {}
  };
  const should = (lvl) =>
    level !== "off" && (level === "verbose" || lvl !== "debug");

  const T = (module, step, ok, msg, ctx = {}, lvl = "info") => {
    if (!should(lvl)) return;
    emit({
      ts: Date.now(),
      module,
      step,
      ok: !!ok,
      msg: String(msg || ""),
      ctx,
    });
  };
  T.logs = logs;
  return T;
}

// Public API
export function analyzeSwingTradeEntry(stock, historicalData, opts = {}) {
  const cfg = getConfig(opts);
  const reasons = [];
  const tele = teleInit();
  const T = mkTracer(opts);

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
    const out = withNo(r, {
      reasons: [r],
      pxNow,
      ms: ms0,
      provisional: prov,
      stock,
      data,
    });
    out.telemetry = {
      ...tele,
      context: {
        ticker: stock?.ticker,
        bars: Array.isArray(historicalData) ? historicalData.length : 0,
      },
      outcome: { buyNow: false, reason: r },
      reasons: [r],
      trace: T.logs,
    };
    if (out.debug) out.debug.trace = T.logs;
    return out;
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
    const out = withNo(r, {
      reasons: [r],
      pxNow,
      ms: ms0,
      provisional: prov,
      stock,
      data,
    });
    out.telemetry = {
      ...tele,
      context: { ticker: stock?.ticker, bars: data.length },
      outcome: { buyNow: false, reason: r },
      reasons: [r],
      trace: T.logs,
    };
    if (out.debug) out.debug.trace = T.logs;
    return out;
  }

  // Robust context
  const px = num(stock.currentPrice) || num(last.close);
  const openPx = num(stock.openPrice) || num(last.open) || px;
  const prevClose = num(stock.prevClosePrice) || num(last.close) || openPx;
  const dayPct = openPx ? ((px - openPx) / openPx) * 100 : 0;

  const ms = getMarketStructure(stock, data);

  tele.context = {
    ticker: stock?.ticker,
    px,
    openPx,
    prevClose,
    dayPct,
    trend: ms.trend,
    ma: {
      ma5: ms.ma5,
      ma25: ms.ma25,
      ma50: ms.ma50,
      ma75: ms.ma75,
      ma200: ms.ma200,
    },
    perfectMode: cfg.perfectMode,
  };

  // Regime presets (aligned with upgraded dip.js defaults; do not over-tighten)
  const presets = {
    STRONG_UP: {
      minRRbase: Math.max(cfg.minRRbase, 1.15),
      bounceHotFactor: Math.max(cfg.bounceHotFactor, 1.3),
      nearResVetoATR: Math.min(cfg.nearResVetoATR, 0.18),
    },
    UP: {
      minRRbase: Math.max(cfg.minRRbase, 1.15),
      bounceHotFactor: Math.max(cfg.bounceHotFactor, 1.32),
    },
    WEAK_UP: {
      minRRbase: Math.max(cfg.minRRbase, 1.25),
      bounceHotFactor: Math.max(cfg.bounceHotFactor, 1.35),
      nearResVetoATR: Math.max(cfg.nearResVetoATR, 0.18),
    },
    DOWN: {
      minRRbase: Math.max(cfg.minRRbase, 1.6),
      allowSmallRed: false,
      redDayMaxDownPct: Math.min(cfg.redDayMaxDownPct, -0.2),
    },
  };
  Object.assign(cfg, presets[ms.trend] || {});

  let priceActionGate =
    px > Math.max(openPx, prevClose) ||
    (cfg.allowSmallRed && dayPct >= cfg.redDayMaxDownPct);

  let gateWhy = !priceActionGate
    ? `px ${fmt(px)} ≤ max(open ${fmt(openPx)}, prevClose ${fmt(
        prevClose
      )}) & dayPct ${dayPct.toFixed(2)}% < ${cfg.redDayMaxDownPct}%`
    : "";

  tele.gates.priceAction = { pass: !!priceActionGate, why: gateWhy };

  let structureGateOk =
    !cfg.requireUptrend ||
    ((ms.trend === "UP" ||
      ms.trend === "STRONG_UP" ||
      ms.trend === "WEAK_UP") &&
      px >= (ms.ma5 || 0) * 0.998);

  tele.gates.structure = {
    pass: !!structureGateOk,
    why: structureGateOk ? "" : "trend not up or price < MA5",
  };

  const stackedOk =
    !cfg.perfectMode || !cfg.requireStackedMAs || !!ms.stackedBull;

  tele.gates.stacked = {
    pass: !!stackedOk,
    why: stackedOk ? "" : "MAs not stacked bullishly",
  };

  const candidates = [];
  const checks = {};
  const U = {
    // pass helpers to modules (no circular deps)
    num,
    avg,
    near,
    sma,
    rsiFromData,
    findResistancesAbove,
    findSupportsBelow,
    inferTickFromPrice,
    tracer: T, // allow dip.js to breadcrumb if desired
  };

  // ======================= DIP =======================
  if (!stackedOk) {
    const msg = "DIP blocked (Perfect gate): MAs not stacked bullishly.";
    reasons.push(msg);
  } else {
    // Always evaluate DIP first; we'll soft-pass structure if DIP@support is strong.
    const dip = detectDipBounce(stock, data, cfg, U);
    checks.dip = dip;
    tele.dip = {
      trigger: !!dip.trigger,
      waitReason: dip.waitReason || "",
      why: dip.why || "",
      diagnostics: dip.diagnostics || {},
    };

    if (!dip.trigger) {
      if (!structureGateOk)
        reasons.push("Structure gate: trend not up or price < MA5.");
      reasons.push(`DIP not ready: ${dip.waitReason}`);
    } else {
      // --- Price-Action Gate carve-out for confirmed DIP ---
      if (!priceActionGate) {
        const nearSupport = !!dip?.diagnostics?.nearSupport;
        const bounceATR = Number(dip?.diagnostics?.bounceStrengthATR) || 0;
        const carve =
          (nearSupport && dayPct >= cfg.redDayFlexPct) ||
          bounceATR >= cfg.bounceStrongATR;
        if (carve) {
          priceActionGate = true;
          gateWhy = `override via DIP carve-out (nearSupport=${nearSupport}, bounceATR=${bounceATR.toFixed(
            2
          )}, dayPct=${dayPct.toFixed(2)}%)`;
          tele.gates.priceAction = { pass: true, why: gateWhy };
        }
      }

      if (!priceActionGate) {
        reasons.push(`DIP blocked by gate: ${gateWhy}`);
      } else {
        // Soft-pass structure if the DIP confirmed near MA/structure support
        const nearSupport = !!dip?.diagnostics?.nearSupport;
        const bounceATR = Number(dip?.diagnostics?.bounceStrengthATR) || 0;

        if (!structureGateOk && nearSupport) {
          // allow up to ~1% miss vs MA5 when the bounce is decent
          const softBand = bounceATR >= 0.8 ? 0.99 : 0.994;
          if (px >= (ms.ma5 || 0) * softBand) {
            structureGateOk = true;
            tele.gates.structure = {
              pass: true,
              why:
                bounceATR >= 0.8
                  ? "soft-pass via DIP@support (MA5 within -1.0%, bounce≥0.8 ATR)"
                  : "soft-pass via DIP@support (MA5 within -0.6%)",
            };
          } else {
            tele.gates.structure = {
              pass: false,
              why: "trend not up or price < MA5 (even @support)",
            };
          }
        }

        if (!structureGateOk) {
          reasons.push("Structure gate: trend not up or price < MA5.");
        } else {
          const rr = analyzeRR(px, dip.stop, dip.target, stock, ms, cfg, {
            kind: "DIP",
            data,
          });

          // --- Bounce/Support probation lane (flow-positive, quality-gated) ---
          if (!rr.acceptable) {
            const bounceATR = Number(dip?.diagnostics?.bounceStrengthATR) || 0;
            const rsiHere = Number(stock.rsi14) || rsiFromData(data, 14);
            const withinBand = rr.ratio >= rr.need - 0.3; // wider band
            const bounceGood = bounceATR >= 0.8; // was 1.0
            const regimeOK = ms.trend === "UP" || ms.trend === "STRONG_UP";
            if (
              withinBand &&
              nearSupport &&
              bounceGood &&
              rsiHere < 62 &&
              regimeOK
            ) {
              rr.acceptable = true;
              rr.probation = true;
            }
          }

          tele.rr = {
            checked: true,
            acceptable: !!rr.acceptable,
            ratio: rr.ratio,
            need: rr.need,
            risk: rr.risk,
            reward: rr.reward,
            stop: rr.stop,
            target: rr.target,
            probation: !!rr.probation,
          };

          if (!rr.acceptable) {
            reasons.push(
              `DIP RR too low: ratio ${rr.ratio.toFixed(
                2
              )} < need ${rr.need.toFixed(2)} (risk ${fmt(
                rr.risk
              )}, reward ${fmt(rr.reward)}).`
            );
          } else {
            if (rr.probation) {
              reasons.push(
                `RR probation pass: ${rr.ratio.toFixed(
                  2
                )} vs need ${rr.need.toFixed(2)} (support+bounce lane).`
              );
            }

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
            tele.guard = {
              checked: true,
              veto: !!gv.veto,
              reason: gv.reason || "",
              details: gv.details || {},
            };

            if (gv.veto) {
              reasons.push(
                `DIP guard veto: ${gv.reason} ${summarizeGuardDetails(
                  gv.details
                )}.`
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
    tele.outcome = { buyNow: false, reason };
    tele.reasons = reasons.slice();

    // Provisional plan even when not buyable
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
      ? Math.max(resList[0], pxNow + 2.2 * atr)
      : pxNow + 2.4 * atr;

    const rr0 = analyzeRR(
      pxNow,
      provisionalStop,
      provisionalTarget,
      stock,
      ms,
      cfg,
      { kind: "FALLBACK", data }
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
          trace: T.logs,
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
      telemetry: { ...tele, trace: T.logs },
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
        trace: T.logs,
      }
    : undefined;

  const swingTimeline = buildSwingTimeline(px, best, best.rr, ms);

  tele.outcome = {
    buyNow: true,
    reason: `${best.kind}: ${best.rr ? best.rr.ratio.toFixed(2) : "?"}:1. ${
      best.why
    }`,
  };
  tele.reasons = reasons.slice();

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
    telemetry: { ...tele, trace: T.logs },
  };
}

/* ============================ Config (DIP only) ============================ */
function getConfig(opts = {}) {
  const debug = !!opts.debug;
  return {
    // general
    perfectMode: false,
    requireStackedMAs: false,
    requireUptrend: true,
    allowSmallRed: true,
    redDayMaxDownPct: -0.6,
    redDayFlexPct: -1.2, // softer threshold if DIP@support
    bounceStrongATR: 1.0, // strong bounce qualifies for price-action carve-out

    // loosen distance/overbought and streak checks
    maxATRfromMA25: 3.5, // was 3.0
    maxConsecUp: 12, // was 9
    hardRSI: 80, // was 78
    softRSI: 74, // was 72

    // headroom veto (friendlier) — handled in guard only
    nearResVetoATR: 0.14, // was 0.18
    nearResVetoPct: 0.35, // was 0.5

    // RR thresholds (easier)
    minRRbase: 1.05, // was 1.1
    minRRstrongUp: 1.15, // was 1.2
    minRRweakUp: 1.25, // was 1.3

    // pullback / bounce (slightly easier)
    dipMinPullbackPct: 0.7, // unchanged (from earlier loosen)
    dipMinPullbackATR: 0.3, // was 0.35
    dipMaxBounceAgeBars: 8,
    dipMaSupportPctBand: 12, // was 9.0 → easier “near MA”
    dipStructMinTouches: 1,
    dipStructTolATR: 1.4, // was 1.2
    dipStructTolPct: 4.0, // was 3.5
    dipMinBounceStrengthATR: 0.45, // used as a hint; dip.js enforces its own min window

    // recovery & fib tolerance (orchestrator baseline)
    dipMaxRecoveryPct: 135,
    dipMaxRecoveryStrongUp: 165, // allow deeper recoveries in strong tapes
    fibTolerancePct: 15, // was 12

    // volume regime (easier)
    pullbackDryFactor: 1.5,
    bounceHotFactor: 1.0,

    debug,
  };
}

/* ======================= Market Structure ======================= */
function getMarketStructure(stock, data) {
  const px = num(stock.currentPrice) || num(data.at?.(-1)?.close);

  // compute MAs into a single object to avoid free identifiers
  const m = {
    ma5: num(stock.movingAverage5d) || sma(data, 5),
    ma25: num(stock.movingAverage25d) || sma(data, 25),
    ma50: num(stock.movingAverage50d) || sma(data, 50),
    ma75: num(stock.movingAverage75d) || sma(data, 75),
    ma200: num(stock.movingAverage200d) || sma(data, 200),
  };

  let score = 0;
  if (px > m.ma25 && m.ma25 > 0) score++;
  if (px > m.ma50 && m.ma50 > 0) score++;
  if (m.ma25 > m.ma50 && m.ma50 > 0) score++;
  if (m.ma50 > m.ma200 && m.ma200 > 0) score++;

  const trend =
    score >= 3
      ? "STRONG_UP"
      : score === 2
      ? "UP"
      : score === 1
      ? "WEAK_UP"
      : "DOWN";

  const stackedBull =
    (px > m.ma5 &&
      m.ma5 > m.ma25 &&
      m.ma25 > m.ma50 &&
      m.ma50 > m.ma75 &&
      m.ma75 > m.ma200) ||
    (px > m.ma25 && m.ma25 > m.ma50 && m.ma50 > m.ma75 && m.ma75 > m.ma200);

  const w = data.slice(-20);
  const recentHigh = Math.max(...w.map((d) => d.high ?? -Infinity));
  const recentLow = Math.min(...w.map((d) => d.low ?? Infinity));

  return {
    trend,
    recentHigh,
    recentLow,
    ma5: m.ma5,
    ma25: m.ma25,
    ma50: m.ma50,
    ma75: m.ma75,
    ma200: m.ma200, // callers use ms.ma200
    stackedBull,
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

  // Respect nearby resistances for target extension
  if (ctx && ctx.data) {
    const resList = findResistancesAbove(ctx.data, entryPx, stock);
    if (resList.length) {
      const head0 = resList[0] - entryPx;
      if (head0 < 0.7 * atr && resList[1]) {
        // prefer next resistance when the first lid is too close
        target = Math.max(target, resList[1]);
      }
    }
  }

  const risk = Math.max(0.01, entryPx - stop);
  const reward = Math.max(0, target - entryPx);
  const ratio = reward / risk;

  // Base RR requirement by regime…
  let need = cfg.minRRbase;
  if (ms.trend === "STRONG_UP") need = Math.max(need, cfg.minRRstrongUp);
  if (ms.trend === "WEAK_UP") need = Math.max(need, cfg.minRRweakUp);
  if (cfg.perfectMode) need = Math.max(need, 3.0);

  // Optional: tiny sentiment nudge (only if LT/ST exist on ms)
  if (ms && ms.LT && ms.ST) {
    const key = `${ms.LT}-${ms.ST}`;
    if (["LT1-ST4", "LT3-ST1", "LT3-ST3", "LT7-ST1"].includes(key)) {
      need = Math.max(1.05, need - 0.1);
    }
  }

  // …and volatility-aware tweak (ATR% of price)
  const atrPct = (atr / Math.max(1e-9, entryPx)) * 100;
  if (atrPct <= 1.2) need = Math.max(need - 0.1, 1.05); // tight regime → slightly easier
  if (atrPct >= 3.0) need = Math.max(need, 1.5); // noisy regime → stricter

  const acceptable = ratio >= need;

  // Probation band: let near-miss RR through in friendly regimes with cool RSI
  const rsiHere = Number(stock.rsi14) || rsiFromData(ctx?.data || [], 14);
  const probation =
    !acceptable &&
    ratio >= need - 0.15 &&
    (ms.trend === "STRONG_UP" || ms.trend === "UP") &&
    rsiHere < 62;

  return {
    acceptable: acceptable || probation,
    ratio,
    stop,
    target,
    need,
    atr,
    risk,
    reward,
    probation,
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

  // Headroom: use effective resistance level, with fallback to next lid if the first is too close
  const resList = findResistancesAbove(data, px, stock);
  let effRes = Number.isFinite(nearestRes) ? nearestRes : resList[0];

  let headroom = null;
  let headroomPct = null;

  if (isFiniteN(effRes)) {
    // If the first lid is too close, consider the next one
    if ((effRes - px) / Math.max(atr, 1e-9) < 0.6 && resList[1]) {
      effRes = resList[1];
    }
    headroom = (effRes - px) / Math.max(atr, 1e-9);
    headroomPct = ((effRes - px) / Math.max(px, 1e-9)) * 100;
    details.nearestRes = effRes;
    details.headroomATR = headroom;
    details.headroomPct = headroomPct;
  } else {
    details.nearestRes = null;
  }

  // Eased thresholds in friendly tape or when RR is already solid/near-solid
  let nearResMin = cfg.nearResVetoATR;
  if ((ms.trend !== "DOWN" && rsi < 62) || rr.ratio >= rr.need - 0.05) {
    nearResMin = Math.min(nearResMin, 0.12);
  }

  // Only headroom-veto if RR hasn't cleared the need
  if (
    isFiniteN(headroom) &&
    (headroom < nearResMin || headroomPct < cfg.nearResVetoPct) &&
    rr.ratio < rr.need
  ) {
    return {
      veto: true,
      reason: `Headroom too small (${headroom.toFixed(
        2
      )} ATR / ${headroomPct.toFixed(2)}%)`,
      details,
    };
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
    note: "Move stop to breakeven",
  });
  steps.push({
    when: "+1.2R",
    condition: `price ≥ ${entryPx + 1.2 * risk}`,
    stopLoss: entryPx + 0.3 * risk,
    priceTarget: finalTarget,
    note: "Partial lock before +1.5R",
  });
  steps.push({
    when: "+1.5R",
    condition: `price ≥ ${entryPx + 1.5 * risk}`,
    stopLoss: entryPx + 0.5 * risk,
    priceTarget: finalTarget,
    note: "Stop = entry + 0.5R",
  });
  steps.push({
    when: "+2R",
    condition: `price ≥ ${entryPx + 2 * risk}`,
    stopLoss: entryPx + 1.2 * risk,
    priceTarget: finalTarget,
    note: "Runner: stop = entry + 1.2R",
  });
  steps.push({
    when: "TRAIL",
    condition: "After +2R (or strong momentum)",
    stopLossRule: "max( last swing low - 0.5*ATR, MA25 - 0.6*ATR )",
    stopLossHint: Math.max(
      ms?.ma25 ? ms.ma25 - 0.6 * atr : initialStop,
      initialStop
    ),
    priceTarget: finalTarget,
    note: "Trail via structure/MA; keep final target unless justified",
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

// NEW: cluster close-by resistance levels (reduces micro-lids)
// Used transparently by findResistancesAbove.
function clusterLevels(levels, atrVal, thMul = 0.3) {
  const th = thMul * Math.max(atrVal, 1e-9);
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

  // CLUSTER nearby levels using ATR to avoid overcounting tiny shelves
  const atr = Math.max(num(stock.atr14), px * 0.005, 1e-9);
  return clusterLevels(ups, atr, 0.3);
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

export { getConfig }; // optional export if you want configs elsewhere
