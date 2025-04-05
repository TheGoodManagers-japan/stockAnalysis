/***********************************************
 * 0) SECTOR RULES (Customize these per sector)
 ***********************************************/
const sectorRules = {
  Pharmaceuticals: {
    peBounds: { low: 12, mid: 25 },
    pbBounds: { low: 1, mid: 3 },
    maxDiv: 0.05,
    maxVol: 0.025,
  },
  "Electric Machinery": {
    peBounds: { low: 10, mid: 20 },
    pbBounds: { low: 1, mid: 4 },
    maxDiv: 0.04,
    maxVol: 0.03,
  },
  "Automobiles & Auto parts": {
    peBounds: { low: 8, mid: 15 },
    pbBounds: { low: 0.8, mid: 2.5 },
    maxDiv: 0.06,
    maxVol: 0.04,
  },
  "Precision Instruments": {
    peBounds: { low: 12, mid: 25 },
    pbBounds: { low: 1, mid: 3 },
    maxDiv: 0.03,
    maxVol: 0.025,
  },
  Communications: {
    peBounds: { low: 15, mid: 30 },
    pbBounds: { low: 1, mid: 5 },
    maxDiv: 0.05,
    maxVol: 0.03,
  },
  Banking: {
    peBounds: { low: 5, mid: 15 },
    pbBounds: { low: 0.6, mid: 2 },
    maxDiv: 0.07,
    maxVol: 0.025,
  },
  "Other Financial Services": {
    peBounds: { low: 7, mid: 20 },
    pbBounds: { low: 0.8, mid: 3 },
    maxDiv: 0.06,
    maxVol: 0.03,
  },
  Securities: {
    peBounds: { low: 7, mid: 20 },
    pbBounds: { low: 1, mid: 3 },
    maxDiv: 0.06,
    maxVol: 0.035,
  },
  Insurance: {
    peBounds: { low: 6, mid: 15 },
    pbBounds: { low: 0.8, mid: 2.5 },
    maxDiv: 0.08,
    maxVol: 0.025,
  },
  Fishery: {
    peBounds: { low: 10, mid: 20 },
    pbBounds: { low: 1, mid: 3 },
    maxDiv: 0.05,
    maxVol: 0.03,
  },
  Foods: {
    peBounds: { low: 10, mid: 25 },
    pbBounds: { low: 1, mid: 4 },
    maxDiv: 0.06,
    maxVol: 0.025,
  },
  Retail: {
    peBounds: { low: 10, mid: 25 },
    pbBounds: { low: 1, mid: 4 },
    maxDiv: 0.05,
    maxVol: 0.03,
  },
  Services: {
    peBounds: { low: 15, mid: 35 },
    pbBounds: { low: 1, mid: 5 },
    maxDiv: 0.03,
    maxVol: 0.03,
  },
  Mining: {
    peBounds: { low: 5, mid: 15 },
    pbBounds: { low: 0.8, mid: 2 },
    maxDiv: 0.04,
    maxVol: 0.05,
  },
  "Textiles & Apparel": {
    peBounds: { low: 8, mid: 20 },
    pbBounds: { low: 1, mid: 3 },
    maxDiv: 0.05,
    maxVol: 0.03,
  },
  "Pulp & Paper": {
    peBounds: { low: 8, mid: 18 },
    pbBounds: { low: 1, mid: 3 },
    maxDiv: 0.05,
    maxVol: 0.03,
  },
  Chemicals: {
    peBounds: { low: 10, mid: 25 },
    pbBounds: { low: 1, mid: 3 },
    maxDiv: 0.04,
    maxVol: 0.035,
  },
  Petroleum: {
    peBounds: { low: 5, mid: 15 },
    pbBounds: { low: 0.8, mid: 2 },
    maxDiv: 0.06,
    maxVol: 0.04,
  },
  Rubber: {
    peBounds: { low: 8, mid: 18 },
    pbBounds: { low: 0.8, mid: 2.5 },
    maxDiv: 0.05,
    maxVol: 0.03,
  },
  "Glass & Ceramics": {
    peBounds: { low: 8, mid: 18 },
    pbBounds: { low: 0.8, mid: 2.5 },
    maxDiv: 0.05,
    maxVol: 0.03,
  },
  Steel: {
    peBounds: { low: 5, mid: 12 },
    pbBounds: { low: 0.5, mid: 2 },
    maxDiv: 0.04,
    maxVol: 0.05,
  },
  "Nonferrous Metals": {
    peBounds: { low: 5, mid: 15 },
    pbBounds: { low: 0.5, mid: 2 },
    maxDiv: 0.03,
    maxVol: 0.06,
  },
  "Trading Companies": {
    peBounds: { low: 8, mid: 20 },
    pbBounds: { low: 0.8, mid: 3 },
    maxDiv: 0.05,
    maxVol: 0.03,
  },
  Construction: {
    peBounds: { low: 8, mid: 18 },
    pbBounds: { low: 1, mid: 3 },
    maxDiv: 0.05,
    maxVol: 0.03,
  },
  Machinery: {
    peBounds: { low: 10, mid: 20 },
    pbBounds: { low: 1, mid: 3 },
    maxDiv: 0.04,
    maxVol: 0.03,
  },
  Shipbuilding: {
    peBounds: { low: 5, mid: 12 },
    pbBounds: { low: 0.5, mid: 2 },
    maxDiv: 0.03,
    maxVol: 0.05,
  },
  "Other Manufacturing": {
    peBounds: { low: 8, mid: 18 },
    pbBounds: { low: 1, mid: 3 },
    maxDiv: 0.04,
    maxVol: 0.03,
  },
  "Real Estate": {
    peBounds: { low: 5, mid: 15 },
    pbBounds: { low: 0.5, mid: 2 },
    maxDiv: 0.06,
    maxVol: 0.03,
  },
  "Railway & Bus": {
    peBounds: { low: 8, mid: 18 },
    pbBounds: { low: 1, mid: 3 },
    maxDiv: 0.05,
    maxVol: 0.025,
  },
  "Land Transport": {
    peBounds: { low: 8, mid: 18 },
    pbBounds: { low: 1, mid: 3 },
    maxDiv: 0.05,
    maxVol: 0.025,
  },
  "Marine Transport": {
    peBounds: { low: 5, mid: 15 },
    pbBounds: { low: 0.5, mid: 2 },
    maxDiv: 0.07,
    maxVol: 0.05,
  },
  "Air Transport": {
    peBounds: { low: 6, mid: 20 },
    pbBounds: { low: 0.8, mid: 3 },
    maxDiv: 0.03,
    maxVol: 0.05,
  },
  Warehousing: {
    peBounds: { low: 8, mid: 18 },
    pbBounds: { low: 1, mid: 3 },
    maxDiv: 0.04,
    maxVol: 0.03,
  },
  "Electric Power": {
    peBounds: { low: 5, mid: 15 },
    pbBounds: { low: 0.5, mid: 2 },
    maxDiv: 0.08,
    maxVol: 0.02,
  },
  Gas: {
    peBounds: { low: 5, mid: 15 },
    pbBounds: { low: 0.5, mid: 2 },
    maxDiv: 0.08,
    maxVol: 0.02,
  },
  // fallback
  default: {
    peBounds: { low: 10, mid: 20 },
    pbBounds: { low: 1, mid: 3 },
    maxDiv: 0.05,
    maxVol: 0.03,
  },
};

