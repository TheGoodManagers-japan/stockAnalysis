// swingTradeEntryTiming.js (flexible; DIP + BREAKOUT + RETEST + ID_BREAK + MA_RECLAIM)
// Usage:
//   const res = analyzeSwingTradeEntry(stock, candles, { debug: true, allowedKinds: ["DIP","BREAKOUT","RETEST","ID_BREAK","MA_RECLAIM"] });
// Returns: { buyNow, reason, stopLoss, priceTarget, debug? }

export function analyzeSwingTradeEntry(stock, historicalData, opts = {}) {
  const cfg = getConfig(opts);
  const reasons = [];

  // ---- Validate & prep ----
  if (!Array.isArray(historicalData) || historicalData.length < 25) {
    const r = "Insufficient historical data (need ≥25 bars).";
    return withNo(r, { reasons: [r] });
  }
  const data = [...historicalData].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );
  const last = data[data.length - 1];
  if (
    ![last.open, last.high, last.low, last.close, last.volume].every(
      Number.isFinite
    )
  ) {
    const r = "Invalid last bar OHLCV.";
    return withNo(r, { reasons: [r] });
  }

  // Prices (work pre-open/intraday/after-close)
  const px = num(stock.currentPrice) || num(last.close);
  const openPx = num(stock.openPrice) || num(last.open) || px;
  const prevClose = num(stock.prevClosePrice) || num(last.close) || openPx;
  const dayPct = openPx ? ((px - openPx) / openPx) * 100 : 0;

  // Market structure (simple)
  const ms = getMarketStructure(stock, data); // { trend, recentHigh, recentLow, ma25, ma50, ma200 }

  // Price action gate (allow small red day)
  const priceActionGate =
    px > Math.max(openPx, prevClose) ||
    (cfg.allowSmallRed && dayPct >= cfg.redDayMaxDownPct);
  const gateWhy = !priceActionGate
    ? `Price action gate failed: px ${fmt(px)} <= max(open ${fmt(
        openPx
      )}, prevClose ${fmt(prevClose)}) and dayPct ${dayPct.toFixed(2)}% < ${
        cfg.redDayMaxDownPct
      }% threshold.`
    : "";

  // Allowed kinds (default: all)
  const defaultKinds = ["DIP", "BREAKOUT", "RETEST", "ID_BREAK", "MA_RECLAIM"];
  const allow =
    Array.isArray(opts.allowedKinds) && opts.allowedKinds.length
      ? new Set(opts.allowedKinds.map((s) => s.toUpperCase()))
      : new Set(defaultKinds);

  const candidates = [];
  const checks = {};
  const tryPush = (label, triggerObj, nearestRes) => {
    // Common pipeline: gate → RR → guards → push candidate
    if (!triggerObj.trigger) {
      reasons.push(`${label} not ready: ${triggerObj.waitReason}`);
      return;
    }
    if (!priceActionGate) {
      reasons.push(`${label} blocked by gate: ${gateWhy}`);
      return;
    }
    const rr = analyzeRR(
      px,
      triggerObj.stop,
      triggerObj.target,
      stock,
      ms,
      cfg
    );
    if (!rr.acceptable) {
      reasons.push(
        `${label} RR too low: ratio ${rr.ratio.toFixed(
          2
        )} < need ${rr.need.toFixed(2)}.`
      );
      return;
    }
    const gv = guardVeto(
      stock,
      data,
      px,
      rr,
      ms,
      cfg,
      nearestRes ?? triggerObj.nearestRes
    );
    if (gv.veto) {
      reasons.push(
        `${label} guard veto: ${gv.reason} ${summarizeGuardDetails(
          gv.details
        )}.`
      );
      return;
    }
    candidates.push({
      kind: label,
      why: triggerObj.why,
      stop: rr.stop,
      target: rr.target,
      rr,
      guard: gv.details,
    });
  };

  // ---- Detectors ----

  // DIP
  if (allow.has("DIP")) {
    const dip = detectDipBounce(stock, data, cfg);
    checks.dip = dip;
    tryPush("DIP ENTRY", dip, dip.nearestRes);
  }

  // BREAKOUT (legacy strictified)
  if (allow.has("BREAKOUT")) {
    const legacy = detectLegacyBreakoutStrict(stock, data, cfg);
    checks.breakoutLegacy = legacy;
    tryPush("BREAKOUT", legacy, legacy.nearestRes);
  }

  // RETEST (throwback to prior breakout pivot)
  if (allow.has("RETEST")) {
    const re = detectThrowbackRetest(stock, data, cfg);
    checks.retest = re;
    tryPush("RETEST", re, re.nearestRes);
  }

  // Inside-day continuation
  if (allow.has("ID_BREAK")) {
    const idb = detectInsideDayBreak(stock, data, cfg);
    checks.idBreak = idb;
    tryPush("ID_BREAK", idb, idb.nearestRes);
  }

  // MA25 reclaim
  if (allow.has("MA_RECLAIM")) {
    const mr = detectMA25Reclaim(stock, data, cfg);
    checks.maReclaim = mr;
    tryPush("MA_RECLAIM", mr, mr.nearestRes);
  }

  // ---- Final decision ----
  if (candidates.length === 0) {
    const top = [];
    if (!priceActionGate) top.push(gateWhy);
    if (ms.trend === "DOWN")
      top.push(
        "Trend is DOWN (signals still allowed, but RR/guards may reject)."
      );
    const reason = buildNoReason(top, reasons);
    const debug = opts.debug
      ? {
          ms,
          dayPct,
          priceActionGate,
          reasons,
          checks,
          px,
          openPx,
          prevClose,
          cfg,
        }
      : undefined;
    return { buyNow: false, reason, debug };
  }

  // Priority: DIP > RETEST > MA_RECLAIM > ID_BREAK > BREAKOUT, else best RR
  const rank = {
    "DIP ENTRY": 0,
    RETEST: 1,
    MA_RECLAIM: 2,
    ID_BREAK: 3,
    BREAKOUT: 4,
  };
  candidates.sort(
    (a, b) => rank[a.kind] - rank[b.kind] || b.rr.ratio - a.rr.ratio
  );
  const best = candidates[0];

  const debug = opts.debug
    ? {
        ms,
        dayPct,
        priceActionGate,
        chosen: best.kind,
        rr: best.rr,
        guard: best.guard,
        checks,
        px,
        openPx,
        prevClose,
        cfg,
      }
    : undefined;

  return {
    buyNow: true,
    reason: `${best.kind}: ${best.why} RR ${best.rr.ratio.toFixed(2)}:1.`,
    stopLoss: best.stop,
    priceTarget: best.target,
    debug,
  };
}

