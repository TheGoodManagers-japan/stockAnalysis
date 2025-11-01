// /scripts/swingTradeEntryTiming.js
// DIP lane, fresh WEEKLY/DAILY flip lane, and +VOLUME variants
// (rich diagnostics intact)

import { detectDipBounce, detectDipBounceWeekly } from "./dip.js";

/* ============== lightweight global bus for guard histos ============== */
// teleGlobal is a shared scratch bucket used by guardVeto() to stash
// headroom / distMA25 samples before we merge them back into each trade's
// local telemetry at the end of analyseCrossing().
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
      regime: { pass: true, why: "" }, // slot kept for shape
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
      dipV20ratio: [],
      dipBodyPct: [],
      dipRangePctATR: [],
      dipCloseDeltaATR: [],
      dipPullbackPct: [],
      dipPullbackATR: [],
      dipRecoveryPct: [],
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
    if (opts.onTrace) {
      opts.onTrace(e);
    }
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

/* ============================ Config ============================ */
function getConfig(opts = {}) {
  const debug = !!opts.debug;
  return {
    // general
    perfectMode: false,

    // --- Weekly/Daily cross gating (DIP + new playbook) ---
    requireWeeklyUpForDIP: true, // require weekly uptrend = ≥2/3 of 13/26/52wk MAs under price
    requireDailyReclaim25and75ForDIP: true, // require recent price reclaim of both 25d & 75d
    dailyReclaimLookback: 5,
    freshDailyLookbackDays: 5,

    requireFreshWeeklyFlipForDIP: true,
    freshWeeklyLookbackWeeks: 5,
    allowStaleCrossDip: false,

    // explicit stale windows for “post-flip DIP still valid”
    staleDailyCrossMaxAgeBars: 20,
    staleWeeklyCrossMaxAgeWeeks: 10,

    // For DIP: we now require (reclaim OR cross), not both
    requireMA25over75ForDIP: true,
    maCrossMaxAgeBars: 10,

    staleDipMaxAgeBars: 7,
    staleDipMaxAgeWeeklyWeeks: 2,
    staleCrossRequireReclaim: true,

    // --- Multi-timeframe DIP presets (used ONLY for weekly wrapper) ---
    dipDaily: {
      minPullbackPct: 4.8,
      minPullbackATR: 1.9,
      maxBounceAgeBars: 7,
      minBounceStrengthATR: 0.6,
      minRR: 1.55,
    },
    dipWeekly: {
      minPullbackPct: 6.5,
      minPullbackATR: 2.6, // WEEKLY ATR units
      maxBounceAgeWeeks: 2,
      minBounceStrengthATR: 0.5,
      minRR: 1.55,
    },

    // --- Cross+Volume playbook knobs ---
    crossPlaybookEnabled: true,
    crossMinVolumeFactor: 1.5, // ≥ 1.5× 20d avg volume
    crossMinRR: 1.45, // RR floor for cross play
    crossUseReclaimNotJustMAcross: true, // price reclaimed both 25 & 75 within lookback

    // RR floors (DIP has its own too)
    minRRbase: 1.35,
    minRRstrongUp: 1.5,
    minRRweakUp: 1.55,

    // headroom & extension guards
    nearResVetoATR: 0.4,
    nearResVetoPct: 0.6,
    maxATRfromMA25: 2.4,

    // overbought guards
    hardRSI: 75,
    softRSI: 70,

    // --- DIP proximity / structure knobs ---
    dipMaSupportATRBands: 0.8,
    dipStructTolATR: 0.9,
    dipStructTolPct: 3.0,

    // recovery caps
    dipMaxRecoveryPct: 135,
    dipMaxRecoveryStrongUp: 155,

    // fib window tolerance
    fibTolerancePct: 9,

    // volume regime
    pullbackDryFactor: 1.2,
    bounceHotFactor: 1.0,

    // DIP parameters (used by dip.js)
    dipMinPullbackPct: 4.8,
    dipMinPullbackATR: 1.9,
    dipMaxBounceAgeBars: 7,
    dipMinBounceStrengthATR: 0.6,
    dipMinRR: 1.55,

    // allow DIPs even if broader regime softened
    allowDipInDowntrend: true,

    // min stop distance (used by non-DIP fallbacks; DIP stop logic handled in dip.js)
    minStopATRStrong: 1.15,
    minStopATRUp: 1.2,
    minStopATRWeak: 1.3,
    minStopATRDown: 1.45,

    // scoot logic for RR hop
    scootEnabled: true,
    scootNearMissBand: 0.25,
    scootATRCapDIP: 4.2,
    scootATRCapNonDIP: 3.5,
    scootMaxHops: 2,

    // probation
    allowProbation: true,

    debug,
  };
}

