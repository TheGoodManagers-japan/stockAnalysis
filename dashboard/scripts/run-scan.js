#!/usr/bin/env node

// dashboard/scripts/run-scan.js
// Standalone scan runner for Railway cron job.
// Usage: DATABASE_URL=... node scripts/run-scan.js

import { fetchStockAnalysis } from "../engine/orchestrator.js";
import { saveScanResult, cacheStockSnapshot } from "../lib/cache.js";
import { query } from "../lib/db.js";
import { predictForTicker } from "../engine/ml/predictions.js";
import { predictBatch as predictSignalQuality, disposeModel as disposeSignalQualityModel } from "../engine/ml/signalQuality.js";
import { rankStocks, disposeModel as disposeRankerModel } from "../engine/ml/stockRanker.js";
import { predictBatch as predictLstmV2, disposeModel as disposeLstmV2Model } from "../engine/ml/lstmV2.js";
import { allTickers } from "../data/tickers.js";

const DASHBOARD_URL = process.env.DASHBOARD_URL || `http://localhost:${process.env.PORT || 3002}`;

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
    // 1. Fetch news from JP sources only (US sources run in Space Fund evening scan)
    const fetchRes = await fetchWithTimeout(`${DASHBOARD_URL}/api/news/fetch?source=kabutan,yahoo_rss,jquants,nikkei,minkabu,reuters`, { method: "POST" }, 180000);
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
async function sendMorningReport({ results, myPortfolio, count, buyCount, errors, predCount, mlScoredCount = 0, mlRankedCount = 0, elapsed, newsReport }) {
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
        value: `${count} scanned | **${buyCount} buys** | ${errors.length} errors | ${predCount} predictions | ${mlScoredCount} ML scored | ${mlRankedCount} ranked\nCompleted in ${elapsed} min`,
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

    // --- Run news pipeline BEFORE scan so catalyst scores have fresh data ---
    let newsReport = null;
    try {
      newsReport = await runNewsPipeline();
    } catch (err) {
      console.warn(`[CRON] Pre-scan news pipeline failed (non-fatal): ${err.message}`);
    }

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

    // --- Build prediction ticker set (for legacy fallback) ---
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

    // --- ML Signal Quality Scoring (Phase 1) ---
    let mlScoredCount = 0;
    try {
      const buySignals = results.filter((r) => r.isBuyNow);
      if (buySignals.length > 0) {
        console.log(`[CRON] Running ML signal quality scoring for ${buySignals.length} buy signals...`);

        // Build scan_results-shaped objects for the feature extractor
        const scanResultRows = buySignals.map((r) => ({
          ticker_code: r.ticker,
          current_price: r.currentPrice,
          fundamental_score: r.fundamentalScore,
          valuation_score: r.valuationScore,
          technical_score: r.technicalScore,
          tier: r.tier,
          short_term_score: r.shortTermScore,
          long_term_score: r.longTermScore,
          short_term_conf: r.shortTermConf,
          long_term_conf: r.longTermConf,
          trigger_type: r.triggerType || r.trigger,
          market_regime: r.marketRegime,
          liq_pass: r.liqPass,
          liq_adv: r.liqAdv,
          value_play_score: r.valuePlayScore,
          stop_loss: r.stopLoss,
          price_target: r.priceTarget,
          flip_bars_ago: r.flipBarsAgo,
          golden_cross_bars_ago: r.goldenCrossBarsAgo,
          other_data_json: {
            rsi14: r.rsi14,
            macd: r.macd,
            macdSignal: r.macdSignal,
            atr14: r.atr14,
            peRatio: r.peRatio,
            pbRatio: r.pbRatio,
            dividendYield: r.dividendYield,
            fiftyTwoWeekHigh: r.fiftyTwoWeekHigh,
            fiftyTwoWeekLow: r.fiftyTwoWeekLow,
            evToEbitda: r.evToEbitda,
            fcfYieldPct: r.fcfYieldPct,
          },
        }));

        const confidenceMap = await predictSignalQuality(scanResultRows);

        // Update scan_results with ML confidence
        for (const [ticker, confidence] of confidenceMap) {
          try {
            await query(
              `UPDATE scan_results
               SET other_data_json = COALESCE(other_data_json, '{}'::jsonb) || $2::jsonb
               WHERE scan_id = $1 AND ticker_code = $3`,
              [scanId, JSON.stringify({ ml_signal_confidence: confidence }), ticker]
            );
            mlScoredCount++;
          } catch (err) {
            console.warn(`[CRON] ML score update failed for ${ticker}: ${err.message}`);
          }
        }

        console.log(`[CRON] ML signal quality: scored ${mlScoredCount}/${buySignals.length} buy signals.`);
      }
    } catch (err) {
      console.warn(`[CRON] ML signal quality scoring failed: ${err.message}\n${err.stack}`);
    } finally {
      disposeSignalQualityModel();
    }

    // --- ML Stock Ranking (Phase 2) ---
    let mlRankedCount = 0;
    try {
      console.log(`[CRON] Running ML stock ranking for ${results.length} stocks...`);

      // Build scan_results-shaped objects for all stocks
      const allScanRows = results.map((r) => ({
        ticker_code: r.ticker,
        current_price: r.currentPrice,
        fundamental_score: r.fundamentalScore,
        valuation_score: r.valuationScore,
        technical_score: r.technicalScore,
        tier: r.tier,
        short_term_score: r.shortTermScore,
        long_term_score: r.longTermScore,
        short_term_conf: r.shortTermConf,
        long_term_conf: r.longTermConf,
        trigger_type: r.triggerType || r.trigger,
        market_regime: r.marketRegime,
        liq_pass: r.liqPass,
        liq_adv: r.liqAdv,
        value_play_score: r.valuePlayScore,
        stop_loss: r.stopLoss,
        price_target: r.priceTarget,
        flip_bars_ago: r.flipBarsAgo,
        golden_cross_bars_ago: r.goldenCrossBarsAgo,
        is_buy_now: r.isBuyNow,
        other_data_json: {
          rsi14: r.rsi14, macd: r.macd, macdSignal: r.macdSignal,
          atr14: r.atr14, peRatio: r.peRatio, pbRatio: r.pbRatio,
          dividendYield: r.dividendYield, fiftyTwoWeekHigh: r.fiftyTwoWeekHigh,
          fiftyTwoWeekLow: r.fiftyTwoWeekLow, evToEbitda: r.evToEbitda,
          fcfYieldPct: r.fcfYieldPct, epsGrowthRate: r.epsGrowthRate,
          shareholderYieldPct: r.shareholderYieldPct,
        },
        analytics_json: r.analyticsJson || {},
      }));

      const ranked = await rankStocks(allScanRows);

      if (ranked.length > 0) {
        // Get model version for the record
        const modelInfo = ranked.length > 0 ? 1 : null;

        // Batch insert rankings
        for (const item of ranked) {
          try {
            await query(
              `INSERT INTO ml_rankings
                 (scan_id, ticker_code, ranking_date, predicted_return_10d, rank_position, model_version)
               VALUES ($1, $2, CURRENT_DATE, $3, $4, $5)
               ON CONFLICT (ticker_code, ranking_date) DO UPDATE SET
                 scan_id = EXCLUDED.scan_id,
                 predicted_return_10d = EXCLUDED.predicted_return_10d,
                 rank_position = EXCLUDED.rank_position,
                 model_version = EXCLUDED.model_version`,
              [scanId, item.ticker, item.predictedReturn, item.rank, modelInfo]
            );
            mlRankedCount++;
          } catch (err) {
            console.warn(`[CRON] Ranking insert failed for ${item.ticker}: ${err.message}`);
          }
        }
        console.log(`[CRON] ML stock ranking: ranked ${mlRankedCount}/${results.length} stocks.`);
      } else {
        console.log(`[CRON] ML stock ranking: no trained model available, skipping.`);
      }
    } catch (err) {
      console.warn(`[CRON] ML stock ranking failed: ${err.message}\n${err.stack}`);
    } finally {
      disposeRankerModel();
    }

    // --- ML LSTM v2 Multi-Horizon Predictions (Phase 3) ---
    let lstmPredCount = 0;
    try {
      console.log(`[CRON] Running LSTM v2 predictions for all stocks...`);

      const predResults = await predictLstmV2(allTickers.map((t) => t.code));

      if (predResults && predResults.predictions.size > 0) {
        for (const [ticker, pred] of predResults.predictions) {
          try {
            await query(
              `INSERT INTO predictions
                 (scan_id, ticker_code, prediction_date, predicted_max_30d,
                  predicted_pct_change, confidence, model_type, current_price,
                  predicted_max_5d, predicted_max_10d, predicted_max_20d,
                  uncertainty_5d, uncertainty_10d, uncertainty_20d, uncertainty_30d,
                  model_version, skip_reason)
               VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, 'lstm_v2', $6,
                       $7, $8, $9, $10, $11, $12, $13, $14, NULL)
               ON CONFLICT (ticker_code, prediction_date) DO UPDATE SET
                 scan_id = EXCLUDED.scan_id,
                 predicted_max_30d = EXCLUDED.predicted_max_30d,
                 predicted_pct_change = EXCLUDED.predicted_pct_change,
                 confidence = EXCLUDED.confidence,
                 model_type = EXCLUDED.model_type,
                 current_price = EXCLUDED.current_price,
                 predicted_max_5d = EXCLUDED.predicted_max_5d,
                 predicted_max_10d = EXCLUDED.predicted_max_10d,
                 predicted_max_20d = EXCLUDED.predicted_max_20d,
                 uncertainty_5d = EXCLUDED.uncertainty_5d,
                 uncertainty_10d = EXCLUDED.uncertainty_10d,
                 uncertainty_20d = EXCLUDED.uncertainty_20d,
                 uncertainty_30d = EXCLUDED.uncertainty_30d,
                 model_version = EXCLUDED.model_version,
                 skip_reason = NULL`,
              [
                scanId, ticker,
                pred.predicted_max_30d, pred.predicted_pct_change, pred.confidence,
                pred.current_price,
                pred.predicted_max_5d, pred.predicted_max_10d, pred.predicted_max_20d,
                pred.uncertainty_5d, pred.uncertainty_10d, pred.uncertainty_20d, pred.uncertainty_30d,
                pred.model_version,
              ]
            );
            lstmPredCount++;
          } catch (err) {
            console.warn(`[CRON] LSTM v2 prediction insert failed for ${ticker}: ${err.message}`);
          }
        }
        // Persist skip reasons for tickers that were skipped
        let skipCount = 0;
        for (const [ticker, reason] of predResults.skips) {
          try {
            await query(
              `INSERT INTO predictions
                 (scan_id, ticker_code, prediction_date, skip_reason, model_type)
               VALUES ($1, $2, CURRENT_DATE, $3, 'lstm_v2')
               ON CONFLICT (ticker_code, prediction_date) DO UPDATE SET
                 scan_id = EXCLUDED.scan_id,
                 skip_reason = EXCLUDED.skip_reason,
                 model_type = EXCLUDED.model_type`,
              [scanId, ticker, reason]
            );
            skipCount++;
          } catch (err) {
            // Best effort — don't fail the scan for skip tracking
          }
        }
        console.log(`[CRON] LSTM v2: ${lstmPredCount}/${predResults.predictions.size} predictions, ${skipCount} skip reasons recorded.`);
      } else {
        const noModelReason = "No trained LSTM v2 model available";
        console.log(`[CRON] LSTM v2: ${noModelReason}, falling back to legacy predictions.`);
        // Fall back to legacy per-ticker predictions
        for (const ticker of predictionTickers) {
          try {
            const histResult = await query(
              `SELECT date, close, volume FROM price_history
               WHERE ticker_code = $1 ORDER BY date ASC`,
              [ticker]
            );
            if (histResult.rows.length < 60) {
              await query(
                `INSERT INTO predictions (scan_id, ticker_code, prediction_date, skip_reason, model_type)
                 VALUES ($1, $2, CURRENT_DATE, $3, 'legacy')
                 ON CONFLICT (ticker_code, prediction_date) DO UPDATE SET
                   scan_id = EXCLUDED.scan_id, skip_reason = EXCLUDED.skip_reason, model_type = EXCLUDED.model_type`,
                [scanId, ticker, `Insufficient price history for legacy model (${histResult.rows.length}/60 days)`]
              );
              continue;
            }
            const histData = histResult.rows.map((r) => ({
              price: Number(r.close), volume: Number(r.volume),
            }));
            const pred = await predictForTicker(histData, ticker);
            if (pred.predictedPrice) {
              await query(
                `INSERT INTO predictions
                   (scan_id, ticker_code, prediction_date, predicted_max_30d,
                    predicted_pct_change, confidence, model_type, current_price, skip_reason)
                 VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6, $7, NULL)
                 ON CONFLICT (ticker_code, prediction_date) DO UPDATE SET
                   scan_id = EXCLUDED.scan_id,
                   predicted_max_30d = EXCLUDED.predicted_max_30d,
                   predicted_pct_change = EXCLUDED.predicted_pct_change,
                   confidence = EXCLUDED.confidence,
                   model_type = EXCLUDED.model_type,
                   current_price = EXCLUDED.current_price,
                   skip_reason = NULL`,
                [scanId, ticker, pred.predictedPrice, pred.pctChange, pred.confidence, pred.method, histData[histData.length - 1].price]
              );
              lstmPredCount++;
            } else {
              await query(
                `INSERT INTO predictions (scan_id, ticker_code, prediction_date, skip_reason, model_type)
                 VALUES ($1, $2, CURRENT_DATE, $3, 'legacy')
                 ON CONFLICT (ticker_code, prediction_date) DO UPDATE SET
                   scan_id = EXCLUDED.scan_id, skip_reason = EXCLUDED.skip_reason, model_type = EXCLUDED.model_type`,
                [scanId, ticker, "Legacy model returned no prediction"]
              );
            }
          } catch (err) {
            console.warn(`[CRON] Legacy prediction failed for ${ticker}: ${err.message}`);
            await query(
              `INSERT INTO predictions (scan_id, ticker_code, prediction_date, skip_reason, model_type)
               VALUES ($1, $2, CURRENT_DATE, $3, 'legacy')
               ON CONFLICT (ticker_code, prediction_date) DO NOTHING`,
              [scanId, ticker, `Legacy prediction error: ${err.message}`]
            ).catch(() => {});
          }
        }
        // Record skip for tickers not in legacy set (no model)
        const allCodes = allTickers.map((t) => t.code);
        for (const ticker of allCodes) {
          if (!predictionTickers.has(ticker)) {
            await query(
              `INSERT INTO predictions (scan_id, ticker_code, prediction_date, skip_reason, model_type)
               VALUES ($1, $2, CURRENT_DATE, $3, 'lstm_v2')
               ON CONFLICT (ticker_code, prediction_date) DO NOTHING`,
              [scanId, ticker, noModelReason]
            ).catch(() => {});
          }
        }
        console.log(`[CRON] Legacy predictions: ${lstmPredCount}/${predictionTickers.size} tickers.`);
      }
    } catch (err) {
      console.warn(`[CRON] LSTM v2 predictions failed: ${err.message}\n${err.stack}`);
    } finally {
      disposeLstmV2Model();
    }

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

    const totalElapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`[CRON] All done in ${totalElapsed} min.`);

    await sendMorningReport({ results, myPortfolio, count, buyCount, errors, predCount: lstmPredCount || predCount, mlScoredCount, mlRankedCount, elapsed: totalElapsed, newsReport });
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
