// dashboard/engine/helpers.js
// Extracted from public/scripts/core/main.js — utility / formatting / ticker helpers
// ESM — no browser globals (IS_BROWSER, window, document)

/* ======================== Formatting ======================== */

export function formatKMB(n) {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
  if (a >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (a >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return String(Math.round(v));
}

export function formatJPYKMB(n) {
  return "\u00a5" + formatKMB(n);
}

/* ======================== Tiny helpers ======================== */

export const isoDay = (d) => new Date(d).toISOString().slice(0, 10);

export function inc(obj, key, by = 1) {
  if (!key && key !== 0) return;
  obj[key] = (obj[key] || 0) + by;
}

export function normalizeReason(reasonRaw) {
  if (!reasonRaw) return "unspecified";
  let r = String(reasonRaw).trim();
  // unify common prefixes and noisy details
  r = r.replace(/^(DIP|SPC|OXR|BPB|RRP)\s+(not ready:|guard veto:)\s*/i, "");
  r = r.replace(/\([^)]*\)/g, ""); // drop parentheticals
  r = r.replace(/\s{2,}/g, " ").trim();
  return r.toLowerCase();
}

/** Coerce to finite number, returning 0 on NaN/Infinity/null/undefined. */
export function num(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

export function toFinite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/* ======================== Logging ======================== */

export function log(...args) {
  console.log("[SCAN]", ...args);
}

export function warn(...args) {
  console.warn("[SCAN]", ...args);
}

export function errorLog(...args) {
  console.error("[SCAN]", ...args);
}

/* ======================== JSON parse ======================== */

export function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

/* ======================== Ticker helpers ======================== */

import { allTickers } from "../data/tickers.js";
import { normalizeTicker } from "../lib/tickers.js";
export { normalizeTicker };

const allByCode = new Map(allTickers.map((t) => [t.code.toUpperCase(), t]));

export function resolveTickers(tickers) {
  if (!Array.isArray(tickers) || tickers.length === 0) {
    log("No tickers passed; scanning default allTickers list");
    return [...allTickers];
  }
  const out = [];
  const seen = new Set();
  for (const raw of tickers) {
    const code = normalizeTicker(raw);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const found = allByCode.get(code);
    out.push(found || { code, sector: "Unknown" });
  }
  log(
    "Resolved tickers:",
    out.map((x) => x.code)
  );
  return out;
}

/* ======================== Tick helpers ======================== */

export function inferTickFromPrice(p) {
  if (p >= 5000) return 1;
  if (p >= 1000) return 0.5;
  if (p >= 100) return 0.1;
  if (p >= 10) return 0.05;
  return 0.01;
}

export function toTick(v, priceRefOrStock) {
  const p =
    typeof priceRefOrStock === "number"
      ? priceRefOrStock
      : Number(priceRefOrStock?.currentPrice) || Number(v) || 0;
  const tick =
    Number(priceRefOrStock?.tickSize) || inferTickFromPrice(p) || 0.1;
  const q = Math.round((Number(v) || 0) / tick);
  return Number((q * tick).toFixed(6));
}

/* ======================== Swing low helpers ======================== */

/** Lowest swing low pivot within lookback window. Returns NaN if none found. */
export function lastSwingLowMin(data, lookback = 12) {
  if (!Array.isArray(data)) return NaN;
  const w = data.slice(-lookback);
  let low = Infinity;
  for (let i = 2; i < w.length - 2; i++) {
    const L = num(w[i]?.low ?? 0);
    const Lp = num(w[i - 1]?.low ?? 0);
    const Ln = num(w[i + 1]?.low ?? 0);
    if (L < Lp && L < Ln) low = Math.min(low, L);
  }
  return isFinite(low) ? low : NaN;
}

/** Most recent swing low pivot (scanning backwards). Returns fallback if none found. */
export function lastSwingLowRecent(data, lookback = 40) {
  if (!Array.isArray(data) || data.length < 5) return 0;
  const w = data.slice(-lookback);
  for (let i = w.length - 3; i >= 2; i--) {
    const l = Number(w[i]?.low ?? w[i]?.close ?? 0);
    const l0 = Number(w[i - 1]?.low ?? w[i - 1]?.close ?? 0);
    const l1 = Number(w[i + 1]?.low ?? w[i + 1]?.close ?? 0);
    if (l < l0 && l < l1) return l;
  }
  return Number(w.at(-1)?.low ?? w.at(-1)?.close ?? 0);
}

/* ======================== Entry kind extraction ======================== */

export function extractEntryKindFromReason(reason = "") {
  const head = String(reason).toUpperCase();
  if (head.startsWith("DIP")) return "DIP";
  if (head.startsWith("RETEST")) return "RETEST";
  if (head.startsWith("MA25 RECLAIM")) return "RECLAIM";
  if (head.startsWith("INSIDE")) return "INSIDE";
  if (head.startsWith("BREAKOUT")) return "BREAKOUT";
  return ""; // unknown/neutral
}
