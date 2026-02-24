// dashboard/engine/ml/signalQuality.js
// Phase 1: Signal Quality Scoring
// Predicts probability (0-1) that a buy signal will reach its target before its stop.
// Training: runs from train-ml.js (separate job) — uses retroactive features from price_history
// Inference: runs during scan from run-scan.js (loads pre-trained model)

import { query } from "../../lib/db.js";
import { saveModel, loadModel } from "./modelStore.js";
import {
  RETROACTIVE_FEATURE_DIM,
  toDateStr,
  computeIndicatorSeries,
  extractFeaturesAtIndex,
  isEntryLikeCondition,
  labelEntryOutcome,
  buildSnapshotMap,
  findNearestSnapshot,
} from "./retroactiveFeatures.js";
import {
  extractRetroactiveFeatures,
  computeNormStats,
  applyNormalization,
} from "./features.js";

const MODEL_NAME = "signal_quality_v1";
const MIN_TRAINING_SAMPLES = 30;
const FEATURE_DIM = RETROACTIVE_FEATURE_DIM;

let tf;
async function ensureTF() {
  if (tf) return tf;
  try {
    tf = await import("@tensorflow/tfjs-node");
  } catch {
    tf = await import("@tensorflow/tfjs");
  }
  return tf;
}

// ─── Model Architecture ────────────────────────────────────────

function buildModel(archConfig = {}) {
  const inputDim = archConfig.inputDim || FEATURE_DIM;
  const model = tf.sequential();

  model.add(
    tf.layers.dense({
      units: 64,
      activation: "relu",
      inputShape: [inputDim],
      kernelRegularizer: tf.regularizers.l2({ l2: 0.001 }),
    })
  );
  model.add(tf.layers.batchNormalization());
  model.add(tf.layers.dropout({ rate: 0.3 }));

  model.add(
    tf.layers.dense({
      units: 32,
      activation: "relu",
      kernelRegularizer: tf.regularizers.l2({ l2: 0.001 }),
    })
  );
  model.add(tf.layers.dropout({ rate: 0.2 }));

  model.add(
    tf.layers.dense({
      units: 1,
      activation: "sigmoid",
    })
  );

  return model;
}

// ─── Training ──────────────────────────────────────────────────

/**
 * Fetch training data retroactively from price_history + stock_snapshots.
 * For each ticker, computes indicator series, detects entry-like conditions,
 * and labels outcomes based on forward price movement.
 *
 * Returns array of { features: Float64Array, label: number }.
 */
async function fetchTrainingData() {
  console.log("[ML] Fetching price_history for all tickers...");

  // Get all tickers with sufficient price history
  const tickerResult = await query(
    `SELECT ticker_code, COUNT(*) AS cnt
     FROM price_history
     GROUP BY ticker_code
     HAVING COUNT(*) >= 250
     ORDER BY ticker_code`
  );

  const tickers = tickerResult.rows.map((r) => r.ticker_code);
  console.log(`[ML] Found ${tickers.length} tickers with 250+ price rows`);

  // Process tickers in batches to avoid memory pressure
  const BATCH_SIZE = 50;
  const allSamples = [];
  let totalEntries = 0;

  for (let b = 0; b < tickers.length; b += BATCH_SIZE) {
    const batch = tickers.slice(b, b + BATCH_SIZE);

    // Fetch price history for batch
    const priceResult = await query(
      `SELECT ticker_code, date, open, high, low, close, volume
       FROM price_history
       WHERE ticker_code = ANY($1)
       ORDER BY ticker_code, date ASC`,
      [batch]
    );

    // Fetch stock snapshots for batch (for fundamental features)
    const snapResult = await query(
      `SELECT ticker_code, snapshot_date, pe_ratio, pb_ratio, dividend_yield
       FROM stock_snapshots
       WHERE ticker_code = ANY($1)
       ORDER BY ticker_code, snapshot_date ASC`,
      [batch]
    );

    // Group by ticker
    const pricesByTicker = new Map();
    for (const row of priceResult.rows) {
      const arr = pricesByTicker.get(row.ticker_code) || [];
      arr.push(row);
      pricesByTicker.set(row.ticker_code, arr);
    }

    const snapsByTicker = new Map();
    for (const row of snapResult.rows) {
      const arr = snapsByTicker.get(row.ticker_code) || [];
      arr.push(row);
      snapsByTicker.set(row.ticker_code, arr);
    }

    // Process each ticker
    for (const ticker of batch) {
      const prices = pricesByTicker.get(ticker);
      if (!prices || prices.length < 250) continue;

      const indicators = computeIndicatorSeries(prices);
      const snapshotMap = buildSnapshotMap(snapsByTicker.get(ticker) || []);

      // Scan for entry-like conditions
      // Leave 30-day forward window for labeling
      for (let i = 200; i < prices.length - 30; i++) {
        if (!isEntryLikeCondition(indicators, i)) continue;
        totalEntries++;

        const dateStr = toDateStr(prices[i].date);
        const snapshot = findNearestSnapshot(snapshotMap, dateStr);

        const features = extractFeaturesAtIndex(indicators, i, snapshot);
        if (!features) continue;

        // Label: did price hit +5% before -3% within 30 days?
        const label = labelEntryOutcome(
          indicators.closes, indicators.highs, indicators.lows,
          i, 5, 3, 30
        );
        if (label == null) continue;

        allSamples.push({ features, label });
      }
    }

    console.log(`[ML] Processed batch ${b / BATCH_SIZE + 1}/${Math.ceil(tickers.length / BATCH_SIZE)}: ${allSamples.length} samples so far (${totalEntries} entries detected)`);
  }

  console.log(`[ML] Signal quality training data: ${allSamples.length} labeled entries from ${totalEntries} detected (${tickers.length} tickers)`);
  return allSamples;
}

