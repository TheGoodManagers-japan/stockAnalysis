// /scripts/swingTradeEntryTiming.js — DIP-only, with professional "tape reading" enhancements
// Enhancements: Supply wall detection, flush veto, MA5 resistance, weekly trend context, target skepticism

import { detectDipBounce, weeklyRangePositionFromDaily } from "./dip.js";

/* ============== lightweight global bus for guard histos (unchanged) ============== */
const teleGlobal = { histos: { headroom: [], distMA25: [] } };

/* ============================ Telemetry ============================ */
function teleInit() {
  return {
    context: {},
    gates: {
      structure: { pass: false, why: "" },
      regime: { pass: true, why: "" },
      liquidity: { pass: undefined, why: "" },
      tapeReading: { pass: true, why: "", details: {} }, // NEW: tape reading gate
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
    blocks: [],
    histos: {
      rrShortfall: [],
      headroom: [],
      distMA25: [],
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



function computeLimitBuyOrder({ ref, atr, stop, stock, cfg }) {
  const tick =
    Number(stock?.tickSize) || inferTickFromPrice(Number(ref) || 0) || 0.1;

  // default: a small discount to last close
  let limit = ref - (cfg.limitBuyDiscountATR ?? 0.15) * atr;

  // never set a limit below/at stop (meaningless)
  const minAboveStop = stop + tick;
  if (Number.isFinite(stop)) limit = Math.max(limit, minAboveStop);

  // tick-round
  return toTick(limit, { tickSize: tick });
}


/* ============================ Tracing ============================ */
function mkTracer(opts = {}) {
  const level = opts.debugLevel || "normal";
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
  console.log("analyzeDipEntry running", stock?.ticker);
  const cfg = getConfig(opts);
  const gatesData =
    Array.isArray(opts?.dataForGates) && opts.dataForGates.length
      ? opts.dataForGates
      : historicalData;

  // FIX #1: Default historicalData to gatesData if null/undefined
  const safeHistoricalData =
    Array.isArray(historicalData) && historicalData.length
      ? historicalData
      : gatesData;

  const reasons = [];
  const tele = teleInit();
  const T = mkTracer(opts);

  const ST = Number.isFinite(opts?.sentiment?.ST) ? opts.sentiment.ST : null;
  const LT = Number.isFinite(opts?.sentiment?.LT) ? opts.sentiment.LT : null;

  // ---------- Basic data checks ----------
  if (!Array.isArray(gatesData) || gatesData.length < cfg.minBarsNeeded) {
    const r = `Insufficient historical data (need ≥${cfg.minBarsNeeded}).`;
    const out = noEntry(r, { stock, data: historicalData || [] }, tele, T, cfg);
    out.flipBarsAgo = dailyFlipBarsAgo(historicalData || []);
    out.goldenCrossBarsAgo = goldenCross25Over75BarsAgo(historicalData || []);
    return out;
  }

  const sortedLevels = cfg.assumeSorted
    ? safeHistoricalData
    : [...safeHistoricalData].sort(
        (a, b) => new Date(a.date) - new Date(b.date)
      );
  const sortedGates = cfg.assumeSorted
    ? gatesData
    : [...gatesData].sort((a, b) => new Date(a.date) - new Date(b.date));
  const dataForLevels = sortedLevels;
  const dataForGates2 = sortedGates;
  const flipBarsAgo = dailyFlipBarsAgo(dataForGates2);
  const goldenCrossBarsAgo = goldenCross25Over75BarsAgo(dataForGates2);

  const weeklyRange = weeklyRangePositionFromDaily(
    dataForGates2,
    cfg.weeklyRangeLookbackWeeks || 12
  );

  const last = dataForLevels[dataForLevels.length - 1];
  if (
    ![last?.open, last?.high, last?.low, last?.close].every(Number.isFinite)
  ) {
    const r = "Invalid last bar OHLCV.";
    const out = noEntry(r, { stock, data: dataForLevels }, tele, T, cfg);
    out.flipBarsAgo = dailyFlipBarsAgo(dataForLevels);
    out.goldenCrossBarsAgo = goldenCross25Over75BarsAgo(dataForLevels);
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
    weeklyRange,
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
    goldenCrossBarsAgo,
    sentiment: { ST, LT },
  };

  const marketCtx = computeMarketContext(opts?.market, cfg);
  if (marketCtx) {
    tele.context.market = marketCtx;
    if (cfg.debug) {
      console.log(`[${stock?.ticker}] MarketCtx`, marketCtx);
    }
  }

  const candidates = [];
  const atr = Math.max(num(stock.atr14), px * 0.005, 1e-6);

  const U = {
    num,
    avg,
    near,
    sma,
    rsiFromData,
    findResistancesAbove: (d, p, s) => findResistancesAbove(d, p, s, cfg),
    findSupportsBelow,
    inferTickFromPrice,
    tracer: T,
  };

  // ---------- Tape Reading Gate (hard vetoes only) ----------
  // Soft issues (MA5 resistance, dead cat in non-down weekly) are flagged
  // but passed through — DIP strength decides
  const tapeReading = assessTapeReading(
    dataForGates2,
    stock,
    msFull,
    px,
    atr,
    cfg,
    weeklyRange
  );
  tele.gates.tapeReading = tapeReading;

  if (!tapeReading.pass) {
    const reason = `Tape reading: ${tapeReading.why}`;
    pushBlock(
      tele,
      tapeReading.code || "TAPE_VETO",
      "tapeReading",
      tapeReading.why,
      tapeReading.details
    );
    reasons.push(reason);

    tele.outcome = { buyNow: false, reason };
    return {
      buyNow: false,
      reason,
      timeline: [],
      telemetry: { ...tele, trace: T.logs },
      flipBarsAgo,
      goldenCrossBarsAgo,
      liquidity: packLiquidity(tele, cfg),
    };
  }

  // Store tape reading flags for potential use by DIP detector
  const tapeFlags = {
    requireStrongerBounce: tapeReading.requireStrongerBounce || false,
    ma5ResistanceActive: tapeReading.ma5ResistanceActive || false,
  };

  // ---------- Liquidity (compute only; do NOT prefilter or affect reasons) ----------
  const L = assessLiquidity(dataForGates2, stock, cfg);
  tele.gates.liquidity = {
    pass: !!L.pass,
    why: L.why || "",
    metrics: L.metrics,
    thresholds: L.thresholds,
    ratios: L.ratios,
  };
  tele.context.liquidity = L.metrics;
  tele.context.liqNearMargin = cfg.liqNearMargin;

  // ---------- DIP detection ----------
  // FIX #2: Pass tapeFlags so DIP can require stronger bounce when flagged
  const dip = detectDipBounce(stock, dataForGates2, cfg, U, tapeFlags);

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

  // ---------- RR + Guards (only if DIP triggered & structure ok) ----------
  if (dip?.trigger && structureGateOk) {
    // Precompute resistances once (shared by RR + guard if needed)
    const resList = findResistancesAbove(dataForLevels, px, stock, cfg) || [];

    // FIX #2: Scan supply walls up to MAXIMUM plausible target
    // This includes: SCOOT cap, horizon cap, and any resistance we might lift to
    const atrCap = cfg.scootATRCapDIP ?? 4.2;
    const horizonCap =
      px + (cfg.maxHoldingBars ?? 8) * (cfg.atrPerBarEstimate ?? 0.55) * atr;
    const maxPlausibleTarget = Math.max(
      dip.target,
      px + atrCap * atr,
      horizonCap,
      resList[2] || 0 // Include 3rd resistance in case of multi-hop SCOOT
    );
    const supplyWallCheck = detectSupplyWalls(
      dataForLevels,
      px,
      maxPlausibleTarget,
      atr,
      cfg
    );

    const rr = analyzeRR(px, dip.stop, dip.target, stock, msFull, cfg, {
      kind: "DIP",
      data: dataForLevels,
      resList,
      supplyWallCheck, // Pass supply wall info to RR analysis
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
        supplyWall: supplyWallCheck,
      },
      "verbose"
    );

    tele.rr = toTeleRR(rr);
    tele.rr.supplyWallBlocked = supplyWallCheck?.blocked || false;

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

      // Build RR fail reason — include SCOOT block info if that's why we failed
      let rrFailReason = `RR ${fmt(rr.ratio)} < need ${fmt(rr.need)}`;
      if (rr.scootBlocked) {
        rrFailReason += ` (target lift blocked: ${rr.scootBlockReason})`;
      }

      pushBlock(tele, "RR_FAIL", "rr", rrFailReason, {
        stop: rr.stop,
        target: rr.target,
        atr: rr.atr,
        px,
        supplyWall: supplyWallCheck,
        scootBlocked: rr.scootBlocked,
        scootBlockReason: rr.scootBlockReason,
      });
      reasons.push(`DIP RR too low: ${rrFailReason}`);
    } else {
      const weeklyRangeCtx = tele.context.weeklyRange;
      const marketCtxLocal = tele.context.market || null;

      const gv = guardVeto(
        stock,
        dataForLevels,
        px,
        rr,
        msFull,
        cfg,
        dip.nearestRes,
        "DIP",
        resList,
        weeklyRangeCtx,
        marketCtxLocal
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
          : gv.reason?.startsWith("Weekly")
          ? "VETO_WEEKLY"
          : gv.reason?.startsWith("Falling knife")
          ? "VETO_FALLING_KNIFE"
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
    const base = buildNoReason([], reasons);
    const reason = base;
    tele.outcome = { buyNow: false, reason };
    return {
      buyNow: false,
      reason,
      timeline: [],
      telemetry: { ...tele, trace: T.logs },
      flipBarsAgo,
      goldenCrossBarsAgo,
      liquidity: packLiquidity(tele, cfg),
    };
  }

  // pick highest RR
  candidates.sort(
    (a, b) => (Number(b?.rr?.ratio) || -1e9) - (Number(a?.rr?.ratio) || -1e9)
  );
  const best = candidates[0];
  const reason = `${best.kind}: ${
    best.rr ? best.rr.ratio.toFixed(2) : "?"
  }:1. ${best.why}`;
  tele.outcome = { buyNow: true, reason };

  const refCloseForLimit = num(last.close);
  const limitBuyOrder = computeLimitBuyOrder({
    ref: refCloseForLimit,
    atr,
    stop: best.stop,
    stock,
    cfg,
  });

  return {
    buyNow: true,
    reason,
    limitBuyOrder, // ✅ NEW
    stopLoss: toTick(best.stop, stock),
    priceTarget: toTick(best.target, stock),
    timeline: buildSwingTimeline(px, best, best.rr, msFull, cfg),
    telemetry: { ...tele, trace: T.logs },
    flipBarsAgo,
    goldenCrossBarsAgo,
    liquidity: packLiquidity(tele, cfg),
  };
}

/* ============================ Config ============================ */
function getConfig(opts = {}) {
  const debug = !!opts.debug;
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

    // --- Market veto (index context) ---
    marketVetoEnabled: true,
    marketImpulseVetoPct: 1.8,
    marketImpulseVetoATR: 1.0,
    marketUseTodayIfPresent: true,

    // Weekly range guard
    useWeeklyRangeGuard: true,
    weeklyRangeLookbackWeeks: 12,

    limitBuyDiscountATR: 0.15,

    // Hard veto thresholds
    weeklyTopVetoPos: 0.5,
    weeklyBottomPreferPos: 0.25,
    weeklyTopVetoRRBump: 0.1,

    // Structure gate
    structureMa5Tol: 0.992,
    allowDipInDowntrend: false,

    // RR floors
    minRRbase: 1.35,
    minRRstrongUp: 1.5,
    minRRweakUp: 1.55,
    dipMinRR: 1.55,

    // Horizon behavior
    horizonRRRelief: 0.1,
    tightenStopOnHorizon: true,
    dipTightenStopATR: 0.25,

    // ---- Holding horizon controls ----
    maxHoldingBars: 8,
    atrPerBarEstimate: 0.55,
    include52wAsResistance: false,
    resistanceLookbackBars: 40,
    timeHorizonRRPolicy: "clamp",

    // Headroom & extension guards
    nearResVetoATR: 0.5,
    nearResVetoPct: 1.0,
    headroomSecondResATR: 0.6,
    maxATRfromMA25: 2.4,
    ma25VetoMarginATR: 0.2,

    // Overbought guards
    hardRSI: 78,
    softRSI: 72,

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

    // Min stop distance for non-DIP
    minStopATRStrong: 1.15,
    minStopATRUp: 1.2,
    minStopATRWeak: 1.3,
    minStopATRDown: 1.45,

    // SCOOT target lift - NOW WITH SUPPLY WALL SKEPTICISM
    scootEnabled: true,
    scootNearMissBand: 0.25,
    scootATRCapDIP: 4.2,
    scootATRCapNonDIP: 3.5,
    scootMaxHops: 2,
    // Note: Supply wall blocking is done inline in analyzeRR, not via config flag

    // RR hop thresholds for resistance "next hop"
    hopThreshDipATR: 1.1,
    hopThreshNonDipATR: 0.7,

    // Minimum DIP target extension
    minDipTargetATR: 2.6,
    minDipTargetFrac: 0.022,

    // Volatility-aware RR floors
    lowVolRRBump: 0.1,
    highVolRRFloor: 1.6,

    // DIP pathological stop clamp
    dipFallbackStopATR: 0.8,

    // Streak veto
    maxConsecutiveUpDays: 9,

    // --- Liquidity window ---
    liquidityCheckEnabled: true,
    liqLookbackDays: 20,
    minADVNotional: 2e8,
    minAvgVolume: 200_000,
    minClosePrice: 200,
    minATRTicks: 5,
    liqNearMargin: 0.15,

    // Probation
    allowProbation: true,
    probationRRSlack: 0.02,
    probationRSIMax: 58,

    // Timeline config
    timeline: {
      r1: 1.0,
      r15: 1.5,
      r2: 2.0,
      lockAtR15: 0.6,
      runnerLockAtR2: 1.2,
      trail: { ma25OffsetATR: 0.6, swingLowOffsetATR: 0.5 },
    },

    // ========== NEW: TAPE READING ENHANCEMENTS ==========

    // Capitulation flush detection
    flushVetoEnabled: true,
    flushVolMultiple: 1.8, // Volume must be > 1.8x average
    flushRangeATR: 1.3, // Range must be > 1.3 ATR
    flushCloseNearLow: 0.25, // Close must be in bottom 25% of range
    flushStabilizationBars: 2, // Wait N bars after flush

    // MA5 resistance detection
    ma5ResistanceVetoEnabled: true,
    ma5ResistanceRejections: 2, // Need 2+ rejections in last 3 bars
    ma5ResistanceTol: 0.998, // High touches MA5 within 0.2%

    // Supply wall detection for targets
    supplyWallEnabled: true,
    supplyWallGapThreshold: 0.02, // Gap > 2% of price
    supplyWallVolMultiple: 1.5, // High-volume rejection
    supplyWallLookback: 60, // Look back N bars

    // Weekly trend context (enhanced)
    weeklyTrendVetoEnabled: true,
    weeklyTrendLookback: 26, // Use 26-week for trend
    weeklyFallingKnifePos: 0.35, // If pos < 35% AND trend down = falling knife

    // Arrival quality assessment
    arrivalQualityEnabled: true,
    arrivalFlushPenalty: true, // Penalize if arrived at support via flush

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
    cfg.allowDipInDowntrend = true;
  }

  return cfg;
}

/* ======================= NEW: Tape Reading Assessment ======================= */
/*
 * PHILOSOPHY: Only hard-veto on mechanical risks that no bounce quality can overcome.
 * Soft issues (MA5 resistance, weak patterns) should be handled by requiring stronger
 * DIP confirmation, not by blocking the trade outright.
 *
 * HARD VETOES (return pass: false):
 * - Fresh capitulation flush (needs stabilization)
 * - Dead cat bounce WITH weekly trend confirmed DOWN
 *
 * SOFT FLAGS (return pass: true with flags):
 * - MA5 resistance → flag for DIP to require stronger bounce
 * - Arrival quality → informational
 */
function assessTapeReading(data, stock, ms, px, atr, cfg, weeklyRange = null) {
  const details = {};
  const last = data.at(-1);
  const prev = data.at(-2);

  // FIX #1: Compute avgVol with safety clamp
  const avgVolRaw = avg(data.slice(-20).map((d) => num(d.volume)));
  const avgVol = Math.max(avgVolRaw, 1); // Prevent division-by-zero

  // 1) Capitulation Flush Detection — HARD VETO
  // Rationale: A fresh high-volume crash needs time to stabilize
  if (cfg.flushVetoEnabled) {
    const flushResult = detectCapitulationFlush(data, atr, avgVol, cfg);
    details.flush = flushResult;

    if (
      flushResult.isFlush &&
      flushResult.barsAgo < cfg.flushStabilizationBars
    ) {
      return {
        pass: false,
        why: `Capitulation flush ${flushResult.barsAgo} bar(s) ago — need ${cfg.flushStabilizationBars} bars to stabilize`,
        code: "TAPE_FLUSH",
        details,
      };
    }
  }

  // 2) MA5 Acting as Resistance — SOFT FLAG (not hard veto)
  // FIX #3 & #4: Don't veto here; flag it and let DIP/bounce quality decide
  if (cfg.ma5ResistanceVetoEnabled) {
    const ma5 = num(stock.movingAverage5d) || sma(data, 5);
    const ma5Resistance = detectMA5Resistance(data, ma5, cfg);
    details.ma5Resistance = ma5Resistance;

    if (ma5Resistance.acting) {
      // Check if there's a strong reclaim (close above yesterday's high)
      const closeAboveYHigh = num(last.close) > num(prev.high);
      if (closeAboveYHigh) {
        details.ma5ReclaimOverride = true;
      } else {
        // Flag it — DIP detector can use this to require stronger bounce
        details.ma5ResistanceActive = true;
        details.requireStrongerBounce = true;
      }
    }
  }

  // 3) Arrival Quality — INFORMATIONAL FLAG
  if (cfg.arrivalQualityEnabled) {
    const arrivalQuality = assessArrivalQuality(data, atr, avgVol, cfg);
    details.arrivalQuality = arrivalQuality;

    if (arrivalQuality.wasFlush) {
      details.arrivalWarning = "Price arrived at support via high-volume flush";
      // This can inform DIP to be more cautious, but not a veto
    }
  }

  // 4) Dead Cat Bounce — CONDITIONAL HARD VETO
  // Only veto if BOTH: pattern detected AND weekly trend confirmed DOWN
  const deadCat = detectDeadCatBounce(data, ms, px, atr, cfg);
  details.deadCatBounce = deadCat;

  if (deadCat.detected) {
    const weeklyTrend = weeklyRange?.weeklyTrend || null;

    // Only hard veto if weekly confirms the weakness
    if (weeklyTrend === "DOWN") {
      return {
        pass: false,
        why: `Dead cat bounce confirmed by weekly downtrend — ${deadCat.reason}`,
        code: "TAPE_DEAD_CAT",
        details,
      };
    } else {
      // Weekly is not DOWN — flag it but don't veto
      details.deadCatDetected = true;
      details.deadCatOverriddenByWeekly = weeklyTrend;
      details.requireStrongerBounce = true;
    }
  }

  // Pass through — let DIP detector handle with the flags
  return {
    pass: true,
    why: "",
    details,
    // These flags can be used by DIP to require stronger confirmation
    requireStrongerBounce: details.requireStrongerBounce || false,
    ma5ResistanceActive: details.ma5ResistanceActive || false,
  };
}

/* ======================= NEW: Capitulation Flush Detection ======================= */
function detectCapitulationFlush(data, atr, avgVolRaw, cfg) {
  // FIX #1: Clamp avgVol to prevent division-by-zero / Infinity ratios
  const avgVol = Math.max(avgVolRaw, 1);

  // Look at last few bars for a flush event
  const lookback = Math.min(5, data.length);

  for (let i = 0; i < lookback; i++) {
    const bar = data.at(-(i + 1));
    const barRange = num(bar.high) - num(bar.low);
    const closePos =
      barRange > 0 ? (num(bar.close) - num(bar.low)) / barRange : 0.5;

    const volRatio = num(bar.volume) / avgVol;

    const isFlush =
      volRatio > (cfg.flushVolMultiple || 1.8) &&
      num(bar.close) < num(bar.open) && // Red candle
      closePos < (cfg.flushCloseNearLow || 0.25) && // Close near low
      barRange > (cfg.flushRangeATR || 1.3) * atr; // Wide range

    if (isFlush) {
      return {
        isFlush: true,
        barsAgo: i,
        bar: {
          date: bar.date,
          volume: num(bar.volume),
          volRatio,
          range: barRange,
          rangeATR: barRange / atr,
          closePos,
        },
      };
    }
  }

  return { isFlush: false, barsAgo: -1 };
}

/* ======================= NEW: MA5 Resistance Detection ======================= */
function detectMA5Resistance(data, ma5, cfg) {
  if (!ma5 || ma5 <= 0) return { acting: false, rejections: 0 };

  const recent = data.slice(-3);
  const tol = cfg.ma5ResistanceTol || 0.998;

  let rejections = 0;
  for (const bar of recent) {
    // High touches MA5 but close stays below
    const highTouchesMA5 = num(bar.high) >= ma5 * tol;
    const closeBelowMA5 = num(bar.close) < ma5 * tol;

    if (highTouchesMA5 && closeBelowMA5) {
      rejections++;
    }
  }

  return {
    acting: rejections >= (cfg.ma5ResistanceRejections || 2),
    rejections,
    ma5,
    lastClose: num(recent.at(-1)?.close),
  };
}

/* ======================= NEW: Arrival Quality Assessment ======================= */
function assessArrivalQuality(data, atr, avgVolRaw, cfg) {
  // FIX #1: Clamp avgVol to prevent division-by-zero
  const avgVol = Math.max(avgVolRaw, 1);

  // Check how price arrived at current level
  const last = data.at(-1);
  const prev = data.at(-2);

  const arrivalVolRatio = num(last.volume) / avgVol;
  const arrivalRange = num(last.high) - num(last.low);
  const arrivalRed = num(last.close) < num(last.open);
  const closeNearLow =
    arrivalRange > 0
      ? (num(last.close) - num(last.low)) / arrivalRange < 0.3
      : false;

  const wasFlush =
    arrivalVolRatio > 1.5 &&
    arrivalRed &&
    closeNearLow &&
    arrivalRange > 1.2 * atr;

  // Check for slow drift (healthier)
  const slowDrift = arrivalVolRatio < 1.2 && arrivalRange < 0.8 * atr;

  return {
    wasFlush,
    slowDrift,
    volRatio: arrivalVolRatio,
    rangeATR: arrivalRange / atr,
    quality: wasFlush ? "poor" : slowDrift ? "good" : "neutral",
  };
}

/* ======================= NEW: Dead Cat Bounce Detection ======================= */
function detectDeadCatBounce(data, ms, px, atr, cfg) {
  // Dead cat bounce: sharp decline followed by weak bounce that fails to reclaim MA5
  const ma5 = ms.ma5;
  const ma25 = ms.ma25;

  if (!ma5 || !ma25) return { detected: false };

  // Look for pattern: significant drop in last 5-10 bars
  const recentBars = data.slice(-10);
  const recentHigh = Math.max(
    ...recentBars.slice(0, 5).map((d) => num(d.high))
  );
  const recentLow = Math.min(...recentBars.map((d) => num(d.low)));

  // FIX #7: Prevent division by zero if recentHigh is 0 (bad data)
  const dropPct =
    recentHigh > 0 ? ((recentHigh - recentLow) / recentHigh) * 100 : 0;

  // Check if we're in a bounce that's failing at MA5
  const pxBelowMA5 = px < ma5;
  const ma5Declining = data.length >= 6 && sma(data.slice(0, -1), 5) > ma5;
  const ma25Declining = data.length >= 26 && sma(data.slice(0, -1), 25) > ma25;

  // Dead cat criteria:
  // 1. Recent sharp drop (> 8%)
  // 2. Currently below declining MA5
  // 3. MA structure deteriorating
  const detected =
    dropPct > 8 &&
    pxBelowMA5 &&
    ma5Declining &&
    ma25Declining &&
    ms.trend !== "STRONG_UP";

  return {
    detected,
    reason: detected
      ? `Sharp ${dropPct.toFixed(1)}% drop with price failing at declining MA5`
      : "",
    dropPct,
    pxBelowMA5,
    ma5Declining,
    ma25Declining,
  };
}

/* ======================= NEW: Supply Wall Detection ======================= */
function detectSupplyWalls(data, entryPx, targetPx, atr, cfg) {
  if (!cfg.supplyWallEnabled) return { blocked: false };

  const lookback = cfg.supplyWallLookback || 60;
  const relevant = data.slice(-lookback);

  // FIX #1: Safe avgVol
  const avgVolRaw = avg(relevant.map((d) => num(d.volume)));
  const avgVol = Math.max(avgVolRaw, 1);

  const walls = [];

  for (let i = 1; i < relevant.length; i++) {
    const bar = relevant[i];
    const prevBar = relevant[i - 1];
    const barHigh = num(bar.high);
    const barLow = num(bar.low);
    const barOpen = num(bar.open);
    const prevClose = num(prevBar.close);

    // Skip if not in the zone between entry and target
    if (barHigh < entryPx || barLow > targetPx) continue;

    // Check for gap-down
    const gapThreshold = cfg.supplyWallGapThreshold || 0.02;
    const isGapDown = barOpen < prevClose * (1 - gapThreshold);

    // Check for high-volume rejection
    const volRatio = num(bar.volume) / avgVol;
    const isHighVolRejection =
      volRatio > (cfg.supplyWallVolMultiple || 1.5) &&
      num(bar.close) < num(bar.open) && // Red candle
      barHigh > entryPx; // High above entry = supply

    if (isGapDown) {
      // FIX #5: For gap-downs, the wall is at prevClose (gap upper boundary)
      // This is where trapped longs will be looking to exit
      walls.push({
        type: "gap",
        level: prevClose, // Gap upper bound, not barHigh
        gapLow: barOpen, // Gap lower bound (informational)
        gapSize: prevClose - barOpen,
        gapPct: ((prevClose - barOpen) / prevClose) * 100,
        date: bar.date,
        volume: num(bar.volume),
        volRatio,
      });
    } else if (isHighVolRejection) {
      // For rejections, barHigh is the right level
      walls.push({
        type: "rejection",
        level: barHigh,
        date: bar.date,
        volume: num(bar.volume),
        volRatio,
      });
    }
  }

  // Find the most significant wall between entry and target
  const blockingWalls = walls.filter(
    (w) => w.level > entryPx && w.level < targetPx
  );

  if (blockingWalls.length > 0) {
    // Sort by level (lowest first = first obstacle)
    blockingWalls.sort((a, b) => a.level - b.level);
    const firstWall = blockingWalls[0];

    return {
      blocked: true,
      wall: firstWall,
      allWalls: blockingWalls,
      headroomToWall: firstWall.level - entryPx,
      headroomToWallATR: (firstWall.level - entryPx) / atr,
      reason:
        firstWall.type === "gap"
          ? `Gap-down supply at ${firstWall.level.toFixed(
              0
            )} (${firstWall.gapPct.toFixed(1)}% gap)`
          : `High-volume rejection at ${firstWall.level.toFixed(0)}`,
    };
  }

  return { blocked: false, allWalls: walls };
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

/* ======================== RR (with supply wall awareness) ======================== */
function analyzeRR(entryPx, stop, target, stock, ms, cfg, ctx = {}) {
  const atr = Math.max(num(stock.atr14), entryPx * 0.005, 1e-6);

  // FIX #5: Early stop sanity check for ALL paths (not just DIP)
  // If stop is NaN, undefined, or >= entryPx, it's invalid
  if (!Number.isFinite(stop) || stop >= entryPx) {
    const fallbackStopATR =
      ctx?.kind === "DIP"
        ? cfg.dipFallbackStopATR || 0.8
        : cfg.minStopATRUp || 1.2;
    stop = entryPx - fallbackStopATR * atr;
  }

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
  }
  // DIP path: stop was already validated above; dip.js provides the stop

  // 2) Resistances (use precomputed if provided)
  let resList = Array.isArray(ctx?.resList) ? ctx.resList : [];
  if (!resList.length && Array.isArray(ctx?.data) && ctx.data.length) {
    resList = findResistancesAbove(ctx.data, entryPx, stock, cfg) || [];
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
    target = Math.max(
      target,
      entryPx +
        Math.max(cfg.minDipTargetATR * atr, entryPx * cfg.minDipTargetFrac)
    );
  }

  // 4) Compute base RR
  let risk = Math.max(0.01, entryPx - stop);
  let reward = Math.max(0, target - entryPx);
  let horizonClamped = false;
  let ratio = reward / risk;

  // 5) RR floors
  let need = cfg.minRRbase ?? 1.5;
  if (ctx?.kind === "DIP" && Number.isFinite(cfg.dipMinRR))
    need = Math.max(need, cfg.dipMinRR);
  if (ms.trend === "STRONG_UP")
    need = Math.max(need, cfg.minRRstrongUp ?? need);
  if (ms.trend === "WEAK_UP") need = Math.max(need, cfg.minRRweakUp ?? need);

  const atrPct = (atr / Math.max(1e-9, entryPx)) * 100;
  if (atrPct <= 1.0) need = Math.max(need - cfg.lowVolRRBump, 1.25);
  if (atrPct >= 3.0) need = Math.max(need, cfg.highVolRRFloor);

  // 6) SCOOT: bounded target lifts — WITH SUPPLY WALL SKEPTICISM
  // Philosophy: If we can't reach minimum RR with a "clean path" to target,
  // the trade should fail on RR Gate, not on a tape veto. This is more honest
  // about why we're passing — the setup just doesn't have enough reward potential.
  const supplyWall = ctx?.supplyWallCheck;
  let scootBlocked = false;
  let scootBlockReason = "";

  if (cfg.scootEnabled && Array.isArray(resList) && resList.length) {
    const atrCap =
      ctx?.kind === "DIP"
        ? cfg.scootATRCapDIP ?? 4.2
        : cfg.scootATRCapNonDIP ?? 3.5;

    // First hop: try resList[1]
    if (ratio < need && resList.length >= 2) {
      const nextRes = resList[1];
      const lifted = Math.min(nextRes, entryPx + atrCap * atr);

      // CHECK: Is there a supply wall blocking this lift?
      const wallBlocksLift =
        supplyWall?.blocked && supplyWall.wall.level < lifted;

      if (lifted > target && !wallBlocksLift) {
        target = lifted;
        reward = Math.max(0, target - entryPx);
        ratio = reward / risk;
      } else if (wallBlocksLift) {
        // Record that SCOOT was blocked — trade will fail on RR if it can't pass naturally
        scootBlocked = true;
        scootBlockReason = `Supply wall at ${supplyWall.wall.level.toFixed(
          0
        )} blocks target lift to ${lifted.toFixed(0)}`;
      }
    }

    // Second hop: only if near miss and resList[2] and first hop didn't get blocked
    if (
      !scootBlocked &&
      ratio < need &&
      need - ratio <= (cfg.scootNearMissBand ?? 0.25) &&
      resList.length >= 3
    ) {
      const next2 = Math.min(resList[2], entryPx + atrCap * atr);
      const wallBlocksLift =
        supplyWall?.blocked && supplyWall.wall.level < next2;

      if (next2 > target && !wallBlocksLift) {
        target = next2;
        reward = Math.max(0, target - entryPx);
        ratio = reward / risk;
      } else if (wallBlocksLift && !scootBlocked) {
        scootBlocked = true;
        scootBlockReason = `Supply wall at ${supplyWall.wall.level.toFixed(
          0
        )} blocks second target lift to ${next2.toFixed(0)}`;
      }
    }
  }

  // --- Time-horizon target cap
  {
    const bars = Math.max(1, cfg.maxHoldingBars || 8);
    const atrPerBar = Math.max(0.1, cfg.atrPerBarEstimate || 0.55);
    const horizonCap = entryPx + bars * atrPerBar * atr;

    if (ctx?.kind === "DIP") {
      if ((cfg.timeHorizonRRPolicy || "clamp") === "clamp") {
        if (target > horizonCap) {
          target = horizonCap;
          horizonClamped = true;
        }
      } else {
        if (target > horizonCap) {
          return {
            acceptable: false,
            ratio: 0,
            stop,
            target: horizonCap,
            need: cfg.dipMinRR ?? cfg.minRRbase ?? 1.5,
            atr,
            risk: Math.max(0.01, entryPx - stop),
            reward: Math.max(0, horizonCap - entryPx),
            probation: false,
          };
        }
      }

      const _risk = Math.max(0.01, entryPx - stop);
      const _reward = Math.max(0, target - entryPx);
      ratio = _reward / _risk;
      reward = _reward;
      risk = _risk;

      if (cfg.tightenStopOnHorizon && ratio < (cfg.dipMinRR ?? need)) {
        const needNow = cfg.dipMinRR ?? need;
        const maxRisk = reward / Math.max(1e-9, needNow);
        if (risk > maxRisk) {
          const pad = Math.max(0, cfg.dipTightenStopATR ?? 0.25) * atr;
          const sup = findSupportsBelow(ctx?.data || [], entryPx)[0] ?? stop;
          const structuralFloor = sup - pad;
          const floor = Math.max(structuralFloor, stop);
          const proposed = Math.max(entryPx - maxRisk, floor);
          if (proposed > stop && proposed < entryPx) {
            stop = proposed;
            risk = entryPx - stop;
            ratio = reward / Math.max(1e-9, risk);
          }
        }
      }
    }
  }

  let needEff = need;
  if (horizonClamped) {
    needEff = Math.max(
      need - (cfg.horizonRRRelief ?? 0.1),
      cfg.minRRbase ?? 1.35
    );
  }

  // 7) Acceptable / probation
  let acceptable = ratio >= needEff;
  const allowProb = !!cfg.allowProbation;
  const rsiHere = Number.isFinite(stock.rsi14)
    ? stock.rsi14
    : rsiFromData(ctx?.data || [], 14);
  const probation =
    allowProb &&
    !acceptable &&
    ratio >= needEff - (cfg.probationRRSlack ?? 0.02) &&
    (ms.trend === "STRONG_UP" || ms.trend === "UP") &&
    rsiHere < (cfg.probationRSIMax ?? 58);

  acceptable = acceptable || probation;

  return {
    acceptable,
    ratio,
    stop,
    target,
    need: needEff,
    atr,
    risk,
    reward,
    probation,
    horizonClamped,
    supplyWallBlocked: supplyWall?.blocked || false,
    scootBlocked,
    scootBlockReason,
  };
}

function computeMarketContext(market, cfg) {
  const levels = Array.isArray(market?.dataForLevels)
    ? market.dataForLevels
    : null;
  const gates = Array.isArray(market?.dataForGates)
    ? market.dataForGates
    : null;
  if (!levels?.length || !gates?.length) return null;

  const series = cfg.marketUseTodayIfPresent ? levels : gates;
  if (series.length < 20) return null;

  const last = series.at(-1);
  const o = Number(last?.open);
  const c = Number(last?.close);
  if (!(Number.isFinite(o) && Number.isFinite(c) && o > 0)) return null;

  const dayPct = ((c - o) / o) * 100;
  const atr = calcATRLike(gates, 14);
  const moveATR = atr > 0 ? (c - o) / atr : 0;

  const impulse =
    dayPct >= (cfg.marketImpulseVetoPct ?? 1.8) ||
    moveATR >= (cfg.marketImpulseVetoATR ?? 1.0);

  return {
    ticker: market?.ticker || "MARKET",
    dayPct,
    atr,
    moveATR,
    impulse,
    lastDate: last?.date,
  };
}

function calcATRLike(data, p = 14) {
  if (!Array.isArray(data) || data.length < p + 1) return 0;
  const trs = [];
  for (let i = data.length - p; i < data.length; i++) {
    const h = Number(data[i]?.high ?? data[i]?.close ?? 0);
    const l = Number(data[i]?.low ?? data[i]?.close ?? 0);
    const pc = Number(data[i - 1]?.close ?? data[i]?.close ?? 0);
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

/* ============================ Guards (Enhanced) ============================ */
function guardVeto(
  stock,
  data,
  px,
  rr,
  ms,
  cfg,
  nearestRes,
  _kind,
  resListIn,
  weeklyRange,
  marketCtx
) {
  const details = {};
  details.rrNeed = Number(rr?.need);
  details.rrHave = Number(rr?.ratio);

  const atr = Math.max(num(stock.atr14), px * 0.005, 1e-6);

  // ========== ENHANCED: Weekly Range + Trend Context ==========
  // Philosophy: Be surgical with "falling knife" detection
  // - Only veto when BOTH conditions are met:
  //   1. Price is in the bottom 35% of its 12-week range
  //   2. Weekly trend is confirmed DOWN (Price < MA13 < MA26)
  // - This allows buying dips in strong stocks even when "cheap"
  if (
    cfg.useWeeklyRangeGuard &&
    weeklyRange &&
    Number.isFinite(weeklyRange.pos)
  ) {
    details.weeklyPos = weeklyRange.pos;
    details.weeklyLo = weeklyRange.lo;
    details.weeklyHi = weeklyRange.hi;
    details.weeklyTrend = weeklyRange.weeklyTrend;
    details.weeklyMA13 = weeklyRange.ma13;
    details.weeklyMA26 = weeklyRange.ma26;

    const topVeto = Number(cfg.weeklyTopVetoPos ?? 0.5);
    const adjTopVeto =
      ms.trend === "STRONG_UP" ? Math.min(0.85, topVeto + 0.05) : topVeto;

    const tkr = stock?.ticker || "UNK";
    const pos = weeklyRange.pos;

    if (cfg.debug) {
      console.log(
        `[${tkr}] WeeklyRangeGuard pos=${(pos * 100).toFixed(1)}% trend=${
          weeklyRange.weeklyTrend
        }`,
        {
          threshold: adjTopVeto,
          weeklyMA13: weeklyRange.ma13,
          weeklyMA26: weeklyRange.ma26,
        }
      );
    }

    // Standard top-of-range veto (unchanged)
    if (pos >= adjTopVeto) {
      return {
        veto: true,
        reason: `Weekly range too high (pos ${(pos * 100).toFixed(0)}% ≥ ${(
          adjTopVeto * 100
        ).toFixed(0)}%)`,
        details,
      };
    }

    // REFINED: Falling knife detection — BOTH conditions must be met
    // Condition 1: Price in bottom 35% of weekly range
    // Condition 2: Weekly trend confirmed DOWN (price < MA13 < MA26)
    const fallingKnifePos = cfg.weeklyFallingKnifePos ?? 0.35;
    const inBottomZone = pos < fallingKnifePos;
    const weeklyTrendConfirmedDown = weeklyRange.weeklyTrend === "DOWN"; // Price < MA13 < MA26

    if (
      cfg.weeklyTrendVetoEnabled &&
      inBottomZone &&
      weeklyTrendConfirmedDown
    ) {
      return {
        veto: true,
        reason: `Falling knife: pos ${(pos * 100).toFixed(0)}% (bottom ${(
          fallingKnifePos * 100
        ).toFixed(0)}% of range) with weekly trend DOWN (px < MA13 < MA26)`,
        details,
      };
    }

    // If in bottom zone but weekly trend is UP/NEUTRAL — allow the trade
    // This is a legitimate "buy the dip in a strong stock" scenario
    if (inBottomZone && !weeklyTrendConfirmedDown) {
      details.bottomZoneAllowed = true;
      details.bottomZoneReason = `Price in bottom ${(
        fallingKnifePos * 100
      ).toFixed(0)}% but weekly trend is ${
        weeklyRange.weeklyTrend || "unknown"
      } — allowing dip buy`;
    }
  }

  // --- Market impulse veto ---
  if (cfg.marketVetoEnabled && marketCtx?.impulse) {
    const dayPct = Number(marketCtx.dayPct) || 0;
    const thrPct = Number(cfg.marketImpulseVetoPct ?? 1.8);

    if (dayPct > 0) {
      const reason = `Market impulse day (${dayPct.toFixed(
        1
      )}% ≥ ${thrPct.toFixed(1)}%) — skip DIP buys`;

      if (cfg.debug) {
        console.log(`[${stock?.ticker}] MARKET VETO ❌`, { reason, marketCtx });
      }

      return {
        veto: true,
        reason,
        details: { ...details, market: marketCtx },
      };
    }
  }

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
  const resList =
    Array.isArray(resListIn) && resListIn.length
      ? resListIn
      : findResistancesAbove(data, px, stock, cfg);
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
    const metrics = { n };
    return {
      pass: false,
      why: `Not enough bars for liquidity window (${n})`,
      metrics,
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
  const atr = Math.max(Number(stock.atr14) || 0, 1e-6);
  const atrTicks = atr / Math.max(tick, 1e-9);

  const metrics = { adv, avVol, px, atr, tick, atrTicks, n };
  const thresholds = {
    minADVNotional: cfg.minADVNotional ?? 0,
    minAvgVolume: cfg.minAvgVolume ?? 0,
    minClosePrice: cfg.minClosePrice ?? 0,
    minATRTicks: cfg.minATRTicks ?? 0,
  };

  const near = cfg.liqNearMargin ?? 0.15;
  const ratios = {
    advR: thresholds.minADVNotional ? adv / thresholds.minADVNotional : null,
    volR: thresholds.minAvgVolume ? avVol / thresholds.minAvgVolume : null,
    pxR: thresholds.minClosePrice ? px / thresholds.minClosePrice : null,
    atrTicksR: thresholds.minATRTicks
      ? atrTicks / thresholds.minATRTicks
      : null,
  };

  const warnKeys = [];
  for (const [k, r] of Object.entries(ratios)) {
    if (r !== null && Number.isFinite(r) && r <= 1 + near)
      warnKeys.push(k.replace("R", ""));
  }
  const whyWarn = warnKeys.length
    ? `near threshold: ${warnKeys.join(", ")}`
    : "";

  return { pass: true, why: whyWarn, metrics, thresholds, ratios };
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
  steps.push({
    when: `T+${cfg.maxHoldingBars} bars`,
    condition: `Exit on close of bar ${cfg.maxHoldingBars}`,
    stopLoss: undefined,
    priceTarget: undefined,
    note: `Time-based exit: force close by bar ${cfg.maxHoldingBars}`,
  });

  return steps;
}

function noEntry(baseReason, ctx, tele, T, cfg) {
  const reason = baseReason;
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
    liquidity: packLiquidity(tele, cfg),
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
function findResistancesAbove(data, px, stock, cfg) {
  const lookback = Math.max(10, Number(cfg?.resistanceLookbackBars) || 40);
  const win = data.slice(-lookback);
  const ups = [];
  for (let i = 2; i < win.length - 2; i++) {
    const h = num(win[i].high);
    if (h > px && h > num(win[i - 1].high) && h > num(win[i + 1].high))
      ups.push(h);
  }

  if (cfg?.include52wAsResistance) {
    const yHigh = num(stock.fiftyTwoWeekHigh);
    if (yHigh > px) ups.push(yHigh);
  }

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
    horizonClamped: !!rr.horizonClamped,
    scootBlocked: !!rr.scootBlocked,
    scootBlockReason: rr.scootBlockReason || "",
  };
}

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
        tapeReading: { pass: g.tapeReading?.pass, why: g.tapeReading?.why },
      },
      rr: {
        checked: rr.checked,
        acceptable: rr.acceptable,
        ratio: rr.ratio,
        need: rr.need,
        stop: rr.stop,
        target: rr.target,
        probation: rr.probation,
        horizonClamped: rr.horizonClamped,
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

function maSeries(data, n) {
  const closes = data.map((d) => +d.close || 0);
  const out = new Array(closes.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= n) sum -= closes[i - n];
    if (i + 1 >= n) out[i] = sum / n;
  }
  return out;
}

export function goldenCross25Over75BarsAgo(data) {
  const last = data.length - 1;
  if (last < 74) return null;

  const ma25 = maSeries(data, 25);
  const ma75 = maSeries(data, 75);

  if (
    !(
      Number.isFinite(ma25[last]) &&
      Number.isFinite(ma75[last]) &&
      ma25[last] > ma75[last]
    )
  ) {
    return null;
  }

  for (let i = last; i >= 1; i--) {
    if (
      Number.isFinite(ma25[i]) &&
      Number.isFinite(ma75[i]) &&
      Number.isFinite(ma25[i - 1]) &&
      Number.isFinite(ma75[i - 1]) &&
      ma25[i] > ma75[i] &&
      ma25[i - 1] <= ma75[i - 1]
    ) {
      return last - i;
    }
  }
  return null;
}

export function dailyFlipBarsAgo(data) {
  const last = data.length - 1;
  if (last < 74) return null;

  const m5 = maSeries(data, 5);
  const m25 = maSeries(data, 25);
  const m75 = maSeries(data, 75);

  const isFiniteTriple = (i) =>
    Number.isFinite(m5[i]) &&
    Number.isFinite(m25[i]) &&
    Number.isFinite(m75[i]);

  const stacked = (i) => isFiniteTriple(i) && m5[i] > m25[i] && m25[i] > m75[i];

  if (!stacked(last)) return null;

  for (let i = last; i >= 1; i--) {
    if (stacked(i) && !stacked(i - 1)) {
      return last - i;
    }
  }
  return null;
}

function packLiquidity(tele, cfg) {
  const g = tele?.gates?.liquidity || {};
  const thresholds = {
    minADVNotional: cfg?.minADVNotional ?? null,
    minAvgVolume: cfg?.minAvgVolume ?? null,
    minClosePrice: cfg?.minClosePrice ?? null,
    minATRTicks: cfg?.minATRTicks ?? null,
  };
  const m = g.metrics || tele?.context?.liquidity || null;
  const ratios = m
    ? {
        advR: thresholds.minADVNotional
          ? m.adv / thresholds.minADVNotional
          : null,
        volR: thresholds.minAvgVolume
          ? m.avVol / thresholds.minAvgVolume
          : null,
        pxR: thresholds.minClosePrice ? m.px / thresholds.minClosePrice : null,
        atrTicksR: thresholds.minATRTicks
          ? m.atrTicks / thresholds.minATRTicks
          : null,
      }
    : null;

  let severity =
    g.pass === false ? "fail" : typeof g.pass === "boolean" ? "pass" : "unk";

  let warnKeys = [];
  const near = Number.isFinite(tele?.context?.liqNearMargin)
    ? tele.context.liqNearMargin
    : 0.15;
  if (g.pass && ratios) {
    const checks = [
      ["adv", ratios.advR],
      ["vol", ratios.volR],
      ["px", ratios.pxR],
      ["atrTicks", ratios.atrTicksR],
    ].filter(([, r]) => r !== null && Number.isFinite(r));
    for (const [k, r] of checks) {
      if (r <= 1 + near) warnKeys.push(k);
    }
    if (warnKeys.length) severity = "warn";
  }

  const why =
    g.why ||
    (severity === "warn" ? `near threshold: ${warnKeys.join(", ")}` : "");
  return { pass: !!g.pass, severity, why, metrics: m, thresholds, ratios };
}

export { getConfig, summarizeTelemetryForLog };
