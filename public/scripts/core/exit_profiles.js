// /scripts/exit_profile.js

/* ---------------- Small numeric helpers (null-safe) ---------------- */
function num(v) {
  var x = Number(v);
  return isNaN(x) ? 0 : x;
}

/* ---------------- Core primitives used by profiles ---------------- */
/** ATR fallback: use stock.atr14 or 0.5% of price, min epsilon. */
export function ensureATR(pxOrEntry, stock) {
  var atr14 = stock && stock.atr14 != null ? Number(stock.atr14) : 0;
  var px = num(pxOrEntry);
  return Math.max(isNaN(atr14) ? 0 : atr14, px * 0.005, 1e-6);
}

/** Highest close from a given index (inclusive). */
export function highestCloseSince(hist, fromIdx) {
  var hi = -Infinity;
  for (var i = fromIdx; i < hist.length; i++) {
    var c = hist[i] || {};
    hi = Math.max(hi, num(c.close));
  }
  return hi;
}

/** Last swing low within lookback window using simple pivot logic. */
export function lastSwingLow(hist, lookback) {
  if (!Array.isArray(hist)) return NaN;
  lookback = Number(lookback) || 12;
  var w = hist.slice(-lookback);
  var low = Infinity;
  for (var i = 2; i < w.length - 2; i++) {
    var wi = w[i] || {};
    var wim1 = w[i - 1] || {};
    var wip1 = w[i + 1] || {};
    var L = num(wi.low);
    var Lp = num(wim1.low);
    var Ln = num(wip1.low);
    if (L < Lp && L < Ln) low = Math.min(low, L);
  }
  return isFinite(low) ? low : NaN;
}

/** Simple moving average over `field` (defaults to 'close'). */
export function maSMA(hist, nBars, field) {
  field = field || "close";
  if (!Array.isArray(hist) || hist.length < nBars) return NaN;
  var s = 0;
  for (var i = hist.length - nBars; i < hist.length; i++) {
    var row = hist[i] || {};
    s += num(row[field]);
  }
  return s / nBars;
}

/** 52-week high (approx: last 252 trading bars). */
export function fiftyTwoWeekHighFromHist(hist) {
  var arr = hist.slice(-252);
  var hi = -Infinity;
  for (var i = 0; i < arr.length; i++) {
    var row = arr[i] || {};
    hi = Math.max(hi, num(row.high));
  }
  return hi;
}

/** Chandelier stop = highestCloseSinceEntry − kATR*ATR(now). */
export function chandelier(entryIdx, hist, stock, kATR) {
  var hiClose = highestCloseSince(hist, entryIdx);
  var atr = ensureATR(hiClose, stock);
  return hiClose - kATR * atr;
}

/** Structure trail: max( swingLow−padATR*ATR, MA25−padMA*ATR ), fallback px−1.2*ATR. */
export function structuralTrail(hist, stock, padATR, padMA) {
  padATR = typeof padATR === "number" ? padATR : 0.5;
  padMA = typeof padMA === "number" ? padMA : 0.6;

  var last = hist.length ? hist[hist.length - 1] || {} : {};
  var px = num(last.close);
  var atr = ensureATR(px, stock);
  var sl = lastSwingLow(hist, 10);
  var ma25 = maSMA(hist, 25, "close");

  var cands = [];
  if (isFinite(sl)) cands.push(sl - padATR * atr);
  if (isFinite(ma25) && ma25 < px) cands.push(ma25 - padMA * atr);

  return cands.length ? Math.max.apply(Math, cands) : px - 1.2 * atr;
}

