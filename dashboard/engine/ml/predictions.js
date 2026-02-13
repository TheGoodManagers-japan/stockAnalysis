// dashboard/engine/ml/predictions.js
// Ported from public/scripts/ml/ml.js for server-side execution.
// Predicts maximum price within the next 30 days using LSTM.

let tf;

async function ensureTF() {
  if (tf) return tf;
  try {
    tf = await import("@tensorflow/tfjs");
  } catch {
    throw new Error("@tensorflow/tfjs is required for ML predictions");
  }
  return tf;
}

// --- Statistical helpers ---

function computeMedian(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computePercentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = p * (sorted.length - 1);
  if (Number.isInteger(idx)) return sorted[idx];
  const lower = sorted[Math.floor(idx)];
  const upper = sorted[Math.ceil(idx)];
  return lower + (upper - lower) * (idx - Math.floor(idx));
}

function computeIQR(arr) {
  return computePercentile(arr, 0.75) - computePercentile(arr, 0.25);
}

function winsorizeVal(val, lower, upper) {
  return Math.min(Math.max(val, lower), upper);
}

function winsorizeArray(arr, lowerP = 0.05, upperP = 0.95) {
  const lower = computePercentile(arr, lowerP);
  const upper = computePercentile(arr, upperP);
  return {
    winsorized: arr.map((x) => winsorizeVal(x, lower, upper)),
    lower,
    upper,
  };
}

function computeSMA(arr, window) {
  const sma = [];
  for (let i = 0; i < arr.length; i++) {
    const start = Math.max(0, i - window + 1);
    const subset = arr.slice(start, i + 1);
    sma.push(subset.reduce((sum, v) => sum + v, 0) / subset.length);
  }
  return sma;
}

function computeDailyLogReturn(logPrices) {
  const returns = [0];
  for (let i = 1; i < logPrices.length; i++) {
    returns.push(logPrices[i] - logPrices[i - 1]);
  }
  return returns;
}

// --- Model functions ---

function customHuberLoss(delta = 1.0) {
  return function (yTrue, yPred) {
    const error = yTrue.sub(yPred).abs();
    const quadratic = tf.minimum(error, delta);
    const linear = error.sub(quadratic);
    return tf
      .add(tf.mul(0.5, tf.square(quadratic)), tf.mul(delta, linear))
      .mean();
  };
}

function prepareDataFor30DayAheadPrice(data, sequenceLength = 30, predictionGap = 30) {
  if (data.length < sequenceLength + predictionGap) {
    throw new Error("Not enough data to create sequences for prediction.");
  }

  const prices = data.map((d) => d.price);
  const volumes = data.map((d) => d.volume);
  const logPrices = prices.map(Math.log);
  const sma7 = computeSMA(logPrices, 7);
  const dLogR = computeDailyLogReturn(logPrices);

  const cutoff = prices.length - predictionGap;
  const { winsorized: wLog, lower: loLog, upper: hiLog } = winsorizeArray(logPrices.slice(0, cutoff));
  const { winsorized: wVol, lower: loVol, upper: hiVol } = winsorizeArray(volumes.slice(0, cutoff));
  const { winsorized: wSma, lower: loSma, upper: hiSma } = winsorizeArray(sma7.slice(0, cutoff));
  const { winsorized: wRet, lower: loRet, upper: hiRet } = winsorizeArray(dLogR.slice(0, cutoff));

  const medLog = computeMedian(wLog);
  const iqrLog = computeIQR(wLog);
  const medVol = computeMedian(wVol);
  const iqrVol = computeIQR(wVol);
  const medSma = computeMedian(wSma);
  const iqrSma = computeIQR(wSma);
  const medRet = computeMedian(wRet);
  const iqrRet = computeIQR(wRet);

  const bounds = {
    logPrice: { lower: loLog, upper: hiLog },
    volume: { lower: loVol, upper: hiVol },
    sma: { lower: loSma, upper: hiSma },
    return: { lower: loRet, upper: hiRet },
  };

  const norm = (v, m, q, lo, hi) => (winsorizeVal(v, lo, hi) - m) / (q || 1);

  const X = [];
  const y = [];
  for (let i = 0; i <= data.length - sequenceLength - predictionGap; i++) {
    const seq = [];
    for (let j = 0; j < sequenceLength; j++) {
      seq.push([
        norm(Math.log(prices[i + j]), medLog, iqrLog, loLog, hiLog),
        norm(volumes[i + j], medVol, iqrVol, loVol, hiVol),
        norm(sma7[i + j], medSma, iqrSma, loSma, hiSma),
        norm(dLogR[i + j], medRet, iqrRet, loRet, hiRet),
      ]);
    }
    X.push(seq);

    const windowMaxPrice = Math.max(
      ...prices.slice(i + sequenceLength, i + sequenceLength + predictionGap)
    );
    y.push(norm(Math.log(windowMaxPrice), medLog, iqrLog, loLog, hiLog));
  }

  return {
    inputTensor: tf.tensor3d(X, [X.length, sequenceLength, 4]),
    outputTensor: tf.tensor2d(y, [y.length, 1]),
    meta: {
      medianLogPrice: medLog,
      iqrLogPrice: iqrLog,
      medianVolume: medVol,
      iqrVolume: iqrVol,
      medianSMA: medSma,
      iqrSMA: iqrSma,
      medianReturn: medRet,
      iqrReturn: iqrRet,
      bounds,
      lastKnownPrice: prices[prices.length - 1],
    },
  };
}

