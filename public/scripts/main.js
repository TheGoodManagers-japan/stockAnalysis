import { analyzeStock } from "./trainandpredict.js";

// Create the `scan` namespace on the `window` object
window.scan = {
  // Initialize the fetchStockAnalysis function
  async fetchStockAnalysis() {
    try {
      const response = await fetch(
        "https://stock-analysis-thegoodmanagers-japan-aymerics-projects-60f33831.vercel.app/api/stocks"
      );

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        console.log("Top Stocks by Sector:", data.data);

        // Loop through the stocks and analyze each
        for (const stock of data.data) {
          console.log(`Analyzing stock: ${stock.ticker}`);
          const predictions = await analyzeStock(stock.ticker);

          // Refine the stock data with predictions
          stock.predictions = predictions;
          stock.predictedGrowth = predictions.length
            ? (predictions[predictions.length - 1] - stock.currentPrice) /
              stock.currentPrice
            : null;

          // Refine stop loss and target price
          const { stopLoss, targetPrice } = calculateStopLossAndTarget(
            stock,
            predictions
          );
          stock.stopLoss = stopLoss;
          stock.targetPrice = targetPrice;

          // Refine the stock score
          stock.score = computeScore(stock, predictions);

          console.log(`Updated stock data for ${stock.ticker}:`, stock);
        }

        console.log("Refined stock data:", data.data);
      } else {
        console.error("Error fetching stock analysis:", data.message);
      }
    } catch (error) {
      console.error("Fetch Error:", error.message);
    }
  },
};
