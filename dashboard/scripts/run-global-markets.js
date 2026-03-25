#!/usr/bin/env node
// Unified global market analysis cron script.
// Runs sequentially: global regime → ETF signals
// Total: ~123 Yahoo calls, ~2 minutes.

import { runGlobalRegimeScan } from "../engine/global/globalRegimeScan.js";
import { computeMacroConfidenceModifier } from "../engine/global/macroConfidence.js";
import { analyzeGlobalETFSignals } from "../lib/etfSignals.js";
import { MACRO_TICKERS } from "../data/globalTickers.js";

const macroCodeSet = new Set(MACRO_TICKERS.map((t) => t.code));

async function main() {
  const totalStart = Date.now();
  console.log("=== Global Market Analysis ===\n");

  // Phase 1: Global regime scan (13 tickers)
  console.log("[1/2] Running global regime scan...");
  const regimeStart = Date.now();
  const regime = await runGlobalRegimeScan({
    onProgress: (t, i, n) => console.log(`  [REGIME] ${t} (${i}/${n})`),
  });
  const regimeTime = ((Date.now() - regimeStart) / 1000).toFixed(1);
  console.log(`  Done: ${regime.count} processed, ${regime.errors.length} errors (${regimeTime}s)\n`);

  // Print macro confidence
  const macroResults = regime.results.filter((r) => macroCodeSet.has(r.tickerCode));
  const macro = computeMacroConfidenceModifier(macroResults);
  console.log(`  JPX Macro Confidence: ${macro.label} (${macro.modifier >= 0 ? "+" : ""}${macro.modifier})\n`);

  // Phase 2: ETF signals (~25 tickers)
  console.log("[2/2] Running ETF signal scan...");
  const etfStart = Date.now();
  const etf = await analyzeGlobalETFSignals({
    source: "cron",
    onProgress: (t, i, n) => console.log(`  [ETF] ${t} (${i}/${n})`),
  });
  const etfTime = ((Date.now() - etfStart) / 1000).toFixed(1);
  console.log(`  Done: ${etf.count} processed, ${etf.buyCount} buys, ${etf.errors.length} errors (${etfTime}s)\n`);

  // Summary
  const totalTime = ((Date.now() - totalStart) / 1000).toFixed(1);
  console.log("=== Summary ===");
  console.log(`Total time: ${totalTime}s`);
  console.log(`Regime: ${regime.count} tickers | ETF: ${etf.count} tickers, ${etf.buyCount} buy signals`);
  console.log(`Macro: ${macro.label} | Errors: ${regime.errors.length + etf.errors.length}`);

  if (etf.buyCount > 0) {
    console.log("\n--- ETF Buy Signals ---");
    for (const r of etf.results.filter((r) => r.isBuyNow)) {
      console.log(`  ${r.ticker.padEnd(6)} ${(r.trigger || "").padEnd(10)} R:R ${r.rrRatio || "-"}`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[GLOBAL] Fatal error:", err);
  process.exit(1);
});
