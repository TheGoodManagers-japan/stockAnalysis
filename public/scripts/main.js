import { getComprehensiveEntryTiming } from "./entryTimingScore.js";
import { getBuyTrigger } from "./buyNowSignal.js";
import {
  getTechnicalScore,
  getAdvancedFundamentalScore,
  getValuationScore,
  getNumericTier
} from "./techFundValAnalysis.js";
import { allTickers } from "./tickers.js";




async function fetchSingleStockData(tickerObj) {
  try {
    const response = await fetch(
      "https://stock-analysis-thegoodmanagers-japan-aymerics-projects-60f33831.vercel.app/api/stocks",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: tickerObj }),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();
    console.log("data :", data);
    return data;
  } catch (error) {
    console.error("Fetch Error:", error.message);
    return { success: false, error: error.message };
  }
}

/***********************************************
 * 5) FETCH HISTORICAL DATA
 ***********************************************/
async function fetchHistoricalData(ticker) {
  try {
    const apiUrl = `https://stock-analysis-thegoodmanagers-japan-aymerics-projects-60f33831.vercel.app/api/history?ticker=${ticker}`;
    console.log(`Fetching historical data from: ${apiUrl}`);

    const response = await fetch(apiUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    console.log(`Response: ${response}`);
    const result = await response.json();
    console.log(`Response body:`, result);

    if (!response.ok || !result.success) {
      throw new Error(result.error || `HTTP error! Status: ${response.status}`);
    }

    if (!result.data || result.data.length === 0) {
      console.warn(`No historical data available for ${ticker}.`);
      return [];
    }

    console.log(`Historical data for ${ticker} fetched successfully.`);
    return result.data.map((item) => ({
      ...item,
      date: new Date(item.date),
      // e.g. { close, high, low, volume } expected
    }));
  } catch (error) {
    console.error(`Error fetching historical data for ${ticker}:`, error);
    return [];
  }
}


/**
 * (V2 - Enhanced) Analyzes a stock you own to provide a "Hold," "Protect Profit," or "Sell Now" signal.
 * @param {object} stock - The full, updated stock object.
 * @param {object} trade - An object with your trade details: { entryPrice, stopLoss, priceTarget }.
 * @param {array} historicalData - The array of historical data.
 * @returns {{status: string, reason: string}} - The recommended action and the reason why.
 */
function getTradeManagementSignal_V2(stock, trade, historicalData) {
  const { currentPrice, movingAverage25d, macd, macdSignal } = stock;
  const { entryPrice, stopLoss, priceTarget } = trade;

  // --- 1. Check for Hard Sell Rules (Target or Stop-Loss) ---
  if (currentPrice >= priceTarget) {
    return {
      status: "Sell Now",
      reason: `Take Profit: Price reached target of ¥${priceTarget}.`,
    };
  }
  if (currentPrice <= stopLoss) {
    return {
      status: "Sell Now",
      reason: `Stop-Loss: Price hit stop-loss at ¥${stopLoss}.`,
    };
  }

  // --- 2. NEW: Check for "Protect Profit" Warnings (only if the trade is profitable) ---
  const isProfitable = currentPrice > entryPrice;
  if (isProfitable) {
    // Warning 1: Has momentum turned negative?
    const hasMacdBearishCross = macd < macdSignal;
    if (hasMacdBearishCross) {
      return {
        status: "Protect Profit",
        reason:
          "Warning: Momentum (MACD) has turned bearish. Consider taking profits.",
      };
    }

    // Warning 2: Has the medium-term trend support broken?
    const below25dMA = currentPrice < movingAverage25d;
    if (below25dMA) {
      return {
        status: "Protect Profit",
        reason:
          "Warning: Price broke below 25-day MA support. Consider taking profits.",
      };
    }
  }

  // --- 3. Check for Bearish Reversal Patterns (another reason to sell) ---
  if (historicalData.length >= 2) {
    const today = historicalData[historicalData.length - 1];
    const yesterday = historicalData[historicalData.length - 2];
    const isBearishEngulfing =
      today.close < today.open &&
      yesterday.close > yesterday.open &&
      today.close < yesterday.open &&
      today.open > yesterday.close;
    if (isBearishEngulfing) {
      return {
        status: "Sell Now",
        reason: "Trend Reversal: Strong bearish engulfing pattern appeared.",
      };
    }
  }

  // --- 4. If no sell signals are found, the signal is to Hold ---
  return {
    status: "Hold",
    reason: "Uptrend remains intact. Price is above key support.",
  };
}

const tickerList = allTickers

/***********************************************
 * 6) SCAN LOGIC (Main Workflow)
 ***********************************************/
window.scan = {
  async fetchStockAnalysis(tickerList = [], myPortfolio) {
    try {
      const filteredTickers =
        tickerList.length > 0
          ? allTickers.filter((t) =>
              tickerList.includes(t.code.replace(".T", ""))
            )
          : allTickers;

      for (const tickerObj of filteredTickers) {
        console.log(`\n--- Fetching data for ${tickerObj.code} ---`);

        try {
          // 1) Fetch Yahoo data
          const result = await fetchSingleStockData(tickerObj);
          if (!result.success) {
            console.error("Error fetching stock analysis:", result.error);
            throw new Error("Failed to fetch Yahoo data.");
          }

          const { code, sector, yahooData } = result.data; // First check if yahooData exists at all

          if (!yahooData) {
            console.error(
              `Missing Yahoo data for ${code}. Aborting calculation.`
            );
            throw new Error("Yahoo data is completely missing.");
          } // Define critical fields that must be present

          const criticalFields = ["currentPrice", "highPrice", "lowPrice"];
          const missingCriticalFields = criticalFields.filter(
            (field) => !yahooData[field]
          ); // Define non-critical fields to check

          const nonCriticalFields = [
            "openPrice",
            "prevClosePrice",
            "marketCap",
            "peRatio",
            "pbRatio",
            "dividendYield",
            "dividendGrowth5yr",
            "fiftyTwoWeekHigh",
            "fiftyTwoWeekLow",
            "epsTrailingTwelveMonths",
            "epsForward",
            "epsGrowthRate",
            "debtEquityRatio",
            "movingAverage50d",
            "movingAverage200d",
            "rsi14",
            "macd",
            "macdSignal",
            "bollingerMid",
            "bollingerUpper",
            "bollingerLower",
            "stochasticK",
            "stochasticD",
            "obv",
            "atr14",
          ];
          const missingNonCriticalFields = nonCriticalFields.filter(
            (field) =>
              yahooData[field] === undefined || yahooData[field] === null
          ); // Check for zero values (which might indicate failures in calculations)

          const zeroFields = [...criticalFields, ...nonCriticalFields].filter(
            (field) =>
              yahooData[field] !== undefined &&
              yahooData[field] !== null &&
              yahooData[field] === 0 &&
              !["dividendYield", "dividendGrowth5yr", "epsGrowthRate"].includes(
                field
              ) // Fields that can legitimately be zero
          ); // Log detailed information

          console.log(`Data validation for ${code}:`);

          if (missingCriticalFields.length > 0) {
            console.error(
              `❌ Missing critical fields: ${missingCriticalFields.join(", ")}`
            );
            throw new Error(
              `Critical Yahoo data is missing: ${missingCriticalFields.join(
                ", "
              )}`
            );
          }

          if (missingNonCriticalFields.length > 0) {
            console.warn(
              `⚠️ Missing non-critical fields: ${missingNonCriticalFields.join(
                ", "
              )}`
            );
          }

          if (zeroFields.length > 0) {
            console.warn(
              `⚠️ Fields with zero values (potential calculation errors): ${zeroFields.join(
                ", "
              )}`
            );
          }

          console.log(
            `✅ All critical fields present for ${code}. Continuing analysis...`
          );
          console.log("Yahoo data:", yahooData); // 2) Build stock object

          const stock = {
            ticker: code,
            sector,
            currentPrice: yahooData.currentPrice,
            highPrice: yahooData.highPrice,
            lowPrice: yahooData.lowPrice,
            openPrice: yahooData.openPrice,
            prevClosePrice: yahooData.prevClosePrice,
            marketCap: yahooData.marketCap,
            peRatio: yahooData.peRatio,
            pbRatio: yahooData.pbRatio,
            dividendYield: yahooData.dividendYield,
            dividendGrowth5yr: yahooData.dividendGrowth5yr,
            fiftyTwoWeekHigh: yahooData.fiftyTwoWeekHigh,
            fiftyTwoWeekLow: yahooData.fiftyTwoWeekLow,
            epsTrailingTwelveMonths: yahooData.epsTrailingTwelveMonths,
            epsForward: yahooData.epsForward,
            epsGrowthRate: yahooData.epsGrowthRate,
            debtEquityRatio: yahooData.debtEquityRatio,
            movingAverage50d: yahooData.movingAverage50d,
            movingAverage200d: yahooData.movingAverage200d, // 📈 Technical indicators

            rsi14: yahooData.rsi14,
            macd: yahooData.macd,
            macdSignal: yahooData.macdSignal,
            bollingerMid: yahooData.bollingerMid,
            bollingerUpper: yahooData.bollingerUpper,
            bollingerLower: yahooData.bollingerLower,
            stochasticK: yahooData.stochasticK,
            stochasticD: yahooData.stochasticD,
            obv: yahooData.obv,
            atr14: yahooData.atr14,
          };

          const historicalData = await fetchHistoricalData(stock.ticker);
          stock.historicalData = historicalData || []; // 4) Analyze with ML for next 30 days, using the already-fetched historicalData

          console.log(`Analyzing stock: ${stock.ticker}`);
          // const prediction = await analyzeStock(stock.ticker, historicalData);
          // if (prediction == null) {
          //   console.error(
          //     `Failed to generate prediction for ${stock.ticker}. Aborting.`
          //   );
          //   throw new Error("Failed to generate prediction.");
          // }

          // console.log("prediction: ", prediction);
          // stock.prediction = prediction; // 5) Calculate Stop Loss & Target

          stock.technicalScore = getTechnicalScore(stock);
          stock.fundamentalScore = getAdvancedFundamentalScore(stock);
          stock.valuationScore = getValuationScore(stock); // --- 2. Run Advanced Analysis for Scores, Targets, and Vetoes --- // This function calculates the entry score, targets, and runs the "Emergency Brake" veto.
          stock.tier = getNumericTier(stock);
          
          const entryAnalysis = getComprehensiveEntryTiming(
            stock,
            historicalData
          );
          stock.entryTimingScore = entryAnalysis.score;
          stock.smartStopLoss = entryAnalysis.stopLoss;
          stock.smartPriceTarget = entryAnalysis.priceTarget; // --- 3. Generate the Final, Unified "Buy Now" Signal --- // This master function runs our Trend Reversal and Continuation checks, // then applies the "Intelligent Filter" vetoes (Overbought/Resistance).

          const finalSignal = getBuyTrigger(
            stock,
            historicalData,
            entryAnalysis
          );
          stock.isBuyNow = finalSignal.isBuyNow;
          stock.buyNowReason = finalSignal.reason; // --- 4. Calculate Final Tier and Limit Order --- // Note: If a hard veto was triggered in entryAnalysis, the scores will be low, // resulting in a low Tier, which is the correct outcome.

          // Check if current stock exists in myPortfolio
          const portfolioEntry = myPortfolio.find(
            (p) => p.ticker === stock.ticker
          );

          if (portfolioEntry) {
            // Stock exists in portfolio, run trade management analysis
            const managementSignal = getTradeManagementSignal_V2(
              stock,
              portfolioEntry.trade, // Pass the trade object from portfolio
              historicalData
            );

            stock.managementSignalStatus = managementSignal.status;
            stock.managementSignalReason = managementSignal.reason;
          } else {
            // Stock not in portfolio, set management signals to null
            stock.managementSignalStatus = null;
            stock.managementSignalReason = null; // Added 'null' value here
          }

          const stockObject = {
            _api_c2_ticker: stock.ticker,
            _api_c2_sector: stock.sector,
            _api_c2_currentPrice: stock.currentPrice,
            _api_c2_entryTimingScore: stock.entryTimingScore,
            _api_c2_prediction: stock.prediction,
            _api_c2_stopLoss: stock.stopLoss,
            _api_c2_targetPrice: stock.targetPrice,
            _api_c2_growthPotential: stock.growthPotential,
            _api_c2_score: stock.score,
            _api_c2_finalScore: stock.finalScore,
            _api_c2_tier: stock.tier,
            _api_c2_smartStopLoss: stock.smartStopLoss,
            _api_c2_smartPriceTarget: stock.smartPriceTarget,
            _api_c2_limitOrder: stock.limitOrder,
            _api_c2_isBuyNow: stock.isBuyNow,
            _api_c2_buyNowReason: stock.buyNowReason,
            _api_c2_managementSignalStatus: stock.managementSignalStatus,
            _api_c2_managementSignalReason: stock.managementSignalReason,
            _api_c2_otherData: JSON.stringify({
              highPrice: stock.highPrice,
              lowPrice: stock.lowPrice,
              openPrice: stock.openPrice,
              prevClosePrice: stock.prevClosePrice,
              marketCap: stock.marketCap,
              peRatio: stock.peRatio,
              pbRatio: stock.pbRatio,
              dividendYield: stock.dividendYield,
              dividendGrowth5yr: stock.dividendGrowth5yr,
              fiftyTwoWeekHigh: stock.fiftyTwoWeekHigh,
              fiftyTwoWeekLow: stock.fiftyTwoWeekLow,
              epsTrailingTwelveMonths: stock.epsTrailingTwelveMonths,
              epsForward: stock.epsForward,
              epsGrowthRate: stock.epsGrowthRate,
              debtEquityRatio: stock.debtEquityRatio,
              movingAverage50d: stock.movingAverage50d,
              movingAverage200d: stock.movingAverage200d,
              rsi14: stock.rsi14,
              macd: stock.macd,
              macdSignal: stock.macdSignal,
              bollingerMid: stock.bollingerMid,
              bollingerUpper: stock.bollingerUpper,
              bollingerLower: stock.bollingerLower,
              stochasticK: stock.stochasticK,
              stochasticD: stock.stochasticD,
              obv: stock.obv,
              atr14: stock.atr14,
              technicalScore: stock.technicalScore,
              fundamentalScore: stock.fundamentalScore,
              valuationScore: stock.valuationScore,
            }),
          };

          console.log(`📤 Sending ${stock.ticker} to Bubble:`, stockObject);
          bubble_fn_result(stockObject);
        } catch (error) {
          console.error(
            `❌ Error processing ticker ${tickerObj.code}:`,
            error.message
          );
        } finally {
            await new Promise((r) => setTimeout(r, 2000));
          }
      } // ✅ Finished processing all tickers (success or some errors)

      bubble_fn_finish();
    } catch (error) {
      console.error("❌ Error in fetchStockAnalysis:", error.message); // 🔴 If outer error (like JSON parse or logic bug), still call finish

      bubble_fn_finish();

      throw new Error("Analysis aborted due to errors.");
    }
  },
};