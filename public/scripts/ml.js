const customHeaders = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, Gecko) Chrome/91.0.4472.124 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
};

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
  if (Number.isInteger(idx)) {
    return sorted[idx];
  } else {
    const lower = sorted[Math.floor(idx)];
    const upper = sorted[Math.ceil(idx)];
    return lower + (upper - lower) * (idx - Math.floor(idx));
  }
}

function computeIQR(arr) {
  const q1 = computePercentile(arr, 0.25);
  const q3 = computePercentile(arr, 0.75);
  return q3 - q1;
}

/**
 * Winsorize a value given lower and upper bounds.
 */
function winsorizeVal(val, lower, upper) {
  return Math.min(Math.max(val, lower), upper);
}

/**
 * Winsorize an array given lower and upper percentile thresholds.
 */
function winsorizeArray(arr, lowerP = 0.05, upperP = 0.95) {
  const lower = computePercentile(arr, lowerP);
  const upper = computePercentile(arr, upperP);
  return {
    winsorized: arr.map((x) => winsorizeVal(x, lower, upper)),
    lower,
    upper,
  };
}

/**
 * Compute simple moving average over an array.
 */
function computeSMA(arr, window) {
  const sma = [];
  for (let i = 0; i < arr.length; i++) {
    const start = Math.max(0, i - window + 1);
    const subset = arr.slice(start, i + 1);
    const avg = subset.reduce((sum, v) => sum + v, 0) / subset.length;
    sma.push(avg);
  }
  return sma;
}

/**
 * Compute daily log return.
 * For log prices, daily return = log(p[i]) - log(p[i-1])
 */
function computeDailyLogReturn(logPrices) {
  const returns = [0]; // First day return set to 0.
  for (let i = 1; i < logPrices.length; i++) {
    returns.push(logPrices[i] - logPrices[i - 1]);
  }
  return returns;
}

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

/* -------------------------------------------------------------------------
     30‑Day‑Ahead utilities — but now they predict the **maximum** price that will
     occur within the next 30 days (instead of the closing price exactly on +30).
     Function names are kept unchanged so existing imports still work.
     ------------------------------------------------------------------------- */

/**
 * prepareDataFor30DayAheadPrice
 *
 * Returns { inputTensor, outputTensor, meta }
 *   • inputTensor  — shape  [N, 30, 4]
 *   • outputTensor — shape  [N,  1]   (normalised max‑log‑price)
 *   • meta         — medians / IQRs / winsorisation bounds, etc.
 */