/***********************************************
 * 1) HELPER FUNCTIONS FOR VOLATILITY & ATR
 ***********************************************/
function calculateHistoricalVolatility(historicalData) {
  if (!historicalData || historicalData.length < 2) return 0;
  const logReturns = [];
  for (let i = 1; i < historicalData.length; i++) {
    const prevClose = historicalData[i - 1].close;
    const currClose = historicalData[i].close;
    if (prevClose > 0 && currClose > 0) {
      logReturns.push(Math.log(currClose / prevClose));
    }
  }
  const mean =
    logReturns.reduce((acc, val) => acc + val, 0) / (logReturns.length || 1);
  const variance =
    logReturns.reduce((acc, val) => acc + (val - mean) ** 2, 0) /
    (logReturns.length || 1);

  return Math.sqrt(variance);
}

function calculateATR(historicalData, period = 14) {
  if (!historicalData || historicalData.length < period + 1) return 0;
  const trueRanges = [];
  for (let i = 1; i < historicalData.length; i++) {
    const { high, low, close } = historicalData[i];
    const prevClose = historicalData[i - 1].close;
    const range1 = high - low;
    const range2 = Math.abs(high - prevClose);
    const range3 = Math.abs(low - prevClose);
    trueRanges.push(Math.max(range1, range2, range3));
  }
  let atrSum = 0;
  for (let i = trueRanges.length - period; i < trueRanges.length; i++) {
    atrSum += trueRanges[i];
  }
  return atrSum / period;
}