/* ============================ Config ============================ */
function getConfig(opts) {
  return {
    // Price-action gate
    allowSmallRed: true,
    redDayMaxDownPct: -1.6,

    // Guards & thresholds
    maxATRfromMA25: 1.8,
    maxConsecUp: 5,
    nearResVetoATR: 0.5,
    hardRSI: 77,
    softRSI: 72,

    // RR thresholds
    minRRbase: 1.5,
    minRRstrongUp: 1.2,
    minRRweakUp: 1.6,

    // Breakout strictness
    breakoutMinClosePct: 0.5,
    breakoutVolMult: 1.3,
    breakoutMaxGapPct: 3.0,

    debug: !!opts.debug,
  };
}

/* ======================= Market Structure ======================= */
function getMarketStructure(stock, data) {
  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const ma25 = num(stock.movingAverage25d),
    ma50 = num(stock.movingAverage50d),
    ma200 = num(stock.movingAverage200d);

  let score = 0;
  if (px > ma25 && ma25 > 0) score++;
  if (px > ma50 && ma50 > 0) score++;
  if (ma25 > ma50 && ma50 > 0) score++;
  if (ma50 > ma200 && ma200 > 0) score++;
  const trend =
    score >= 3
      ? "STRONG_UP"
      : score === 2
      ? "UP"
      : score === 1
      ? "WEAK_UP"
      : "DOWN";

  const w = data.slice(-20);
  const recentHigh = Math.max(...w.map((d) => d.high));
  const recentLow = Math.min(...w.map((d) => d.low));
  return { trend, recentHigh, recentLow, ma25, ma50, ma200 };
}

