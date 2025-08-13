// swingTradeEntryTiming.js (flexible, DIP-first; legacy breakout; clear reasons)

/**
 * Usage:
 *   const res = analyzeSwingTradeEntry(stock, candles, { debug: true, allowedKinds: ["DIP","BREAKOUT"] });
 * Returns:
 *   { buyNow, reason, stopLoss?, priceTarget?, debug? }
 */

export function analyzeSwingTradeEntry(stock, historicalData, opts = {}) {
  const cfg = getConfig(opts);
  const reasons = [];

  // ---- Validate & prep data ----
  if (!Array.isArray(historicalData) || historicalData.length < 25) {
    const r = "Insufficient historical data (need ≥25 bars).";
    return withNo(r, { reasons: [r] });
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
    const r = "Invalid last bar OHLCV.";
    return withNo(r, { reasons: [r] });
  }

  // Robust price context (works pre-open / intraday / after-close)
  const px = num(stock.currentPrice) || num(last.close);
  const openPx = num(stock.openPrice) || num(last.open) || px;
  const prevClose = num(stock.prevClosePrice) || num(last.close) || openPx;
  const dayPct = openPx ? ((px - openPx) / openPx) * 100 : 0;

  const ms = getMarketStructure(stock, data); // { trend, recentHigh, recentLow, ma25, ma50, ma200 }

  // Price action gate (allow small red day to catch first bounce)
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

  // Allowed paths (default both)
  const allow =
    Array.isArray(opts.allowedKinds) && opts.allowedKinds.length
      ? new Set(opts.allowedKinds.map((s) => s.toUpperCase()))
      : new Set(["DIP", "BREAKOUT"]);

  // ---- Build candidates (and gather non-trigger reasons) ----
  const candidates = [];
  const checks = {};

  // --- DIP path ---
  if (allow.has("DIP")) {
    const dip = detectDipBounce(stock, data, cfg);
    checks.dip = dip;

    if (!dip.trigger) {
      reasons.push(`DIP not ready: ${dip.waitReason}`);
    } else {
      // Gate override for strong early-dip pattern right at support
      const gateOk =
        priceActionGate || (dip.patternStrong && dip.nearSupportStrong);
      if (!gateOk) {
        reasons.push(`DIP blocked by gate: ${gateWhy}`);
      } else {
        const rr = analyzeRR(px, dip.stop, dip.target, stock, ms, cfg);
        if (!rr.acceptable) {
          reasons.push(
            `DIP RR too low: ratio ${rr.ratio.toFixed(
              2
            )} < need ${rr.need.toFixed(2)} (risk ${fmt(
              px - rr.stop
            )}, reward ${fmt(rr.target - px)}).`
          );
        } else {
          const gv = guardVeto(
            stock,
            data,
            px,
            rr,
            ms,
            cfg,
            dip.nearestRes,
            "DIP"
          );
          if (gv.veto) {
            reasons.push(
              `DIP guard veto: ${gv.reason} ${summarizeGuardDetails(
                gv.details
              )}.`
            );
          } else {
            candidates.push({
              kind: "DIP ENTRY",
              why: dip.why,
              stop: rr.stop,
              target: rr.target,
              rr,
              guard: gv.details,
            });
          }
        }
      }
    }
  }

  // --- BREAKOUT (legacy strictified) ---
  if (allow.has("BREAKOUT")) {
    const bo = detectLegacyBreakoutStrict(stock, data, cfg);
    checks.breakoutLegacy = bo;

    if (!bo.trigger) {
      reasons.push(`BREAKOUT not ready: ${bo.waitReason}`);
    } else if (!priceActionGate) {
      reasons.push(`BREAKOUT blocked by gate: ${gateWhy}`);
    } else {
      const rr = analyzeRR(px, bo.stop, bo.target, stock, ms, cfg);
      if (!rr.acceptable) {
        reasons.push(
          `BREAKOUT RR too low: ratio ${rr.ratio.toFixed(
            2
          )} < need ${rr.need.toFixed(2)}.`
        );
      } else {
        const gv = guardVeto(
          stock,
          data,
          px,
          rr,
          ms,
          cfg,
          bo.nearestRes,
          "BREAKOUT"
        );
        if (gv.veto) {
          reasons.push(
            `BREAKOUT guard veto: ${gv.reason} ${summarizeGuardDetails(
              gv.details
            )}.`
          );
        } else {
          candidates.push({
            kind: "BREAKOUT",
            why: bo.why,
            stop: rr.stop,
            target: rr.target,
            rr,
            guard: gv.details,
          });
        }
      }
    }
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

  // Prefer DIP first; otherwise choose highest RR
  candidates.sort((a, b) =>
    a.kind === "DIP ENTRY"
      ? -1
      : b.kind === "DIP ENTRY"
      ? 1
      : b.rr.ratio - a.rr.ratio
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
    redDayMaxDownPct: -2.2, // was -1.6

    // Guards & thresholds (DIP vs BREAKOUT)
    maxATRfromMA25_DIP: 2.2, // was 1.8 (DIP gets a bit more room)
    maxATRfromMA25_BO: 1.8,
    maxConsecUp: 5,
    nearResVetoATR_DIP: 0.25, // was 0.5
    nearResVetoATR_BO: 0.5,
    hardRSI: 77,
    softRSI: 74, // was 72

    // RR thresholds
    minRRbase: 1.35, // was 1.5
    minRRstrongUp: 1.1, // was 1.2
    minRRweakUp: 1.4, // was 1.6

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
    ma50 = num(stock.movingAverage50d),
    ma200 = num(stock.movingAverage200d);

  const last5 = data.slice(-5);
  const d0 = last5.at(-1),
    d1 = last5.at(-2);
  const avgVol20 = avg(data.slice(-20).map((d) => num(d.volume)));
  const avgVol5 = avg(data.slice(-5).map((d) => num(d.volume)));

  // --- Support proximity (broader) ---
  const nearMA =
    (ma25 > 0 && Math.abs(px - ma25) <= 2.6 * atr) ||
    (ma50 > 0 && Math.abs(px - ma50) <= 2.6 * atr) ||
    (ma200 > 0 && Math.abs(px - ma200) <= 2.8 * atr);
  const nearSwing = nearRecentSupportOrPivot(data, px, atr, 0.03); // widened to 3%
  const nearSupport = nearMA || nearSwing;

  // Stronger support flag (for gate bypass)
  const nearSupportStrong =
    nearMA || (nearSwing && Math.abs(px - (ma25 || px)) <= 3.0 * atr);

  // --- Higher low (allow small undercut / dbl-bottom within 1.5%) ---
  const pivotLow = Math.min(...last5.map((d) => num(d.low)));
  const prevZoneLow = Math.min(...data.slice(-10, -5).map((d) => num(d.low)));
  const higherLow =
    prevZoneLow > 0 &&
    (pivotLow >= prevZoneLow * 0.955 ||
      Math.abs(pivotLow - prevZoneLow) / Math.max(1, prevZoneLow) <= 0.015);

  // --- Bounce confirmation ---
  const closeAboveYHigh = num(d0.close) > num(d1.high);
  const hammer = (() => {
    const range = num(d0.high) - num(d0.low);
    const body = Math.abs(num(d0.close) - num(d0.open));
    const lower = Math.min(num(d0.close), num(d0.open)) - num(d0.low);
    return (
      range > 0 &&
      body <= 0.55 * range &&
      lower >= 1.5 * body &&
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

  const patternStrong = hammer || engulf;
  const bounceOK = closeAboveYHigh || hammer || engulf || twoBarRev;

  // --- Volume (slightly easier) ---
  const obv = num(stock.obv);
  const volOK =
    num(d0.volume) >= avgVol20 * 0.85 || // was 0.9
    avgVol5 >= avgVol20 * 0.9 || // was 0.95
    obv > 0;

  const trigger =
    nearSupport && (higherLow || patternStrong) && bounceOK && volOK;

  // --- Targets & stop (tighter if patternStrong) ---
  const resList = findResistancesAbove(data, px);
  const firstRes = resList[0] ?? null;
  const secondRes = resList[1] ?? null;

  let stop = patternStrong
    ? Math.min(pivotLow, num(d0.low)) - 0.35 * atr
    : pivotLow - 0.55 * atr;

  // Prefer 2nd resistance if headroom to 1st is tiny
  const targetCandidate =
    secondRes && firstRes && firstRes - px < 0.8 * atr
      ? secondRes
      : firstRes || null;
  const defaultTarget = px + Math.max(2.3 * atr, px * 0.02);
  const target =
    targetCandidate && targetCandidate > px ? targetCandidate : defaultTarget;

  const nearestRes = firstRes || null;
  const why = `Near support (MA/structure), ${
    higherLow ? "higher low" : "early-dip pattern"
  }, bounce confirmed, volume OK${patternStrong ? " (strong pattern)" : ""}.`;

  const waitReason = trigger
    ? ""
    : !nearSupport
    ? "price not near support (MA25/50/200 or swing/flip zone)"
    : !(higherLow || patternStrong)
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
    patternStrong,
    nearSupportStrong,
    diagnostics: {
      nearMA,
      ma25,
      ma50,
      ma200,
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

  const win = data.slice(-22, -2); // slightly wider base
  if (win.length < 10) return { trigger: false, waitReason: "base too short" };

  const highs = win.map((d) => num(d.high));
  const top = Math.max(...highs);

  // Flat-top taps & contraction
  const band = top * 0.0125; // 1.25%
  const touches = highs.filter((h) => Math.abs(h - top) <= band).length;
  const atr5 = avg(data.slice(-5).map((d) => num(d.high) - num(d.low)));
  const atr20 = avg(data.slice(-20).map((d) => num(d.high) - num(d.low)));
  const contracted = atr20 > 0 && atr5 / atr20 <= 0.75;

  // Through + gap/volume + RSI
  const throughHard = px > top * 1.0025; // 0.25%
  const prevClose = num(data.at(-2)?.close);
  const gapOK = prevClose > 0 ? (px - prevClose) / prevClose <= 0.05 : true; // 5% (was 3.5)
  const avgVol20 = avg(data.slice(-20).map((d) => num(d.volume)));
  const volStrong = num(data.at(-1).volume) >= avgVol20 * 1.3;

  const through = throughHard || (volStrong && px > top * 1.0015); // allow 0.15% if vol is strong
  const notHot = rsi < cfg.softRSI; // using 74

  const enoughTaps = touches >= 2 || (contracted && touches >= 1);
  const trigger = enoughTaps && through && gapOK && notHot;

  if (!trigger) {
    const wr = !enoughTaps
      ? "not enough flat-top taps"
      : !through
      ? "not decisively through flat-top"
      : !gapOK
      ? "gap too large"
      : "RSI too hot";
    return {
      trigger: false,
      waitReason: wr,
      diagnostics: {
        touches,
        top,
        through,
        gapOK,
        volStrong,
        contracted,
        notHot,
        atr,
      },
    };
  }

  const stop = top - 0.75 * atr;
  const target = px + Math.max(2.4 * atr, px * 0.02);
  const nearestRes = findNearestResistance(data, px);
  const why = `Flat-top (${touches} tap${touches !== 1 ? "s" : ""}${
    contracted ? " w/ contraction" : ""
  }) & push-through${volStrong ? " on strong vol" : ""}.`;
  return {
    trigger,
    stop,
    target,
    nearestRes,
    why,
    waitReason: "",
    diagnostics: { touches, top, through, volStrong, contracted, atr },
  };
}

/* ======================== Risk / Reward ======================== */
function analyzeRR(entryPx, stop, target, stock, ms, cfg) {
  const atr = Math.max(num(stock.atr14), entryPx * 0.005);
  const minStopDist = 1.2 * atr; // was 1.4
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
function guardVeto(stock, data, px, rr, ms, cfg, nearestRes, kind) {
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

  // Headroom to nearest resistance
  if (nearestRes) {
    const headroom = (nearestRes - px) / atr;
    details.nearestRes = nearestRes;
    details.headroomATR = headroom;
    const need =
      kind === "DIP" ? cfg.nearResVetoATR_DIP : cfg.nearResVetoATR_BO;
    if (headroom < need)
      return {
        veto: true,
        reason: `Headroom ${headroom.toFixed(
          2
        )} ATR < ${need} ATR to resistance`,
        details,
      };
  } else {
    details.nearestRes = null;
  }

  // Distance above MA25 (looser for DIP)
  if (ma25 > 0) {
    const distMA25 = (px - ma25) / atr;
    details.ma25 = ma25;
    details.distFromMA25_ATR = distMA25;
    const limit =
      kind === "DIP" ? cfg.maxATRfromMA25_DIP : cfg.maxATRfromMA25_BO;
    if (distMA25 > limit)
      return {
        veto: true,
        reason: `Too far above MA25 (${distMA25.toFixed(2)} ATR > ${limit})`,
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
function isFiniteN(v) {
  return Number.isFinite(v);
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

// Nearest visible resistance above current price (simple swing-high scan)
function findNearestResistance(data, px) {
  const ups = data
    .slice(-60)
    .map((d) => num(d.high))
    .filter((h) => h > px);
  if (!ups.length) return null;
  ups.sort((a, b) => a - b);
  return ups[0];
}

// List of resistances (sorted ascending) for target selection
function findResistancesAbove(data, px) {
  const highs = data
    .slice(-60)
    .map((d) => num(d.high))
    .filter((h) => h > px);
  const uniq = Array.from(new Set(highs)).sort((a, b) => a - b);
  return uniq;
}

// Treat recent swing-lows & prior breakout pivots as support if close enough
function nearRecentSupportOrPivot(data, px, atr, pctBand = 0.02) {
  const win = data.slice(-35);
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
  const pivots = swingLows.concat(swingHighs); // polarity flips can act as support
  return pivots.some(
    (p) =>
      (px >= p && px - p <= 2.8 * atr) || // within ATR band
      Math.abs(px - p) / Math.max(1, p) <= pctBand // or within X%
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
