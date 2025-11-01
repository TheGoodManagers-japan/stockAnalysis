// /scripts/swingTradeEntryTiming.js — DIP-only, simplified (rich diagnostics kept)
import { detectDipBounce, detectDipBounceWeekly } from "./dip.js";

/* ============== lightweight global bus for guard histos ============== */
// teleGlobal is a shared scratch bucket used by guardVeto() to stash
// headroom / distMA25 samples before we merge them back into each trade's
// local telemetry at the end of analyzeSwingTradeEntry()/analyseCrossing().
//
// IMPORTANT: this assumes we run tickers SEQUENTIALLY.
// If you ever run analysis in parallel (Promise.all etc.), this shared
// state will cross-contaminate symbols. In that case, refactor guardVeto()
// to push directly into a per-call tele instead of teleGlobal.
const teleGlobal = { histos: { headroom: [], distMA25: [] } };


/* ============================ Telemetry ============================ */
function teleInit() {
  return {
    context: {},
    gates: {
      structure: { pass: false, why: "" }, // minimal, DIP-friendly
      regime: { pass: true, why: "" }, // no strict pre-gate; keep slot for logs
    },
    dip: { trigger: false, waitReason: "", why: "", diagnostics: {} },
    rr: {
      checked: false,
      acceptable: false,
      ratio: NaN,
      need: NaN,
      risk: NaN,
      reward: NaN,
      stop: NaN,
      target: NaN,
      probation: false,
    },
    guard: { checked: false, veto: false, reason: "", details: {} },
    outcome: { buyNow: false, reason: "" },
    reasons: [],
    trace: [],
    /* blocks & histograms for compact “why blocked?” analysis */
    blocks: [], // [{code, gate, why, ctx}]
    histos: {
      rrShortfall: [], // [{need, have, short, atrPct, trend, ticker}]
      headroom: [], // [{atr, pct, nearestRes, ticker}]
      distMA25: [], // [{distATR, ma25, px, ticker}]
    },
    /* numeric distributions for "how much to relax" analysis */
    distros: {
      // DIP quality mirrors (only pushed if dip.js provides them)
      dipV20ratio: [],
      dipBodyPct: [],
      dipRangePctATR: [],
      dipCloseDeltaATR: [],
      dipPullbackPct: [],
      dipPullbackATR: [],
      dipRecoveryPct: [],
      // optional: RSI sample near veto thresholds
      rsiSample: [],
    },
  };
}
function pushBlock(tele, code, gate, why, ctx = {}) {
  tele.blocks.push({ code, gate, why, ctx });
}

/* ============================ Tracing ============================ */
function mkTracer(opts = {}) {
  const level = opts.debugLevel || "normal"; // "off"|"normal"|"verbose"
  const logs = [];
  const should = (lvl) => {
    if (level === "off") return false;
    if (level === "verbose") return true;
    // "normal": allow info/warn/error but not debug/verbose
    return lvl !== "debug" && lvl !== "verbose";
  };
  const emit = (e) => {
    logs.push(e);
    try {
      opts.onTrace?.(e);
    } catch {}
  };
  const T = (module, step, ok, msg, ctx = {}, lvl = "info") => {
    if (!should(lvl)) return;
    emit({
      ts: Date.now(),
      module,
      step,
      ok: !!ok,
      msg: String(msg || ""),
      ctx,
    });
  };
  T.logs = logs;
  return T;
}

/* ======================= Slice filters from backtest ======================= */
/*
These functions enforce:
- Only trade setups that historically paid (HIGH_SCORE_6plus, DOWN_regime_ST_panic_weekly_flip,
  RANGE_regime_gap_up_near_MA25).
- Auto-block common loser patterns (too extended, too early, weak ST, pure chase in STRONG_UP).
*/




/* ============================ Config ============================ */
function getConfig(opts = {}) {
  const debug = !!opts.debug;
  return {
    // general
    perfectMode: false,

    // --- Weekly/Daily cross gating (DIP + new playbook) ---
    requireWeeklyUpForDIP: true, // require weekly uptrend = at least 2/3 of 13/26/52wk MAs under price
    requireDailyReclaim25and75ForDIP: true, // require recent price reclaim of both 25d & 75d
    dailyReclaimLookback: 5, // slightly wider, helps valid names pass
    freshDailyLookbackDays: 5,

    // getConfig(...)
    requireFreshWeeklyFlipForDIP: true, // new
    freshWeeklyLookbackWeeks: 5, // reuse the same freshness window you like
    allowStaleCrossDip: false, // turn off stale DIP lane
    // NEW: explicit stale windows for “old flip still valid”
    staleDailyCrossMaxAgeBars: 20, // <= your suggestion
    staleWeeklyCrossMaxAgeWeeks: 10, // <= your suggestion

    // For DIP: we now require (reclaim OR cross), not both
    requireMA25over75ForDIP: true,
    maCrossMaxAgeBars: 10, // allow a recent cross within ~2 weeks

    staleDipMaxAgeBars: 7, // DIP bounce must be recent
    staleDipMaxAgeWeeklyWeeks: 2, // optional: only used when weekly-stacked-now
    staleCrossRequireReclaim: true, // require recent price reclaim 25/75 for stale

    // --- Multi-timeframe DIP presets (used ONLY for weekly wrapper) ---
    dipDaily: {
      minPullbackPct: 4.8,
      minPullbackATR: 1.9,
      maxBounceAgeBars: 7,
      minBounceStrengthATR: 0.6,
      minRR: 1.55,
    },
    dipWeekly: {
      minPullbackPct: 6.5, // weekly pullbacks are larger
      minPullbackATR: 2.6, // in WEEKLY ATR units (see wrapper)
      maxBounceAgeWeeks: 2, // DIP bounce must be recent in weeks
      minBounceStrengthATR: 0.5, // slightly easier; weekly bars are chunky
      minRR: 1.55,
    },

    // --- Cross+Volume playbook ---
    crossPlaybookEnabled: true,
    crossMinVolumeFactor: 1.5, // >= 1.5× 20d avg volume
    crossMinRR: 1.45, // RR floor for cross play
    crossUseReclaimNotJustMAcross: true, // price reclaimed both 25 & 75 within lookback

    // RR floors (slightly higher; DIP has its own floor too)
    minRRbase: 1.35,
    minRRstrongUp: 1.5,
    minRRweakUp: 1.55,

    // headroom & extension guards (align with dip.js headroomOK of ≥0.50 ATR / ≥1.00%)
    nearResVetoATR: 0.4,
    nearResVetoPct: 0.6,
    maxATRfromMA25: 2.4,

    // overbought guards
    hardRSI: 75,
    softRSI: 70,

    // --- DIP proximity/structure knobs (tighter but still forgiving) ---
    dipMaSupportATRBands: 0.8, // was 0.9
    dipStructTolATR: 0.9, // was 1.0
    dipStructTolPct: 3.0, // was 3.5

    // recovery caps (trim late entries; keep strong-up allowance)
    dipMaxRecoveryPct: 135, // was 150
    dipMaxRecoveryStrongUp: 155, // was 185

    // fib window tolerance
    fibTolerancePct: 9, // was 12

    // volume regime
    pullbackDryFactor: 1.2, // was 1.6 (<= means “dry”: require drier pullback)
    bounceHotFactor: 1.0, // was 1.05 (>= means “hot”: bounce should be a bit hot)

    // DIP parameters (used by dip.js)
    dipMinPullbackPct: 4.8, // new: minimum pullback in %
    dipMinPullbackATR: 1.9, // was 0.6
    dipMaxBounceAgeBars: 7, // was 5
    dipMinBounceStrengthATR: 0.6, // was 0.8 (other gates tightened; this stays reasonable)
    dipMinRR: 1.55, // new: DIP-specific RR floor

    // allow DIPs even if broader regime softened
    allowDipInDowntrend: true,

    // min stop distance (used by non-DIP fallbacks; DIP stop logic handled in dip.js)
    minStopATRStrong: 1.15,
    minStopATRUp: 1.2,
    minStopATRWeak: 1.3,
    minStopATRDown: 1.45,

    scootEnabled: true,
    scootNearMissBand: 0.25, // how far below 'need' we’ll try a 2nd hop
    scootATRCapDIP: 4.2, // max extra distance in ATR for DIPs
    scootATRCapNonDIP: 3.5, // a bit tighter for non-DIPs
    scootMaxHops: 2, // first to res[1], optional second to res[2]

    // probation
    allowProbation: true,

    debug,
  };
}



