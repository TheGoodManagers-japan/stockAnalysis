// dashboard/engine/ml/stockRanker.js
// Phase 2: Stock Ranking Model
// Ranks all stocks by predicted 10-day forward return.
// Training: runs from train-ml.js (separate job) — uses retroactive features from price_history
// Inference: runs during scan from run-scan.js (loads pre-trained model)

import { query } from "../../lib/db.js";
import { saveModel, loadModel } from "./modelStore.js";
import {
  RETROACTIVE_FEATURE_DIM,
  toDateStr,
  computeIndicatorSeries,
  extractFeaturesAtIndex,
  computeForwardReturn,
  buildSnapshotMap,
  findNearestSnapshot,
} from "./retroactiveFeatures.js";
import {
  extractRetroactiveFeatures,
  computeNormStats,
  applyNormalization,
} from "./features.js";

const MODEL_NAME = "stock_ranker_v1";
const MIN_TRAINING_SAMPLES = 100;
const FEATURE_DIM = RETROACTIVE_FEATURE_DIM;
const SAMPLE_EVERY_N_DAYS = 5; // sample every 5th trading day per ticker
const MAX_TRAINING_SAMPLES = 100000; // cap to avoid memory issues

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
      units: 128,
      activation: "relu",
      inputShape: [inputDim],
      kernelRegularizer: tf.regularizers.l2({ l2: 0.0005 }),
    })
  );
  model.add(tf.layers.batchNormalization());
  model.add(tf.layers.dropout({ rate: 0.3 }));

  model.add(
    tf.layers.dense({
      units: 64,
      activation: "relu",
      kernelRegularizer: tf.regularizers.l2({ l2: 0.0005 }),
    })
  );
  model.add(tf.layers.dropout({ rate: 0.2 }));

  model.add(
    tf.layers.dense({
      units: 32,
      activation: "relu",
    })
  );

  model.add(
    tf.layers.dense({
      units: 1,
      activation: "linear",
    })
  );

  return model;
}

// ─── Training ──────────────────────────────────────────────────

/**
 * Fetch training data retroactively from price_history + stock_snapshots.
 * For each ticker, samples every 5th trading day, computes 26-dim features
 * and forward 10-day return as label.
 *
 * Returns array of { features: Float64Array, label: number }.
 */
async function fetchTrainingData() {
  console.log("[ML] Fetching price_history for stock ranker training...");

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

  // Process tickers in batches
  const BATCH_SIZE = 50;
  const allSamples = [];

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

    // Fetch stock snapshots for batch
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

      // Sample every Nth day, leaving 10-day forward window for labeling
      for (let i = 200; i < prices.length - 10; i += SAMPLE_EVERY_N_DAYS) {
        const dateStr = toDateStr(prices[i].date);
        const snapshot = findNearestSnapshot(snapshotMap, dateStr);

        const features = extractFeaturesAtIndex(indicators, i, snapshot);
        if (!features) continue;

        // Forward 10-day return (close-to-close)
        const fwdReturn = computeForwardReturn(indicators.closes, i, 10);
        if (fwdReturn == null || !isFinite(fwdReturn)) continue;

        allSamples.push({ features, label: fwdReturn, volRatio: indicators.volRatio[i] });
      }
    }

    console.log(`[ML] Processed batch ${b / BATCH_SIZE + 1}/${Math.ceil(tickers.length / BATCH_SIZE)}: ${allSamples.length} samples so far`);
  }

  // Subsample if too large
  if (allSamples.length > MAX_TRAINING_SAMPLES) {
    console.log(`[ML] Subsampling from ${allSamples.length} to ${MAX_TRAINING_SAMPLES} samples`);
    const step = allSamples.length / MAX_TRAINING_SAMPLES;
    const subsampled = [];
    for (let i = 0; i < MAX_TRAINING_SAMPLES; i++) {
      subsampled.push(allSamples[Math.floor(i * step)]);
    }
    console.log(`[ML] Stock ranker training data: ${subsampled.length} samples (subsampled from ${allSamples.length}, ${tickers.length} tickers)`);
    return subsampled;
  }

  console.log(`[ML] Stock ranker training data: ${allSamples.length} samples from ${tickers.length} tickers`);
  return allSamples;
}

/**
 * Compute NDCG@k for evaluation.
 */
function computeNDCG(predicted, actual, k = 10) {
  const paired = predicted.map((p, i) => ({ pred: p, actual: actual[i] }));
  paired.sort((a, b) => b.pred - a.pred);

  let dcg = 0;
  for (let i = 0; i < Math.min(k, paired.length); i++) {
    dcg += (Math.pow(2, Math.max(0, paired[i].actual)) - 1) / Math.log2(i + 2);
  }

  const ideal = [...paired].sort((a, b) => b.actual - a.actual);
  let idcg = 0;
  for (let i = 0; i < Math.min(k, ideal.length); i++) {
    idcg += (Math.pow(2, Math.max(0, ideal[i].actual)) - 1) / Math.log2(i + 2);
  }

  return idcg > 0 ? dcg / idcg : 0;
}

