#!/usr/bin/env node
// CLI runner for Space Fund entry timing signals.
// Used by Railway cron and can be run manually.

import { analyzeSpaceFundSignals } from "../lib/spaceFundSignals.js";

const DASHBOARD_URL = process.env.DASHBOARD_URL || `http://localhost:${process.env.PORT || 3002}`;

async function fetchWithTimeout(url, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function runUSNewsPipeline() {
  console.log("[SF-SIGNALS] Fetching US news...");
  try {
    const fetchRes = await fetchWithTimeout(`${DASHBOARD_URL}/api/news/fetch?source=yahoo_us_rss`, { method: "POST" }, 60000);
    const fetchData = await fetchRes.json();
    console.log(`[SF-SIGNALS] US news fetched: ${fetchData.totalInserted ?? 0} new articles.`);
  } catch (err) {
    console.warn(`[SF-SIGNALS] US news fetch error: ${err.message}`);
  }
  try {
    const analyzeRes = await fetchWithTimeout(`${DASHBOARD_URL}/api/news/analyze`, { method: "POST" }, 120000);
    const analyzeData = await analyzeRes.json();
    console.log(`[SF-SIGNALS] News analyzed: ${analyzeData.analyzed ?? 0} articles.`);
  } catch (err) {
    console.warn(`[SF-SIGNALS] News analyze error: ${err.message}`);
  }
}

async function main() {
  console.log(`[SF-SIGNALS] Starting at ${new Date().toISOString()}`);
  const start = Date.now();

  // Fetch and analyze US news before signals so catalyst data is fresh
  await runUSNewsPipeline();

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
