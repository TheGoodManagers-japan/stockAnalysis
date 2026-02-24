// entryHelpers/timeline.js — entry timing, limit orders, and MA cross detectors

import { inferTickFromPrice, toTick } from "./core.js";
import { packLiquidity } from "./telemetry.js";

/* ============================ Entry Helpers ============================ */
export function computeLimitBuyOrder({ ref, atr, stop, stock, cfg }) {
  const tick =
    Number(stock?.tickSize) || inferTickFromPrice(Number(ref) || 0) || 0.1;

  let limit = ref - (cfg.limitBuyDiscountATR ?? 0.15) * atr;

  const minAboveStop = stop + tick;
  if (Number.isFinite(stop)) limit = Math.max(limit, minAboveStop);

  return toTick(limit, { tickSize: tick });
}

export function buildSwingTimeline(entryPx, candidate, rr, ms, cfg) {
  const steps = [];
  const risk = Math.max(0.01, entryPx - Number(candidate.stop));
  const tl = cfg.timeline;

  steps.push({
    when: "T+0",
    condition: "On fill",
    stopLoss: Number(candidate.stop),
    priceTarget: Number(candidate.target),
    note: `${candidate.kind || "ENTRY"}: initial plan`,
  });
  steps.push({
    when: `+${tl.r1}R`,
    condition: `price >= ${entryPx + tl.r1 * risk}`,
    stopLoss: entryPx,
    priceTarget: Number(candidate.target),
    note: "Move stop to breakeven",
  });
  steps.push({
    when: `+${tl.r15}R`,
    condition: `price >= ${entryPx + tl.r15 * risk}`,
    stopLoss: entryPx + tl.lockAtR15 * risk,
    priceTarget: Number(candidate.target),
    note: `Lock ${tl.lockAtR15}R`,
  });
  steps.push({
    when: `+${tl.r2}R`,
    condition: `price >= ${entryPx + tl.r2 * risk}`,
    stopLoss: entryPx + tl.runnerLockAtR2 * risk,
    priceTarget: Number(candidate.target),
    note: `Runner: stop = entry + ${tl.runnerLockAtR2}R`,
  });
  steps.push({
    when: "TRAIL",
    condition: "After +2R",
    stopLossRule: `max( swing low - ${tl.trail.swingLowOffsetATR}*ATR, MA25 - ${tl.trail.ma25OffsetATR}*ATR )`,
    stopLossHint: Math.max(
      ms?.ma25
        ? ms.ma25 - tl.trail.ma25OffsetATR * (Number(rr?.atr) || 0)
        : Number(candidate.stop),
      Number(candidate.stop)
    ),
    priceTarget: Number(candidate.target),
    note: "Trail by structure/MA",
  });
  steps.push({
    when: `T+${cfg.maxHoldingBars} bars`,
    condition: `Exit on close of bar ${cfg.maxHoldingBars}`,
    stopLoss: undefined,
    priceTarget: undefined,
    note: `Time-based exit: force close by bar ${cfg.maxHoldingBars}`,
  });

  return steps;
}

export function noEntry(baseReason, ctx, tele, T, cfg) {
  const reason = baseReason;
  const out = {
    buyNow: false,
    reason,
    timeline: [],
    telemetry: {
      ...tele,
      outcome: { buyNow: false, reason },
      reasons: [reason],
      trace: T.logs,
    },
    liquidity: packLiquidity(tele, cfg),
  };
  return out;
}

export function buildNoReason(top, list) {
  const head = top.filter(Boolean).join(" | ");
  const uniq = Array.from(new Set(list.filter(Boolean)));
  const bullet = uniq
    .slice(0, 8)
    .map((r) => `- ${r}`)
    .join("\n");
  return [head, bullet].filter(Boolean).join("\n");
}

/* ============================ MA Series & Cross Detectors ============================ */
export function maSeries(data, n) {
  const closes = data.map((d) => +d.close || 0);
  const out = new Array(closes.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= n) sum -= closes[i - n];
    if (i + 1 >= n) out[i] = sum / n;
  }
  return out;
}

export function goldenCross25Over75BarsAgo(data) {
  const last = data.length - 1;
  if (last < 74) return null;

  const ma25 = maSeries(data, 25);
  const ma75 = maSeries(data, 75);

  if (
    !(
      Number.isFinite(ma25[last]) &&
      Number.isFinite(ma75[last]) &&
      ma25[last] > ma75[last]
    )
  ) {
    return null;
  }

  for (let i = last; i >= 1; i--) {
    if (
      Number.isFinite(ma25[i]) &&
      Number.isFinite(ma75[i]) &&
      Number.isFinite(ma25[i - 1]) &&
      Number.isFinite(ma75[i - 1]) &&
      ma25[i] > ma75[i] &&
      ma25[i - 1] <= ma75[i - 1]
    ) {
      return last - i;
    }
  }
  return null;
}

export function dailyFlipBarsAgo(data) {
  const last = data.length - 1;
  if (last < 74) return null;

  const m5 = maSeries(data, 5);
  const m25 = maSeries(data, 25);
  const m75 = maSeries(data, 75);

  const isFiniteTriple = (i) =>
    Number.isFinite(m5[i]) &&
    Number.isFinite(m25[i]) &&
    Number.isFinite(m75[i]);

  const stacked = (i) => isFiniteTriple(i) && m5[i] > m25[i] && m25[i] > m75[i];

  if (!stacked(last)) return null;

  for (let i = last; i >= 1; i--) {
    if (stacked(i) && !stacked(i - 1)) {
      return last - i;
    }
  }
  return null;
}
