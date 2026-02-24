// entry/index.js — analyzeDipEntry orchestrator + re-exports for backward compatibility

import { detectDipBounce, weeklyRangePositionFromDaily } from "../dip.js";
import { detectPreBreakoutSetup } from "../breakout.js";
import { detectBPB } from "../bpb.js";
import { detectSPC } from "../spc.js";
import { detectOXR } from "../oxr.js";
import { detectRRProbation } from "../rrp.js";
import { sma, rsiFromData } from "../../indicators.js";

import { getConfig } from "./entryConfig.js";
import { assessTapeReading, detectSupplyWalls } from "./tapeReading.js";
import { analyzeRR } from "./rrAnalysis.js";
import { guardVeto } from "./guardVeto.js";
import {
  teleGlobal,
  teleInit,
  pushBlock,
  mkTracer,
  num,
  isFiniteN,
  avg,
  near,
  fmt,
  toTick,
  inferTickFromPrice,
  findResistancesAbove,
  findSupportsBelow,
  getMarketStructure,
  computeMarketContext,
  assessLiquidity,
  computeLimitBuyOrder,
  buildSwingTimeline,
  noEntry,
  buildNoReason,
  toTeleRR,
  packLiquidity,
  goldenCross25Over75BarsAgo,
  dailyFlipBarsAgo,
  summarizeBlocks,
  summarizeTelemetryForLog,
} from "./entryHelpers.js";

