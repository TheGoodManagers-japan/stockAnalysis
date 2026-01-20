/**
 * sectorRotationMonitor.js
 *
 * Tactical JP Sector Rotation (Swing-trading aligned)
 * - Weighted bellwethers + optional liquidity weighting (advWeightPower)
 * - Swing lookbacks: 5/10/20 (plus 60/200 for regime context)
 * - Linear-regression swing slope (log-price)
 * - Breadth is Equal-Weighted by default (participation), with Weighted breadth kept as a diagnostic
 * - Concurrency-limited fetching + per-ticker error isolation
 * - Heatmap output for UI + sector leaders list
 *
 * REQUIREMENTS
 * - You must have a working `fetch` (browser or Node 18+)
 * - Your history API must return an array of bars. This file expects:
 *   [{ date, close, volume }] but will try to map common variants.
 *
 * DEFAULT HISTORY ENDPOINT
 * - /api/history?ticker=7203.T&years=3
 *   If yours differs, change `historyEndpoint` / `historyTickerParam` / `historyYearsParam` below.
 */

// ------------------------------
// Default JP sector pools + bellwether weights
// ------------------------------
// You can replace this with your own exact pools.
// Format: { [sectorId]: [ { ticker, w?, name? }, ... ] }


const DEFAULT_API_BASE =
  typeof window !== "undefined"
    ? "https://stock-analysis-chi.vercel.app"
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "https://stock-analysis-chi.vercel.app";

export const sectorPoolsJP = {
  Autos: [
    { ticker: "7203.T", w: 1.4, name: "Toyota" },
    { ticker: "7267.T", w: 1.2, name: "Honda" },
    { ticker: "7269.T", w: 1.1, name: "Suzuki" },
    { ticker: "7270.T", w: 1.05, name: "Subaru" },
    { ticker: "7261.T", w: 1.0, name: "Mazda" },
  ],
  Tech_Semis: [
    { ticker: "8035.T", w: 1.35, name: "Tokyo Electron" },
    { ticker: "6857.T", w: 1.25, name: "Advantest" },
    { ticker: "6861.T", w: 1.25, name: "Keyence" },
    { ticker: "6723.T", w: 1.15, name: "Renesas" },
    { ticker: "4063.T", w: 1.0, name: "Shin-Etsu" },
  ],
  Electronics: [
    { ticker: "6758.T", w: 1.35, name: "Sony" },
    { ticker: "6501.T", w: 1.15, name: "Hitachi" },
    { ticker: "6702.T", w: 1.05, name: "Fujitsu" },
    { ticker: "6762.T", w: 1.05, name: "TDK" },
    { ticker: "6752.T", w: 1.0, name: "Panasonic" },
  ],
  Banks: [
    { ticker: "8306.T", w: 1.35, name: "MUFG" },
    { ticker: "8316.T", w: 1.2, name: "SMFG" },
    { ticker: "8411.T", w: 1.15, name: "Mizuho" },
    { ticker: "7182.T", w: 1.05, name: "Japan Post Bank" },
    { ticker: "8308.T", w: 1.0, name: "Resona" },
  ],
  Trading_Cos: [
    { ticker: "8058.T", w: 1.25, name: "Mitsubishi Corp" },
    { ticker: "8001.T", w: 1.2, name: "Itochu" },
    { ticker: "8031.T", w: 1.15, name: "Mitsui" },
    { ticker: "8053.T", w: 1.1, name: "Sumitomo Corp" },
    { ticker: "2768.T", w: 1.0, name: "Sojitz" },
  ],
  Telecom: [
    { ticker: "9432.T", w: 1.2, name: "NTT" },
    { ticker: "9433.T", w: 1.15, name: "KDDI" },
    { ticker: "9984.T", w: 1.15, name: "SoftBank Group" },
    { ticker: "4689.T", w: 1.05, name: "Z Holdings/LY" },
    { ticker: "9613.T", w: 1.0, name: "NTT Data" },
  ],
  Retail_Consumer: [
    { ticker: "9983.T", w: 1.35, name: "Fast Retailing" },
    { ticker: "8267.T", w: 1.1, name: "Aeon" },
    { ticker: "7453.T", w: 1.05, name: "Ryohin Keikaku" },
    { ticker: "3086.T", w: 1.0, name: "J Front Retailing" },
    { ticker: "3092.T", w: 1.0, name: "ZOZO" },
  ],
  Industrials: [
    { ticker: "7011.T", w: 1.15, name: "MHI" },
    { ticker: "7012.T", w: 1.05, name: "Kawasaki Heavy" },
    { ticker: "6301.T", w: 1.05, name: "Komatsu" },
    { ticker: "6326.T", w: 1.0, name: "Kubota" },
    { ticker: "6367.T", w: 1.0, name: "Daikin" },
  ],
  Real_Estate: [
    { ticker: "8801.T", w: 1.15, name: "Mitsui Fudosan" },
    { ticker: "8802.T", w: 1.1, name: "Mitsubishi Estate" },
    { ticker: "3289.T", w: 1.0, name: "Tokyu Fudosan" },
    { ticker: "8830.T", w: 1.0, name: "Sumitomo Realty" },
    { ticker: "8804.T", w: 1.0, name: "Tokyo Tatemono" },
  ],
  Pharma_Health: [
    { ticker: "4502.T", w: 1.2, name: "Takeda" },
    { ticker: "4519.T", w: 1.1, name: "Chugai" },
    { ticker: "4507.T", w: 1.05, name: "Shionogi" },
    { ticker: "4568.T", w: 1.0, name: "Daiichi Sankyo" },
    { ticker: "4523.T", w: 1.0, name: "Eisai" },
  ],
};

