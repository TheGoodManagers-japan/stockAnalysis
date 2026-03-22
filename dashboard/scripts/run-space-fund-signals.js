#!/usr/bin/env node
// CLI runner for Space Fund entry timing signals.
// Used by Railway cron and can be run manually.

import { analyzeSpaceFundSignals } from "../lib/spaceFundSignals.js";

async function main() {
  console.log(`[SF-SIGNALS] Starting at ${new Date().toISOString()}`);
  const start = Date.now();

  const { count, buyCount, errors, results } = await analyzeSpaceFundSignals({
    source: "cron",
    onProgress: (ticker, i, total) => {
      process.stdout.write(`\r[SF-SIGNALS] ${i}/${total} ${ticker}      `);
    },
  });

  console.log(`\n[SF-SIGNALS] Done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  console.log(`[SF-SIGNALS] ${count} analyzed, ${buyCount} buy signals, ${errors.length} errors`);

  if (errors.length) {
    console.warn("[SF-SIGNALS] Errors:", errors);
  }

  for (const r of results.filter((r) => r.isBuyNow)) {
    console.log(`  BUY: ${r.ticker} ${r.trigger} @ $${r.currentPrice} -> $${r.priceTarget} (SL $${r.stopLoss})`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[SF-SIGNALS] Fatal:", err);
  process.exit(1);
});