function determineRisk(stock) {
  const volatility = calculateHistoricalVolatility(stock.historicalData);
  let riskLevel = "medium";
  if (volatility > 0.02 || stock.marketCap < 1e11) {
    riskLevel = "high";
  } else if (volatility < 0.01 && stock.marketCap > 5e11) {
    riskLevel = "low";
  }
  return riskLevel;
}

function calculateStopLossAndTarget(stock, prediction) {
  // same as your revised code for stop-loss + target
  // ...
  // return { stopLoss, targetPrice, riskTolerance }
}

/***********************************************
 * 2) SECTOR-AWARE COMPUTE SCORE
 ***********************************************/
function computeScore(stock, sector) {
  // 1) Grab sector-specific rules or fallback
  const rules = sectorRules[sector] || sectorRules.default;

  // Weighted factors
  const weights = {
    valuation: 0.35,
    marketStability: 0.25,
    dividendBenefit: 0.2,
    historicalPerformance: 0.2,
  };

  // -----------------------------
  // (A) VALUATION (P/E, P/B)
  // -----------------------------
  let valuationScore = 1.0;

  // P/E
  if (stock.peRatio < rules.peBounds.low) {
    valuationScore *= 1.2; // strong reward
  } else if (stock.peRatio <= rules.peBounds.mid) {
    valuationScore *= 1.0; // neutral
  } else {
    valuationScore *= 0.8; // penalize
  }

  // P/B
  if (stock.pbRatio < rules.pbBounds.low) {
    valuationScore *= 1.2;
  } else if (stock.pbRatio <= rules.pbBounds.mid) {
    valuationScore *= 1.0;
  } else {
    valuationScore *= 0.8;
  }

  // clamp 0.5..1.2
  valuationScore = Math.min(Math.max(valuationScore, 0.5), 1.2);

  // -----------------------------
  // (B) MARKET STABILITY (Vol)
  // -----------------------------
  const volatility = calculateHistoricalVolatility(stock.historicalData);
  // If vol >= rules.maxVol => ~0.5 score, if vol=0 => 1.0
  const ratio = Math.min(volatility / rules.maxVol, 1.0);
  const stabilityRaw = 1.0 - ratio;
  const stabilityScore = 0.5 + 0.5 * stabilityRaw; // => [0.5..1.0]

  // -----------------------------
  // (C) DIVIDEND
  // -----------------------------
  const rawDividend = (stock.dividendYield || 0) / 100;
  const cappedDividend = Math.min(rawDividend, rules.maxDiv);
  // e.g. if sector has maxDiv=0.05 => no benefit above 5% yield
  const dividendBenefit = cappedDividend; // => up to rules.maxDiv

  // -----------------------------
  // (D) HISTORICAL PERFORMANCE
  // -----------------------------
  const range = stock.fiftyTwoWeekHigh - stock.fiftyTwoWeekLow;
  let historicalPerformance = 0;
  if (range > 0) {
    historicalPerformance =
      (stock.currentPrice - stock.fiftyTwoWeekLow) / range;
  }
  historicalPerformance = Math.min(Math.max(historicalPerformance, 0), 1);

  // Weighted sum
  const rawScore =
    valuationScore * weights.valuation +
    stabilityScore * weights.marketStability +
    dividendBenefit * weights.dividendBenefit +
    historicalPerformance * weights.historicalPerformance;

  // clamp final to [0..1]
  const finalScore = Math.min(Math.max(rawScore, 0), 1);
  return finalScore;
}

/***********************************************
 * 3) MAIN WORKFLOW
 ***********************************************/
