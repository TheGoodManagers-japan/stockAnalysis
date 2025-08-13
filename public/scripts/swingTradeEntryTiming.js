// swingTradeEntryTiming.js (auto DIP in morning, BREAKOUT in afternoon - JST)

/**
 * Usage:
 * const res = analyzeSwingTradeEntry(stock, candles, { debug: true });
 * Returns: { buyNow, reason, stopLoss, priceTarget, debug? }
 */

export function analyzeSwingTradeEntry(stock, historicalData, opts = {}) {
  const cfg = getConfig(opts);

  // ---- Validate & prep data ----
  if (!Array.isArray(historicalData) || historicalData.length < 25) {
    return {
      buyNow: false,
      reason: "Insufficient historical data (need ≥25 bars).",
    };
  }
  const data = [...historicalData].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );
  const last = data[data.length - 1];
  if (
    !isFiniteN(last.open) ||
    !isFiniteN(last.high) ||
    !isFiniteN(last.low) ||
    !isFiniteN(last.close) ||
    !isFiniteN(last.volume)
  ) {
    return { buyNow: false, reason: "Invalid last bar OHLCV." };
  }

  // Robust price context (works pre-open / intraday / after-close)
  const px = num(stock.currentPrice) || num(last.close);
  const openPx = num(stock.openPrice) || num(last.open) || px;
  const prevClose = num(stock.prevClosePrice) || num(last.close) || openPx;
  const dayPct = openPx ? ((px - openPx) / openPx) * 100 : 0;

  // Which session? (JST) → decides DIP vs BREAKOUT
  const session = getJSTSession();
  const allowDip = session.allow.includes("DIP");
  const allowBreakout = session.allow.includes("BREAKOUT");

  const ms = getMarketStructure(stock, data); // { trend, recentHigh, recentLow, ma25, ma50 }
  if (ms.trend === "DOWN") {
    return {
      buyNow: false,
      reason: "Skip: overall trend DOWN (counter-trend dip not allowed).",
    };
  }

  // Price action gate (allow small red day to catch first bounce)
  const priceActionGate = cfg.requireGreen
    ? px > Math.max(openPx, prevClose)
    : px > Math.max(openPx, prevClose) ||
      (cfg.allowSmallRed && dayPct >= cfg.redDayMaxDownPct);

  // ---- Build candidates (gated by session) ----
  const candidates = [];

  if (allowDip) {
    const dip = detectDipBounce(stock, data, cfg);
    if (dip.trigger && priceActionGate) {
      const rr = analyzeRR(px, dip.stop, dip.target, stock, ms, cfg);
      if (
        rr.acceptable &&
        !guardVeto(stock, data, px, rr, ms, cfg, dip.nearestRes)
      ) {
        candidates.push({
          kind: "DIP ENTRY",
          why: dip.why,
          stop: rr.stop,
          target: rr.target,
          rr,
        });
      }
    }
  }

  if (allowBreakout) {
    const bo = detectRockSolidBreakout(stock, data, cfg);
    if (bo.trigger && priceActionGate) {
      const rr = analyzeRR(px, bo.stop, bo.target, stock, ms, cfg);
      if (
        rr.acceptable &&
        !guardVeto(stock, data, px, rr, ms, cfg, bo.nearestRes)
      ) {
        candidates.push({
          kind: "BREAKOUT (STRICT)",
          why: bo.why,
          stop: rr.stop,
          target: rr.target,
          rr,
        });
      }
    }

    const legacy = detectLegacyBreakoutStrict(stock, data, cfg);
    if (legacy.trigger && priceActionGate) {
      const rr = analyzeRR(px, legacy.stop, legacy.target, stock, ms, cfg);
      if (
        rr.acceptable &&
        !guardVeto(stock, data, px, rr, ms, cfg, legacy.nearestRes)
      ) {
        candidates.push({
          kind: "BREAKOUT (LEGACY+STRICTIFIED)",
          why: legacy.why,
          stop: rr.stop,
          target: rr.target,
          rr,
        });
      }
    }
  }

  if (candidates.length === 0) {
    const why =
      (!priceActionGate &&
        `Price action weak today (${dayPct.toFixed(2)}%).`) ||
      "No qualifying setup for this session.";
    return { buyNow: false, reason: why };
  }

  // Prefer dip first; otherwise choose highest RR
  candidates.sort((a, b) =>
    a.kind === "DIP ENTRY"
      ? -1
      : b.kind === "DIP ENTRY"
      ? 1
      : b.rr.ratio - a.rr.ratio
  );
  const best = candidates[0];

  return {
    buyNow: true,
    reason: `${best.kind}: ${best.why} RR ${best.rr.ratio.toFixed(2)}:1.`,
    stopLoss: best.stop,
    priceTarget: best.target,
    debug: cfg.debug
      ? { ms, dayPct, chosen: best.kind, rr: best.rr, session }
      : undefined,
  };
}

