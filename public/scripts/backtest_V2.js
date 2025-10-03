// /scripts/swingTradeEntryTiming.js — STRICT volume-cut variant (DIP-focused)
import { detectDipBounce } from "./dip.js";
import { detectSPC } from "./spc.js";
import { detectOXR } from "./oxr.js";
import { detectBPB } from "./bpb.js";

function teleInit() {
  return {
    context: {},
    gates: {
      priceAction: { pass: false, why: "" },
      structure: { pass: false, why: "" },
      stacked: { pass: false, why: "" },
      regime: { pass: false, why: "" },
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
    trace: [],
  };
}

/* ============================ Tracing ============================ */
function mkTracer(opts = {}) {
  const level = opts.debugLevel || "normal"; // "off"|"normal"|"verbose"
  const logs = [];
  const should = (lvl) =>
    level !== "off" && (level === "verbose" || lvl !== "debug");
  const emit = (e) => {
    logs.push(e);
    try {
      opts.onTrace?.(e);
    } catch {}
  };
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

export function analyzeSwingTradeEntry(stock, historicalData, opts = {}) {
  const cfg = getConfig(opts);
  const reasons = [];
  const tele = teleInit();
  const T = mkTracer(opts);

  if (!Array.isArray(historicalData) || historicalData.length < 25) {
    const r = "Insufficient historical data (need ≥25 bars).";
    const out = withNo(r, { stock, data: historicalData || [] });
    out.telemetry = {
      ...tele,
      outcome: { buyNow: false, reason: r },
      reasons: [r],
      trace: T.logs,
    };
    return out;
  }

  const data = [...historicalData].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );
  const last = data[data.length - 1];
  if (
    ![last?.open, last?.high, last?.low, last?.close, last?.volume].every(
      Number.isFinite
    )
  ) {
    const r = "Invalid last bar OHLCV.";
    const out = withNo(r, { stock, data });
    out.telemetry = {
      ...tele,
      outcome: { buyNow: false, reason: r },
      reasons: [r],
      trace: T.logs,
    };
    return out;
  }

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
      ma20: ms.ma20,
      ma25: ms.ma25,
      ma50: ms.ma50,
      ma75: ms.ma75,
      ma200: ms.ma200,
    },
    perfectMode: cfg.perfectMode,
  };

  // ----- STRICT Regime Pre-Gate -----
  const regimeTrendOk =
    cfg.trendAllow.includes(ms.trend) ||
    (cfg.allowWeakUpForDipOnly && ms.trend === "WEAK_UP");
  const maStackLiteOk = !cfg.requireMaStackLite
    ? true
    : ms.ma20 > ms.ma25 && ms.ma25 > ms.ma50;
  const ma20SlopeOkFlag = ma20SlopeOk(data, cfg.ma20SlopeBars);
  const stackedReqOk = !cfg.requireStackedMAs || !!ms.stackedBull;

  const regimeOK =
    regimeTrendOk && maStackLiteOk && ma20SlopeOkFlag && stackedReqOk;
  tele.gates.regime = {
    pass: regimeOK,
    why: regimeOK
      ? ""
      : [
          !regimeTrendOk ? `trend ${ms.trend} not allowed` : "",
          !maStackLiteOk ? "MA20>MA25>MA50 not satisfied" : "",
          !ma20SlopeOkFlag
            ? `MA20 slope ≤ 0 over ${cfg.ma20SlopeBars} bars`
            : "",
          !stackedReqOk ? "Stacked MAs required" : "",
        ]
          .filter(Boolean)
          .join(" | "),
  };
  if (!regimeOK)
    return withTelemetryNo(
      tele,
      T,
      tele.gates.regime.why || "Regime pre-gate failed",
      stock,
      data
    );

  // Regime presets (still mild, RR floors do the heavy lift)
  const presets = {
    STRONG_UP: {
      minRRbase: Math.max(cfg.minRRbase, 1.5),
      nearResVetoATR: Math.max(cfg.nearResVetoATR, 0.35),
    },
    UP: { minRRbase: Math.max(cfg.minRRbase, 1.35) },
    WEAK_UP: {
      minRRbase: Math.max(cfg.minRRbase, 1.7),
      nearResVetoATR: Math.max(cfg.nearResVetoATR, 0.38),
    },
  };
  Object.assign(cfg, presets[ms.trend] || {});

  // Price-action gate (no soft red-day override by default)
  const priceActionGate = px > Math.max(openPx, prevClose);
  tele.gates.priceAction = {
    pass: !!priceActionGate,
    why: priceActionGate ? "" : "price ≤ max(open, prevClose)",
  };
  if (!priceActionGate) reasons.push("Price-action gate failed.");

  // Structure gate (keep simple)
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

  // Stacked gate shown in regimeOK already; leave as pass=true here for clarity
  tele.gates.stacked = { pass: true, why: "" };

  const candidates = [];
  const checks = {};
  const U = {
    num,
    avg,
    near,
    sma,
    rsiFromData,
    findResistancesAbove,
    findSupportsBelow,
    inferTickFromPrice,
    tracer: T,
  };

  // ======================= DIP (primary lane) =======================
  if (priceActionGate) {
    const dip = detectDipBounce(stock, data, cfg, U);
    checks.dip = dip;
    tele.dip = {
      trigger: !!dip.trigger,
      waitReason: dip.waitReason || "",
      why: dip.why || "",
      diagnostics: dip.diagnostics || {},
    };

    if (dip.trigger && structureGateOk) {
      const rr = analyzeRR(px, dip.stop, dip.target, stock, ms, cfg, {
        kind: "DIP",
        data,
      });
      tele.rr = toTeleRR(rr);

      if (!rr.acceptable) {
        reasons.push(`DIP RR too low: ${fmt(rr.ratio)} < need ${fmt(rr.need)}`);
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
        tele.guard = {
          checked: true,
          veto: !!gv.veto,
          reason: gv.reason || "",
          details: gv.details || {},
        };
        if (gv.veto) reasons.push(`DIP guard veto: ${gv.reason}`);
        else
          candidates.push({
            kind: "DIP ENTRY",
            why: dip.why,
            stop: rr.stop,
            target: rr.target,
            rr,
            guard: gv.details,
          });
      }
    } else {
      reasons.push(
        dip.trigger
          ? "Structure gate failed for DIP."
          : `DIP not ready: ${dip.waitReason}`
      );
    }
  }

  // ======================= SPC / OXR / BPB (default OFF) =======================
  if (cfg.enableSPC && priceActionGate && ms.trend !== "WEAK_UP") {
    const spc = detectSPC(stock, data, cfg, U);
    if (spc.trigger && structureGateOk) {
      const rr = analyzeRR(px, spc.stop, spc.target, stock, ms, cfg, {
        kind: "SPC",
        data,
      });
      if (rr.acceptable) {
        const gv = guardVeto(
          stock,
          data,
          px,
          rr,
          ms,
          cfg,
          spc.nearestRes,
          "SPC"
        );
        if (!gv.veto)
          candidates.push({
            kind: "SPC ENTRY",
            why: spc.why,
            stop: rr.stop,
            target: rr.target,
            rr,
            guard: gv.details,
          });
      }
    }
  }

  if (cfg.enableBPB && priceActionGate && ms.trend !== "WEAK_UP") {
    const bpb = detectBPB(stock, data, cfg, U);
    if (bpb.trigger && structureGateOk) {
      const rr = analyzeRR(px, bpb.stop, bpb.target, stock, ms, cfg, {
        kind: "BPB",
        data,
      });
      if (rr.acceptable) {
        const gv = guardVeto(
          stock,
          data,
          px,
          rr,
          ms,
          cfg,
          bpb.nearestRes,
          "BPB"
        );
        if (!gv.veto)
          candidates.push({
            kind: "BPB ENTRY",
            why: bpb.why,
            stop: rr.stop,
            target: rr.target,
            rr,
            guard: gv.details,
          });
      }
    }
  }

  // OXR left available for advanced users but heaviest filters apply
  if (cfg.enableOXR && priceActionGate && ms.trend !== "WEAK_UP") {
    const oxr = detectOXR(stock, data, cfg, U);
    if (oxr.trigger && structureGateOk) {
      const rr = analyzeRR(px, oxr.stop, oxr.target, stock, ms, cfg, {
        kind: "OXR",
        data,
      });
      if (rr.acceptable && rr.ratio >= (cfg.oxrMinRR ?? 2.2)) {
        const gv = guardVeto(
          stock,
          data,
          px,
          rr,
          ms,
          cfg,
          oxr.nearestRes,
          "OXR"
        );
        if (!gv.veto)
          candidates.push({
            kind: "OXR ENTRY",
            why: oxr.why,
            stop: rr.stop,
            target: rr.target,
            rr,
            guard: gv.details,
          });
      }
    }
  }

  if (candidates.length === 0) {
    const reason = buildNoReason([], reasons);
    tele.outcome = { buyNow: false, reason };
    return {
      buyNow: false,
      reason,
      ...fallbackPlan(stock, data),
      timeline: [],
      telemetry: { ...tele, trace: T.logs },
    };
  }

  // pick highest RR (non-probation preferred; probation usually off anyway)
  candidates.sort(
    (a, b) => (Number(b?.rr?.ratio) || -1e9) - (Number(a?.rr?.ratio) || -1e9)
  );
  const best = candidates[0];
  tele.outcome = {
    buyNow: true,
    reason: `${best.kind}: ${best.rr ? best.rr.ratio.toFixed(2) : "?"}:1. ${
      best.why
    }`,
  };

  return {
    buyNow: true,
    reason: `${best.kind}: ${best.rr ? best.rr.ratio.toFixed(2) : "?"}:1. ${
      best.why
    }`,
    stopLoss: toTick(deRound(round0(best.stop)), stock),
    priceTarget: toTick(deRound(round0(best.target)), stock),
    smartStopLoss: toTick(deRound(round0(best.stop)), stock),
    smartPriceTarget: toTick(deRound(round0(best.target)), stock),
    timeline: buildSwingTimeline(px, best, best.rr, ms),
    telemetry: { ...tele, trace: T.logs },
  };
}