/* ===================== DIP + BOUNCE DETECTOR ===================== */
function detectDipBounce(stock, data, cfg) {
  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const atr = Math.max(num(stock.atr14), px * 0.005);
  const ma25 = num(stock.movingAverage25d),
    ma50 = num(stock.movingAverage50d);

  const last5 = data.slice(-5);
  const d0 = last5.at(-1),
    d1 = last5.at(-2);
  const avgVol20 = avg(data.slice(-20).map((d) => num(d.volume)));
  const avgVol5 = avg(data.slice(-5).map((d) => num(d.volume)));

  // Support proximity (MA or swing/flip zone)
  const nearMA =
    (ma25 > 0 && Math.abs(px - ma25) <= 2.2 * atr) ||
    (ma50 > 0 && Math.abs(px - ma50) <= 2.2 * atr);
  const nearSwing = nearRecentSupportOrPivot(data, px, atr);
  const nearSupport = nearMA || nearSwing;

  // Higher low / dbl-bottom (allow tiny undercut)
  const pivotLow = Math.min(...last5.map((d) => num(d.low)));
  const prevZoneLow = Math.min(...data.slice(-10, -5).map((d) => num(d.low)));
  const higherLow =
    pivotLow >= prevZoneLow * 0.96 ||
    Math.abs(pivotLow - prevZoneLow) / Math.max(1, prevZoneLow) <= 0.012;

  // Bounce confirmation
  const closeAboveYHigh = num(d0.close) > num(d1.high);
  const hammer = (() => {
    const range = num(d0.high) - num(d0.low);
    const body = Math.abs(num(d0.close) - num(d0.open));
    const lower = Math.min(num(d0.close), num(d0.open)) - num(d0.low);
    return (
      range > 0 &&
      body < 0.55 * range &&
      lower > body * 1.1 &&
      num(d0.close) >= num(d0.open)
    );
  })();
  const engulf =
    num(d1.close) < num(d1.open) &&
    num(d0.close) > num(d0.open) &&
    num(d0.open) <= num(d1.close) &&
    num(d0.close) > num(d1.open);
  const twoBarRev =
    num(d0.close) > num(d1.close) &&
    num(d0.low) > num(d1.low) &&
    num(d0.close) > num(d0.open);
  const bounceOK = closeAboveYHigh || hammer || engulf || twoBarRev;

  // Volume (relaxed)
  const obv = num(stock.obv);
  const volOK =
    num(d0.volume) >= avgVol20 * 0.9 || avgVol5 >= avgVol20 * 0.95 || obv > 0;

  const trigger = nearSupport && higherLow && bounceOK && volOK;

  const recentHigh = Math.max(...data.slice(-20).map((d) => num(d.high)));
  const target =
    recentHigh > px ? recentHigh : px + Math.max(2.3 * atr, px * 0.02);
  const stop = pivotLow - 0.55 * atr;

  const nearestRes = findNearestResistance(data, px);
  const why = `Near support (MA/structure), higher low, bounce confirmed (pattern/2-bar), volume ≥ relaxed threshold.`;

  const waitReason = trigger
    ? ""
    : !nearSupport
    ? "price not near support (MA25/50 or swing/flip zone)"
    : !higherLow
    ? "no higher low or dbl-bottom yet"
    : !bounceOK
    ? "bounce candle not confirmed"
    : "bounce volume below relaxed threshold";

  return {
    trigger,
    stop,
    target,
    nearestRes,
    why,
    waitReason,
    diagnostics: {
      nearMA,
      nearSwing,
      higherLow,
      closeAboveYHigh,
      hammer,
      engulf,
      twoBarRev,
      volOK,
      atr,
    },
  };
}

