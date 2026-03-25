// Ensure global (non-JP) tickers exist in the `tickers` table
// so getCachedHistory() / price_history FK constraints don't fail.
// Generalized from the Space Fund pattern in spaceFundSignals.js.

import { query } from "./db.js";

/**
 * Insert tickers into the `tickers` table with ON CONFLICT DO NOTHING.
 * @param {Array<{code: string, name?: string, type?: string, region?: string, exchange?: string, currency?: string}>} tickers
 */
export async function ensureGlobalTickers(tickers) {
  for (const t of tickers) {
    await query(
      `INSERT INTO tickers (code, sector, short_name, currency, exchange)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (code) DO NOTHING`,
      [
        t.code,
        t.type || t.region || t.gicsSector || "Global",
        t.name || t.code,
        t.currency || "USD",
        t.exchange || "US",
      ]
    );
  }
}