/* ============================ Config ============================ */
function getConfig(opts = {}) {
  const debug = !!opts.debug;
  return {
    // volume levers
    enableSPC: false,
    enableBPB: false,
    enableOXR: false, // set true if you want OXR, but it’s heavily gated
    allowProbation: false, // global probation OFF unless you re-enable

    // general gates
    perfectMode: false,
    requireStackedMAs: true,
    requireMaStackLite: true,
    requireUptrend: true,
    allowSmallRed: false,

    // regime pre-gate
    trendAllow: ["UP", "STRONG_UP"],
    allowWeakUpForDipOnly: true,
    ma20SlopeBars: 8,

    // RR floors (raised)
    minRRbase: 1.35,
    minRRstrongUp: 1.5,
    minRRweakUp: 1.7,

    // headroom & extension (tighter)
    nearResVetoATR: 0.35,
    nearResVetoPct: 0.8,

    // extension vs MA25 (tighter, SPC/BPB will mostly self-filter)
    maxATRfromMA25: 2.4,
    maxATRfromMA25_OXR: 1.8,

    // overbought guards
    hardRSI: 78, // slightly lower to catch the extremes earlier
    softRSI: 72,
    oxrRSI: 70,

    // DIP quality (tighter)
    dipMinPullbackPct: 1.0,
    dipMinPullbackATR: 0.6,
    dipMaxBounceAgeBars: 5,
    dipMaSupportPctBand: 8,
    dipStructMinTouches: 1,
    dipStructTolATR: 1.2,
    dipStructTolPct: 3.2,
    dipMinBounceStrengthATR: 0.8,

    // recovery caps (cut “already recovered” spam)
    dipMaxRecoveryPct: 115,
    fibTolerancePct: 12,

    // volume regime
    pullbackDryFactor: 1.8,
    bounceHotFactor: 1.12,

    // min stop distance (slightly wider)
    minStopATRStrong: 1.15,
    minStopATRUp: 1.2,
    minStopATRWeak: 1.3,
    minStopATRDown: 1.45,

    // OXR-specific
    oxrMinRR: 2.2,
    oxrHeadroomATR: 1.2,

    debug,
  };
}

