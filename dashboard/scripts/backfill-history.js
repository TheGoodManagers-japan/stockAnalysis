#!/usr/bin/env node

// dashboard/scripts/backfill-history.js
// Backfill price_history to 10 years for all tickers.
// Usage: DATABASE_URL=... node scripts/backfill-history.js [--concurrency 3]
//
// Yahoo Finance throttles aggressively, so we process sequentially by default
// with a sleep between requests. Use --concurrency to speed up (risky).

import { getCachedHistory } from "../lib/cache/priceHistory.js";
import { query } from "../lib/db.js";
import { allTickers } from "../data/tickers.js";

const args = process.argv.slice(2);
let concurrency = 1;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--concurrency" && args[i + 1]) {
    concurrency = Math.max(1, Math.min(5, parseInt(args[i + 1])));
    i++;
  }
}

const YEARS = 10;
const SLEEP_MS = 400; // ms between requests to avoid Yahoo throttling

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function backfill() {
  console.log(`[BACKFILL] Starting 10-year price history backfill for ${allTickers.length} tickers`);
  console.log(`[BACKFILL] Concurrency: ${concurrency}, sleep: ${SLEEP_MS}ms`);

  // Check current coverage
  const coverage = await query(`
    SELECT ticker_code, MIN(date) AS earliest, MAX(date) AS latest, COUNT(*) AS rows
    FROM price_history
    GROUP BY ticker_code
  `);
  const coverageMap = new Map();
  for (const r of coverage.rows) {
    coverageMap.set(r.ticker_code, r);
  }

  const tenYearsAgo = new Date();
  tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - YEARS);
  const targetDate = tenYearsAgo.toISOString().split("T")[0];

  // Filter to tickers that need backfill
  const needsBackfill = allTickers.filter((t) => {
    const ticker = typeof t === "string" ? t : (t.code || t.ticker);
    const existing = coverageMap.get(ticker);
    if (!existing) return true; // no data at all
    const earliest = new Date(existing.earliest).toISOString().split("T")[0];
    // Need backfill if earliest data is more than 30 days after our target
    return earliest > targetDate && new Date(earliest) - new Date(targetDate) > 30 * 86400000;
  });

  const tickerCodes = needsBackfill.map((t) => typeof t === "string" ? t : (t.code || t.ticker));
  console.log(`[BACKFILL] ${tickerCodes.length} tickers need backfill (${allTickers.length - tickerCodes.length} already have sufficient data)`);

  let completed = 0;
  let failed = 0;
  let skipped = 0;
  const startTime = Date.now();

  // Process in batches based on concurrency
  for (let i = 0; i < tickerCodes.length; i += concurrency) {
    const batch = tickerCodes.slice(i, i + concurrency);
    const promises = batch.map(async (ticker) => {
      try {
        const data = await getCachedHistory(ticker, YEARS);
        const rows = data?.length || 0;
        if (rows > 0) {
          completed++;
          const earliest = data[0]?.date;
          console.log(`[BACKFILL] ✓ ${ticker}: ${rows} rows (from ${String(earliest).split("T")[0]}) [${completed + failed + skipped}/${tickerCodes.length}]`);
        } else {
          skipped++;
          console.log(`[BACKFILL] - ${ticker}: no data available [${completed + failed + skipped}/${tickerCodes.length}]`);
        }
      } catch (err) {
        failed++;
        console.error(`[BACKFILL] ✗ ${ticker}: ${err.message} [${completed + failed + skipped}/${tickerCodes.length}]`);
      }
    });

    await Promise.all(promises);
    if (i + concurrency < tickerCodes.length) {
      await sleep(SLEEP_MS);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Final coverage check
  const finalCoverage = await query(`
    SELECT
      COUNT(DISTINCT ticker_code) AS tickers,
      COUNT(*) AS total_rows,
      MIN(date) AS earliest,
      MAX(date) AS latest,
      ROUND(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT ticker_code)::numeric, 0)) AS avg_rows
    FROM price_history
  `);

  console.log(`\n[BACKFILL] ═══ Complete ═══`);
  console.log(`[BACKFILL] Elapsed: ${elapsed}s`);
  console.log(`[BACKFILL] Completed: ${completed}, Failed: ${failed}, Skipped: ${skipped}`);
  console.log(`[BACKFILL] DB coverage:`, JSON.stringify(finalCoverage.rows[0], null, 2));
}

backfill()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[BACKFILL] Fatal error:", err);
    process.exit(1);
  });
