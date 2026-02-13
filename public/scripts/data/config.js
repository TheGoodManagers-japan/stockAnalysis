// config.js
export function getConfig(mode = "balanced", opts = {}) {
  const base = {
    // R:R baselines
    rrBase: 1.5,
    rrStrongUp: 1.15,
    rrDown: 2.1,

    // Quality gates
    qualityBase: 66,
    minEntryScore: 60,

    // Day-price action gating
    requirePriceActionPositive: false,
    allowSmallRedDay: true,
    redDayMaxDownPct: -0.8,

    // Breakout confirmation
    breakoutVolMult: 1.15,

    // Stops / guards (now tunable)
    stopMinATR: 1.3, // was hard-coded 1.5
    rsiHard: 77,
    rsiSoft: 70,
    maxATRAboveMA25: 2.6,
    maxATRAboveMA50: 3.6,
    max5dGainPct: 16,

    lateGuard: true,
    debug: !!opts.debug,
  };

  const strict = {
    ...base,
    rrBase: 1.6,
    rrStrongUp: 1.2,
    rrDown: 2.3,
    qualityBase: 70,
    minEntryScore: 65,
    requirePriceActionPositive: true,
    allowSmallRedDay: false,
    breakoutVolMult: 1.3,
    stopMinATR: 1.5,
    rsiHard: 76,
    rsiSoft: 69,
    maxATRAboveMA25: 2.4,
    maxATRAboveMA50: 3.2,
    max5dGainPct: 14,
  };

  const loose = {
    ...base,
    rrBase: 1.4,
    rrStrongUp: 1.1,
    rrDown: 1.9,
    qualityBase: 62,
    minEntryScore: 55,
    allowSmallRedDay: true,
    redDayMaxDownPct: -1.5,
    breakoutVolMult: 1.05,
    stopMinATR: 1.0,
    rsiHard: 85,
    rsiSoft: 75,
    maxATRAboveMA25: 3.4,
    maxATRAboveMA50: 4.2,
    max5dGainPct: 20,
    lateGuard: false,
  };

  const table = { strict, balanced: base, loose };
  const chosen = table[mode] || base;
  return { ...chosen, ...(opts.tuning || {}) };
}
