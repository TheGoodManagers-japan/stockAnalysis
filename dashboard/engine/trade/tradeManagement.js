// dashboard/engine/trade/tradeManagement.js
// Extracted from public/scripts/core/main.js (lines ~589-930)
// Trade management signal logic for portfolio positions.
// ESM — no browser globals

import { calcATR, calcADX14, sma } from "../regime/regimeLabels.js";
import { num as n, lastSwingLowRecent } from "../helpers.js";

/* ======================== Private helpers ======================== */

/** Last close from candle array */
function lastClose(data) {
  return Number(data?.at?.(-1)?.close) || 0;
}

/** Last swing low (simple pivot scan on recent window) */
const lastSwingLow = lastSwingLowRecent;

/** Did price make a new lower low vs prior swing lows (recent window)? */
function madeLowerLow(data) {
  if (!Array.isArray(data) || data.length < 4) return false;
  const w = data.slice(-6);
  let prevSwing = Infinity;
  for (let i = 1; i < w.length - 1; i++) {
    const li = Number(w[i]?.low ?? w[i]?.close ?? Infinity);
    const lim = Number(w[i - 1]?.low ?? w[i - 1]?.close ?? Infinity);
    const lip = Number(w[i + 1]?.low ?? w[i + 1]?.close ?? Infinity);
    if (li < lim && li < lip) prevSwing = Math.min(prevSwing, li);
  }
  const lastLow = Number(w.at(-1)?.low ?? w.at(-1)?.close ?? Infinity);
  return lastLow < prevSwing;
}

/** Proximity helper (within pct of level) */
function near(px, lvl, pct) {
  const a = Number(px);
  const b = Number(lvl);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return false;
  return Math.abs(a - b) / b <= pct;
}

/** Recent pivot high (looks back ~20 bars excluding the last 2) */
function recentPivotHigh(data) {
  if (!Array.isArray(data) || data.length < 12) return 0;
  const win = data.slice(-22, -2);
  if (!win.length) return 0;
  return Math.max(...win.map((d) => Number(d?.high ?? d?.close ?? 0)));
}

/** Structural trailing stop: behind last swing low and/or under MA25 */
function trailingStructStop(historicalData, ma25, atr) {
  const swing = lastSwingLow(historicalData);
  const bySwing = swing - 0.5 * atr;
  const byMA = ma25 > 0 ? ma25 - 0.6 * atr : -Infinity;
  return Math.max(bySwing, byMA);
}

/* ======================== Main signal ======================== */

/**
 * getTradeManagementSignal_V3 -- entry-aware, completed-bars logic
 */
