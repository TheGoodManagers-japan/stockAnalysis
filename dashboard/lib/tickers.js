// Ticker normalization + validation — supports JP (XXXX.T) and global tickers.

const JP_TICKER_RE = /^\d{4}\.T$/;

/**
 * Normalize a ticker string. Market-aware:
 * - 4-digit codes → XXXX.T (JP)
 * - Already suffixed (.T, .L, .DE, .HK) → passthrough
 * - Yahoo specials (^VIX, USDJPY=X, CL=F, DX-Y.NYB) → passthrough
 * - Alphabetic US tickers (SPY, AAPL) → passthrough uppercase
 * Returns null for falsy input.
 */
export function normalizeTicker(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;

  // Yahoo special: index (^VIX), futures (CL=F), or hyphenated (DX-Y.NYB)
  if (s.startsWith("^") || /=\w$/.test(s)) return s;

  const upper = s.toUpperCase();

  // Already has an exchange suffix (.T, .L, .DE, .HK, etc.)
  if (/\.[A-Z]{1,4}$/.test(upper)) return upper;

  // 4-digit JP code → add .T
  if (/^\d{4}$/.test(upper)) return `${upper}.T`;

  // Alphabetic ticker (US: SPY, AAPL, etc.) → keep as-is
  return upper;
}

/**
 * Returns true if the ticker is a JP equity (XXXX.T format).
 */
export function isJPTicker(code) {
  return JP_TICKER_RE.test(code);
}

/**
 * Validate a single JP ticker string. Returns { valid, ticker?, error? }.
 * Use this for JP-only API routes.
 */
export function validateTicker(raw) {
  if (typeof raw !== "string")
    return { valid: false, error: "Ticker must be a string" };
  const t = raw.trim();
  if (!JP_TICKER_RE.test(t))
    return { valid: false, error: `Invalid ticker format: "${t}" (expected XXXX.T)` };
  return { valid: true, ticker: t };
}

/**
 * Validate an array of JP tickers. Returns { valid, tickers?, error? }.
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
