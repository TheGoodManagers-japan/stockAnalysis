// entryHelpers/core.js — small pure helpers + re-exports from helpers.js

export { num, toTick, inferTickFromPrice } from "../../../helpers.js";

export function isFiniteN(v) {
  return Number.isFinite(v);
}

export function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + (+b || 0), 0) / arr.length : 0;
}

export function fmt(x) {
  return Number.isFinite(x) ? (+x).toFixed(2) : String(x);
}

export function near(a, b, eps = 1e-8) {
  return Math.abs((+a || 0) - (+b || 0)) <= eps;
}

export function round0(v) {
  return Math.round(Number(v) || 0);
}

export function countConsecutiveUpDays(data) {
  let c = 0;
  for (let i = data.length - 1; i > 0; i--) {
    if (+data[i].close > +data[i - 1].close) c++;
    else break;
  }
  return c;
}
