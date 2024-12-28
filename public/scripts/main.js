const axios = require("axios");
const Bottleneck = require("bottleneck");
const { Configuration, OpenAIApi } = require("openai");
require("dotenv").config();
const tf = require("@tensorflow/tfjs-node");

const API_KEY = process.env.RAPIDAPI_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const openai = new OpenAIApi(
  new Configuration({
    apiKey: OPENAI_API_KEY,
  })
);

const tickers = ["7203.T", "6758.T", "9984.T"]; // Example tickers
const totalCapital = 100000; // Total available capital (e.g., $100,000)

// Helper to parse numeric values
function toNumber(value) {
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

// Create a Bottleneck limiter to handle API requests
const limiter = new Bottleneck({
  minTime: 200, // Minimum time between requests (in ms)
  maxConcurrent: 5, // Maximum number of concurrent requests
});

// Wrap axios calls with the limiter
async function limitedAxiosGet(url, headers) {
  return limiter.schedule(() =>
    axios.get(url, { headers }).catch((error) => {
      console.error(`API Error: ${error.message}`);
      return null;
    })
  );
}

// Fetch stock data
async function fetchStockData(ticker) {
  const url = `https://yahoo-finance15.p.rapidapi.com/api/yahoo/qu/quote/${ticker}`;
  const headers = {
    "X-RapidAPI-Key": API_KEY,
    "X-RapidAPI-Host": "yahoo-finance15.p.rapidapi.com",
  };
  const response = await limitedAxiosGet(url, headers);
  if (!response || !response.data) return null;

  const data = response.data[0];
  return {
    peRatio: toNumber(data.peRatio),
    pbRatio: toNumber(data.priceToBook),
    eps: toNumber(data.eps),
    price: toNumber(data.regularMarketPrice),
    fiftyDayAverage: toNumber(data.fiftyDayAverage),
  };
}

// Fetch financial metrics
async function fetchFinancialMetrics(ticker) {
  const url = `https://yahoo-finance15.p.rapidapi.com/api/yahoo/qu/statistics/${ticker}`;
  const headers = {
    "X-RapidAPI-Key": API_KEY,
    "X-RapidAPI-Host": "yahoo-finance15.p.rapidapi.com",
  };
  const response = await limitedAxiosGet(url, headers);
  if (!response || !response.data)
    return { revenueGrowth: 0, earningsGrowth: 0, debtEquityRatio: 0 };

  const stats = response.data;
  return {
    revenueGrowth: toNumber(stats.financialData.revenueGrowth || 0),
    earningsGrowth: toNumber(stats.financialData.earningsGrowth || 0),
    debtEquityRatio: toNumber(stats.financialData.debtToEquity || 0),
  };
}

// Fetch historical price data
async function fetchHistoricalData(ticker) {
  const url = `https://yahoo-finance15.p.rapidapi.com/api/yahoo/qu/chart/${ticker}`;
  const headers = {
    "X-RapidAPI-Key": API_KEY,
    "X-RapidAPI-Host": "yahoo-finance15.p.rapidapi.com",
  };
  const response = await limitedAxiosGet(url, headers);
  if (!response || !response.data) return [];

  return response.data.chart.result[0].indicators.quote[0].close || [];
}

// Fetch news and perform sentiment analysis
async function fetchAndAnalyzeNews(ticker) {
  const url = `https://yahoo-finance15.p.rapidapi.com/api/yahoo/qu/news/${ticker}`;
  const headers = {
    "X-RapidAPI-Key": API_KEY,
    "X-RapidAPI-Host": "yahoo-finance15.p.rapidapi.com",
  };
  const response = await limitedAxiosGet(url, headers);
  if (!response || !response.data) return { sentimentScore: 0 };

  const articles = response.data.slice(0, 5);
  const text = articles
    .map((a) => `${a.title}: ${a.summary || a.title}`)
    .join("\n");

  const sentimentResponse = await openai.createCompletion({
    model: "text-davinci-003",
    prompt: `Determine the sentiment of the following news articles and return a score between -1 (negative) and 1 (positive):\n\n${text}\n\nScore:`,
    max_tokens: 10,
  });

  const sentimentScore =
    parseFloat(sentimentResponse.data.choices[0].text.trim()) || 0;
  return { sentimentScore };
}

// Main function
async function scanStocks() {
  const results = [];

  for (const ticker of tickers) {
    const stockData = await fetchStockData(ticker);
    if (!stockData) continue;

    const financialMetrics = await fetchFinancialMetrics(ticker);
    const prices = await fetchHistoricalData(ticker);

    const forecastedChange =
      prices.length > 0 ? await predictPriceChange(prices) : 0;

    const { sentimentScore } = await fetchAndAnalyzeNews(ticker);

    const score = computeScore({
      ...stockData,
      ...financialMetrics,
      rsi: 50, // Placeholder for RSI, replace with real RSI data if available
      forecastedChange,
      sentimentScore,
    });

    results.push({ ticker, score, forecastedChange, sentimentScore });
  }

  results.sort((a, b) => b.score - a.score);

  console.log("Top Stocks:");
  console.log(JSON.stringify(results.slice(0, 10), null, 2));
}

const tf = require("@tensorflow/tfjs-node");

/**
 * Predicts the percentage change in price using a more advanced LSTM model.
 * @param {Array<number>} prices - Array of historical prices.
 * @param {Array<number>} volumes - Array of historical trading volumes.
 * @returns {Promise<number>} - Predicted percentage change in price.
 */
async function predictPriceChange(prices, volumes) {
  if (prices.length < 30) {
    console.error(
      "Not enough data to make a prediction. At least 30 data points are needed."
    );
    return 0;
  }

  // Normalize prices and volumes
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const normalizedPrices = prices.map(
    (price) => (price - minPrice) / (maxPrice - minPrice)
  );

  const minVolume = Math.min(...volumes);
  const maxVolume = Math.max(...volumes);
  const normalizedVolumes = volumes.map(
    (volume) => (volume - minVolume) / (maxVolume - minVolume)
  );

  // Combine prices and volumes into a feature matrix
  const features = normalizedPrices.map((price, index) => [
    price,
    normalizedVolumes[index],
  ]);

  // Prepare sliding windows
  const sequenceLength = 30;
  const inputs = [];
  for (let i = 0; i < features.length - sequenceLength; i++) {
    inputs.push(features.slice(i, i + sequenceLength));
  }

  const inputTensor = tf.tensor3d(inputs);
  const inputShape = [sequenceLength, 2]; // Each input has 30 timesteps and 2 features

  // Build the improved LSTM model
  const model = tf.sequential();
  model.add(tf.layers.lstm({ units: 64, returnSequences: true, inputShape }));
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.lstm({ units: 32 }));
  model.add(tf.layers.dense({ units: 1 })); // Predict a single value (price change)
  model.compile({
    optimizer: tf.train.adam(),
    loss: "meanSquaredError",
  });

  // Split data into training and testing sets (80/20 split)
  const trainSize = Math.floor(inputs.length * 0.8);
  const trainX = inputTensor.slice([0, 0, 0], [trainSize, sequenceLength, 2]);
  const trainY = tf.tensor2d(
    normalizedPrices.slice(sequenceLength, sequenceLength + trainSize),
    [trainSize, 1]
  );

  const testX = inputTensor.slice(
    [trainSize, 0, 0],
    [inputs.length - trainSize, sequenceLength, 2]
  );
  const testY = tf.tensor2d(
    normalizedPrices.slice(
      sequenceLength + trainSize,
      sequenceLength + inputs.length
    ),
    [inputs.length - trainSize, 1]
  );

  // Train the model
  await model.fit(trainX, trainY, {
    epochs: 100,
    batchSize: 32,
    validationSplit: 0.2,
    verbose: 1,
  });

  // Predict the next value using the last sequence of data
  const lastSequence = features.slice(-sequenceLength);
  const predictionTensor = tf.tensor3d([lastSequence], [1, sequenceLength, 2]);
  const prediction = model.predict(predictionTensor).dataSync()[0];

  // Convert the prediction back to percentage change
  const denormalizedPrediction = prediction * (maxPrice - minPrice) + minPrice;
  const lastPrice = prices[prices.length - 1];
  const percentChange =
    ((denormalizedPrediction - lastPrice) / lastPrice) * 100;

  return percentChange;
}

scanStocks();