/* ========= Helpers for "how old is the bullish flip?" ========= */

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
    const m5 = smaD(5, i),
      m25 = smaD(25, i),
      m75 = smaD(75, i);
    const pm5 = smaD(5, i - 1),
      pm25 = smaD(25, i - 1),
      pm75 = smaD(75, i - 1);
    const nowStacked = m5 > 0 && m25 > 0 && m75 > 0 && m5 > m25 && m25 > m75;
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

  // Drop an incomplete last week (fewer than 4 daily bars in that ISO week)
  const lastDaily = data.at(-1);
  const lastDailyWeek = lastDaily ? isoKey(lastDaily.date) : null;
  let barsInLastDailyWeek = 0;
  if (lastDailyWeek) {
    for (let i = data.length - 1; i >= 0; i--) {
      if (isoKey(data[i].date) !== lastDailyWeek) break;
      barsInLastDailyWeek++;
    }
  }
  const dropLastWeekly = barsInLastDailyWeek > 0 && barsInLastDailyWeek < 4;
  const weeks =
    weeksAll.length >= 1 && dropLastWeekly ? weeksAll.slice(0, -1) : weeksAll;

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

  const slack = 0.01; // ≤1% slack allowed
  const above13 = px > w13 * (1 - slack);
  const above26 = px > w26 * (1 - slack);
  const above52 = px > w52 * (1 - slack);

  const passStrict = above13 && above26 && above52;
  const pass2of3 =
    (above13 ? 1 : 0) + (above26 ? 1 : 0) + (above52 ? 1 : 0) >= 2;

  return { pass: passStrict, passRelaxed: pass2of3, hasAll, w13, w26, w52 };
}

