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

    let macroNewsCache = null;
    let sectorNewsCache = {};

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
        const OPENAI_API_KEY = remoteConfig.getValue("api_openai").asString();

        if (!API_KEY || !OPENAI_API_KEY) {
          throw new Error("API keys not available in Remote Config.");
        }

        return { API_KEY, OPENAI_API_KEY };
      } catch (error) {
        console.error("Failed to fetch API keys:", error.message);
        throw error;
      }
    }

    async function fetchMacroNews() {
      if (macroNewsCache) return macroNewsCache;

      const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=Japan economy&mode=ArtList`;
      const response = await fetchJson(url);
      macroNewsCache = response?.articles || [];
      return macroNewsCache;
    }

    async function fetchSectorNews(sector) {
      if (sectorNewsCache[sector]) return sectorNewsCache[sector];

      const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${sector} Japan&mode=ArtList`;
      const response = await fetchJson(url);
      const articles = response?.articles || [];
      sectorNewsCache[sector] = articles;
      return articles;
    }

    async function fetchNews(ticker, API_KEY) {
      const url = `https://finnhub.io/api/v1/news?category=company&symbol=${ticker}&token=${API_KEY}`;
      return (await fetchJson(url)) || [];
    }

    async function summarizeNews(articles, context, OPENAI_API_KEY) {
      const text = articles
        .map(
          (article) =>
            `${article.title}: ${article.description || article.title}`
        )
        .join("\n");
      const url = `https://api.openai.com/v1/completions`;
      try {
        const response = await axios.post(
          url,
          {
            model: "gpt-4o-mini",
            prompt: `Summarize the following ${context} news articles into a concise paragraph:\n\n${text}`,
            max_tokens: 150,
          },
          {
            headers: {
              Authorization: `Bearer ${OPENAI_API_KEY}`,
              "Content-Type": "application/json",
            },
          }
        );
        return response.data.choices[0]?.text.trim() || "No summary available.";
      } catch (error) {
        console.error("Error summarizing news:", error.message);
        return "No summary available.";
      }
    }

    async function analyzeSentiment(summary, OPENAI_API_KEY) {
      const url = `https://api.openai.com/v1/completions`;
      try {
        const response = await axios.post(
          url,
          {
            model: "gpt-4o-mini",
            prompt: `Determine the sentiment of this text (positive, neutral, or negative):\n\n${summary}\n\nSentiment:`,
            max_tokens: 10,
          },
          {
            headers: {
              Authorization: `Bearer ${OPENAI_API_KEY}`,
              "Content-Type": "application/json",
            },
          }
        );
        return response.data.choices[0]?.text.trim() || "neutral";
      } catch (error) {
        console.error("Error analyzing sentiment:", error.message);
        return "neutral";
      }
    }

    async function scanStocks() {
      const { API_KEY, OPENAI_API_KEY } = await fetchAPIKeys();

      const results = [];
      const sectorResults = {};

      const macroNews = await fetchMacroNews();
      const macroSummary = await summarizeNews(
        macroNews,
        "macroeconomic",
        OPENAI_API_KEY
      );
      const macroSentiment = await analyzeSentiment(
        macroSummary,
        OPENAI_API_KEY
      );

      for (const { code: ticker, sector } of tickers) {
        const stockData = {}; // Replace with stock data fetching logic
        const { prices, volumes } = {}; // Replace with historical data fetching logic
        const forecastedChange = 5; // Replace with predicted price change logic
        const sectorNews = await fetchSectorNews(sector);
        const sectorSummary = await summarizeNews(
          sectorNews,
          `${sector} sector`,
          OPENAI_API_KEY
        );
        const sectorSentiment = await analyzeSentiment(
          sectorSummary,
          OPENAI_API_KEY
        );
        const stockNews = await fetchNews(ticker, API_KEY);
        const stockSummary = await summarizeNews(
          stockNews,
          "stock-specific",
          OPENAI_API_KEY
        );
        const sentiment = await analyzeSentiment(stockSummary, OPENAI_API_KEY);

        const score = computeScore({
          peRatio: stockData.peRatio || 0,
          pbRatio: stockData.pbRatio || 0,
          eps: stockData.eps || 0,
          rsi: stockData.rsi || 50,
          price: stockData.price || 1000,
          fiftyDayAverage: stockData.fiftyDayAverage || 900,
          sentiment,
          forecastedChange,
          macroSentiment,
          sectorSentiment,
        });

        const stockResult = {
          ticker,
          sector,
          score: score.toFixed(3),
          macroSummary,
          sectorSummary,
          stockSummary,
          macroSentiment,
          sectorSentiment,
          sentiment,
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

    return {
      scanStocks, // Return scanStocks so it can be called independently
    };
  }

  window.initStockAnalysis = init; // Attach init to window for global access
})();
