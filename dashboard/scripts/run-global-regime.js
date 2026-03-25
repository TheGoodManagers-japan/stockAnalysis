#!/usr/bin/env node
// CLI runner for the global regime scan.
// Processes ~13 tickers (8 index ETFs + 5 macro instruments).

import { runGlobalRegimeScan } from "../engine/global/globalRegimeScan.js";
import { computeMacroConfidenceModifier } from "../engine/global/macroConfidence.js";
import { MACRO_TICKERS } from "../data/globalTickers.js";

const macroCodeSet = new Set(MACRO_TICKERS.map((t) => t.code));

async function main() {
  console.log("[GLOBAL] Starting global regime scan...");
  const start = Date.now();

  const { count, results, errors } = await runGlobalRegimeScan({
    onProgress: (ticker, i, total) => {
      console.log(`[GLOBAL] Processing ${ticker} (${i}/${total})`);
    },
  });

  // Compute macro confidence modifier
  const macroResults = results.filter((r) => macroCodeSet.has(r.tickerCode));
  const macro = computeMacroConfidenceModifier(macroResults);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log("\n=== Global Regime Scan Results ===");
  console.log(`Processed: ${count} | Errors: ${errors.length} | Time: ${elapsed}s`);

  // Print index ETF regimes
  console.log("\n--- Market Thermometer ---");
  const etfs = results.filter((r) => r.tickerType === "index_etf");
  for (const r of etfs) {
    const emoji = r.regime.includes("UP") ? "+" : r.regime === "RANGE" ? "=" : "-";
    console.log(`  ${emoji} ${r.tickerName.padEnd(16)} ${r.regime.padEnd(10)} ret5: ${(r.ret5 ?? 0).toFixed(1)}%  momentum: ${r.momentumScore}`);
  }

  // Print macro indicators
  console.log("\n--- Macro Indicators ---");
  const macros = results.filter((r) => r.tickerType !== "index_etf");
  for (const r of macros) {
    console.log(`  ${r.tickerName.padEnd(16)} ${r.regime.padEnd(10)} price: ${r.currentPrice}`);
  }

  // Print macro confidence
  console.log(`\n--- JPX Macro Confidence: ${macro.label} (${macro.modifier >= 0 ? "+" : ""}${macro.modifier}) ---`);
  for (const f of macro.factors) {
    console.log(`  ${f.impact >= 0 ? "+" : ""}${f.impact.toFixed(2)} ${f.reason}`);
  }

  if (errors.length) {
    console.log("\n--- Errors ---");
    for (const e of errors) console.log(`  ${e.ticker}: ${e.error}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[GLOBAL] Fatal error:", err);
  process.exit(1);
});
