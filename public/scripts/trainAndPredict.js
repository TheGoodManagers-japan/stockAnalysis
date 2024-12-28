// API Setup
const API_KEY = process.env.RAPIDAPI_KEY;
const limiter = new Bottleneck({ minTime: 200, maxConcurrent: 5 });

// Fetch Historical Data (12 Months)
async function fetchHistoricalData(ticker) {
  const url = `https://yahoo-finance15.p.rapidapi.com/api/yahoo/qu/chart/${ticker}`;
  const headers = {
    "X-RapidAPI-Key": API_KEY,
    "X-RapidAPI-Host": "yahoo-finance15.p.rapidapi.com",
  };

  const response = await limiter.schedule(() => axios.get(url, { headers }));
  if (!response || !response.data) throw new Error("Failed to fetch data.");

  // Extract closing prices and volumes
  const prices = response.data.chart.result[0].indicators.quote[0].close;
  const volumes = response.data.chart.result[0].indicators.quote[0].volume;
  const timestamps = response.data.chart.result[0].timestamp;

  // Filter the last 12 months of data
  const oneYearAgo = Date.now() / 1000 - 365 * 24 * 60 * 60;
  const filteredData = timestamps
    .map((timestamp, i) => ({
      price: prices[i],
      volume: volumes[i],
      date: new Date(timestamp * 1000),
    }))
    .filter((data) => data.date.getTime() / 1000 > oneYearAgo);

  return filteredData; // Returns [{ price, volume, date }]
}

// Prepare Data for Training
function prepareData(data, sequenceLength = 30) {
  const inputs = [];
  const outputs = [];

  // Create input-output pairs
  for (let i = 0; i < data.length - sequenceLength; i++) {
    const inputSequence = data
      .slice(i, i + sequenceLength)
      .map((item) => [item.price, item.volume]);
    const output = data[i + sequenceLength].price; // Predict next price
    inputs.push(inputSequence);
    outputs.push(output);
  }

  // Normalize data
  const prices = data.map((item) => item.price);
  const volumes = data.map((item) => item.volume);

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const minVolume = Math.min(...volumes);
  const maxVolume = Math.max(...volumes);

  const normalize = (value, min, max) => (value - min) / (max - min);

  const normalizedInputs = inputs.map((seq) =>
    seq.map(([price, volume]) => [
      normalize(price, minPrice, maxPrice),
      normalize(volume, minVolume, maxVolume),
    ])
  );
  const normalizedOutputs = outputs.map((price) =>
    normalize(price, minPrice, maxPrice)
  );

  // Convert to tensors
  const inputTensor = tf.tensor3d(normalizedInputs, [
    normalizedInputs.length,
    sequenceLength,
    2,
  ]);
  const outputTensor = tf.tensor2d(normalizedOutputs, [
    normalizedOutputs.length,
    1,
  ]);

  return { inputTensor, outputTensor, minPrice, maxPrice };
}

// Train the Model
async function trainModel(ticker, data) {
  const sequenceLength = 30;
  const { inputTensor, outputTensor } = prepareData(data, sequenceLength);

  // Define the LSTM model
  const model = tf.sequential();
  model.add(
    tf.layers.lstm({
      units: 64,
      inputShape: [sequenceLength, 2],
      returnSequences: false,
    })
  ); // 2 features: price, volume
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.dense({ units: 1 })); // Predict one value
  model.compile({ optimizer: tf.train.adam(), loss: "meanSquaredError" });

  // Train the model
  console.log(`Training model for ${ticker}...`);
  await model.fit(inputTensor, outputTensor, {
    epochs: 100,
    batchSize: 32,
    validationSplit: 0.2,
  });

  // Save the model
  await model.save(`file://models/${ticker}_model`);
  console.log(`Model for ${ticker} saved.`);

  return model;
}

// Predict the Next Price
async function predictNextPrice(ticker, latestData) {
  // Load the saved model
  const model = await tf.loadLayersModel(
    `file://models/${ticker}_model/model.json`
  );

  // Normalize input
  const prices = latestData.map((item) => item.price);
  const volumes = latestData.map((item) => item.volume);

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const normalize = (value, min, max) => (value - min) / (max - min);

  const normalizedInput = latestData.map((item) => [
    normalize(item.price, minPrice, maxPrice),
    normalize(item.volume, minPrice, maxPrice),
  ]);

  // Prepare input tensor
  const inputTensor = tf.tensor3d([normalizedInput], [1, 30, 2]);

  // Predict the next price
  const predictedNormalizedPrice = model.predict(inputTensor).dataSync()[0];
  const predictedPrice =
    predictedNormalizedPrice * (maxPrice - minPrice) + minPrice;

  console.log(`Predicted price for ${ticker} in 30 days: ${predictedPrice}`);
  return predictedPrice;
}

// Bubble function
function bubble_fn_prediction(output1, output2) {
  console.log("Bubble Function Called:");
  console.log({
    ticker: output1,
    prediction: output2,
    predictionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
  });
}

// Full Workflow
// trainAndPredict.js
export async function trainAndPredict(ticker) {
  try {
    // Fetch historical data
    console.log(`Fetching data for ${ticker}...`);
    const historicalData = await fetchHistoricalData(ticker);

    if (historicalData.length < 30) {
      throw new Error(`Not enough data to train the model for ${ticker}.`);
    }

    // Train the model
    await trainModel(ticker, historicalData);

    // Use the last 30 days for prediction
    const latestData = historicalData.slice(-30); // Last 30 days
    const predictedPrice = await predictNextPrice(ticker, latestData);

    // Call the Bubble function
    bubble_fn_prediction(ticker, predictedPrice);

    return predictedPrice;
  } catch (error) {
    console.error(`Error for ${ticker}: ${error.message}`);
  }
}