/* ==== Daily reclaim / MA cross gates ==== */
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
    const snapK = data.slice(0, i - k + 1); // up to K
    const snapKp1 = data.slice(0, i - k + 2); // up to K+1
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
  let lastCrossAge = Infinity;
  for (let t = i; t >= Math.max(1, i - maxAge); t--) {
    const snapPrev = data.slice(0, t); // up to t-1
    const snapNow = data.slice(0, t + 1); // up to t
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

  // 2) Target sanity with resistances
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

  // relax RR for first-chance weekly/daily
  if (ctx?.flavor === "FIRST_WEEKLY") {
    need = Math.max(need - 0.15, 1.25);
  } else if (ctx?.flavor === "FIRST_DAILY") {
    need = Math.max(need - 0.05, 1.3);
  }

  // 5) SCOOT logic
  if (cfg.scootEnabled) {
    const atrCap =
      ctx?.kind === "DIP"
        ? cfg.scootATRCapDIP ?? 4.2
        : cfg.scootATRCapNonDIP ?? 3.5;

    if (ratio < need && Array.isArray(resList) && resList.length >= 2) {
      const nextRes = resList[1];
      const lifted = Math.min(nextRes, entryPx + atrCap * atr);
      if (lifted > target) {
        target = lifted;
        reward = Math.max(0, target - entryPx);
        ratio = reward / risk;
      }
    }

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

  // widen probation for FIRST_WEEKLY / FIRST_DAILY
  if (
    !acceptable &&
    allowProb &&
    (ctx?.flavor === "FIRST_WEEKLY" || ctx?.flavor === "FIRST_DAILY")
  ) {
    const extraBand = ctx.flavor === "FIRST_WEEKLY" ? 0.07 : 0.04;
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

  // record last RSI in global
  teleGlobal._lastRSI = rsi;

  if (!(_kind === "FIRST_WEEKLY") && rsi >= cfg.hardRSI) {
    return {
      veto: true,
      reason: `RSI ${rsi.toFixed(1)} ≥ ${cfg.hardRSI}`,
      details,
    };
  }
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

    // push to teleGlobal
    teleGlobal.histos.headroom.push({
      atr: headroomATR,
      pct: headroomPct,
      nearestRes: effRes,
      ticker: stock?.ticker,
    });

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

    teleGlobal.histos.distMA25.push({
      distATR: distMA25,
      ma25,
      px,
      ticker: stock?.ticker,
    });

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
    stopLoss: toTick(deRound(prov.stop), stock),
    priceTarget: toTick(deRound(prov.target), stock),
    smartStopLoss: toTick(deRound(prov.stop), stock),
    smartPriceTarget: toTick(deRound(prov.target), stock),
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
  // no try/catch: if tele is malformed I want it to explode
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
  const weeksAll = resampleToWeeks(data);

  // ISO week helpers
  const isoKey = (d) => {
    const dt = new Date(d);
    const t = new Date(
      Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate())
    );
    const dayNum = t.getUTCDay() || 7; // 1..7 (Mon..Sun)
    t.setUTCDate(t.getUTCDate() + 4 - dayNum); // Thu of this week
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
    return t.getUTCFullYear() + "-" + weekNo; // e.g. "2025-42"
  };

  // How many daily bars in the last daily week?
  const lastDaily = data.at(-1);
  const lastDailyWeek = lastDaily ? isoKey(lastDaily.date) : null;
  let barsInLastDailyWeek = 0;
  if (lastDailyWeek) {
    for (let i = data.length - 1; i >= 0; i--) {
      if (isoKey(data[i].date) !== lastDailyWeek) break;
      barsInLastDailyWeek++;
    }
  }
  // Consider a week "complete" if ≥4 trading days
  const dropLastWeekly = barsInLastDailyWeek > 0 && barsInLastDailyWeek < 4;
  const weeks =
    weeksAll.length >= 1 && dropLastWeekly ? weeksAll.slice(0, -1) : weeksAll;

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
  const eps = 0.0015; // ~0.15% margin

  const getTriplet = (i) => {
    const m13 = smaW(13, i),
      m26 = smaW(26, i),
      m52 = smaW(52, i);
    const stacked =
      m13 > 0 &&
      m26 > 0 &&
      m52 > 0 &&
      m13 >= m26 * (1 + eps) &&
      m26 >= m52 * (1 + eps);
    return { m13, m26, m52, stacked };
  };

  // Fresh flip ONLY
  for (let i = last; i >= Math.max(1, last - lookbackBars + 1); i--) {
    const cur = getTriplet(i);
    const prev = getTriplet(i - 1);
    if (cur.stacked && !prev.stacked) {
      return {
        trigger: true,
        weeksAgo: last - i,
        index: i,
        m13: cur.m13,
        m26: cur.m26,
        m52: cur.m52,
        why: `Weekly MAs freshly flipped to 13>26>52 within last ${lookbackBars} weeks`,
      };
    }
  }

  return {
    trigger: false,
    why: `No weekly fresh 13>26>52 flip in ≤${lookbackBars} completed weeks`,
  };
}

/* ========= Daily 5/25/75 “fresh flip ONLY” engine ========= */
function detectDailyStackedCross(data, lookbackBars = 5) {
  const smaD = (n, i) => {
    if (i + 1 < n) return 0;
    let s = 0;
    for (let k = i - n + 1; k <= i; k++) s += +data[k].close || 0;
    return s / n;
  };
  const last = data.length - 1;
  if (last < 75)
    return {
      trigger: false,
      why: "Insufficient daily history (need ≥75 bars)",
    };

  for (let i = last; i >= Math.max(1, last - lookbackBars + 1); i--) {
    const m5 = smaD(5, i),
      m25 = smaD(25, i),
      m75 = smaD(75, i);
    const nowStacked = m5 > 0 && m25 > 0 && m75 > 0 && m5 > m25 && m25 > m75;

    const pm5 = smaD(5, i - 1),
      pm25 = smaD(25, i - 1),
      pm75 = smaD(75, i - 1);
    const prevStacked =
      pm5 > 0 && pm25 > 0 && pm75 > 0 && pm5 > pm25 && pm25 > pm75;

    if (nowStacked && !prevStacked) {
      return {
        trigger: true,
        daysAgo: last - i,
        index: i,
        m5,
        m25,
        m75,
        why: `Daily MAs freshly flipped to 5>25>75 within last ${lookbackBars} days`,
      };
    }
  }
  return {
    trigger: false,
    why: `No fresh daily 5>25>75 cross in ≤${lookbackBars} days`,
  };
}

/* ========= strict classifier for meta.cross.selected ========= */
function classifyCrossSelectedStrict({ crossW, crossD, prefKind, dipLane }) {
  // both flips are currently fresh
  if (crossW?.trigger && crossD?.trigger) return "BOTH";
  if (crossW?.trigger) return "WEEKLY";
  if (crossD?.trigger) return "DAILY";

  // stale post-flip DIP lanes and post-flip behaviors
  if (
    prefKind === "DIP AFTER WEEKLY" ||
    prefKind === "WEEKLY CROSS" ||
    prefKind === "WEEKLY CROSS +VOLUME" ||
    dipLane === "WEEKLY"
  ) {
    return "DIP_WEEKLY";
  }
  if (
    prefKind === "DIP AFTER DAILY" ||
    prefKind === "DAILY CROSS" ||
    prefKind === "DAILY CROSS +VOLUME" ||
    dipLane === "DAILY"
  ) {
    return "DIP_DAILY";
  }

  // If nothing qualifies (no flip, no dip, no prefKind),
  // return a safe label instead of throwing.
  return "NONE";
}

/**
 * analyseCrossing — master detector
 * Produces these possible candidates:
 *  - WEEKLY CROSS
 *  - WEEKLY CROSS +VOLUME
 *  - DAILY CROSS
 *  - DAILY CROSS +VOLUME
 *  - DIP AFTER WEEKLY
 *  - DIP AFTER DAILY
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
    throw new Error(
      `[analyseCrossing] Not enough history to classify ${
        stock?.ticker || "UNK"
      }`
    );
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
    throw new Error(
      `[analyseCrossing] Invalid last bar OHLCV for ${stock?.ticker || "UNK"}`
    );
  }
  if (!Number.isFinite(last.volume)) last.volume = 0;

  const px = Number(stock.currentPrice) || Number(last.close) || 0;
  const openPx = Number(stock.openPrice) || Number(last.open) || px;
  const prevClose =
    Number(stock.prevClosePrice) || Number(last.close) || openPx;
  const dayPct = openPx ? ((px - openPx) / openPx) * 100 : 0;

  // === Volatility snapshot (for slicing / debug) ===
  const atrRaw = Math.max(num(stock.atr14), px * 0.005, 1e-6);
  const atrPct = (atrRaw / Math.max(px, 1e-9)) * 100;

  let volBucket = "medium";
  if (atrPct < 1.0) {
    volBucket = "low";
  } else if (atrPct >= 3.0) {
    volBucket = "high";
  }

  const volatilityInfo = {
    atr: atrRaw,
    atrPct,
    bucket: volBucket,
  };

  // completedDaily = fully closed bars (exclude current bar)
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

  // --- Structure gate (minimal)
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

  // Helper: volume heat check for today
  function isVolumeHotToday(data) {
    const i = data.length - 1;
    if (i < 0) return { hot: false, avg20: 0, volNow: 0 };
    const d0 = data[i];
    const avgVol20 = avg(data.slice(-20).map((b) => +b.volume || 0));
    const volNow = +d0.volume || 0;
    const hot =
      avgVol20 > 0
        ? volNow >= (cfg.crossMinVolumeFactor ?? 1.5) * avgVol20
        : true;
    return { hot, avg20: avgVol20, volNow };
  }

  const volInfo = isVolumeHotToday(dataAll);

  // Helper: make a CROSS RR plan for WEEKLY or DAILY flavor
  const planCross = (label) => {
    const baseATR = Math.max(Number(stock.atr14) || 0, px * 0.005, 1e-6);

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
      { kind: "CROSS", flavor, data: completedDaily }
    );
    return { label, rr };
  };

  // WEEKLY CROSS (no mandatory volume) + WEEKLY CROSS +VOLUME (volume gated)
  if (crossW.trigger && structureGateOk) {
    const p = planCross("WEEKLY");

    // RR check
    if (p.rr.acceptable) {
      // guard check
      const gv = guardVeto(
        stock,
        dataAll,
        px,
        p.rr,
        msFull,
        cfg,
        undefined,
        "FIRST_WEEKLY"
      );

      tele.guard = {
        checked: true,
        veto: gv.veto,
        reason: gv.reason,
        details: gv.details,
      };

      if (!gv.veto) {
        // always create the base WEEKLY CROSS candidate
        candidates.push({
          kind: "WEEKLY CROSS",
          why: crossW.why,
          rr: p.rr,
          stop: p.rr.stop,
          target: p.rr.target,
        });

        // if hot volume, add WEEKLY CROSS +VOLUME candidate
        if (volInfo.hot) {
          candidates.push({
            kind: "WEEKLY CROSS +VOLUME",
            why: crossW.why + " | volume hot",
            rr: p.rr,
            stop: p.rr.stop,
            target: p.rr.target,
            volumeDiag: {
              volNow: volInfo.volNow,
              avg20: volInfo.avg20,
              factor: cfg.crossMinVolumeFactor,
            },
          });
        }
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

  // DAILY CROSS (no mandatory volume) + DAILY CROSS +VOLUME (volume gated)
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
        "FIRST_DAILY"
      );

      tele.guard = {
        checked: true,
        veto: gv.veto,
        reason: gv.reason,
        details: gv.details,
      };

      if (!gv.veto) {
        // base DAILY CROSS
        candidates.push({
          kind: "DAILY CROSS",
          why: crossD.why,
          rr: p.rr,
          stop: p.rr.stop,
          target: p.rr.target,
        });

        // DAILY CROSS +VOLUME if hot
        if (volInfo.hot) {
          candidates.push({
            kind: "DAILY CROSS +VOLUME",
            why: crossD.why + " | volume hot",
            rr: p.rr,
            stop: p.rr.stop,
            target: p.rr.target,
            volumeDiag: {
              volNow: volInfo.volNow,
              avg20: volInfo.avg20,
              factor: cfg.crossMinVolumeFactor,
            },
          });
        }
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

  /* ---------------- DIP lane (SECOND-CHANCE ENTRY ONLY) ---------------- */
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

  // 1. Basic DIP gates (trend + reclaim / cross)
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

  const dailyWindowOK =
    !!lastDailyFlip.found &&
    lastDailyFlip.barsAgo > freshD &&
    lastDailyFlip.barsAgo <= maxStaleD;

  const weeklyWindowOK =
    !!lastWeeklyFlip.found &&
    lastWeeklyFlip.weeksAgo > freshW &&
    lastWeeklyFlip.weeksAgo <= maxStaleW;

  let dipLane = null;
  if (!haveFreshCrossNow) {
    if (weeklyWindowOK) {
      dipLane = "WEEKLY";
    } else if (dailyWindowOK) {
      dipLane = "DAILY";
    }
  }

  let activeDip = null;
  if (dipLane === "WEEKLY") {
    activeDip = detectDipBounceWeekly(stock, dataAll, cfg, U);
  } else if (dipLane === "DAILY") {
    activeDip = detectDipBounce(stock, dataAll, cfg, U);
  }

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

  // freshness of bounce
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

  const dipSecondChanceOK =
    !!dipLane &&
    activeDip?.trigger &&
    structureGateOk &&
    dipGatePass &&
    dipStillFreshEnough;

  if (dipSecondChanceOK) {
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

      tele.guard = {
        checked: true,
        veto: gv.veto,
        reason: gv.reason,
        details: gv.details,
      };

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
    pushBlock(tele, "DIP_GATE", "dip", `DIP gated: ${dipGateWhy.join("; ")}`, {
      wkGate,
      reclaimGate,
      maCrossGate,
      dipLane,
    });
  } else if (activeDip?.trigger && haveFreshCrossNow) {
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
  tele.histos.headroom = tele.histos.headroom.concat(
    teleGlobal.histos.headroom
  );
  tele.histos.distMA25 = tele.histos.distMA25.concat(
    teleGlobal.histos.distMA25
  );
  teleGlobal.histos.headroom.length = 0;
  teleGlobal.histos.distMA25.length = 0;

  if (!candidates.length) {
    // build reason string
    const r =
      [crossW.why, crossD.why].filter(Boolean).join("; ") ||
      "No acceptable plan.";

    // classification (never throws now; returns "NONE" if really nothing)
    const selectedType = classifyCrossSelectedStrict({
      crossW,
      crossD,
      prefKind: null,
      dipLane,
    });

    const out = withNo(r, { stock, data: dataAll, cfg });

    out.telemetry = {
      ...tele,
      outcome: { buyNow: false, reason: r },
      reasons,
      trace: T.logs,
    };

    out.meta = {
      cross: {
        selected: selectedType,
        weekly: crossMeta.weekly,
        daily: crossMeta.daily,
      },
    };

    out.volatility = volatilityInfo;

    return out;
  }

  // Choose preferred candidate.
  // Priority:
  //   1. WEEKLY CROSS
  //   2. WEEKLY CROSS +VOLUME
  //   3. DAILY CROSS
  //   4. DAILY CROSS +VOLUME
  //   5. else highest RR
  let pref =
    candidates.find((c) => c.kind === "WEEKLY CROSS") ||
    candidates.find((c) => c.kind === "WEEKLY CROSS +VOLUME") ||
    candidates.find((c) => c.kind === "DAILY CROSS") ||
    candidates.find((c) => c.kind === "DAILY CROSS +VOLUME") ||
    candidates.sort(
      (a, b) => (Number(b?.rr?.ratio) || -1e9) - (Number(a?.rr?.ratio) || -1e9)
    )[0];

  if (!tele.rr.checked && pref?.rr) {
    tele.rr = toTeleRR(pref.rr);
  }

  tele.outcome = {
    buyNow: true,
    reason: `${pref.kind}: ${pref.rr.ratio.toFixed(2)}:1. ${pref.why}`,
  };

  // snap with your deRound logic
  const stop = toTick(deRound(pref.stop), stock);
  const target = toTick(deRound(pref.target), stock);

  // strict classification for winning candidate
  const selectedType = classifyCrossSelectedStrict({
    crossW,
    crossD,
    prefKind: pref.kind,
    dipLane,
  });

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

    volatility: volatilityInfo,

    meta: {
      cross: {
        selected: selectedType,
        weekly: crossMeta.weekly,
        daily: crossMeta.daily,
      },
    },
    telemetry: { ...tele, trace: T.logs },
  };
}
