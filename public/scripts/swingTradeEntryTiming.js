// /scripts/swingTradeEntryTiming.js — DIP-only, simplified (rich diagnostics kept)
import { detectDipBounce } from "./dip.js";

/* ============== lightweight global bus for guard histos ============== */
const teleGlobal = { histos: { headroom: [], distMA25: [] } };

/* ============================ Telemetry ============================ */
function teleInit() {
  return {
    context: {},
    gates: {
      structure: { pass: false, why: "" }, // minimal, DIP-friendly
      regime: { pass: true, why: "" }, // no strict pre-gate; keep slot for logs
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
    /* blocks & histograms for compact “why blocked?” analysis */
    blocks: [], // [{code, gate, why, ctx}]
    histos: {
      rrShortfall: [], // [{need, have, short, atrPct, trend, ticker}]
      headroom: [], // [{atr, pct, nearestRes, ticker}]
      distMA25: [], // [{distATR, ma25, px, ticker}]
    },
    /* numeric distributions for "how much to relax" analysis */
    distros: {
      // DIP quality mirrors (only pushed if dip.js provides them)
      dipV20ratio: [],
      dipBodyPct: [],
      dipRangePctATR: [],
      dipCloseDeltaATR: [],
      dipPullbackPct: [],
      dipPullbackATR: [],
      dipRecoveryPct: [],
      // optional: RSI sample near veto thresholds
      rsiSample: [],
    },
  };
}
function pushBlock(tele, code, gate, why, ctx = {}) {
  tele.blocks.push({ code, gate, why, ctx });
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

  // keep full data (incl. synthetic "today") for RR/levels
  const sorted = [...historicalData].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );
  const data = sorted;

  const last = data[data.length - 1];
  if (
    ![last?.open, last?.high, last?.low, last?.close].every(Number.isFinite)
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
  // normalize volume to a finite number for downstream calcs
  if (!Number.isFinite(last.volume)) last.volume = 0;

  const px = num(stock.currentPrice) || num(last.close);
  const openPx = num(stock.openPrice) || num(last.open) || px;
  const prevClose = num(stock.prevClosePrice) || num(last.close) || openPx;
  const dayPct = openPx ? ((px - openPx) / openPx) * 100 : 0;

  // structure snapshot (for display + minimal sanity)
  const msFull = getMarketStructure(stock, data);
  tele.context = {
    ticker: stock?.ticker,
    px,
    openPx,
    prevClose,
    dayPct,
    trend: msFull.trend,
    ma: {
      ma5: msFull.ma5,
      ma20: msFull.ma20,
      ma25: msFull.ma25,
      ma50: msFull.ma50,
      ma75: msFull.ma75,
      ma200: msFull.ma200,
    },
    perfectMode: cfg.perfectMode,
    gatesDataset: { bars: data.length, lastDate: data.at(-1)?.date },
  };

  /* ----- Minimal structure check (DIP-friendly) ----- */
  // Allow WEAK_UP/UP/STRONG_UP, forbid clear DOWN unless cfg allows
  const structureGateOk =
    (msFull.trend !== "DOWN" || cfg.allowDipInDowntrend) &&
    px >= (msFull.ma5 || 0) * 0.992; // tiny slack
  tele.gates.structure = {
    pass: !!structureGateOk,
    why: structureGateOk ? "" : "trend DOWN or price < MA5",
  };
  if (!structureGateOk) {
    const margin =
      ((px - (msFull.ma5 || 0)) / Math.max(msFull.ma5 || 1e-9, 1e-9)) * 100;
    pushBlock(tele, "STRUCTURE", "structure", "trend DOWN or price < MA5", {
      trend: msFull.trend,
      px,
      ma5: msFull.ma5,
      marginPct: +margin.toFixed(3),
    });
  }

  const candidates = [];
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

  /* ======================= DIP (primary & only lane) ======================= */
  const dip = detectDipBounce(stock, data, cfg, U);

  T(
    "dip",
    "detect",
    !!dip?.trigger,
    dip?.trigger ? "DIP trigger" : dip?.waitReason || "DIP not ready",
    { why: dip?.why, waitReason: dip?.waitReason, diag: dip?.diagnostics },
    "verbose"
  );

  tele.dip = {
    trigger: !!dip?.trigger,
    waitReason: dip?.waitReason || "",
    why: dip?.why || "",
    diagnostics: dip?.diagnostics || {},
  };

  // mirror selected numeric diagnostics into distros if present
  try {
    const d = dip?.diagnostics || {};
    if (isFiniteN(d.bounceV20ratio ?? d.v20ratio))
      tele.distros.dipV20ratio.push(
        +(d.bounceV20ratio ?? d.v20ratio).toFixed(3)
      );
    if (isFiniteN(d.bodyPct))
      tele.distros.dipBodyPct.push(+d.bodyPct.toFixed(3));
    if (isFiniteN(d.rangePctATR ?? d.bounceStrengthATR))
      tele.distros.dipRangePctATR.push(
        +(d.rangePctATR ?? d.bounceStrengthATR).toFixed(3)
      );
    if (isFiniteN(d.closeDeltaATR))
      tele.distros.dipCloseDeltaATR.push(+d.closeDeltaATR.toFixed(3));
    if (isFiniteN(d.pullbackPct))
      tele.distros.dipPullbackPct.push(+d.pullbackPct.toFixed(3));
    if (isFiniteN(d.pullbackATR))
      tele.distros.dipPullbackATR.push(+d.pullbackATR.toFixed(3));
    if (isFiniteN(d.recoveryPct))
      tele.distros.dipRecoveryPct.push(+d.recoveryPct.toFixed(3));
  } catch {}

  if (!dip?.trigger) {
    const wait = (dip?.waitReason || "").toLowerCase();
    let code = "DIP_WAIT";
    if (wait.includes("too shallow")) code = "DIP_TOO_SHALLOW";
    else if (wait.includes("already recovered")) code = "DIP_OVERRECOVERED";
    else if (wait.includes("bounce weak")) code = "DIP_WEAK_BOUNCE";
    else if (wait.includes("no meaningful pullback")) code = "DIP_NO_PULLBACK";
    else if (wait.includes("conditions not fully"))
      code = "DIP_CONDS_INCOMPLETE";
    pushBlock(tele, code, "dip", dip?.waitReason || "DIP not ready", {
      px,
      diag: dip?.diagnostics || {},
    });
  }

  if (dip?.trigger && structureGateOk) {
    // RR uses DIP stop/target as-is; no structural reshaping for DIPs
    const rr = analyzeRR(px, dip.stop, dip.target, stock, msFull, cfg, {
      kind: "DIP",
      data,
    });

    T(
      "rr",
      "calc",
      rr.acceptable,
      `RR ${fmt(rr.ratio)} need ${fmt(rr.need)} risk ${fmt(
        rr.risk
      )} reward ${fmt(rr.reward)}`,
      {
        stop: rr.stop,
        target: rr.target,
        atr: rr.atr,
        probation: rr.probation,
        kind: "DIP",
      },
      "verbose"
    );

    tele.rr = toTeleRR(rr);

    if (!rr.acceptable) {
      const atrPct = (rr.atr / Math.max(1e-9, px)) * 100;
      const short = +(rr.need - rr.ratio).toFixed(3);
      tele.histos.rrShortfall.push({
        need: +rr.need.toFixed(2),
        have: +rr.ratio.toFixed(2),
        short,
        atrPct: +atrPct.toFixed(2),
        trend: msFull.trend,
        ticker: stock?.ticker,
      });
      pushBlock(
        tele,
        "RR_FAIL",
        "rr",
        `RR ${fmt(rr.ratio)} < need ${fmt(rr.need)}`,
        {
          stop: rr.stop,
          target: rr.target,
          atr: rr.atr,
          px,
        }
      );
      reasons.push(`DIP RR too low: ${fmt(rr.ratio)} < need ${fmt(rr.need)}`);
    } else {
      const gv = guardVeto(
        stock,
        data,
        px,
        rr,
        msFull,
        cfg,
        dip.nearestRes,
        "DIP"
      );
      T(
        "guard",
        "veto",
        !gv.veto,
        gv.veto ? `VETO: ${gv.reason}` : "No veto",
        gv.details,
        "verbose"
      );

      tele.guard = {
        checked: true,
        veto: !!gv.veto,
        reason: gv.reason || "",
        details: gv.details || {},
      };

      if (gv.veto) {
        reasons.push(`DIP guard veto: ${gv.reason}`);
        const code = gv.reason?.startsWith("Headroom")
          ? "VETO_HEADROOM"
          : gv.reason?.startsWith("RSI")
          ? "VETO_RSI"
          : gv.reason?.startsWith("Too far above MA25")
          ? "VETO_MA25_EXT"
          : "VETO_OTHER";
        pushBlock(tele, code, "guard", gv.reason, gv.details);
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
  } else if (!dip?.trigger) {
    reasons.push(`DIP not ready: ${dip?.waitReason}`);
  } else if (dip?.trigger && !structureGateOk) {
    reasons.push("Structure gate failed for DIP.");
  }

  /* attach global guard histos */
  tele.histos.headroom = tele.histos.headroom.concat(
    teleGlobal.histos.headroom
  );
  tele.histos.distMA25 = tele.histos.distMA25.concat(
    teleGlobal.histos.distMA25
  );
  teleGlobal.histos.headroom.length = 0;
  teleGlobal.histos.distMA25.length = 0;

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

  // pick highest RR
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
    timeline: buildSwingTimeline(px, best, best.rr, msFull),
    telemetry: { ...tele, trace: T.logs },
  };
}

/* ============================ Config ============================ */
function getConfig(opts = {}) {
const debug = !!opts.debug;
  return {
    // general
    perfectMode: false,

    // RR floors (kept modest; DIP trades often tighter)
    minRRbase: 1.35,
    minRRstrongUp: 1.5,
    minRRweakUp: 1.6,

    // headroom & extension guards
    nearResVetoATR: 0.35,
    nearResVetoPct: 0.8,
    maxATRfromMA25: 2.4,

    // overbought guards
    hardRSI: 78,
    softRSI: 72,

    // --- DIP proximity/structure knobs (new) ---
    dipMaSupportATRBands: 0.9, // MA proximity in ATRs (try 0.8–1.1)
    dipStructTolATR: 1.0, // structure proximity in ATRs (was 1.2 in older cfg)
    dipStructTolPct: 3.5, // fallback % tolerance for structure
    // (optional) if you want explicit caps instead of the internal defaults:
    dipMaxRecoveryPct: 150, // base “already recovered” cap (in % of dip span)
    dipMaxRecoveryStrongUp: 175,
    fibTolerancePct: 12, // +- tolerance around 50–61.8 retrace window
    pullbackDryFactor: 1.6, // avg pullback vol vs 20SMA(vol) (<= means “dry”)
    bounceHotFactor: 1.05, // today vol vs 20SMA(vol) (>= means “hot”)

    // DIP parameters (diagnostic-friendly; your dip.js can use them)
    dipMinPullbackATR: 0.6,
    dipMaxBounceAgeBars: 5,
    dipMinBounceStrengthATR: 0.8,

    // allow DIPs even if broader regime softened
    allowDipInDowntrend: false,

    // min stop distance (NOT forced for DIP; kept for non-DIP fallbacks)
    minStopATRStrong: 1.15,
    minStopATRUp: 1.2,
    minStopATRWeak: 1.3,
    minStopATRDown: 1.45,

    // probation OFF by default
    allowProbation: false,

    debug,
  };
}

/* ======================= Market Structure ======================= */
function getMarketStructure(stock, data) {
  const px = num(stock.currentPrice) || num(data.at?.(-1)?.close);
  const m = {
    ma5: sma(data, 5),
    ma20: sma(data, 20),
    ma25: sma(data, 25),
    ma50: sma(data, 50),
    ma75: sma(data, 75),
    ma200: sma(data, 200),
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

  const w = data.slice(-20);
  const recentHigh = Math.max(...w.map((d) => d.high ?? -Infinity));
  const recentLow = Math.min(...w.map((d) => d.low ?? Infinity));

  return {
    trend,
    recentHigh,
    recentLow,
    ...m,
  };
}

/* ======================== RR ======================== */
function analyzeRR(entryPx, stop, target, stock, ms, cfg, ctx = {}) {
  const atr = Math.max(num(stock.atr14), entryPx * 0.005, 1e-6);

  // For DIPs: TRUST provided stop (below dip low). Do NOT reshape to structural minimums.
  // Only ensure risk is positive and sane; keep target sanity via resistances (done below).
  if (ctx?.kind !== "DIP") {
    // non-DIP fallback (rare in this file)
    let minStopATR = cfg.minStopATRUp || 1.2;
    if (ms.trend === "STRONG_UP") minStopATR = cfg.minStopATRStrong || 1.15;
    else if (ms.trend === "UP") minStopATR = cfg.minStopATRUp || 1.2;
    else if (ms.trend === "WEAK_UP") minStopATR = cfg.minStopATRWeak || 1.3;
    else if (ms.trend === "DOWN") minStopATR = cfg.minStopATRDown || 1.45;

    const riskNow = entryPx - stop;
    const minStopDist = minStopATR * atr;
    if (riskNow < minStopDist) stop = entryPx - minStopDist;
  } else {
    // DIP: ensure stop < entry and risk is > 0
    if (!(stop < entryPx)) stop = entryPx - 0.8 * atr; // backstop if dip.js gave a bad stop
  }

  // respect nearby resistances for targets
  if (Array.isArray(ctx?.data) && ctx.data.length) {
    const resList = findResistancesAbove(ctx.data, entryPx, stock);
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
  const rsiHere = Number(stock.rsi14) || rsiFromData(ctx?.data || [], 14);
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
  try {
    if (isFiniteN(rsi)) teleGlobal._lastRSI = rsi;
  } catch {}
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
    // stash for histograms
    try {
      teleGlobal.histos.headroom.push({
        atr: headroomATR,
        pct: headroomPct,
        nearestRes: effRes,
        ticker: stock?.ticker,
      });
    } catch {}

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
    try {
      teleGlobal.histos.distMA25.push({
        distATR: distMA25,
        ma25,
        px,
        ticker: stock?.ticker,
      });
    } catch {}
    const cap = cfg.maxATRfromMA25;
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
    {
      kind: "FALLBACK",
      data,
    }
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

/* Optional: compact summary for console logs in callers */
function summarizeTelemetryForLog(tele) {
  try {
    const g = tele?.gates || {};
    const rr = tele?.rr || {};
    const guard = tele?.guard || {};
    return {
      gates: {
        regime: { pass: true, why: "" }, // regime disabled; keep shape
        structure: { pass: g.structure?.pass, why: g.structure?.why },
      },
      rr: {
        checked: rr.checked,
        acceptable: rr.acceptable,
        ratio: rr.ratio,
        need: rr.need,
        stop: rr.stop,
        target: rr.target,
        probation: rr.probation,
      },
      guard: {
        checked: guard.checked,
        veto: guard.veto,
        reason: guard.reason,
        details: guard.details,
      },
      context: tele?.context,
      blocks: tele?.blocks,
      histos: tele?.histos,
      distros: tele?.distros,
    };
  } catch {
    return {};
  }
}

/* Batch-friendly grouper for blocks */
export function summarizeBlocks(teleList = []) {
  const out = {};
  for (const t of teleList) {
    for (const b of t.blocks || []) {
      const key = `${b.code}`;
      if (!out[key]) out[key] = { count: 0, examples: [], ctxSample: [] };
      out[key].count++;
      if (out[key].examples.length < 6) {
        out[key].examples.push(
          `${t?.context?.ticker || "UNK"}` +
            (t?.context?.gatesDataset?.lastDate
              ? `@${t.context.gatesDataset.lastDate}`
              : "")
        );
      }
      if (out[key].ctxSample.length < 3) out[key].ctxSample.push(b.ctx);
    }
  }
  return Object.entries(out)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([code, v]) => ({
      code,
      count: v.count,
      examples: v.examples,
      ctxSample: v.ctxSample,
    }));
}

export { getConfig, summarizeTelemetryForLog };
