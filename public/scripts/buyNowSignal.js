export function getBuyTrigger(stock, historicalData, entryAnalysis = null) {
  const config = defaultConfig;

  if (!historicalData || historicalData.length < 50) {
    return {
      isBuyNow: false,
      reason: "Insufficient historical data for a reliable analysis.",
      rr: null,
    };
  }

  const today = historicalData[historicalData.length - 1];
  const yesterday = historicalData[historicalData.length - 2];

  // --- NEW: compute rr from entryAnalysis levels (no re-analysis, no returning them)
  const price = Number(stock?.currentPrice) || today.close;
  const haveSL = Number.isFinite(entryAnalysis?.stopLoss);
  const havePT = Number.isFinite(entryAnalysis?.priceTarget);
  const rr =
    haveSL && havePT
      ? (entryAnalysis.priceTarget - price) /
        Math.max(1e-6, price - entryAnalysis.stopLoss)
      : null;

  // Robust volume averages (exclude "today")
  const avgVolume10 = rollingAvgVolume(historicalData, 10);
  const avgVolume20 = rollingAvgVolume(historicalData, 20);
  const avgVolume50 = rollingAvgVolume(historicalData, 50);

  const context = {
    today,
    yesterday,
    avgVolume10,
    avgVolume20,
    avgVolume50,
    historicalData,
    stock,
    entryAnalysis,
    atr14: Number(stock?.atr14) || calcATR14(historicalData),
    recentPerformance: calculateRecentPerformance(historicalData),
    marketStructure: analyzeMarketStructure(stock, historicalData),
  };

  context.keyLevels = calculateKeyLevels(stock, historicalData);

  // --- existing signal checks
  const signalChecks = [
    checkTrendReversal,
    checkResistanceBreak,
    checkVolatilitySqueeze,
    checkEnhancedPullbackEntry,
    checkBullishEngulfing,
    checkHammerCandle,
    checkConsolidationBreakout,
    checkConfirmedBounce,
    checkEntryTimingScore,
  ];

  // detect
  const detectedSignals = signalChecks
    .map((fn) => fn(stock, context, config))
    .filter((s) => s && s.detected)
    .map((s) => ({
      ...s,
      __cat: categorizeSignalName(s.name), // tag category for dedupe
    }));

  // --- DEDUPLICATION: down-weight overlaps vs entryAnalysis + cap per-category stacking
  const dedupedSignals = applyDedupe(detectedSignals, entryAnalysis);

  const totalScore = dedupedSignals.reduce((sum, s) => sum + s.score, 0);

  // --- veto checks (unchanged)
  const vetoChecks = [
    checkRsiOverbought,
    checkCatastrophicDrop,
    checkSupportBreak,
    checkMajorResistance,
    checkChoppyRegime,
    checkParabolicMove,
    checkExhaustedTrend,
    checkFalseBreakout,
    checkWeakBounce,
  ];

  const vetoResults = vetoChecks
    .map((fn) => fn(stock, context, config))
    .filter((v) => v.isVetoed);

  if (vetoResults.length > 0) {
    const signalText = dedupedSignals.length
      ? `Patterns found (${dedupedSignals
          .map((s) => s.name)
          .join(" | ")}), but signal`
      : "Signal";
    return {
      isBuyNow: false,
      reason: `${signalText} vetoed: ${vetoResults
        .map((v) => v.reason)
        .join(" & ")}`,
      rr,
    };
  }

  // --- OPTIONAL: R:R gate using entryAnalysis levels (do NOT return levels)
  const minRR = 2.0;
  if (rr != null && rr < minRR) {
    return {
      isBuyNow: false,
      reason: `R:R ${rr.toFixed(2)} < ${minRR.toFixed(1)}: not attractive`,
      rr,
    };
  }

  if (totalScore >= config.buyThreshold) {
    const insight = entryAnalysis?.keyInsights?.[0]
      ? ` | ${entryAnalysis.keyInsights[0]}`
      : "";
    return {
      isBuyNow: true,
      reason: `Buy Trigger (${totalScore.toFixed(1)} pts): ${dedupedSignals
        .map((s) => s.name)
        .join(" | ")}${insight}`,
      rr,
    };
  }

  return {
    isBuyNow: false,
    reason: `No trigger: Score ${totalScore.toFixed(1)} < threshold ${
      config.buyThreshold
    }.`,
    rr,
  };
}

