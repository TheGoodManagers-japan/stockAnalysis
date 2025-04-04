const API_KEY = process.env.RAPIDAPI_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const openai = new OpenAIApi(
  new Configuration({
    apiKey: OPENAI_API_KEY,
  })
);

const tickers = ["7203.T", "6758.T", "9984.T"]; // Example tickers
const totalCapital = 100000; // Total available capital (e.g., $100,000)

/**
 * Fetches historical stock prices and volumes.
 * @param {string} ticker - Stock ticker symbol.
 * @returns {Promise<{ prices: number[], volumes: number[] }>} - Historical prices and volumes.
 */


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

// Helper to parse numeric values
function toNumber(value) {
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

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