/**
 * Compute hit rate: what % of top-k picks had return > threshold.
 */
function computeHitRate(predicted, actual, k = 10, threshold = 3.0) {
  const paired = predicted.map((p, i) => ({ pred: p, actual: actual[i] }));
  paired.sort((a, b) => b.pred - a.pred);
  const topK = paired.slice(0, k);
  const hits = topK.filter((p) => p.actual >= threshold).length;
  return k > 0 ? hits / k : 0;
}

/**
 * Train the stock ranking model.
 * Called from train-ml.js.
 */
export async function train() {
  await ensureTF();

  const samples = await fetchTrainingData();
  if (samples.length < MIN_TRAINING_SAMPLES) {
    console.log(`[ML] Insufficient training data (${samples.length} < ${MIN_TRAINING_SAMPLES}). Skipping stock ranker training.`);
    return { skipped: true, reason: "insufficient_data", samples: samples.length };
  }

  // Winsorize outlier returns (2nd/98th percentile instead of hard clipping)
  const rawLabels = samples.map((s) => s.label);
  const sortedLabels = [...rawLabels].sort((a, b) => a - b);
  const p2 = sortedLabels[Math.floor(sortedLabels.length * 0.02)];
  const p98 = sortedLabels[Math.floor(sortedLabels.length * 0.98)];
  console.log(`[ML] Winsorizing returns to [${p2.toFixed(1)}, ${p98.toFixed(1)}] (2nd/98th percentile)`);
  for (const s of samples) {
    s.label = Math.max(p2, Math.min(p98, s.label));
  }

  // Compute normalization stats
  const featureVectors = samples.map((s) => s.features);
  const normStats = computeNormStats(featureVectors);

  // Normalize features
  const normalizedFeatures = featureVectors.map((f) => applyNormalization(f, normStats));

  // Normalize targets (returns) for better training
  const labels = samples.map((s) => s.label);
  const labelMean = labels.reduce((s, v) => s + v, 0) / labels.length;
  const labelStd = Math.sqrt(labels.reduce((s, v) => s + (v - labelMean) ** 2, 0) / labels.length) || 1;
  const normalizedLabels = labels.map((l) => (l - labelMean) / labelStd);

  // Time-series split (80/20 chronological)
  const splitIdx = Math.floor(samples.length * 0.8);
  const n = samples.length;

  // Build tensors using Float32Array for memory efficiency
  const xTrainData = new Float32Array(splitIdx * FEATURE_DIM);
  for (let i = 0; i < splitIdx; i++) {
    for (let j = 0; j < FEATURE_DIM; j++) {
      xTrainData[i * FEATURE_DIM + j] = normalizedFeatures[i][j];
    }
  }
  const valSize = n - splitIdx;
  const xValData = new Float32Array(valSize * FEATURE_DIM);
  for (let i = 0; i < valSize; i++) {
    for (let j = 0; j < FEATURE_DIM; j++) {
      xValData[i * FEATURE_DIM + j] = normalizedFeatures[splitIdx + i][j];
    }
  }

  const yTrainData = new Float32Array(normalizedLabels.slice(0, splitIdx));
  const yValData = new Float32Array(normalizedLabels.slice(splitIdx));
  const yValActual = labels.slice(splitIdx); // un-normalized for metrics

  const xTrain = tf.tensor2d(xTrainData, [splitIdx, FEATURE_DIM]);
  const yTrain = tf.tensor2d(yTrainData, [splitIdx, 1]);
  const xVal = tf.tensor2d(xValData, [valSize, FEATURE_DIM]);
  const yVal = tf.tensor2d(yValData, [valSize, 1]);

  // Pairwise ranking loss — penalizes when higher-return stock is ranked lower
  // Uses ListNet-style softmax cross-entropy on sampled pairs within each batch
  function pairwiseRankingLoss(yTrue, yPred) {
    // MSE component for absolute accuracy
    const mse = yTrue.sub(yPred).square().mean();
    // Pairwise component — approximate via correlation loss
    const yMean = yTrue.mean();
    const pMean = yPred.mean();
    const yDev = yTrue.sub(yMean);
    const pDev = yPred.sub(pMean);
    const cov = yDev.mul(pDev).mean();
    const yStd = yDev.square().mean().sqrt().add(1e-7);
    const pStd = pDev.square().mean().sqrt().add(1e-7);
    const corr = cov.div(yStd.mul(pStd));
    // Loss = MSE - lambda * correlation (maximize correlation = minimize ranking errors)
    return mse.sub(corr.mul(0.5));
  }

  // Build and compile model
  const model = buildModel({ inputDim: FEATURE_DIM });
  model.compile({
    optimizer: tf.train.adam(0.0005),
    loss: pairwiseRankingLoss,
  });

  console.log(`[ML] Training stock ranker: ${splitIdx} train, ${valSize} val`);

  const history = await model.fit(xTrain, yTrain, {
    epochs: 100,
    batchSize: Math.min(128, Math.floor(splitIdx / 4)),
    validationData: [xVal, yVal],
    callbacks: [
      tf.callbacks.earlyStopping({
        monitor: "val_loss",
        patience: 10,
      }),
    ],
    verbose: 0,
  });

  // Evaluate on validation set
  const valPredsTensor = model.predict(xVal);
  const valPredsNorm = Array.from(valPredsTensor.dataSync());
  // Denormalize predictions
  const valPreds = valPredsNorm.map((p) => p * labelStd + labelMean);

  const mae = valPreds.reduce((s, p, i) => s + Math.abs(p - yValActual[i]), 0) / yValActual.length;
  const ndcg10 = computeNDCG(valPreds, yValActual, 10);
  const ndcg20 = computeNDCG(valPreds, yValActual, 20);
  const hitRate10 = computeHitRate(valPreds, yValActual, 10, 3.0);

  const finalEpoch = history.history.val_loss.length;
  const valLoss = history.history.val_loss[finalEpoch - 1];

  const metrics = {
    mae: Math.round(mae * 100) / 100,
    val_loss: Math.round(valLoss * 10000) / 10000,
    ndcg_10: Math.round(ndcg10 * 1000) / 1000,
    ndcg_20: Math.round(ndcg20 * 1000) / 1000,
    hit_rate_10_3pct: Math.round(hitRate10 * 1000) / 1000,
    epochs_trained: finalEpoch,
    total_samples: samples.length,
  };

  console.log(`[ML] Stock ranker metrics:`, metrics);

  // Save model with label normalization params
  const version = await saveModel(model, MODEL_NAME, {
    architecture: { inputDim: FEATURE_DIM, type: "stock_ranker" },
    normalization: { ...normStats, labelMean, labelStd },
    metrics,
    trainingSamples: samples.length,
  });

  // Clean up
  xTrain.dispose();
  yTrain.dispose();
  xVal.dispose();
  yVal.dispose();
  valPredsTensor.dispose();
  model.dispose();

  return { version, metrics, samples: samples.length };
}

