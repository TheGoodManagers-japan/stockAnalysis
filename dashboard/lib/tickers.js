// Canonical ticker normalization + validation for JP equities (XXXX.T format)

const TICKER_RE = /^\d{4}\.T$/;

/**
 * Normalize a ticker string to XXXX.T format.
 * Returns null for falsy input.
 */
export function normalizeTicker(input) {
  if (!input) return null;
  let s = String(input).trim().toUpperCase();
  if (!/\.T$/.test(s)) {
    s = s.replace(/\..*$/, "");
    s = `${s}.T`;
  }
  return s;
}

/**
 * Validate a single ticker string. Returns { valid, ticker?, error? }.
 */
export function validateTicker(raw) {
  if (typeof raw !== "string")
    return { valid: false, error: "Ticker must be a string" };
  const t = raw.trim();
  if (!TICKER_RE.test(t))
    return { valid: false, error: `Invalid ticker format: "${t}" (expected XXXX.T)` };
  return { valid: true, ticker: t };
}

/**
 * Validate an array of tickers. Returns { valid, tickers?, error? }.
 */
export function validateTickerArray(arr) {
  if (!Array.isArray(arr))
    return { valid: false, error: "Expected an array of tickers" };
  if (arr.length === 0) return { valid: true, tickers: [] };
  const results = arr.map(validateTicker);
  const invalid = results.filter((r) => !r.valid);
  if (invalid.length)
    return {
      valid: false,
      error: `Invalid tickers: ${invalid.map((i) => i.error).join("; ")}`,
    };
  return { valid: true, tickers: results.map((r) => r.ticker) };
}
