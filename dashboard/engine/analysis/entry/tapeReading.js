// entry/tapeReading.js — Tape reading assessment + sub-detectors

import { sma } from "../../indicators.js";
import { num, avg } from "./entryHelpers.js";

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
export function assessTapeReading(data, stock, ms, px, atr, cfg, weeklyRange = null) {
  const details = {};
  const last = data.at(-1);
  const prev = data.at(-2);

  const avgVolRaw = avg(data.slice(-20).map((d) => num(d.volume)));
  const avgVol = Math.max(avgVolRaw, 1);

  // 1) Capitulation Flush Detection — HARD VETO
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
  if (cfg.ma5ResistanceVetoEnabled) {
    const ma5 = num(stock.movingAverage5d) || sma(data, 5);
    const ma5Resistance = detectMA5Resistance(data, ma5, cfg);
    details.ma5Resistance = ma5Resistance;

    if (ma5Resistance.acting) {
      const closeAboveYHigh = num(last.close) > num(prev.high);
      if (closeAboveYHigh) {
        details.ma5ReclaimOverride = true;
      } else {
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
    }
  }

  // 4) Dead Cat Bounce — CONDITIONAL HARD VETO
  const deadCat = detectDeadCatBounce(data, ms, px, atr, cfg);
  details.deadCatBounce = deadCat;

  if (deadCat.detected) {
    const weeklyTrend = weeklyRange?.weeklyTrend || null;

    if (weeklyTrend === "DOWN") {
      return {
        pass: false,
        why: `Dead cat bounce confirmed by weekly downtrend — ${deadCat.reason}`,
        code: "TAPE_DEAD_CAT",
        details,
      };
    } else {
      details.deadCatDetected = true;
      details.deadCatOverriddenByWeekly = weeklyTrend;
      details.requireStrongerBounce = true;
    }
  }

  // 5) Gap detection — INFORMATIONAL FLAGS
  if (prev && last) {
    const prevHigh = num(prev.high);
    const prevLow = num(prev.low);
    const lastOpen = num(last.open);
    const lastClose = num(last.close);
    const prevClose = num(prev.close);

    const gapUp = lastOpen > prevHigh;
    const gapDown = lastOpen < prevLow;

    if (gapUp) {
      // Gap-up that holds above prev close = bullish quality signal
      const gapHeld = lastClose > prevClose;
      details.gapUp = { detected: true, held: gapHeld, gapSize: lastOpen - prevHigh };
    }
    if (gapDown) {
      // Gap-down that fills (close > open) = bullish reversal signal
      const gapFilled = lastClose > lastOpen;
      details.gapDown = { detected: true, filled: gapFilled, gapSize: prevLow - lastOpen };
    }
  }

  return {
    pass: true,
    why: "",
    details,
    requireStrongerBounce: details.requireStrongerBounce || false,
    ma5ResistanceActive: details.ma5ResistanceActive || false,
  };
}

/* ======================= Capitulation Flush Detection ======================= */
export function detectCapitulationFlush(data, atr, avgVolRaw, cfg) {
  const avgVol = Math.max(avgVolRaw, 1);
  const lookback = Math.min(5, data.length);

  for (let i = 0; i < lookback; i++) {
    const bar = data.at(-(i + 1));
    const barRange = num(bar.high) - num(bar.low);
    const closePos =
      barRange > 0 ? (num(bar.close) - num(bar.low)) / barRange : 0.5;

    const volRatio = num(bar.volume) / avgVol;

    const isFlush =
      volRatio > (cfg.flushVolMultiple || 1.8) &&
      num(bar.close) < num(bar.open) &&
      closePos < (cfg.flushCloseNearLow || 0.25) &&
      barRange > (cfg.flushRangeATR || 1.3) * atr;

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

/* ======================= MA5 Resistance Detection ======================= */
export function detectMA5Resistance(data, ma5, cfg) {
  if (!ma5 || ma5 <= 0) return { acting: false, rejections: 0 };

  const recent = data.slice(-3);
  const tol = cfg.ma5ResistanceTol || 0.998;

  let rejections = 0;
  for (const bar of recent) {
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

/* ======================= Arrival Quality Assessment ======================= */
export function assessArrivalQuality(data, atr, avgVolRaw, cfg) {
  const avgVol = Math.max(avgVolRaw, 1);
  const last = data.at(-1);

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

  const slowDrift = arrivalVolRatio < 1.2 && arrivalRange < 0.8 * atr;

  return {
    wasFlush,
    slowDrift,
    volRatio: arrivalVolRatio,
    rangeATR: arrivalRange / atr,
    quality: wasFlush ? "poor" : slowDrift ? "good" : "neutral",
  };
}

/* ======================= Dead Cat Bounce Detection ======================= */
export function detectDeadCatBounce(data, ms, px, atr, cfg) {
  const ma5 = ms.ma5;
  const ma25 = ms.ma25;

  if (!ma5 || !ma25) return { detected: false };

  const recentBars = data.slice(-10);
  const recentHigh = Math.max(
    ...recentBars.slice(0, 5).map((d) => num(d.high))
  );
  const recentLow = Math.min(...recentBars.map((d) => num(d.low)));

  const dropPct =
    recentHigh > 0 ? ((recentHigh - recentLow) / recentHigh) * 100 : 0;

  const pxBelowMA5 = px < ma5;
  const ma5Declining = data.length >= 6 && sma(data.slice(0, -1), 5) > ma5;
  const ma25Declining = data.length >= 26 && sma(data.slice(0, -1), 25) > ma25;

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

/* ======================= Supply Wall Detection ======================= */
export function detectSupplyWalls(data, entryPx, targetPx, atr, cfg) {
  if (!cfg.supplyWallEnabled) return { blocked: false };

  const lookback = cfg.supplyWallLookback || 60;
  const relevant = data.slice(-lookback);

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

    if (barHigh < entryPx || barLow > targetPx) continue;

    const gapThreshold = cfg.supplyWallGapThreshold || 0.02;
    const isGapDown = barOpen < prevClose * (1 - gapThreshold);

    const volRatio = num(bar.volume) / avgVol;
    const isHighVolRejection =
      volRatio > (cfg.supplyWallVolMultiple || 1.5) &&
      num(bar.close) < num(bar.open) &&
      barHigh > entryPx;

    if (isGapDown) {
      walls.push({
        type: "gap",
        level: prevClose,
        gapLow: barOpen,
        gapSize: prevClose - barOpen,
        gapPct: ((prevClose - barOpen) / prevClose) * 100,
        date: bar.date,
        volume: num(bar.volume),
        volRatio,
      });
    } else if (isHighVolRejection) {
      walls.push({
        type: "rejection",
        level: barHigh,
        date: bar.date,
        volume: num(bar.volume),
        volRatio,
      });
    }
  }

  const blockingWalls = walls.filter(
    (w) => w.level > entryPx && w.level < targetPx
  );

  if (blockingWalls.length > 0) {
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