/**
 * Train the signal quality model.
 * Called from train-ml.js (standalone training script).
 */
export async function train() {
  await ensureTF();

  const samples = await fetchTrainingData();
  if (samples.length < MIN_TRAINING_SAMPLES) {
    console.log(`[ML] Insufficient training data (${samples.length} < ${MIN_TRAINING_SAMPLES}). Skipping signal quality training.`);
    return { skipped: true, reason: "insufficient_data", samples: samples.length };
  }

  // Compute normalization stats
  const featureVectors = samples.map((s) => s.features);
  const normStats = computeNormStats(featureVectors);

  // Normalize features
  const normalizedFeatures = featureVectors.map((f) => applyNormalization(f, normStats));

  // Class balance stats
  const posCount = samples.filter((s) => s.label > 0.5).length;
  const negCount = samples.length - posCount;
  const posWeight = negCount / (posCount || 1);

  // Build tensors using Float32Array for memory efficiency
  const n = samples.length;
  const xData = new Float32Array(n * FEATURE_DIM);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < FEATURE_DIM; j++) {
      xData[i * FEATURE_DIM + j] = normalizedFeatures[i][j];
    }
  }
  const yData = new Float32Array(samples.map((s) => s.label));

  const xTensor = tf.tensor2d(xData, [n, FEATURE_DIM]);
  const yTensor = tf.tensor2d(yData, [n, 1]);

  // Focal loss — addresses class imbalance by down-weighting easy examples
  const alpha = posWeight > 1.5 ? 0.35 : 0.25; // higher alpha when more imbalanced
  function focalLoss(yTrue, yPred) {
    const gamma = 2.0;
    const p = yPred.clipByValue(1e-7, 1 - 1e-7);
    const bce = yTrue.mul(p.log().neg()).add(
      yTrue.mul(-1).add(1).mul(p.mul(-1).add(1).log().neg())
    );
    const pt = yTrue.mul(p).add(yTrue.mul(-1).add(1).mul(p.mul(-1).add(1)));
    return pt.mul(-1).add(1).pow(gamma).mul(bce).mul(alpha).mean();
  }

  // Build and compile model
  const model = buildModel({ inputDim: FEATURE_DIM });
  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: focalLoss,
    metrics: ["accuracy"],
  });

  // Train with time-series split (chronological)
  const splitIdx = Math.floor(n * 0.8);
  const xTrain = xTensor.slice([0, 0], [splitIdx, -1]);
  const yTrain = yTensor.slice([0, 0], [splitIdx, -1]);
  const xVal = xTensor.slice([splitIdx, 0], [-1, -1]);
  const yVal = yTensor.slice([splitIdx, 0], [-1, -1]);

  console.log(`[ML] Training signal quality model: ${splitIdx} train, ${n - splitIdx} val`);

  const history = await model.fit(xTrain, yTrain, {
    epochs: 100,
    batchSize: Math.min(64, Math.floor(splitIdx / 4)),
    validationData: [xVal, yVal],
    callbacks: [
      tf.callbacks.earlyStopping({
        monitor: "val_loss",
        patience: 10,
      }),
    ],
    verbose: 0,
  });

  // Evaluate
  const valPreds = model.predict(xVal).dataSync();
  const valLabels = yVal.dataSync();
  let correct = 0;
  for (let i = 0; i < valLabels.length; i++) {
    const pred = valPreds[i] > 0.5 ? 1 : 0;
    const actual = valLabels[i] > 0.5 ? 1 : 0;
    if (pred === actual) correct++;
  }
  const valAccuracy = valLabels.length > 0 ? correct / valLabels.length : 0;

  const finalEpoch = history.history.val_loss.length;
  const valLoss = history.history.val_loss[finalEpoch - 1];

  const metrics = {
    accuracy: Math.round(valAccuracy * 1000) / 1000,
    val_loss: Math.round(valLoss * 10000) / 10000,
    epochs_trained: finalEpoch,
    pos_samples: posCount,
    neg_samples: negCount,
    pos_weight: Math.round(posWeight * 100) / 100,
  };

  console.log(`[ML] Signal quality model metrics:`, metrics);

  // Save to database
  const version = await saveModel(model, MODEL_NAME, {
    architecture: { inputDim: FEATURE_DIM, type: "signal_quality" },
    normalization: normStats,
    metrics,
    trainingSamples: samples.length,
  });

  // Clean up tensors
  xTensor.dispose();
  yTensor.dispose();
  xTrain.dispose();
  yTrain.dispose();
  xVal.dispose();
  yVal.dispose();
  model.dispose();

  return { version, metrics, samples: samples.length };
}

