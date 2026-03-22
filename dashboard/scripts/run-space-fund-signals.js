#!/usr/bin/env node
// CLI runner for Space Fund entry timing signals.
// Used by Railway cron and can be run manually.

import { analyzeSpaceFundSignals } from "../lib/spaceFundSignals.js";
import { query } from "../lib/db.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const DASHBOARD_URL = process.env.DASHBOARD_URL || `http://localhost:${process.env.PORT || 3002}`;

// ── Progress tracking (writes JSON file for UI polling) ──
const PROGRESS_FILE = join(process.cwd(), ".tmp", "sf-progress.json");

function writeProgress(step, totalSteps, label, extra = {}) {
  console.log(`[SF-SIGNALS] ${label}`);
  try {
    mkdirSync(join(process.cwd(), ".tmp"), { recursive: true });
    writeFileSync(PROGRESS_FILE, JSON.stringify({
      step, totalSteps, label,
      status: "running",
      updatedAt: new Date().toISOString(),
      ...extra,
    }));
  } catch {}
}

function writeProgressDone(status = "completed") {
  try {
    writeFileSync(PROGRESS_FILE, JSON.stringify({
      step: 0, totalSteps: 0, label: "",
      status,
      updatedAt: new Date().toISOString(),
    }));
  } catch {}
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function sendEveningReport({ results, count, buyCount, errors, elapsed }) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("[SF-SIGNALS] DISCORD_WEBHOOK_URL not set, skipping report.");
    return;
  }

  const fmt = (n) => (n != null ? `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "-");
  const embeds = [];

  // ── Embed 1: Scan Summary + News Highlights ──
  const summaryEmbed = {
    title: "Space Fund Evening Report",
    color: 0x7c3aed,
    fields: [
      {
        name: "Signal Summary",
        value: `${count} stocks scanned | **${buyCount} buy signals** | ${errors.length} errors\nCompleted in ${elapsed}s`,
        inline: false,
      },
    ],
    timestamp: new Date().toISOString(),
  };

  // Add recent US news headlines
  try {
    const newsRes = await query(
      `SELECT na.title, na.sentiment, na.impact_level, na.news_category
       FROM news_articles na
       WHERE na.source = 'yahoo_us_rss' AND na.is_analyzed = TRUE
         AND na.published_at >= NOW() - INTERVAL '24 hours'
       ORDER BY
         CASE na.impact_level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         na.published_at DESC
       LIMIT 5`
    );
    if (newsRes.rows.length > 0) {
      const newsText = newsRes.rows
        .map((n) => {
          const icon = n.sentiment === "Bullish" ? "+" : n.sentiment === "Bearish" ? "-" : "~";
          const impact = n.impact_level === "high" ? " **[HIGH]**" : "";
          return `**[${icon}]**${impact} ${n.title}`;
        })
        .join("\n");
      summaryEmbed.fields.push({ name: "US/Space News", value: newsText.slice(0, 1024), inline: false });
    }
  } catch {
    // Best effort — don't fail report for news query errors
  }

  embeds.push(summaryEmbed);

  // ── Embed 2: Buy Signals ──
  const buys = results.filter((r) => r.isBuyNow);
  if (buys.length > 0) {
    let buyText = "";
    for (const b of buys) {
      const rr = b.rrRatio != null ? `${b.rrRatio}x` : "-";
      buyText += `**${b.ticker}** ${b.trigger || ""}\n`;
      buyText += `${fmt(b.currentPrice)} | Stop ${fmt(b.stopLoss)} | Target ${fmt(b.priceTarget)} | RR ${rr}\n\n`;
    }
    embeds.push({
      title: `Buy Signals (${buys.length})`,
      color: 0x00c853,
      description: buyText.slice(0, 4096),
    });
  }

  // ── Embed 3: All Signals Overview ──
  const noSignal = results.filter((r) => !r.isBuyNow);
  if (noSignal.length > 0) {
    const watchText = noSignal
      .map((r) => `**${r.ticker}** ${fmt(r.currentPrice)} — no entry signal`)
      .join("\n");
    embeds.push({
      title: "Watch List",
      color: 0x757575,
      description: watchText.slice(0, 4096),
    });
  }

  // Footer with dashboard link
  const last = embeds[embeds.length - 1];
  last.footer = { text: "Open Space Fund Dashboard" };
  last.url = `${DASHBOARD_URL}/space-fund`;

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `[Open Space Fund](${DASHBOARD_URL}/space-fund)`,
        embeds,
      }),
    });
    if (!res.ok) console.warn(`[SF-SIGNALS] Discord webhook returned ${res.status}: ${await res.text()}`);
    else console.log("[SF-SIGNALS] Discord evening report sent.");
  } catch (err) {
    console.warn(`[SF-SIGNALS] Discord report failed: ${err.message}`);
  }
}

async function main() {
  console.log(`[SF-SIGNALS] Starting at ${new Date().toISOString()}`);
  const start = Date.now();

  // Step 1: Fetch US news
  writeProgress(1, 4, "Step 1/4: Fetching US news...");
  try {
    const fetchRes = await fetchWithTimeout(`${DASHBOARD_URL}/api/news/fetch?source=yahoo_us_rss`, { method: "POST" }, 60000);
    const fetchData = await fetchRes.json();
    console.log(`[SF-SIGNALS] US news fetched: ${fetchData.totalInserted ?? 0} new articles.`);
  } catch (err) {
    console.warn(`[SF-SIGNALS] US news fetch error: ${err.message}`);
  }

  // Step 2: Analyze news
  writeProgress(2, 4, "Step 2/4: Analyzing news...");
  try {
    const analyzeRes = await fetchWithTimeout(`${DASHBOARD_URL}/api/news/analyze`, { method: "POST" }, 120000);
    const analyzeData = await analyzeRes.json();
    console.log(`[SF-SIGNALS] News analyzed: ${analyzeData.analyzed ?? 0} articles.`);
  } catch (err) {
    console.warn(`[SF-SIGNALS] News analyze error: ${err.message}`);
  }

  // Step 3: Analyze signals
  writeProgress(3, 4, "Step 3/4: Analyzing signals...");
  const { count, buyCount, errors, results } = await analyzeSpaceFundSignals({
    source: "cron",
    onProgress: (ticker, i, total) => {
      writeProgress(3, 4, `Step 3/4: Analyzing ${ticker}...`, {
        tickerProgress: i,
        tickerTotal: total,
      });
    },
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n[SF-SIGNALS] Done in ${elapsed}s`);
  console.log(`[SF-SIGNALS] ${count} analyzed, ${buyCount} buy signals, ${errors.length} errors`);

  if (errors.length) {
    console.warn("[SF-SIGNALS] Errors:", errors);
  }

  for (const r of results.filter((r) => r.isBuyNow)) {
    console.log(`  BUY: ${r.ticker} ${r.trigger} @ $${r.currentPrice} -> $${r.priceTarget} (SL $${r.stopLoss})`);
  }

  // Step 4: Discord report
  writeProgress(4, 4, "Step 4/4: Sending Discord report...");
  await sendEveningReport({ results, count, buyCount, errors, elapsed });

  writeProgressDone("completed");
  process.exit(0);
}

main().catch((err) => {
  console.error("[SF-SIGNALS] Fatal:", err);
  writeProgressDone("failed");
  process.exit(1);
});
