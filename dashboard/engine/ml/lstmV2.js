// dashboard/engine/ml/lstmV2.js
// Phase 3: LSTM v2 Price Forecaster — Inference Module
// Loads pre-trained LSTM model and predicts multi-horizon price targets with uncertainty.
// Used during daily scan (inference only, no training).

import { query } from "../../lib/db.js";
import { loadModel } from "./modelStore.js";
import { buildLstmV2Model } from "./lstmV2Train.js";
import { clamp } from "./normalization.js";

const MODEL_NAME = "lstm_v2";
const SEQUENCE_LENGTH = 30; // must match training (lstmV2Train.js)
const FEATURE_DIM = 12;

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

// ─── Feature builders (duplicated from train for inference independence) ──

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
    if (change > 0) avgGain += change; else avgLoss -= change;
  }
  avgGain /= period; avgLoss /= period;
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
  return macdLine.map((v, i) => v - signal[i]);
}

function computeATR(highs, lows, closes, period = 14) {
  const tr = [highs[0] - lows[0]];
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const atr = [tr[0]];
  for (let i = 1; i < tr.length; i++) {
    if (i < period) atr.push(tr.slice(0, i + 1).reduce((s, v) => s + v, 0) / (i + 1));
    else atr.push((atr[i - 1] * (period - 1) + tr[i]) / period);
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
    return (2 * std * 2) / (mean || 1);
  });
}

