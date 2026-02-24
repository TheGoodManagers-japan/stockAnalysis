// dashboard/engine/ml/normalization.js
// Normalization utilities for ML feature engineering.

/**
 * Compute median of a numeric array.
 */
export function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Compute percentile (0-1) of a numeric array.
 */
export function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = p * (sorted.length - 1);
  if (Number.isInteger(idx)) return sorted[idx];
  const lower = sorted[Math.floor(idx)];
  const upper = sorted[Math.ceil(idx)];
  return lower + (upper - lower) * (idx - Math.floor(idx));
}

/**
 * Interquartile range.
 */
export function iqr(arr) {
  return percentile(arr, 0.75) - percentile(arr, 0.25);
}

/**
 * Clamp a value between lower and upper.
 */
export function clamp(val, lower, upper) {
  return Math.min(Math.max(val, lower), upper);
}

/**
 * Z-score normalization using mean and std.
 * Returns { normalized, mean, std } when computing stats,
 * or just the normalized value when stats are provided.
 */
export function zScore(arr, existingStats = null) {
  if (existingStats) {
    const { mean, std } = existingStats;
    const s = std || 1;
    return arr.map((v) => (v - mean) / s);
  }
  const mean = arr.reduce((s, v) => s + v, 0) / (arr.length || 1);
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (arr.length || 1);
  const std = Math.sqrt(variance) || 1;
  return {
    normalized: arr.map((v) => (v - mean) / std),
    mean,
    std,
  };
}

/**
 * Robust z-score using median and IQR.
 */
export function robustZScore(arr, existingStats = null) {
  if (existingStats) {
    const { med, iqrVal } = existingStats;
    const q = iqrVal || 1;
    return arr.map((v) => (v - med) / q);
  }
  const med = median(arr);
  const iqrVal = iqr(arr) || 1;
  return {
    normalized: arr.map((v) => (v - med) / iqrVal),
    med,
    iqrVal,
  };
}

/**
 * Min-max normalization to [0, 1].
 */
export function minMax(val, min, max) {
  const range = max - min;
  if (range === 0) return 0.5;
  return clamp((val - min) / range, 0, 1);
}

/**
 * One-hot encode a categorical value.
 * @param {string} value - The category value
 * @param {string[]} categories - All possible categories in order
 * @returns {number[]} Binary array of length categories.length
 */
export function oneHot(value, categories) {
  return categories.map((c) => (c === value ? 1 : 0));
}

/**
 * Safe numeric extraction — returns the value or a default.
 */
export function safeNum(val, fallback = 0) {
  const n = Number(val);
  return isFinite(n) ? n : fallback;
}