async function trainModel(data) {
  const seqLen = 30;
  const gap = 30;
  const { inputTensor, outputTensor, meta } = prepareDataFor30DayAheadPrice(data, seqLen, gap);

  const model = tf.sequential();
  model.add(
    tf.layers.lstm({
      units: 64,
      inputShape: [seqLen, 4],
      kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
      recurrentRegularizer: tf.regularizers.l2({ l2: 0.01 }),
    })
  );
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.dense({ units: 1 }));

  model.compile({ optimizer: tf.train.adam(), loss: customHuberLoss(2.0) });
  await model.fit(inputTensor, outputTensor, {
    epochs: 50,
    batchSize: 32,
    validationSplit: 0.2,
    callbacks: [
      tf.callbacks.earlyStopping({
        monitor: "val_loss",
        patience: 5,
        restoreBestWeight: true,
      }),
    ],
  });

  // Clean up training tensors
  inputTensor.dispose();
  outputTensor.dispose();

  return { model, meta };
}

async function predictFromModel(modelObj, data) {
  const { model, meta } = modelObj;
  const { medianLogPrice, iqrLogPrice, medianVolume, iqrVolume,
          medianSMA, iqrSMA, medianReturn, iqrReturn, bounds } = meta;

  const seqLen = 30;
  const recent = data.slice(-seqLen);
  const prices = recent.map((d) => d.price);
  const volumes = recent.map((d) => d.volume);
  const logPrices = prices.map(Math.log);
  const sma7 = computeSMA(logPrices, 7);
  const dLogR = computeDailyLogReturn(logPrices);

  const norm = (v, m, q, lo, hi) => (winsorizeVal(v, lo, hi) - m) / (q || 1);
  const seq = recent.map((_, i) => [
    norm(Math.log(prices[i]), medianLogPrice, iqrLogPrice, bounds.logPrice.lower, bounds.logPrice.upper),
    norm(volumes[i], medianVolume, iqrVolume, bounds.volume.lower, bounds.volume.upper),
    norm(sma7[i], medianSMA, iqrSMA, bounds.sma.lower, bounds.sma.upper),
    norm(dLogR[i], medianReturn, iqrReturn, bounds.return.lower, bounds.return.upper),
  ]);

  const inputTensor = tf.tensor3d([seq], [1, seqLen, 4]);
  const predNorm = model.predict(inputTensor).dataSync()[0];
  inputTensor.dispose();

  const predLog = predNorm * iqrLogPrice + medianLogPrice;
  return Math.exp(predLog);
}

/**
 * Main entry point: predict max price in next 30 days for a ticker.
 * @param {Array} historicalData - array of { date, close, volume } or { date, price, volume }
 * @param {string} ticker - ticker code for logging and constraints
 * @returns {{ predictedPrice: number, pctChange: number, confidence: number, method: string }}
 */
export async function predictForTicker(historicalData, ticker = "unknown") {
  await ensureTF();

  // Clean data
  const cleanData = [];
  for (const item of historicalData) {
    const price = item.price ?? item.close;
    const volume = item.volume ?? 0;
    if (price && !isNaN(price) && isFinite(price) && price > 0) {
      cleanData.push({ price: Number(price), volume: Number(volume) });
    }
  }

  if (cleanData.length < 60) {
    const lastPrice = cleanData.length > 0 ? cleanData[cleanData.length - 1].price : null;
    return {
      predictedPrice: lastPrice,
      pctChange: 0,
      confidence: 0,
      method: "insufficient_data",
    };
  }

  const currentPrice = cleanData[cleanData.length - 1].price;
  const isNikkei = ticker.includes(".T") || ticker.includes(".JP");
  const maxPct = isNikkei ? 15 : 30;

  // Try LSTM model
  if (cleanData.length >= 90) {
    try {
      const modelObj = await trainModel(cleanData);
      let predicted = await predictFromModel(modelObj, cleanData);

      // Dispose model
      modelObj.model.dispose();

      if (isNaN(predicted) || !isFinite(predicted) || predicted <= 0) {
        throw new Error("Invalid prediction");
      }

      // Constrain
      let pctChange = ((predicted / currentPrice) - 1) * 100;
      if (pctChange > maxPct) predicted = currentPrice * (1 + maxPct / 100);
      if (pctChange < -maxPct) predicted = currentPrice * (1 - maxPct / 100);
      pctChange = ((predicted / currentPrice) - 1) * 100;

      // Confidence based on data quality and model convergence
      const dataConfidence = Math.min(cleanData.length / 500, 1);
      const predConfidence = Math.max(0, 1 - Math.abs(pctChange) / maxPct);
      const confidence = Math.round((dataConfidence * 0.4 + predConfidence * 0.6) * 100) / 100;

      return {
        predictedPrice: Math.round(predicted * 100) / 100,
        pctChange: Math.round(pctChange * 100) / 100,
        confidence,
        method: "lstm",
      };
    } catch (err) {
      console.warn(`${ticker}: LSTM failed, falling back to trend: ${err.message}`);
    }
  }

  // Trend-based fallback
  const lookback = Math.min(30, cleanData.length - 1);
  const priorPrice = cleanData[cleanData.length - 1 - lookback].price;
  let pctChange = ((currentPrice / priorPrice) - 1) * 100 * 0.3; // 30% dampening
  const fallbackMax = isNikkei ? 10 : 15;
  pctChange = Math.max(Math.min(pctChange, fallbackMax), -fallbackMax);
  const predicted = currentPrice * (1 + pctChange / 100);

  return {
    predictedPrice: Math.round(predicted * 100) / 100,
    pctChange: Math.round(pctChange * 100) / 100,
    confidence: 0.3,
    method: "trend",
  };
}