// ------------------------------
// Math helpers
// ------------------------------
function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function sum(arr) {
  let s = 0;
  for (const v of arr) {
    const n = safeNum(v);
    if (n !== null) s += n;
  }
  return s;
}

function mean(arr) {
  let s = 0;
  let c = 0;
  for (const v of arr) {
    const n = safeNum(v);
    if (n !== null) {
      s += n;
      c++;
    }
  }
  return c ? s / c : null;
}

function weightedMean(values, weights) {
  let ws = 0;
  let vs = 0;
  for (let i = 0; i < values.length; i++) {
    const v = safeNum(values[i]);
    const w = safeNum(weights[i]);
    if (v === null || w === null) continue;
    vs += v * w;
    ws += w;
  }
  return ws ? vs / ws : null;
}

function sma(closes, period) {
  if (!Array.isArray(closes) || closes.length < period) return null;
  const slice = closes.slice(-period);
  return mean(slice);
}

function retOver(closes, bars) {
  if (!Array.isArray(closes) || closes.length < bars + 1) return null;
  const a = safeNum(closes[closes.length - 1]);
  const b = safeNum(closes[closes.length - 1 - bars]);
  if (a === null || b === null || b === 0) return null;
  return a / b - 1;
}

/**
 * Linear regression slope on ln(price) across last N bars
 * Returns per-bar fractional change (e.g., 0.001 = +0.1% per bar)
 */
function lrSlopeLogPctPerBar(closes, bars = 8) {
  if (!Array.isArray(closes) || closes.length < bars) return null;

  const ys = closes
    .slice(-bars)
    .map((p) => (Number(p) > 0 ? Math.log(Number(p)) : null));

  if (ys.some((y) => y === null)) return null;

  const n = bars;
  let sumX = 0,
    sumY = 0,
    sumXX = 0,
    sumXY = 0;

  for (let i = 0; i < n; i++) {
    const x = i;
    const y = ys[i];
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
  }

  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;

  const slope = (n * sumXY - sumX * sumY) / denom; // ln(price) per bar
  return Math.expm1(slope); // fractional change per bar
}