function prepareDataFor30DayAheadPrice(
  data,
  sequenceLength = 30,
  predictionGap = 30
) {
  if (data.length < sequenceLength + predictionGap) {
    throw new Error("Not enough data to create sequences for prediction.");
  }

  // ───────────────────────────────────────────
  // 1. Extract raw arrays & derived features
  // ───────────────────────────────────────────
  const prices = data.map((d) => d.price);
  const volumes = data.map((d) => d.volume);
  const logPrices = prices.map(Math.log);
  const sma7 = computeSMA(logPrices, 7);
  const dLogR = computeDailyLogReturn(logPrices);

  // ───────────────────────────────────────────
  // 2. Winsorisation on the training segment (exclude forecast window)
  // ───────────────────────────────────────────
  const cutoff = prices.length - predictionGap;
  const {
    winsorized: wLog,
    lower: loLog,
    upper: hiLog,
  } = winsorizeArray(logPrices.slice(0, cutoff));
  const {
    winsorized: wVol,
    lower: loVol,
    upper: hiVol,
  } = winsorizeArray(volumes.slice(0, cutoff));
  const {
    winsorized: wSma,
    lower: loSma,
    upper: hiSma,
  } = winsorizeArray(sma7.slice(0, cutoff));
  const {
    winsorized: wRet,
    lower: loRet,
    upper: hiRet,
  } = winsorizeArray(dLogR.slice(0, cutoff));

  // ───────────────────────────────────────────
  // 3. Robust statistics (median & IQR)
  // ───────────────────────────────────────────
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

  // ───────────────────────────────────────────
  // 4. Build sequences & **max‑price** targets
  // ───────────────────────────────────────────
  const X = [];
  const y = [];
  for (let i = 0; i <= data.length - sequenceLength - predictionGap; i++) {
    // 4‑a  .. input sequence
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

    // 4‑b  .. TARGET: max log‑price within [i+seqLen, i+seqLen+gap)
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

/**
 * trainModelFor30DayAheadPrice ➜ **trains on the new target** (max‑price).
 */
async function trainModelFor30DayAheadPrice(data) {
  const seqLen = 30,
    gap = 30;
  const { inputTensor, outputTensor, meta } = prepareDataFor30DayAheadPrice(
    data,
    seqLen,
    gap
  );

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

  return { model, meta };
}

/**
 * predict30DayAheadPrice ➜ returns estimated **highest** price in next 30 days.
 */
async function predict30DayAheadPrice(modelObj, data) {
  const { model, meta } = modelObj;
  const {
    medianLogPrice,
    iqrLogPrice,
    medianVolume,
    iqrVolume,
    medianSMA,
    iqrSMA,
    medianReturn,
    iqrReturn,
    bounds,
  } = meta;

  const seqLen = 30;
  const recent = data.slice(-seqLen);
  const prices = recent.map((d) => d.price);
  const volumes = recent.map((d) => d.volume);
  const logPrices = prices.map(Math.log);
  const sma7 = computeSMA(logPrices, 7);
  const dLogR = computeDailyLogReturn(logPrices);

  const norm = (v, m, q, lo, hi) => (winsorizeVal(v, lo, hi) - m) / (q || 1);
  const seq = recent.map((_, i) => [
    norm(
      Math.log(prices[i]),
      medianLogPrice,
      iqrLogPrice,
      bounds.logPrice.lower,
      bounds.logPrice.upper
    ),
    norm(
      volumes[i],
      medianVolume,
      iqrVolume,
      bounds.volume.lower,
      bounds.volume.upper
    ),
    norm(sma7[i], medianSMA, iqrSMA, bounds.sma.lower, bounds.sma.upper),
    norm(
      dLogR[i],
      medianReturn,
      iqrReturn,
      bounds.return.lower,
      bounds.return.upper
    ),
  ]);

  const predNorm = model
    .predict(tf.tensor3d([seq], [1, seqLen, 4]))
    .dataSync()[0];
  const predLog = predNorm * iqrLogPrice + medianLogPrice;
  return Math.exp(predLog);
}

// If you are using modules:
// export { prepareDataFor30DayAheadPrice, trainModelFor30DayAheadPrice, predict30DayAheadPrice };

async function analyzeStock(ticker, historicalData) {
  console.log(
    `Starting analysis for ${ticker} with ${
      historicalData?.length || 0
    } data points...`
  );

  try {
    // Pre-process data to ensure no NaN values
    const cleanData = [];
    for (let i = 0; i < historicalData.length; i++) {
      const item = historicalData[i];
      if (
        item &&
        item.price !== undefined &&
        !isNaN(item.price) &&
        item.volume !== undefined &&
        !isNaN(item.volume)
      ) {
        cleanData.push(item);
      }
    }

    if (cleanData.length < historicalData.length) {
      console.log(
        `Filtered out ${
          historicalData.length - cleanData.length
        } invalid data points for ${ticker}`
      );
    }

    // Check if we have enough data
    if (cleanData.length < 60) {
      // Need at least 60 data points (30 for sequence + 30 for prediction)
      console.warn(`Insufficient data for prediction on ${ticker}`);
      if (cleanData.length > 0) {
        return cleanData[cleanData.length - 1].price; // Return last valid price
      }
      return null;
    }

    // Check if this appears to be a Nikkei stock
    const isNikkeiStock =
      ticker.includes(".T") ||
      ticker.includes(".JP") ||
      ticker.endsWith("JT") ||
      ticker.startsWith("JP:");

    // Get current price (for fallback and constraints)
    const prices = cleanData.map((item) => item.price);
    const currentPrice = prices[prices.length - 1];

    // If we have enough data for model training
    if (cleanData.length >= 90) {
      // At least 90 days of data
      try {
        console.log(`${ticker}: Training prediction model...`);

        // Use try-catch for each step to get better error information
        let modelObj;
        try {
          // Train the model with 30-day sequence for 30-day ahead prediction
          modelObj = await trainModelFor30DayAheadPrice(cleanData);
          console.log(`${ticker}: Model training completed`);
        } catch (trainError) {
          console.error(
            `${ticker}: Error during model training:`,
            trainError.message
          );
          throw new Error(`Model training failed: ${trainError.message}`);
        }

        let predictedPrice;
        try {
          // Get prediction
          predictedPrice = await predict30DayAheadPrice(modelObj, cleanData);
          console.log(`${ticker}: Raw prediction: ${predictedPrice}`);
        } catch (predictError) {
          console.error(
            `${ticker}: Error during prediction:`,
            predictError.message
          );
          throw new Error(`Prediction failed: ${predictError.message}`);
        }

        // Validate prediction
        if (
          isNaN(predictedPrice) ||
          !isFinite(predictedPrice) ||
          predictedPrice <= 0
        ) {
          console.warn(
            `${ticker}: Invalid prediction result. Using current price.`
          );
          return currentPrice;
        }

        // Apply market-specific constraints
        const percentChange = (predictedPrice / currentPrice - 1) * 100;

        // Apply Nikkei-specific constraints
        if (isNikkeiStock && percentChange > 15) {
          console.log(`${ticker}: Limiting Nikkei stock prediction to +15%`);
          predictedPrice = currentPrice * 1.15;
        } else if (isNikkeiStock && percentChange < -15) {
          console.log(`${ticker}: Limiting Nikkei stock prediction to -15%`);
          predictedPrice = currentPrice * 0.85;
        } else if (percentChange > 30) {
          // General constraints for other markets
          console.log(`${ticker}: Limiting extreme prediction to +30%`);
          predictedPrice = currentPrice * 1.3;
        } else if (percentChange < -30) {
          console.log(`${ticker}: Limiting extreme prediction to -30%`);
          predictedPrice = currentPrice * 0.7;
        }

        console.log(
          `${ticker}: Final prediction: ${predictedPrice.toFixed(2)} (${(
            (predictedPrice / currentPrice - 1) *
            100
          ).toFixed(2)}%)`
        );
        return predictedPrice;
      } catch (error) {
        console.error(
          `${ticker}: ML prediction process failed:`,
          error.message
        );
        // Fall back to trend-based prediction on model failure
        console.log(`${ticker}: Falling back to trend-based prediction`);
      }
    }

    // If we reach here, either we don't have enough data or ML prediction failed
    // Use simple trend-based prediction as fallback
    console.log(`${ticker}: Using trend-based prediction`);

    // Use the last 30 days (or what's available) to detect trend
    const lookbackPeriod = Math.min(30, prices.length - 1);
    const priorPrice = prices[prices.length - 1 - lookbackPeriod];
    const recentTrendPercent = (currentPrice / priorPrice - 1) * 100;

    // Apply dampening factor to recent trend (30% of trend)
    let predictedChangePercent = recentTrendPercent * 0.3;

    // Apply constraints based on stock type
    const maxChange = isNikkeiStock ? 10 : 15; // More conservative for Nikkei
    predictedChangePercent = Math.max(
      Math.min(predictedChangePercent, maxChange),
      -maxChange
    );

    const predictedPrice = currentPrice * (1 + predictedChangePercent / 100);

    console.log(
      `${ticker}: Trend-based prediction: ${predictedPrice.toFixed(
        2
      )} (${predictedChangePercent.toFixed(2)}%)`
    );
    return predictedPrice;
  } catch (error) {
    console.error(`Error analyzing stock for ${ticker}:`, error.message);

    // Ultimate fallback - return current price if available
    if (historicalData && historicalData.length > 0) {
      for (let i = historicalData.length - 1; i >= 0; i--) {
        const item = historicalData[i];
        if (item && item.price && !isNaN(item.price)) {
          return item.price;
        }
      }
    }
    return null;
  } finally {
    // Clean up any potential memory leaks from TensorFlow.js
    try {
      tf.engine().endScope();
      if (tf.engine().getNumTensors() > 0) {
        console.warn(
          `${ticker}: Potential memory leak - ${tf
            .engine()
            .getNumTensors()} tensors still allocated`
        );
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}
