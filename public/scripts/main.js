import {trainAndPredict} from "./trainandpredict.js";

(async function () {
  function init(firebaseConfig) {
    console.log(firebaseConfig);

    // Initialize Firebase
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    } else {
      console.log("Firebase already initialized");
    }

    const remoteConfig = firebase.remoteConfig();
    remoteConfig.settings = {
      minimumFetchIntervalMillis: 0, // Always fetch the latest values
    };

    const tickers = [
      { code: "7203.T", sector: "Automotive" },
      { code: "6758.T", sector: "Technology" },
    ];

    /**
     * Suggest a purchase price based on the predicted price.
     * @param {number} predictedPrice - Predicted price from the model.
     * @returns {string} - Suggested purchase price.
     */
    function suggestPurchasePrice(predictedPrice) {
      return (predictedPrice * 0.97).toFixed(2); // 3% below predicted price
    }

    /**
     * Recommend stop loss and price target based on the suggested purchase price.
     * @param {number} suggestedPurchasePrice - Suggested purchase price of the stock.
     * @returns {object} - Recommended stop loss and target price.
     */
    function recommendStopLossAndTargetPrice({ suggestedPurchasePrice }) {
      const stopLoss = suggestedPurchasePrice * 0.95; // 5% below purchase price
      const targetPrice = suggestedPurchasePrice * 1.15; // 15% above purchase price

      return {
        recommendedStopLoss: stopLoss.toFixed(2),
        recommendedTargetPrice: targetPrice.toFixed(2),
      };
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

    /**
     * Scan stocks and integrate with the trainAndPredict function.
     */
    async function scanStocks() {
      const results = [];
      const sectorResults = {};

      for (const { code: ticker, sector } of tickers) {
        const stockData = {}; // Replace with stock data fetching logic
        const { prices, volumes } = {}; // Replace with historical data fetching logic
        const currentPrice = stockData.price || 1000; // Placeholder for the current price

        // Train the model and predict the price
        const predictedPrice = await trainAndPredict(ticker);

        if (!predictedPrice) {
          console.error(`No prediction available for ${ticker}.`);
          continue;
        }

        // Calculate the suggested purchase price
        const suggestedPurchasePrice = parseFloat(
          suggestPurchasePrice(predictedPrice)
        );

        // Calculate stop loss and target price
        const { recommendedStopLoss, recommendedTargetPrice } =
          recommendStopLossAndTargetPrice({
            suggestedPurchasePrice,
          });

        // Forecasted change based on predicted price
        const forecastedChange = (
          ((predictedPrice - currentPrice) / currentPrice) *
          100
        ).toFixed(2);

        // Compute the stock score
        const score = computeScore({
          peRatio: stockData.peRatio || 0,
          pbRatio: stockData.pbRatio || 0,
          eps: stockData.eps || 0,
          rsi: stockData.rsi || 50,
          price: currentPrice,
          fiftyDayAverage: stockData.fiftyDayAverage || 900,
          forecastedChange,
        });

        const stockResult = {
          ticker,
          sector,
          score: score.toFixed(3),
          forecastedChange,
          suggestedPurchasePrice: suggestedPurchasePrice.toFixed(2),
          recommendedStopLoss,
          recommendedTargetPrice,
        };

        if (!sectorResults[sector]) {
          sectorResults[sector] = [];
        }
        sectorResults[sector].push(stockResult);
      }

      // Top 10 stocks per sector
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
      scanStocks, // Expose scanStocks function
    };
  }

  window.initStockAnalysis = init; // Attach init to the global window object
})();
