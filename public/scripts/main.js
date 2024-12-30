import { analyzeStock } from "./trainandpredict.js";

// ------------------------------------------
// 1) Helper: stop-loss & target-price logic
// -----------------------------------------
function calculateStopLossAndTarget(stock, predictions) {
  // Example approach: 5% below current price for stop-loss, 20% above for target
  const stopLoss = stock.currentPrice * 0.95;
  const targetPrice = stock.currentPrice * 1.2;
  return { stopLoss, targetPrice };
}

// ------------------------------------------
// 2) Helper: scoring logic
// ------------------------------------------
function computeScore(stock, predictions) {
  // Example approach: let’s just return the number of predictions
  return predictions.length;
}

// ------------------------------------------
// 3) Function to POST a single ticker to /api/stocks
// ------------------------------------------
async function fetchSingleStockData(tickerObj) {
  try {
    const response = await fetch(
      "https://stock-analysis-thegoodmanagers-japan-aymerics-projects-60f33831.vercel.app/api/stocks",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: tickerObj }), // sending one ticker
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    // Server should return { success: true, data: { code, sector, yahooData: {...} } }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Fetch Error:", error.message);
    return { success: false, error: error.message };
  }
}

// ------------------------------------------
// 4) The main function to fetch & analyze
// ------------------------------------------
// Attach to `window.scan` so you can call window.scan.fetchStockAnalysis() in the browser
window.scan = {
  async fetchStockAnalysis() {
    try {
      // (A) Define the tickers on the client side
      // You can modify or dynamically get these from somewhere else
      const tickers = [
        { code: "4151.T", sector: "Pharmaceuticals" },
        { code: "4502.T", sector: "Pharmaceuticals" },
        { code: "9532.T", sector: "Gas" },
      ];

      // (B) We'll accumulate final refined stocks by sector
      const groupedBySector = {};
      // e.g. { "Pharmaceuticals": [ {...}, {...} ], "Gas": [ {...} ] }

      // (C) Loop through each ticker, fetch data, run analysis
      for (const tickerObj of tickers) {
        console.log(`\n--- Fetching data for ${tickerObj.code} ---`);

        // 1) Fetch Yahoo data from the server
        const result = await fetchSingleStockData(tickerObj);
        console.log("Server result:", result);
        if (!result.success) {
          console.error("Error fetching stock analysis:", result.error);
          continue; // skip this ticker if an error occurred
        }

        // 2) Deconstruct the server response
        const { code, sector, yahooData } = result.data;
        if (!yahooData) {
          console.warn(`No Yahoo data returned for ticker: ${code}`);
          continue;
        }

        // 3) Build a local 'stock' object with all fields you need
        const stock = {
          // Basic
          ticker: code,
          sector,

          // Yahoo data
          currentPrice: yahooData.currentPrice,
          highPrice: yahooData.highPrice,
          lowPrice: yahooData.lowPrice,
          openPrice: yahooData.openPrice,
          prevClosePrice: yahooData.prevClosePrice,
          marketCap: yahooData.marketCap,
          peRatio: yahooData.peRatio,
          pbRatio: yahooData.pbRatio,
          dividendYield: yahooData.dividendYield,
          fiftyTwoWeekHigh: yahooData.fiftyTwoWeekHigh,
          fiftyTwoWeekLow: yahooData.fiftyTwoWeekLow,
          eps: yahooData.eps,
        };

        // 4) Run your ML/predictive analysis
        console.log(`Analyzing stock: ${stock.ticker}`);
        const predictions = await analyzeStock(stock.ticker);
        console.log(`predictions :`, predictions);


        // 5) Merge predictions data
        stock.predictions = predictions;
        if (predictions.length > 0) {
          const lastPrediction = predictions[predictions.length - 1];
          stock.predictedGrowth =
            (lastPrediction - stock.currentPrice) / stock.currentPrice;
        } else {
          stock.predictedGrowth = null;
        }

        // 6) Calculate stop loss & target price
        const { stopLoss, targetPrice } = calculateStopLossAndTarget(
          stock,
          predictions
        );
        stock.stopLoss = stopLoss;
        stock.targetPrice = targetPrice;

        // 7) Compute your “score”
        stock.score = computeScore(stock, predictions);

        // 8) Add this refined stock to the grouping by sector
        if (!groupedBySector[stock.sector]) {
          groupedBySector[stock.sector] = [];
        }
        groupedBySector[stock.sector].push(stock);

        // You can also log right away
        console.log(`Updated stock data for ${stock.ticker}:`, stock);
      }

      // (D) Finally, log the grouped data so you see everything
      console.log("\nFinal grouped data by sector:", groupedBySector);
    } catch (error) {
      console.error("Error in fetchStockAnalysis:", error.message);
    }
  },
};