// ------------------------------
// Concurrency helper (mapLimit)
// ------------------------------
async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let i = 0;
  let active = 0;

  return new Promise((resolve) => {
    const launchNext = () => {
      if (i >= items.length && active === 0) return resolve(results);

      while (active < limit && i < items.length) {
        const idx = i++;
        active++;

        Promise.resolve()
          .then(() => mapper(items[idx], idx))
          .then((res) => {
            results[idx] = res;
          })
          .catch((err) => {
            results[idx] = { __error: String(err?.message || err) };
          })
          .finally(() => {
            active--;
            launchNext();
          });
      }
    };

    launchNext();
  });
}

// ------------------------------
// History fetch + normalization
// ------------------------------
const __historyCache = new Map();

function normalizeBars(rawBars) {
  if (!Array.isArray(rawBars)) return [];

  // Try to map common field variants into { date, close, volume }
  return rawBars
    .map((b) => {
      const date =
        b?.date instanceof Date
          ? b.date
          : b?.date
            ? new Date(b.date)
            : b?.timestamp
              ? new Date(b.timestamp)
              : b?.time
                ? new Date(b.time)
                : null;

      const close =
        safeNum(b?.close) ??
        safeNum(b?.adjClose) ??
        safeNum(b?.price) ??
        safeNum(b?.c) ??
        null;

      const volume = safeNum(b?.volume) ?? safeNum(b?.v) ?? 0;

      return date && close !== null ? { date, close, volume } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.date - b.date);
}

async function fetchHistoricalData(
  ticker,
  {
    years = 3,
    historyEndpoint = `${DEFAULT_API_BASE}/api/history`,
    historyTickerParam = "ticker",
    historyYearsParam = "years",
    fetchFn = globalThis.fetch,
    useCache = true,
  } = {},
) {
  if (!fetchFn) throw new Error("No fetch function available.");

  const key = `${historyEndpoint}::${ticker}::${years}`;
  if (useCache && __historyCache.has(key)) return __historyCache.get(key);

  const url = historyEndpoint.startsWith("http")
    ? new URL(historyEndpoint)
    : new URL(
        historyEndpoint,
        typeof window !== "undefined"
          ? window.location.origin
          : "http://localhost",
      );

  url.searchParams.set(historyTickerParam, ticker);
  url.searchParams.set(historyYearsParam, String(years));

  const res = await fetchFn(url.toString());
  if (!res.ok)
    throw new Error(`History fetch failed for ${ticker}: ${res.status}`);

  const json = await res.json();

  // Common shapes:
  // - { data: [...] }
  // - { bars: [...] }
  // - [...]
  const rawBars = Array.isArray(json) ? json : (json?.data ?? json?.bars ?? []);
  const bars = normalizeBars(rawBars);

  if (useCache) __historyCache.set(key, bars);
  return bars;
}

// ------------------------------
// Snapshot computation
// ------------------------------
function computeTickerSnapshot(
  ticker,
  bars,
  { lookbacks, swingBars, poolWeight = 1 } = {},
) {
  const closes = bars.map((b) => b.close);
  const vols = bars.map((b) => b.volume);

  const lastClose = closes.length ? safeNum(closes[closes.length - 1]) : null;
  if (lastClose === null) return { ticker, __error: "No valid close" };

  const snap = {
    ticker,
    asOf: bars[bars.length - 1]?.date?.toISOString?.() || null,
    close: lastClose,
    poolWeight,
    // Liquidity proxy: 20-day average volume * price
    adv20Value: null,
    pxSlopeSwing: lrSlopeLogPctPerBar(closes, swingBars),
    aboveMA20: null,
    aboveMA50: null,
    aboveMA200: null,
  };

  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, 200);

  snap.aboveMA20 = ma20 === null ? null : lastClose > ma20;
  snap.aboveMA50 = ma50 === null ? null : lastClose > ma50;
  snap.aboveMA200 = ma200 === null ? null : lastClose > ma200;

  // ADV (value traded) ~ mean(volume * close) last 20 bars
  if (vols.length >= 20) {
    const v = vols.slice(-20);
    const c = closes.slice(-20);
    const advArr = v.map((vv, i) => {
      const vvN = safeNum(vv);
      const ccN = safeNum(c[i]);
      if (vvN === null || ccN === null) return null;
      return vvN * ccN;
    });
    snap.adv20Value = mean(advArr);
  }

  // Returns for lookbacks
  for (const lb of lookbacks) {
    snap[`ret${lb}`] = retOver(closes, lb);
  }

  return snap;
}

