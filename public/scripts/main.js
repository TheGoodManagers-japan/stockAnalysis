(async function () {
  function init() {
    const API_KEY = "ctnvkd9r01qpsueeeqigctnvkd9r01qpsueeeqj0"; // Replace with your Finnhub API Key
    const OPENAI_API_KEY =
      "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"; // Replace with your OpenAI API Key

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

    /**
     * Fetch macro news using GDELT API.
     */
    async function fetchMacroNews() {
      if (macroNewsCache) return macroNewsCache;

      const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=Japan economy&mode=ArtList`;
      const response = await fetchJson(url);
      macroNewsCache = response?.articles || [];
      return macroNewsCache;
    }

    /**
     * Fetch sector-specific news using GDELT API.
     */
    async function fetchSectorNews(sector) {
      if (sectorNewsCache[sector]) return sectorNewsCache[sector];

      const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${sector} Japan&mode=ArtList`;
      const response = await fetchJson(url);
      const articles = response?.articles || [];
      sectorNewsCache[sector] = articles;
      return articles;
    }

    /**
     * Fetch stock-specific news using Finnhub.
     */
    async function fetchNews(ticker) {
      const url = `https://finnhub.io/api/v1/news?category=company&symbol=${ticker}&token=${API_KEY}`;
      return (await fetchJson(url)) || [];
    }

    /**
     * Summarize news using OpenAI API.
     */
    async function summarizeNews(articles, context) {
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
            model: "text-davinci-003",
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

    /**
     * Analyze sentiment using OpenAI API.
     */
    async function analyzeSentiment(summary) {
      const url = `https://api.openai.com/v1/completions`;
      try {
        const response = await axios.post(
          url,
          {
            model: "text-davinci-003",
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
      sentiment,
      forecastedChange,
      macroSentiment,
      sectorSentiment,
    }) {
      const safePe = peRatio !== 0 ? peRatio : 99999;
      const safePb = pbRatio !== 0 ? pbRatio : 99999;

      let score = 0;
      score += (20 / safePe) * 0.2; // Value factors
      score += (10 / safePb) * 0.2;
      score += (eps > 0 ? eps : 0) * 0.2; // Growth factors
      score += (100 - rsi) * 0.2; // Technical factors
      if (price > fiftyDayAverage) score += 0.2; // Trend factors

      // Sentiment factors
      const stockSentimentWeight =
        sentiment === "positive" ? 0.3 : sentiment === "negative" ? -0.3 : 0;
      const macroSentimentWeight =
        macroSentiment === "positive"
          ? 0.3
          : macroSentiment === "negative"
          ? -0.3
          : 0;
      const sectorSentimentWeight =
        sectorSentiment === "positive"
          ? 0.3
          : sectorSentiment === "negative"
          ? -0.3
          : 0;
      score +=
        stockSentimentWeight + macroSentimentWeight + sectorSentimentWeight;

      score += (forecastedChange > 0 ? forecastedChange : 0) * 0.1; // Prediction factor
      return score;
    }

    /**
     * Main function to scan stocks.
     */
    async function scanStocks() {
      const results = [];
      const sectorResults = {};

      const macroNews = await fetchMacroNews();
      const macroSummary = await summarizeNews(macroNews, "macroeconomic");
      const macroSentiment = await analyzeSentiment(macroSummary);

      for (const { code: ticker, sector } of tickers) {
        const stockData = {}; // Replace with stock data fetching logic
        const { prices, volumes } = {}; // Replace with historical data fetching logic
        const forecastedChange = 5; // Replace with predicted price change logic
        const sectorNews = await fetchSectorNews(sector);
        const sectorSummary = await summarizeNews(
          sectorNews,
          `${sector} sector`
        );
        const sectorSentiment = await analyzeSentiment(sectorSummary);
        const stockNews = await fetchNews(ticker);
        const stockSummary = await summarizeNews(stockNews, "stock-specific");
        const sentiment = await analyzeSentiment(stockSummary);

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
      scanStocks,
    };
  }

  window.initStockAnalysis = init;
})();
