// Input validation helpers for API routes
// Ticker functions re-exported from canonical tickers.js
export { validateTicker, validateTickerArray } from "./tickers.js";

export function validatePositiveNum(val, name) {
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0)
    return { valid: false, error: `${name} must be a positive number` };
  return { valid: true, value: n };
}