window.scan = {
  async fetchStockAnalysis() {
    try {
      // Full array of tickers (code + sector)
      const tickers = [
{code:"4151.T",sector:"Pharmaceuticals"},
{code:"4502.T",sector:"Pharmaceuticals"},
{code:"4503.T",sector:"Pharmaceuticals"},
{code:"4506.T",sector:"Pharmaceuticals"},
{code:"4507.T",sector:"Pharmaceuticals"},
{code:"4519.T",sector:"Pharmaceuticals"},
{code:"4523.T",sector:"Pharmaceuticals"},
{code:"4568.T",sector:"Pharmaceuticals"},
{code:"4578.T",sector:"Pharmaceuticals"},
{code:"6479.T",sector:"Electric Machinery"},
{code:"6501.T",sector:"Electric Machinery"},
{code:"6503.T",sector:"Electric Machinery"},
{code:"6504.T",sector:"Electric Machinery"},
{code:"6506.T",sector:"Electric Machinery"},
{code:"6526.T",sector:"Electric Machinery"},
{code:"6594.T",sector:"Electric Machinery"},
{code:"6645.T",sector:"Electric Machinery"},
{code:"6674.T",sector:"Electric Machinery"},
{code:"6701.T",sector:"Electric Machinery"},
{code:"6702.T",sector:"Electric Machinery"},
{code:"6723.T",sector:"Electric Machinery"},
{code:"6724.T",sector:"Electric Machinery"},
{code:"6752.T",sector:"Electric Machinery"},
{code:"6753.T",sector:"Electric Machinery"},
{code:"6758.T",sector:"Electric Machinery"},
{code:"6762.T",sector:"Electric Machinery"},
{code:"6770.T",sector:"Electric Machinery"},
{code:"6841.T",sector:"Electric Machinery"},
{code:"6857.T",sector:"Electric Machinery"},
{code:"6861.T",sector:"Electric Machinery"},
{code:"6902.T",sector:"Electric Machinery"},
{code:"6920.T",sector:"Electric Machinery"},
{code:"6952.T",sector:"Electric Machinery"},
{code:"6954.T",sector:"Electric Machinery"},
{code:"6971.T",sector:"Electric Machinery"},
{code:"6976.T",sector:"Electric Machinery"},
{code:"6981.T",sector:"Electric Machinery"},
{code:"7735.T",sector:"Electric Machinery"},
{code:"7751.T",sector:"Electric Machinery"},
{code:"7752.T",sector:"Electric Machinery"},
{code:"8035.T",sector:"Electric Machinery"},
{code:"7201.T",sector:"Automobiles & Auto parts"},
{code:"7202.T",sector:"Automobiles & Auto parts"},
{code:"7203.T",sector:"Automobiles & Auto parts"},
{code:"7205.T",sector:"Automobiles & Auto parts"},
{code:"7211.T",sector:"Automobiles & Auto parts"},
{code:"7261.T",sector:"Automobiles & Auto parts"},
{code:"7267.T",sector:"Automobiles & Auto parts"},
{code:"7269.T",sector:"Automobiles & Auto parts"},
{code:"7270.T",sector:"Automobiles & Auto parts"},
{code:"7272.T",sector:"Automobiles & Auto parts"},
{code:"4543.T",sector:"Precision Instruments"},
{code:"4902.T",sector:"Precision Instruments"},
{code:"6146.T",sector:"Precision Instruments"},
{code:"7731.T",sector:"Precision Instruments"},
{code:"7733.T",sector:"Precision Instruments"},
{code:"7741.T",sector:"Precision Instruments"},
{code:"7762.T",sector:"Precision Instruments"},
{code:"9432.T",sector:"Communications"},
{code:"9433.T",sector:"Communications"},
{code:"9434.T",sector:"Communications"},
{code:"9613.T",sector:"Communications"},
{code:"9984.T",sector:"Communications"},
{code:"5831.T",sector:"Banking"},
{code:"7186.T",sector:"Banking"},
{code:"8304.T",sector:"Banking"},
{code:"8306.T",sector:"Banking"},
{code:"8308.T",sector:"Banking"},
{code:"8309.T",sector:"Banking"},
{code:"8316.T",sector:"Banking"},
{code:"8331.T",sector:"Banking"},
{code:"8354.T",sector:"Banking"},
{code:"8411.T",sector:"Banking"},
{code:"8253.T",sector:"Other Financial Services"},
{code:"8591.T",sector:"Other Financial Services"},
{code:"8697.T",sector:"Other Financial Services"},
{code:"8601.T",sector:"Securities"},
{code:"8604.T",sector:"Securities"},
{code:"8630.T",sector:"Insurance"},
{code:"8725.T",sector:"Insurance"},
{code:"8750.T",sector:"Insurance"},
{code:"8766.T",sector:"Insurance"},
{code:"8795.T",sector:"Insurance"},
{code:"1332.T",sector:"Fishery"},
{code:"2002.T",sector:"Foods"},
{code:"2269.T",sector:"Foods"},
{code:"2282.T",sector:"Foods"},
{code:"2501.T",sector:"Foods"},
{code:"2502.T",sector:"Foods"},
{code:"2503.T",sector:"Foods"},
{code:"2801.T",sector:"Foods"},
{code:"2802.T",sector:"Foods"},
{code:"2871.T",sector:"Foods"},
{code:"2914.T",sector:"Foods"},
{code:"3086.T",sector:"Retail"},
{code:"3092.T",sector:"Retail"},
{code:"3099.T",sector:"Retail"},
{code:"3382.T",sector:"Retail"},
{code:"7453.T",sector:"Retail"},
{code:"8233.T",sector:"Retail"},
{code:"8252.T",sector:"Retail"},
{code:"8267.T",sector:"Retail"},
{code:"9843.T",sector:"Retail"},
{code:"9983.T",sector:"Retail"},
{code:"2413.T",sector:"Services"},
{code:"2432.T",sector:"Services"},
{code:"3659.T",sector:"Services"},
{code:"4307.T",sector:"Services"},
{code:"4324.T",sector:"Services"},
{code:"4385.T",sector:"Services"},
{code:"4661.T",sector:"Services"},
{code:"4689.T",sector:"Services"},
{code:"4704.T",sector:"Services"},
{code:"4751.T",sector:"Services"},
{code:"4755.T",sector:"Services"},
{code:"6098.T",sector:"Services"},
{code:"6178.T",sector:"Services"},
{code:"7974.T",sector:"Services"},
{code:"9602.T",sector:"Services"},
{code:"9735.T",sector:"Services"},
{code:"9766.T",sector:"Services"},
{code:"1605.T",sector:"Mining"},
{code:"3401.T",sector:"Textiles & Apparel"},
{code:"3402.T",sector:"Textiles & Apparel"},
{code:"3861.T",sector:"Pulp & Paper"},
{code:"3405.T",sector:"Chemicals"},
{code:"3407.T",sector:"Chemicals"},
{code:"4004.T",sector:"Chemicals"},
{code:"4005.T",sector:"Chemicals"},
{code:"4021.T",sector:"Chemicals"},
{code:"4042.T",sector:"Chemicals"},
{code:"4043.T",sector:"Chemicals"},
{code:"4061.T",sector:"Chemicals"},
{code:"4063.T",sector:"Chemicals"},
{code:"4183.T",sector:"Chemicals"},
{code:"4188.T",sector:"Chemicals"},
{code:"4208.T",sector:"Chemicals"},
{code:"4452.T",sector:"Chemicals"},
{code:"4901.T",sector:"Chemicals"},
{code:"4911.T",sector:"Chemicals"},
{code:"6988.T",sector:"Chemicals"},
{code:"5019.T",sector:"Petroleum"},
{code:"5020.T",sector:"Petroleum"},
{code:"5101.T",sector:"Rubber"},
{code:"5108.T",sector:"Rubber"},
{code:"5201.T",sector:"Glass & Ceramics"},
{code:"5214.T",sector:"Glass & Ceramics"},
{code:"5233.T",sector:"Glass & Ceramics"},
{code:"5301.T",sector:"Glass & Ceramics"},
{code:"5332.T",sector:"Glass & Ceramics"},
{code:"5333.T",sector:"Glass & Ceramics"},
{code:"5401.T",sector:"Steel"},
{code:"5406.T",sector:"Steel"},
{code:"5411.T",sector:"Steel"},
{code:"3436.T",sector:"Nonferrous Metals"},
{code:"5706.T",sector:"Nonferrous Metals"},
{code:"5711.T",sector:"Nonferrous Metals"},
{code:"5713.T",sector:"Nonferrous Metals"},
{code:"5714.T",sector:"Nonferrous Metals"},
{code:"5801.T",sector:"Nonferrous Metals"},
{code:"5802.T",sector:"Nonferrous Metals"},
{code:"5803.T",sector:"Nonferrous Metals"},
{code:"2768.T",sector:"Trading Companies"},
{code:"8001.T",sector:"Trading Companies"},
{code:"8002.T",sector:"Trading Companies"},
{code:"8015.T",sector:"Trading Companies"},
{code:"8031.T",sector:"Trading Companies"},
{code:"8053.T",sector:"Trading Companies"},
{code:"8058.T",sector:"Trading Companies"},
{code:"1721.T",sector:"Construction"},
{code:"1801.T",sector:"Construction"},
{code:"1802.T",sector:"Construction"},
{code:"1803.T",sector:"Construction"},
{code:"1808.T",sector:"Construction"},
{code:"1812.T",sector:"Construction"},
{code:"1925.T",sector:"Construction"},
{code:"1928.T",sector:"Construction"},
{code:"1963.T",sector:"Construction"},
{code:"5631.T",sector:"Machinery"},
{code:"6103.T",sector:"Machinery"},
{code:"6113.T",sector:"Machinery"},
{code:"6273.T",sector:"Machinery"},
{code:"6301.T",sector:"Machinery"},
{code:"6302.T",sector:"Machinery"},
{code:"6305.T",sector:"Machinery"},
{code:"6326.T",sector:"Machinery"},
{code:"6361.T",sector:"Machinery"},
{code:"6367.T",sector:"Machinery"},
{code:"6471.T",sector:"Machinery"},
{code:"6472.T",sector:"Machinery"},
{code:"6473.T",sector:"Machinery"},
{code:"7004.T",sector:"Machinery"},
{code:"7011.T",sector:"Machinery"},
{code:"7013.T",sector:"Machinery"},
{code:"7012.T",sector:"Shipbuilding"},
{code:"7832.T",sector:"Other Manufacturing"},
{code:"7911.T",sector:"Other Manufacturing"},
{code:"7912.T",sector:"Other Manufacturing"},
{code:"7951.T",sector:"Other Manufacturing"},
{code:"3289.T",sector:"Real Estate"},
{code:"8801.T",sector:"Real Estate"},
{code:"8802.T",sector:"Real Estate"},
{code:"8804.T",sector:"Real Estate"},
{code:"8830.T",sector:"Real Estate"},
{code:"9001.T",sector:"Railway & Bus"},
{code:"9005.T",sector:"Railway & Bus"},
{code:"9007.T",sector:"Railway & Bus"},
{code:"9008.T",sector:"Railway & Bus"},
{code:"9009.T",sector:"Railway & Bus"},
{code:"9020.T",sector:"Railway & Bus"},
{code:"9021.T",sector:"Railway & Bus"},
{code:"9022.T",sector:"Railway & Bus"},
{code:"9064.T",sector:"Land Transport"},
{code:"9147.T",sector:"Land Transport"},
{code:"9101.T",sector:"Marine Transport"},
{code:"9104.T",sector:"Marine Transport"},
{code:"9107.T",sector:"Marine Transport"},
{code:"9201.T",sector:"Air Transport"},
{code:"9202.T",sector:"Air Transport"},
{code:"9301.T",sector:"Warehousing"},
{code:"9501.T",sector:"Electric Power"},
{code:"9502.T",sector:"Electric Power"},
{code:"9503.T",sector:"Electric Power"},
{code:"9531.T",sector:"Gas"},
{code:"9532.T",sector:"Gas"}
];

      for (const tickerObj of tickers) {
        console.log(`\n--- Fetching data for ${tickerObj.code} ---`);

        try {
          // 1) Fetch Yahoo data
          const result = await fetchSingleStockData(tickerObj);
          if (!result.success) {
            console.error("Error fetching stock analysis:", result.error);
            throw new Error("Failed to fetch Yahoo data.");
          }

          // 2) Validate data
          const { code, sector, yahooData } = result.data;
          if (
            !yahooData ||
            !yahooData.currentPrice ||
            !yahooData.highPrice ||
            !yahooData.lowPrice
          ) {
            console.error(
              `Incomplete Yahoo data for ${code}. Aborting calculation.`
            );
            throw new Error("Critical Yahoo data is missing.");
          }

          // 3) Build local 'stock' object
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
            fiftyTwoWeekHigh: yahooData.fiftyTwoWeekHigh,
            fiftyTwoWeekLow: yahooData.fiftyTwoWeekLow,
            eps: yahooData.eps,
          };

          // 4) Fetch historical data for ATR/vol
          const historicalData = await fetchHistoricalData(stock.ticker);
          stock.historicalData = historicalData || [];

          // 5) Analyze with ML for next 30 days
          console.log(`Analyzing stock: ${stock.ticker}`);
          const predictions = await analyzeStock(stock.ticker);
          if (!predictions || predictions.length <= 29) {
            console.error(
              `Insufficient predictions for ${stock.ticker}. Aborting.`
            );
            throw new Error("Failed to generate sufficient predictions.");
          }

          // 6) Take the 30th day
          const prediction = predictions[29];
          stock.predictions = predictions;

          // 7) Stop Loss & Target
          const { stopLoss, targetPrice } = calculateStopLossAndTarget(
            stock,
            prediction
          );
          if (stopLoss === null || targetPrice === null) {
            console.error(
              `Failed to calculate stop loss or target price for ${stock.ticker}.`
            );
            throw new Error("Stop loss or target price calculation failed.");
          }
          stock.stopLoss = stopLoss;
          stock.targetPrice = targetPrice;

          // 8) Growth potential
          const growthPotential =
            ((stock.targetPrice - stock.currentPrice) / stock.currentPrice) *
            100;

          // 9) Sector-aware computeScore
          stock.score = computeScore(stock, stock.sector);

          // 10) Final Weighted Score
          const weights = { metrics: 0.7, growth: 0.3 };
          const finalScore =
            weights.metrics * stock.score +
            weights.growth * (growthPotential / 100);

          stock.prediction = prediction;
          stock.growthPotential = parseFloat(growthPotential.toFixed(2));
          stock.finalScore = parseFloat(finalScore.toFixed(2));

          // 11) Send to Bubble (or wherever)
          const stockObject = {
            _api_c2_ticker: stock.ticker,
            _api_c2_sector: stock.sector,
            _api_c2_currentPrice: stock.currentPrice,
            _api_c2_highPrice: stock.highPrice,
            _api_c2_lowPrice: stock.lowPrice,
            _api_c2_openPrice: stock.openPrice,
            _api_c2_prevClosePrice: stock.prevClosePrice,
            _api_c2_marketCap: stock.marketCap,
            _api_c2_peRatio: stock.peRatio,
            _api_c2_pbRatio: stock.pbRatio,
            _api_c2_dividendYield: stock.dividendYield,
            _api_c2_fiftyTwoWeekHigh: stock.fiftyTwoWeekHigh,
            _api_c2_fiftyTwoWeekLow: stock.fiftyTwoWeekLow,
            _api_c2_eps: stock.eps,
            _api_c2_prediction: stock.prediction,
            _api_c2_stopLoss: stock.stopLoss,
            _api_c2_targetPrice: stock.targetPrice,
            _api_c2_score: stock.score,
            _api_c2_growthPotential: stock.growthPotential,
            _api_c2_finalScore: stock.finalScore,
          };

          console.log(`📤 Sending ${stock.ticker} to Bubble:`, stockObject);
          bubble_fn_result(stockObject);
        } catch (error) {
          console.error(
            `❌ Error processing ticker ${tickerObj.code}:`,
            error.message
          );
        }
      }
    } catch (error) {
      console.error("❌ Error in fetchStockAnalysis:", error.message);
      throw new Error("Analysis aborted due to errors.");
    }
  },
};

