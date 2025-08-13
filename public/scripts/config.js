// config.js

export function getConfig(mode = "balanced", opts = {}) {
  const base = {
    rrBase: 1.5,
    rrStrongUp: 1.15,
    rrDown: 2.1,
    qualityBase: 66,
    minEntryScore: 60,
    requirePriceActionPositive: false,
    allowSmallRedDay: true,
    redDayMaxDownPct: -0.8,
    breakoutVolMult: 1.15,
    enforceNotExhausted: false,
    lateGuard: true,
    debug: !!opts.debug,
  };

  const strict = {
    rrBase: 1.6,
    rrStrongUp: 1.2,
    rrDown: 2.3,
    qualityBase: 70,
    minEntryScore: 65,
    requirePriceActionPositive: true,
    allowSmallRedDay: false,
    breakoutVolMult: 1.3,
    enforceNotExhausted: true,
    lateGuard: true,
    debug: !!opts.debug,
  };

  const loose = {
    rrBase: 1.4,
    rrStrongUp: 1.1,
    rrDown: 1.9,
    qualityBase: 62,
    minEntryScore: 55,
    requirePriceActionPositive: false,
    allowSmallRedDay: true,
    redDayMaxDownPct: -1.2,
    breakoutVolMult: 1.05,
    enforceNotExhausted: false,
    lateGuard: false,
    debug: !!opts.debug,
  };

  const table = { strict, balanced: base, loose };
  const chosen = table[mode] || base;
  return { ...chosen, ...(opts.tuning || {}) };
}
