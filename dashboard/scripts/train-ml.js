#!/usr/bin/env node

// dashboard/scripts/train-ml.js
// Standalone ML training script — runs separately from the scan.
// Usage: DATABASE_URL=... node scripts/train-ml.js [--model signal_quality|stock_ranker|lstm_v2|all]
//
// Designed to run as a Modal cron (e.g., Saturday night) or on-demand via API.
// Trains models using historical data from the database, saves weights to ml_models table.

import { query } from "../lib/db.js";
import { getModelInfo } from "../engine/ml/modelStore.js";
import { train as trainSignalQuality } from "../engine/ml/signalQuality.js";
import { train as trainStockRanker } from "../engine/ml/stockRanker.js";
import { train as trainLstmV2 } from "../engine/ml/lstmV2Train.js";

// ─── CLI argument parsing ──────────────────────────────────────

const args = process.argv.slice(2);
let targetModel = "all";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--model" && args[i + 1]) {
    targetModel = args[i + 1];
    i++;
  }
}

// ─── Main ──────────────────────────────────────────────────────

async function runTraining() {
  const startTime = Date.now();
  console.log(`[TRAIN] Starting ML training pipeline (target: ${targetModel})`);
  console.log(`[TRAIN] Time: ${new Date().toISOString()}`);

  // Ensure ml_models table exists
  await query(`
    CREATE TABLE IF NOT EXISTS ml_models (
      id              BIGSERIAL PRIMARY KEY,
      model_name      TEXT NOT NULL,
      model_version   INTEGER NOT NULL DEFAULT 1,
      architecture    JSONB NOT NULL,
      weights_json    JSONB NOT NULL,
      normalization   JSONB,
      metrics         JSONB,
      training_samples INTEGER,
      trained_at      TIMESTAMPTZ DEFAULT NOW(),
      is_active       BOOLEAN DEFAULT TRUE,
      UNIQUE(model_name, model_version)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_ml_models_active ON ml_models(model_name, is_active)`);

  // Ensure ml_rankings table exists (Phase 2)
  await query(`
    CREATE TABLE IF NOT EXISTS ml_rankings (
      id                      BIGSERIAL PRIMARY KEY,
      scan_id                 UUID,
      ticker_code             TEXT NOT NULL,
      ranking_date            DATE NOT NULL DEFAULT CURRENT_DATE,
      predicted_return_10d    NUMERIC(8,4),
      rank_position           INTEGER,
      model_version           INTEGER,
      created_at              TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(ticker_code, ranking_date)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_ml_rankings_date ON ml_rankings(ranking_date DESC, rank_position ASC)`);

  // Ensure multi-horizon prediction columns exist (Phase 3)
  const alterCols = [
    "predicted_max_5d NUMERIC(14,4)", "predicted_max_10d NUMERIC(14,4)", "predicted_max_20d NUMERIC(14,4)",
    "uncertainty_5d NUMERIC(8,4)", "uncertainty_10d NUMERIC(8,4)", "uncertainty_20d NUMERIC(8,4)", "uncertainty_30d NUMERIC(8,4)",
    "model_version INTEGER",
  ];
  for (const col of alterCols) {
    await query(`ALTER TABLE predictions ADD COLUMN IF NOT EXISTS ${col}`).catch(() => {});
  }

  const results = {};

  // ── Phase 1: Signal Quality ────────────────────────────────
  if (targetModel === "all" || targetModel === "signal_quality") {
    console.log("\n[TRAIN] ═══ Phase 1: Signal Quality Model ═══");
    try {
      const info = await getModelInfo("signal_quality_v1");
      if (info) {
        console.log(`[TRAIN] Current model: v${info.version}, trained ${info.trainedAt}, ${info.trainingSamples} samples`);
      } else {
        console.log("[TRAIN] No existing model found — first training.");
      }

      const result = await trainSignalQuality();
      results.signal_quality = result;

      if (result.skipped) {
        console.log(`[TRAIN] Signal quality: SKIPPED (${result.reason}, ${result.samples} samples available)`);
      } else {
        console.log(`[TRAIN] Signal quality: v${result.version} trained on ${result.samples} samples`);
        console.log(`[TRAIN] Metrics: accuracy=${result.metrics.accuracy}, val_loss=${result.metrics.val_loss}`);
      }
    } catch (err) {
      console.error(`[TRAIN] Signal quality FAILED:`, err.message);
      results.signal_quality = { error: err.message };
    }
  }

  // ── Phase 2: Stock Ranker ──────────────────────────────────
  if (targetModel === "all" || targetModel === "stock_ranker") {
    console.log("\n[TRAIN] ═══ Phase 2: Stock Ranker Model ═══");
    try {
      const info = await getModelInfo("stock_ranker_v1");
      if (info) {
        console.log(`[TRAIN] Current model: v${info.version}, trained ${info.trainedAt}, ${info.trainingSamples} samples`);
      } else {
        console.log("[TRAIN] No existing model found — first training.");
      }

      const result = await trainStockRanker();
      results.stock_ranker = result;

      if (result.skipped) {
        console.log(`[TRAIN] Stock ranker: SKIPPED (${result.reason}, ${result.samples} samples available)`);
      } else {
        console.log(`[TRAIN] Stock ranker: v${result.version} trained on ${result.samples} samples`);
        console.log(`[TRAIN] Metrics: mae=${result.metrics.mae}, ndcg_10=${result.metrics.ndcg_10}, hit_rate=${result.metrics.hit_rate_10_3pct}`);
      }
    } catch (err) {
      console.error(`[TRAIN] Stock ranker FAILED:`, err.message);
      results.stock_ranker = { error: err.message };
    }
  }

  // ── Phase 3: LSTM v2 Price Forecaster ─────────────────────
  if (targetModel === "all" || targetModel === "lstm_v2") {
    console.log("\n[TRAIN] ═══ Phase 3: LSTM v2 Price Forecaster ═══");
    try {
      const info = await getModelInfo("lstm_v2");
      if (info) {
        console.log(`[TRAIN] Current model: v${info.version}, trained ${info.trainedAt}, ${info.trainingSamples} samples`);
      } else {
        console.log("[TRAIN] No existing model found — first training.");
      }

      const result = await trainLstmV2();
      results.lstm_v2 = result;

      if (result.skipped) {
        console.log(`[TRAIN] LSTM v2: SKIPPED (${result.reason}, ${result.samples || 0} samples available)`);
      } else {
        console.log(`[TRAIN] LSTM v2: v${result.version} trained on ${result.samples} samples (${result.tickers} tickers)`);
        console.log(`[TRAIN] Metrics: val_loss=${result.metrics.val_loss}, mae_5d=${result.metrics.mae_5d}, mae_30d=${result.metrics.mae_30d}`);
      }
    } catch (err) {
      console.error(`[TRAIN] LSTM v2 FAILED:`, err.message);
      results.lstm_v2 = { error: err.message };
    }
  }

  // ── Summary ────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[TRAIN] ═══ Training Complete ═══`);
  console.log(`[TRAIN] Elapsed: ${elapsed}s`);
  console.log(`[TRAIN] Results:`, JSON.stringify(results, null, 2));

  return results;
}

runTraining()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[TRAIN] Fatal error:", err);
    process.exit(1);
  });
