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

    async function fetchAPIKeys() {
      try {
        await remoteConfig.fetchAndActivate();
        const API_KEY = remoteConfig.getValue("api_finnhub").asString();

        console.log(API_KEY)

        if (!API_KEY) {
          throw new Error("API keys not available in Remote Config.");
        }
        return { API_KEY };
      } catch (error) {
        console.error("Failed to fetch API keys:", error.message);
        throw error;
      }
    }

    const tickers = [
      { code: "4151.T", sector: "Pharmaceuticals" },
      { code: "4502.T", sector: "Pharmaceuticals" },
      { code: "4503.T", sector: "Pharmaceuticals" },
      { code: "7203.T", sector: "Automobiles" },
      { code: "6758.T", sector: "Electronics" },
      { code: "9984.T", sector: "Technology" },
    ];

    function toNumber(value) {
      const num = parseFloat(value);
      return isNaN(num) ? 0 : num;
    }

    const limiter = new Bottleneck({
      minTime: 1000, // 1 request per second (60 requests/min)
      maxConcurrent: 1, // Allow only one request at a time
    });


    async function limitedAxiosGet(url, headers) {
      return limiter.schedule(() =>
        axios.get(url, { headers }).catch((error) => {
          console.error(`API Error: ${error.message}`);
          return null;
        })
      );
    }

    async function fetchStockData(ticker, API_KEY) {
      const url = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${API_KEY}`;
      const response = await limitedAxiosGet(url, {});
      if (!response || !response.data) return null;

      const data = response.data;
      return {
        currentPrice: toNumber(data.c),
        highPrice: toNumber(data.h),
        lowPrice: toNumber(data.l),
        openPrice: toNumber(data.o),
        prevClosePrice: toNumber(data.pc),
      };
    }

    async function fetchFinancialMetrics(ticker, API_KEY) {
      const url = `https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${API_KEY}`;
      const response = await limitedAxiosGet(url, {});
      if (!response || !response.data)
        return {
          peRatio: 0,
          pbRatio: 0,
          dividendYield: 0,
          debtToEquity: 0,
          returnOnEquity: 0,
          revenueGrowth: 0,
          freeCashFlow: 0,
        };

      const metrics = response.data.metric;
      return {
        peRatio: toNumber(metrics.peBasicExclExtraTTM),
        pbRatio: toNumber(metrics.pbAnnual),
        dividendYield: toNumber(metrics.dividendYieldAnnual),
        debtToEquity: toNumber(metrics.totalDebtToEquityAnnual),
        returnOnEquity: toNumber(metrics.roeTTM),
        revenueGrowth: toNumber(metrics.revenueGrowthTTM),
        freeCashFlow: toNumber(metrics.freeCashFlowTTM),
      };
    }

    function computeScore(data) {
      const {
        peRatio,
        pbRatio,
        dividendYield,
        debtToEquity,
        returnOnEquity,
        revenueGrowth,
        freeCashFlow,
        currentPrice,
        highPrice,
        lowPrice,
      } = data;

      return (
        0.3 * (1 / (peRatio || 1)) +
        0.2 * (1 / (pbRatio || 1)) +
        0.2 * (dividendYield || 0) +
        0.1 * (1 / (debtToEquity || 1)) +
        0.1 * (returnOnEquity || 0) +
        0.1 * (revenueGrowth || 0) +
        0.1 * (freeCashFlow || 0) +
        (highPrice - lowPrice) / (currentPrice || 1)
      );
    }

    function calculateStopLossAndTarget(data) {
      const { currentPrice, highPrice, lowPrice } = data;

      // Adjust stop-loss and target for a medium-term strategy
      const stopLoss = currentPrice * 0.9; // 10% below current price
      const targetPrice = currentPrice * 1.15; // 15% above current price

      // Use recent lows and highs to refine stop-loss and target
      return {
        stopLoss: Math.max(stopLoss, lowPrice * 0.95), // At least 5% below recent low
        targetPrice: Math.min(targetPrice, highPrice * 1.1), // 10% above recent high
      };
    }

    async function scanStocks() {
      try {
        const { API_KEY } = await fetchAPIKeys();
        const sectorResults = {};

        for (const { code, sector } of tickers) {
          const stockData = await fetchStockData(code, API_KEY);
          if (!stockData) continue;

          const financialMetrics = await fetchFinancialMetrics(code, API_KEY);

          const score = computeScore({
            ...stockData,
            ...financialMetrics,
          });

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