/* ======================= Market Structure ======================= */
function getMarketStructure(stock, data) {
  const px = num(stock.currentPrice) || num(data.at?.(-1)?.close);
  const m = {
    ma5: num(stock.movingAverage5d) || sma(data, 5),
    ma20: num(stock.movingAverage20d) || sma(data, 20),
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
    ...m,
    stackedBull,
    stackedBullLite: m.ma20 > m.ma25 && m.ma25 > m.ma50,
  };
}

/* ======================== RR ======================== */
function analyzeRR(entryPx, stop, target, stock, ms, cfg, ctx = {}) {
  const atr = Math.max(num(stock.atr14), entryPx * 0.005, 1e-6);

  // regime-aware minimum stop
  let minStopATR = cfg.minStopATRUp || 1.2;
  if (ms.trend === "STRONG_UP") minStopATR = cfg.minStopATRStrong || 1.15;
  else if (ms.trend === "UP") minStopATR = cfg.minStopATRUp || 1.2;
  else if (ms.trend === "WEAK_UP") minStopATR = cfg.minStopATRWeak || 1.3;
  else if (ms.trend === "DOWN") minStopATR = cfg.minStopATRDown || 1.45;

  // avoid unrealistically tight, non-structural stops
  const data = ctx?.data || [];
  const supports = Array.isArray(data) ? findSupportsBelow(data, entryPx) : [];
  const swingTop = Number.isFinite(supports?.[0]) ? supports[0] : NaN;
  const swingBased = Number.isFinite(swingTop)
    ? Math.abs(stop - (swingTop - 0.5 * atr)) <= 0.6 * atr
    : false;
  const ma25 = num(stock.movingAverage25d) || sma(data, 25);
  const ma25Based =
    ma25 > 0 ? Math.abs(stop - (ma25 - 0.6 * atr)) <= 0.6 * atr : false;
  const structuralStop = swingBased || ma25Based;

  const riskNow = entryPx - stop;
  const minStopDist = minStopATR * atr;
  if (!structuralStop && riskNow < minStopDist) stop = entryPx - minStopDist;

  // respect nearby resistances for targets
  if (data.length) {
    const resList = findResistancesAbove(data, entryPx, stock);
    if (resList.length) {
      const head0 = resList[0] - entryPx;
      if (head0 < 0.7 * atr && resList[1])
        target = Math.max(target, resList[1]);
    }
  }

  const risk = Math.max(0.01, entryPx - stop);
  const reward = Math.max(0, target - entryPx);
  const ratio = reward / risk;

  let need = cfg.minRRbase;
  if (ms.trend === "STRONG_UP") need = Math.max(need, cfg.minRRstrongUp);
  if (ms.trend === "WEAK_UP") need = Math.max(need, cfg.minRRweakUp);

  const atrPct = (atr / Math.max(1e-9, entryPx)) * 100;
  if (atrPct <= 1.0) need = Math.max(need - 0.1, 1.25);
  if (atrPct >= 3.0) need = Math.max(need, 1.6);

  let acceptable = ratio >= need;

  // global probation gate (OFF by default, or very tight if enabled)
  const allowProb = !!cfg.allowProbation;
  const rsiHere = Number(stock.rsi14) || rsiFromData(data, 14);
  const probation =
    allowProb &&
    !acceptable &&
    ratio >= need - 0.02 &&
    (ms.trend === "STRONG_UP" || ms.trend === "UP") &&
    rsiHere < 58;
  acceptable = acceptable || probation;

  return {
    acceptable,
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
  const atr = Math.max(num(stock.atr14), px * 0.005, 1e-6);

  // RSI caps
  const rsi = num(stock.rsi14) || rsiFromData(data, 14);
  details.rsi = rsi;
  if (_kind === "OXR" && rsi >= (cfg.oxrRSI ?? cfg.softRSI)) {
    return {
      veto: true,
      reason: `RSI ${rsi.toFixed(1)} ≥ ${cfg.oxrRSI ?? cfg.softRSI}`,
      details,
    };
  }
  if (rsi >= cfg.hardRSI)
    return {
      veto: true,
      reason: `RSI ${rsi.toFixed(1)} ≥ ${cfg.hardRSI}`,
      details,
    };

  // headroom
  const resList = findResistancesAbove(data, px, stock);
  let effRes = Number.isFinite(nearestRes) ? nearestRes : resList[0];
  if (isFiniteN(effRes) && (effRes - px) / atr < 0.6 && resList[1])
    effRes = resList[1];

  if (isFiniteN(effRes)) {
    const headroomATR = (effRes - px) / atr;
    const headroomPct = ((effRes - px) / Math.max(px, 1e-9)) * 100;
    details.nearestRes = effRes;
    details.headroomATR = headroomATR;
    details.headroomPct = headroomPct;

    // always enforce headroom when RR hasn't already cleared
    if (
      (headroomATR < (cfg.nearResVetoATR ?? 0.35) ||
        headroomPct < (cfg.nearResVetoPct ?? 0.8)) &&
      rr.ratio < rr.need
    ) {
      return {
        veto: true,
        reason: `Headroom too small (${headroomATR.toFixed(
          2
        )} ATR / ${headroomPct.toFixed(2)}%)`,
        details,
      };
    }
  }

  // distance above MA25
  const ma25 = num(stock.movingAverage25d) || sma(data, 25);
  if (ma25 > 0) {
    const distMA25 = (px - ma25) / atr;
    details.ma25 = ma25;
    details.distFromMA25_ATR = distMA25;
    const cap =
      _kind === "OXR"
        ? cfg.maxATRfromMA25_OXR ?? cfg.maxATRfromMA25
        : cfg.maxATRfromMA25;
    if (distMA25 > (cap ?? 2.4) + 0.2) {
      return {
        veto: true,
        reason: `Too far above MA25 (${distMA25.toFixed(2)} ATR)`,
        details,
      };
    }
  }

  // streak guard
  const ups = countConsecutiveUpDays(data);
  details.consecUp = ups;
  if (ups > 8)
    return { veto: true, reason: `Consecutive up days ${ups} > 8`, details };

  return { veto: false, reason: "", details };
}

/* ============================ Helpers & Fallback ============================ */
function buildSwingTimeline(entryPx, candidate, rr, ms) {
  const steps = [];
  const atr = Number(rr?.atr) || 0;
  const initialStop = Number(candidate.stop);
  const finalTarget = Number(candidate.target);
  const risk = Math.max(0.01, entryPx - initialStop);
  const kind = candidate.kind || "ENTRY";

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
    when: "+1.5R",
    condition: `price ≥ ${entryPx + 1.5 * risk}`,
    stopLoss: entryPx + 0.6 * risk,
    priceTarget: finalTarget,
    note: "Lock 0.6R",
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
    condition: "After +2R",
    stopLossRule: "max( swing low - 0.5*ATR, MA25 - 0.6*ATR )",
    stopLossHint: Math.max(
      ms?.ma25 ? ms.ma25 - 0.6 * atr : initialStop,
      initialStop
    ),
    priceTarget: finalTarget,
    note: "Trail by structure/MA",
  });
  return steps;
}

