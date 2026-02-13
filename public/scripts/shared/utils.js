function toNumber(value) {
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}


// utils.js

export const n = (v) => (Number.isFinite(v) ? v : 0);
export const nr = n;
export const avg = (arr) =>
  Array.isArray(arr) && arr.length ? arr.reduce((a, b) => a + (+b || 0), 0) / arr.length : 0;

export { toNumber };
