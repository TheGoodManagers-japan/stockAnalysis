// guards.js
import { n, avg } from "./utils.js";

const DEFAULTS = {
  breakoutLookback: 15,
  breakoutConfirmVolMult: 1.3,
  maxDaysAfterBreakout: 4,
  maxPctAbovePivot: 0.05,
  maxConsecutiveUpDays: 5,
  maxATRAboveMA25: 2.6,
  maxATRAboveMA50: 3.6,
  max5dGainPct: 16,
  hardRSI: 77,
  softRSI: 70,
  climaxVolMult: 2.5,
  climaxCloseFromHigh: 0.6,
  pullbackNearMA25Pct: 0.012,
  pullbackATR: 1.0,
};

function LG(cfg) {
  return {
    ...DEFAULTS,
    breakoutConfirmVolMult:
      cfg?.breakoutVolMult ?? DEFAULTS.breakoutConfirmVolMult,
    maxATRAboveMA25: cfg?.maxATRAboveMA25 ?? DEFAULTS.maxATRAboveMA25,
    maxATRAboveMA50: cfg?.maxATRAboveMA50 ?? DEFAULTS.maxATRAboveMA50,
    max5dGainPct: cfg?.max5dGainPct ?? DEFAULTS.max5dGainPct,
    hardRSI: cfg?.rsiHard ?? DEFAULTS.hardRSI,
    softRSI: cfg?.rsiSoft ?? DEFAULTS.softRSI,
  };
}

export function getEntryGuards(
  stock,
  sortedData,
  marketStructure,
  entryConditions,
  cfg
) {
  const recent = sortedData.slice(-20);
  const L = LG(cfg);

  if (!cfg.lateGuard) {
    const ext = overboughtOverextendedVeto(stock, recent, L);
    if (ext.veto) return { vetoed: true, reason: ext.reason };
    const clim = climaxVeto(sortedData.slice(-20), L);
    if (clim.veto) return { vetoed: true, reason: clim.reason };
    return { vetoed: false };
  }

  if (
    (entryConditions?.pullbackToSupport && entryConditions?.bounceConfirmed) ||
    entryConditions?.patternComplete
  ) {
    const ext = overboughtOverextendedVeto(stock, recent, L);
    if (ext.veto) return { vetoed: true, reason: ext.reason };
    const clim = climaxVeto(sortedData.slice(-20), L);
    if (clim.veto) return { vetoed: true, reason: clim.reason };
    return { vetoed: false };
  }

  const pivotInfo = findPivotAndBreakout(
    sortedData.slice(-L.breakoutLookback),
    L
  );
  const late = lateWindowVeto(stock, recent, pivotInfo, L);
  if (late.veto) return { vetoed: true, reason: late.reason };

  const ext = overboughtOverextendedVeto(stock, recent, L);
  if (ext.veto) return { vetoed: true, reason: ext.reason };

  const clim = climaxVeto(sortedData.slice(-20), L);
  if (clim.veto) return { vetoed: true, reason: clim.reason };

  return { vetoed: false };
}

/* helpers (parametrized by L) */
function countConsecutiveUpDays(data, k = 8) {
  let c = 0;
  for (let i = data.length - 1; i > 0 && c < k; i--) {
    if (n(data[i].close) > n(data[i - 1].close)) c++;
    else break;
  }
  return c;
}

function findPivotAndBreakout(recent, L) {
  if (recent.length < 12) return null;
  const window = recent.slice(-L.breakoutLookback);
  if (window.length < 12) return null;

  const pre = window.slice(0, -2);
  const pivot = Math.max(...pre.map((d) => n(d.high)));
  const avgVol10 = avg(window.slice(-10).map((d) => n(d.volume)));

  let breakoutIdx = -1;
  for (let i = pre.length; i < window.length; i++) {
    const d = window[i];
    if (
      n(d.close) > pivot &&
      n(d.volume) >= avgVol10 * L.breakoutConfirmVolMult
    ) {
      breakoutIdx = i;
      break;
    }
  }
  if (breakoutIdx === -1) return null;

  const daysSinceBreakout = window.length - 1 - breakoutIdx;
  return { pivot, daysSinceBreakout };
}

