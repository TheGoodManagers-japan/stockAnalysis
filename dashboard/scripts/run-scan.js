#!/usr/bin/env node

// dashboard/scripts/run-scan.js
// Standalone scan runner for Modal cron job.
// Usage: DATABASE_URL=... node scripts/run-scan.js

import { fetchStockAnalysis } from "../engine/orchestrator.js";
import { saveScanResult, cacheStockSnapshot } from "../lib/cache.js";
import { query } from "../lib/db.js";
import { predictForTicker } from "../engine/ml/predictions.js";
import { allTickers } from "../data/tickers.js";

const DASHBOARD_URL = "https://info-27641--dashboard.modal.run";

// ── News Pipeline ──────────────────────────────────────────────
async function fetchWithTimeout(url, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function runNewsPipeline() {
  console.log("[CRON] Running news pipeline...");
  let report = null;

  try {
    // 1. Fetch news from all sources
    const fetchRes = await fetchWithTimeout(`${DASHBOARD_URL}/api/news/fetch?source=all`, { method: "POST" }, 180000);
    const fetchData = await fetchRes.json();
    console.log(`[CRON] News fetched: ${fetchData.total_saved ?? 0} new articles from ${fetchData.sources_fetched ?? 0} sources.`);
  } catch (err) {
    console.warn(`[CRON] News fetch error: ${err.message}`);
  }

  try {
    // 2. Analyze unanalyzed articles with Gemini
    const analyzeRes = await fetchWithTimeout(`${DASHBOARD_URL}/api/news/analyze`, { method: "POST" }, 120000);
    const analyzeData = await analyzeRes.json();
    console.log(`[CRON] News analyzed: ${analyzeData.analyzed ?? 0} articles.`);
  } catch (err) {
    console.warn(`[CRON] News analyze error: ${err.message}`);
  }

  try {
    // 3. Generate daily report
    const reportRes = await fetchWithTimeout(`${DASHBOARD_URL}/api/news/daily-report`, { method: "POST" }, 120000);
    const reportData = await reportRes.json();
    if (reportData.report) {
      report = reportData.report;
      console.log("[CRON] Daily news report generated.");
    }
  } catch (err) {
    console.warn(`[CRON] News report error: ${err.message}`);
  }

  return report;
}

// ── Discord Morning Report ─────────────────────────────────────
async function sendMorningReport({ results, myPortfolio, count, buyCount, errors, predCount, elapsed, newsReport }) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("[CRON] DISCORD_WEBHOOK_URL not set, skipping alert.");
    return;
  }

  const fmt = (n) => (n != null ? `\u00a5${Math.round(n).toLocaleString()}` : "-");
  const embeds = [];

  // ── Embed 1: Market & News ──
  const newsEmbed = {
    title: "Morning Report",
    color: 0x1a73e8,
    fields: [
      {
        name: "Scan Summary",
        value: `${count} scanned | **${buyCount} buys** | ${errors.length} errors | ${predCount} predictions\nCompleted in ${elapsed} min`,
        inline: false,
      },
    ],
    timestamp: new Date().toISOString(),
  };

  if (newsReport) {
    if (newsReport.market_overview) {
      newsEmbed.fields.push({ name: "Market Overview", value: newsReport.market_overview.slice(0, 1024), inline: false });
    }

    if (newsReport.high_impact_events?.length > 0) {
      const eventsText = newsReport.high_impact_events
        .slice(0, 5)
        .map((e) => {
          const icon = e.sentiment === "Bullish" ? "+" : e.sentiment === "Bearish" ? "-" : "~";
          const tickers = e.tickers?.length ? ` (${e.tickers.join(", ")})` : "";
          return `**[${icon}]** ${e.headline}${tickers}\n${e.detail || ""}`;
        })
        .join("\n\n");
      newsEmbed.fields.push({ name: "Key Events", value: eventsText.slice(0, 1024), inline: false });
    }

    if (newsReport.sector_highlights?.length > 0) {
      const sectorText = newsReport.sector_highlights
        .map((s) => {
          const icon = s.tone === "Bullish" ? "+" : s.tone === "Bearish" ? "-" : "~";
          return `**[${icon}] ${s.sector}** ${s.summary || ""}`;
        })
        .join("\n");
      newsEmbed.fields.push({ name: "Sectors", value: sectorText.slice(0, 1024), inline: false });
    }

    if (newsReport.trading_implications) {
      newsEmbed.fields.push({ name: "Trading Implications", value: newsReport.trading_implications.slice(0, 1024), inline: false });
    }
  } else {
    newsEmbed.fields.push({ name: "News", value: "News pipeline unavailable.", inline: false });
  }

  embeds.push(newsEmbed);

  // ── Embed 2: Buy Signals ──
  const buys = results
    .filter((r) => r.isBuyNow)
    .sort((a, b) => (a.tier || 3) - (b.tier || 3) || (b.shortTermScore || 0) - (a.shortTermScore || 0))
    .slice(0, 10);

  if (buys.length > 0) {
    let buyText = "";
    for (const b of buys) {
      const rr = b.priceTarget && b.stopLoss && b.currentPrice > b.stopLoss
        ? ((b.priceTarget - b.currentPrice) / (b.currentPrice - b.stopLoss)).toFixed(1)
        : "-";
      buyText += `**${b.ticker}** ${b.triggerType || ""} T${b.tier || "?"}\n`;
      buyText += `${fmt(b.currentPrice)} | Stop ${fmt(b.stopLoss)} | Target ${fmt(b.priceTarget)} | RR ${rr}\n`;
      buyText += `${b.marketRegime || ""} | ST ${b.shortTermScore ?? "-"} | LT ${b.longTermScore ?? "-"}\n\n`;
    }

    embeds.push({
      title: `Buy Signals (${buyCount})`,
      color: 0x00c853,
      description: buyText.slice(0, 4096),
    });
  }

  // ── Embed 3: Portfolio Actions ──
  const portfolioActions = results.filter(
    (r) => r.managementSignalStatus && r.managementSignalStatus !== "Hold"
  );

  if (portfolioActions.length > 0) {
    const sellNow = portfolioActions.filter((r) => r.managementSignalStatus === "Sell Now");
    const protect = portfolioActions.filter((r) => r.managementSignalStatus === "Protect Profit");
    const scale = portfolioActions.filter((r) => r.managementSignalStatus === "Scale Partial");

    let actionText = "";
    if (sellNow.length > 0) {
      actionText += sellNow.map((r) => `**${r.ticker}** SELL NOW - ${r.managementSignalReason || ""}`).join("\n") + "\n";
    }
    if (protect.length > 0) {
      actionText += protect.map((r) => `**${r.ticker}** PROTECT - ${r.managementSignalReason || ""}`).join("\n") + "\n";
    }
    if (scale.length > 0) {
      actionText += scale.map((r) => `**${r.ticker}** SCALE - ${r.managementSignalReason || ""}`).join("\n") + "\n";
    }

    embeds.push({
      title: "Portfolio Actions",
      color: 0xff6d00,
      description: actionText.slice(0, 4096),
    });
  } else if (myPortfolio.length > 0) {
    embeds.push({
      title: "Portfolio",
      color: 0x757575,
      description: `${myPortfolio.length} open positions - all Hold.`,
    });
  }

  // Footer link on last embed
  const last = embeds[embeds.length - 1];
  last.footer = { text: "Open Dashboard" };
  last.url = `${DASHBOARD_URL}/scanner`;

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `[Open Dashboard](${DASHBOARD_URL}/scanner)`, embeds }),
    });
    if (!res.ok) console.warn(`[CRON] Discord webhook returned ${res.status}: ${await res.text()}`);
    else console.log("[CRON] Discord morning report sent.");
  } catch (err) {
    console.warn(`[CRON] Discord alert failed: ${err.message}`);
  }
}