/***********************************************
 * 7) SCAN CURRENT PRICE
 ***********************************************/
window.scanCurrentPrice = {
  async fetchCurrentPrices(tickers) {
    // ... same as before, unchanged ...
  },
};

/***********************************************
 * 8) TRAIN & PREDICT
 ***********************************************/

// The TF model code remains the same, you only changed your scoring logic
// to be sector-specific. We'll show it for completeness:

const customHeaders = {
  /* ... */
};
const limiter = new Bottleneck({ minTime: 200, maxConcurrent: 5 });

function prepareDataWithVolume(data, sequenceLength = 30) {
  // same as your code
}

async function trainModelWithVolume(data) {
  // same as your code
}

async function predictNext30DaysWithVolume(modelObj, latestData) {
  // same as your code
}

export async function analyzeStock(ticker) {
  try {
    const historicalData = await fetchHistoricalData(ticker);
    if (historicalData.length < 30) {
      throw new Error(`Not enough data to train the model for ${ticker}.`);
    }

    const modelObj = await trainModelWithVolume(historicalData);
    const latestData = historicalData.slice(-30);
    const predictions = await predictNext30DaysWithVolume(modelObj, latestData);

    console.log(`Predicted prices for ${ticker}:`, predictions);
    return predictions;
  } catch (error) {
    console.error(`Error analyzing stock for ${ticker}:`, error.message);
    return [];
  }
}