function lateWindowVeto(stock, recent, pivotInfo, L) {
  if (!pivotInfo) return { veto: false };
  const curr = n(stock.currentPrice);
  const atr = Math.max(n(stock.atr14), curr * 0.005);
  const ma25 = n(stock.movingAverage25d);

  const { pivot, daysSinceBreakout } = pivotInfo;
  const pctAbovePivot = pivot > 0 ? (curr - pivot) / pivot : 0;

  if (daysSinceBreakout > L.maxDaysAfterBreakout) {
    const nearMA25 =
      ma25 > 0 && Math.abs(curr - ma25) / ma25 <= L.pullbackNearMA25Pct;
    const withinATRofPivot = Math.abs(curr - pivot) <= L.pullbackATR * atr;
    if (!nearMA25 && !withinATRofPivot) {
      return {
        veto: true,
        reason: `Late after breakout (D+${daysSinceBreakout}) and not near MA25/pivot.`,
      };
    }
  }

  if (pctAbovePivot > L.maxPctAbovePivot && daysSinceBreakout > 1) {
    return {
      veto: true,
      reason: `Price ${(pctAbovePivot * 100).toFixed(
        1
      )}% above pivot – late breakout chase.`,
    };
  }
  return { veto: false };
}

function overboughtOverextendedVeto(stock, recent, L) {
  const curr = n(stock.currentPrice);
  const prev5 = recent[recent.length - 6]?.close;
  const gain5 = prev5 ? ((curr - n(prev5)) / n(prev5)) * 100 : 0;

  const rsi = n(stock.rsi14);
  const bbU = n(stock.bollingerUpper);
  const ma25 = n(stock.movingAverage25d);
  const ma50 = n(stock.movingAverage50d);
  const atr = Math.max(n(stock.atr14), curr * 0.005);

  if (rsi >= L.hardRSI)
    return { veto: true, reason: `RSI ${rsi.toFixed(0)} is too hot.` };

  const last2AboveBBU = recent
    .slice(-2)
    .every((d) => bbU > 0 && n(d.close) > bbU);
  if (rsi >= L.softRSI && last2AboveBBU) {
    return {
      veto: true,
      reason: `Overbought (RSI ${rsi.toFixed(
        0
      )}) with repeated closes above upper band.`,
    };
  }

  if (ma25 > 0 && (curr - ma25) / atr > L.maxATRAboveMA25) {
    return {
      veto: true,
      reason: `Too far above MA25 (${((curr - ma25) / atr).toFixed(1)} ATR).`,
    };
  }
  if (ma50 > 0 && (curr - ma50) / atr > L.maxATRAboveMA50) {
    return {
      veto: true,
      reason: `Too far above MA50 (${((curr - ma50) / atr).toFixed(1)} ATR).`,
    };
  }

  if (gain5 > L.max5dGainPct) {
    return {
      veto: true,
      reason: `+${gain5.toFixed(1)}% in 5 days – extended.`,
    };
  }

  const ups = countConsecutiveUpDays(recent, 8);
  if (ups > L.maxConsecutiveUpDays) {
    return {
      veto: true,
      reason: `${ups} straight up days – late without a reset.`,
    };
  }

  return { veto: false };
}

function climaxVeto(recent, L) {
  if (recent.length < 20) return { veto: false };
  const last = recent[recent.length - 1];
  const range = Math.max(0.01, n(last.high) - n(last.low));
  const closeFromHighPct = (n(last.high) - n(last.close)) / range;
  const avgVol20 = avg(recent.slice(-20).map((d) => n(d.volume)));
  const isClimax =
    n(last.volume) >= avgVol20 * L.climaxVolMult &&
    closeFromHighPct >= L.climaxCloseFromHigh;
  return isClimax
    ? { veto: true, reason: `Volume climax with weak close – likely blow-off.` }
    : { veto: false };
}