/* -------------------- DEDUPE HELPERS -------------------- */

// Map names → categories so we can weight & cap per category
function categorizeSignalName(name = "") {
  const n = String(name).toLowerCase();
  if (n.includes("entry score")) return "entry";
  if (n.includes("trend reversal")) return "trend";
  if (n.includes("squeeze")) return "trend";
  if (n.includes("consolidation breakout")) return "trend";
  if (
    n.startsWith("broke resistance") ||
    n.includes("retest") ||
    n.includes("bounce")
  )
    return "level";
  if (n.includes("pullback")) return "pullback";
  if (n.includes("engulfing") || n.includes("hammer")) return "candlestick";
  return "other";
}

// Build per-category weights based on entryAnalysis strength
function buildDedupeWeights(entryAnalysis) {
  // defaults: no down-weight
  const w = {
    trend: 1,
    level: 1,
    pullback: 1,
    candlestick: 1,
    entry: 1,
    other: 1,
  };

  if (!entryAnalysis || !Number.isFinite(entryAnalysis.score)) return w;

  const score = entryAnalysis.score; // 1..7 (1 best)
  const conf = Math.max(0, Math.min(1, entryAnalysis.confidence ?? 0.5));
  const lerp = (a, b, t) => a + (b - a) * t; // helper

  if (score <= 2) {
    // EntryTiming already strong → down-weight overlapping confirmations
    w.trend = lerp(0.6, 0.4, conf);
    w.level = lerp(0.7, 0.5, conf);
    w.pullback = lerp(0.7, 0.5, conf);
    w.candlestick = lerp(0.5, 0.3, conf);
    // keep entry = 1
  } else if (score === 3) {
    w.trend = 0.85;
    w.level = 0.85;
    w.pullback = 0.85;
    w.candlestick = 0.6;
  } else if (score === 4) {
    w.trend = 0.95;
    w.level = 0.95;
    w.pullback = 0.95;
    w.candlestick = 0.7;
  }
  // score >=5 → no deduction (entryTiming not favorable anyway)
  return w;
}

// Cap how much a single category can contribute (prevents stacking many similar signals)
function categoryCaps() {
  return {
    entry: Infinity, // prefer EntryTiming to stand on its own
    trend: 4.5,
    level: 4.0,
    pullback: 3.0,
    candlestick: 2.5,
    other: 3.0,
  };
}

function applyDedupe(signals, entryAnalysis) {
  if (!signals?.length) return [];

  const weights = buildDedupeWeights(entryAnalysis);
  const caps = categoryCaps();

  // 1) apply weights
  const weighted = signals.map((s) => {
    const cat = s.__cat || "other";
    const w = weights[cat] ?? 1;
    return { ...s, score: s.score * w };
  });

  // 2) per-category proportional cap
  const byCat = weighted.reduce((m, s) => {
    (m[s.__cat || "other"] ||= []).push(s);
    return m;
  }, {});

  const adjusted = [];
  for (const [cat, arr] of Object.entries(byCat)) {
    const cap = caps[cat] ?? 3.0;
    const sum = arr.reduce((a, b) => a + b.score, 0);
    if (sum > cap && cap !== Infinity) {
      const scale = cap / sum;
      arr.forEach((s) => adjusted.push({ ...s, score: s.score * scale }));
    } else {
      adjusted.push(...arr);
    }
  }

  // Clean up helper field
  return adjusted.map(({ __cat, ...rest }) => rest);
}
