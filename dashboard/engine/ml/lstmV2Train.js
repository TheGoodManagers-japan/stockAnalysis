// dashboard/engine/ml/lstmV2Train.js
// Phase 3: LSTM v2 Price Forecaster — Training Module
// Pooled training across all tickers, multi-horizon output with uncertainty.
// Training: runs from train-ml.js (separate job)

import { query } from "../../lib/db.js";
import { saveModel, loadModel } from "./modelStore.js";
import { median, iqr, clamp, safeNum } from "./normalization.js";

const MODEL_NAME = "lstm_v2";
const MIN_TICKERS = 20;
const SEQUENCE_LENGTH = 30; // kept at 30 — pure JS TF can't handle 45 without OOM
const HORIZONS = [5, 10, 20, 30]; // prediction horizons in days
const FEATURE_DIM = 12;
const OUTPUT_DIM = HORIZONS.length * 2; // pred + logvar per horizon = 8
const MAX_TRAINING_SEQUENCES = 12000; // reduced for pure JS TF memory limits

let tf;
export async function ensureTF() {
  if (tf) return tf;
  try {
    tf = await import("@tensorflow/tfjs-node");
  } catch {
    tf = await import("@tensorflow/tfjs");
  }
  return tf;
}

// ─── Feature Engineering ────────────────────────────────────────

function computeSMA(arr, window) {
  const sma = [];
  for (let i = 0; i < arr.length; i++) {
    const start = Math.max(0, i - window + 1);
    const subset = arr.slice(start, i + 1);
    sma.push(subset.reduce((s, v) => s + v, 0) / subset.length);
  }
  return sma;
}

