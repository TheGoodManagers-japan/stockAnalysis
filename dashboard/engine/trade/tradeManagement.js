// dashboard/engine/trade/tradeManagement.js
// Trade management signal logic for portfolio positions.
// V3 refactored: scored candidate system (all signals computed, then ranked).
// ESM — no browser globals

import { calcATR, calcADX14, sma } from "../regime/regimeLabels.js";
import { rsiFromData, calculateOBV } from "../indicators.js";
import { num as n, lastSwingLowRecent, toTick } from "../helpers.js";
import { EXIT_PROFILES } from "../analysis/exit_profiles.js";

/* ======================== Private helpers ======================== */

/** Last close from candle array */
function lastClose(data) {
  return Number(data?.at?.(-1)?.close) || 0;
}

/** Last swing low (simple pivot scan on recent window) */
const lastSwingLow = lastSwingLowRecent;

/** Did price make a new lower low vs prior swing lows (12-bar window)? */
function madeLowerLow(data) {
  if (!Array.isArray(data) || data.length < 4) return false;
  const w = data.slice(-12);
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

/** Detect bearish candlestick patterns (engulfing, evening star, shooting star) */
function detectBearishPatterns(last, prev, prev2) {
  const bearishEngulf =
    n(last.close) < n(last.open) &&
    n(prev.close) > n(prev.open) &&
    n(last.close) < n(prev.open) &&
    n(last.open) > n(prev.close);

  const eveningStar = (() => {
    const bar2Body = Math.abs(n(prev2.close) - n(prev2.open));
    const bar1Body = Math.abs(n(prev.close) - n(prev.open));
    const bar0Body = Math.abs(n(last.close) - n(last.open));
    const bar2Range = Math.max(n(prev2.high) - n(prev2.low), 1e-9);
    const bar0Range = Math.max(n(last.high) - n(last.low), 1e-9);
    return (
      n(prev2.close) > n(prev2.open) &&
      bar2Body > 0.5 * bar2Range &&
      bar1Body < 0.3 * bar2Body &&
      n(last.close) < n(last.open) &&
      bar0Body > 0.5 * bar0Range &&
      n(last.close) < n(prev2.open) + 0.5 * bar2Body
    );
  })();

  const shootingStar = (() => {
    const body = Math.abs(n(last.close) - n(last.open));
    const range = Math.max(n(last.high) - n(last.low), 1e-9);
    const upperWick = n(last.high) - Math.max(n(last.close), n(last.open));
    return (
      body < 0.35 * range &&
      upperWick > 1.5 * body &&
      Math.min(n(last.close), n(last.open)) - n(last.low) < 0.2 * range
    );
  })();

  const bearishPattern = bearishEngulf || eveningStar || shootingStar;
  const patternName = bearishEngulf
    ? "bearish engulfing"
    : eveningStar
      ? "evening star"
      : "shooting star";
  return { bearishPattern, patternName };
}

/** Compute barsSinceEntry from ctx or historicalData */
function computeBarsSinceEntry(ctx, historicalData) {
  if (ctx?.barsSinceEntry != null) return ctx.barsSinceEntry;
  if (ctx?.entryDate instanceof Date && Array.isArray(historicalData)) {
    const completed = historicalData.slice(0, -1);
    return completed.reduce((acc, b) => {
      const d = b?.date instanceof Date ? b.date : new Date(b?.date);
      return acc + (d > ctx.entryDate ? 1 : 0);
    }, 0);
  }
  return null;
}

/* ======================== Main signal ======================== */

/**
 * getTradeManagementSignal_V3 -- scored candidate system
 *
 * Computes ALL signal candidates, then selects the highest-priority one.
 * Entry-kind holds can override mid-priority Protect signals.
 *
 * ctx fields:
 *   entryKind, sentimentScore, entryDate, barsSinceEntry,
 *   deep, isExtended, news, scaledCount, exitProfileId
 */
export function getTradeManagementSignal_V3(
  stock,
  trade,
  historicalData,
  ctx = {}
) {
  // ─── CLAMP HELPER (uses stock from closure for tick rounding) ───
  function clampStopLoss(proposed, floorStop = 0) {
    const _px = n(px);
    const _atr = Math.max(n(atr), _px * 0.005, 1e-6);
    const minBuffer = Math.max(_px * 0.002, 0.2 * _atr, 1);
    let s = Math.max(n(proposed), n(floorStop));
    s = Math.min(s, _px - minBuffer);
    if (!Number.isFinite(s) || s <= 0) s = Math.max(1, n(floorStop));
    return toTick(s, stock);
  }

  // ─── PREAMBLE ───
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

  // ─── ENTRY INDEX & MA25 AT ENTRY ───
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

  // ─── SHARED COMPUTATIONS (hoisted, computed once) ───
  const barsSinceEntry = computeBarsSinceEntry(ctx, historicalData);
  const rsi = rsiFromData(historicalData, 14);
  const entryKind = (ctx.entryKind || "").toUpperCase();
  const aboveMA25 = px >= ma25 || ma25 === 0;
  const _madeLL = madeLowerLow(historicalData);

  // Bearish context
  const deep = ctx?.deep || {};
  const iReg = deep?.intermediateRegime || null;
  const bearishContext =
    sentiment >= 6 ||
    ml <= -1.5 ||
    (iReg &&
      iReg.type === "TRENDING" &&
      Array.isArray(iReg.characteristics) &&
      iReg.characteristics.includes("DOWNTREND"));

  // Strength check (reused by target + RSI checks)
  const strengthOK =
    sentiment <= 3 &&
    (ml >= 1 || ctx.deep?.longTermRegime?.type === "TRENDING") &&
    !isExtended &&
    (adx ? adx > 25 : true);

  // News context
  const news = ctx.news || null;

  // Entry-kind aware time stop thresholds
  const TIME_STOP_BARS = { DIP: 12, SPC: 12, BREAKOUT: 18, RETEST: 18, RRP: 8 };
  const timeStopThreshold = TIME_STOP_BARS[entryKind] || 12;

  // Candlestick patterns
  const last = historicalData?.at?.(-1) || {};
  const prev = historicalData?.at?.(-2) || {};
  const prev2 = historicalData?.at?.(-3) || {};
  const { bearishPattern, patternName } = detectBearishPatterns(last, prev, prev2);
  const near52wHigh = near(px, n(stock.fiftyTwoWeekHigh), 0.02);

  // Gap-down detection
  const gapDown = px < stop - 2 * atr;

  // ─── EXIT PROFILE STOP FLOOR ───
  let profileStopFloor = stop;
  if (ctx.exitProfileId) {
    const profile = EXIT_PROFILES.find((p) => p.id === ctx.exitProfileId);
    if (profile?.advance) {
      const state = {
        entry,
        stop,
        target,
        stopInit: initialStop,
        entryIdx: entryIdx ?? (historicalData.length - 2 - (barsSinceEntry ?? 0)),
        _trailStarted: progressR >= 2,
      };
      const bar = historicalData?.at(-1) || {};
      try {
        profile.advance({ bar, state, hist: historicalData, stock });
        const adjusted = toTick(Math.max(stop, state.stop), stock);
        if (adjusted > stop) profileStopFloor = adjusted;
      } catch (_) {
        // Profile advance failed; ignore, use default stop
      }
    }
  }

  // ─── SIGNAL CANDIDATES ───
  const candidates = [];

  // --- Priority 1: Hard stop hit ---
  if (px <= stop) {
    const reason = gapDown
      ? `[GAP DOWN > 2*ATR] Stop-loss hit at \u00a5${toTick(stop, stock)}.`
      : `Stop-loss hit at \u00a5${toTick(stop, stock)}.`;
    candidates.push({ priority: 1, status: "Sell Now", reason });
  }

  // --- Priority 2: Structural breakdown (2+ of 3 signals) ---
  const breakdownSignals = [nowBelowMA25, _madeLL, bearishContext].filter(Boolean).length;
  if (breakdownSignals >= 2 && (nowBelowMA25 || _madeLL)) {
    candidates.push({
      priority: 2,
      status: "Sell Now",
      reason: `Trend break: ${[
        nowBelowMA25 ? "close < MA25" : null,
        _madeLL ? "lower low" : null,
        bearishContext ? "bearish context" : null,
      ]
        .filter(Boolean)
        .join(" + ")}.`,
    });
  }

  // --- Priority 3: Target reached (scale-aware) ---
  if (px >= target) {
    const scaledCount = ctx.scaledCount || 0;
    if (strengthOK && scaledCount === 0) {
      const proposed = Math.max(stop, profileStopFloor, trailingStructStop(historicalData, ma25, atr));
      const newSL = clampStopLoss(proposed, stop);
      candidates.push({
        priority: 3,
        status: "Scale Partial",
        reason: `Target reached (\u00a5${toTick(target, stock)}). Context strong -- scale 50% and trail. New stop: \u00a5${newSL}.`,
        updatedStopLoss: newSL,
        suggest: { takeProfitPct: 50 },
      });
    } else if (strengthOK && scaledCount > 0) {
      candidates.push({
        priority: 3,
        status: "Sell Now",
        reason: `Target reached again (scaled ${scaledCount}x already). Take remaining profit.`,
      });
    } else {
      candidates.push({
        priority: 3,
        status: "Sell Now",
        reason: `Take profit at target (\u00a5${toTick(target, stock)}). Context not strong enough to extend.`,
      });
    }
  }

  // --- Priority 4: Time stop (entry-kind aware) ---
  // Check base time stop
  if ((barsSinceEntry ?? 0) >= timeStopThreshold && progressR < 0.5) {
    candidates.push({
      priority: 4,
      status: "Sell Now",
      reason: `Time stop: ${barsSinceEntry} bars without meaningful progress (${progressR.toFixed(1)}R). Limit: ${timeStopThreshold} for ${entryKind || "default"}.`,
    });
  }

  // --- Priority 5: R milestones (2R, 1R, 0.5R) ---
  if (progressR >= 2) {
    const proposed = Math.max(
      stop,
      profileStopFloor,
      entry + 1.2 * riskPerShare,
      trailingStructStop(historicalData, ma25, atr)
    );
    const newSL = clampStopLoss(proposed, stop);
    candidates.push({
      priority: 5,
      status: "Protect Profit",
      reason: `Up >= +2R. Trail with structure/MA25. New stop: \u00a5${newSL}.`,
      updatedStopLoss: newSL,
    });
  }
  if (progressR >= 1 && progressR < 2) {
    const proposed = Math.max(stop, profileStopFloor, entry);
    const newSL = clampStopLoss(proposed, stop);
    candidates.push({
      priority: 5,
      status: "Protect Profit",
      reason: `Up >= +1R. Move stop to breakeven at \u00a5${newSL}.`,
      updatedStopLoss: newSL,
    });
  }
  if (progressR >= 0.5 && progressR < 1.0) {
    const proposed = entry - 0.5 * riskPerShare;
    if (proposed > stop) {
      const newSL = clampStopLoss(proposed, stop);
      if (newSL > stop) {
        candidates.push({
          priority: 5,
          status: "Protect Profit",
          reason: `Up +${progressR.toFixed(1)}R. Reduce risk: new stop \u00a5${newSL}.`,
          updatedStopLoss: newSL,
        });
      }
    }
  }

  // --- Priority 6: RSI overbought at 1.5R+ ---
  if (rsi > 80 && progressR >= 1.5) {
    const proposed = Math.max(stop, profileStopFloor, trailingStructStop(historicalData, ma25, atr));
    const newSL = clampStopLoss(proposed, stop);
    candidates.push({
      priority: 6,
      status: "Scale Partial",
      reason: `RSI overbought (${rsi.toFixed(0)}) at +${progressR.toFixed(1)}R -- scale partial, tighten stop to \u00a5${newSL}.`,
      updatedStopLoss: newSL,
      suggest: { takeProfitPct: 30 },
    });
  }

  // --- Priority 7: Bearish patterns near 52w high ---
  if (near52wHigh && bearishPattern) {
    const proposed = Math.max(stop, profileStopFloor, trailingStructStop(historicalData, ma25, atr));
    const newSL = clampStopLoss(proposed, stop);
    candidates.push({
      priority: 7,
      status: "Protect Profit",
      reason: `${patternName} near resistance -- tighten stop to \u00a5${newSL}.`,
      updatedStopLoss: newSL,
    });
  }

  // --- Priority 8: OBV divergence at 1R+ (now reachable!) ---
  if (progressR >= 1 && Array.isArray(historicalData) && historicalData.length >= 20) {
    const recentData = historicalData.slice(-10);
    const priorData = historicalData.slice(-20, -10);
    const obvRecent = calculateOBV(recentData);
    const obvPrior = calculateOBV(priorData);
    const priceUp = n(recentData.at(-1)?.close) > n(priorData.at(-1)?.close);
    if (priceUp && obvRecent < obvPrior * 0.9) {
      const proposed = Math.max(stop, profileStopFloor, trailingStructStop(historicalData, ma25, atr));
      const newSL = clampStopLoss(proposed, stop);
      if (newSL > stop) {
        candidates.push({
          priority: 8,
          status: "Protect Profit",
          reason: `OBV divergence: price rising but volume declining -- tighten stop to \u00a5${newSL}.`,
          updatedStopLoss: newSL,
        });
      }
    }
  }

  // --- Priority 9: No-progress creep (5 bars without 0.5R touch) ---
  {
    const NP_BARS = 5;
    const NEED_TOUCH_R = 0.5;
    const halfRLevel = entry + NEED_TOUCH_R * riskPerShare;

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

    if (enoughBars && !touchedHalfR && progressR < NEED_TOUCH_R && !clearlyRed) {
      const structural = trailingStructStop(historicalData, ma25, atr);
      const creepTarget = Math.min(entry - 0.2 * riskPerShare, entry - 0.01);
      let proposed = Math.max(stop, profileStopFloor, structural, creepTarget);

      const _atr = Math.max(atr, px * 0.005, 1e-6);
      const creepBuffer = Math.max(px * 0.003, 0.5 * _atr, 1);
      let newSL = Math.max(proposed, stop);
      newSL = Math.min(newSL, px - creepBuffer);
      if (!Number.isFinite(newSL) || newSL <= 0) newSL = stop;

      if (newSL > stop) {
        const tickedSL = toTick(newSL, stock);
        candidates.push({
          priority: 9,
          status: "Protect Profit",
          reason:
            (barsSinceEntry != null
              ? `No progress since entry (${barsSinceEntry} bars, no +${NEED_TOUCH_R}R touch). `
              : `No progress for ${NP_BARS}+ bars (no +${NEED_TOUCH_R}R touch). `) +
            `Creep stop toward breakeven. New stop: \u00a5${tickedSL}.`,
          updatedStopLoss: tickedSL,
        });
      }
    }
  }

  // --- Priority 10: News-driven signals ---
  if (news) {
    // Negative high-impact news: tighten stops
    if (news.avgSentiment < -0.3 && news.maxImpact === "high") {
      const proposed = Math.max(stop, profileStopFloor, trailingStructStop(historicalData, ma25, atr));
      const newSL = clampStopLoss(proposed, stop);
      if (newSL > stop) {
        candidates.push({
          priority: 10,
          status: "Protect Profit",
          reason: `Negative high-impact news (sentiment ${news.avgSentiment.toFixed(2)}). Tighten stop to \u00a5${newSL}.${news.latestHeadline ? " " + news.latestHeadline : ""}`,
          updatedStopLoss: newSL,
        });
      }
    }

    // Negative earnings disclosure: reduce time-stop threshold
    const earningsNeg = (news.disclosures || []).find(
      (d) => d.category === "earnings" && d.sentimentScore < -0.3
    );
    if (earningsNeg) {
      const adjustedTimeStop = Math.max(5, timeStopThreshold - 3);
      if ((barsSinceEntry ?? 0) >= adjustedTimeStop && progressR < 0.5) {
        candidates.push({
          priority: 10,
          status: "Sell Now",
          reason: `Negative earnings + time stop (${barsSinceEntry} bars, threshold reduced to ${adjustedTimeStop} from ${timeStopThreshold}).`,
        });
      }
    }

    // Guidance downgrade: tighten if not yet in profit
    const guidanceDown = (news.disclosures || []).find(
      (d) => d.category === "guidance" && d.sentimentScore < -0.3
    );
    if (guidanceDown && progressR < 1) {
      const proposed = Math.max(stop, profileStopFloor, trailingStructStop(historicalData, ma25, atr));
      const newSL = clampStopLoss(proposed, stop);
      if (newSL > stop) {
        candidates.push({
          priority: 10,
          status: "Protect Profit",
          reason: `Guidance downgrade detected. Tighten stop to \u00a5${newSL}.`,
          updatedStopLoss: newSL,
        });
      }
    }
  }

  // --- Priority 11: Entry-kind aware holds + news boosts ---
  if (
    (entryKind === "DIP" || entryKind === "RETEST") &&
    aboveMA25 &&
    sentiment <= 4
  ) {
    candidates.push({
      priority: 11,
      status: "Hold",
      reason:
        "Healthy pullback above MA25 after DIP/RETEST entry; sentiment not bearish.",
    });
  }
  if (entryKind === "BREAKOUT") {
    const pivot = recentPivotHigh(historicalData);
    const nearPivot = pivot > 0 && Math.abs(px - pivot) <= 1.3 * atr;
    const heldZone =
      pivot > 0 && n(historicalData.at(-1)?.low) >= pivot - 0.6 * atr;
    if (pivot && nearPivot && heldZone) {
      candidates.push({
        priority: 11,
        status: "Hold",
        reason: "Breakout retest holding prior pivot zone.",
      });
    }
  }

  // News-driven hold boosts
  if (news) {
    const hasBuyback = (news.disclosures || []).some(
      (d) => d.category === "buyback"
    );
    if (hasBuyback) {
      candidates.push({
        priority: 11,
        status: "Hold",
        reason: "Buyback disclosure provides price support.",
        _holdBoost: true,
      });
    }
    const positiveEarnings = (news.disclosures || []).find(
      (d) => d.category === "earnings" && d.sentimentScore > 0.3
    );
    if (positiveEarnings) {
      candidates.push({
        priority: 11,
        status: "Hold",
        reason: "Positive earnings support continued hold.",
        _holdBoost: true,
      });
    }
  }

  // --- Priority 12: Default MA25 logic ---
  if (px >= ma25 || ma25 === 0) {
    candidates.push({
      priority: 12,
      status: "Hold",
      reason: "Uptrend structure intact (>= MA25). Allow normal volatility.",
    });
  } else {
    const allowedMaxStop = progressR >= 1 ? Infinity : entry - 0.01;

    if (crossedDownPostEntry) {
      const proposed = Math.max(
        stop,
        profileStopFloor,
        trailingStructStop(historicalData, ma25, atr)
      );
      let newSL = clampStopLoss(proposed, stop);
      newSL = Math.min(newSL, allowedMaxStop);
      if (newSL > stop) {
        candidates.push({
          priority: 12,
          status: "Protect Profit",
          reason: `Lost MA25 post-entry -- tighten to structure/MA stop at \u00a5${newSL}.`,
          updatedStopLoss: newSL,
        });
      } else {
        candidates.push({
          priority: 12,
          status: "Hold",
          reason:
            "Lost MA25 post-entry, but structural stop <= current stop. Hold.",
        });
      }
    } else {
      const completedReclaim = !nowBelowMA25;
      if (!completedReclaim && progressR < 0.5) {
        candidates.push({
          priority: 12,
          status: "Hold",
          reason:
            "Below MA25 since entry -- no tighten until +0.5R progress or completed MA25 reclaim.",
        });
      } else {
        const proposed = Math.max(
          stop,
          profileStopFloor,
          trailingStructStop(historicalData, ma25, atr)
        );
        let newSL = clampStopLoss(proposed, stop);
        newSL = Math.min(newSL, allowedMaxStop);
        if (newSL > stop) {
          candidates.push({
            priority: 12,
            status: "Protect Profit",
            reason: `Below MA25 since entry but conditions met -- tighten to \u00a5${newSL}.`,
            updatedStopLoss: newSL,
          });
        } else {
          candidates.push({
            priority: 12,
            status: "Hold",
            reason:
              "Below MA25 since entry -- conditions not met to tighten yet. Hold.",
          });
        }
      }
    }
  }

  // ─── SELECTION LOGIC ───
  candidates.sort((a, b) => a.priority - b.priority);

  const best = candidates[0];
  const entryHold = candidates.find(
    (c) => c.priority === 11 && c.status === "Hold" && !c._holdBoost
  );

  // Entry-kind hold override: DIP/RETEST Hold can override mid-priority Protect
  // when price is above MA25, moderate progress, and no structural damage
  let selected = best;
  if (
    best &&
    entryHold &&
    best.priority >= 5 &&
    best.priority <= 9 &&
    best.status === "Protect Profit" &&
    aboveMA25 &&
    progressR >= 0.3 &&
    progressR < 1.5 &&
    !_madeLL
  ) {
    selected = {
      ...entryHold,
      reason: `${entryHold.reason} (overrode: ${best.reason.slice(0, 80)})`,
    };
  }

  if (!selected) {
    selected = {
      status: "Hold",
      reason: "No signal generated (fallback).",
    };
  }

  // Append gap-down urgency if applicable
  if (gapDown && selected.status !== "Hold" && !selected.reason.startsWith("[GAP DOWN")) {
    selected = { ...selected, reason: `[GAP DOWN > 2*ATR] ${selected.reason}` };
  }

  // ─── RETURN ───
  const result = {
    status: selected.status,
    reason: selected.reason,
  };
  if (selected.updatedStopLoss !== undefined) {
    result.updatedStopLoss = selected.updatedStopLoss;
  }
  if (selected.suggest) {
    result.suggest = selected.suggest;
  }
  // Debug: all evaluated candidates
  result._candidates = candidates.map((c) => ({
    priority: c.priority,
    status: c.status,
    reason: c.reason.slice(0, 120),
  }));

  return result;
}
