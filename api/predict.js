const yahooFinance = require("yahoo-finance2").default;
const tf = require("@tensorflow/tfjs");
const Bottleneck = require("bottleneck");

// Custom headers for Yahoo Finance requests
const customHeaders = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
};

const limiter = new Bottleneck({ minTime: 200, maxConcurrent: 5 });

// Fetch Historical Data (12 Months) using Yahoo Finance
async function fetchHistoricalData(ticker) {
  try {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const period1 = Math.floor(oneYearAgo.getTime() / 1000);

    console.log(`Fetching historical data for ${ticker}...`);

    const historicalData = await limiter.schedule(() =>
      yahooFinance.chart(
        ticker,
        {
          period1,
          interval: "1d", // Specify daily intervals
        },
        { headers: customHeaders }
      )
    );

    if (
      !historicalData ||
      !historicalData.quotes ||
      historicalData.quotes.length === 0
    ) {
      console.error("No data in response:", historicalData);
      throw new Error(`No historical data available for ${ticker}`);
    }

    console.log(`Historical data for ${ticker} fetched successfully.`);
    return historicalData.quotes.map((quote) => ({
      price: quote.close,
      volume: quote.volume,
      date: new Date(quote.date), // The date is already in a parseable format
    }));
  } catch (error) {
    console.error(
      `Error fetching historical data for ${ticker}:`,
      error.message
    );
    return [];
  }
}

// Prepare Data for Training
function prepareData(data, sequenceLength = 30) {
  const inputs = [];
  const outputs = [];

  for (let i = 0; i < data.length - sequenceLength; i++) {
    const inputSequence = data
      .slice(i, i + sequenceLength)
      .map((item) => [item.price, item.volume]);
    const output = data[i + sequenceLength].price;
    inputs.push(inputSequence);
    outputs.push(output);
  }

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

  const model = tf.sequential();
  model.add(
    tf.layers.lstm({
      units: 64,
      inputShape: [sequenceLength, 2],
      returnSequences: false,
    })
  );
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.dense({ units: 1 })); // Output shape matches outputTensor
  model.compile({ optimizer: tf.train.adam(), loss: "meanSquaredError" });

  console.log(`Training model for ${ticker}...`);
  await model.fit(inputTensor, outputTensor, {
    epochs: 50,
    batchSize: 32,
    validationSplit: 0.2,
  });

  console.log(`Model training completed for ${ticker}.`);
  return model;
}


// Predict the Next 30 Days
async function predictNext30Days(model, latestData) {
  const prices = latestData.map((item) => item.price);
  const volumes = latestData.map((item) => item.volume);

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const normalize = (value, min, max) => (value - min) / (max - min);
  const denormalize = (value, min, max) => value * (max - min) + min;

  const predictions = [];
  let currentInput = latestData.map((item) => [
    normalize(item.price, minPrice, maxPrice),
    normalize(item.volume, Math.min(...volumes), Math.max(...volumes)),
  ]);

  for (let day = 0; day < 30; day++) {
    const inputTensor = tf.tensor3d([currentInput], [1, 30, 2]);
    const predictedNormalizedPrice = model.predict(inputTensor).dataSync()[0];
    const predictedPrice = denormalize(
      predictedNormalizedPrice,
      minPrice,
      maxPrice
    );

    predictions.push(predictedPrice);

    currentInput = [
      ...currentInput.slice(1),
      [normalize(predictedPrice, minPrice, maxPrice), 0],
    ];
  }

  console.log(`Predicted prices for the next 30 days:`, predictions);
  return predictions;
}

// Export the Vercel Serverless Function
module.exports = async (req, res) => {
  const { ticker } = req.query;

  try {
    console.log(`Fetching data for ${ticker}...`);
    const historicalData = await fetchHistoricalData(ticker);

    if (historicalData.length < 30) {
      throw new Error(`Not enough data to train the model for ${ticker}.`);
    }

    const model = await trainModel(ticker, historicalData);
    const latestData = historicalData.slice(-30);
    const predictions = await predictNext30Days(model, latestData);

    res.json({
      success: true,
      ticker,
      predictions,
      message: `Predicted prices for the next 30 days.`,
    });
  } catch (error) {
    console.error(`Error for ${ticker}: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
};