// Return age of the MOST RECENT bullish daily 5>25>75 flip (no freshness cap).
function lastDailyStackedCrossAge(data) {
  const smaD = (n, i) => {
    if (i + 1 < n) return 0;
    let s = 0;
    for (let k = i - n + 1; k <= i; k++) s += +data[k].close || 0;
    return s / n;
  };
  const last = data.length - 1;
  if (last < 75) return { found: false };
  for (let i = last; i >= 1; i--) {
    const m5 = smaD(5, i), m25 = smaD(25, i), m75 = smaD(75, i);
    const pm5 = smaD(5, i - 1), pm25 = smaD(25, i - 1), pm75 = smaD(75, i - 1);
    const nowStacked =
      m5 > 0 && m25 > 0 && m75 > 0 && m5 > m25 && m25 > m75;
    const prevStacked =
      pm5 > 0 && pm25 > 0 && pm75 > 0 && pm5 > pm25 && pm25 > pm75;
    if (nowStacked && !prevStacked) {
      return {
        found: true,
        barsAgo: last - i,
        index: i,
        m5,
        m25,
        m75,
      };
    }
  }
  return { found: false };
}

// Return age of the MOST RECENT bullish weekly 13>26>52 flip (no freshness cap).
function lastWeeklyStackedCrossAge(data) {
  const weeksAll = resampleToWeeks(data);

  const isoKey = (d) => {
    const dt = new Date(d);
    const t = new Date(
      Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate())
    );
    const dayNum = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dayNum); // go to Thu of that ISO week
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
    return t.getUTCFullYear() + "-" + weekNo;
  };

  // Drop an incomplete last week (fewer than 4 daily bars in that week)
  const lastDaily = data.at(-1);
  const lastDailyWeek = lastDaily ? isoKey(lastDaily.date) : null;
  let barsInLastDailyWeek = 0;
  if (lastDailyWeek) {
    for (let i = data.length - 1; i >= 0; i--) {
      if (isoKey(data[i].date) !== lastDailyWeek) break;
      barsInLastDailyWeek++;
    }
  }
  const dropLastWeekly =
    barsInLastDailyWeek > 0 && barsInLastDailyWeek < 4;
  const weeks =
    weeksAll.length >= 1 && dropLastWeekly
      ? weeksAll.slice(0, -1)
      : weeksAll;

  if (weeks.length < 52) return { found: false };

  const smaW = (n, i) => {
    if (i + 1 < n) return 0;
    let s = 0;
    for (let k = i - n + 1; k <= i; k++) s += +weeks[k].close || 0;
    return s / n;
  };

  const last = weeks.length - 1;
  const eps = 0.0015;
  const stackedAt = (i) => {
    const m13 = smaW(13, i),
      m26 = smaW(26, i),
      m52 = smaW(52, i);
    const stacked =
      m13 > 0 &&
      m26 > 0 &&
      m52 > 0 &&
      m13 >= m26 * (1 + eps) &&
      m26 >= m52 * (1 + eps);
    return { stacked, m13, m26, m52 };
  };

  for (let i = last; i >= 1; i--) {
    const cur = stackedAt(i);
    const prev = stackedAt(i - 1);
    if (cur.stacked && !prev.stacked) {
      return {
        found: true,
        weeksAgo: last - i,
        index: i,
        m13: cur.m13,
        m26: cur.m26,
        m52: cur.m52,
      };
    }
  }
  return { found: false };
}



function resampleToWeeks(daily) {
  const out = [];
  let curKey = "",
    agg = null;
  for (const d of daily) {
    const dt = new Date(d.date);
    const y = dt.getUTCFullYear();
    const w = isoWeek(dt);
    const key = `${y}-W${w}`;
    if (key !== curKey) {
      if (agg) out.push(agg);
      agg = { date: d.date, close: +d.close || 0 };
      curKey = key;
    } else {
      agg.date = d.date;
      agg.close = +d.close || agg.close;
    }
  }
  if (agg) out.push(agg);
  return out;
}
function isoWeek(d) {
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return weekNo;
}
function smaSeries(arr, n) {
  if (arr.length < n) return 0;
  let s = 0;
  for (let i = arr.length - n; i < arr.length; i++) s += +arr[i].close || 0;
  return s / n;
}
function weeklyUptrendGate(data, px) {
  const w = resampleToWeeks(data);
  const w13 = smaSeries(w, 13);
  const w26 = smaSeries(w, 26);
  const w52 = smaSeries(w, 52);
  const hasAll = [w13, w26, w52].every((v) => v > 0);
  if (!hasAll)
    return { pass: false, passRelaxed: false, hasAll, w13, w26, w52 };

  const slack = 0.01; // ≤1% slack allowed consistently
  const above13 = px > w13 * (1 - slack);
  const above26 = px > w26 * (1 - slack);
  const above52 = px > w52 * (1 - slack);

  const passStrict = above13 && above26 && above52;
  const pass2of3 =
    (above13 ? 1 : 0) + (above26 ? 1 : 0) + (above52 ? 1 : 0) >= 2;

  return { pass: passStrict, passRelaxed: pass2of3, hasAll, w13, w26, w52 };
}

// ==== Daily reclaim / MA cross gates ====
function crossesUp(prevA, nowA, prevB, nowB) {
  return prevA <= prevB && nowA > nowB;
}
function dailyMA(data, n) {
  return sma(data, n);
}
function recentPriceReclaim25and75(data, lookback = 3) {
  const i = data.length - 1;
  if (i < 1) return { pass: false };
  const dNow = data[i],
    dPrev = data[i - 1];
  const ma25Now = dailyMA(data, 25),
    ma75Now = dailyMA(data, 75);
  const ma25Prev = dailyMA(data.slice(0, -1), 25),
    ma75Prev = dailyMA(data.slice(0, -1), 75);
  // Guard: if either MA is not computable yet (==0), we cannot validate a reclaim
  if (!(ma25Now > 0 && ma75Now > 0 && ma25Prev > 0 && ma75Prev > 0)) {
    return {
      pass: false,
      ma25Now,
      ma75Now,
    };
  }
  const priceNow = +dNow.close,
    pricePrev = +dPrev.close;

  const cross25 = crossesUp(pricePrev, priceNow, ma25Prev, ma25Now);
  const cross75 = crossesUp(pricePrev, priceNow, ma75Prev, ma75Now);

  // also allow reclaim within last N bars
  let windowCross25 = cross25,
    windowCross75 = cross75;
  for (let k = 2; k <= lookback && i - k >= 0; k++) {
    const dK = data[i - k];
    const dKp1 = data[i - k + 1];
    const snapK = data.slice(0, i - k + 1); // up to K (inclusive)
    const snapKp1 = data.slice(0, i - k + 2); // up to K+1 (inclusive)
    const ma25K = dailyMA(snapK, 25);
    const ma25Kp1 = dailyMA(snapKp1, 25);
    const ma75K = dailyMA(snapK, 75);
    const ma75Kp1 = dailyMA(snapKp1, 75);
    if (!(ma25K > 0 && ma25Kp1 > 0 && ma75K > 0 && ma75Kp1 > 0)) continue;
    if (!windowCross25 && crossesUp(+dK.close, +dKp1.close, ma25K, ma25Kp1))
      windowCross25 = true;
    if (!windowCross75 && crossesUp(+dK.close, +dKp1.close, ma75K, ma75Kp1))
      windowCross75 = true;
  }
  const pass =
    windowCross25 && windowCross75 && priceNow > ma25Now && priceNow > ma75Now;
  return { pass, ma25Now, ma75Now };
}
function recentMA25Over75Cross(data, maxAge = 5) {
  const i = data.length - 1;
  if (i < 1) return { pass: false };
  // Find the most recent bar t (within maxAge) where MA25 crossed above MA75 between t-1 -> t
  // Age is (i - t). If the cross is on the latest bar, age = 0.
  let lastCrossAge = Infinity;
  for (let t = i; t >= Math.max(1, i - maxAge); t--) {
    const snapPrev = data.slice(0, t); // up to t-1 inclusive
    const snapNow = data.slice(0, t + 1); // up to t inclusive
    const m25Prev = dailyMA(snapPrev, 25),
      m75Prev = dailyMA(snapPrev, 75);
    const m25Now = dailyMA(snapNow, 25),
      m75Now = dailyMA(snapNow, 75);
    if (!(m25Prev > 0 && m75Prev > 0 && m25Now > 0 && m75Now > 0)) continue;
    const wasBelowOrEqual = m25Prev <= m75Prev;
    const nowAbove = m25Now > m75Now;
    if (wasBelowOrEqual && nowAbove) {
      lastCrossAge = i - t; // bars ago
      break;
    }
  }
  const m25Now = dailyMA(data, 25),
    m75Now = dailyMA(data, 75);
  const haveNow = m25Now > 0 && m75Now > 0 && m25Now > m75Now;
  const pass =
    Number.isFinite(lastCrossAge) && lastCrossAge <= maxAge && haveNow;
  return { pass, lastCrossAge, m25Now, m75Now };
}

