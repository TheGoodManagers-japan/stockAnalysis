// Helper to handle API rate-limiting
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

async function fetchStockData(ticker, apiKey) {
  const url = `https://yahoo-finance15.p.rapidapi.com/api/yahoo/qu/quote/${ticker}`;
  const headers = {
    "X-RapidAPI-Key": apiKey,
    "X-RapidAPI-Host": "yahoo-finance15.p.rapidapi.com",
  };
  const response = await limitedAxiosGet(url, headers);
  if (!response || !response.data) return null;

  const data = response.data[0];
  return {
    peRatio: parseFloat(data.peRatio || 0),
    pbRatio: parseFloat(data.priceToBook || 0),
    eps: parseFloat(data.eps || 0),
    price: parseFloat(data.regularMarketPrice || 0),
  };
}

export { fetchStockData };