function computeEMA(arr, period) {
  const k = 2 / (period + 1);
  const ema = [arr[0]];
  for (let i = 1; i < arr.length; i++) {
    ema.push(arr[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function computeRSI(closes, period = 14) {
  const rsi = new Array(closes.length).fill(50);
  if (closes.length < period + 1) return rsi;

  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period; i < closes.length; i++) {
    if (i > period) {
      const change = closes[i] - closes[i - 1];
      avgGain = (avgGain * (period - 1) + Math.max(0, change)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(0, -change)) / period;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi[i] = 100 - 100 / (1 + rs);
  }
  return rsi;
}

function computeMACD(closes) {
  const ema12 = computeEMA(closes, 12);
  const ema26 = computeEMA(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signal = computeEMA(macdLine, 9);
  return macdLine.map((v, i) => v - signal[i]); // histogram
}

function computeATR(highs, lows, closes, period = 14) {
  const tr = [highs[0] - lows[0]];
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ));
  }
  const atr = [tr[0]];
  for (let i = 1; i < tr.length; i++) {
    if (i < period) {
      atr.push(tr.slice(0, i + 1).reduce((s, v) => s + v, 0) / (i + 1));
    } else {
      atr.push((atr[i - 1] * (period - 1) + tr[i]) / period);
    }
  }
  return atr;
}

function computeBollingerBandWidth(closes, period = 20) {
  const sma = computeSMA(closes, period);
  return closes.map((c, i) => {
    const start = Math.max(0, i - period + 1);
    const slice = closes.slice(start, i + 1);
    const mean = sma[i];
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / slice.length) || 1;
    return (2 * std * 2) / (mean || 1); // band width as % of price
  });
}

function computeStochastic(highs, lows, closes, period = 14) {
  return closes.map((c, i) => {
    const start = Math.max(0, i - period + 1);
    const hSlice = highs.slice(start, i + 1);
    const lSlice = lows.slice(start, i + 1);
    const hh = Math.max(...hSlice);
    const ll = Math.min(...lSlice);
    return hh === ll ? 50 : ((c - ll) / (hh - ll)) * 100;
  });
}

function computeOBV(closes, volumes) {
  const obv = [0];
  for (let i = 1; i < closes.length; i++) {
    const sign = closes[i] > closes[i - 1] ? 1 : closes[i] < closes[i - 1] ? -1 : 0;
    obv.push(obv[i - 1] + sign * volumes[i]);
  }
  return obv;
}

/**
 * Build 12-feature sequences for a single ticker.
 * Features: logReturn, volumeZ, RSI/100, MACDhist/price, bollingerWidth,
 * stochasticK/100, ATR%/price, OBV-z, priceVsMA25%, MA25slope, logPrice, volRatio
 */
function buildFeatures(prices) {
  const closes = prices.map((p) => p.close);
  const highs = prices.map((p) => p.high || p.close);
  const lows = prices.map((p) => p.low || p.close);
  const volumes = prices.map((p) => p.volume || 0);

  const logReturns = [0, ...closes.slice(1).map((c, i) => Math.log(c / closes[i]))];
  const rsi = computeRSI(closes);
  const macdHist = computeMACD(closes);
  const atr = computeATR(highs, lows, closes);
  const bbWidth = computeBollingerBandWidth(closes);
  const stochK = computeStochastic(highs, lows, closes);
  const obv = computeOBV(closes, volumes);
  const ma25 = computeSMA(closes, 25);

  // Volume Z-score (20-day rolling)
  const volZ = volumes.map((v, i) => {
    const start = Math.max(0, i - 19);
    const slice = volumes.slice(start, i + 1);
    const mean = slice.reduce((s, x) => s + x, 0) / slice.length;
    const std = Math.sqrt(slice.reduce((s, x) => s + (x - mean) ** 2, 0) / slice.length) || 1;
    return (v - mean) / std;
  });

  // OBV Z-score (20-day rolling)
  const obvZ = obv.map((v, i) => {
    const start = Math.max(0, i - 19);
    const slice = obv.slice(start, i + 1);
    const mean = slice.reduce((s, x) => s + x, 0) / slice.length;
    const std = Math.sqrt(slice.reduce((s, x) => s + (x - mean) ** 2, 0) / slice.length) || 1;
    return (v - mean) / std;
  });

  // Price vs MA25 %
  const priceVsMA25 = closes.map((c, i) => ma25[i] > 0 ? (c - ma25[i]) / ma25[i] * 100 : 0);

  // MA25 slope (5-day)
  const ma25Slope = ma25.map((v, i) => {
    if (i < 5) return 0;
    return (v - ma25[i - 5]) / (ma25[i - 5] || 1) * 100;
  });

  // Volume ratio (today vs 20d avg)
  const vol20 = computeSMA(volumes, 20);
  const volRatio = volumes.map((v, i) => vol20[i] > 0 ? v / vol20[i] : 1);

  // Build feature matrix
  const features = [];
  for (let i = 0; i < closes.length; i++) {
    features.push([
      clamp(logReturns[i], -0.15, 0.15),                    // [0] log return
      clamp(volZ[i], -3, 5),                                 // [1] volume z-score
      rsi[i] / 100,                                          // [2] RSI normalized
      clamp(macdHist[i] / (closes[i] * 0.01 || 1), -5, 5),  // [3] MACD hist relative
      clamp(bbWidth[i], 0, 0.3),                             // [4] bollinger width
      stochK[i] / 100,                                       // [5] stochastic K
      clamp(atr[i] / (closes[i] || 1), 0, 0.1),             // [6] ATR %
      clamp(obvZ[i], -3, 5),                                 // [7] OBV z-score
      clamp(priceVsMA25[i], -30, 30) / 60 + 0.5,           // [8] price vs MA25
      clamp(ma25Slope[i], -10, 10) / 20 + 0.5,             // [9] MA25 slope
      Math.log(closes[i]),                                    // [10] log price (raw — normalized later)
      clamp(volRatio[i], 0, 5) / 5,                          // [11] volume ratio
    ]);
  }

  return { features, closes };
}

// ─── Data Preparation ───────────────────────────────────────────

/**
 * Fetch all price history and build training sequences.
 * Each sequence: 60 days of 12 features → 8 outputs (4 horizons × [pred, logvar]).
 * Labels: max price percentage change over each horizon.
 */
async function fetchTrainingData() {
  // Get all tickers with enough data
  const tickerResult = await query(
    `SELECT ticker_code, COUNT(*) as cnt
     FROM price_history
     GROUP BY ticker_code
     HAVING COUNT(*) >= $1
     ORDER BY ticker_code`,
    [SEQUENCE_LENGTH + Math.max(...HORIZONS) + 10]
  );

  const tickers = tickerResult.rows.map((r) => r.ticker_code);
  console.log(`[ML] LSTM v2: ${tickers.length} tickers with sufficient data`);

  if (tickers.length < MIN_TICKERS) {
    return { samples: [], tickers: 0 };
  }

  // Reservoir sampling — keep at most MAX_TRAINING_SEQUENCES in memory
  const reservoir = [];
  const reservoirLabels = [];
  let totalSeen = 0;
  let tickerCount = 0;

  // Process one ticker at a time to minimize memory
  for (let b = 0; b < tickers.length; b++) {
    const ticker = tickers[b];
    try {
      const histResult = await query(
        `SELECT date, open, high, low, close, volume
         FROM price_history
         WHERE ticker_code = $1
         ORDER BY date ASC`,
        [ticker]
      );

      const prices = histResult.rows.map((r) => ({
        close: Number(r.close),
        high: Number(r.high || r.close),
        low: Number(r.low || r.close),
        volume: Number(r.volume || 0),
      }));

      if (prices.length < SEQUENCE_LENGTH + Math.max(...HORIZONS)) continue;

      const { features, closes } = buildFeatures(prices);

      // Normalize log price feature (index 10) using this ticker's stats
      const logPrices = features.map((f) => f[10]);
      const lpMean = logPrices.reduce((s, v) => s + v, 0) / logPrices.length;
      const lpStd = Math.sqrt(logPrices.reduce((s, v) => s + (v - lpMean) ** 2, 0) / logPrices.length) || 1;
      for (let i = 0; i < features.length; i++) {
        features[i][10] = (features[i][10] - lpMean) / lpStd;
      }

      // Build sequences — use reservoir sampling to cap memory usage
      const maxHorizon = Math.max(...HORIZONS);
      for (let i = SEQUENCE_LENGTH; i <= features.length - maxHorizon; i++) {
        const currentPrice = closes[i - 1];
        if (currentPrice <= 0) continue;

        const labels = [];
        for (const h of HORIZONS) {
          const futureSlice = closes.slice(i, i + h);
          const maxPrice = Math.max(...futureSlice);
          const pctChange = ((maxPrice - currentPrice) / currentPrice) * 100;
          labels.push(clamp(pctChange, -25, 50));
        }

        totalSeen++;
        if (reservoir.length < MAX_TRAINING_SEQUENCES) {
          reservoir.push(features.slice(i - SEQUENCE_LENGTH, i));
          reservoirLabels.push(labels);
        } else {
          // Reservoir sampling: replace with decreasing probability
          const j = Math.floor(Math.random() * totalSeen);
          if (j < MAX_TRAINING_SEQUENCES) {
            reservoir[j] = features.slice(i - SEQUENCE_LENGTH, i);
            reservoirLabels[j] = labels;
          }
        }
      }

      tickerCount++;
    } catch (err) {
      // Skip problematic tickers
    }

    if ((b + 1) % 100 === 0) {
      console.log(`[ML] LSTM v2: processed ${b + 1}/${tickers.length} tickers, ${totalSeen} sequences seen, ${reservoir.length} kept`);
    }
  }

  console.log(`[ML] LSTM v2 training data: ${reservoir.length} sequences (from ${totalSeen} total, ${tickerCount} tickers)`);

  return { samples: reservoir, labels: reservoirLabels, tickers: tickerCount };
}

// ─── Model Architecture ─────────────────────────────────────────

export function buildLstmV2Model(archConfig = {}) {
  const seqLen = archConfig.seqLen || SEQUENCE_LENGTH;
  const featureDim = archConfig.featureDim || FEATURE_DIM;
  const outputDim = archConfig.outputDim || OUTPUT_DIM;

  const input = tf.input({ shape: [seqLen, featureDim] });

  // GRU layer — ~33% faster than LSTM (2 gates vs 3)
  let x = tf.layers.gru({
    units: 32,
    returnSequences: false,
    kernelRegularizer: tf.regularizers.l2({ l2: 0.001 }),
  }).apply(input);
  x = tf.layers.dropout({ rate: 0.2 }).apply(x);

  // Dense head
  x = tf.layers.dense({ units: 16, activation: "relu" }).apply(x);

  // Output: [pred_5d, pred_10d, pred_20d, pred_30d, logvar_5d, logvar_10d, logvar_20d, logvar_30d]
  const output = tf.layers.dense({ units: outputDim, activation: "linear" }).apply(x);

  const model = tf.model({ inputs: input, outputs: output });
  return model;
}

// ─── Gaussian NLL Loss ──────────────────────────────────────────

/**
 * Gaussian negative log-likelihood loss for heteroscedastic uncertainty.
 * Model outputs [predictions, log_variances] concatenated.
 * Loss = 0.5 * (logvar + (y - pred)^2 / exp(logvar))
 */
function gaussianNLLLoss(yTrue, yPred) {
  const nHorizons = HORIZONS.length;
  const preds = yPred.slice([0, 0], [-1, nHorizons]);
  const logVars = yPred.slice([0, nHorizons], [-1, nHorizons]);

  // Extract only the target columns (first 4 of the 8-dim padded target)
  const targets = yTrue.slice([0, 0], [-1, nHorizons]);

  // Clamp logvar to prevent numerical instability
  const clampedLogVars = logVars.clipByValue(-6, 6);
  const vars = clampedLogVars.exp();

  const diff = targets.sub(preds);
  const loss = clampedLogVars.add(diff.square().div(vars)).mul(0.5);

  return loss.mean();
}

// ─── Training ───────────────────────────────────────────────────

export async function train() {
  await ensureTF();

  const { samples, labels, tickers } = await fetchTrainingData();
  if (samples.length < 500) {
    return { skipped: true, reason: "insufficient_data", samples: samples.length };
  }

  // Time-series split (80/20 chronological — samples are already in temporal order within each ticker)
  const splitIdx = Math.floor(samples.length * 0.8);

  // Normalize labels
  const trainLabels = labels.slice(0, splitIdx);
  const labelStats = HORIZONS.map((_, hi) => {
    const vals = trainLabels.map((l) => l[hi]);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length) || 1;
    return { mean, std };
  });

  // Build tensors using typed arrays to avoid JS array length limits
  const trainSize = splitIdx;
  const valSize = samples.length - splitIdx;
  const seqElements = SEQUENCE_LENGTH * FEATURE_DIM;

  // Targets padded to OUTPUT_DIM (8): first 4 = actual targets, last 4 = zeros (ignored by loss)
  const xTrainFlat = new Float32Array(trainSize * seqElements);
  const yTrainFlat = new Float32Array(trainSize * OUTPUT_DIM);
  for (let i = 0; i < trainSize; i++) {
    const seq = samples[i];
    for (let s = 0; s < SEQUENCE_LENGTH; s++) {
      for (let f = 0; f < FEATURE_DIM; f++) {
        xTrainFlat[i * seqElements + s * FEATURE_DIM + f] = seq[s][f];
      }
    }
    for (let h = 0; h < HORIZONS.length; h++) {
      yTrainFlat[i * OUTPUT_DIM + h] = (labels[i][h] - labelStats[h].mean) / labelStats[h].std;
    }
    // last 4 columns stay 0 (padding for logvar outputs, ignored by loss)
  }

  const xValFlat = new Float32Array(valSize * seqElements);
  const yValFlat = new Float32Array(valSize * OUTPUT_DIM);
  for (let i = 0; i < valSize; i++) {
    const si = splitIdx + i;
    const seq = samples[si];
    for (let s = 0; s < SEQUENCE_LENGTH; s++) {
      for (let f = 0; f < FEATURE_DIM; f++) {
        xValFlat[i * seqElements + s * FEATURE_DIM + f] = seq[s][f];
      }
    }
    for (let h = 0; h < HORIZONS.length; h++) {
      yValFlat[i * OUTPUT_DIM + h] = (labels[si][h] - labelStats[h].mean) / labelStats[h].std;
    }
  }

  const xTrain = tf.tensor3d(xTrainFlat, [trainSize, SEQUENCE_LENGTH, FEATURE_DIM]);
  const yTrain = tf.tensor2d(yTrainFlat, [trainSize, OUTPUT_DIM]);
  const xVal = tf.tensor3d(xValFlat, [valSize, SEQUENCE_LENGTH, FEATURE_DIM]);
  const yVal = tf.tensor2d(yValFlat, [valSize, OUTPUT_DIM]);

  // Preserve validation labels and count before freeing memory
  const yValActual = labels.slice(splitIdx);
  const totalSamples = samples.length;

  // Free JS-side memory — tensors now own the data
  samples.length = 0;
  labels.length = 0;

  console.log(`[ML] LSTM v2: ${trainSize} train, ${valSize} val sequences (${FEATURE_DIM} features, ${SEQUENCE_LENGTH} steps)`);

  // Build and compile model
  const model = buildLstmV2Model();
  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: gaussianNLLLoss,
  });

  const history = await model.fit(xTrain, yTrain, {
    epochs: 50,
    batchSize: 128,
    validationData: [xVal, yVal],
    callbacks: [
      tf.callbacks.earlyStopping({
        monitor: "val_loss",
        patience: 7,
      }),
      new tf.CustomCallback({
        onEpochEnd: (epoch, logs) => {
          console.log(`[ML] GRU epoch ${epoch + 1}: loss=${logs.loss?.toFixed(4)}, val_loss=${logs.val_loss?.toFixed(4)}`);
        },
      }),
    ],
    verbose: 0,
  });

  // Evaluate on validation set
  const valPreds = model.predict(xVal);
  const predsData = valPreds.dataSync();

  // Compute MAE per horizon (denormalized)
  const maePerHorizon = {};

  for (let h = 0; h < HORIZONS.length; h++) {
    let sumAbsErr = 0;
    for (let i = 0; i < valSize; i++) {
      const predNorm = predsData[i * OUTPUT_DIM + h];
      const predActual = predNorm * labelStats[h].std + labelStats[h].mean;
      const actual = yValActual[i][h];
      sumAbsErr += Math.abs(predActual - actual);
    }
    maePerHorizon[`mae_${HORIZONS[h]}d`] = Math.round(sumAbsErr / valSize * 100) / 100;
  }

  const finalEpoch = history.history.val_loss.length;
  const valLoss = history.history.val_loss[finalEpoch - 1];

  const metrics = {
    val_loss: Math.round(valLoss * 10000) / 10000,
    ...maePerHorizon,
    epochs_trained: finalEpoch,
    total_sequences: totalSamples,
  };

  console.log(`[ML] LSTM v2 metrics:`, metrics);

  // Save model
  const version = await saveModel(model, MODEL_NAME, {
    architecture: {
      type: "lstm_v2",
      seqLen: SEQUENCE_LENGTH,
      featureDim: FEATURE_DIM,
      outputDim: OUTPUT_DIM,
      horizons: HORIZONS,
    },
    normalization: { labelStats },
    metrics,
    trainingSamples: totalSamples,
  });

  // Clean up
  xTrain.dispose();
  yTrain.dispose();
  xVal.dispose();
  yVal.dispose();
  valPreds.dispose();
  model.dispose();

  return { version, metrics, samples: samples.length, tickers };
}