function detectCrossVolumePlay(stock, data, cfg) {
  const i = data.length - 1;
  const d0 = data[i];
  const px = +d0.close || +stock.currentPrice || 0;
  const atr = Math.max(+stock.atr14 || 0, px * 0.005, 1e-9);

  // gates
  const wk = weeklyUptrendGate(data, px);
  if (!wk.passRelaxed)
    return { trigger: false, wait: "weekly uptrend not met", code: "X_WEEKLY" };

  const reclaim = cfg.crossUseReclaimNotJustMAcross
    ? recentPriceReclaim25and75(data, cfg.dailyReclaimLookback)
    : { pass: false };
  const macross = recentMA25Over75Cross(data, cfg.maCrossMaxAgeBars);

  if (!(reclaim.pass || macross.pass))
    return {
      trigger: false,
      wait: "no recent 25/75 reclaim/cross",
      code: "X_NOCROSS",
    };

  // volume
  const avgVol20 = avg(data.slice(-20).map((b) => +b.volume || 0));
  const volHot =
    avgVol20 > 0 ? +d0.volume >= cfg.crossMinVolumeFactor * avgVol20 : true;
  if (!volHot)
    return { trigger: false, wait: "volume not hot", code: "X_NOVOL" };

  // plan: stop under MA25 or last swing; target to clustered resistances
  const ma25 = dailyMA(data, 25);
  const supports = findSupportsBelow(data, px);
  const swingStop = Number.isFinite(supports?.[0])
    ? supports[0] - 0.5 * atr
    : Infinity;
  let stop = Math.min(
    ma25 > 0 ? ma25 - 0.6 * atr : Infinity,
    swingStop,
    px - 1.2 * atr
  );
  if (!(stop < px)) stop = px - 1.2 * atr;

  const resList = findResistancesAbove(data, px, stock);
  let target = resList?.length
    ? Math.max(resList[0], px + 2.4 * atr)
    : px + 2.6 * atr;

  const why = `Weekly up; ${
    reclaim.pass ? "reclaimed 25/75" : "25>75 cross"
  }; vol ≥ ${cfg.crossMinVolumeFactor}× 20d.`;
  return {
    trigger: true,
    stop,
    target,
    why,
    diag: { volHot, ma25, w13: wk.w13, w26: wk.w26, w52: wk.w52 },
  };
}

/* ======================= Market Structure ======================= */
function getMarketStructure(stock, data) {
  const px = num(stock.currentPrice) || num(data.at?.(-1)?.close);
  const m = {
    ma5: sma(data, 5),
    ma20: sma(data, 20),
    ma25: sma(data, 25),
    ma50: sma(data, 50),
    ma75: sma(data, 75),
    ma200: sma(data, 200),
  };

  let score = 0;
  if (px > m.ma25 && m.ma25 > 0) score++;
  if (px > m.ma50 && m.ma50 > 0) score++;
  if (m.ma25 > m.ma50 && m.ma50 > 0) score++;
  if (m.ma50 > m.ma200 && m.ma200 > 0) score++;

  const trend =
    score >= 3
      ? "STRONG_UP"
      : score === 2
      ? "UP"
      : score === 1
      ? "WEAK_UP"
      : "DOWN";

  const w = data.slice(-20);
  const recentHigh = Math.max(...w.map((d) => d.high ?? -Infinity));
  const recentLow = Math.min(...w.map((d) => d.low ?? Infinity));

  return {
    trend,
    recentHigh,
    recentLow,
    ...m,
  };
}

/* ======================== RR ======================== */
function analyzeRR(entryPx, stop, target, stock, ms, cfg, ctx = {}) {
  const atr = Math.max(num(stock.atr14), entryPx * 0.005, 1e-6);

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
  } else {
    // DIP: ensure stop < entry; keep dip.js logic intact
    if (!(stop < entryPx)) stop = entryPx - 0.8 * atr;
  }

  // 2) Light target sanity with resistances
  let resList = [];
  if (Array.isArray(ctx?.data) && ctx.data.length) {
    resList = findResistancesAbove(ctx.data, entryPx, stock) || [];
  }
  if (resList.length) {
    const head0 = resList[0] - entryPx;
    const hopThresh = ctx?.kind === "DIP" ? 1.1 * atr : 0.7 * atr;
    if (head0 < hopThresh && resList[1]) {
      target = Math.max(target, resList[1]);
    }
  }
  if (ctx?.kind === "DIP") {
    // ensure a minimum extension for DIPs
    target = Math.max(target, entryPx + Math.max(2.6 * atr, entryPx * 0.022));
  }

  // 3) Compute base RR
  const risk = Math.max(0.01, entryPx - stop);
  let reward = Math.max(0, target - entryPx);
  let ratio = reward / risk;

  // 4) RR floors (use DIP-specific if applicable)
  // 4) RR floors (use DIP-specific if applicable)
  let need = cfg.minRRbase ?? 1.5;
  if (ctx?.kind === "DIP" && Number.isFinite(cfg.dipMinRR)) {
    need = Math.max(need, cfg.dipMinRR);
  }
  if (ms.trend === "STRONG_UP")
    need = Math.max(need, cfg.minRRstrongUp ?? need);
  if (ms.trend === "WEAK_UP") need = Math.max(need, cfg.minRRweakUp ?? need);

  // micro adjustment by instrument volatility
  const atrPct = (atr / Math.max(1e-9, entryPx)) * 100;
  if (atrPct <= 1.0) need = Math.max(need - 0.1, 1.25);
  if (atrPct >= 3.0) need = Math.max(need, 1.6);

  // *** NEW: relax RR for first-chance weekly and daily crosses ***
  // Rationale:
  // - FIRST_WEEKLY = historically monster PF (~1.56) even for ones we skipped.
  //   Let slightly weaker RR through.
  // - FIRST_DAILY  = slightly above baseline PF (~1.32), allow mild leniency.
  if (ctx?.flavor === "FIRST_WEEKLY") {
    need = Math.max(need - 0.15, 1.25); // was maybe ~1.45+ → let ~1.3-1.35 through
  } else if (ctx?.flavor === "FIRST_DAILY") {
    need = Math.max(need - 0.05, 1.3); // tiny nudge, still keeps trash out
  }

  // 5) SCOOT: bounded target lifts to nearby clustered resistances
  if (cfg.scootEnabled) {
    const atrCap =
      ctx?.kind === "DIP"
        ? cfg.scootATRCapDIP ?? 4.2
        : cfg.scootATRCapNonDIP ?? 3.5;

    // First hop: try resList[1]
    if (ratio < need && Array.isArray(resList) && resList.length >= 2) {
      const nextRes = resList[1];
      const lifted = Math.min(nextRes, entryPx + atrCap * atr);
      if (lifted > target) {
        target = lifted;
        reward = Math.max(0, target - entryPx);
        ratio = reward / risk;
      }
    }

    // Second hop: only if still within 0.25 of the floor and we have resList[2]
    if (
      ratio < need &&
      need - ratio <= (cfg.scootNearMissBand ?? 0.25) &&
      Array.isArray(resList) &&
      resList.length >= 3
    ) {
      const next2 = Math.min(resList[2], entryPx + atrCap * atr);
      if (next2 > target) {
        target = next2;
        reward = Math.max(0, target - entryPx);
        ratio = reward / risk;
      }
    }
  }

  // 6) Acceptable / probation
  let acceptable = ratio >= need;

  const allowProb = !!cfg.allowProbation;
  const rsiHere = Number(stock.rsi14) || rsiFromData(ctx?.data || [], 14);

  // base probation
  let probation =
    allowProb &&
    !acceptable &&
    ratio >= need - 0.02 &&
    (ms.trend === "STRONG_UP" || ms.trend === "UP") &&
    rsiHere < 58;

  // *** NEW: slightly widen probation band for FIRST_WEEKLY and FIRST_DAILY ***
  if (
    !acceptable &&
    allowProb &&
    (ctx?.flavor === "FIRST_WEEKLY" || ctx?.flavor === "FIRST_DAILY")
  ) {
    const extraBand = ctx.flavor === "FIRST_WEEKLY" ? 0.07 : 0.04;
    // let us accept if we're close-ish to need, AND trend isn't horrible
    if (
      ratio >= need - extraBand &&
      (ms.trend === "STRONG_UP" || ms.trend === "UP")
    ) {
      probation = true;
    }
  }

  acceptable = acceptable || probation;


  return {
    acceptable,
    ratio,
    stop,
    target,
    need,
    atr,
    risk,
    reward,
    probation,
  };
}