// ─── Inference ─────────────────────────────────────────────────

let _cachedModel = null;

/**
 * Load the signal quality model (cached for the scan session).
 * Returns the model object or null if not trained yet.
 */
export async function loadSignalQualityModel() {
  await ensureTF();
  if (_cachedModel) return _cachedModel;

  const loaded = await loadModel(MODEL_NAME, (arch) => {
    const model = buildModel(arch);
    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: "binaryCrossentropy",
    });
    return model;
  });

  if (!loaded) return null;
  _cachedModel = loaded;
  return loaded;
}

/**
 * Predict signal quality for a single stock scan result.
 * Returns confidence (0-1) or null if model not available.
 *
 * @param {Object} scanResult - A scan_results-shaped object with other_data_json parsed
 * @returns {number | null}
 */
export async function predict(scanResult) {
  const modelData = await loadSignalQualityModel();
  if (!modelData) return null;

  const { model, normalization } = modelData;

  // Parse other_data_json if needed
  if (typeof scanResult.other_data_json === "string") {
    scanResult.other_data_json = JSON.parse(scanResult.other_data_json);
  }

  const features = extractRetroactiveFeatures(scanResult);
  if (!features) return null;

  const normalized = applyNormalization(features, normalization);
  const inputTensor = tf.tensor2d([Array.from(normalized)], [1, FEATURE_DIM]);
  const prediction = model.predict(inputTensor);
  const confidence = prediction.dataSync()[0];

  inputTensor.dispose();
  prediction.dispose();

  return Math.round(confidence * 1000) / 1000;
}

/**
 * Batch predict signal quality for multiple scan results.
 * More efficient than individual predictions — single tensor operation.
 *
 * @param {Object[]} scanResults - Array of scan_results-shaped objects
 * @returns {Map<string, number>} Map of ticker → confidence
 */
export async function predictBatch(scanResults) {
  const modelData = await loadSignalQualityModel();
  if (!modelData) return new Map();

  const { model, normalization } = modelData;
  const results = new Map();
  const validEntries = [];

  for (const row of scanResults) {
    if (typeof row.other_data_json === "string") {
      row.other_data_json = JSON.parse(row.other_data_json);
    }
    const features = extractRetroactiveFeatures(row);
    if (features) {
      const normalized = applyNormalization(features, normalization);
      validEntries.push({ ticker: row.ticker_code || row.ticker, normalized });
    }
  }

  if (!validEntries.length) return results;

  const inputData = new Float32Array(validEntries.length * FEATURE_DIM);
  for (let i = 0; i < validEntries.length; i++) {
    for (let j = 0; j < FEATURE_DIM; j++) {
      inputData[i * FEATURE_DIM + j] = validEntries[i].normalized[j];
    }
  }
  const inputTensor = tf.tensor2d(inputData, [validEntries.length, FEATURE_DIM]);
  const predictions = model.predict(inputTensor);
  const values = predictions.dataSync();

  for (let i = 0; i < validEntries.length; i++) {
    results.set(validEntries[i].ticker, Math.round(values[i] * 1000) / 1000);
  }

  inputTensor.dispose();
  predictions.dispose();

  return results;
}

/**
 * Dispose the cached model. Call at end of scan session.
 */
export function disposeModel() {
  if (_cachedModel) {
    _cachedModel.model.dispose();
    _cachedModel = null;
  }
}
