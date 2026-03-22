// entry/rrAnalysis.js — Risk/Reward analysis with SCOOT target lift + supply wall awareness

import { rsiFromData } from "../../indicators.js";
import { num, isFiniteN, findResistancesAbove, findSupportsBelow } from "./entryHelpers.js";

export function analyzeRR(entryPx, stop, target, stock, ms, cfg, ctx = {}) {
  const atr = Math.max(num(stock.atr14), entryPx * 0.005, 1e-6);

  // Early stop sanity check
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
  const supplyWall = ctx?.supplyWallCheck;
  let scootBlocked = false;
  let scootBlockReason = "";

  if (cfg.scootEnabled && Array.isArray(resList) && resList.length) {
    const atrCap =
      ctx?.kind === "DIP"
        ? cfg.scootATRCapDIP ?? 4.2
        : cfg.scootATRCapNonDIP ?? 3.5;

    // First hop
    if (ratio < need && resList.length >= 2) {
      const nextRes = resList[1];
      const lifted = Math.min(nextRes, entryPx + atrCap * atr);

      const wallBlocksLift =
        supplyWall?.blocked && supplyWall.wall.level < lifted;

      if (lifted > target && !wallBlocksLift) {
        target = lifted;
        reward = Math.max(0, target - entryPx);
        ratio = reward / risk;
      } else if (wallBlocksLift) {
        scootBlocked = true;
        scootBlockReason = `Supply wall at ${supplyWall.wall.level.toFixed(
          0
        )} blocks target lift to ${lifted.toFixed(0)}`;
      }
    }

    // Second hop
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
          const sup = findSupportsBelow(ctx?.data || [], entryPx, stock)[0] ?? stop;
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
