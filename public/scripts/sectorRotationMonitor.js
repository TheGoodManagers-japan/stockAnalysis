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
  foods: [
    { ticker: "2914", w: 1.85, name: "Japan Tobacco" },
    { ticker: "2802", w: 1.42, name: "Ajinomoto" },
    { ticker: "2502", w: 1.1, name: "Asahi Group Holdings" },
    { ticker: "2503", w: 1.65, name: "Kirin Holdings" },
    { ticker: "2801", w: 1.25, name: "Kikkoman" },
  ],
  energy_resources: [
    { ticker: "1605", w: 1.92, name: "INPEX" },
    { ticker: "5020", w: 1.34, name: "ENEOS Holdings" },
    { ticker: "5019", w: 1.15, name: "Idemitsu Kosan" },
    { ticker: "5021", w: 1.05, name: "Cosmo Energy Holdings" },
    { ticker: "1662", w: 1.78, name: "Japan Petroleum Exploration" },
  ],
  construction_materials: [
    { ticker: "1925", w: 1.45, name: "Daiwa House Industry" },
    { ticker: "1928", w: 1.6, name: "Sekisui House" },
    { ticker: "5201", w: 1.22, name: "AGC" },
    { ticker: "5332", w: 1.88, name: "TOTO" },
    { ticker: "5938", w: 1.12, name: "LIXIL" },
  ],
  raw_materials_chemicals: [
    { ticker: "4063", w: 1.95, name: "Shin-Etsu Chemical" },
    { ticker: "4452", w: 1.3, name: "Kao" },
    { ticker: "8113", w: 1.55, name: "Unicharm" },
    { ticker: "3402", w: 1.18, name: "Toray Industries" },
    { ticker: "6988", w: 1.72, name: "Nitto Denko" },
  ],
  pharmaceutical: [
    { ticker: "4519", w: 1.8, name: "Chugai Pharmaceutical" },
    { ticker: "4568", w: 1.9, name: "Daiichi Sankyo" },
    { ticker: "4502", w: 1.45, name: "Takeda Pharmaceutical" },
    { ticker: "4503", w: 1.15, name: "Astellas Pharma" },
    { ticker: "4578", w: 1.35, name: "Otsuka Holdings" },
  ],
  automobiles_transportation_equipment: [
    { ticker: "7203", w: 1.98, name: "Toyota Motor" },
    { ticker: "7267", w: 1.62, name: "Honda Motor" },
    { ticker: "6902", w: 1.44, name: "DENSO" },
    { ticker: "7269", w: 1.1, name: "Suzuki Motor" },
    { ticker: "5108", w: 1.33, name: "Bridgestone" },
  ],
  steel_nonferrous_metals: [
    { ticker: "5401", w: 1.75, name: "Nippon Steel" },
    { ticker: "5802", w: 1.82, name: "Sumitomo Electric" },
    { ticker: "5411", w: 1.25, name: "JFE Holdings" },
    { ticker: "5713", w: 1.48, name: "Sumitomo Metal Mining" },
    { ticker: "5406", w: 1.05, name: "Kobe Steel" },
  ],
  machinery: [
    { ticker: "7011", w: 1.92, name: "Mitsubishi Heavy Industries" },
    { ticker: "6301", w: 1.65, name: "Komatsu" },
    { ticker: "6367", w: 1.88, name: "Daikin Industries" },
    { ticker: "6273", w: 1.5, name: "SMC" },
    { ticker: "6326", w: 1.2, name: "Kubota" },
  ],
  electric_appliances_precision: [
    { ticker: "6501", w: 1.85, name: "Hitachi" },
    { ticker: "6758", w: 1.78, name: "Sony Group" },
    { ticker: "6861", w: 1.95, name: "Keyence" },
    { ticker: "8035", w: 1.6, name: "Tokyo Electron" },
    { ticker: "7741", w: 1.32, name: "HOYA" },
  ],
  it_services_others: [
    { ticker: "9984", w: 1.68, name: "SoftBank Group" },
    { ticker: "9432", w: 1.55, name: "Nippon Telegraph & Telephone" },
    { ticker: "9433", w: 1.4, name: "KDDI" },
    { ticker: "6098", w: 1.25, name: "Recruit Holdings" },
    { ticker: "7974", w: 1.8, name: "Nintendo" },
  ],
  electric_power_gas: [
    { ticker: "9503", w: 1.55, name: "Kansai Electric Power" },
    { ticker: "9502", w: 1.35, name: "Chubu Electric Power" },
    { ticker: "9531", w: 1.62, name: "Tokyo Gas" },
    { ticker: "9532", w: 1.2, name: "Osaka Gas" },
    { ticker: "9501", w: 1.1, name: "Tokyo Electric Power (TEPCO)" },
  ],
  transportation_logistics: [
    { ticker: "9020", w: 1.75, name: "East Japan Railway" },
    { ticker: "9022", w: 1.68, name: "Central Japan Railway" },
    { ticker: "9101", w: 1.45, name: "NYK Line" },
    { ticker: "9104", w: 1.32, name: "Mitsui O.S.K. Lines" },
    { ticker: "9202", w: 1.15, name: "ANA Holdings" },
  ],
  commercial_wholesale_trade: [
    { ticker: "8058", w: 1.92, name: "Mitsubishi Corporation" },
    { ticker: "8001", w: 1.88, name: "ITOCHU" },
    { ticker: "8031", w: 1.75, name: "Mitsui & Co." },
    { ticker: "8002", w: 1.45, name: "Marubeni" },
    { ticker: "8053", w: 1.35, name: "Sumitomo Corporation" },
  ],
  retail_trade: [
    { ticker: "9983", w: 1.95, name: "Fast Retailing" },
    { ticker: "3382", w: 1.6, name: "Seven & i Holdings" },
    { ticker: "8267", w: 1.42, name: "AEON" },
    { ticker: "7532", w: 1.3, name: "Pan Pacific International" },
    { ticker: "9843", w: 1.15, name: "Nitori Holdings" },
  ],
  banks: [
    { ticker: "8306", w: 1.98, name: "Mitsubishi UFJ Financial Group" },
    { ticker: "8316", w: 1.85, name: "Sumitomo Mitsui Financial Group" },
    { ticker: "8411", w: 1.7, name: "Mizuho Financial Group" },
    { ticker: "7182", w: 1.25, name: "Japan Post Bank" },
    { ticker: "8308", w: 1.1, name: "Resona Holdings" },
  ],
  financials_ex_banks: [
    { ticker: "8766", w: 1.9, name: "Tokio Marine Holdings" },
    { ticker: "8725", w: 1.55, name: "MS&AD Insurance Group" },
    { ticker: "8591", w: 1.65, name: "ORIX" },
    { ticker: "8630", w: 1.45, name: "SOMPO Holdings" },
    { ticker: "8604", w: 1.3, name: "Nomura Holdings" },
  ],
  real_estate: [
    { ticker: "8801", w: 1.82, name: "Mitsui Fudosan" },
    { ticker: "8802", w: 1.75, name: "Mitsubishi Estate" },
    { ticker: "8830", w: 1.4, name: "Sumitomo Realty & Development" },
    { ticker: "1878", w: 1.25, name: "Daito Trust Construction" },
    { ticker: "3231", w: 1.15, name: "Nomura Real Estate Holdings" },
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

/**
 * Normalize tickers for JP equities:
 * - "7203" -> "7203.T"
 * - "7203.T" -> "7203.T"
 * - "7203.X" -> "7203.T" (strip any suffix then .T)
 */
function normalizeTickerJP(input) {
  if (!input) return "";
  const s = String(input).trim().toUpperCase();
  if (s.endsWith(".T")) return s;
  return `${s.replace(/\..*$/, "")}.T`;
}

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

  // ✅ key fix: your API expects ".T"
  ticker = normalizeTickerJP(ticker);

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

  // ✅ handle "success=false" even when HTTP=200
  if (json && typeof json === "object" && json.success === false) {
    throw new Error(json.error || `History API success=false for ${ticker}`);
  }

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

  // ✅ normalize benchmark too (safe)
  benchmarkTicker = normalizeTickerJP(benchmarkTicker);

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
      const ticker = normalizeTickerJP(m.ticker); // ✅ key fix
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
