#!/usr/bin/env node
// CLI runner for global ETF entry signals.

import { analyzeGlobalETFSignals } from "../lib/etfSignals.js";

async function main() {
  console.log("[ETF] Starting global ETF signal scan...");
  const start = Date.now();

  const { count, buyCount, errors, results } = await analyzeGlobalETFSignals({
    source: "cron",
    onProgress: (ticker, i, total) => {
      console.log(`[ETF] Processing ${ticker} (${i}/${total})`);
    },
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\n=== ETF Signal Scan Results ===`);
  console.log(`Processed: ${count} | Buy Signals: ${buyCount} | Errors: ${errors.length} | Time: ${elapsed}s`);

  if (buyCount > 0) {
    console.log("\n--- Buy Signals ---");
    for (const r of results.filter((r) => r.isBuyNow)) {
      console.log(`  ${r.ticker.padEnd(6)} ${r.trigger?.padEnd(10) || ""} Price: ${r.currentPrice}  R:R: ${r.rrRatio || "-"}  Stop: ${r.stopLoss || "-"}`);
    }
  }

  if (errors.length) {
    console.log("\n--- Errors ---");
    for (const e of errors) console.log(`  ${e.ticker}: ${e.error}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[ETF] Fatal error:", err);
  process.exit(1);
});
