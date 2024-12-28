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
      { code: "4151", sector: "Pharmaceuticals" },
      { code: "4502", sector: "Pharmaceuticals" },
      { code: "4503", sector: "Pharmaceuticals" },
      { code: "7203", sector: "Automobiles" },
      { code: "6758", sector: "Electronics" },
      { code: "9984", sector: "Technology" },
    ];

    function toNumber(value) {
      const num = parseFloat(value);
      return isNaN(num) ? 0 : num;
    }

    const limiter = new Bottleneck({
      minTime: 1000, // 1 request per second
      maxConcurrent: 1, // Allow only one request at a time
    });


    async function limitedAxiosGet(url, headers = {}) {
      try {
        return await limiter.schedule(() => axios.get(url, { headers }));
      } catch (error) {
        console.error("API Error:", error.response?.data || error.message);
        throw error;
      }
    }

    async function fetchYahooFinanceData(ticker) {
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}.T`;
      try {
        const response = await limitedAxiosGet(url);
        const data = response.data.quoteResponse?.result[0];

        if (!data) {
          console.warn(`No Yahoo Finance data available for ${ticker}`);
          return null;
        }

        // Extract relevant metrics
        return {
          currentPrice: toNumber(data.regularMarketPrice),
          highPrice: toNumber(data.regularMarketDayHigh),
          lowPrice: toNumber(data.regularMarketDayLow),
          openPrice: toNumber(data.regularMarketOpen),
          prevClosePrice: toNumber(data.regularMarketPreviousClose),
          peRatio: toNumber(data.trailingPE),
          pbRatio: toNumber(data.priceToBook),
          dividendYield: toNumber(data.dividendYield) * 100, // Convert to percentage
          marketCap: toNumber(data.marketCap),
          fiftyTwoWeekHigh: toNumber(data.fiftyTwoWeekHigh),
          fiftyTwoWeekLow: toNumber(data.fiftyTwoWeekLow),
        };
      } catch (error) {
        console.error(
          `Error fetching Yahoo Finance data for ${ticker}:`,
          error.message
        );
        return null;
      }
    }

    function computeScore(data) {
      const {
        peRatio,
        pbRatio,
        dividendYield,
        currentPrice,
        highPrice,
        lowPrice,
        fiftyTwoWeekHigh,
        fiftyTwoWeekLow,
      } = data;

      return (
        0.3 * (1 / (peRatio || 1)) +
        0.2 * (1 / (pbRatio || 1)) +
        0.2 * (dividendYield || 0) +
        0.2 * ((fiftyTwoWeekHigh - fiftyTwoWeekLow) / (currentPrice || 1)) +
        0.1 * ((highPrice - lowPrice) / (currentPrice || 1))
      );
    }

    function calculateStopLossAndTarget(data) {
      const { currentPrice, highPrice, lowPrice } = data;

      if (currentPrice <= 0 || highPrice <= 0 || lowPrice <= 0) {
        return { stopLoss: 0, targetPrice: 0 };
      }

      const stopLoss = currentPrice * 0.9; // 10% below current price
      const targetPrice = currentPrice * 1.15; // 15% above current price

      return {
        stopLoss: Math.max(stopLoss, lowPrice * 0.95), // At least 5% below recent low
        targetPrice: Math.min(targetPrice, highPrice * 1.1), // 10% above recent high
      };
    }

    async function scanStocks() {
      try {
        const sectorResults = {};

        for (const { code, sector } of tickers) {
          const stockData = await fetchYahooFinanceData(code);
          if (!stockData) {
            console.warn(`Skipping ticker ${code} due to missing data.`);
            continue;
          }

          const score = computeScore(stockData);
          const { stopLoss, targetPrice } =
            calculateStopLossAndTarget(stockData);

          if (!sectorResults[sector]) {
            sectorResults[sector] = [];
          }

          sectorResults[sector].push({
            ticker: code,
            score,
            stopLoss,
            targetPrice,
          });
        }

        Object.keys(sectorResults).forEach((sector) => {
          sectorResults[sector].sort((a, b) => b.score - a.score);
          sectorResults[sector] = sectorResults[sector].slice(0, 10);
        });

        console.log("Top Stocks by Sector (with Stop-Loss and Target):");
        console.log(JSON.stringify(sectorResults, null, 2));
      } catch (error) {
        console.error("Error during stock scanning:", error.message);
      }
    }

    return {
      scanStocks,
    };
  }

  window.initStockAnalysis = init;
})();