// ------------------------------
// Sector aggregation
// ------------------------------
function buildMemberWeights(
  snaps,
  { weightMode = "auto", advWeightPower = 0.5 } = {},
) {
  // weightMode:
  // - "equal": all 1
  // - "pool": use poolWeight only
  // - "liquidity": use adv20Value^advWeightPower only
  // - "auto": poolWeight * (adv20Value^advWeightPower)
  const mode = String(weightMode || "auto").toLowerCase();

  return snaps.map((s) => {
    const pw = safeNum(s.poolWeight) ?? 1;
    const adv = safeNum(s.adv20Value) ?? null;
    const advFactor =
      adv === null ? 1 : Math.pow(Math.max(adv, 1), advWeightPower);

    if (mode === "equal") return 1;
    if (mode === "pool") return pw;
    if (mode === "liquidity") return advFactor;
    // auto
    return pw * advFactor;
  });
}

function computeSectorAggregates(sectorId, memberSnaps, opts = {}) {
  const ok = memberSnaps.filter((s) => s && !s.__error);
  const errors = memberSnaps.filter((s) => s && s.__error);

  const weights = buildMemberWeights(ok, opts);

  const agg = {
    sector: sectorId,
    n: ok.length,
    nError: errors.length,
    tickers: ok.map((s) => s.ticker),

    // Weighted returns
    ret5: weightedMean(
      ok.map((s) => s.ret5),
      weights,
    ),
    ret10: weightedMean(
      ok.map((s) => s.ret10),
      weights,
    ),
    ret20: weightedMean(
      ok.map((s) => s.ret20),
      weights,
    ),
    ret60: weightedMean(
      ok.map((s) => s.ret60),
      weights,
    ),
    ret200: weightedMean(
      ok.map((s) => s.ret200),
      weights,
    ),

    // Weighted swing slope
    pxSlopeSwing: weightedMean(
      ok.map((s) => s.pxSlopeSwing),
      weights,
    ),

    // Breadth (equal-weight participation)
    breadth20EW: null,
    breadth50EW: null,
    breadth200EW: null,

    // Breadth (weighted diagnostic)
    breadth20W: null,
    breadth50W: null,
    breadth200W: null,
  };

  // Equal-weight breadth (participation)
  const b20Arr = ok.map((s) =>
    s.aboveMA20 === null ? null : s.aboveMA20 ? 1 : 0,
  );
  const b50Arr = ok.map((s) =>
    s.aboveMA50 === null ? null : s.aboveMA50 ? 1 : 0,
  );
  const b200Arr = ok.map((s) =>
    s.aboveMA200 === null ? null : s.aboveMA200 ? 1 : 0,
  );

  agg.breadth20EW = mean(b20Arr);
  agg.breadth50EW = mean(b50Arr);
  agg.breadth200EW = mean(b200Arr);

  // Weighted breadth (diagnostic)
  agg.breadth20W = weightedMean(b20Arr, weights);
  agg.breadth50W = weightedMean(b50Arr, weights);
  agg.breadth200W = weightedMean(b200Arr, weights);

  return { agg, errors };
}

function pickBreadth(sectorAgg, mode = "equal") {
  const m = String(mode || "equal").toLowerCase();
  if (m === "weighted") {
    return {
      b20: sectorAgg.breadth20W ?? sectorAgg.breadth20EW ?? 0.5,
      b50: sectorAgg.breadth50W ?? sectorAgg.breadth50EW ?? 0.5,
      b200: sectorAgg.breadth200W ?? sectorAgg.breadth200EW ?? 0.5,
    };
  }
  return {
    b20: sectorAgg.breadth20EW ?? 0.5,
    b50: sectorAgg.breadth50EW ?? 0.5,
    b200: sectorAgg.breadth200EW ?? 0.5,
  };
}