/* ============= LEGACY-FLAVOR BREAKOUT (STRICTIFIED) ============= */
function detectLegacyBreakoutStrict(stock, data, cfg) {
  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const atr = Math.max(num(stock.atr14), px * 0.005);
  const rsi = num(stock.rsi14);

  const win = data.slice(-20, -2);
  if (win.length < 10) return { trigger: false, waitReason: "base too short" };

  const highs = win.map((d) => num(d.high));
  const top = Math.max(...highs);
  const band = top * 0.0125; // 1.25% band
  const touches = highs.filter((h) => Math.abs(h - top) <= band).length;

  const through = px > top * 1.0025; // 0.25% through
  const prevClose = num(data.at(-2)?.close);
  const gapOK = prevClose > 0 ? (px - prevClose) / prevClose <= 0.035 : true; // 3.5%
  const notHot = rsi < cfg.softRSI;

  const trigger = touches >= 2 && through && gapOK && notHot;
  if (!trigger) {
    const wr =
      touches < 2
        ? "not enough flat-top taps"
        : !through
        ? "not decisively through flat-top"
        : !gapOK
        ? "gap too large"
        : "RSI too hot";
    return {
      trigger: false,
      waitReason: wr,
      diagnostics: { touches, top, through, gapOK, notHot, atr },
    };
  }

  const stop = top - 0.75 * atr;
  const target = px + Math.max(2.4 * atr, px * 0.02);
  const nearestRes = findNearestResistance(data, px);
  const why = `Flat-top (≥2 taps) & push-through; controlled gap allowed.`;
  return {
    trigger,
    stop,
    target,
    nearestRes,
    why,
    waitReason: "",
    diagnostics: { touches, top, through, gapOK, notHot, atr },
  };
}

/* ================= Extra Setups (non-dip/non-breakout) ================= */

// Throwback / Retest of prior breakout pivot
function detectThrowbackRetest(stock, data, cfg) {
  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const atr = Math.max(num(stock.atr14), px * 0.005);
  const last = data.at(-1);

  const win = data.slice(-24, -2);
  if (win.length < 8)
    return { trigger: false, waitReason: "no recent pivot/base" };
  const pivot = Math.max(...win.map((d) => num(d.high)));

  const post = data.slice(-8);
  const brokeAboveRecently = post
    .slice(0, -1)
    .some((d) => num(d.close) > pivot * 1.002);
  if (!brokeAboveRecently)
    return { trigger: false, waitReason: "no recent breakout to retest" };

  const touchedPivot =
    Math.abs(px - pivot) <= 1.2 * atr ||
    (num(last.low) <= pivot && num(last.close) >= pivot);
  const reclaim = num(last.close) >= pivot && num(last.close) > num(last.open);
  const volOK =
    num(last.volume) >= avg(data.slice(-20).map((d) => num(d.volume))) * 0.95;
  const notHot = num(stock.rsi14) < 74;

  const trigger = touchedPivot && reclaim && volOK && notHot;
  if (!trigger) {
    const wr = !touchedPivot
      ? "did not retest/hold pivot"
      : !reclaim
      ? "did not reclaim pivot on a green close"
      : !volOK
      ? "volume not strong enough"
      : "RSI too hot";
    return { trigger: false, waitReason: wr };
  }

  const stop = pivot - 0.6 * atr;
  const resList = findResistancesAbove(data, px);
  const target =
    resList[0] && resList[0] > px
      ? resList[0]
      : px + Math.max(2.3 * atr, px * 0.02);
  const nearestRes = findNearestResistance(data, px);
  const why = `Throwback retest: pivot held & reclaimed on volume (prior breakout validated).`;
  return { trigger, stop, target, nearestRes, why, waitReason: "" };
}

