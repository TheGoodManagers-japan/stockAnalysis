function computeScore(stock, sector) {
  // Input validation
  if (!stock || typeof stock !== "object") {
    console.error("Invalid stock data provided");
    return 0;
  }

  if (!sector || typeof sector !== "string") {
    console.warn("Invalid sector provided, using default multipliers");
    sector = "";
  }

  // Configuration constants
  const CONFIG = {
    // Component weights
    WEIGHTS: {
      valuation: 0.25,
      marketStability: 0.2,
      dividendBenefit: 0.15,
      historicalPerformance: 0.15,
      momentum: 0.15,
      volatilityRisk: 0.1,
    },
    // Thresholds for scoring calculations
    THRESHOLDS: {
      maxPE: 25, // PE ratio above which score becomes 0
      maxPB: 3, // PB ratio above which score becomes 0
      volatilityBase: 0.1, // Base volatility for normalization
      maxDividendYield: 6, // Max dividend yield for scoring
      dividendGrowthCap: 10, // Cap for dividend growth rate
      highATR: 0.04, // High ATR threshold
      mediumATR: 0.02, // Medium ATR threshold
    },
  };

  // Sector-specific multipliers for different scoring components
  const SECTOR_MULTIPLIERS = {
    // Default values
    DEFAULT: { valuation: 1.0, stability: 1.0, dividend: 1.0, growth: 1.0 },

    // Financial sectors - often trade at lower valuations, dividends important
    Banking: { valuation: 1.2, stability: 0.9, dividend: 1.3, growth: 0.9 },
    "Other Financial Services": {
      valuation: 1.2,
      stability: 0.8,
      dividend: 1.1,
      growth: 1.1,
    },
    Securities: { valuation: 1.3, stability: 0.7, dividend: 1.0, growth: 1.2 },
    Insurance: { valuation: 1.3, stability: 0.9, dividend: 1.2, growth: 0.9 },

    // Technology and healthcare - growth focused, valuations often higher
    Pharmaceuticals: {
      valuation: 0.9,
      stability: 0.9,
      dividend: 0.9,
      growth: 1.2,
    },
    "Precision Instruments": {
      valuation: 0.9,
      stability: 0.8,
      dividend: 0.8,
      growth: 1.2,
    },
    Communications: {
      valuation: 0.9,
      stability: 1.0,
      dividend: 0.9,
      growth: 1.1,
    },
    "Electric Machinery": {
      valuation: 0.9,
      stability: 0.9,
      dividend: 0.9,
      growth: 1.1,
    },

    // Consumer staples - stability focused
    Foods: { valuation: 1.1, stability: 1.2, dividend: 1.1, growth: 0.9 },
    Retail: { valuation: 1.0, stability: 1.0, dividend: 1.0, growth: 1.0 },
    Fishery: { valuation: 1.0, stability: 1.1, dividend: 1.0, growth: 0.9 },

    // Services and consumer discretionary
    Services: { valuation: 1.0, stability: 0.9, dividend: 0.9, growth: 1.1 },
    "Automobiles & Auto parts": {
      valuation: 1.1,
      stability: 0.8,
      dividend: 1.0,
      growth: 1.0,
    },

    // Manufacturing sectors
    Steel: { valuation: 1.2, stability: 0.8, dividend: 1.1, growth: 0.9 },
    "Nonferrous Metals": {
      valuation: 1.2,
      stability: 0.8,
      dividend: 1.1,
      growth: 0.9,
    },
    Chemicals: { valuation: 1.1, stability: 0.9, dividend: 1.0, growth: 1.0 },
    Petroleum: { valuation: 1.2, stability: 0.8, dividend: 1.3, growth: 0.8 },
    Rubber: { valuation: 1.1, stability: 0.9, dividend: 1.0, growth: 0.9 },
    "Glass & Ceramics": {
      valuation: 1.1,
      stability: 0.9,
      dividend: 1.0,
      growth: 0.9,
    },
    Machinery: { valuation: 1.1, stability: 0.9, dividend: 1.0, growth: 1.0 },
    Shipbuilding: {
      valuation: 1.1,
      stability: 0.8,
      dividend: 1.0,
      growth: 0.9,
    },
    "Other Manufacturing": {
      valuation: 1.1,
      stability: 0.9,
      dividend: 1.0,
      growth: 1.0,
    },

    // Utilities - income focused
    "Electric Power": {
      valuation: 1.2,
      stability: 1.2,
      dividend: 1.3,
      growth: 0.7,
    },
    Gas: { valuation: 1.2, stability: 1.2, dividend: 1.3, growth: 0.7 },

    // Transport
    "Railway & Bus": {
      valuation: 1.1,
      stability: 1.1,
      dividend: 1.1,
      growth: 0.9,
    },
    "Land Transport": {
      valuation: 1.1,
      stability: 1.0,
      dividend: 1.0,
      growth: 0.9,
    },
    "Marine Transport": {
      valuation: 1.1,
      stability: 0.8,
      dividend: 1.0,
      growth: 0.9,
    },
    "Air Transport": {
      valuation: 1.0,
      stability: 0.7,
      dividend: 0.9,
      growth: 1.0,
    },
    Warehousing: { valuation: 1.1, stability: 1.0, dividend: 1.1, growth: 0.9 },

    // Real estate and construction
    "Real Estate": {
      valuation: 1.2,
      stability: 0.9,
      dividend: 1.2,
      growth: 0.9,
    },
    Construction: {
      valuation: 1.1,
      stability: 0.8,
      dividend: 1.0,
      growth: 0.9,
    },

    // Others
    "Trading Companies": {
      valuation: 1.1,
      stability: 0.9,
      dividend: 1.1,
      growth: 1.0,
    },
    Mining: { valuation: 1.2, stability: 0.7, dividend: 1.2, growth: 0.8 },
    "Textiles & Apparel": {
      valuation: 1.1,
      stability: 0.9,
      dividend: 1.0,
      growth: 0.9,
    },
    "Pulp & Paper": {
      valuation: 1.1,
      stability: 0.9,
      dividend: 1.1,
      growth: 0.8,
    },
  };

  // Get sector multipliers or use defaults if sector not found
  const sectorMultiplier =
    SECTOR_MULTIPLIERS[sector] || SECTOR_MULTIPLIERS.DEFAULT;

  // Helper functions for score calculations
  const clamp = (value, min = 0, max = 1) =>
    Math.min(Math.max(value, min), max);

  const getValueWithDefault = (value, defaultValue = 0.5) => {
    return value !== undefined && !isNaN(value) ? value : defaultValue;
  };

  /**
   * Calculate valuation score based on PE and PB ratios
   */
  function calculateValuationScore() {
    const peRatio = getValueWithDefault(stock.peRatio);
    const pbRatio = getValueWithDefault(stock.pbRatio);

    const peScore =
      peRatio > 0
        ? clamp((CONFIG.THRESHOLDS.maxPE - peRatio) / CONFIG.THRESHOLDS.maxPE)
        : 0.5;

    const pbScore =
      pbRatio > 0
        ? clamp((CONFIG.THRESHOLDS.maxPB - pbRatio) / CONFIG.THRESHOLDS.maxPB)
        : 0.5;

    return ((peScore + pbScore) / 2) * sectorMultiplier.valuation;
  }

  /**
   * Calculate stability score based on historical volatility
   */
  function calculateStabilityScore() {
    const volatility = calculateHistoricalVolatility(stock.historicalData);
    const normalizedVol = clamp(
      volatility / CONFIG.THRESHOLDS.volatilityBase,
      0,
      1
    );
    return (1 - normalizedVol) * sectorMultiplier.stability;
  }

  /**
   * Calculate dividend benefit score based on yield and growth
   */
  function calculateDividendScore() {
    const dividendYield = getValueWithDefault(stock.dividendYield, 0);
    const dividendGrowth = getValueWithDefault(stock.dividendGrowth5yr);

    const yieldScore = clamp(
      dividendYield / CONFIG.THRESHOLDS.maxDividendYield
    );
    const growthScore = clamp(
      dividendGrowth / CONFIG.THRESHOLDS.dividendGrowthCap
    );

    return (yieldScore * 0.7 + growthScore * 0.3) * sectorMultiplier.dividend;
  }

  /**
   * Calculate historical performance score based on 52-week range position
   */
  function calculateHistoricalPerformanceScore() {
    const high = getValueWithDefault(stock.fiftyTwoWeekHigh);
    const low = getValueWithDefault(stock.fiftyTwoWeekLow);
    const current = getValueWithDefault(stock.currentPrice);

    const range = high - low;
    const position = range > 0 ? (current - low) / range : 0.5;

    // Apply the growth multiplier to historical performance
    return position * sectorMultiplier.growth;
  }

  /**
   * Calculate momentum score based on technical indicators
   */
  function calculateMomentumScore() {
    let score = 0;
    let divisor = 0;

    // RSI component
    if (stock.rsi14 !== undefined) {
      score += clamp((stock.rsi14 - 30) / 40) * 0.5;
      divisor += 0.5;
    }

    // MACD component
    if (stock.macd !== undefined && stock.macdSignal !== undefined) {
      score += (stock.macd > stock.macdSignal ? 0.3 : 0) * 0.3;
      divisor += 0.3;
    }

    // Stochastic component
    if (stock.stochasticK !== undefined) {
      score += clamp(stock.stochasticK / 100) * 0.2;
      divisor += 0.2;
    }

    return divisor > 0 ? clamp(score / divisor) : 0.5;
  }

  /**
   * Calculate volatility risk score based on ATR and Bollinger Bands
   */
  function calculateVolatilityRiskScore() {
    let score = 1;

    // ATR component
    if (stock.atr14 !== undefined && stock.currentPrice > 0) {
      const atrRatio = stock.atr14 / stock.currentPrice;
      if (atrRatio > CONFIG.THRESHOLDS.highATR) {
        score -= 0.3;
      } else if (atrRatio > CONFIG.THRESHOLDS.mediumATR) {
        score -= 0.15;
      }
    }

    // Bollinger Band component
    if (
      stock.bollingerUpper !== undefined &&
      stock.bollingerLower !== undefined &&
      stock.currentPrice !== undefined
    ) {
      if (
        stock.currentPrice > stock.bollingerUpper ||
        stock.currentPrice < stock.bollingerLower
      ) {
        score -= 0.1;
      }
    }

    return clamp(score, 0.5);
  }

  /**
   * Calculate historical volatility from price data
   */
  function calculateHistoricalVolatility(historicalData) {
    if (
      !historicalData ||
      !Array.isArray(historicalData) ||
      historicalData.length < 2
    ) {
      return 0.15; // Default volatility if no data available
    }

    try {
      const prices = historicalData.map((d) => d.close || d.price || 0);
      const returns = [];

      for (let i = 1; i < prices.length; i++) {
        if (prices[i - 1] > 0) {
          returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
        }
      }

      if (returns.length === 0) return 0.15;

      const meanReturn =
        returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
      const squaredDifferences = returns.map((ret) =>
        Math.pow(ret - meanReturn, 2)
      );
      const variance =
        squaredDifferences.reduce((sum, diff) => sum + diff, 0) /
        returns.length;

      return Math.sqrt(variance) * Math.sqrt(252); // Annualized volatility
    } catch (e) {
      console.error("Error calculating volatility:", e);
      return 0.15;
    }
  }

  // Calculate individual component scores
  const valuationScore = calculateValuationScore();
  const stabilityScore = calculateStabilityScore();
  const dividendScore = calculateDividendScore();
  const historicalPerformanceScore = calculateHistoricalPerformanceScore();
  const momentumScore = calculateMomentumScore();
  const volatilityRiskScore = calculateVolatilityRiskScore();

  // Calculate final weighted score
  const rawScore =
    valuationScore * CONFIG.WEIGHTS.valuation +
    stabilityScore * CONFIG.WEIGHTS.marketStability +
    dividendScore * CONFIG.WEIGHTS.dividendBenefit +
    historicalPerformanceScore * CONFIG.WEIGHTS.historicalPerformance +
    momentumScore * CONFIG.WEIGHTS.momentum +
    volatilityRiskScore * CONFIG.WEIGHTS.volatilityRisk;

  // Return final clamped score
  return clamp(rawScore);
}