/* ============================ Guards ============================ */
function guardVeto(stock, data, px, rr, ms, cfg, nearestRes, _kind) {
  const details = {};
  const atr = Math.max(num(stock.atr14), px * 0.005, 1e-6);

  // RSI caps
  const rsi = num(stock.rsi14) || rsiFromData(data, 14);
  details.rsi = rsi;
  try {
    if (isFiniteN(rsi)) teleGlobal._lastRSI = rsi;
  } catch {}
  if (!(_kind === "FIRST_WEEKLY") && rsi >= cfg.hardRSI) {
    return {
      veto: true,
      reason: `RSI ${rsi.toFixed(1)} ≥ ${cfg.hardRSI}`,
      details,
    };
  }
  // For FIRST_WEEKLY, we *don't* instantly veto on hardRSI.
  // We just record it in details and continue.
  if (_kind === "FIRST_WEEKLY" && rsi >= cfg.hardRSI) {
    details.note = "RSI high but FIRST_WEEKLY allowed";
  }


  // headroom
  const resList = findResistancesAbove(data, px, stock);
  let effRes = Number.isFinite(nearestRes) ? nearestRes : resList[0];
  if (isFiniteN(effRes) && (effRes - px) / atr < 0.6 && resList[1])
    effRes = resList[1];

  if (isFiniteN(effRes)) {
    const headroomATR = (effRes - px) / atr;
    const headroomPct = ((effRes - px) / Math.max(px, 1e-9)) * 100;
    details.nearestRes = effRes;
    details.headroomATR = headroomATR;
    details.headroomPct = headroomPct;
    // stash for histograms
    try {
      teleGlobal.histos.headroom.push({
        atr: headroomATR,
        pct: headroomPct,
        nearestRes: effRes,
        ticker: stock?.ticker,
      });
    } catch {}

    const tooTightHeadroom =
      (headroomATR < (cfg.nearResVetoATR ?? 0.35) ||
        headroomPct < (cfg.nearResVetoPct ?? 0.8)) &&
      rr.ratio < rr.need;

    if (tooTightHeadroom && _kind !== "FIRST_WEEKLY") {
      return {
        veto: true,
        reason: `Headroom too small (${headroomATR.toFixed(
          2
        )} ATR / ${headroomPct.toFixed(2)}%)`,
        details,
      };
    }
    if (tooTightHeadroom && _kind === "FIRST_WEEKLY") {
      details.note = "Tight headroom but FIRST_WEEKLY allowed";
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
    const cap = cfg.maxATRfromMA25;
    const tooFar = distMA25 > (cap ?? 2.4) + 0.2;

    if (tooFar && _kind !== "FIRST_WEEKLY") {
      return {
        veto: true,
        reason: `Too far above MA25 (${distMA25.toFixed(2)} ATR)`,
        details,
      };
    }
    if (tooFar && _kind === "FIRST_WEEKLY") {
      details.note = "Extended vs MA25 but FIRST_WEEKLY allowed";
    }

  }

  // streak guard
  const ups = countConsecutiveUpDays(data);
  details.consecUp = ups;
  if (ups >= 8) {
    return {
      veto: true,
      reason: `Consecutive up days ${ups} ≥ 8`,
      details,
    };
  }

  return { veto: false, reason: "", details };
}


/* ============================ Helpers & Fallback ============================ */
function buildSwingTimeline(entryPx, candidate, rr, ms) {
  const steps = [];
  const atr = Number(rr?.atr) || 0;
  const initialStop = Number(candidate.stop);
  const finalTarget = Number(candidate.target);
  const risk = Math.max(0.01, entryPx - initialStop);
  const kind = candidate.kind || "ENTRY";

  steps.push({
    when: "T+0",
    condition: "On fill",
    stopLoss: initialStop,
    priceTarget: finalTarget,
    note: `${kind}: initial plan`,
  });
  steps.push({
    when: "+1R",
    condition: `price ≥ ${entryPx + 1 * risk}`,
    stopLoss: entryPx,
    priceTarget: finalTarget,
    note: "Move stop to breakeven",
  });
  steps.push({
    when: "+1.5R",
    condition: `price ≥ ${entryPx + 1.5 * risk}`,
    stopLoss: entryPx + 0.6 * risk,
    priceTarget: finalTarget,
    note: "Lock 0.6R",
  });
  steps.push({
    when: "+2R",
    condition: `price ≥ ${entryPx + 2 * risk}`,
    stopLoss: entryPx + 1.2 * risk,
    priceTarget: finalTarget,
    note: "Runner: stop = entry + 1.2R",
  });
  steps.push({
    when: "TRAIL",
    condition: "After +2R",
    stopLossRule: "max( swing low - 0.5*ATR, MA25 - 0.6*ATR )",
    stopLossHint: Math.max(
      ms?.ma25 ? ms.ma25 - 0.6 * atr : initialStop,
      initialStop
    ),
    priceTarget: finalTarget,
    note: "Trail by structure/MA",
  });
  return steps;
}

function fallbackPlan(stock, data, cfg) {
  const ms = getMarketStructure(stock, data);
  const pxNow = num(stock.currentPrice) || num(data.at?.(-1)?.close) || 1;
  const prov = provisionalPlan(stock, data, ms, pxNow, cfg);
  return {
    stopLoss: toTick(prov.stop, stock),
    priceTarget: toTick(prov.target, stock),
    smartStopLoss: toTick(prov.stop, stock),
    smartPriceTarget: toTick(prov.target, stock),
  };
}

function provisionalPlan(stock, data, ms, pxNow, cfg) {
  const px = num(pxNow) || 1;
  const atr = Math.max(num(stock.atr14), px * 0.005, 1e-6);
  const supports = findSupportsBelow(data, px);
  const stopFromSwing = Number.isFinite(supports?.[0])
    ? supports[0] - 0.5 * atr
    : NaN;
  const stopFromMA25 =
    ms && ms.ma25 > 0 && ms.ma25 < px ? ms.ma25 - 0.6 * atr : NaN;
  let stop = [stopFromSwing, stopFromMA25, px - 1.2 * atr]
    .filter(Number.isFinite)
    .reduce((m, v) => Math.min(m, v), Infinity);
  if (!Number.isFinite(stop)) stop = px - 1.2 * atr;
  const resList = findResistancesAbove(data, px, stock);
  let target = Number.isFinite(resList?.[0])
    ? Math.max(resList[0], px + 2.2 * atr)
    : px + 2.4 * atr;
  const rr = analyzeRR(
    px,
    stop,
    target,
    stock,
    ms || { trend: "UP" },
    cfg || getConfig({}),
    {
      kind: "FALLBACK",
      data,
    }
  );
  return { stop: rr.stop, target: rr.target, rr };
}

/* =========================== Utils =========================== */
function sma(data, n, field = "close") {
  if (!Array.isArray(data) || data.length < n) return 0;
  let s = 0;
  for (let i = data.length - n; i < data.length; i++) s += +data[i][field] || 0;
  return s / n;
}
function round0(v) {
  return Math.round(Number(v) || 0);
}
function toTick(v, stock) {
  const tick =
    Number(stock?.tickSize) || inferTickFromPrice(Number(v) || 0) || 0.1;
  const x = Number(v) || 0;
  return Math.round(x / tick) * tick;
}
function inferTickFromPrice(p) {
  if (p >= 5000) return 1;
  if (p >= 1000) return 0.5;
  if (p >= 100) return 0.1;
  if (p >= 10) return 0.05;
  return 0.01;
}
function deRound(v) {
  const s = String(Math.round(v));
  if (/(00|50|25|75)$/.test(s)) return v - 3 * (inferTickFromPrice(v) || 0.1);
  return v;
}
function rsiFromData(data, len = 14) {
  const n = data.length;
  if (n < len + 1) return 50;
  let gains = 0,
    losses = 0;
  for (let i = n - len; i < n; i++) {
    const prev = +data[i - 1].close || 0;
    const curr = +data[i].close || 0;
    const d = curr - prev;
    if (d > 0) gains += d;
    else losses -= d;
  }
  const ag = gains / len,
    al = losses / len || 1e-9;
  const rs = ag / al;
  return 100 - 100 / (1 + rs);
}
function num(v) {
  return Number.isFinite(v) ? v : 0;
}
function isFiniteN(v) {
  return Number.isFinite(v);
}
function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + (+b || 0), 0) / arr.length : 0;
}
function fmt(x) {
  return Number.isFinite(x) ? (+x).toFixed(2) : String(x);
}
function near(a, b, eps = 1e-8) {
  return Math.abs((+a || 0) - (+b || 0)) <= eps;
}
function countConsecutiveUpDays(data, k = 8) {
  let c = 0;
  for (let i = data.length - 1; i > 0 && c < k; i--) {
    if (+data[i].close > +data[i - 1].close) c++;
    else break;
  }
  return c;
}
function clusterLevels(levels, atrVal, thMul = 0.3) {
  const th = thMul * Math.max(atrVal, 1e-9);
  const uniq = Array.from(
    new Set(levels.map((v) => +Number(v).toFixed(2)))
  ).sort((a, b) => a - b);
  const out = [];
  let bucket = [];
  for (let i = 0; i < uniq.length; i++) {
    if (!bucket.length || Math.abs(uniq[i] - bucket[bucket.length - 1]) <= th)
      bucket.push(uniq[i]);
    else {
      out.push(avg(bucket));
      bucket = [uniq[i]];
    }
  }
  if (bucket.length) out.push(avg(bucket));
  return out;
}
function findResistancesAbove(data, px, stock) {
  const ups = [];
  const win = data.slice(-60);
  for (let i = 2; i < win.length - 2; i++) {
    const h = num(win[i].high);
    if (h > px && h > num(win[i - 1].high) && h > num(win[i + 1].high))
      ups.push(h);
  }
  const yHigh = num(stock.fiftyTwoWeekHigh);
  if (yHigh > px) ups.push(yHigh);
  const atr = Math.max(num(stock.atr14), px * 0.005, 1e-9);
  return clusterLevels(ups, atr, 0.3);
}
function findSupportsBelow(data, px) {
  const downs = [];
  const win = data.slice(-60);
  for (let i = 2; i < win.length - 2; i++) {
    const l = num(win[i].low);
    if (l < px && l < num(win[i - 1].low) && l < num(win[i + 1].low))
      downs.push(l);
  }
  const uniq = Array.from(new Set(downs.map((v) => +v.toFixed(2)))).sort(
    (a, b) => b - a
  );
  return uniq;
}

