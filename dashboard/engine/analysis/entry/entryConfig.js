// entry/entryConfig.js — Entry configuration with sentiment-aware tweaks

export function getConfig(opts = {}) {
  const debug = !!opts.debug;
  const ST = Number.isFinite(opts?.sentiment?.ST) ? opts.sentiment.ST : null;
  const LT = Number.isFinite(opts?.sentiment?.LT) ? opts.sentiment.LT : null;

  const LT_bull = Number.isFinite(LT) && LT >= 3 && LT <= 5;
  const LT_bear = Number.isFinite(LT) && LT >= 6;
  const ST_pull = Number.isFinite(ST) && ST >= 6;
  const ST_hot = Number.isFinite(ST) && ST <= 2;

  const base = {
    // general
    perfectMode: false,
    assumeSorted: false,
    minBarsNeeded: 25,

    // --- Market veto (index context) ---
    marketVetoEnabled: true,
    marketImpulseVetoPct: 1.8,
    marketImpulseVetoATR: 1.0,
    marketUseTodayIfPresent: true,

    // Weekly range guard
    useWeeklyRangeGuard: true,
    weeklyRangeLookbackWeeks: 12,

    limitBuyDiscountATR: 0.15,

    // Hard veto thresholds
    weeklyTopVetoPos: 0.65,
    weeklyBottomPreferPos: 0.25,
    weeklyTopVetoRRBump: 0.1,

    // Structure gate
    structureMa5Tol: 0.992,
    allowDipInDowntrend: false,

    // RR floors
    minRRbase: 1.35,
    minRRstrongUp: 1.5,
    minRRweakUp: 1.55,
    dipMinRR: 1.55,

    // Horizon behavior
    horizonRRRelief: 0.1,
    tightenStopOnHorizon: true,
    dipTightenStopATR: 0.25,

    // ---- Holding horizon controls ----
    maxHoldingBars: 8,
    atrPerBarEstimate: 0.55,
    include52wAsResistance: false,
    resistanceLookbackBars: 40,
    timeHorizonRRPolicy: "clamp",

    // Headroom & extension guards
    nearResVetoATR: 0.5,
    nearResVetoPct: 1.0,
    headroomSecondResATR: 0.6,
    maxATRfromMA25: 2.4,
    ma25VetoMarginATR: 0.2,

    // Overbought guards
    hardRSI: 78,
    softRSI: 72,

    // DIP proximity/structure knobs
    dipMaSupportATRBands: 0.8,
    dipStructTolATR: 0.9,
    dipStructTolPct: 3.0,
    dipStructMinTouches: 2, // Require 2 pivot touches for structural support

    // Recovery caps (used by dip.js for different trend contexts)
    dipMaxRecoveryPct: 140, // Default / non-uptrend recovery cap
    dipMaxRecoveryUpLike: 155, // UP-like trend recovery cap
    dipMaxRecoveryStrongUp: 155, // STRONG_UP recovery cap

    // Fib tolerance
    fibTolerancePct: 9,

    // Pullback lookback window
    dipPullbackLookbackBars: 15, // Was 10; expanded to catch slower setups

    // Volume regime
    pullbackDryFactor: 1.2,
    bounceHotFactor: 1.2, // Was 1.08; require 20% above avg for meaningful confirmation
    bounceMinV20Ratio: 1.0, // Require at least average volume on bounce day

    // DIP geometry
    dipMinPullbackPct: 4.8,
    dipMinPullbackATR: 1.9,
    dipMaxBounceAgeBars: 7,
    dipMinBounceStrengthATR: 0.72,

    // RSI divergence detection
    rsiDivPriceTol: 1.01, // Price tolerance for bearish divergence
    rsiDivRSIDelta: 3, // RSI delta threshold for divergence

    // Min stop distance for non-DIP
    minStopATRStrong: 1.15,
    minStopATRUp: 1.2,
    minStopATRWeak: 1.3,
    minStopATRDown: 1.45,

    // SCOOT target lift - WITH SUPPLY WALL SKEPTICISM
    scootEnabled: true,
    scootNearMissBand: 0.25,
    scootATRCapDIP: 4.2,
    scootATRCapNonDIP: 3.5,
    scootMaxHops: 2,

    // RR hop thresholds for resistance "next hop"
    hopThreshDipATR: 1.1,
    hopThreshNonDipATR: 0.7,

    // Minimum DIP target extension
    minDipTargetATR: 2.6,
    minDipTargetFrac: 0.022,

    // Volatility-aware RR floors
    lowVolRRBump: 0.1,
    highVolRRFloor: 1.6,

    // DIP pathological stop clamp
    dipFallbackStopATR: 0.8,

    // Streak veto
    maxConsecutiveUpDays: 7,

    // --- Liquidity window ---
    liquidityCheckEnabled: true,
    liqLookbackDays: 20,
    minADVNotional: 2e8,
    minAvgVolume: 200_000,
    minClosePrice: 200,
    minATRTicks: 5,
    liqNearMargin: 0.15,

    // Probation
    allowProbation: true,
    probationRRSlack: 0.08,
    probationRSIMax: 65,

    // Timeline config
    timeline: {
      r1: 1.0,
      r15: 1.5,
      r2: 2.0,
      lockAtR15: 0.6,
      runnerLockAtR2: 1.2,
      trail: { ma25OffsetATR: 0.6, swingLowOffsetATR: 0.5 },
    },

    // ========== TAPE READING ENHANCEMENTS ==========

    // Capitulation flush detection
    flushVetoEnabled: true,
    flushVolMultiple: 1.8,
    flushRangeATR: 1.3,
    flushCloseNearLow: 0.25,
    flushStabilizationBars: 2,

    // MA5 resistance detection
    ma5ResistanceVetoEnabled: true,
    ma5ResistanceRejections: 2,
    ma5ResistanceTol: 0.998,

    // Supply wall detection for targets
    supplyWallEnabled: true,
    supplyWallGapThreshold: 0.02,
    supplyWallVolMultiple: 1.5,
    supplyWallLookback: 60,

    // Weekly trend context (enhanced)
    weeklyTrendVetoEnabled: true,
    weeklyTrendLookback: 26,
    weeklyFallingKnifePos: 0.35,

    // Arrival quality assessment
    arrivalQualityEnabled: true,
    arrivalFlushPenalty: true,

    // ========== BREAKOUT CONFIG (detectPreBreakoutSetup) ==========
    boLookbackBars: 50,
    boNearResATR: 2.5,
    boNearResPct: 2.5,
    boTightenFactor: 0.92,
    boHigherLowsMin: 2,
    boMinDryPullback: 1.05,
    boSlipTicks: 0.006,
    boUseStopMarketOnTrigger: false,
    boCloseThroughATR: 0.08,
    boVolThrustX: 1.35,
    boMinRRThrust: 1.35,
    boMinRRNoThrust: 1.6,

    debug,
  };

  // ---------- Sentiment-aware tweaks ----------
  const cfg = { ...base };

  if (LT_bull && ST_pull) {
    cfg.dipMinRR = Math.max(cfg.dipMinRR - 0.05, 1.45);
    cfg.minRRbase = Math.max(cfg.minRRbase - 0.05, 1.25);
    cfg.dipMaxRecoveryStrongUp += 10;
    cfg.hardRSI = Math.min(cfg.hardRSI + 2, 80);
    cfg.allowDipInDowntrend = false;
  }

  if (LT_bull && ST_hot) {
    cfg.nearResVetoATR = Math.max(cfg.nearResVetoATR, 0.6);
    cfg.nearResVetoPct = Math.max(cfg.nearResVetoPct, 1.2);
    cfg.maxATRfromMA25 = Math.min(cfg.maxATRfromMA25, 2.2);
  }

  if (LT_bear) {
    cfg.dipMinRR = Math.max(cfg.dipMinRR, 1.7);
    cfg.minRRbase = Math.max(cfg.minRRbase, 1.55);
    cfg.nearResVetoATR = Math.max(cfg.nearResVetoATR, 0.7);
    cfg.nearResVetoPct = Math.max(cfg.nearResVetoPct, 1.4);
    cfg.maxATRfromMA25 = Math.min(cfg.maxATRfromMA25, 2.0);
    cfg.hardRSI = Math.min(cfg.hardRSI, 76);
    cfg.allowDipInDowntrend = false;
  }

  if (!LT_bear && ST_pull) {
    cfg.allowDipInDowntrend = true;
  }

  return cfg;
}