// ─── Inference ─────────────────────────────────────────────────

let _cachedModel = null;

/**
 * Load the stock ranker model (cached for the scan session).
 */
export async function loadRankerModel() {
  await ensureTF();
  if (_cachedModel) return _cachedModel;

  const loaded = await loadModel(MODEL_NAME, (arch) => {
    const model = buildModel(arch);
    model.compile({
      optimizer: tf.train.adam(0.0005),
      loss: "meanSquaredError",
    });
    return model;
  });

  if (!loaded) return null;
  _cachedModel = loaded;
  return loaded;
}

/**
 * Rank all stocks by predicted 10-day return.
 * Returns array of { ticker, predictedReturn, rank } sorted by predicted return desc.
 *
 * @param {Object[]} scanResults - Array of scan_results-shaped objects (all stocks, not just buys)
 * @returns {{ ticker: string, predictedReturn: number, rank: number }[]}
 */
export async function rankStocks(scanResults) {
  const modelData = await loadRankerModel();
  if (!modelData) return [];

  const { model, normalization } = modelData;
  const { labelMean = 0, labelStd = 1, ...featureNormStats } = normalization;
  const validEntries = [];

  for (const row of scanResults) {
    if (typeof row.other_data_json === "string") {
      row.other_data_json = JSON.parse(row.other_data_json);
    }
    if (typeof row.analytics_json === "string") {
      row.analytics_json = JSON.parse(row.analytics_json);
    }

    const features = extractRetroactiveFeatures(row);
    if (features) {
      const normalized = applyNormalization(features, featureNormStats);
      validEntries.push({ ticker: row.ticker_code || row.ticker, normalized });
    }
  }

  if (!validEntries.length) return [];

  // Batch predict
  const inputData = new Float32Array(validEntries.length * FEATURE_DIM);
  for (let i = 0; i < validEntries.length; i++) {
    for (let j = 0; j < FEATURE_DIM; j++) {
      inputData[i * FEATURE_DIM + j] = validEntries[i].normalized[j];
    }
  }
  const inputTensor = tf.tensor2d(inputData, [validEntries.length, FEATURE_DIM]);
  const predictions = model.predict(inputTensor);
  const values = predictions.dataSync();

  // Denormalize and build results
  const ranked = validEntries.map((e, i) => ({
    ticker: e.ticker,
    predictedReturn: Math.round((values[i] * labelStd + labelMean) * 100) / 100,
  }));

  // Sort by predicted return descending
  ranked.sort((a, b) => b.predictedReturn - a.predictedReturn);

  // Assign ranks
  ranked.forEach((r, i) => { r.rank = i + 1; });

  inputTensor.dispose();
  predictions.dispose();

  return ranked;
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
