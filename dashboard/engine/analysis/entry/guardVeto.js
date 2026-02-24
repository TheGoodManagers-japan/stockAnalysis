// entry/guardVeto.js — Guard vetoes (weekly range, market impulse, RSI, headroom, MA25 extension, streak)
// FIX #3: Collects ALL veto reasons instead of returning on first failure

import { sma, rsiFromData } from "../../indicators.js";
import {
  num,
  isFiniteN,
  teleGlobal,
  findResistancesAbove,
  countConsecutiveUpDays,
} from "./entryHelpers.js";

export function guardVeto(
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
  const vetoes = [];

  // ========== Weekly Range + Trend Context ==========
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

    if (pos >= adjTopVeto) {
      vetoes.push({
        code: "WEEKLY_HIGH",
        reason: `Weekly range too high (pos ${(pos * 100).toFixed(0)}% ≥ ${(
          adjTopVeto * 100
        ).toFixed(0)}%)`,
      });
    }

    const fallingKnifePos = cfg.weeklyFallingKnifePos ?? 0.35;
    const inBottomZone = pos < fallingKnifePos;
    const weeklyTrendConfirmedDown = weeklyRange.weeklyTrend === "DOWN";

    if (
      cfg.weeklyTrendVetoEnabled &&
      inBottomZone &&
      weeklyTrendConfirmedDown
    ) {
      vetoes.push({
        code: "FALLING_KNIFE",
        reason: `Falling knife: pos ${(pos * 100).toFixed(0)}% (bottom ${(
          fallingKnifePos * 100
        ).toFixed(0)}% of range) with weekly trend DOWN (px < MA13 < MA26)`,
      });
    }

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
        console.log(`[${stock?.ticker}] MARKET VETO`, { reason, marketCtx });
      }

      details.market = marketCtx;
      vetoes.push({ code: "MARKET_IMPULSE", reason });
    }
  }

  // RSI caps
  const rsi = num(stock.rsi14) || rsiFromData(data, 14);
  details.rsi = rsi;
  try {
    if (isFiniteN(rsi)) teleGlobal._lastRSI = rsi;
  } catch {}
  if (rsi >= cfg.hardRSI) {
    vetoes.push({
      code: "RSI",
      reason: `RSI ${rsi.toFixed(1)} ≥ ${cfg.hardRSI}`,
    });
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
      vetoes.push({
        code: "HEADROOM",
        reason: `Headroom too small (${headroomATR.toFixed(
          2
        )} ATR / ${headroomPct.toFixed(2)}%)`,
      });
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
      vetoes.push({
        code: "MA25_EXT",
        reason: `Too far above MA25 (${distMA25.toFixed(2)} ATR)`,
      });
    }
  }

  // streak guard
  const ups = countConsecutiveUpDays(data);
  details.consecUp = ups;
  if (ups >= cfg.maxConsecutiveUpDays) {
    vetoes.push({
      code: "STREAK",
      reason: `Consecutive up days ${ups} ≥ ${cfg.maxConsecutiveUpDays}`,
    });
  }

  if (vetoes.length > 0) {
    return {
      veto: true,
      reason: vetoes[0].reason,
      reasons: vetoes,
      details,
    };
  }

  return { veto: false, reason: "", reasons: [], details };
}