function fallbackPlan(stock, data) {
  const cfg = getConfig({});
  const ms = getMarketStructure(stock, data);
  const pxNow = num(stock.currentPrice) || num(data.at?.(-1)?.close) || 1;
  const prov = provisionalPlan(stock, data, ms, pxNow, cfg);
  return {
    stopLoss: deRound(toTick(round0(prov.stop), stock)),
    priceTarget: deRound(toTick(round0(prov.target), stock)),
    smartStopLoss: deRound(toTick(round0(prov.stop), stock)),
    smartPriceTarget: deRound(toTick(round0(prov.target), stock)),
  };
}

function provisionalPlan(stock, data, ms, pxNow, cfg) {
  const px = num(pxNow) || 1;
  const atr = Math.max(num(stock.atr14), px * 0.005, 1e-6);
  const supports = findSupportsBelow(data, px);
  const stopFromSwing = Number.isFinite(supports?.[0])
    ? supports[0] - 0.5 * atr
    : NaN;
  const stopFromMA25 =
    ms && ms.ma25 > 0 && ms.ma25 < px ? ms.ma25 - 0.6 * atr : NaN;
  let stop = [stopFromSwing, stopFromMA25, px - 1.2 * atr]
    .filter(Number.isFinite)
    .reduce((m, v) => Math.min(m, v), Infinity);
  if (!Number.isFinite(stop)) stop = px - 1.2 * atr;
  const resList = findResistancesAbove(data, px, stock);
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

/* =========================== Utils =========================== */
function sma(data, n, field = "close") {
  if (!Array.isArray(data) || data.length < n) return 0;
  let s = 0;
  for (let i = data.length - n; i < data.length; i++) s += +data[i][field] || 0;
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
function ma20SlopeOk(data, bars = 5) {
  if (!Array.isArray(data) || data.length < 20 + bars) return false;
  const now = sma(data, 20);
  const prev = sma(data.slice(0, -bars), 20);
  return Number.isFinite(now) && Number.isFinite(prev) && now - prev > 0;
}
function rsiFromData(data, len = 14) {
  const n = data.length;
  if (n < len + 1) return 50;
  let gains = 0,
    losses = 0;
  for (let i = n - len; i < n; i++) {
    const prev = +data[i - 1].close || 0;
    const curr = +data[i].close || 0;
    const d = curr - prev;
    if (d > 0) gains += d;
    else losses -= d;
  }
  const ag = gains / len,
    al = losses / len || 1e-9;
  const rs = ag / al;
  return 100 - 100 / (1 + rs);
}
function num(v) {
  return Number.isFinite(v) ? v : 0;
}
function isFiniteN(v) {
  return Number.isFinite(v);
}
function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + (+b || 0), 0) / arr.length : 0;
}
function fmt(x) {
  return Number.isFinite(x) ? (+x).toFixed(2) : String(x);
}
function near(a, b, eps = 1e-8) {
  return Math.abs((+a || 0) - (+b || 0)) <= eps;
}
function countConsecutiveUpDays(data, k = 8) {
  let c = 0;
  for (let i = data.length - 1; i > 0 && c < k; i--) {
    if (+data[i].close > +data[i - 1].close) c++;
    else break;
  }
  return c;
}

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
function withNo(reason, ctx = {}) {
  const stock = ctx.stock || {};
  const data = Array.isArray(ctx.data) ? ctx.data : [];
  const out = {
    buyNow: false,
    reason,
    ...fallbackPlan(stock, data),
    timeline: [],
    debug: ctx,
  };
  out.telemetry = undefined;
  return out;
}
function withTelemetryNo(tele, T, reason, stock, data) {
  const out = withNo(reason, { stock, data });
  out.telemetry = {
    ...tele,
    outcome: { buyNow: false, reason },
    reasons: [reason],
    trace: T.logs,
  };
  return out;
}
function toTeleRR(rr) {
  return {
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
}

export { getConfig };