/* ---------------- EXIT PROFILES (broad pack) ---------------- */
export const EXIT_PROFILES = [
  /* ===== Baselines / ATR grids ===== */
  {
    id: "sig_baseline",
    label: "Use analyzer smart stop/target",
    compute: function ({ entry, stock, sig }) {
      return {
        stop: Number(sig && (sig.smartStopLoss ?? sig.stopLoss)),
        target: Number(sig && (sig.smartPriceTarget ?? sig.priceTarget)),
      };
    },
  },
  {
    id: "atr_1.2_3.0",
    label: "Stop: entry-1.2*ATR; Target: entry+3.0*ATR",
    compute: function ({ entry, stock }) {
      var atr = ensureATR(entry, stock);
      return { stop: entry - 1.2 * atr, target: entry + 3.0 * atr };
    },
  },
  {
    id: "atr_1.4_2.8",
    label: "Stop: entry-1.4*ATR; Target: entry+2.8*ATR",
    compute: function ({ entry, stock }) {
      var atr = ensureATR(entry, stock);
      return { stop: entry - 1.4 * atr, target: entry + 2.8 * atr };
    },
  },
  {
    id: "atr_1.0_2.2",
    label: "Tight stop / modest target (more WR)",
    compute: function ({ entry, stock }) {
      var atr = ensureATR(entry, stock);
      return { stop: entry - 1.0 * atr, target: entry + 2.2 * atr };
    },
  },
  {
    id: "atr_1.8_3.6",
    label: "Wide stop / wider target (fewer stops)",
    compute: function ({ entry, stock }) {
      var atr = ensureATR(entry, stock);
      return { stop: entry - 1.8 * atr, target: entry + 3.6 * atr };
    },
  },

  /* ===== Structure-aware ===== */
  {
    id: "struct_min_vs_1.4atr__tgt_sig_or_nextRes",
    label:
      "Stop=min(swingLow-0.35ATR, MA25-0.6ATR, entry-1.4ATR); Target=max(sig, next resistance)",
    compute: function ({ entry, stock, sig, hist }) {
      var atr = ensureATR(entry, stock);
      var sl = lastSwingLow(hist, 14);
      var ma25 = maSMA(hist, 25);
      var stopCands = [entry - 1.4 * atr];
      if (isFinite(sl)) stopCands.push(sl - 0.35 * atr);
      if (isFinite(ma25) && ma25 < entry) stopCands.push(ma25 - 0.6 * atr);
      var stop = Math.min.apply(Math, stopCands);

      var tSig = Number(sig && (sig.smartPriceTarget ?? sig.priceTarget));
      var r20 = -Infinity,
        rY = -Infinity;
      var tail20 = hist.slice(-20);
      for (var i = 0; i < tail20.length; i++)
        r20 = Math.max(r20, num(tail20[i] && tail20[i].high));
      rY = fiftyTwoWeekHighFromHist(hist);
      var target = Math.max(tSig || 0, r20, rY, entry + 2.4 * atr);

      return { stop: stop, target: target };
    },
  },

  /* ===== Headroom-aware ===== */
  {
    id: "res_capped_sig",
    label: "Respect nearest resistance: target = min(sig, nearest res)",
    compute: function ({ entry, stock, sig, hist }) {
      var tSig = Number(sig && (sig.smartPriceTarget ?? sig.priceTarget));
      var r20 = -Infinity,
        rY = -Infinity;
      var tail20 = hist.slice(-20);
      for (var i = 0; i < tail20.length; i++)
        r20 = Math.max(r20, num(tail20[i] && tail20[i].high));
      rY = fiftyTwoWeekHighFromHist(hist);

      var lids = [];
      if (isFinite(r20)) lids.push(r20);
      if (isFinite(rY)) lids.push(rY);
      var firstLid = lids.length ? Math.min.apply(Math, lids) : NaN;

      var target = isFinite(firstLid)
        ? Math.min(tSig || firstLid, firstLid)
        : tSig || r20 || entry * 1.02;

      var atr = ensureATR(entry, stock);
      var stop = entry - 1.35 * atr;
      return { stop: stop, target: target };
    },
  },

  /* ===== Break-even locks at different R ===== */
  {
    id: "be_+0.8R__tgt_3R",
    label: "BE at +0.8R; Target 3R",
    compute: function ({ entry, stock, sig }) {
      var stop0 = Number(sig && (sig.smartStopLoss ?? sig.stopLoss));
      var risk = Math.max(0.01, entry - stop0);
      return { stop: stop0, target: entry + 3 * risk };
    },
    advance: function ({ bar, state }) {
      var risk = Math.max(0.01, state.entry - state.stopInit);
      var bh = num(bar && bar.high);
      if (bh >= state.entry + 0.8 * risk) {
        state.stop = Math.max(state.stop, state.entry);
        return true;
      }
      return false;
    },
  },
  {
    id: "be_+1.0R__tgt_2.5R",
    label: "BE at +1R; Target 2.5R",
    compute: function ({ entry, stock, sig }) {
      var s0 = Number(sig && (sig.smartStopLoss ?? sig.stopLoss));
      var risk = Math.max(0.01, entry - s0);
      return { stop: s0, target: entry + 2.5 * risk };
    },
    advance: function ({ bar, state }) {
      var risk = Math.max(0.01, state.entry - state.stopInit);
      var bh = num(bar && bar.high);
      if (bh >= state.entry + 1.0 * risk)
        state.stop = Math.max(state.stop, state.entry);
      return false;
    },
  },
  {
    id: "be_+1.2R__trail_struct",
    label: "BE at +1.2R; then structure-trail",
    compute: function ({ entry, stock, sig }) {
      var s0 = Number(sig && (sig.smartStopLoss ?? sig.stopLoss));
      var t0 = Number(sig && (sig.smartPriceTarget ?? sig.priceTarget));
      if (!isFinite(t0)) t0 = Infinity; // mostly trail
      return { stop: s0, target: t0 };
    },
    advance: function ({ bar, state, hist, stock }) {
      var risk = Math.max(0.01, state.entry - state.stopInit);
      var bh = num(bar && bar.high);
      if (bh >= state.entry + 1.2 * risk) {
        state.stop = Math.max(state.stop, state.entry);
      }
      if (state.stop >= state.entry) {
        var st = structuralTrail(hist, stock, 0.5, 0.6);
        state.stop = Math.max(state.stop, st);
      }
      return true;
    },
  },
  {
    id: "go_to_blend",
    label:
      "Go-to: stop=entry-1.3*ATR → no-progress(5)→BE → +2R structure trail (floor CH2.5); target jumps if lid<0.7*ATR",
    compute: function ({ entry, stock, sig, hist }) {
      var atr = ensureATR(entry, stock);
      var stop = entry - 1.3 * atr;

      // Base target: analyzer’s target if available, else 3R fallback
      var tSig = Number(sig && (sig.smartPriceTarget ?? sig.priceTarget));
      var s0 = Number(sig && (sig.smartStopLoss ?? sig.stopLoss));
      if (!isFinite(s0)) s0 = stop;
      var risk = Math.max(0.01, entry - s0);
      var target = isFinite(tSig) ? tSig : entry + 3 * risk;

      // Lids: nearest (last 20 highs) and 52w high
      var r20 = -Infinity,
        rY = -Infinity;
      var tail20 = hist.slice(-20);
      for (var i = 0; i < tail20.length; i++)
        r20 = Math.max(r20, (tail20[i] && Number(tail20[i].high)) || 0);
      rY = fiftyTwoWeekHighFromHist(hist);

      var lids = [];
      if (isFinite(r20)) lids.push(r20);
      if (isFinite(rY)) lids.push(rY);
      lids.sort(function (a, b) {
        return a - b;
      });

      // Headroom rule: if first lid is too close (<0.7*ATR above entry), jump to next;
      // otherwise prefer the nearest lid (but don’t cap below a reasonable R target).
      if (lids.length) {
        var first = lids[0];
        var next = lids.length > 1 ? lids[1] : NaN;
        if (isFinite(first) && first - entry < 0.7 * atr && isFinite(next)) {
          target = Math.max(target, next);
        } else {
          // keep nearest lid but don’t let it be worse than ~2.6R if sig target was small
          target = Math.max(target, first, entry + 2.6 * risk);
        }
      }

      return { stop: stop, target: target };
    },
    advance: function ({ bar, state, hist, stock }) {
      // N=5 no-progress → BE
      var risk = Math.max(0.01, state.entry - state.stopInit);
      var age = hist.length - 1 - state.entryIdx;

      if (age >= 5) {
        var touched = false;
        for (var i = state.entryIdx + 1; i < hist.length; i++) {
          var hi = Number((hist[i] || {}).high) || 0;
          if (hi >= state.entry + 0.5 * risk) {
            touched = true;
            break;
          }
        }
        if (!touched) state.stop = Math.max(state.stop, state.entry);
      }

      // If at any time we’ve reached +2R, start trailing
      var bh = Number(bar && bar.high) || 0;
      var maxHi = bh;
      for (var j = state.entryIdx; j < hist.length; j++) {
        var hj = Number((hist[j] || {}).high) || 0;
        if (hj > maxHi) maxHi = hj;
      }
      var progressR = (maxHi - state.entry) / risk;
      if (!state._trailStarted && progressR >= 2) state._trailStarted = true;

      if (state._trailStarted) {
        // Structure trail (tighter pad on ATR); and a floor = Chandelier(2.5)
        var stpStruct = structuralTrail(hist, stock, 1.2, 0.6);
        var stpCh = chandelier(state.entryIdx, hist, stock, 2.5);
        state.stop = Math.max(state.stop, stpStruct, stpCh);
      }
      return true;
    },
  },

  /* ===== Chandelier ATR trails ===== */
  {
    id: "trail_ch_2.5",
    label: "Chandelier trail (2.5*ATR), no BE",
    compute: function ({ entry, stock, sig }) {
      var s0 = Number(sig && (sig.smartStopLoss ?? sig.stopLoss));
      var t0 = Number(sig && (sig.smartPriceTarget ?? sig.priceTarget));
      if (!isFinite(t0)) t0 = Infinity;
      return { stop: s0, target: t0 };
    },
    advance: function ({ state, hist, stock }) {
      var ch = chandelier(state.entryIdx, hist, stock, 2.5);
      state.stop = Math.max(state.stop, ch);
      return true;
    },
  },
  {
    id: "trail_ch_3.0_BE@+1R",
    label: "BE at +1R then Chandelier(3.0)",
    compute: function ({ entry, stock, sig }) {
      var s0 = Number(sig && (sig.smartStopLoss ?? sig.stopLoss));
      var t0 = Number(sig && (sig.smartPriceTarget ?? sig.priceTarget));
      if (!isFinite(t0)) t0 = Infinity;
      return { stop: s0, target: t0 };
    },
    advance: function ({ bar, state, hist, stock }) {
      var risk = Math.max(0.01, state.entry - state.stopInit);
      var bh = num(bar && bar.high);
      if (bh >= state.entry + 1 * risk) {
        state.stop = Math.max(state.stop, state.entry);
      }
      var ch = chandelier(state.entryIdx, hist, stock, 3.0);
      state.stop = Math.max(state.stop, ch);
      return true;
    },
  },

  /* ===== Hybrid: partial lock, then trail ===== */
  {
    id: "lock_+0.6R_stop=entry+0.2R__trail_struct",
    label: "At +0.6R lock stop=entry+0.2R; then structure trail",
    compute: function ({ entry, stock, sig }) {
      var s0 = Number(sig && (sig.smartStopLoss ?? sig.stopLoss));
      var t0 = Number(sig && (sig.smartPriceTarget ?? sig.priceTarget));
      if (!isFinite(t0)) t0 = Infinity;
      return { stop: s0, target: t0 };
    },
    advance: function ({ bar, state, hist, stock }) {
      var risk = Math.max(0.01, state.entry - state.stopInit);
      var bh = num(bar && bar.high);
      if (bh >= state.entry + 0.6 * risk) {
        state.stop = Math.max(state.stop, state.entry + 0.2 * risk);
      }
      var st = structuralTrail(hist, stock, 0.5, 0.6);
      state.stop = Math.max(state.stop, st);
      return true;
    },
  },

  /* ===== Momentum extension ===== */
  {
    id: "mom_ext_sig_or_4R",
    label: "Strong momentum extends target to max(sig, 4R)",
    compute: function ({ entry, stock, sig }) {
      var s0 = Number(sig && (sig.smartStopLoss ?? sig.stopLoss));
      var risk = Math.max(0.01, entry - s0);
      var tgt = Number(sig && (sig.smartPriceTarget ?? sig.priceTarget));
      if (!isFinite(tgt)) tgt = entry + 2.6 * risk;
      return { stop: s0, target: tgt };
    },
    advance: function ({ bar, state }) {
      var bc = num(bar && bar.close);
      var bo = num(bar && bar.open);
      var bh = num(bar && bar.high);
      var bl = num(bar && bar.low);
      var body = Math.abs(bc - bo);
      var range = bh - bl;
      var strong = range > 0 && body >= 0.55 * range && bc >= bh * 0.98;
      if (strong) {
        var risk = Math.max(0.01, state.entry - state.stopInit);
        state.target = Math.max(state.target, state.entry + 4 * risk);
      }
      return strong;
    },
  },

  /* ===== Volatility-adaptive ===== */
  {
    id: "vol_adapt_lowVol_tighter_highVol_wider",
    label: "Low ATR% → tighter; High ATR% → wider",
    compute: function ({ entry, stock }) {
      var atr = ensureATR(entry, stock);
      var atrPct = (atr / Math.max(1e-9, entry)) * 100;
      var kStop = 1.2,
        kTgt = 2.6;
      if (atrPct < 1.0) {
        kStop = 1.0;
        kTgt = 2.2;
      } else if (atrPct > 3.0) {
        kStop = 1.6;
        kTgt = 3.4;
      }
      return { stop: entry - kStop * atr, target: entry + kTgt * atr };
    },
  },

  /* ===== “Time guard” via stop creep (no TIME exit) ===== */
  {
    id: "no_progress_N5bars_creep_to_BE",
    label: "If 5 bars w/o +0.5R touch, creep stop → BE",
    compute: function ({ entry, stock, sig }) {
      var s0 = Number(sig && (sig.smartStopLoss ?? sig.stopLoss));
      var t0 = Number(sig && (sig.smartPriceTarget ?? sig.priceTarget));
      if (!isFinite(t0)) t0 = entry * 10; // effectively trail-only
      return { stop: s0, target: t0 };
    },
    advance: function ({ state, hist }) {
      var risk = Math.max(0.01, state.entry - state.stopInit);
      var N = 5;
      if (hist.length - 1 - state.entryIdx >= N) {
        var touched = false;
        for (var i = state.entryIdx + 1; i < hist.length; i++) {
          var hi = num((hist[i] || {}).high);
          if (hi >= state.entry + 0.5 * risk) {
            touched = true;
            break;
          }
        }
        if (!touched) state.stop = Math.max(state.stop, state.entry);
      }
      return true;
    },
  },

  /* ===== Target: nearest/next resistance ===== */
  {
    id: "tgt_nearest_res_stop_1.35ATR",
    label: "Target = nearest lid; Stop = entry-1.35*ATR",
    compute: function ({ entry, stock, hist }) {
      var atr = ensureATR(entry, stock);
      var r20 = -Infinity,
        rY = -Infinity;
      var tail20 = hist.slice(-20);
      for (var i = 0; i < tail20.length; i++)
        r20 = Math.max(r20, num(tail20[i] && tail20[i].high));
      rY = fiftyTwoWeekHighFromHist(hist);

      var lids = [];
      if (isFinite(r20)) lids.push(r20);
      if (isFinite(rY)) lids.push(rY);
      var lid = lids.length ? Math.min.apply(Math, lids) : NaN;

      var target = isFinite(lid) && lid > entry ? lid : entry + 2.2 * atr;
      return { stop: entry - 1.35 * atr, target: target };
    },
  },
  {
    id: "tgt_next_res_if_first_close",
    label: "If first lid <0.7*ATR, jump to next lid; stop=entry-1.4*ATR",
    compute: function ({ entry, stock, hist }) {
      var atr = ensureATR(entry, stock);
      var highs = hist.slice(-60).map(function (c) {
        return num(c && c.high);
      });
      var r1 = -Infinity;
      for (var i = Math.max(0, highs.length - 20); i < highs.length; i++)
        r1 = Math.max(r1, highs[i]);
      var r2 = fiftyTwoWeekHighFromHist(hist);

      var lids = [];
      if (isFinite(r1)) lids.push(r1);
      if (isFinite(r2)) lids.push(r2);
      lids.sort(function (a, b) {
        return a - b;
      });

      var target = entry + 2.6 * atr;
      if (lids.length) {
        var first = lids[0];
        if (first - entry < 0.7 * atr && lids[1] != null)
          target = Math.max(target, lids[1]);
        else target = Math.min(target, first);
      }
      return { stop: entry - 1.4 * atr, target: target };
    },
  },
];