// ------------------------------
// Scoring (0..100)
// ------------------------------
function scoreSector(sectorAgg, benchSnap, { breadthMode = "equal" } = {}) {
  const { b20, b50, b200 } = pickBreadth(sectorAgg, breadthMode);

  const rs5 = (sectorAgg.ret5 ?? 0) - (benchSnap.ret5 ?? 0);
  const rs10 = (sectorAgg.ret10 ?? 0) - (benchSnap.ret10 ?? 0);
  const rs20 = (sectorAgg.ret20 ?? 0) - (benchSnap.ret20 ?? 0);
  const rs60 = (sectorAgg.ret60 ?? 0) - (benchSnap.ret60 ?? 0);

  const accelSwing = rs5 - rs20;

  // Momentum blend (swing-aligned)
  const mom = 0.45 * rs5 + 0.35 * rs10 + 0.2 * rs20;

  // Convert to a bounded score. Returns are fractional, e.g. 0.03 = +3%
  // Tuned for JP daily volatility: keep it stable and not overly jumpy.
  const momPts = clamp(mom * 900, -35, 35); // 0.04 => +36 pts (capped)
  const accelPts = clamp(accelSwing * 700, -25, 25);
  const breadthPts = clamp((b20 - 0.5) * 60, -18, 18);
  const slopePts = clamp((sectorAgg.pxSlopeSwing ?? 0) * 1200, -18, 18);
  const regimePts = clamp(rs60 * 300, -10, 10); // small influence

  const raw = 50 + momPts + accelPts + breadthPts + slopePts + regimePts;
  const score = clamp(raw, 0, 100);

  return {
    score,
    rs5,
    rs10,
    rs20,
    rs60,
    accelSwing,
    breadth20: b20,
    breadth50: b50,
    breadth200: b200,
  };
}

