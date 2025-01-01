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
 * Prepare Data for Training (Price-Only)
 * --------------------------------------
 * 1) We create sequences of length `sequenceLength` of *only* price.
 * 2) The next day's price is our 'output'.
 * 3) We normalize price between [0..1].
 * 4) Returns { inputTensor, outputTensor, minPrice, maxPrice }.
 */
function prepareData(data, sequenceLength = 30) {
  const inputs = [];
  const outputs = [];

  // Build sequences
  for (let i = 0; i < data.length - sequenceLength; i++) {
    // The input sequence is just the 'price' for the last 30 days
    const inputSequence = data
      .slice(i, i + sequenceLength)
      .map((item) => item.price);

    // Next day price is the "label"
    const output = data[i + sequenceLength].price;

    inputs.push(inputSequence);
    outputs.push(output);
  }

  // Compute min/max for normalization
  const prices = data.map((item) => item.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  // Normalize helper
  const normalize = (value, min, max) => (value - min) / (max - min);

  // Normalize all sequences
  const normalizedInputs = inputs.map((seq) =>
    seq.map((price) => normalize(price, minPrice, maxPrice))
  );
  const normalizedOutputs = outputs.map((price) =>
    normalize(price, minPrice, maxPrice)
  );

  // Create Tensors
  // inputTensor shape => [numSamples, sequenceLength, 1]
  const inputArray = normalizedInputs.map(
    (seq) => seq.map((price) => [price]) // wrap each price in []
  );
  const inputTensor = tf.tensor3d(inputArray, [
    inputArray.length,
    sequenceLength,
    1,
  ]);

  // outputTensor shape => [numSamples, 1]
  const outputTensor = tf.tensor2d(normalizedOutputs, [
    normalizedOutputs.length,
    1,
  ]);

  return { inputTensor, outputTensor, minPrice, maxPrice };
}

/**
 * Train the Model (Price-Only)
 * ----------------------------
 * Builds a single LSTM layer with 64 units, dropout, then a dense(1).
 */
async function trainModel(data) {
  const sequenceLength = 30;
  const { inputTensor, outputTensor, minPrice, maxPrice } = prepareData(
    data,
    sequenceLength
  );

  const model = tf.sequential();
  model.add(
    tf.layers.lstm({
      units: 64,
      inputShape: [sequenceLength, 1],
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

  // Return model + min/max so we can denormalize later
  return { model, minPrice, maxPrice };
}

/**
 * Predict the Next 30 Days (Price-Only)
 * -------------------------------------
 * 1) We take the last 30 prices as the input window.
 * 2) Predict *one day* out => denormalize => push to predictions.
 * 3) Slide the window forward by removing the oldest price & adding the new predicted price.
 * 4) Repeat 30 times to get 30 future predictions.
 */
async function predictNext30Days(modelObj, latestData) {
  const { model, minPrice, maxPrice } = modelObj;

  const prices = latestData.map((item) => item.price);
  const normalize = (value, min, max) => (value - min) / (max - min);
  const denormalize = (value, min, max) => value * (max - min) + min;

  // Build the initial input from the last 30 real prices
  let currentInput = prices.map((price) =>
    normalize(price, minPrice, maxPrice)
  );

  const predictions = [];
  for (let day = 0; day < 30; day++) {
    // Shape = [1, 30, 1] for the LSTM
    const inputTensor = tf.tensor3d([currentInput.map((p) => [p])], [1, 30, 1]);

    // Single predicted normalized price
    const [predictedNormPrice] = model.predict(inputTensor).dataSync();

    // Denormalize
    const predictedPrice = denormalize(predictedNormPrice, minPrice, maxPrice);
    predictions.push(predictedPrice);

    // Shift the input window: drop oldest, add new predicted
    currentInput = [
      ...currentInput.slice(1),
      normalize(predictedPrice, minPrice, maxPrice),
    ];
  }

  console.log(`Predicted prices for the next 30 days:`, predictions);
  return predictions;
}

/**
 * Main Function to Call on Client Side
 * ------------------------------------
 * 1) Fetch historical data,
 * 2) Train the LSTM model,
 * 3) Predict the next 30 days *price only*.
 */
export async function analyzeStock(ticker) {
  try {
    const historicalData = await fetchHistoricalData(ticker);

    if (historicalData.length < 30) {
      throw new Error(`Not enough data to train the model for ${ticker}.`);
    }

    // 1) Train model
    const modelObj = await trainModel(historicalData);

    // 2) Take last 30 days as input
    const latestData = historicalData.slice(-30);

    // 3) Predict next 30 days
    const predictions = await predictNext30Days(modelObj, latestData);

    console.log(`Predicted prices for ${ticker}:`, predictions);
    return predictions;
  } catch (error) {
    console.error(`Error analyzing stock for ${ticker}:`, error.message);
    return [];
  }
}