async function runScan() {
  const startTime = Date.now();
  console.log(`[CRON] Starting daily scan at ${new Date().toISOString()}`);

  try {
    // Fetch open portfolio holdings for trade management signals
    const portfolioResult = await query(
      `SELECT ticker_code, entry_price, initial_stop, current_stop,
              price_target, entry_date, entry_kind
       FROM portfolio_holdings
       WHERE status = 'open'`
    );
    const myPortfolio = portfolioResult.rows.map((row) => ({
      ticker: row.ticker_code,
      trade: {
        entryPrice: Number(row.entry_price),
        stopLoss: Number(row.current_stop || row.initial_stop),
        priceTarget: row.price_target ? Number(row.price_target) : undefined,
        entryDate: row.entry_date,
        initialStop: row.initial_stop ? Number(row.initial_stop) : undefined,
      },
    }));

    // Mark any old stuck 'running' scans as failed (from previous crashes)
    await query(
      `UPDATE scan_runs SET status = 'failed', finished_at = NOW(),
              errors = '["Marked as failed: scan was stuck in running state"]'::jsonb
       WHERE status = 'running' AND started_at < NOW() - INTERVAL '2 hours'`
    );

    // Create scan run record
    const scanRun = await query(
      `INSERT INTO scan_runs (ticker_count, total_tickers, status)
       VALUES (0, $1, 'running') RETURNING scan_id`,
      [allTickers.length]
    );
    const scanId = scanRun.rows[0].scan_id;
    console.log(`[CRON] Scan run created: ${scanId}`);

    // Run the full analysis engine with incremental saves
    let buyCount = 0;
    const { count, errors, summary, results } = await fetchStockAnalysis({
      tickers: [],
      myPortfolio,
      onProgress: async ({ stock, processed, total, currentTicker, buyCount: rb }) => {
        stock.triggerType = stock.trigger || null;
        await saveScanResult(scanId, stock);
        await cacheStockSnapshot(stock.ticker, stock);
        buyCount = rb;
        await query(
          `UPDATE scan_runs
           SET ticker_count = $2, buy_count = $3,
               current_ticker = $4, total_tickers = $5
           WHERE scan_id = $1`,
          [scanId, processed, buyCount, currentTicker, total]
        );
        process.stdout.write(`\r[CRON] ${processed}/${total} (${currentTicker})    `);
      },
    });
    console.log(""); // newline after \r progress

    // Final update: mark as completed
    await query(
      `UPDATE scan_runs
       SET finished_at = NOW(),
           ticker_count = $2,
           buy_count = $3,
           error_count = $4,
           errors = $5,
           status = 'completed',
           summary_json = $6,
           current_ticker = NULL
       WHERE scan_id = $1`,
      [scanId, count, buyCount, errors.length, JSON.stringify(errors), JSON.stringify(summary)]
    );

    const scanElapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`[CRON] Scan complete in ${scanElapsed} min. ${count} tickers, ${buyCount} buys, ${errors.length} errors.`);

    // --- Run ML predictions for priority stocks ---
    console.log(`[CRON] Running ML predictions...`);

    // Priority: buy signals > open positions > tier 1-2
    const predictionTickers = new Set();
    for (const r of results) {
      if (r.isBuyNow) predictionTickers.add(r.ticker);
    }
    for (const p of myPortfolio) {
      predictionTickers.add(p.ticker);
    }
    for (const r of results) {
      if (r.tier <= 2 && predictionTickers.size < 100) predictionTickers.add(r.ticker);
    }

    let predCount = 0;
    for (const ticker of predictionTickers) {
      try {
        // Fetch historical data for the ticker
        const histResult = await query(
          `SELECT date, close, volume FROM price_history
           WHERE ticker_code = $1 ORDER BY date ASC`,
          [ticker]
        );
        if (histResult.rows.length < 60) continue;

        const histData = histResult.rows.map((r) => ({
          price: Number(r.close),
          volume: Number(r.volume),
        }));

        const pred = await predictForTicker(histData, ticker);
        if (pred.predictedPrice) {
          await query(
            `INSERT INTO predictions
             (scan_id, ticker_code, prediction_date, predicted_max_30d,
              predicted_pct_change, confidence, model_type, current_price)
             VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6, $7)
             ON CONFLICT (ticker_code, prediction_date) DO UPDATE SET
               scan_id = EXCLUDED.scan_id,
               predicted_max_30d = EXCLUDED.predicted_max_30d,
               predicted_pct_change = EXCLUDED.predicted_pct_change,
               confidence = EXCLUDED.confidence,
               model_type = EXCLUDED.model_type,
               current_price = EXCLUDED.current_price`,
            [scanId, ticker, pred.predictedPrice, pred.pctChange, pred.confidence, pred.method, histData[histData.length - 1].price]
          );
          predCount++;
        }
      } catch (err) {
        console.warn(`[CRON] Prediction failed for ${ticker}: ${err.message}`);
      }
    }

    console.log(`[CRON] Predictions complete: ${predCount}/${predictionTickers.size} tickers.`);

    // --- Snapshot portfolio ---
    try {
      const openHoldings = await query(
        `SELECT ph.ticker_code, ph.entry_price, ph.shares, t.sector
         FROM portfolio_holdings ph
         LEFT JOIN tickers t ON t.code = ph.ticker_code
         WHERE ph.status = 'open'`
      );

      let totalValue = 0;
      let totalCost = 0;
      const sectorExposure = {};
      const holdingsJson = [];

      for (const h of openHoldings.rows) {
        const snap = await query(
          `SELECT current_price FROM stock_snapshots
           WHERE ticker_code = $1 ORDER BY snapshot_date DESC LIMIT 1`,
          [h.ticker_code]
        );
        const price = snap.rows.length > 0 ? Number(snap.rows[0].current_price) : Number(h.entry_price);
        const value = price * Number(h.shares);
        const cost = Number(h.entry_price) * Number(h.shares);
        totalValue += value;
        totalCost += cost;
        const sector = h.sector || "Unknown";
        sectorExposure[sector] = (sectorExposure[sector] || 0) + value;
        holdingsJson.push({ ticker: h.ticker_code, price, value, pnl: value - cost });
      }

      const realizedResult = await query(
        `SELECT COALESCE(SUM(pnl_amount), 0) as total FROM portfolio_holdings WHERE status = 'closed'`
      );

      await query(
        `INSERT INTO portfolio_snapshots
         (snapshot_date, total_value, total_cost, unrealized_pnl, realized_pnl,
          open_positions, sector_exposure, holdings_json)
         VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (snapshot_date) DO UPDATE SET
           total_value = EXCLUDED.total_value, total_cost = EXCLUDED.total_cost,
           unrealized_pnl = EXCLUDED.unrealized_pnl, realized_pnl = EXCLUDED.realized_pnl,
           open_positions = EXCLUDED.open_positions, sector_exposure = EXCLUDED.sector_exposure,
           holdings_json = EXCLUDED.holdings_json`,
        [totalValue, totalCost, totalValue - totalCost, Number(realizedResult.rows[0].total),
         openHoldings.rows.length, JSON.stringify(sectorExposure), JSON.stringify(holdingsJson)]
      );
      console.log(`[CRON] Portfolio snapshot saved.`);
    } catch (err) {
      console.warn(`[CRON] Portfolio snapshot failed: ${err.message}`);
    }

    // --- Run news pipeline ---
    const newsReport = await runNewsPipeline();

    const totalElapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`[CRON] All done in ${totalElapsed} min.`);

    await sendMorningReport({ results, myPortfolio, count, buyCount, errors, predCount, elapsed: totalElapsed, newsReport });
    process.exit(0);
  } catch (err) {
    console.error(`[CRON] Fatal error:`, err);
    // Mark the scan as failed so it doesn't block the scanner page
    try {
      await query(
        `UPDATE scan_runs SET status = 'failed', finished_at = NOW(),
                errors = $1::jsonb, current_ticker = NULL
         WHERE scan_id = (
           SELECT scan_id FROM scan_runs WHERE status = 'running'
           ORDER BY started_at DESC LIMIT 1
         )`,
        [JSON.stringify([err.message])]
      );
    } catch { /* best effort */ }
    process.exit(1);
  }
}

runScan();