// Inside-day continuation (range contraction → expansion)
function detectInsideDayBreak(stock, data, cfg) {
  if (data.length < 3) return { trigger: false, waitReason: "not enough bars" };
  const today = data.at(-1),
    y = data.at(-2),
    yy = data.at(-3);
  const px = num(stock.currentPrice) || num(today.close);
  const atr = Math.max(num(stock.atr14), px * 0.005);

  const inside = num(y.high) <= num(yy.high) && num(y.low) >= num(yy.low);
  if (!inside) return { trigger: false, waitReason: "no inside day" };

  const brokeYHigh = px > num(y.high) * 1.0015; // ~0.15%
  const green = num(today.close) > num(today.open);
  const volOK =
    num(today.volume) >= avg(data.slice(-20).map((d) => num(d.volume))) * 1.05;
  const notHot = num(stock.rsi14) < 74;

  const trigger = brokeYHigh && green && volOK && notHot;
  if (!trigger) {
    const wr = !brokeYHigh
      ? "did not clear inside-day high"
      : !green
      ? "close not bullish"
      : !volOK
      ? "volume not strong enough"
      : "RSI too hot";
    return { trigger: false, waitReason: wr };
  }

  const stop = num(y.low) - 0.5 * atr;
  const resList = findResistancesAbove(data, px);
  const target =
    resList[0] && resList[0] > px
      ? resList[0]
      : px + Math.max(2.3 * atr, px * 0.02);
  const nearestRes = findNearestResistance(data, px);
  const why = `Inside-day break: cleared prior inside high with volume (continuation).`;
  return { trigger, stop, target, nearestRes, why, waitReason: "" };
}

// MA25 reclaim (momentum reset)
function detectMA25Reclaim(stock, data, cfg) {
  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const atr = Math.max(num(stock.atr14), px * 0.005);
  const ma25 = num(stock.movingAverage25d);
  if (ma25 <= 0) return { trigger: false, waitReason: "no MA25" };

  const today = data.at(-1),
    y = data.at(-2);
  const wasBelow = num(y.close) < ma25 * 0.999;
  const nowAbove = num(today.close) > ma25 * 1.003;
  const green = num(today.close) > num(today.open);
  const volOK =
    num(today.volume) >= avg(data.slice(-20).map((d) => num(d.volume))) * 1.0;
  const notHot = num(stock.rsi14) < 74;

  const trigger = wasBelow && nowAbove && green && volOK && notHot;
  if (!trigger) {
    const wr = !wasBelow
      ? "was not below MA25"
      : !nowAbove
      ? "did not reclaim MA25"
      : !green
      ? "close not bullish"
      : !volOK
      ? "volume not strong enough"
      : "RSI too hot";
    return { trigger: false, waitReason: wr };
  }

  const stop = ma25 - 0.6 * atr;
  const resList = findResistancesAbove(data, px);
  const target =
    resList[0] && resList[0] > px
      ? resList[0]
      : px + Math.max(2.2 * atr, px * 0.02);
  const nearestRes = findNearestResistance(data, px);
  const why = `MA25 reclaim: momentum reset with volume (back above MA25).`;
  return { trigger, stop, target, nearestRes, why, waitReason: "" };
}

/* ======================== Risk / Reward ======================== */
function analyzeRR(entryPx, stop, target, stock, ms, cfg) {
  const atr = Math.max(num(stock.atr14), entryPx * 0.005);
  const minStopDist = 1.2 * atr;
  if (entryPx - stop < minStopDist) stop = entryPx - minStopDist;

  const risk = Math.max(0.01, entryPx - stop);
  const reward = Math.max(0, target - entryPx);
  const ratio = reward / risk;

  let need = cfg.minRRbase;
  if (ms.trend === "STRONG_UP") need = cfg.minRRstrongUp;
  if (ms.trend === "WEAK_UP") need = cfg.minRRweakUp;

  return {
    acceptable: ratio >= need,
    ratio,
    stop,
    target,
    need,
    atr,
    risk,
    reward,
  };
}