function withNo(reason, ctx = {}) {
  const stock = ctx.stock || {};
  const data = Array.isArray(ctx.data) ? ctx.data : [];
  const cfg = ctx.cfg || getConfig({});
  const out = {
    buyNow: false,
    reason,
    ...fallbackPlan(stock, data, cfg),
    timeline: [],
    debug: ctx,
  };
  out.telemetry = undefined;
  return out;
}
function toTeleRR(rr) {
  return {
    checked: true,
    acceptable: !!rr.acceptable,
    ratio: rr.ratio,
    need: rr.need,
    risk: rr.risk,
    reward: rr.reward,
    stop: rr.stop,
    target: rr.target,
    probation: !!rr.probation,
  };
}

/* Optional: compact summary for console logs in callers */
function summarizeTelemetryForLog(tele) {
  try {
    const g = tele?.gates || {};
    const rr = tele?.rr || {};
    const guard = tele?.guard || {};
    return {
      gates: {
        regime: { pass: true, why: "" }, // regime disabled; keep shape
        structure: { pass: g.structure?.pass, why: g.structure?.why },
      },
      rr: {
        checked: rr.checked,
        acceptable: rr.acceptable,
        ratio: rr.ratio,
        need: rr.need,
        stop: rr.stop,
        target: rr.target,
        probation: rr.probation,
      },
      guard: {
        checked: guard.checked,
        veto: guard.veto,
        reason: guard.reason,
        details: guard.details,
      },
      context: tele?.context,
      blocks: tele?.blocks,
      histos: tele?.histos,
      distros: tele?.distros,
    };
  } catch {
    return {};
  }
}

/* Batch-friendly grouper for blocks */
export function summarizeBlocks(teleList = []) {
  const out = {};
  for (const t of teleList) {
    for (const b of t.blocks || []) {
      const key = `${b.code}`;
      if (!out[key]) out[key] = { count: 0, examples: [], ctxSample: [] };
      out[key].count++;
      if (out[key].examples.length < 6) {
        out[key].examples.push(
          `${t?.context?.ticker || "UNK"}` +
            (t?.context?.gatesDataset?.lastDate
              ? `@${t.context.gatesDataset.lastDate}`
              : "")
        );
      }
      if (out[key].ctxSample.length < 3) out[key].ctxSample.push(b.ctx);
    }
  }
  return Object.entries(out)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([code, v]) => ({
      code,
      count: v.count,
      examples: v.examples,
      ctxSample: v.ctxSample,
    }));
}

export { getConfig, summarizeTelemetryForLog };