function computeStochastic(highs, lows, closes, period = 14) {
  return closes.map((c, i) => {
    const start = Math.max(0, i - period + 1);
    const hh = Math.max(...highs.slice(start, i + 1));
    const ll = Math.min(...lows.slice(start, i + 1));
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

function buildFeatureSequence(prices) {
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

  const volZ = volumes.map((v, i) => {
    const start = Math.max(0, i - 19);
    const slice = volumes.slice(start, i + 1);
    const mean = slice.reduce((s, x) => s + x, 0) / slice.length;
    const std = Math.sqrt(slice.reduce((s, x) => s + (x - mean) ** 2, 0) / slice.length) || 1;
    return (v - mean) / std;
  });

  const obvZ = obv.map((v, i) => {
    const start = Math.max(0, i - 19);
    const slice = obv.slice(start, i + 1);
    const mean = slice.reduce((s, x) => s + x, 0) / slice.length;
    const std = Math.sqrt(slice.reduce((s, x) => s + (x - mean) ** 2, 0) / slice.length) || 1;
    return (v - mean) / std;
  });

  const priceVsMA25 = closes.map((c, i) => ma25[i] > 0 ? (c - ma25[i]) / ma25[i] * 100 : 0);
  const ma25Slope = ma25.map((v, i) => {
    if (i < 5) return 0;
    return (v - ma25[i - 5]) / (ma25[i - 5] || 1) * 100;
  });
  const vol20 = computeSMA(volumes, 20);
  const volRatio = volumes.map((v, i) => vol20[i] > 0 ? v / vol20[i] : 1);

  // Normalize log price
  const logPrices = closes.map(Math.log);
  const lpMean = logPrices.reduce((s, v) => s + v, 0) / logPrices.length;
  const lpStd = Math.sqrt(logPrices.reduce((s, v) => s + (v - lpMean) ** 2, 0) / logPrices.length) || 1;

  // Take last SEQUENCE_LENGTH steps
  const startIdx = Math.max(0, closes.length - SEQUENCE_LENGTH);
  const seq = [];
  for (let i = startIdx; i < closes.length; i++) {
    seq.push([
      clamp(logReturns[i], -0.15, 0.15),
      clamp(volZ[i], -3, 5),
      rsi[i] / 100,
      clamp(macdHist[i] / (closes[i] * 0.01 || 1), -5, 5),
      clamp(bbWidth[i], 0, 0.3),
      stochK[i] / 100,
      clamp(atr[i] / (closes[i] || 1), 0, 0.1),
      clamp(obvZ[i], -3, 5),
      clamp(priceVsMA25[i], -30, 30) / 60 + 0.5,
      clamp(ma25Slope[i], -10, 10) / 20 + 0.5,
      (logPrices[i] - lpMean) / lpStd,
      clamp(volRatio[i], 0, 5) / 5,
    ]);
  }

  // Pad if not enough data
  while (seq.length < SEQUENCE_LENGTH) {
    seq.unshift(new Array(FEATURE_DIM).fill(0));
  }

  return { sequence: seq, currentPrice: closes[closes.length - 1] };
}

// ─── Inference ──────────────────────────────────────────────────

let _cachedModel = null;

async function loadLstmV2Model() {
  await ensureTF();
  if (_cachedModel) return _cachedModel;

  // Ensure TF is initialized in lstmV2Train module before building model —
  // buildLstmV2Model uses tf from lstmV2Train's module scope
  const { ensureTF: ensureTrainTF } = await import("./lstmV2Train.js");
  await ensureTrainTF();

  const loaded = await loadModel(MODEL_NAME, (arch) => {
    const model = buildLstmV2Model(arch);
    // Don't need to compile for inference, but TF.js requires it for predict
    model.compile({ optimizer: "adam", loss: "meanSquaredError" });
    return model;
  });

  if (!loaded) return null;
  _cachedModel = loaded;
  return loaded;
}

/**
 * Predict multi-horizon prices for a batch of tickers.
 * @param {(string|{code:string})[]} tickers - Array of ticker codes or ticker objects
 * @returns {{ predictions: Map<string, Object>, skips: Map<string, string> } | null}
 */
export async function predictBatch(tickers) {
  const modelData = await loadLstmV2Model();
  if (!modelData) return null;

  // Normalize: accept both string[] and {code}[]
  const tickerCodes = tickers.map((t) => (typeof t === "string" ? t : t.code));

  const { model, normalization } = modelData;
  const { labelStats } = normalization;
  const horizons = [5, 10, 20, 30];
  const results = new Map();
  const skips = new Map();

  // Process in batches to manage memory
  const BATCH = 50;
  for (let b = 0; b < tickerCodes.length; b += BATCH) {
    const batch = tickerCodes.slice(b, b + BATCH);
    const validEntries = [];

    for (const ticker of batch) {
      try {
        const histResult = await query(
          `SELECT date, open, high, low, close, volume
           FROM price_history WHERE ticker_code = $1
           ORDER BY date ASC`,
          [ticker]
        );

        if (histResult.rows.length < SEQUENCE_LENGTH) {
          skips.set(ticker, `Insufficient price history (${histResult.rows.length}/${SEQUENCE_LENGTH} days)`);
          continue;
        }

        const prices = histResult.rows.map((r) => ({
          close: Number(r.close),
          high: Number(r.high || r.close),
          low: Number(r.low || r.close),
          volume: Number(r.volume || 0),
        }));

        const { sequence, currentPrice } = buildFeatureSequence(prices);
        if (currentPrice <= 0) {
          skips.set(ticker, "Invalid current price");
          continue;
        }

        validEntries.push({ ticker, sequence, currentPrice });
      } catch (err) {
        skips.set(ticker, `Feature error: ${err.message}`);
        console.warn(`[ML] LSTM v2: skipping ${ticker}: ${err.message}`);
      }
    }

    if (!validEntries.length) continue;

    // Batch predict
    const inputFlat = [];
    for (const entry of validEntries) {
      for (const step of entry.sequence) {
        inputFlat.push(...step);
      }
    }

    const inputTensor = tf.tensor3d(inputFlat, [validEntries.length, SEQUENCE_LENGTH, FEATURE_DIM]);
    const predictions = model.predict(inputTensor);
    const predData = predictions.dataSync();

    for (let i = 0; i < validEntries.length; i++) {
      const { ticker, currentPrice } = validEntries[i];
      const offset = i * (horizons.length * 2);

      const pred = {
        current_price: currentPrice,
        model_version: modelData.version,
      };

      // Decode predictions and uncertainties
      for (let h = 0; h < horizons.length; h++) {
        const rawPred = predData[offset + h];
        const rawLogVar = predData[offset + horizons.length + h];

        // Denormalize prediction
        const stats = labelStats[h];
        const pctChange = rawPred * stats.std + stats.mean;

        // Convert uncertainty: logvar → std → percentage
        const uncertainty = Math.sqrt(Math.exp(clamp(rawLogVar, -6, 6))) * stats.std;

        const maxPrice = currentPrice * (1 + clamp(pctChange, -25, 50) / 100);
        const horizon = horizons[h];

        pred[`predicted_max_${horizon}d`] = Math.round(maxPrice * 100) / 100;
        pred[`uncertainty_${horizon}d`] = Math.round(uncertainty * 100) / 100;
      }

      // Main fields for backwards compatibility
      pred.predicted_max_30d = pred.predicted_max_30d;
      pred.predicted_pct_change = Math.round(
        ((pred.predicted_max_30d - currentPrice) / currentPrice) * 100 * 100
      ) / 100;

      // Confidence based on uncertainty (lower uncertainty = higher confidence)
      const avgUncertainty = horizons.reduce((s, h) => s + pred[`uncertainty_${h}d`], 0) / horizons.length;
      pred.confidence = Math.round(clamp(1 - avgUncertainty / 15, 0.1, 0.95) * 100) / 100;

      results.set(ticker, pred);
    }

    inputTensor.dispose();
    predictions.dispose();
  }

  return { predictions: results, skips };
}

/**
 * Predict for a single ticker. Convenience wrapper.
 */
export async function predictForTicker(ticker) {
  const result = await predictBatch([ticker]);
  if (!result) return null;
  return result.predictions.get(ticker) || null;
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
