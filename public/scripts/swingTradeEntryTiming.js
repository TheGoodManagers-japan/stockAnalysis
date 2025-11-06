// /scripts/swingTradeEntryTiming.js — DIP-only, simplified (rich diagnostics kept, no fallbacks)


import { detectDipBounce } from "./dip.js";

/* ============== lightweight global bus for guard histos (unchanged) ============== */
const teleGlobal = { histos: { headroom: [], distMA25: [] } };

/* ============================ Telemetry ============================ */
function teleInit() {
  return {
    context: {},
    gates: {
      structure: { pass: false, why: "" }, // minimal, DIP-friendly
      regime: { pass: true, why: "" }, // reserved slot for logs (regime disabled)
      liquidity: { pass: true, why: "" }, // ← add this
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
    blocks: [], // [{code, gate, why, ctx}]
    histos: {
      rrShortfall: [], // [{need, have, short, atrPct, trend, ticker}]
      headroom: [], // [{atr, pct, nearestRes, ticker}]
      distMA25: [], // [{distATR, ma25, px, ticker}]
    },
    distros: {
      dipV20ratio: [],
      dipBodyPct: [],
      dipRangePctATR: [],
      dipCloseDeltaATR: [],
      dipPullbackPct: [],
      dipPullbackATR: [],
      dipRecoveryPct: [],
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

export function analyzeDipEntry(stock, historicalData, opts = {}) {
  const cfg = getConfig(opts);
  const gatesData =
    Array.isArray(opts?.dataForGates) && opts.dataForGates.length
      ? opts.dataForGates
      : historicalData;
  const reasons = [];
  const tele = teleInit();
  const T = mkTracer(opts);

  // sentiment (1..7 where 1=Strong Bullish, 7=Strong Bearish)
  const ST = Number.isFinite(opts?.sentiment?.ST) ? opts.sentiment.ST : null;
  const LT = Number.isFinite(opts?.sentiment?.LT) ? opts.sentiment.LT : null;

  // ---------- Basic data checks (no fallbacks; return with logs only) ----------
  if (!Array.isArray(gatesData) || gatesData.length < cfg.minBarsNeeded) {
    const r = `Insufficient historical data (need ≥${cfg.minBarsNeeded}).`;
    const out = noEntry(r, { stock, data: historicalData || [] }, tele, T);
    out.flipBarsAgo = dailyFlipBarsAgo(historicalData || []);
    return out;
  }

  // Keep full data (incl. synthetic "today") for RR/levels
  const sortedLevels = cfg.assumeSorted
    ? historicalData
    : [...historicalData].sort((a, b) => new Date(a.date) - new Date(b.date));
  const sortedGates = cfg.assumeSorted
    ? gatesData
    : [...gatesData].sort((a, b) => new Date(a.date) - new Date(b.date));
  const dataForLevels = sortedLevels; // includes “today”
  const dataForGates2 = sortedGates; // completed bars only
  const flipBarsAgo = dailyFlipBarsAgo(dataForGates2);

  const last = dataForLevels[dataForLevels.length - 1];
  if (
    ![last?.open, last?.high, last?.low, last?.close].every(Number.isFinite)
  ) {
    const r = "Invalid last bar OHLCV.";
const out = noEntry(r, { stock, data: dataForLevels }, tele, T);
out.flipBarsAgo = dailyFlipBarsAgo(dataForLevels);
    return out;
  }
  const lastVolume = Number.isFinite(last.volume) ? last.volume : 0;

  const px = num(stock.currentPrice) || num(last.close);
  const openPx = num(stock.openPrice) || num(last.open) || px;
  const prevClose = num(stock.prevClosePrice) || num(last.close) || openPx;
  const dayPct = openPx ? ((px - openPx) / openPx) * 100 : 0;

  // ---------- Structure snapshot ----------
  const msFull = getMarketStructure(stock, dataForLevels);
  tele.context = {
    ticker: stock?.ticker,
    px,
    openPx,
    prevClose,
    volume: lastVolume,
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
    gatesDataset: {
      bars: dataForGates2.length,
      lastDate: dataForGates2.at(-1)?.date,
    },
    flipBarsAgo,
    sentiment: { ST, LT },
  };

  // ---------- Minimal structure gate (config-only thresholds) ----------
  const ma5Finite = Number.isFinite(msFull.ma5);
  const pxVsMa5Ok = ma5Finite ? px >= msFull.ma5 * cfg.structureMa5Tol : true;
  const allowDown = cfg.allowDipInDowntrend;
  const structureGateOk = (msFull.trend !== "DOWN" || allowDown) && pxVsMa5Ok;

  tele.gates.structure = {
    pass: !!structureGateOk,
    why: structureGateOk
      ? ""
      : msFull.trend === "DOWN" && !allowDown
      ? "trend DOWN (DIP not allowed in DOWNtrend)"
      : `price < MA5 * tol (${cfg.structureMa5Tol})`,
  };
  if (!structureGateOk) {
    const margin =
      ((px - (msFull.ma5 || 0)) / Math.max(msFull.ma5 || 1e-9, 1e-9)) * 100;
    pushBlock(tele, "STRUCTURE", "structure", tele.gates.structure.why, {
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

  // ---------- Liquidity prefilter ----------
  if (cfg.liquidityCheckEnabled) {
    const L = assessLiquidity(dataForGates2, stock, cfg); // completed bars only
    tele.gates.liquidity = { pass: !!L.pass, why: L.why || "" };
    tele.context.liquidity = L.metrics;

    if (!L.pass) {
      pushBlock(tele, "LIQUIDITY_FAIL", "prefilter", L.why, L.metrics);
      const reason = `Liquidity filter failed: ${L.why}`;
      tele.outcome = { buyNow: false, reason };
      return {
        buyNow: false,
        reason,
        timeline: [],
        telemetry: { ...tele, trace: T.logs },
        flipBarsAgo,
      };
    }
  }

  // ---------- DIP detection ----------
  const dip = detectDipBounce(stock, dataForLevels, cfg, U); // keep levels/targets on full data
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

  // Mirror numeric diagnostics into distros if present
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

  // ---------- RR + Guards (only if DIP triggered & structure ok) ----------
  if (dip?.trigger && structureGateOk) {
    // Precompute resistances once (shared by RR + guard if needed)
    const resList = findResistancesAbove(dataForLevels, px, stock) || [];
    const rr = analyzeRR(px, dip.stop, dip.target, stock, msFull, cfg, {
      kind: "DIP",
      data: dataForLevels,
      resList,
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
        dataForLevels,
        px,
        rr,
        msFull,
        cfg,
        dip.nearestRes,
        "DIP",
        resList
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
      timeline: [], // no fallbacks
      telemetry: { ...tele, trace: T.logs },
      flipBarsAgo,
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
    stopLoss: toTick(best.stop, stock),
    priceTarget: toTick(best.target, stock),
    timeline: buildSwingTimeline(px, best, best.rr, msFull, cfg),
    telemetry: { ...tele, trace: T.logs },
    flipBarsAgo,
  };
}

/* ============================ Config ============================ */
function getConfig(opts = {}) {
  const debug = !!opts.debug;
  // Read sentiments if provided
  const ST = Number.isFinite(opts?.sentiment?.ST) ? opts.sentiment.ST : null;
  const LT = Number.isFinite(opts?.sentiment?.LT) ? opts.sentiment.LT : null;

  const LT_bull = Number.isFinite(LT) && LT >= 3 && LT <= 5;
  const LT_bear = Number.isFinite(LT) && LT >= 6;
  const ST_pull = Number.isFinite(ST) && ST >= 6;
  const ST_hot = Number.isFinite(ST) && ST <= 2;

  const base = {
    // general
    perfectMode: false,
    assumeSorted: false,
    minBarsNeeded: 25,

    // Structure gate
    structureMa5Tol: 0.992, // price must be ≥ MA5 * tol (was hard-coded)
    allowDipInDowntrend: false,

    // RR floors
    minRRbase: 1.35,
    minRRstrongUp: 1.5,
    minRRweakUp: 1.55,
    dipMinRR: 1.55, // DIP-specific RR floor

    // Headroom & extension guards
    nearResVetoATR: 0.5, // veto if headroom < this ATR
    nearResVetoPct: 1.0, // and/or < this %
    headroomSecondResATR: 0.6, // when < this ATR, prefer next resistance
    maxATRfromMA25: 2.4, // distance above MA25 cap (ATR)
    ma25VetoMarginATR: 0.2, // extra breathing room previously implicit (+0.2)

    // Overbought guards
    hardRSI: 78,
    softRSI: 72, // reserved

    // DIP proximity/structure knobs
    dipMaSupportATRBands: 0.8,
    dipStructTolATR: 0.9,
    dipStructTolPct: 3.0,

    // Recovery caps
    dipMaxRecoveryPct: 135,
    dipMaxRecoveryStrongUp: 155,

    // Fib tolerance
    fibTolerancePct: 9,

    // Volume regime
    pullbackDryFactor: 1.2,
    bounceHotFactor: 1.08,

    // DIP geometry
    dipMinPullbackPct: 4.8,
    dipMinPullbackATR: 1.9,
    dipMaxBounceAgeBars: 7,
    dipMinBounceStrengthATR: 0.72,

    // Min stop distance for non-DIP (kept for completeness; DIP path uses dip.js stop)
    minStopATRStrong: 1.15,
    minStopATRUp: 1.2,
    minStopATRWeak: 1.3,
    minStopATRDown: 1.45,

    // SCOOT target lift
    scootEnabled: true,
    scootNearMissBand: 0.25,
    scootATRCapDIP: 4.2,
    scootATRCapNonDIP: 3.5,
    scootMaxHops: 2,

    // RR hop thresholds for resistance “next hop”
    hopThreshDipATR: 1.1,
    hopThreshNonDipATR: 0.7,

    // Minimum DIP target extension
    minDipTargetATR: 2.6,
    minDipTargetFrac: 0.022,

    // Volatility-aware RR floors
    lowVolRRBump: 0.1, // subtract from need when ATR% ≤ 1.0
    highVolRRFloor: 1.6, // raise need when ATR% ≥ 3.0

    // DIP pathological stop clamp
    dipFallbackStopATR: 0.8,

    // Streak veto
    maxConsecutiveUpDays: 9,
    // ANCHOR: CFG_MISSING_KEYS_END

    // --- Liquidity prefilter ---
    liquidityCheckEnabled: true,
    liqLookbackDays: 20, // rolling window
    minADVNotional: 2e8, // avg(close*volume) in JPY (tune to your market)
    minAvgVolume: 200_000, // shares/day
    minClosePrice: 200, // avoid penny names
    minATRTicks: 5, // ATR must span at least N ticks

    // Probation
    allowProbation: true,
    probationRRSlack: 0.02,
    probationRSIMax: 58,

    // Timeline config (no magic numbers)
    timeline: {
      r1: 1.0, // breakeven at +1R
      r15: 1.5, // lock fraction at +1.5R
      r2: 2.0, // runner tighten at +2R
      lockAtR15: 0.6, // lock 0.6R at +1.5R
      runnerLockAtR2: 1.2, // entry + 1.2R at +2R
      trail: { ma25OffsetATR: 0.6, swingLowOffsetATR: 0.5 },
    },

    debug,
  };

  // ---------- Sentiment-aware tweaks ----------
  const cfg = { ...base };

  if (LT_bull && ST_pull) {
    cfg.dipMinRR = Math.max(cfg.dipMinRR - 0.05, 1.45);
    cfg.minRRbase = Math.max(cfg.minRRbase - 0.05, 1.25);
    cfg.dipMaxRecoveryStrongUp += 10;
    cfg.hardRSI = Math.min(cfg.hardRSI + 2, 80);
    cfg.allowDipInDowntrend = false;
  }

  if (LT_bull && ST_hot) {
    cfg.nearResVetoATR = Math.max(cfg.nearResVetoATR, 0.6);
    cfg.nearResVetoPct = Math.max(cfg.nearResVetoPct, 1.2);
    cfg.maxATRfromMA25 = Math.min(cfg.maxATRfromMA25, 2.2);
  }

  if (LT_bear) {
    cfg.dipMinRR = Math.max(cfg.dipMinRR, 1.7);
    cfg.minRRbase = Math.max(cfg.minRRbase, 1.55);
    cfg.nearResVetoATR = Math.max(cfg.nearResVetoATR, 0.7);
    cfg.nearResVetoPct = Math.max(cfg.nearResVetoPct, 1.4);
    cfg.maxATRfromMA25 = Math.min(cfg.maxATRfromMA25, 2.0);
    cfg.hardRSI = Math.min(cfg.hardRSI, 76);
    cfg.allowDipInDowntrend = false;
  }

  if (!LT_bear && ST_pull) {
    cfg.allowDipInDowntrend = true; // narrowly for DIP structure gate
  }

  return cfg;
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

  return { trend, recentHigh, recentLow, ...m };
}

/* ======================== RR ======================== */
function analyzeRR(entryPx, stop, target, stock, ms, cfg, ctx = {}) {
  const atr = Math.max(num(stock.atr14), entryPx * 0.005, 1e-6);

  // 1) Stop hygiene
  if (ctx?.kind !== "DIP") {
    let minStopATR = cfg.minStopATRUp || 1.2;
    if (ms.trend === "STRONG_UP") minStopATR = cfg.minStopATRStrong || 1.15;
    else if (ms.trend === "UP") minStopATR = cfg.minStopATRUp || 1.2;
    else if (ms.trend === "WEAK_UP") minStopATR = cfg.minStopATRWeak || 1.3;
    else if (ms.trend === "DOWN") minStopATR = cfg.minStopATRDown || 1.45;

    const riskNow = entryPx - stop;
    const minStopDist = minStopATR * atr;
    if (riskNow < minStopDist) stop = entryPx - minStopDist;
  } else {
    // DIP: ensure stop < entry; keep dip.js logic intact; if pathological, clamp to ATR
    if (!(stop < entryPx))
      stop = entryPx - cfg.dipFallbackStopATR * atr || entryPx - 0.8 * atr;
  }

  // 2) Resistances (use precomputed if provided)
  let resList = Array.isArray(ctx?.resList) ? ctx.resList : [];
  if (!resList.length && Array.isArray(ctx?.data) && ctx.data.length) {
    resList = findResistancesAbove(ctx.data, entryPx, stock) || [];
  }

  // 3) Light target sanity with resistances
  if (resList.length) {
    const head0 = resList[0] - entryPx;
    const hopThresh =
      ctx?.kind === "DIP"
        ? cfg.hopThreshDipATR * atr
        : cfg.hopThreshNonDipATR * atr;
    if (head0 < hopThresh && resList[1]) {
      target = Math.max(target, resList[1]);
    }
  }
  if (ctx?.kind === "DIP") {
    // ensure a minimum extension for DIPs
    target = Math.max(
      target,
      entryPx +
        Math.max(cfg.minDipTargetATR * atr, entryPx * cfg.minDipTargetFrac)
    );
  }

  // 4) Compute base RR
  const risk = Math.max(0.01, entryPx - stop);
  let reward = Math.max(0, target - entryPx);
  let ratio = reward / risk;

  // 5) RR floors (use DIP-specific if applicable)
  let need = cfg.minRRbase ?? 1.5;
  if (ctx?.kind === "DIP" && Number.isFinite(cfg.dipMinRR))
    need = Math.max(need, cfg.dipMinRR);
  if (ms.trend === "STRONG_UP")
    need = Math.max(need, cfg.minRRstrongUp ?? need);
  if (ms.trend === "WEAK_UP") need = Math.max(need, cfg.minRRweakUp ?? need);

  // micro adjustment by instrument volatility
  const atrPct = (atr / Math.max(1e-9, entryPx)) * 100;
  if (atrPct <= 1.0) need = Math.max(need - cfg.lowVolRRBump, 1.25);
  if (atrPct >= 3.0) need = Math.max(need, cfg.highVolRRFloor);

  // 6) SCOOT: bounded target lifts to nearby clustered resistances
  if (cfg.scootEnabled && Array.isArray(resList) && resList.length) {
    const atrCap =
      ctx?.kind === "DIP"
        ? cfg.scootATRCapDIP ?? 4.2
        : cfg.scootATRCapNonDIP ?? 3.5;

    // First hop: try resList[1]
    if (ratio < need && resList.length >= 2) {
      const nextRes = resList[1];
      const lifted = Math.min(nextRes, entryPx + atrCap * atr);
      if (lifted > target) {
        target = lifted;
        reward = Math.max(0, target - entryPx);
        ratio = reward / risk;
      }
    }

    // Second hop: only if near miss and resList[2]
    if (
      ratio < need &&
      need - ratio <= (cfg.scootNearMissBand ?? 0.25) &&
      resList.length >= 3
    ) {
      const next2 = Math.min(resList[2], entryPx + atrCap * atr);
      if (next2 > target) {
        target = next2;
        reward = Math.max(0, target - entryPx);
        ratio = reward / risk;
      }
    }
  }

  // 7) Acceptable / probation
  let acceptable = ratio >= need;
  const allowProb = !!cfg.allowProbation;
  const rsiHere = Number(stock.rsi14) || rsiFromData(ctx?.data || [], 14);
  const probation =
    allowProb &&
    !acceptable &&
    ratio >= need - (cfg.probationRRSlack ?? 0.02) &&
    (ms.trend === "STRONG_UP" || ms.trend === "UP") &&
    rsiHere < (cfg.probationRSIMax ?? 58);

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
function guardVeto(stock, data, px, rr, ms, cfg, nearestRes, _kind, resListIn) {
  const details = {};
  details.rrNeed = Number(rr?.need);
  details.rrHave = Number(rr?.ratio);

  const atr = Math.max(num(stock.atr14), px * 0.005, 1e-6);

  // RSI caps
  const rsi = num(stock.rsi14) || rsiFromData(data, 14);
  details.rsi = rsi;
  try {
    if (isFiniteN(rsi)) teleGlobal._lastRSI = rsi;
  } catch {}
  if (rsi >= cfg.hardRSI) {
    return {
      veto: true,
      reason: `RSI ${rsi.toFixed(1)} ≥ ${cfg.hardRSI}`,
      details,
    };
  }

  // headroom
   const resList = Array.isArray(resListIn) && resListIn.length
   ? resListIn
   : findResistancesAbove(data, px, stock);
  let effRes = Number.isFinite(nearestRes) ? nearestRes : resList[0];
  if (
    isFiniteN(effRes) &&
    (effRes - px) / atr < cfg.headroomSecondResATR &&
    resList[1]
  ) {
    effRes = resList[1];
  }

  if (isFiniteN(effRes)) {
    const headroomATR = (effRes - px) / atr;
    const headroomPct = ((effRes - px) / Math.max(px, 1e-9)) * 100;
    details.nearestRes = effRes;
    details.headroomATR = headroomATR;
    details.headroomPct = headroomPct;
    try {
      teleGlobal.histos.headroom.push({
        atr: headroomATR,
        pct: headroomPct,
        nearestRes: effRes,
        ticker: stock?.ticker,
      });
    } catch {}
    if (
      headroomATR < (cfg.nearResVetoATR ?? 0.35) ||
      headroomPct < (cfg.nearResVetoPct ?? 0.8)
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
    const cap = (cfg.maxATRfromMA25 ?? 2.4) + (cfg.ma25VetoMarginATR ?? 0);
    if (distMA25 > cap) {
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
  if (ups >= cfg.maxConsecutiveUpDays) {
    return {
      veto: true,
      reason: `Consecutive up days ${ups} ≥ ${cfg.maxConsecutiveUpDays}`,
      details,
    };
  }

  return { veto: false, reason: "", details };
}

/* ============================ Helpers ============================ */


function assessLiquidity(data, stock, cfg) {
  const n = Math.min(data.length, cfg.liqLookbackDays || 20);
  if (!n || n < 5) {
    return {
      pass: false,
      why: `Not enough bars for liquidity window (${n})`,
      metrics: { n },
    };
  }
  const win = data.slice(-n);

  const adv = avg(
    win.map((b) => (Number(b.close) || 0) * Math.max(0, Number(b.volume) || 0))
  );
  const avVol = avg(win.map((b) => Math.max(0, Number(b.volume) || 0)));
  const px = Number.isFinite(stock.currentPrice)
    ? stock.currentPrice
    : Number(win.at(-1)?.close) || 0;

  const tick = Number(stock?.tickSize) || inferTickFromPrice(px || 0) || 0.1;
  const atr = Math.max(Number(stock.atr14) || 0, 1e-6); // rely on your computed ATR14 only
  const atrTicks = atr / Math.max(tick, 1e-9);

  const metrics = { adv, avVol, px, atr, tick, atrTicks, n };

  if (px < (cfg.minClosePrice ?? 0))
    return {
      pass: false,
      why: `Price ${px} < minClosePrice ${cfg.minClosePrice}`,
      metrics,
    };

  if (adv < (cfg.minADVNotional ?? 0))
    return {
      pass: false,
      why: `ADV ${Math.round(adv)} < minADVNotional ${cfg.minADVNotional}`,
      metrics,
    };

  if (avVol < (cfg.minAvgVolume ?? 0))
    return {
      pass: false,
      why: `Avg volume ${Math.round(avVol)} < minAvgVolume ${cfg.minAvgVolume}`,
      metrics,
    };

  if (atrTicks < (cfg.minATRTicks ?? 0))
    return {
      pass: false,
      why: `ATR in ticks ${atrTicks.toFixed(2)} < minATRTicks ${
        cfg.minATRTicks
      }`,
      metrics,
    };

  return { pass: true, why: "", metrics };
}

function buildSwingTimeline(entryPx, candidate, rr, ms, cfg) {
  const steps = [];
  const risk = Math.max(0.01, entryPx - Number(candidate.stop));
  const tl = cfg.timeline;

  steps.push({
    when: "T+0",
    condition: "On fill",
    stopLoss: Number(candidate.stop),
    priceTarget: Number(candidate.target),
    note: `${candidate.kind || "ENTRY"}: initial plan`,
  });
  steps.push({
    when: `+${tl.r1}R`,
    condition: `price ≥ ${entryPx + tl.r1 * risk}`,
    stopLoss: entryPx,
    priceTarget: Number(candidate.target),
    note: "Move stop to breakeven",
  });
  steps.push({
    when: `+${tl.r15}R`,
    condition: `price ≥ ${entryPx + tl.r15 * risk}`,
    stopLoss: entryPx + tl.lockAtR15 * risk,
    priceTarget: Number(candidate.target),
    note: `Lock ${tl.lockAtR15}R`,
  });
  steps.push({
    when: `+${tl.r2}R`,
    condition: `price ≥ ${entryPx + tl.r2 * risk}`,
    stopLoss: entryPx + tl.runnerLockAtR2 * risk,
    priceTarget: Number(candidate.target),
    note: `Runner: stop = entry + ${tl.runnerLockAtR2}R`,
  });
  steps.push({
    when: "TRAIL",
    condition: "After +2R",
    stopLossRule: `max( swing low - ${tl.trail.swingLowOffsetATR}*ATR, MA25 - ${tl.trail.ma25OffsetATR}*ATR )`,
    stopLossHint: Math.max(
      ms?.ma25
        ? ms.ma25 - tl.trail.ma25OffsetATR * (Number(rr?.atr) || 0)
        : Number(candidate.stop),
      Number(candidate.stop)
    ),
    priceTarget: Number(candidate.target),
    note: "Trail by structure/MA",
  });
  return steps;
}

// Helper to produce a no-entry result WITHOUT any fallback stop/target.
function noEntry(reason, ctx, tele, T) {
  const out = {
    buyNow: false,
    reason,
    timeline: [],
    telemetry: {
      ...tele,
      outcome: { buyNow: false, reason },
      reasons: [reason],
      trace: T.logs,
    },
  };
  return out;
}

/* =========================== Utils =========================== */
function sma(data, n, field = "close") {
  if (!Array.isArray(data) || data.length < n) return NaN;
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
  const q = Math.round(x / tick);
  return Number((q * tick).toFixed(6));
}
function inferTickFromPrice(p) {
  if (p >= 5000) return 1;
  if (p >= 1000) return 0.5;
  if (p >= 100) return 0.1;
  if (p >= 10) return 0.05;
  return 0.01;
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
function countConsecutiveUpDays(data) {
  let c = 0;
  for (let i = data.length - 1; i > 0; i--) {
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
        regime: { pass: true, why: "" },
        liquidity: { pass: g.liquidity?.pass, why: g.liquidity?.why },
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

// data: [{ date, open, high, low, close, volume }, ...] in chronological order
export function dailyFlipBarsAgo(data) {
  const n = data?.length ?? 0;
  const last = n - 1;
  if (last < 75) return null; // need ≥75 bars to form MA75

  // prefix sums for O(1) SMA
  const ps = new Array(n + 1).fill(0);
  for (let i = 0; i < n; i++) ps[i + 1] = ps[i] + (+data[i].close || 0);
  const sma = (len, i) => {
    if (i + 1 < len) return NaN;
    return (ps[i + 1] - ps[i + 1 - len]) / len;
  };

  for (let i = last; i >= 1; i--) {
    const m5 = sma(5, i),
      m25 = sma(25, i),
      m75 = sma(75, i);
    const pm5 = sma(5, i - 1),
      pm25 = sma(25, i - 1),
      pm75 = sma(75, i - 1);

    const nowStacked =
      Number.isFinite(m5) &&
      Number.isFinite(m25) &&
      Number.isFinite(m75) &&
      m5 > m25 &&
      m25 > m75;
    const prevStacked =
      Number.isFinite(pm5) &&
      Number.isFinite(pm25) &&
      Number.isFinite(pm75) &&
      pm5 > pm25 &&
      pm25 > pm75;

    if (nowStacked && !prevStacked) {
      return last - i; // bars ago (0 = today)
    }
  }
  return null;
}

/* Exports */
export { getConfig, summarizeTelemetryForLog};