/* ============================ Guards ============================ */
function guardVeto(stock, data, px, rr, ms, cfg, nearestRes) {
  const details = {};
  const atr = Math.max(num(stock.atr14), px * 0.005);
  const rsi = num(stock.rsi14);
  const ma25 = num(stock.movingAverage25d);

  details.rsi = rsi;
  if (rsi >= cfg.hardRSI)
    return {
      veto: true,
      reason: `RSI ${rsi.toFixed(1)} ≥ ${cfg.hardRSI}`,
      details,
    };

  if (nearestRes) {
    const headroom = (nearestRes - px) / atr;
    details.nearestRes = nearestRes;
    details.headroomATR = headroom;
    if (headroom < cfg.nearResVetoATR)
      return {
        veto: true,
        reason: `Headroom ${headroom.toFixed(2)} ATR < ${
          cfg.nearResVetoATR
        } ATR to resistance`,
        details,
      };
  } else {
    details.nearestRes = null;
  }

  if (ma25 > 0) {
    const distMA25 = (px - ma25) / atr;
    details.ma25 = ma25;
    details.distFromMA25_ATR = distMA25;
    if (distMA25 > cfg.maxATRfromMA25)
      return {
        veto: true,
        reason: `Too far above MA25 (${distMA25.toFixed(2)} ATR > ${
          cfg.maxATRfromMA25
        })`,
        details,
      };
  }

  const ups = countConsecutiveUpDays(data);
  details.consecUp = ups;
  if (ups > cfg.maxConsecUp)
    return {
      veto: true,
      reason: `Consecutive up days ${ups} > ${cfg.maxConsecUp}`,
      details,
    };

  return { veto: false, reason: "", details };
}

/* =========================== Utilities =========================== */
function num(v) {
  return Number.isFinite(v) ? v : 0;
}
function avg(arr) {
  return arr.length
    ? arr.reduce((a, b) => a + (Number(b) || 0), 0) / arr.length
    : 0;
}
function fmt(x) {
  return Number.isFinite(x) ? x.toFixed(2) : String(x);
}

function countConsecutiveUpDays(data, k = 8) {
  let c = 0;
  for (let i = data.length - 1; i > 0 && c < k; i--) {
    if (num(data[i].close) > num(data[i - 1].close)) c++;
    else break;
  }
  return c;
}

// Nearest visible resistance above current price (swing-high scan)
function findNearestResistance(data, px) {
  const ups = data
    .slice(-50)
    .map((d) => num(d.high))
    .filter((h) => h > px);
  if (!ups.length) return null;
  ups.sort((a, b) => a - b);
  return ups[0];
}

// All resistances above (sorted)
function findResistancesAbove(data, px) {
  const ups = data
    .slice(-50)
    .map((d) => num(d.high))
    .filter((h) => h > px);
  const uniq = Array.from(new Set(ups)).sort((a, b) => a - b);
  return uniq;
}

// Treat recent swing-lows & prior breakout pivots as support if close enough
function nearRecentSupportOrPivot(data, px, atr) {
  const win = data.slice(-30);
  const swingLows = [],
    swingHighs = [];
  for (let i = 2; i < win.length - 2; i++) {
    if (
      num(win[i].low) < num(win[i - 1].low) &&
      num(win[i].low) < num(win[i + 1].low)
    )
      swingLows.push(num(win[i].low));
    if (
      num(win[i].high) > num(win[i - 1].high) &&
      num(win[i].high) > num(win[i + 1].high)
    )
      swingHighs.push(num(win[i].high));
  }
  const pivots = swingLows.concat(swingHighs); // polarity flips often act as support
  // within 2.2*ATR OR within 2%
  return pivots.some(
    (p) =>
      (px >= p && px - p <= 2.2 * atr) ||
      Math.abs(px - p) / Math.max(1, p) <= 0.02
  );
}

/* =========================== Helpers =========================== */
function buildNoReason(top, list) {
  const head = top.filter(Boolean).join(" | ");
  const uniq = Array.from(new Set(list.filter(Boolean)));
  const bullet = uniq
    .slice(0, 6)
    .map((r) => `- ${r}`)
    .join("\n");
  return [head, bullet].filter(Boolean).join("\n");
}
function summarizeGuardDetails(d) {
  if (!d) return "";
  const bits = [];
  if (typeof d.rsi === "number") bits.push(`RSI=${d.rsi.toFixed(1)}`);
  if (typeof d.headroomATR === "number")
    bits.push(`headroom=${d.headroomATR.toFixed(2)} ATR`);
  if (typeof d.distFromMA25_ATR === "number")
    bits.push(`distMA25=${d.distFromMA25_ATR.toFixed(2)} ATR`);
  if (typeof d.consecUp === "number") bits.push(`consecUp=${d.consecUp}`);
  return bits.length ? `(${bits.join(", ")})` : "";
}
function withNo(reason, debug) {
  return { buyNow: false, reason, debug };
}
