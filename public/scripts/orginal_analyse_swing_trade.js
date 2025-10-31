export function analyzeSwingTradeEntry(stock, historicalData, opts = {}) {
  const cfg = getConfig(opts);
  const reasons = [];
  const tele = teleInit();
  const T = mkTracer(opts);

  if (!Array.isArray(historicalData) || historicalData.length < 25) {
    const r = "Insufficient historical data (need ≥25 bars).";
    const out = withNo(r, { stock, data: historicalData || [], cfg });
    out.telemetry = {
      ...tele,
      outcome: { buyNow: false, reason: r },
      reasons: [r],
      trace: T.logs,
    };
    return out;
  }

  // keep full data (incl. synthetic "today") for RR/levels
  const sorted = [...historicalData].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );
  const data = sorted;

  const last = data[data.length - 1];
  if (
    ![last?.open, last?.high, last?.low, last?.close].every(Number.isFinite)
  ) {
    const r = "Invalid last bar OHLCV.";
    const out = withNo(r, { stock, data, cfg });
    out.telemetry = {
      ...tele,
      outcome: { buyNow: false, reason: r },
      reasons: [r],
      trace: T.logs,
    };
    return out;
  }

  // normalize volume to a finite number for downstream calcs
  if (!Number.isFinite(last.volume)) last.volume = 0;

  // --- History sufficiency for enabled gates (avoid silent gating later) ---
  const requiresDaily75 =
    cfg.requireDailyReclaim25and75ForDIP || cfg.requireMA25over75ForDIP;
  const requiresWeekly52 = cfg.requireWeeklyUpForDIP;
  if (requiresDaily75 && data.length < 75) {
    const r =
      "Insufficient history for DIP gating (need ≥75 daily bars for MA25/MA75).";
    const out = withNo(r, { stock, data, cfg });
    out.telemetry = {
      ...tele,
      outcome: { buyNow: false, reason: r },
      reasons: [r],
      trace: T.logs,
    };
    return out;
  }
  if (requiresWeekly52) {
    const weeks = resampleToWeeks(data);
    if (weeks.length < 52) {
      const r =
        "Insufficient history for DIP gating (need ≥52 weekly closes for 13/26/52-week MAs).";
      const out = withNo(r, { stock, data, cfg });
      out.telemetry = {
        ...tele,
        outcome: { buyNow: false, reason: r },
        reasons: [r],
        trace: T.logs,
      };
      return out;
    }
  }

  const px = num(stock.currentPrice) || num(last.close);
  const openPx = num(stock.openPrice) || num(last.open) || px;
  const prevClose = num(stock.prevClosePrice) || num(last.close) || openPx;
  const dayPct = openPx ? ((px - openPx) / openPx) * 100 : 0;

  const gapPctNow = prevClose ? ((openPx - prevClose) / prevClose) * 100 : 0;
  stock.gapPct = gapPctNow; // persist for downstream use

  // structure snapshot (for display + minimal sanity)
  const msFull = getMarketStructure(stock, data);
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
    gatesDataset: { bars: data.length, lastDate: data.at(-1)?.date },
  };

  // --- NEW: slice filter context scaffold (we'll finalize after DIP runs) ---
  let stPanicScore = null; // will fill from dip.diagnostics.stScore
  let compositeScore = null; // will fill from dip.diagnostics.compositeScore

  // Fresh flip detectors (for lag). We use the completed data array ("data")
  const crossDailyFresh = detectDailyStackedCross(
    data,
    cfg.freshDailyLookbackDays || 5
  );
  const crossWeeklyFresh = detectWeeklyStackedCross(
    data,
    cfg.freshWeeklyLookbackWeeks || 5
  );

  // lag = how long since bullish flip. If no flip, Infinity.
  const lagDaily = crossDailyFresh.trigger ? crossDailyFresh.daysAgo : Infinity;
  const lagWeekly = crossWeeklyFresh.trigger
    ? crossWeeklyFresh.weeksAgo
    : Infinity;

  // We'll set tele.context.sentimentST and tele.context.compositeScore
  // AFTER we run detectDipBounce(), once we actually know stPanicScore/compositeScore.
  // For now just stash the stable pieces:
  tele.context.regime = msFull.trend;
  tele.context.lagDaily = lagDaily;
  tele.context.lagWeekly = lagWeekly;
  tele.context.gapPctNow = gapPctNow;

  /* ----- Minimal structure check (DIP-friendly) ----- */
  // Allow WEAK_UP/UP/STRONG_UP, forbid clear DOWN unless cfg allows
  const structureGateOk =
    (msFull.trend !== "DOWN" || cfg.allowDipInDowntrend) &&
    px >= (msFull.ma5 || 0) * 0.988; // a touch more slack
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

  const candidates = [];
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

  /* ======================= DIP (primary & only lane) ======================= */
  const dip = detectDipBounce(stock, data, cfg, U);

  T(
    "dip",
    "detect",
    !!dip?.trigger,
    dip?.trigger ? "DIP trigger" : dip?.waitReason || "DIP not ready",
    { why: dip?.why, waitReason: dip?.waitReason, diag: dip?.diagnostics },
    "verbose"
  );

  // Mirror DIP diagnostics into telemetry
  tele.dip = {
    trigger: !!dip?.trigger,
    waitReason: dip?.waitReason || "",
    why: dip?.why || "",
    diagnostics: dip?.diagnostics || {},
  };

  // === Derive stPanicScore and compositeScore AFTER DIP so they're real ===
  stPanicScore =
    dip?.diagnostics && Number.isFinite(dip.diagnostics.stScore)
      ? dip.diagnostics.stScore
      : stock?.sentimentST ?? null;

  compositeScore =
    dip?.diagnostics && Number.isFinite(dip.diagnostics.compositeScore)
      ? dip.diagnostics.compositeScore
      : stock?.compositeScore ?? stock?.signalScore ?? null;

  // Now that we know them, write them into telemetry.context
  tele.context.sentimentST = stPanicScore;
  tele.context.compositeScore = compositeScore;
  tele.context.regime = msFull.trend; // already set earlier, but keep explicit

  // ----- Weekly/Daily-cross DIP gate (strict) -----
  const pxNow = px;
  const wkGate = weeklyUptrendGate(data, pxNow);
  const reclaimGate = recentPriceReclaim25and75(data, cfg.dailyReclaimLookback);
  const maCrossGate = recentMA25Over75Cross(data, cfg.maCrossMaxAgeBars);

  let dipGatePass = true;
  let dipGateWhy = [];

  if (cfg.requireWeeklyUpForDIP && !wkGate.passRelaxed) {
    dipGatePass = false;
    dipGateWhy.push("not above 13/26/52-week MAs");
  }
  // OR-logic: require (reclaim OR cross) if either DIP flag is enabled
  if (cfg.requireDailyReclaim25and75ForDIP || cfg.requireMA25over75ForDIP) {
    if (!(reclaimGate.pass || maCrossGate.pass)) {
      dipGatePass = false;
      dipGateWhy.push(
        `no 25/75 reclaim (≤${cfg.dailyReclaimLookback}) OR 25>75 cross (≤${cfg.maCrossMaxAgeBars})`
      );
    }
  }

  if (dip?.trigger && !dipGatePass) {
    pushBlock(tele, "DIP_GATE", "dip", `DIP gated: ${dipGateWhy.join("; ")}`, {
      wkGate,
      reclaimGate,
      maCrossGate,
    });
  }

  // mirror selected numeric diagnostics into distros if present
  try {
    const d = dip?.diagnostics || {};
    if (isFiniteN(d.bounceV20ratio ?? d.v20ratio))
      tele.distros.dipV20ratio.push(
        +(d.bounceV20ratio ?? d.v20ratio).toFixed(3)
      );
    if (isFiniteN(d.bodyPct))
      tele.distros.dipBodyPct.push(+d.bodyPct.toFixed(3));
    if (isFiniteN(d.rangePctATR ?? d.bounceStrengthATR))
      tele.distros.dipRangePctATR.push(
        +(d.rangePctATR ?? d.bounceStrengthATR).toFixed(3)
      );
    if (isFiniteN(d.closeDeltaATR))
      tele.distros.dipCloseDeltaATR.push(+d.closeDeltaATR.toFixed(3));
    if (isFiniteN(d.pullbackPct))
      tele.distros.dipPullbackPct.push(+d.pullbackPct.toFixed(3));
    if (isFiniteN(d.pullbackATR))
      tele.distros.dipPullbackATR.push(+d.pullbackATR.toFixed(3));
    if (isFiniteN(d.recoveryPct))
      tele.distros.dipRecoveryPct.push(+d.recoveryPct.toFixed(3));
  } catch {}

  if (!dip?.trigger) {
    const wait = (dip?.waitReason || "").toLowerCase();
    let code = "DIP_WAIT";
    if (wait.includes("too shallow")) code = "DIP_TOO_SHALLOW";
    else if (wait.includes("already recovered")) code = "DIP_OVERRECOVERED";
    else if (wait.includes("bounce weak")) code = "DIP_WEAK_BOUNCE";
    else if (wait.includes("no meaningful pullback")) code = "DIP_NO_PULLBACK";
    else if (wait.includes("conditions not fully"))
      code = "DIP_CONDS_INCOMPLETE";
    pushBlock(tele, code, "dip", dip?.waitReason || "DIP not ready", {
      px,
      diag: dip?.diagnostics || {},
    });
  }

  if (dip?.trigger && structureGateOk && dipGatePass) {
    // === NEW: historical slice gating and loser veto ===

    // run loser veto first
    const loserCheck = failsCommonLoserPatterns(
      px,
      msFull.ma25,
      stPanicScore,
      lagDaily,
      lagWeekly,
      msFull.trend
    );

    // run profitable-slice allowlist
    const sliceCheck = passesBestSliceFilters(
      msFull.trend,
      stPanicScore,
      lagDaily,
      lagWeekly,
      dip,
      px,
      msFull.ma25,
      gapPctNow,
      compositeScore
    );

    if (loserCheck.fail) {
      const msg = `AUTO-BLOCK (historical loser pattern): ${loserCheck.why}`;
      reasons.push(msg);
      pushBlock(tele, "SLICE_LOSERBLOCK", "slice", msg, {
        regime: msFull.trend,
        st: stPanicScore,
        lagDaily,
        lagWeekly,
      });
    } else if (!sliceCheck) {
      const msg =
        "Not in proven profitable slice (score<6 / no DOWN+panic / no RANGE-gap-up-near-MA25)";
      reasons.push(msg);
      pushBlock(tele, "SLICE_NOTGOLDBUCKET", "slice", msg, {
        regime: msFull.trend,
        st: stPanicScore,
        lagDaily,
        lagWeekly,
        compositeScore,
        gapPctNow,
      });
    } else {
      // Passed slice whitelist AND not in loser blacklist.
      // Now we do RR and guard just like before.

      const rr = analyzeRR(px, dip.stop, dip.target, stock, msFull, cfg, {
        kind: "DIP",
        data,
      });

      T(
        "rr",
        "calc",
        rr.acceptable,
        `RR ${fmt(rr.ratio)} need ${fmt(rr.need)} risk ${fmt(
          rr.risk
        )} reward ${fmt(rr.reward)}`,
        {
          stop: rr.stop,
          target: rr.target,
          atr: rr.atr,
          probation: rr.probation,
          kind: "DIP",
        },
        "verbose"
      );

      tele.rr = toTeleRR(rr);

      if (!rr.acceptable) {
        const atrPct = (rr.atr / Math.max(1e-9, px)) * 100;
        const short = +(rr.need - rr.ratio).toFixed(3);
        tele.histos.rrShortfall.push({
          need: +rr.need.toFixed(2),
          have: +rr.ratio.toFixed(2),
          short,
          atrPct: +atrPct.toFixed(2),
          trend: msFull.trend,
          ticker: stock?.ticker,
        });
        pushBlock(
          tele,
          "RR_FAIL",
          "rr",
          `RR ${fmt(rr.ratio)} < need ${fmt(rr.need)}`,
          {
            stop: rr.stop,
            target: rr.target,
            atr: rr.atr,
            px,
          }
        );
        reasons.push(`DIP RR too low: ${fmt(rr.ratio)} < need ${fmt(rr.need)}`);
      } else {
        const gv = guardVeto(
          stock,
          data,
          px,
          rr,
          msFull,
          cfg,
          dip.nearestRes,
          "DIP"
        );
        T(
          "guard",
          "veto",
          !gv.veto,
          gv.veto ? `VETO: ${gv.reason}` : "No veto",
          gv.details,
          "verbose"
        );

        tele.guard = {
          checked: true,
          veto: !!gv.veto,
          reason: gv.reason || "",
          details: gv.details || {},
        };

        if (gv.veto) {
          reasons.push(`DIP guard veto: ${gv.reason}`);
          const code = gv.reason?.startsWith("Headroom")
            ? "VETO_HEADROOM"
            : gv.reason?.startsWith("RSI")
            ? "VETO_RSI"
            : gv.reason?.startsWith("Too far above MA25")
            ? "VETO_MA25_EXT"
            : "VETO_OTHER";
          pushBlock(tele, code, "guard", gv.reason, gv.details);
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
  } else if (!dip?.trigger) {
    reasons.push(`DIP not ready: ${dip?.waitReason}`);
  } else if (dip?.trigger && !structureGateOk) {
    reasons.push("Structure gate failed for DIP.");
  }

  /* ======================= Cross + Volume playbook ======================= */
  if (cfg.crossPlaybookEnabled) {
    const x = detectCrossVolumePlay(stock, data, cfg);
    T(
      "cross",
      "detect",
      !!x.trigger,
      x.trigger ? "CROSS trigger" : x.wait || "no cross",
      { diag: x.diag },
      "verbose"
    );

    if (x.trigger && structureGateOk) {
      const rrX = analyzeRR(
        px,
        x.stop,
        x.target,
        stock,
        msFull,
        { ...cfg, minRRbase: Math.max(cfg.minRRbase, cfg.crossMinRR) },
        { kind: "CROSS", data }
      );
      // only overwrite telemetry.rr if DIP didn't set it
      if (!tele.rr.checked) tele.rr = toTeleRR(rrX);

      if (rrX.acceptable) {
        const gvX = guardVeto(stock, data, px, rrX, msFull, cfg, null, "CROSS");
        T(
          "cross",
          "guard",
          !gvX.veto,
          gvX.veto ? `VETO: ${gvX.reason}` : "No veto",
          gvX.details,
          "verbose"
        );
        if (!gvX.veto) {
          candidates.push({
            kind: "MA CROSS + VOLUME",
            why: x.why,
            stop: rrX.stop,
            target: rrX.target,
            rr: rrX,
            guard: gvX.details,
          });
        } else {
          pushBlock(tele, "X_VETO", "guard", gvX.reason, gvX.details);
        }
      } else {
        pushBlock(
          tele,
          "X_RR_FAIL",
          "rr",
          `RR ${fmt(rrX.ratio)} < need ${fmt(rrX.need)}`,
          { stop: rrX.stop, target: rrX.target }
        );
      }
    } else if (!x.trigger) {
      pushBlock(
        tele,
        `X_WAIT_${x.code || "GEN"}`,
        "cross",
        x.wait || "cross not ready",
        {}
      );
    }
  }

  /* attach global guard histos */
  tele.histos.headroom = tele.histos.headroom.concat(
    teleGlobal.histos.headroom
  );
  tele.histos.distMA25 = tele.histos.distMA25.concat(
    teleGlobal.histos.distMA25
  );
  teleGlobal.histos.headroom.length = 0;
  teleGlobal.histos.distMA25.length = 0;

  if (candidates.length === 0) {
    const reason = buildNoReason([], reasons);
    tele.outcome = { buyNow: false, reason };
    return {
      buyNow: false,
      reason,
      ...fallbackPlan(stock, data, cfg),
      timeline: [],
      telemetry: { ...tele, trace: T.logs },
    };
  }

  // pick highest RR
  candidates.sort(
    (a, b) => (Number(b?.rr?.ratio) || -1e9) - (Number(a?.rr?.ratio) || -1e9)
  );
  const best = candidates[0];
  tele.outcome = {
    buyNow: true,
    reason: `${best.kind}: ${best.rr ? best.rr.ratio.toFixed(2) : "?"}:1. ${
      best.why
    }`,
  };

  return {
    buyNow: true,
    reason: `${best.kind}: ${best.rr ? best.rr.ratio.toFixed(2) : "?"}:1. ${
      best.why
    }`,
    stopLoss: toTick(best.stop, stock),
    priceTarget: toTick(best.target, stock),
    smartStopLoss: toTick(best.stop, stock),
    smartPriceTarget: toTick(best.target, stock),
    timeline: buildSwingTimeline(px, best, best.rr, msFull),
    telemetry: { ...tele, trace: T.logs },
  };
}


/**
 * failsCommonLoserPatterns
 * Returns {fail:true, why:"..."} if we should REFUSE this setup immediately.
 */
function failsCommonLoserPatterns(px, ma25, stScore, lagDaily, lagWeekly, msTrend) {
    // 1. extendedPx (>6% above MA25)
    if (ma25 > 0) {
      const extPct = ((px - ma25) / ma25) * 100;
      if (extPct > 6) {
        return { fail: true, why: "Extended >6% above MA25 (>6%)" };
      }
    }
  
    // 2. earlyLag (too soon after bullish flip) -> lag < 2 bars/weeks
    if (
      (lagDaily !== Infinity && lagDaily < 2) ||
      (lagWeekly !== Infinity && lagWeekly < 2)
    ) {
      return { fail: true, why: "Too early after bullish flip (lag<2)" };
    }
  
    // 3. weakPullback (ST <6)
    if (stScore != null && stScore < 6) {
      return { fail: true, why: "Not a real panic pullback (ST<6)" };
    }
  
    // 4. badRegime (pure chase in STRONG_UP)
    if (msTrend === "STRONG_UP") {
      return { fail: true, why: "Chasing STRONG_UP strength (big loser bucket)" };
    }
  
    return { fail: false, why: "" };
  }
  
  /**
   * passesBestSliceFilters
   * Returns true only if this setup matches one of the historically profitable buckets.
   *
   * Buckets:
   *  - HIGH_SCORE_6plus :: compositeScore >= 6
   *  - DOWN_regime_ST_panic_weekly_flip :: trend DOWN, stScore>=6, lagWeekly>=2, and DIP actually triggered
   *  - RANGE_regime_gap_up_near_MA25 :: "RANGE-ish" regime, gap up >0%, price ≤4% above MA25, DIP-triggered
   *
   * NOTE: we approximate RANGE by treating WEAK_UP or UP as "RANGE-ish".
   */
  function passesBestSliceFilters(
    msTrend,
    stScore,
    lagDaily,
    lagWeekly,
    dipObj,
    px,
    ma25,
    gapPctNow,
    compositeScore
  ) {
    // 1. HIGH_SCORE_6plus
    const highScoreOK =
      compositeScore != null && Number.isFinite(+compositeScore) && +compositeScore >= 6;
  
    // 2. DOWN_regime_ST_panic_weekly_flip
    const downPanicBounceOK =
      msTrend === "DOWN" &&
      stScore != null &&
      stScore >= 6 &&
      Number.isFinite(lagWeekly) &&
      lagWeekly >= 2 &&
      !!dipObj?.trigger;
  
    // 3. RANGE_regime_gap_up_near_MA25
    const distPctMA25 = ma25 > 0 ? ((px - ma25) / ma25) * 100 : 999;
    const rangeNearMA25OK =
      (msTrend === "WEAK_UP" || msTrend === "UP") &&
      gapPctNow > 0 &&
      distPctMA25 <= 4 &&
      !!dipObj?.trigger;
  
    return highScoreOK || downPanicBounceOK || rangeNearMA25OK;
  }




  
function weeklyStackedNow(data) {
  const w = resampleToWeeks(data);
  if (w.length < 52) return { stacked: false, w13: 0, w26: 0, w52: 0 };
  const w13 = smaSeries(w, 13);
  const w26 = smaSeries(w, 26);
  const w52 = smaSeries(w, 52);
  const eps = 0.0015; // ~0.15%
  const stacked =
    w13 > 0 &&
    w26 > 0 &&
    w52 > 0 &&
    w13 >= w26 * (1 + eps) &&
    w26 >= w52 * (1 + eps);
  return { stacked, w13, w26, w52 };
}

// Map a daily bar index to its ISO-week index within resampled weeks
function weekIndexOfDailyIndex(dailyIdx, daily, weeks) {
  const isoKey = (d) => {
    const dt = new Date(d);
    const t = new Date(
      Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate())
    );
    const dayNum = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
    return t.getUTCFullYear() + "-" + weekNo;
  };
  const key = isoKey(daily[dailyIdx].date);
  // weeks[] were produced by resampleToWeeks(daily) in chronological order
  for (let i = weeks.length - 1; i >= 0; i--) {
    const wkKey = isoKey(weeks[i].date);
    if (wkKey === key) return i;
  }
  return weeks.length - 1; // fallback to last
}

// Cheap weekly ATR proxy from daily ATR when only daily ATR is available
function approxWeeklyATRFromDailyATR(atrDaily) {
  // Weekly ATR ~ sqrt(5) * daily ATR as a rough proxy
  return Math.max(atrDaily || 0, 1e-9) * Math.sqrt(5);
}



function dailyStackedNow(data) {
  if (data.length < 75) return { stacked: false, m5: 0, m25: 0, m75: 0 };
  const m5 = sma(data, 5),
    m25 = sma(data, 25),
    m75 = sma(data, 75);
  return {
    stacked: m5 > 0 && m25 > 0 && m75 > 0 && m5 > m25 && m25 > m75,
    m5,
    m25,
    m75,
  };
}
  

function buildNoReason(top, list) {
  const head = top.filter(Boolean).join(" | ");
  const uniq = Array.from(new Set(list.filter(Boolean)));
  const bullet = uniq
    .slice(0, 8)
    .map((r) => `- ${r}`)
    .join("\n");
  return [head, bullet].filter(Boolean).join("\n");
}