export function analyzeDipEntry(stock, historicalData, opts = {}) {
  console.log("analyzeDipEntry running", stock?.ticker);
  const cfg = getConfig(opts);
  const gatesData =
    Array.isArray(opts?.dataForGates) && opts.dataForGates.length
      ? opts.dataForGates
      : historicalData;

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

  // ---------- Tape Reading Gate ----------
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

  const tapeFlags = {
    requireStrongerBounce: tapeReading.requireStrongerBounce || false,
    ma5ResistanceActive: tapeReading.ma5ResistanceActive || false,
  };

  // ---------- Liquidity ----------
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

  // Mirror numeric diagnostics into distros
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

  // ---------- Minimal structure gate ----------
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

  // ---------- RR + Guards ----------
  if (dip?.trigger && structureGateOk) {
    const resList = findResistancesAbove(dataForLevels, px, stock, cfg) || [];

    const atrCap = cfg.scootATRCapDIP ?? 4.2;
    const horizonCap =
      px + (cfg.maxHoldingBars ?? 8) * (cfg.atrPerBarEstimate ?? 0.55) * atr;
    const maxPlausibleTarget = Math.max(
      dip.target,
      px + atrCap * atr,
      horizonCap,
      resList[2] || 0
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
      supplyWallCheck,
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
        reasons: gv.reasons || [],
        details: gv.details || {},
      };

      if (gv.veto) {
        reasons.push(`DIP guard veto: ${gv.reason}`);
        // Log all veto reasons, not just the first
        for (const v of (gv.reasons || [{ code: "VETO_OTHER", reason: gv.reason }])) {
          const code = `VETO_${v.code || "OTHER"}`;
          pushBlock(tele, code, "guard", v.reason, gv.details);
        }
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

  // ---------- Fallback entry detectors (when DIP doesn't produce a candidate) ----------
  if (candidates.length === 0) {
    const fallbackDetectors = [
      { name: "SPC", kind: "SPC ENTRY", fn: () => detectSPC(stock, dataForGates2, cfg, U) },
      { name: "BPB", kind: "BPB ENTRY", fn: () => detectBPB(stock, dataForGates2, cfg, U) },
      { name: "OXR", kind: "OXR ENTRY", fn: () => detectOXR(stock, dataForGates2, cfg, U) },
      { name: "BREAKOUT", kind: "BREAKOUT ENTRY", fn: () => {
        const bo = detectPreBreakoutSetup(stock, dataForGates2, cfg, U);
        // Normalize breakout interface: ready -> trigger, initialStop -> stop, firstTarget -> target
        return {
          trigger: !!bo.ready,
          stop: bo.initialStop,
          target: bo.firstTarget,
          nearestRes: bo.nearestRes,
          why: bo.why || "",
          waitReason: bo.waitReason || "",
          diagnostics: bo.diagnostics || {},
        };
      }},
      { name: "RRP", kind: "RRP ENTRY", fn: () => detectRRProbation(stock, dataForGates2, cfg, U) },
    ];

    for (const det of fallbackDetectors) {
      if (candidates.length > 0) break; // stop once we have a candidate

      let result;
      try { result = det.fn(); } catch (e) {
        T(det.name.toLowerCase(), "error", false, `${det.name} error: ${e?.message}`, {}, "verbose");
        continue;
      }

      T(
        det.name.toLowerCase(), "detect", !!result?.trigger,
        result?.trigger ? `${det.name} trigger` : result?.waitReason || `${det.name} not ready`,
        { why: result?.why, diag: result?.diagnostics },
        "verbose"
      );

      // Record in telemetry
      tele[det.name.toLowerCase()] = {
        trigger: !!result?.trigger,
        waitReason: result?.waitReason || "",
        why: result?.why || "",
        diagnostics: result?.diagnostics || {},
      };

      if (!result?.trigger) continue;

      // Run RR analysis
      const resList = findResistancesAbove(dataForLevels, px, stock, cfg) || [];
      const atrCap = cfg.scootATRCapNonDIP ?? 3.5;
      const horizonCap = px + (cfg.maxHoldingBars ?? 8) * (cfg.atrPerBarEstimate ?? 0.55) * atr;
      const maxPlausibleTarget = Math.max(result.target, px + atrCap * atr, horizonCap, resList[2] || 0);
      const supplyWallCheck = detectSupplyWalls(dataForLevels, px, maxPlausibleTarget, atr, cfg);

      const rr = analyzeRR(px, result.stop, result.target, stock, msFull, cfg, {
        kind: det.name,
        data: dataForLevels,
        resList,
        supplyWallCheck,
      });

      T(
        "rr", "calc", rr.acceptable,
        `${det.name} RR ${fmt(rr.ratio)} need ${fmt(rr.need)}`,
        { stop: rr.stop, target: rr.target, kind: det.name },
        "verbose"
      );

      if (!rr.acceptable) {
        reasons.push(`${det.name} RR too low: ${fmt(rr.ratio)} < ${fmt(rr.need)}`);
        continue;
      }

      // Run guard vetoes
      const weeklyRangeCtx = tele.context.weeklyRange;
      const marketCtxLocal = tele.context.market || null;

      const gv = guardVeto(
        stock, dataForLevels, px, rr, msFull, cfg,
        result.nearestRes, det.name, resList, weeklyRangeCtx, marketCtxLocal
      );

      T(
        "guard", "veto", !gv.veto,
        gv.veto ? `${det.name} VETO: ${gv.reason}` : `${det.name} no veto`,
        gv.details, "verbose"
      );

      if (gv.veto) {
        reasons.push(`${det.name} guard veto: ${gv.reason}`);
        continue;
      }

      candidates.push({
        kind: det.kind,
        why: result.why,
        stop: rr.stop,
        target: rr.target,
        rr,
        guard: gv.details,
      });
    }
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
    limitBuyOrder,
    stopLoss: toTick(best.stop, stock),
    priceTarget: toTick(best.target, stock),
    timeline: buildSwingTimeline(px, best, best.rr, msFull, cfg),
    telemetry: { ...tele, trace: T.logs },
    flipBarsAgo,
    goldenCrossBarsAgo,
    liquidity: packLiquidity(tele, cfg),
  };
}

// Re-export everything for backward compatibility
export { getConfig } from "./entryConfig.js";
export { summarizeBlocks, summarizeTelemetryForLog, goldenCross25Over75BarsAgo, dailyFlipBarsAgo } from "./entryHelpers.js";