/* ========= 13/26/52 weekly “fresh flip ONLY” detector ========= */
function detectWeeklyStackedCross(data, lookbackBars = 5) {
  // 1) Build weekly closes, and drop the last week ONLY if it's really incomplete
  const weeksAll = resampleToWeeks(data);

  // ISO week helpers
  const isoKey = (d) => {
    const dt = new Date(d);
    const t = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
    const dayNum = t.getUTCDay() || 7;         // 1..7 (Mon..Sun)
    t.setUTCDate(t.getUTCDate() + 4 - dayNum); // Thu of this week
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
    return t.getUTCFullYear() + "-" + weekNo;  // e.g. "2025-42"
  };


  // How many daily bars do we actually have in the last daily week?
  const lastDaily = data.at(-1);
  const lastDailyWeek = lastDaily ? isoKey(lastDaily.date) : null;
  let barsInLastDailyWeek = 0;
  if (lastDailyWeek) {
    for (let i = data.length - 1; i >= 0; i--) {
      if (isoKey(data[i].date) !== lastDailyWeek) break;
      barsInLastDailyWeek++;
    }
  }
  // Consider a week "complete" if we saw at least 4 trading days (holidays tolerated).
  const dropLastWeekly = barsInLastDailyWeek > 0 && barsInLastDailyWeek < 4;
  const weeks = (weeksAll.length >= 1 && dropLastWeekly) ? weeksAll.slice(0, -1) : weeksAll;

  if (weeks.length < 52) {
    return { trigger: false, why: "Insufficient weekly history (need ≥52)" };
  }

  // 2) Weekly SMA helper (inclusive index)
  const smaW = (n, i) => {
    if (i + 1 < n) return 0;
    let s = 0;
    for (let k = i - n + 1; k <= i; k++) s += +weeks[k].close || 0;
    return s / n;
  };

  const last = weeks.length - 1;
  const eps = 0.0015; // ~0.15% margin to avoid micro-jitters

  const getTriplet = (i) => {
    const m13 = smaW(13, i), m26 = smaW(26, i), m52 = smaW(52, i);
    const stacked =
      m13 > 0 && m26 > 0 && m52 > 0 &&
      m13 >= m26 * (1 + eps) &&
      m26 >= m52 * (1 + eps);
    return { m13, m26, m52, stacked };
  };

  // Fresh flip ONLY: first bar in the lookback where it becomes stacked
  for (let i = last; i >= Math.max(1, last - lookbackBars + 1); i--) {
    const cur = getTriplet(i);
    const prev = getTriplet(i - 1);
    if (cur.stacked && !prev.stacked) {
      return {
        trigger: true,
        weeksAgo: last - i,
        index: i,
        m13: cur.m13, m26: cur.m26, m52: cur.m52,
        why: `Weekly MAs freshly flipped to 13>26>52 within last ${lookbackBars} weeks`,
      };
    }
  }

  return {
    trigger: false,
    why: `No weekly fresh 13>26>52 flip in ≤${lookbackBars} completed weeks`,
  };
}


/* ========= Daily 5/25/75 “fresh flip ONLY” engine (completed daily bars) ========= */
function detectDailyStackedCross(data, lookbackBars = 5) {
  // Use completed-daily bars only (caller passes them)
  const smaD = (n, i) => {
    if (i + 1 < n) return 0;
    let s = 0;
    for (let k = i - n + 1; k <= i; k++) s += +data[k].close || 0;
    return s / n;
  };
  const last = data.length - 1;
  if (last < 75) return { trigger: false, why: "Insufficient daily history (need ≥75 bars)" };

  for (let i = last; i >= Math.max(1, last - lookbackBars + 1); i--) {
    const m5 = smaD(5, i), m25 = smaD(25, i), m75 = smaD(75, i);
    const nowStacked = m5 > 0 && m25 > 0 && m75 > 0 && m5 > m25 && m25 > m75;

    const pm5 = smaD(5, i - 1), pm25 = smaD(25, i - 1), pm75 = smaD(75, i - 1);
    const prevStacked = pm5 > 0 && pm25 > 0 && pm75 > 0 && pm5 > pm25 && pm25 > pm75;

    if (nowStacked && !prevStacked) {
      return {
        trigger: true,
        daysAgo: last - i,
        index: i,
        m5, m25, m75,
        why: `Daily MAs freshly flipped to 5>25>75 within last ${lookbackBars} days`,
      };
    }
  }
  return { trigger: false, why: `No fresh daily 5>25>75 cross in ≤${lookbackBars} days` };
}


/**
 * analyseCrossing — detects BOTH playbooks (fresh-only):
 *  - Weekly 13/26/52 fresh flip (≤5 weeks)
 *  - Daily 5/25/75 fresh flip (≤5 days)
 */