// ------------------------------
// Main entry
// ------------------------------
export async function analyzeSectorRotation({
  // Data / benchmark
  benchmarkTicker = "1306.T",

  // History fetch config
  years = 3,
  historyEndpoint = `${DEFAULT_API_BASE}/api/history`,
  historyTickerParam = "ticker",
  historyYearsParam = "years",
  fetchFn = globalThis.fetch,
  useCache = true,

  // Performance
  concurrency = 6,

  // Swing logic
  lookbacks = [5, 10, 20, 60, 200],
  swingBars = 8,

  // Weighting
  weightMode = "auto", // "auto" | "pool" | "equal" | "liquidity"
  advWeightPower = 0.5, // sqrt by default
  breadthMode = "equal", // "equal" (recommended) | "weighted"

  // Pools
  pools = sectorPoolsJP,
} = {}) {
  if (!fetchFn) throw new Error("No fetch function available.");

  // 1) Benchmark snapshot
  const benchBars = await fetchHistoricalData(benchmarkTicker, {
    years,
    historyEndpoint,
    historyTickerParam,
    historyYearsParam,
    fetchFn,
    useCache,
  });

  const benchSnap = computeTickerSnapshot(benchmarkTicker, benchBars, {
    lookbacks,
    swingBars,
    poolWeight: 1,
  });

  if (benchSnap.__error) {
    throw new Error(`Benchmark snapshot failed: ${benchSnap.__error}`);
  }

  // 2) Per-sector analysis
  const sectorIds = Object.keys(pools);
  const sectorResults = [];
  const errorSummary = [];

  for (const sectorId of sectorIds) {
    const members = pools[sectorId] || [];
    if (!members.length) continue;

    const snaps = await mapLimit(members, concurrency, async (m) => {
      const ticker = m.ticker;
      const poolWeight = safeNum(m.w) ?? 1;

      try {
        const bars = await fetchHistoricalData(ticker, {
          years,
          historyEndpoint,
          historyTickerParam,
          historyYearsParam,
          fetchFn,
          useCache,
        });

        const snap = computeTickerSnapshot(ticker, bars, {
          lookbacks,
          swingBars,
          poolWeight,
        });

        snap.name = m.name || "";
        return snap;
      } catch (err) {
        return { ticker, poolWeight, __error: String(err?.message || err) };
      }
    });

    // Leaders: top 5 by RS10
    const okMembers = snaps.filter((s) => s && !s.__error);
    const leaders = okMembers
      .map((s) => {
        const rs10 = (s.ret10 ?? 0) - (benchSnap.ret10 ?? 0);
        return {
          ticker: s.ticker,
          name: s.name || "",
          w: s.poolWeight ?? 1,
          ret10: s.ret10 ?? null,
          rs10,
        };
      })
      .sort((a, b) => (b.rs10 ?? -1e9) - (a.rs10 ?? -1e9))
      .slice(0, 5);

    const { agg, errors } = computeSectorAggregates(sectorId, snaps, {
      weightMode,
      advWeightPower,
    });
    const scored = scoreSector(agg, benchSnap, { breadthMode });

    if (errors.length) {
      errorSummary.push({
        sector: sectorId,
        errors: errors
          .map((e) => ({ ticker: e.ticker, error: e.__error }))
          .slice(0, 10),
      });
    }

    sectorResults.push({
      ...agg,
      ...scored,
      leaders,
    });
  }

  // 3) Rank + group
  const ranked = sectorResults
    .slice()
    .sort((a, b) => (b.score ?? -1e9) - (a.score ?? -1e9));

  const recommended = ranked.filter((s) => (s.score ?? 0) >= 70);
  const avoid = ranked.filter((s) => (s.score ?? 0) <= 35);

  // “Shifts” = accelerating sectors near the top that are improving NOW
  const shifts = ranked
    .filter((s) => (s.accelSwing ?? 0) > 0 && (s.score ?? 0) >= 55)
    .slice(0, 6)
    .map((s) => ({
      sector: s.sector,
      score: s.score,
      accelSwing: s.accelSwing,
      rs5: s.rs5,
      rs20: s.rs20,
      participation: s.breadth20EW ?? null,
    }));

  // 4) Summary + heatmap
  const top = ranked[0] || null;
  const summary = {
    benchmark: {
      ticker: benchmarkTicker,
      asOf: benchSnap.asOf,
      ret5: benchSnap.ret5,
      ret10: benchSnap.ret10,
      ret20: benchSnap.ret20,
    },
    topSector: top
      ? {
          sector: top.sector,
          score: top.score,
          accelSwing: top.accelSwing,
          rs10: top.rs10,
          breadth20EW: top.breadth20EW,
          leaders: top.leaders?.slice(0, 3) || [],
        }
      : null,
    counts: {
      sectors: ranked.length,
      recommended: recommended.length,
      avoid: avoid.length,
    },
  };

  const heatmap = ranked.map((s) => {
    const bEW = s.breadth20EW ?? 0.5;
    const bW = s.breadth20W ?? bEW;
    const concentration = bW - bEW; // >0 tends to indicate “top-heavy” (leaders lifting weighted breadth)

    return {
      id: s.sector,
      label: s.sector.replace(/_/g, " "),
      score: s.score,
      momentum: (s.accelSwing ?? 0) > 0 ? "Accelerating" : "Decelerating",
      participation: bEW, // 0..1
      concentration,
      bellwetherHealth:
        (s.score ?? 0) >= 70 && bEW < 0.45
          ? "Top-Heavy"
          : concentration > 0.12
            ? "Top-Heavy"
            : "Broad",
      leaders: (s.leaders || []).slice(0, 3),
    };
  });

  return {
    asOf: benchSnap.asOf,
    benchmarkTicker,
    ranked,
    recommended,
    avoid,
    shifts,
    summary,
    heatmap,
    debug: {
      errorSummary,
      settings: {
        years,
        concurrency,
        lookbacks,
        swingBars,
        weightMode,
        advWeightPower,
        breadthMode,
        historyEndpoint,
        historyTickerParam,
        historyYearsParam,
      },
    },
  };
}