/* ============================ Config ============================ */
function getConfig(opts) {
  return {
    // Dip-first behavior
    allowSmallRed: true,
    redDayMaxDownPct: -0.8, // allow small red day
    requireGreen: false,

    // Guards & thresholds
    maxATRfromMA25: 1.5, // late if >1.5 ATR above MA25 at entry
    maxConsecUp: 5, // too many up bars = chasing
    nearResVetoATR: 0.8, // avoid buying into resistance closer than 0.8*ATR
    hardRSI: 77,
    softRSI: 72,

    // RR thresholds by regime
    minRRbase: 1.6,
    minRRstrongUp: 1.3,
    minRRweakUp: 1.8,

    // Breakout strictness
    breakoutMinClosePct: 1.0, // px > resistance by ≥1.0%
    breakoutVolMult: 1.5, // vol ≥ 1.5× 20D
    breakoutMaxGapPct: 2.0, // open ≤ res * 1.02

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
  return { trend, recentHigh, recentLow, ma25, ma50 };
}

/* ===================== DIP + BOUNCE DETECTOR ===================== */
function detectDipBounce(stock, data, cfg) {
  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const atr = Math.max(num(stock.atr14), px * 0.005);
  const ma25 = num(stock.movingAverage25d),
    ma50 = num(stock.movingAverage50d);

  const last5 = data.slice(-5);
  const avgVol20 = avg(data.slice(-20).map((d) => num(d.volume)));

  // Near MA zone (≤1.5 ATR from MA25/50)
  const nearMA =
    (ma25 > 0 && Math.abs(px - ma25) <= 1.5 * atr) ||
    (ma50 > 0 && Math.abs(px - ma50) <= 1.5 * atr);

  // Pivot low: min of last 3–5 bars, but above (or tiny undercut of) earlier zone
  const pivotWindow = last5;
  const pivotLow = Math.min(...pivotWindow.map((d) => num(d.low)));
  const prevZoneLow = Math.min(...data.slice(-10, -5).map((d) => num(d.low)));
  const higherLow = pivotLow > prevZoneLow * 0.98; // allow tiny undercut

  // Bounce confirmation: close>y'day high OR hammer/engulf near MA zone
  const d0 = last5.at(-1),
    d1 = last5.at(-2);
  const closeAboveYHigh = num(d0.close) > num(d1.high);
  const hammer = (() => {
    const range = num(d0.high) - num(d0.low);
    const body = Math.abs(num(d0.close) - num(d0.open));
    const lower = Math.min(num(d0.close), num(d0.open)) - num(d0.low);
    return (
      range > 0 &&
      body < 0.5 * range &&
      lower > body * 1.2 &&
      num(d0.close) >= num(d0.open)
    );
  })();
  const engulf =
    num(d1.close) < num(d1.open) &&
    num(d0.close) > num(d0.open) &&
    num(d0.open) <= num(d1.close) &&
    num(d0.close) > num(d1.open);

  // Volume normalization (no need for surge)
  const volOK = num(d0.volume) >= avgVol20 * 1.0;

  const trigger =
    nearMA && higherLow && (closeAboveYHigh || hammer || engulf) && volOK;

  // Targets & stop
  const recentHigh = Math.max(...data.slice(-20).map((d) => num(d.high)));
  const target =
    recentHigh > px ? recentHigh : px + Math.max(2.0 * atr, px * 0.02);
  const stop = pivotLow - 0.6 * atr;

  const nearestRes = findNearestResistance(data, px);
  const why = `Touched MA25/50 zone, set higher low, bounce confirmed (close>YH/hammer/engulf) with ≥20D volume.`;

  const waitReason = trigger
    ? ""
    : !nearMA
    ? "Price not near MA25/50."
    : !higherLow
    ? "No higher low yet."
    : !volOK
    ? "Bounce volume below average."
    : "Bounce candle not confirmed.";

  return { trigger, stop, target, nearestRes, why, waitReason };
}

/* =================== ROCK-SOLID BREAKOUT DETECTOR =================== */
function detectRockSolidBreakout(stock, data, cfg) {
  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const last = data.at(-1);
  const avgVol20 = avg(data.slice(-20).map((d) => num(d.volume)));

  // Flat resistance from last 10–14 bars (ignore last 2)
  const window = data.slice(-14, -2);
  if (window.length < 8)
    return {
      trigger: false,
      waitReason: "Not enough base to define resistance.",
    };
  const resistance = Math.max(...window.map((d) => num(d.high)));

  const closeBreak = px > resistance * (1 + cfg.breakoutMinClosePct / 100);
  const openOK =
    num(last.open) <= resistance * (1 + cfg.breakoutMaxGapPct / 100);
  const volOK = num(last.volume) >= avgVol20 * cfg.breakoutVolMult;
  const notHot = num(stock.rsi14) < cfg.softRSI;

  const trigger = closeBreak && openOK && volOK && notHot;

  const atr = Math.max(num(stock.atr14), px * 0.005);
  const stop = resistance - 0.6 * atr;
  const target = px + Math.max(2.0 * atr, px * 0.02);

  const nearestRes = findNearestResistance(data, px);
  const why = `Close > ${
    cfg.breakoutMinClosePct
  }% above resistance on ≥${cfg.breakoutVolMult.toFixed(1)}× 20D volume.`;

  const waitReason = trigger
    ? ""
    : !closeBreak
    ? "Close not far enough above resistance."
    : !openOK
    ? "Gap too large at open."
    : !volOK
    ? "Volume not strong enough."
    : "RSI too hot for a safe breakout.";

  return { trigger, stop, target, nearestRes, why, waitReason };
}

/* ============= LEGACY-FLAVOR BREAKOUT (STRICTIFIED) ============= */
function detectLegacyBreakoutStrict(stock, data, cfg) {
  const px = num(stock.currentPrice) || num(data.at(-1).close);
  const atr = Math.max(num(stock.atr14), px * 0.005);
  const rsi = num(stock.rsi14);

  const win = data.slice(-18, -2);
  if (win.length < 10) return { trigger: false, waitReason: "Base too short." };

  const highs = win.map((d) => num(d.high));
  const top = Math.max(...highs);
  const band = top * 0.01;
  const touches = highs.filter((h) => Math.abs(h - top) <= band).length;

  const through = px > top * 1.004; // ~0.4% through
  const prevClose = num(data.at(-2)?.close);
  const gapOK = prevClose > 0 ? (px - prevClose) / prevClose <= 0.03 : true;
  const notHot = rsi < cfg.softRSI;

  const trigger = touches >= 3 && through && gapOK && notHot;
  if (!trigger) {
    return {
      trigger: false,
      waitReason:
        touches < 3
          ? "Not enough flat-top taps."
          : !through
          ? "Not decisively through flat-top."
          : !gapOK
          ? "Gap too large."
          : "RSI too hot.",
    };
  }

  const stop = top - 0.8 * atr;
  const target = px + Math.max(2.5 * atr, px * 0.02);
  const nearestRes = findNearestResistance(data, px);
  const why = `Flat-top with ≥3 taps; clean push-through with controlled gap.`;
  return { trigger, stop, target, nearestRes, why, waitReason: "" };
}

/* ======================== Risk / Reward ======================== */
function analyzeRR(entryPx, stop, target, stock, ms, cfg) {
  const atr = Math.max(num(stock.atr14), entryPx * 0.005);

  // Enforce minimum stop distance (avoid too-tight stops)
  const minStopDist = 1.4 * atr;
  if (entryPx - stop < minStopDist) stop = entryPx - minStopDist;

  const risk = Math.max(0.01, entryPx - stop);
  const reward = Math.max(0, target - entryPx);
  const ratio = reward / risk;

  let need = cfg.minRRbase;
  if (ms.trend === "STRONG_UP") need = cfg.minRRstrongUp;
  if (ms.trend === "WEAK_UP") need = cfg.minRRweakUp;

  return { acceptable: ratio >= need, ratio, stop, target };
}

/* ============================ Guards ============================ */
function guardVeto(stock, data, px, rr, ms, cfg, nearestRes) {
  if (num(stock.rsi14) >= cfg.hardRSI) return true; // RSI heat

  const atr = Math.max(num(stock.atr14), px * 0.005);

  // Headroom to nearest resistance
  if (nearestRes && nearestRes - px < cfg.nearResVetoATR * atr) return true;

  // Not too far above MA25 (avoid late entries after bounce)
  const ma25 = num(stock.movingAverage25d);
  if (ma25 > 0 && (px - ma25) / atr > cfg.maxATRfromMA25) return true;

  // Too many consecutive up days (chasing)
  if (countConsecutiveUpDays(data) > cfg.maxConsecUp) return true;

  return false;
}

/* ======================= JST Session Helper ======================= */
function getJSTSession(now = new Date()) {
  // Convert to JST regardless of server timezone
  const jstMillis = now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60000;
  const jst = new Date(jstMillis);
  const h = jst.getHours(),
    m = jst.getMinutes();

  const inMorning =
    (h > 9 || (h === 9 && m >= 0)) && (h < 11 || (h === 11 && m <= 30));
  const inAfternoon =
    (h > 12 || (h === 12 && m >= 30)) && (h < 15 || (h === 15 && m <= 30));

  if (inMorning) return { session: "MORNING", allow: ["DIP"] };
  if (inAfternoon) return { session: "AFTERNOON", allow: ["BREAKOUT"] };
  // Outside cash session → allow both (useful for backtests / after-close scans)
  return { session: "OFF", allow: ["DIP", "BREAKOUT"] };
}

/* =========================== Utilities =========================== */
function num(v) {
  return Number.isFinite(v) ? v : 0;
}
function isFiniteN(v) {
  return Number.isFinite(v);
}
function avg(arr) {
  return arr.length
    ? arr.reduce((a, b) => a + (Number(b) || 0), 0) / arr.length
    : 0;
}

function countConsecutiveUpDays(data, k = 8) {
  let c = 0;
  for (let i = data.length - 1; i > 0 && c < k; i--) {
    if (num(data[i].close) > num(data[i - 1].close)) c++;
    else break;
  }
  return c;
}

// Nearest visible resistance above current price (simple swing-high scan)
function findNearestResistance(data, px) {
  const ups = data
    .slice(-50)
    .map((d) => num(d.high))
    .filter((h) => h > px);
  if (!ups.length) return null;
  ups.sort((a, b) => a - b);
  return ups[0];
}
