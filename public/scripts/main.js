(async function () {
  function init(firebaseConfig) {
    console.log(firebaseConfig);

    // Initialize Firebase
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    } else {
      console.log("Firebase already initialized");
    }

    // Initialize Remote Config
    const remoteConfig = firebase.remoteConfig();
    remoteConfig.settings = {
      minimumFetchIntervalMillis: 0, // Always fetch the latest values
    };

    const tickers = [
      { code: "7203.T", sector: "Automotive" },
      { code: "6758.T", sector: "Technology" },
    ];

    async function fetchJson(url) {
      try {
        const response = await axios.get(url);
        return response.data;
      } catch (error) {
        console.error(`Failed to fetch data from ${url}:`, error.message);
        return null;
      }
    }

    async function fetchAPIKeys() {
      try {
        await remoteConfig.fetchAndActivate();
        const API_KEY = remoteConfig.getValue("api_finnhub").asString();

        if (!API_KEY) {
          throw new Error("API keys not available in Remote Config.");
        }

        return { API_KEY };
      } catch (error) {
        console.error("Failed to fetch API keys:", error.message);
        throw error;
      }
    }

    async function scanStocks() {
      const { API_KEY } = await fetchAPIKeys();

      const results = [];
      const sectorResults = {};

      for (const { code: ticker, sector } of tickers) {
        const stockData = {}; // Replace with stock data fetching logic
        const { prices, volumes } = {}; // Replace with historical data fetching logic
        const forecastedChange = 5; // Replace with predicted price change logic

        const score = computeScore({
          peRatio: stockData.peRatio || 0,
          pbRatio: stockData.pbRatio || 0,
          eps: stockData.eps || 0,
          rsi: stockData.rsi || 50,
          price: stockData.price || 1000,
          fiftyDayAverage: stockData.fiftyDayAverage || 900,
          forecastedChange,
        });

        const stockResult = {
          ticker,
          sector,
          score: score.toFixed(3),
          forecastedChange: forecastedChange.toFixed(2),
        };

        if (!sectorResults[sector]) {
          sectorResults[sector] = [];
        }
        sectorResults[sector].push(stockResult);
      }

      const topStocksBySector = {};
      for (const sector in sectorResults) {
        topStocksBySector[sector] = sectorResults[sector]
          .sort((a, b) => b.score - a.score)
          .slice(0, 10);
      }

      console.log("Top 10 Stocks Per Sector:");
      console.log(JSON.stringify(topStocksBySector, null, 2));
    }

    /**
     * Compute the score for a stock.
     */
    function computeScore({
      peRatio,
      pbRatio,
      eps,
      rsi,
      price,
      fiftyDayAverage,
      forecastedChange,
    }) {
      const safePe = peRatio !== 0 ? peRatio : 99999;
      const safePb = pbRatio !== 0 ? pbRatio : 99999;

      let score = 0;
      score += (20 / safePe) * 0.2; // Value factors
      score += (10 / safePb) * 0.2;
      score += (eps > 0 ? eps : 0) * 0.2; // Growth factors
      score += (100 - rsi) * 0.2; // Technical factors
      if (price > fiftyDayAverage) score += 0.2; // Trend factors
      score += (forecastedChange > 0 ? forecastedChange : 0) * 0.1; // Prediction factor

      return score;
    }

    return {
      scanStocks, // Return scanStocks so it can be called independently
    };
  }

  window.initStockAnalysis = init; // Attach init to window for global access
})();
