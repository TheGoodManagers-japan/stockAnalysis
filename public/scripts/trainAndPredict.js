// Custom headers for Yahoo Finance requests (not strictly necessary here)
const customHeaders = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, Gecko) Chrome/91.0.4472.124 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
};

// Initialize Bottleneck from the CDN
const limiter = new Bottleneck({ minTime: 200, maxConcurrent: 5 });

// Fetch Historical Data (12 Months) using Yahoo Finance
async function fetchHistoricalData(ticker) {
  try {
    const apiUrl = `https://stock-analysis-thegoodmanagers-japan-aymerics-projects-60f33831.vercel.app/api/history?ticker=${ticker}`;

    console.log(`Fetching historical data from: ${apiUrl}`);

    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    console.log(`Response: ${response}`);
    const result = await response.json(); // Parse JSON response
    console.log(`Response body:`, result);

    // Check for HTTP errors
    if (!response.ok || !result.success) {
      throw new Error(result.error || `HTTP error! Status: ${response.status}`);
    }

    // Check if data is empty or undefined
    if (!result.data || result.data.length === 0) {
      console.warn(`No historical data available for ${ticker}.`);
      return [];
    }

    console.log(`Historical data for ${ticker} fetched successfully.`);
    return result.data.map((item) => ({
      ...item,
      date: new Date(item.date), // Convert raw date string to Date object
    }));
  } catch (error) {
    console.error(`Error fetching historical data for ${ticker}:`, error);
    return [];
  }
}

/**
 * Prepare Data for Training (Price and Volume)
 * --------------------------------------------
 * 1) We create sequences of length `sequenceLength` with both price and volume.
 * 2) The next day's price is our 'output.'
 * 3) Normalize price and volume independently.
 * 4) Returns { inputTensor, outputTensor, minMaxData }.
 */
function prepareDataWithVolume(data, sequenceLength = 30) {
  const inputs = [];
  const outputs = [];

  // Build sequences
  for (let i = 0; i < data.length - sequenceLength; i++) {
    const inputSequence = data.slice(i, i + sequenceLength).map((item) => ({
      price: item.price,
      volume: item.volume,
    }));

    const output = data[i + sequenceLength].price;

    inputs.push(inputSequence);
    outputs.push(output);
  }

  // Compute min/max for normalization
  const prices = data.map((item) => item.price);
  const volumes = data.map((item) => item.volume);
  const minMaxData = {
    minPrice: Math.min(...prices),
    maxPrice: Math.max(...prices),
    minVolume: Math.min(...volumes),
    maxVolume: Math.max(...volumes),
  };

  // Normalize helper
  const normalize = (value, min, max) => (value - min) / (max - min);

  // Normalize all sequences
  const normalizedInputs = inputs.map((seq) =>
    seq.map(({ price, volume }) => [
      normalize(price, minMaxData.minPrice, minMaxData.maxPrice),
      normalize(volume, minMaxData.minVolume, maxVolume),
    ])
  );
  const normalizedOutputs = outputs.map((price) =>
    normalize(price, minMaxData.minPrice, minMaxData.maxPrice)
  );

  // Create Tensors
  // inputTensor shape => [numSamples, sequenceLength, 2] (2 features: price, volume)
  const inputTensor = tf.tensor3d(normalizedInputs, [
    normalizedInputs.length,
    sequenceLength,
    2,
  ]);

  // outputTensor shape => [numSamples, 1]
  const outputTensor = tf.tensor2d(normalizedOutputs, [
    normalizedOutputs.length,
    1,
  ]);

  return { inputTensor, outputTensor, minMaxData };
}

/**
 * Train the Model (Price and Volume)
 * -----------------------------------
 * Builds a model with 64 LSTM units, dropout, and dense layers.
 */
async function trainModelWithVolume(data) {
  const sequenceLength = 30;
  const { inputTensor, outputTensor, minMaxData } = prepareDataWithVolume(
    data,
    sequenceLength
  );

  const model = tf.sequential();
  model.add(
    tf.layers.lstm({
      units: 64,
      inputShape: [sequenceLength, 2], // 2 features: price and volume
      returnSequences: false,
    })
  );
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.dense({ units: 1 })); // Output is a single price
  model.compile({ optimizer: tf.train.adam(), loss: "meanSquaredError" });

  console.log(`Training model...`);
  await model.fit(inputTensor, outputTensor, {
    epochs: 50,
    batchSize: 32,
    validationSplit: 0.2,
  });
  console.log(`Model training completed.`);

  // Return model + minMaxData for denormalization
  return { model, minMaxData };
}

/**
 * Predict the Next 30 Days (Price and Volume)
 * --------------------------------------------
 * 1) Use both price and volume in the input window.
 * 2) Predict the next day's price, denormalize, and push to predictions.
 * 3) Slide the window forward by removing the oldest price & volume and adding the new predicted price with the last volume.
 */
async function predictNext30DaysWithVolume(modelObj, latestData) {
  const { model, minMaxData } = modelObj;
  const { minPrice, maxPrice, minVolume, maxVolume } = minMaxData;

  const normalize = (value, min, max) => (value - min) / (max - min);
  const denormalize = (value, min, max) => value * (max - min) + min;

  // Prepare the initial input from the last 30 days of prices and volumes
  let currentInput = latestData.map((item) => [
    normalize(item.price, minPrice, maxPrice),
    normalize(item.volume, minVolume, maxVolume),
  ]);

  const predictions = [];
  for (let day = 0; day < 30; day++) {
    // Shape = [1, 30, 2] for the LSTM
    const inputTensor = tf.tensor3d([currentInput], [1, 30, 2]);

    // Predict the next normalized price
    const [predictedNormPrice] = model.predict(inputTensor).dataSync();

    // Denormalize the predicted price
    const predictedPrice = denormalize(predictedNormPrice, minPrice, maxPrice);
    predictions.push(predictedPrice);

    // Shift the input window: drop the oldest, add the new predicted price with the last volume
    currentInput = [
      ...currentInput.slice(1),
      [
        normalize(predictedPrice, minPrice, maxPrice),
        currentInput[currentInput.length - 1][1], // Keep the last volume
      ],
    ];
  }

  console.log(`Predicted prices for the next 30 days:`, predictions);
  return predictions;
}

/**
 * Main Function to Call on Client Side
 * -------------------------------------
 * 1) Fetch historical data (including volume),
 * 2) Train the LSTM model with price and volume,
 * 3) Predict the next 30 days *price only*.
 */
export async function analyzeStockWithVolume(ticker) {
  try {
    const historicalData = await fetchHistoricalData(ticker);

    if (historicalData.length < 30) {
      throw new Error(`Not enough data to train the model for ${ticker}.`);
    }

    // 1) Train model
    const modelObj = await trainModelWithVolume(historicalData);

    // 2) Take last 30 days as input
    const latestData = historicalData.slice(-30);

    // 3) Predict next 30 days
    const predictions = await predictNext30DaysWithVolume(modelObj, latestData);

    console.log(`Predicted prices for ${ticker}:`, predictions);
    return predictions;
  } catch (error) {
    console.error(`Error analyzing stock for ${ticker}:`, error.message);
    return [];
  }
}
