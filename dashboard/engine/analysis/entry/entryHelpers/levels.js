// entryHelpers/levels.js — support/resistance finders and market structure

import { sma, calculateATR as calcATRLike } from "../../../indicators.js";
import { num, inferTickFromPrice } from "./core.js";
import { avg } from "./core.js";

/* ============================ Level Finders ============================ */
export function clusterLevels(levels, atrVal, thMul = 0.3) {
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

export function findResistancesAbove(data, px, stock, cfg) {
  const lookback = Math.max(10, Number(cfg?.resistanceLookbackBars) || 40);
  const win = data.slice(-lookback);
  const ups = [];
  for (let i = 2; i < win.length - 2; i++) {
    const h = num(win[i].high);
    if (h > px && h > num(win[i - 1].high) && h > num(win[i + 1].high))
      ups.push(h);
  }

  if (cfg?.include52wAsResistance) {
    const yHigh = num(stock.fiftyTwoWeekHigh);
    if (yHigh > px) ups.push(yHigh);
  }

  const atr = Math.max(num(stock.atr14), px * 0.005, 1e-9);
  return clusterLevels(ups, atr, 0.3);
}

export function findSupportsBelow(data, px, stock) {
  const downs = [];
  const win = data.slice(-60);
  for (let i = 2; i < win.length - 2; i++) {
    const l = num(win[i].low);
    if (l < px && l < num(win[i - 1].low) && l < num(win[i + 1].low))
      downs.push(l);
  }
  const atr = Math.max(num(stock?.atr14), px * 0.005, 1e-9);
  return clusterLevels(downs, atr, 0.3).sort((a, b) => b - a);
}

/* ============================ Market Structure ============================ */
export function getMarketStructure(stock, data) {
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

  return { trend, recentHigh, recentLow, ...m };
}

export function computeMarketContext(market, cfg) {
  const levels = Array.isArray(market?.dataForLevels)
    ? market.dataForLevels
    : null;
  const gates = Array.isArray(market?.dataForGates)
    ? market.dataForGates
    : null;
  if (!levels?.length || !gates?.length) return null;

  const series = cfg.marketUseTodayIfPresent ? levels : gates;
  if (series.length < 20) return null;

  const last = series.at(-1);
  const o = Number(last?.open);
  const c = Number(last?.close);
  if (!(Number.isFinite(o) && Number.isFinite(c) && o > 0)) return null;

  const dayPct = ((c - o) / o) * 100;
  const atr = calcATRLike(gates, 14);
  const moveATR = atr > 0 ? (c - o) / atr : 0;

  const impulse =
    dayPct >= (cfg.marketImpulseVetoPct ?? 1.8) ||
    moveATR >= (cfg.marketImpulseVetoATR ?? 1.0);

  return {
    ticker: market?.ticker || "MARKET",
    dayPct,
    atr,
    moveATR,
    impulse,
    lastDate: last?.date,
  };
}

/* ============================ Liquidity ============================ */
export function assessLiquidity(data, stock, cfg) {
  const n = Math.min(data.length, cfg.liqLookbackDays || 20);
  if (!n || n < 5) {
    const metrics = { n };
    return {
      pass: false,
      why: `Not enough bars for liquidity window (${n})`,
      metrics,
    };
  }
  const win = data.slice(-n);

  const adv = avg(
    win.map((b) => (Number(b.close) || 0) * Math.max(0, Number(b.volume) || 0))
  );
  const avVol = avg(win.map((b) => Math.max(0, Number(b.volume) || 0)));
  const px = Number.isFinite(stock.currentPrice)
    ? stock.currentPrice
    : Number(win.at(-1)?.close) || 0;

  const tick = Number(stock?.tickSize) || inferTickFromPrice(px || 0) || 0.1;
  const atr = Math.max(Number(stock.atr14) || 0, 1e-6);
  const atrTicks = atr / Math.max(tick, 1e-9);

  const metrics = { adv, avVol, px, atr, tick, atrTicks, n };
  const thresholds = {
    minADVNotional: cfg.minADVNotional ?? 0,
    minAvgVolume: cfg.minAvgVolume ?? 0,
    minClosePrice: cfg.minClosePrice ?? 0,
    minATRTicks: cfg.minATRTicks ?? 0,
  };

  const nearMargin = cfg.liqNearMargin ?? 0.15;
  const ratios = {
    advR: thresholds.minADVNotional ? adv / thresholds.minADVNotional : null,
    volR: thresholds.minAvgVolume ? avVol / thresholds.minAvgVolume : null,
    pxR: thresholds.minClosePrice ? px / thresholds.minClosePrice : null,
    atrTicksR: thresholds.minATRTicks
      ? atrTicks / thresholds.minATRTicks
      : null,
  };

  const warnKeys = [];
  for (const [k, r] of Object.entries(ratios)) {
    if (r !== null && Number.isFinite(r) && r <= 1 + nearMargin)
      warnKeys.push(k.replace("R", ""));
  }
  const whyWarn = warnKeys.length
    ? `near threshold: ${warnKeys.join(", ")}`
    : "";

  return { pass: true, why: whyWarn, metrics, thresholds, ratios };
}