export function analyseCrossing(stock, historicalData, opts = {}) {
  const cfg = getConfig(opts);
  const reasons = [];
  const tele = teleInit();
  const T = mkTracer(opts);

  if (!Array.isArray(historicalData) || historicalData.length < 75) {
    const r = "Insufficient historical data (need ≥75 daily bars).";
    const out = withNo(r, { stock, data: historicalData || [], cfg });
    out.telemetry = {
      ...tele,
      outcome: { buyNow: false, reason: r },
      reasons: [r],
      trace: T.logs,
    };
    out.meta = { cross: { selected: null, weekly: null, daily: null } };
    return out;
  }

  const dataAll = [...historicalData].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );
  const last = dataAll.at(-1) || {};
  if (![last.open, last.high, last.low, last.close].every(Number.isFinite)) {
    const r = "Invalid last bar OHLCV.";
    const out = withNo(r, { stock, data: dataAll, cfg });
    out.telemetry = {
      ...tele,
      outcome: { buyNow: false, reason: r },
      reasons: [r],
      trace: T.logs,
    };
    out.meta = { cross: { selected: null, weekly: null, daily: null } };
    return out;
  }
  if (!Number.isFinite(last.volume)) last.volume = 0;

  const px = Number(stock.currentPrice) || Number(last.close) || 0;
  const openPx = Number(stock.openPrice) || Number(last.open) || px;
  const prevClose =
    Number(stock.prevClosePrice) || Number(last.close) || openPx;
  const dayPct = openPx ? ((px - openPx) / openPx) * 100 : 0;

  // === Volatility snapshot (for backtest slicing) ===
  const atrRaw = Math.max(num(stock.atr14), px * 0.005, 1e-6);
  const atrPct = (atrRaw / Math.max(px, 1e-9)) * 100;

  let volBucket = "medium";
  if (atrPct < 1.0) {
    volBucket = "low";
  } else if (atrPct >= 3.0) {
    volBucket = "high";
  }

  // we'll reuse this later in the return
  const volatilityInfo = {
    atr: atrRaw,
    atrPct,
    bucket: volBucket,
  };

  const completedDaily = Array.isArray(opts?.dataForGates)
    ? opts.dataForGates
    : dataAll.length > 0
    ? dataAll.slice(0, -1)
    : dataAll;

  const msFull = getMarketStructure(stock, dataAll);
  tele.context = {
    ticker: stock?.ticker,
    px,
    openPx,
    prevClose,
    dayPct,
    trend: msFull.trend,
    ma: {
      ma5: msFull.ma5,
      ma20: msFull.ma20,
      ma25: msFull.ma25,
      ma50: msFull.ma50,
      ma75: msFull.ma75,
      ma200: msFull.ma200,
    },
    perfectMode: cfg.perfectMode,
    gatesDataset: { bars: dataAll.length, lastDate: dataAll.at(-1)?.date },
  };

  // Structure gate (minimal)
  const structureGateOk =
    (msFull.trend !== "DOWN" || cfg.allowDipInDowntrend) &&
    px >= (msFull.ma5 || 0) * 0.988;
  tele.gates.structure = {
    pass: !!structureGateOk,
    why: structureGateOk ? "" : "trend DOWN or price < MA5",
  };
  if (!structureGateOk) {
    const margin =
      ((px - (msFull.ma5 || 0)) / Math.max(msFull.ma5 || 1e-9, 1e-9)) * 100;
    pushBlock(tele, "STRUCTURE", "structure", "trend DOWN or price < MA5", {
      trend: msFull.trend,
      px,
      ma5: msFull.ma5,
      marginPct: +margin.toFixed(3),
    });
  }

  /* ---------------- Fresh WEEKLY/DAILY crossing (completed bars) ---------------- */
  const crossW = detectWeeklyStackedCross(
    completedDaily,
    cfg.freshWeeklyLookbackWeeks ?? 5
  );
  const crossD = detectDailyStackedCross(
    completedDaily,
    cfg.freshDailyLookbackDays ?? 5
  );

  T("crossing", "weekly", !!crossW.trigger, crossW.why, { crossW }, "verbose");
  T("crossing", "daily", !!crossD.trigger, crossD.why, { crossD }, "verbose");

  tele.flags = { weeklyFlip: !!crossW.trigger, dailyFlip: !!crossD.trigger };

  const crossMeta = {
    weekly: crossW.trigger ? { barsAgo: crossW.weeksAgo } : null,
    daily: crossD.trigger ? { barsAgo: crossD.daysAgo } : null,
  };
  tele.crossMeta = { ...crossMeta };

  const candidates = [];

  const planCross = (label) => {
    const baseATR = Math.max(Number(stock.atr14) || 0, px * 0.005, 1e-6);

    // NEW: flavor so downstream logic can loosen rules
    const flavor =
      label === "WEEKLY"
        ? "FIRST_WEEKLY"
        : label === "DAILY"
        ? "FIRST_DAILY"
        : "GENERIC_CROSS";

    const rr = analyzeRR(
      px,
      Math.max(1, px - 1.2 * baseATR),
      px + 2.4 * baseATR,
      stock,
      msFull,
      { ...cfg, minRRbase: Math.max(cfg.minRRbase, cfg.crossMinRR) },
      { kind: "CROSS", flavor, data: completedDaily } // <--- PATCH
    );
    return { label, rr };
  };
  

  // Fresh WEEKLY
  if (crossW.trigger && structureGateOk) {
    const p = planCross("WEEKLY");

    if (p.rr.acceptable) {
      // NEW: guard veto for crosses too
      const gv = guardVeto(
        stock,
        dataAll,
        px,
        p.rr,
        msFull,
        cfg,
        undefined, // nearestRes not easily known here, ok to pass undefined
        "FIRST_WEEKLY" // <--- PATCH
      );

      if (!gv.veto) {
        candidates.push({
          kind: "WEEKLY CROSS",
          why: crossW.why,
          rr: p.rr,
          stop: p.rr.stop,
          target: p.rr.target,
        });
      } else {
        pushBlock(tele, "VETO_WEEKLY", "guard", gv.reason, gv.details);
      }
    } else {
      tele.histos.rrShortfall.push({
        need: +p.rr.need.toFixed(2),
        have: +p.rr.ratio.toFixed(2),
        short: +(p.rr.need - p.rr.ratio).toFixed(3),
        atrPct: +((p.rr.atr / Math.max(px, 1e-9)) * 100).toFixed(2),
        trend: msFull.trend,
        ticker: stock?.ticker,
      });
    }
  }
  

  // Fresh DAILY
  if (crossD.trigger && structureGateOk) {
    const p = planCross("DAILY");

    if (p.rr.acceptable) {
      const gv = guardVeto(
        stock,
        dataAll,
        px,
        p.rr,
        msFull,
        cfg,
        undefined,
        "FIRST_DAILY" // <--- PATCH
      );

      if (!gv.veto) {
        candidates.push({
          kind: "DAILY CROSS",
          why: crossD.why,
          rr: p.rr,
          stop: p.rr.stop,
          target: p.rr.target,
        });
      } else {
        pushBlock(tele, "VETO_DAILY", "guard", gv.reason, gv.details);
      }
    } else {
      tele.histos.rrShortfall.push({
        need: +p.rr.need.toFixed(2),
        have: +p.rr.ratio.toFixed(2),
        short: +(p.rr.need - p.rr.ratio).toFixed(3),
        atrPct: +((p.rr.atr / Math.max(px, 1e-9)) * 100).toFixed(2),
        trend: msFull.trend,
        ticker: stock?.ticker,
      });
    }
  }
  

  /* ---------------- DIP lane (SECOND-CHANCE ENTRY ONLY, matched by timeframe) ---------------- */
  /*
    Rules:
    - We DO NOT allow a dip entry while there's still a fresh cross today (crossW.trigger or crossD.trigger).
      That's the "first chance" phase.
    - After that fresh window expires, we allow exactly ONE second-chance setup:
        * If the WEEKLY flip is stale-but-valid (freshW < weeksAgo ≤ maxStaleW),
          then we look ONLY for a WEEKLY dip bounce (bigger pullback). We ignore daily dips here.
        * If the DAILY flip is stale-but-valid (freshD < barsAgo ≤ maxStaleD),
          and weeklyWindowOK is NOT true (weekly takes priority),
          then we look ONLY for a DAILY dip bounce.
    - We will not mix "weekly window" with "daily dip", or "daily window" with "weekly dip".
  */

  // Utilities passed into dip detectors
  const U = {
    num,
    avg,
    near,
    sma,
    rsiFromData,
    findResistancesAbove,
    findSupportsBelow,
    inferTickFromPrice,
    tracer: T,
  };

  // 1. Basic DIP gates (trend health + reclaim of 25/75 etc.)
  const wkGate = weeklyUptrendGate(dataAll, px);
  const reclaimGate = recentPriceReclaim25and75(
    dataAll,
    cfg.dailyReclaimLookback
  );
  const maCrossGate = recentMA25Over75Cross(dataAll, cfg.maCrossMaxAgeBars);

  let dipGatePass = true;
  const dipGateWhy = [];

  if (cfg.requireWeeklyUpForDIP && !wkGate.passRelaxed) {
    dipGatePass = false;
    dipGateWhy.push("not above 13/26/52-week MAs");
  }
  if (cfg.requireDailyReclaim25and75ForDIP || cfg.requireMA25over75ForDIP) {
    if (!(reclaimGate.pass || maCrossGate.pass)) {
      dipGatePass = false;
      dipGateWhy.push(
        `no 25/75 reclaim (≤${cfg.dailyReclaimLookback}) OR 25>75 cross (≤${cfg.maCrossMaxAgeBars})`
      );
    }
  }

  // 2. Are we still in a fresh flip window *today*?
  //    If yes => first-chance mode still on => DIP not allowed yet.
  const haveFreshCrossNow = !!(crossW.trigger || crossD.trigger);

  // 3. Measure ages of the LAST bullish flips (daily / weekly)
  const lastDailyFlip = lastDailyStackedCrossAge(completedDaily);
  const lastWeeklyFlip = lastWeeklyStackedCrossAge(completedDaily);

  // "fresh" windows
  const freshD = cfg.freshDailyLookbackDays ?? 5;
  const freshW = cfg.freshWeeklyLookbackWeeks ?? 5;

  // "stale but valid" windows
  const maxStaleD = cfg.staleDailyCrossMaxAgeBars ?? 20;
  const maxStaleW = cfg.staleWeeklyCrossMaxAgeWeeks ?? 10;

  // Does the DAILY flip qualify as "stale but still valid" second-chance?
  const dailyWindowOK =
    !!lastDailyFlip.found &&
    lastDailyFlip.barsAgo > freshD &&
    lastDailyFlip.barsAgo <= maxStaleD;

  // Does the WEEKLY flip qualify as "stale but still valid" second-chance?
  const weeklyWindowOK =
    !!lastWeeklyFlip.found &&
    lastWeeklyFlip.weeksAgo > freshW &&
    lastWeeklyFlip.weeksAgo <= maxStaleW;

  // Which lane are we in?
  // WEEKLY takes priority if both technically match.
  let dipLane = null;
  if (!haveFreshCrossNow) {
    if (weeklyWindowOK) {
      dipLane = "WEEKLY";
    } else if (dailyWindowOK) {
      dipLane = "DAILY";
    }
  }

  // 4. Detect the appropriate dip bounce ONLY for the chosen lane.
  //    - WEEKLY lane -> detectDipBounceWeekly()
  //    - DAILY lane  -> detectDipBounce()   (the daily version)
  let activeDip = null;
  if (dipLane === "WEEKLY") {
    activeDip = detectDipBounceWeekly(stock, dataAll, cfg, U);
  } else if (dipLane === "DAILY") {
    activeDip = detectDipBounce(stock, dataAll, cfg, U);
  }

  // Store diagnostics in telemetry no matter what (helps debug later)
  tele.dip = {
    trigger: !!activeDip?.trigger,
    waitReason: activeDip?.waitReason || "",
    why: activeDip?.why || "",
    diagnostics: activeDip?.diagnostics || {},
  };
  if (!activeDip?.trigger) {
    pushBlock(
      tele,
      "DIP_WAIT",
      "dip",
      activeDip?.waitReason || "DIP not ready",
      {
        px,
        diag: activeDip?.diagnostics || {},
        dipLane,
      }
    );
  }

  // 5. "Has it just dipped" freshness (bounce recency)
  //    We respect the appropriate recency check:
  //    - DAILY lane uses staleDipMaxAgeBars (bars)
  //    - WEEKLY lane uses staleDipMaxAgeWeeklyWeeks (weeks)
  let dipStillFreshEnough = false;
  if (dipLane === "DAILY") {
    const ageBars = activeDip?.diagnostics?.bounceAgeBars;
    dipStillFreshEnough =
      !Number.isFinite(ageBars) || ageBars <= (cfg.staleDipMaxAgeBars ?? 7);
  } else if (dipLane === "WEEKLY") {
    const ageWeeks = activeDip?.diagnostics?.bounceAgeBars;
    dipStillFreshEnough =
      !Number.isFinite(ageWeeks) ||
      ageWeeks <= (cfg.staleDipMaxAgeWeeklyWeeks ?? 2);
  }

  // 6. Final gate for the DIP second-chance entry
  const dipSecondChanceOK =
    !!dipLane && // we are actually in a stale-but-valid lane
    activeDip?.trigger &&
    structureGateOk &&
    dipGatePass &&
    dipStillFreshEnough;

  if (dipSecondChanceOK) {
    // Risk/Reward for this specific dip plan
    const rrD = analyzeRR(
      px,
      activeDip.stop,
      activeDip.target,
      stock,
      msFull,
      cfg,
      {
        kind: "DIP",
        data: dataAll,
      }
    );
    tele.rr = tele.rr?.checked ? tele.rr : toTeleRR(rrD);

    if (rrD.acceptable) {
      // Guard veto (RSI too hot, too extended, no headroom, etc.)
      const gv = guardVeto(
        stock,
        dataAll,
        px,
        rrD,
        msFull,
        cfg,
        activeDip.nearestRes,
        "DIP"
      );
      if (!gv.veto) {
        candidates.push({
          kind: dipLane === "WEEKLY" ? "DIP AFTER WEEKLY" : "DIP AFTER DAILY",
          why: activeDip.why,
          rr: rrD,
          stop: rrD.stop,
          target: rrD.target,
        });
      } else {
        pushBlock(tele, "VETO_DIP", "guard", gv.reason, gv.details);
      }
    } else {
      pushBlock(
        tele,
        "RR_FAIL_DIP",
        "rr",
        `RR ${fmt(rrD.ratio)} < need ${fmt(rrD.need)}`,
        { stop: rrD.stop, target: rrD.target }
      );
    }
  } else if (activeDip?.trigger && !dipGatePass) {
    // Trend/MA reclaim gate failed
    pushBlock(tele, "DIP_GATE", "dip", `DIP gated: ${dipGateWhy.join("; ")}`, {
      wkGate,
      reclaimGate,
      maCrossGate,
      dipLane,
    });
  } else if (activeDip?.trigger && haveFreshCrossNow) {
    // We tried DIP even though first-chance is still active. Not allowed.
    pushBlock(
      tele,
      "DIP_TOO_EARLY",
      "dip",
      "DIP suppressed: fresh CROSS phase still active",
      {
        crossW: { trigger: crossW.trigger, weeksAgo: crossW.weeksAgo },
        crossD: { trigger: crossD.trigger, daysAgo: crossD.daysAgo },
        dipLane,
      }
    );
  } else if (activeDip?.trigger && !dipLane) {
    // We had a dip bounce, but we are NOT in any stale-but-valid window.
    // (Either truly too old, or still within 'fresh' which is handled above.)
    pushBlock(
      tele,
      "DIP_OUTSIDE_STALE_WINDOW",
      "dip",
      "DIP suppressed: not in matching stale post-flip window",
      {
        lastDailyFlip,
        lastWeeklyFlip,
        freshD,
        freshW,
        maxStaleD,
        maxStaleW,
      }
    );
  }

  /* ------------------------ Decide & return ------------------------ */
  // attach global guard histos
  tele.histos.headroom = tele.histos.headroom.concat(
    teleGlobal.histos.headroom
  );
  tele.histos.distMA25 = tele.histos.distMA25.concat(
    teleGlobal.histos.distMA25
  );
  teleGlobal.histos.headroom.length = 0;
  teleGlobal.histos.distMA25.length = 0;

  if (!candidates.length) {
    const r =
      [crossW.why, crossD.why].filter(Boolean).join("; ") ||
      "No acceptable plan.";

    const out = withNo(r, { stock, data: dataAll, cfg });

    out.telemetry = {
      ...tele,
      outcome: { buyNow: false, reason: r },
      reasons,
      trace: T.logs,
    };

    out.meta = {
      cross: {
        selected:
          crossW.trigger && crossD.trigger
            ? "BOTH"
            : crossW.trigger
            ? "WEEKLY"
            : crossD.trigger
            ? "DAILY"
            : null,
        weekly: crossMeta.weekly,
        daily: crossMeta.daily,
      },
    };

    // ✅ attach volatility for backtest logging
    out.volatility = volatilityInfo;

    return out;
  }

  // Preference: if any fresh cross passed, prefer WEEKLY > DAILY > others; otherwise pick best RR
  const pref =
    candidates.find((c) => c.kind === "WEEKLY CROSS") ||
    candidates.find((c) => c.kind === "DAILY CROSS") ||
    candidates.sort(
      (a, b) => (Number(b?.rr?.ratio) || -1e9) - (Number(a?.rr?.ratio) || -1e9)
    )[0];

  // (optional telemetry polish)
  if (!tele.rr.checked && pref?.rr) {
    tele.rr = toTeleRR(pref.rr);
  }

  tele.outcome = {
    buyNow: true,
    reason: `${pref.kind}: ${pref.rr.ratio.toFixed(2)}:1. ${pref.why}`,
  };

  const stop = toTick(pref.stop, stock);
  const target = toTick(pref.target, stock);

  return {
    buyNow: true,
    reason: `${pref.kind}: ${pref.rr.ratio.toFixed(2)}:1. ${pref.why}`,
    stopLoss: stop,
    priceTarget: target,
    smartStopLoss: stop,
    smartPriceTarget: target,
    timeline: buildSwingTimeline(
      px,
      {
        kind: pref.kind,
        why: pref.why,
        stop: pref.rr.stop,
        target: pref.rr.target,
        rr: pref.rr,
      },
      pref.rr,
      msFull
    ),

    // ✅ NEW
    volatility: volatilityInfo,

    meta: {
      cross: {
        selected:
          crossW.trigger && crossD.trigger
            ? "BOTH"
            : crossW.trigger
            ? "WEEKLY"
            : crossD.trigger
            ? "DAILY"
            : pref.kind === "DIP AFTER WEEKLY"
            ? "DIP_WEEKLY"
            : pref.kind === "DIP AFTER DAILY"
            ? "DIP_DAILY"
            : null,
        weekly: crossMeta.weekly,
        daily: crossMeta.daily,
      },
    },
    telemetry: { ...tele, trace: T.logs },
  };
}
