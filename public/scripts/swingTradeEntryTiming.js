// swingTradeEntryTiming.js
// Public entrypoint

import { getConfig } from "./config.js";
import { validateInputs } from "./validate.js";
import { analyzeMarketStructure } from "./marketStructure.js";
import { checkEntryConditions } from "./entryConditions.js";
import { analyzeRiskReward } from "./riskReward.js";
import { confirmEntryTiming } from "./timing.js";
import { validateVolumeMomentum } from "./volMomentum.js";
import { getEntryGuards } from "./guards.js";
import { makeFinalDecision } from "./decision.js";
import { n } from "./utils.js";

export function analyzeSwingTradeEntry(stock, historicalData, opts = {}) {
  const cfg = getConfig(opts.mode || "balanced", opts);

  if (!validateInputs(stock, historicalData)) {
    return {
      buyNow: false,
      reason: "Invalid or insufficient data for analysis",
      debug: cfg.debug ? { failedAt: "validateInputs" } : undefined,
    };
  }

  // Chronological candles
  const sortedData = [...historicalData].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );
  const lastBar = sortedData[sortedData.length - 1] || {};

  // Robust price-action (works pre/after market)
  if (!Number.isFinite(stock.currentPrice) || stock.currentPrice <= 0) {
    stock.currentPrice = Number(lastBar.close) || 0;
  }
  if (!Number.isFinite(stock.openPrice) || stock.openPrice <= 0) {
    stock.openPrice = Number(lastBar.open) || stock.currentPrice;
  }
  if (!Number.isFinite(stock.prevClosePrice) || stock.prevClosePrice <= 0) {
    stock.prevClosePrice = Number(lastBar.close) || stock.openPrice;
  }

  const pxNow = n(stock.currentPrice) || n(lastBar.close);
  const pxOpen = n(stock.openPrice) || n(lastBar.open);
  const prevClose = n(stock.prevClosePrice) || n(lastBar.close);
  const priceActionPositive =
    pxNow > Math.max(pxOpen, prevClose) || n(lastBar.close) > n(lastBar.open);

  const analysis = {
    entryQuality: 0,
    technicalChecks: {},
    stopLoss: Number.isFinite(opts.stopLoss) ? opts.stopLoss : null,
    priceTarget: Number.isFinite(opts.priceTarget) ? opts.priceTarget : null,
  };

  // 1) Market Structure
  const marketStructure = analyzeMarketStructure(stock, sortedData);
  analysis.technicalChecks.marketStructure = marketStructure;

  // 2) Entry Conditions
  const entryConditions = checkEntryConditions(stock, sortedData, cfg);
  analysis.technicalChecks.entryConditions = entryConditions;

  // 3) Risk/Reward
  const riskReward = analyzeRiskReward(stock, marketStructure, cfg, {
    stopLoss: analysis.stopLoss,
    target: analysis.priceTarget,
  });
  analysis.technicalChecks.riskReward = riskReward;
  if (riskReward.adjustedStopLoss)
    analysis.stopLoss = riskReward.adjustedStopLoss;
  if (riskReward.reward > 0 && !analysis.priceTarget) {
    analysis.priceTarget = pxNow + riskReward.reward;
  }

  // 4) Timing
  const timingSignals = confirmEntryTiming(stock, sortedData);
  analysis.technicalChecks.timing = timingSignals;

  // 5) Volume/Momentum
  const volumeMomentum = validateVolumeMomentum(stock, sortedData);
  analysis.technicalChecks.volumeMomentum = volumeMomentum;

  // 6) Guards
  const guard = getEntryGuards(
    stock,
    sortedData,
    marketStructure,
    entryConditions,
    cfg
  );
  if (guard.vetoed) {
    return {
      buyNow: false,
      reason: guard.reason,
      debug: cfg.debug
        ? { gate: "guards", guard, marketStructure, entryConditions }
        : undefined,
    };
  }

  // 7) Final decision
  const result = makeFinalDecision(
    stock,
    analysis,
    entryConditions,
    timingSignals,
    riskReward,
    marketStructure,
    volumeMomentum,
    priceActionPositive,
    cfg
  );

  if (cfg.debug) {
    const openPx = Number.isFinite(stock.openPrice)
      ? stock.openPrice
      : stock.currentPrice;
    const dayPct = openPx
      ? (((stock.currentPrice || openPx) - openPx) / openPx) * 100
      : 0;
    result.debug = {
      cfg,
      marketStructure,
      entryConditions,
      timingSignals,
      riskReward,
      volumeMomentum,
      priceActionPositive,
      dayPct,
      entryQuality: analysis.entryQuality,
    };
  }
  return result;
}