export function getTradeManagementSignal_V3(
  stock,
  trade,
  historicalData,
  ctx = {}
) {
  function clampStopLoss(px, atr, proposed, floorStop = 0) {
    const _px = n(px);
    const _atr = Math.max(n(atr), _px * 0.005, 1e-6);
    const minBuffer = Math.max(_px * 0.002, 0.2 * _atr, 1);
    let s = Math.max(n(proposed), n(floorStop));
    s = Math.min(s, _px - minBuffer);
    if (!Number.isFinite(s) || s <= 0) s = Math.max(1, n(floorStop));
    return Math.round(s);
  }

  const px = n(stock.currentPrice);
  const entry = n(trade.entryPrice);
  const stop = n(trade.stopLoss);
  const target = n(trade.priceTarget);

  const ma25 = n(stock.movingAverage25d) || sma(historicalData, 25);
  const atr = Math.max(
    n(stock.atr14),
    calcATR(historicalData, 14),
    px * 0.005,
    1e-6
  );

  const sentiment = n(ctx.sentimentScore) || 4;
  const ml = n(ctx.deep?.mlScore);
  const adx = Number.isFinite(ctx.adx) ? ctx.adx : calcADX14(historicalData);
  const isExtended = !!ctx.isExtended;

  const initialStop = Number.isFinite(trade.initialStop)
    ? trade.initialStop
    : stop;
  const riskPerShare = Math.max(0.01, entry - initialStop);
  const progressR = (px - entry) / riskPerShare;

  function maAtIndex(data, p, idx) {
    if (!Array.isArray(data) || idx == null) return 0;
    if (idx + 1 < p) return 0;
    let s = 0;
    for (let i = idx - p + 1; i <= idx; i++) s += n(data[i]?.close);
    return s / p;
  }

  let entryIdx = null;
  if (ctx?.entryDate instanceof Date && Array.isArray(historicalData)) {
    for (let i = historicalData.length - 1; i >= 0; i--) {
      const d =
        historicalData[i]?.date instanceof Date
          ? historicalData[i].date
          : new Date(historicalData[i]?.date);
      if (d <= ctx.entryDate) {
        entryIdx = i;
        break;
      }
    }
  } else if (Number.isFinite(ctx?.barsSinceEntry)) {
    entryIdx = Math.max(0, historicalData.length - 2 - ctx.barsSinceEntry);
  }

  const ma25AtEntry = Number.isFinite(entryIdx)
    ? maAtIndex(historicalData, 25, entryIdx)
    : 0;
  const entryCloseApprox = Number.isFinite(entryIdx)
    ? n(historicalData[entryIdx]?.close) || entry
    : entry;

  const nowBelowMA25 = lastClose(historicalData) < ma25 && ma25 > 0;
  const entryWasAbove = ma25AtEntry > 0 && entryCloseApprox >= ma25AtEntry;
  const crossedDownPostEntry = entryWasAbove && nowBelowMA25;
  const belowSinceEntry = !entryWasAbove && nowBelowMA25;

  // 1) Hard stop
  if (px <= stop)
    return {
      status: "Sell Now",
      reason: `Stop-loss hit at \u00a5${Math.round(stop)}.`,
    };

  // 2) Structural breakdown
  const deep = (ctx && typeof ctx === "object" ? ctx.deep : null) || {};
  const iReg =
    (deep && typeof deep === "object" ? deep.intermediateRegime : null) || null;
  const bearishContext =
    sentiment >= 6 ||
    ml <= -1.5 ||
    (iReg &&
      iReg.type === "TRENDING" &&
      Array.isArray(iReg.characteristics) &&
      iReg.characteristics.includes("DOWNTREND"));

  if (nowBelowMA25 && madeLowerLow(historicalData) && bearishContext) {
    return {
      status: "Sell Now",
      reason: "Trend break: close < MA25 with lower low and bearish context.",
    };
  }

  // 3) Target reached
  const strengthOK =
    sentiment <= 3 &&
    (ml >= 1 || ctx.deep?.longTermRegime?.type === "TRENDING") &&
    !isExtended &&
    (adx ? adx > 25 : true);

  if (px >= target) {
    if (strengthOK) {
      const proposed = Math.max(
        stop,
        trailingStructStop(historicalData, ma25, atr)
      );
      const newSL = clampStopLoss(px, atr, proposed, stop);
      return {
        status: "Scale Partial",
        reason: `Target reached (\u00a5${Math.round(
          target
        )}). Context strong -- scale 50% and trail the rest. New stop: \u00a5${newSL}.`,
        updatedStopLoss: newSL,
        suggest: { takeProfitPct: 50 },
      };
    }
    return {
      status: "Sell Now",
      reason: `Take profit at target (\u00a5${Math.round(
        target
      )}). Context not strong enough to extend.`,
    };
  }

  // 4) R milestones
  if (progressR >= 2) {
    const proposed = Math.max(
      stop,
      entry + 1.2 * riskPerShare,
      trailingStructStop(historicalData, ma25, atr)
    );
    const newSL = clampStopLoss(px, atr, proposed, stop);
    return {
      status: "Protect Profit",
      reason: `Up >= +2R. Trail with structure/MA25. New stop: \u00a5${newSL}.`,
      updatedStopLoss: newSL,
    };
  }
  if (progressR >= 1) {
    const proposed = Math.max(stop, entry); // to breakeven
    const newSL = clampStopLoss(px, atr, proposed, stop);
    return {
      status: "Protect Profit",
      reason: `Up >= +1R. Move stop to breakeven at \u00a5${newSL}.`,
      updatedStopLoss: newSL,
    };
  }

  // 4b) No-progress creep
  {
    const NP_BARS = 5;
    const NEED_TOUCH_R = 0.5;
    const halfRLevel = entry + NEED_TOUCH_R * riskPerShare;

    let barsSinceEntry = ctx?.barsSinceEntry ?? null;
    if (
      barsSinceEntry == null &&
      ctx?.entryDate instanceof Date &&
      Array.isArray(historicalData)
    ) {
      const completed = historicalData.slice(0, -1);
      barsSinceEntry = completed.reduce((acc, b) => {
        const d = b?.date instanceof Date ? b.date : new Date(b?.date);
        return acc + (d > ctx.entryDate ? 1 : 0);
      }, 0);
    }

    let win = Array.isArray(historicalData)
      ? historicalData.slice(-NP_BARS - 1, -1)
      : [];
    if (ctx?.entryDate instanceof Date && Array.isArray(historicalData)) {
      const afterEntry = historicalData.filter((b) => {
        const d = b?.date instanceof Date ? b.date : new Date(b?.date);
        return d > ctx.entryDate;
      });
      if (afterEntry.length) win = afterEntry.slice(0, -1);
    }

    const touchedHalfR = (win || []).some(
      (b) => n(b?.high ?? b?.close) >= halfRLevel
    );
    const enoughBars = (barsSinceEntry ?? 0) >= NP_BARS;
    const clearlyRed = progressR < -0.1;

    if (
      enoughBars &&
      !touchedHalfR &&
      progressR < NEED_TOUCH_R &&
      !clearlyRed
    ) {
      const structural = trailingStructStop(historicalData, ma25, atr);
      const creepTarget = Math.min(entry - 0.2 * riskPerShare, entry - 0.01);
      let proposed = Math.max(stop, structural, creepTarget);

      const _atr = Math.max(atr, px * 0.005, 1e-6);
      const creepBuffer = Math.max(px * 0.003, 0.5 * _atr, 1);
      let newSL = Math.max(proposed, stop);
      newSL = Math.min(newSL, px - creepBuffer);
      if (!Number.isFinite(newSL) || newSL <= 0) newSL = stop;

      if (newSL > stop) {
        return {
          status: "Protect Profit",
          reason:
            (barsSinceEntry != null
              ? `No progress since entry (${barsSinceEntry} bars, no +${NEED_TOUCH_R}R touch). `
              : `No progress for ${NP_BARS}+ bars (no +${NEED_TOUCH_R}R touch). `) +
            `Creep stop toward breakeven conservatively. New stop: \u00a5${Math.round(
              newSL
            )}.`,
          updatedStopLoss: Math.round(newSL),
        };
      }
    }
  }

  // 5) Entry-kind aware holds
  const entryKind = (ctx.entryKind || "").toUpperCase();
  const aboveMA25 = px >= ma25 || ma25 === 0;

  if (
    (entryKind === "DIP" || entryKind === "RETEST") &&
    aboveMA25 &&
    sentiment <= 4
  ) {
    return {
      status: "Hold",
      reason:
        "Healthy pullback above MA25 after DIP/RETEST entry; sentiment not bearish.",
    };
  }
  if (entryKind === "BREAKOUT") {
    const pivot = recentPivotHigh(historicalData);
    const nearPivot = pivot > 0 && Math.abs(px - pivot) <= 1.3 * atr;
    const heldZone =
      pivot > 0 && n(historicalData.at(-1)?.low) >= pivot - 0.6 * atr;
    if (pivot && nearPivot && heldZone) {
      return {
        status: "Hold",
        reason: "Breakout retest holding prior pivot zone.",
      };
    }
  }

  // 6) Bearish engulf near resistance
  const last = historicalData?.at?.(-1) || {};
  const prev = historicalData?.at?.(-2) || {};
  const bearishEngulf =
    n(last.close) < n(last.open) &&
    n(prev.close) > n(prev.open) &&
    n(last.close) < n(prev.open) &&
    n(last.open) > n(prev.close);
  const near52wHigh = near(px, n(stock.fiftyTwoWeekHigh), 0.02);

  if (near52wHigh && bearishEngulf) {
    const proposed = Math.max(
      stop,
      trailingStructStop(historicalData, ma25, atr)
    );
    const newSL = clampStopLoss(px, atr, proposed, stop);
    return {
      status: "Protect Profit",
      reason: `Bearish engulfing near resistance -- tighten stop to \u00a5${newSL}.`,
      updatedStopLoss: newSL,
    };
  }

  // 7) DEFAULT -- structure-first, conservative for entries below MA25
  if (px >= ma25 || ma25 === 0) {
    return {
      status: "Hold",
      reason: "Uptrend structure intact (>= MA25). Allow normal volatility.",
    };
  } else {
    // Cap: before +1R we never raise stop to/above breakeven.
    const allowedMaxStop = progressR >= 1 ? Infinity : entry - 0.01;

    // If we were ABOVE MA25 at entry and crossed down -> protect.
    if (crossedDownPostEntry) {
      const proposed = Math.max(
        stop,
        trailingStructStop(historicalData, ma25, atr)
      );
      let newSL = clampStopLoss(px, atr, proposed, stop);
      newSL = Math.min(newSL, allowedMaxStop);
      if (newSL > stop) {
        return {
          status: "Protect Profit",
          reason: `Lost MA25 post-entry -- tighten to structure/MA stop at \u00a5${newSL}.`,
          updatedStopLoss: newSL,
        };
      }
      return {
        status: "Hold",
        reason:
          "Lost MA25 post-entry, but structural stop <= current stop. Hold.",
      };
    }

    // If we were already BELOW MA25 at entry -> be conservative:
    // Only tighten if (a) progress >= +0.5R OR (b) a completed-bar reclaim has occurred.
    const completedReclaim = !nowBelowMA25;
    if (!completedReclaim && progressR < 0.5) {
      return {
        status: "Hold",
        reason:
          "Below MA25 since entry -- no tighten until +0.5R progress or a completed MA25 reclaim.",
      };
    }

    const proposed = Math.max(
      stop,
      trailingStructStop(historicalData, ma25, atr)
    );
    let newSL = clampStopLoss(px, atr, proposed, stop);
    newSL = Math.min(newSL, allowedMaxStop);
    if (newSL > stop) {
      return {
        status: "Protect Profit",
        reason: `Below MA25 since entry but conditions met (progress/reclaim) -- tighten to structure/MA stop at \u00a5${newSL}.`,
        updatedStopLoss: newSL,
      };
    }
    return {
      status: "Hold",
      reason:
        "Below MA25 since entry -- conditions not met to tighten yet. Hold.",
    };
  }
}
