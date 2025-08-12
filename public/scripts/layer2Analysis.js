/**
 * Enhanced Layer 2 ML Analysis for Swing Trading
 * Focuses on market regime, relative strength, and institutional activity
 *
 * Key improvements:
 * - Split analysis: 90-day context + 30-day signals
 * - Relative strength vs market/sector
 * - Proper accumulation/distribution detection
 * - Stage analysis integration
 * - Simplified feature set (quality over quantity)
 * - Adaptive scoring based on market conditions
 */

export function getLayer2MLAnalysis(stock, historicalData, marketData = null) {
  // Minimum data validation
  if (!historicalData || historicalData.length < 90) {
    return {
      mlScore: 0,
      features: {},
      longTermRegime: {
        type: "UNKNOWN",
        characteristics: ["INSUFFICIENT_DATA"],
      },
      shortTermRegime: {
        type: "UNKNOWN",
        characteristics: ["INSUFFICIENT_DATA"],
      },
      confidence: 0,
    };
  }

  // Sort and prepare data windows
  const sorted = [...historicalData].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );
  const contextData = sorted.slice(-90); // 90-day context
  const signalData = sorted.slice(-30); // 30-day signals

  // ===== PRIMARY ANALYSIS COMPONENTS =====

  // 1. Market Regime (Context)
  const longTermRegime = analyzeMarketRegime(sorted, 90);
  const shortTermRegime = analyzeMarketRegime(sorted, 30);

  // 2. Relative Strength
  const relativeStrength = analyzeRelativeStrength(
    stock,
    signalData,
    marketData
  );

  // 3. Institutional Activity
  const institutional = detectInstitutionalFootprint(contextData, signalData);

  // 4. Stage Analysis
  const stageAnalysis = performStageAnalysis(stock, contextData);

  // 5. Volume Dynamics
  const volumeDynamics = analyzeVolumeDynamics(contextData, signalData);

  // 6. Price Structure
  const priceStructure = analyzePriceStructure(signalData, stock);

  // 7. Momentum Quality
  const momentumQuality = analyzeMomentumQuality(stock, signalData);

  // 8. Risk Metrics
  const riskMetrics = calculateRiskMetrics(signalData, stock);

  // ===== FEATURE EXTRACTION =====
  const features = extractSwingFeatures({
    longTermRegime,
    shortTermRegime,
    relativeStrength,
    institutional,
    stageAnalysis,
    volumeDynamics,
    priceStructure,
    momentumQuality,
    riskMetrics,
  });

  // ===== SCORING =====
  const scoreResult = calculateSwingScore(features, {
    longTermRegime,
    shortTermRegime,
    stageAnalysis,
    relativeStrength,
  });

  return {
    mlScore: scoreResult.mlScore,
    features,
    longTermRegime,
    shortTermRegime,
    confidence: scoreResult.confidence,
    insights: generateSwingInsights(features, stageAnalysis, relativeStrength),
  };
}

/* ════════════════════ MARKET REGIME ANALYSIS ════════════════════ */

function analyzeMarketRegime(data, lookback) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  if (!data || data.length < lookback) {
    return { type: "UNKNOWN", strength: 0, characteristics: [] };
  }

  const period = data.slice(-lookback);
  const closes = period.map((d) => n(d.close));

  // Calculate returns
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    const ret = (closes[i] - closes[i - 1]) / Math.max(closes[i - 1], 0.01);
    returns.push(ret);
  }

  // Trend analysis using linear regression
  const x = Array.from({ length: closes.length }, (_, i) => i);
  const { slope, r2 } = linearRegression(x, closes);

  // Volatility analysis
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
    returns.length;
  const volatility = Math.sqrt(variance);
  const annualizedVol = volatility * Math.sqrt(252);

  // Determine regime
  let regime = { type: "UNKNOWN", strength: 0, characteristics: [] };

  if (r2 > 0.5 && Math.abs(slope) > 0) {
    regime.type = "TRENDING";
    regime.strength = r2;
    if (slope > 0) {
      regime.characteristics.push("UPTREND");
      // Check trend quality
      const upDays = returns.filter((r) => r > 0).length;
      const winRate = upDays / returns.length;
      if (winRate > 0.55) regime.characteristics.push("STRONG_TREND");
      if (winRate > 0.6) regime.characteristics.push("VERY_STRONG_TREND");
    } else {
      regime.characteristics.push("DOWNTREND");
      const downDays = returns.filter((r) => r < 0).length;
      const lossRate = downDays / returns.length;
      if (lossRate > 0.55) regime.characteristics.push("STRONG_TREND");
    }
  } else if (annualizedVol < 0.2) {
    regime.type = "RANGE_BOUND";
    regime.strength = 1 - annualizedVol;
    regime.characteristics.push("LOW_VOLATILITY");

    // Check if consolidating
    const range = Math.max(...closes) - Math.min(...closes);
    const avgPrice = closes.reduce((a, b) => a + b, 0) / closes.length;
    if (range / avgPrice < 0.1) {
      regime.characteristics.push("TIGHT_CONSOLIDATION");
    }
  } else if (annualizedVol > 0.4) {
    regime.type = "VOLATILE";
    regime.strength = annualizedVol;
    regime.characteristics.push("HIGH_VOLATILITY");
    if (annualizedVol > 0.6) {
      regime.characteristics.push("EXTREME_VOLATILITY");
    }
  } else {
    regime.type = "TRANSITIONAL";
    regime.strength = 0.5;
    regime.characteristics.push("MIXED_SIGNALS");
  }

  // Add volatility characteristic
  regime.volatility = annualizedVol;

  return regime;
}

/* ════════════════════ RELATIVE STRENGTH ANALYSIS ════════════════════ */

function analyzeRelativeStrength(stock, data, marketData) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  const analysis = {
    vs52Week: 0,
    vsMA200: 0,
    momentum: 0,
    isLeader: false,
    isLaggard: false,
    rsRating: 50, // 1-99 scale like IBD
    priceRank: 0,
  };

  // Position in 52-week range
  const high52 = n(stock.fiftyTwoWeekHigh);
  const low52 = n(stock.fiftyTwoWeekLow);
  const current = n(stock.currentPrice);

  if (high52 > low52) {
    analysis.vs52Week = (current - low52) / (high52 - low52);
    analysis.priceRank = analysis.vs52Week * 100;
  }

  // Performance vs MA200
  const ma200 = n(stock.movingAverage200d);
  if (ma200 > 0) {
    analysis.vsMA200 = (current - ma200) / ma200;
  }

  // Momentum (3-month performance)
  if (data.length >= 63) {
    // ~3 months
    const price3MonthsAgo = n(data[data.length - 63].close);
    if (price3MonthsAgo > 0) {
      analysis.momentum = (current - price3MonthsAgo) / price3MonthsAgo;
    }
  }

  // RS Rating calculation (simplified IBD-style)
  let rsScore = 50;

  // 52-week performance (40% weight)
  rsScore += analysis.vs52Week * 40;

  // 3-month momentum (30% weight)
  rsScore += Math.max(-0.5, Math.min(0.5, analysis.momentum)) * 30;

  // MA200 performance (30% weight)
  rsScore += Math.max(-0.3, Math.min(0.3, analysis.vsMA200)) * 30;

  analysis.rsRating = Math.round(Math.max(1, Math.min(99, rsScore)));

  // Leader/Laggard classification
  analysis.isLeader = analysis.rsRating >= 80;
  analysis.isLaggard = analysis.rsRating <= 30;

  // If market data provided, calculate relative performance
  if (marketData && Array.isArray(marketData)) {
    const marketReturn = calculatePeriodReturn(marketData, 20);
    const stockReturn = calculatePeriodReturn(data, 20);
    analysis.relativeReturn = stockReturn - marketReturn;
    analysis.outperforming = analysis.relativeReturn > 0.02;
    analysis.underperforming = analysis.relativeReturn < -0.02;
  }

  return analysis;
}

/* ════════════════════ INSTITUTIONAL FOOTPRINT ════════════════════ */

function detectInstitutionalFootprint(contextData, signalData) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  const footprint = {
    accumulation: false,
    distribution: false,
    accumDays: 0,
    distDays: 0,
    netScore: 0,
    unusualVolume: false,
    smartMoney: "NEUTRAL",
  };

  if (!contextData || contextData.length < 50) return footprint;

  // Calculate average volume
  const volumes = contextData.slice(-50).map((d) => n(d.volume));
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;

  // Detect accumulation/distribution days
  for (let i = contextData.length - 25; i < contextData.length; i++) {
    if (i === 0) continue;

    const curr = contextData[i];
    const prev = contextData[i - 1];
    const volRatio = n(curr.volume) / avgVolume;

    // Institutional volume threshold
    if (volRatio > 1.2) {
      const priceChange = (n(curr.close) - n(prev.close)) / n(prev.close);

      // Accumulation: price up on high volume
      if (priceChange > 0.002) {
        // 0.2% minimum move
        footprint.accumDays++;
        // Extra weight for strong accumulation
        if (volRatio > 1.5 && priceChange > 0.01) {
          footprint.accumDays++;
        }
      }
      // Distribution: price down on high volume
      else if (priceChange < -0.002) {
        footprint.distDays++;
        // Extra weight for strong distribution
        if (volRatio > 1.5 && priceChange < -0.01) {
          footprint.distDays++;
        }
      }
    }
  }

  // Calculate net score
  footprint.netScore = footprint.accumDays - footprint.distDays;

  // Determine accumulation/distribution
  footprint.accumulation = footprint.netScore >= 3;
  footprint.distribution = footprint.netScore <= -3;

  // Check for unusual volume in recent days
  const recentVolumes = signalData.slice(-5).map((d) => n(d.volume));
  const maxRecent = Math.max(...recentVolumes);
  footprint.unusualVolume = maxRecent > avgVolume * 2;

  // Smart money indicator
  if (footprint.accumulation && !footprint.unusualVolume) {
    footprint.smartMoney = "ACCUMULATING"; // Quiet accumulation
  } else if (footprint.distribution && footprint.unusualVolume) {
    footprint.smartMoney = "DISTRIBUTING"; // Loud distribution
  } else if (footprint.accumulation && footprint.unusualVolume) {
    footprint.smartMoney = "AGGRESSIVE_BUYING";
  }

  return footprint;
}

/* ════════════════════ STAGE ANALYSIS ════════════════════ */

function performStageAnalysis(stock, data) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  const stage = {
    current: "UNKNOWN",
    characteristics: [],
    readiness: 0, // 0-1 score for stage 2 readiness
    risk: 0, // 0-1 score for breakdown risk
  };

  const ma50 = n(stock.movingAverage50d);
  const ma200 = n(stock.movingAverage200d);
  const current = n(stock.currentPrice);

  if (!ma50 || !ma200 || !current) return stage;

  // Calculate slopes
  const ma50Slope = calculateMASlope(data, 50, 10);
  const ma200Slope = calculateMASlope(data, 200, 20);

  // Stage 1: Accumulation (Base Building)
  if (
    Math.abs(ma50 - ma200) / ma200 < 0.05 &&
    ma200Slope > -0.001 &&
    ma200Slope < 0.001
  ) {
    stage.current = "ACCUMULATION";
    stage.characteristics.push("BASE_BUILDING");

    // Check for tightening range
    const recent = data.slice(-20);
    const highs = recent.map((d) => n(d.high));
    const lows = recent.map((d) => n(d.low));
    const range = (Math.max(...highs) - Math.min(...lows)) / Math.min(...lows);

    if (range < 0.15) {
      stage.characteristics.push("TIGHT_RANGE");
      stage.readiness += 0.3;
    }

    // Check if near breakout
    if (current > ma50 && current > ma200) {
      stage.characteristics.push("BREAKOUT_CANDIDATE");
      stage.readiness += 0.4;
    }
  }

  // Stage 2: Advancing (Markup)
  else if (ma50 > ma200 && current > ma50 && ma50Slope > 0) {
    stage.current = "ADVANCING";
    stage.characteristics.push("UPTREND");

    if (ma50Slope > 0.002) {
      stage.characteristics.push("STRONG_UPTREND");
    }

    // Check pullback opportunity
    const distFromMA50 = (current - ma50) / ma50;
    if (distFromMA50 < 0.03 && distFromMA50 > -0.01) {
      stage.characteristics.push("PULLBACK_TO_SUPPORT");
      stage.readiness = 0.8;
    } else if (distFromMA50 > 0.15) {
      stage.characteristics.push("EXTENDED");
      stage.risk = 0.6;
    }
  }

  // Stage 3: Distribution (Top)
  else if (Math.abs(ma50 - ma200) / ma200 < 0.05 && current > ma200 * 1.2) {
    stage.current = "DISTRIBUTION";
    stage.characteristics.push("TOPPING");
    stage.risk = 0.7;

    if (ma50Slope < 0) {
      stage.characteristics.push("BREAKDOWN_RISK");
      stage.risk = 0.9;
    }
  }

  // Stage 4: Declining
  else if (ma50 < ma200 && current < ma50) {
    stage.current = "DECLINING";
    stage.characteristics.push("DOWNTREND");
    stage.risk = 0.8;

    if (current < ma200 * 0.8) {
      stage.characteristics.push("OVERSOLD");
      // Might be bottom fishing opportunity
      if (ma200Slope > -0.002) {
        stage.readiness = 0.3;
      }
    }
  }

  // Transitional
  else {
    stage.current = "TRANSITIONAL";
    stage.characteristics.push("MIXED_SIGNALS");
  }

  return stage;
}

/* ════════════════════ VOLUME DYNAMICS ════════════════════ */

function analyzeVolumeDynamics(contextData, signalData) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  const dynamics = {
    trend: "NEUTRAL",
    dryingUp: false,
    expanding: false,
    climax: false,
    accumVolume: 0,
    distVolume: 0,
    relativeStrength: 0,
  };

  if (!contextData || contextData.length < 50) return dynamics;

  // Calculate volume moving averages
  const volumes = contextData.map((d) => n(d.volume));
  const ma50Vol = volumes.slice(-50).reduce((a, b) => a + b, 0) / 50;
  const ma20Vol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const ma10Vol = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;

  // Volume trend
  if (ma10Vol > ma20Vol * 1.1 && ma20Vol > ma50Vol * 1.05) {
    dynamics.trend = "EXPANDING";
    dynamics.expanding = true;
  } else if (ma10Vol < ma20Vol * 0.9 && ma20Vol < ma50Vol * 0.95) {
    dynamics.trend = "CONTRACTING";
    dynamics.dryingUp = true;
  }

  // Check for climax volume
  const recentMax = Math.max(...volumes.slice(-5));
  if (recentMax > ma50Vol * 2.5) {
    dynamics.climax = true;
  }

  // Accumulation vs Distribution volume
  for (let i = signalData.length - 20; i < signalData.length; i++) {
    if (i <= 0) continue;

    const curr = signalData[i];
    const prev = signalData[i - 1];
    const priceChange = n(curr.close) - n(prev.close);
    const vol = n(curr.volume);

    if (priceChange > 0) {
      dynamics.accumVolume += vol;
    } else if (priceChange < 0) {
      dynamics.distVolume += vol;
    }
  }

  // Relative volume strength
  const totalVol = dynamics.accumVolume + dynamics.distVolume;
  if (totalVol > 0) {
    dynamics.relativeStrength =
      (dynamics.accumVolume - dynamics.distVolume) / totalVol;
  }

  return dynamics;
}

/* ════════════════════ PRICE STRUCTURE ════════════════════ */

function analyzePriceStructure(data, stock) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  const structure = {
    trend: "NEUTRAL",
    higherHighsLows: false,
    lowerHighsLows: false,
    tightRange: false,
    breakout: false,
    breakdown: false,
    pullback: false,
    qualityScore: 0,
  };

  if (!data || data.length < 20) return structure;

  // Find swing points
  const swings = findSwingPoints(data);

  // Check for higher highs and higher lows
  if (swings.highs.length >= 2 && swings.lows.length >= 2) {
    const lastTwoHighs = swings.highs.slice(-2);
    const lastTwoLows = swings.lows.slice(-2);

    structure.higherHighsLows =
      lastTwoHighs[1].price > lastTwoHighs[0].price &&
      lastTwoLows[1].price > lastTwoLows[0].price;

    structure.lowerHighsLows =
      lastTwoHighs[1].price < lastTwoHighs[0].price &&
      lastTwoLows[1].price < lastTwoLows[0].price;
  }

  // Determine trend
  if (structure.higherHighsLows) {
    structure.trend = "UPTREND";
  } else if (structure.lowerHighsLows) {
    structure.trend = "DOWNTREND";
  }

  // Check for tight range
  const recent10 = data.slice(-10);
  const highs = recent10.map((d) => n(d.high));
  const lows = recent10.map((d) => n(d.low));
  const range = (Math.max(...highs) - Math.min(...lows)) / Math.min(...lows);
  structure.tightRange = range < 0.05;

  // Check for breakout/breakdown
  const resistance = Math.max(...data.slice(-20, -1).map((d) => n(d.high)));
  const support = Math.min(...data.slice(-20, -1).map((d) => n(d.low)));
  const latestClose = n(data[data.length - 1].close);
  const latestVolume = n(data[data.length - 1].volume);
  const avgVolume =
    data.slice(-20).reduce((sum, d) => sum + n(d.volume), 0) / 20;

  if (latestClose > resistance && latestVolume > avgVolume * 1.3) {
    structure.breakout = true;
  } else if (latestClose < support && latestVolume > avgVolume * 1.3) {
    structure.breakdown = true;
  }

  // Check for pullback
  const ma20 = n(stock.movingAverage20d);
  const ma50 = n(stock.movingAverage50d);
  if (ma20 && ma50) {
    const nearMA20 = Math.abs(latestClose - ma20) / ma20 < 0.02;
    const nearMA50 = Math.abs(latestClose - ma50) / ma50 < 0.02;
    structure.pullback =
      (nearMA20 || nearMA50) && structure.trend === "UPTREND";
  }

  // Calculate quality score
  if (structure.higherHighsLows) structure.qualityScore += 0.3;
  if (structure.tightRange && !structure.breakdown)
    structure.qualityScore += 0.2;
  if (structure.breakout) structure.qualityScore += 0.3;
  if (structure.pullback) structure.qualityScore += 0.2;

  return structure;
}

/* ════════════════════ MOMENTUM QUALITY ════════════════════ */

function analyzeMomentumQuality(stock, data) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  const momentum = {
    rsiStatus: "NEUTRAL",
    macdStatus: "NEUTRAL",
    stochStatus: "NEUTRAL",
    composite: 0,
    divergence: false,
    acceleration: false,
  };

  // RSI Analysis
  const rsi = n(stock.rsi14);
  if (rsi > 70) momentum.rsiStatus = "OVERBOUGHT";
  else if (rsi > 50) momentum.rsiStatus = "BULLISH";
  else if (rsi < 30) momentum.rsiStatus = "OVERSOLD";
  else if (rsi < 50) momentum.rsiStatus = "BEARISH";

  // MACD Analysis
  const macd = n(stock.macd);
  const signal = n(stock.macdSignal);
  if (macd > signal && macd > 0) momentum.macdStatus = "STRONG_BULLISH";
  else if (macd > signal) momentum.macdStatus = "BULLISH";
  else if (macd < signal && macd < 0) momentum.macdStatus = "STRONG_BEARISH";
  else if (macd < signal) momentum.macdStatus = "BEARISH";

  // Stochastic Analysis
  const stochK = n(stock.stochasticK);
  const stochD = n(stock.stochasticD);
  if (stochK > 80) momentum.stochStatus = "OVERBOUGHT";
  else if (stochK > stochD && stochK > 20) momentum.stochStatus = "BULLISH";
  else if (stochK < 20) momentum.stochStatus = "OVERSOLD";
  else if (stochK < stochD) momentum.stochStatus = "BEARISH";

  // Composite score
  let score = 0;
  if (momentum.rsiStatus.includes("BULLISH")) score += 0.33;
  if (momentum.macdStatus.includes("BULLISH")) score += 0.33;
  if (momentum.stochStatus === "BULLISH") score += 0.34;
  if (momentum.rsiStatus === "OVERSOLD" && momentum.stochStatus === "OVERSOLD")
    score += 0.2;
  momentum.composite = score;

  // Check for divergence (simplified)
  if (data.length >= 10) {
    const recentHighs = data.slice(-10).map((d) => n(d.high));
    const priceRising = recentHighs[recentHighs.length - 1] > recentHighs[0];
    const momentumFalling = rsi < 50 && macd < 0;
    momentum.divergence = priceRising && momentumFalling;
  }

  // Check for acceleration
  momentum.acceleration =
    momentum.macdStatus === "STRONG_BULLISH" &&
    momentum.rsiStatus === "BULLISH" &&
    !momentum.divergence;

  return momentum;
}

/* ════════════════════ RISK METRICS ════════════════════ */

function calculateRiskMetrics(data, stock) {
  const n = (v) => (Number.isFinite(v) ? v : 0);

  const metrics = {
    volatility: 0,
    beta: 1, // Would need market data for real beta
    atrPercent: 0,
    maxDrawdown: 0,
    riskScore: 0.5,
  };

  if (!data || data.length < 20) return metrics;

  // Calculate volatility
  const returns = [];
  for (let i = 1; i < data.length; i++) {
    const ret =
      (n(data[i].close) - n(data[i - 1].close)) / n(data[i - 1].close);
    returns.push(ret);
  }

  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
    returns.length;
  metrics.volatility = Math.sqrt(variance) * Math.sqrt(252); // Annualized

  // ATR as percentage
  const atr = n(stock.atr14);
  const price = n(stock.currentPrice);
  if (atr && price) {
    metrics.atrPercent = (atr / price) * 100;
  }

  // Calculate max drawdown
  let peak = data[0].high;
  let maxDD = 0;
  for (const bar of data) {
    peak = Math.max(peak, n(bar.high));
    const drawdown = (peak - n(bar.low)) / peak;
    maxDD = Math.max(maxDD, drawdown);
  }
  metrics.maxDrawdown = maxDD;

  // Risk score (0 = low risk, 1 = high risk)
  let risk = 0;
  if (metrics.volatility > 0.4) risk += 0.25;
  if (metrics.atrPercent > 5) risk += 0.25;
  if (metrics.maxDrawdown > 0.15) risk += 0.25;
  if (n(stock.rsi14) > 70) risk += 0.25;
  metrics.riskScore = Math.min(1, risk);

  return metrics;
}

/* ════════════════════ FEATURE EXTRACTION ════════════════════ */

function extractSwingFeatures(analyses) {
  const features = {};

  // Flatten all analysis objects into features
  Object.entries(analyses).forEach(([category, analysis]) => {
    Object.entries(analysis).forEach(([key, value]) => {
      if (typeof value === "boolean") {
        features[`${category}_${key}`] = value ? 1 : 0;
      } else if (typeof value === "number") {
        features[`${category}_${key}`] = value;
      } else if (typeof value === "string") {
        // One-hot encode string values
        features[`${category}_${key}_${value}`] = 1;
      }
    });
  });

  return features;
}

/* ════════════════════ SCORING ENGINE ════════════════════ */

function calculateSwingScore(features, context) {
  let score = 0;
  let confidence = 0.5;

  const { longTermRegime, shortTermRegime, stageAnalysis, relativeStrength } =
    context;

  // REDUCED positive scoring
  if (stageAnalysis.current === "ADVANCING") {
    score += 1; // Was 2
    confidence += 0.05; // Was 0.1
  } else if (
    stageAnalysis.current === "ACCUMULATION" &&
    stageAnalysis.readiness > 0.7
  ) {
    // Raised from 0.6
    score += 0.8; // Was 1.5
    confidence += 0.03; // Was 0.05
  }

  // INCREASED negative scoring
  if (stageAnalysis.current === "DECLINING") {
    score -= 3; // Was -2
    confidence -= 0.15; // Was -0.1
  }
  if (stageAnalysis.current === "DISTRIBUTION") {
    score -= 2; // New penalty
  }

  // Relative strength (reduced positive, increased negative)
  if (relativeStrength.isLeader && relativeStrength.rsRating >= 85) {
    // Raised threshold
    score += 1.5; // Was 3
    confidence += 0.1; // Was 0.15
  } else if (relativeStrength.rsRating > 70) {
    score += 0.5; // Was 1.5
  } else if (relativeStrength.rsRating < 50) {
    // New mid-range penalty
    score -= 1;
  } else if (relativeStrength.isLaggard) {
    score -= 3; // Was -2
    confidence -= 0.15; // Was -0.1
  }

  // Institutional (more balanced)
  if (
    features.institutional_accumulation &&
    features.institutional_netScore > 5
  ) {
    // Added threshold
    score += 1.2; // Was 2.5
    confidence += 0.05; // Was 0.1
  } else if (features.institutional_distribution) {
    score -= 2.5; // Same
    confidence -= 0.1;
  } else if (
    !features.institutional_accumulation &&
    !features.institutional_distribution
  ) {
    score -= 0.5; // Penalty for no clear institutional interest
  }

  // Volume dynamics (more selective)
  if (
    features.volumeDynamics_dryingUp &&
    features.priceStructure_tightRange &&
    features.priceStructure_higherHighsLows
  ) {
    // Added condition
    score += 0.8; // Was 1.5
  }

  // Risk penalties (increased)
  const risk = features.riskMetrics_riskScore || 0.5;
  if (risk > 0.7) {
    score *= 0.5; // Was 0.7
    confidence *= 0.7; // Was 0.8
  } else if (risk > 0.5) {
    score *= 0.8; // New mid-risk penalty
  }

  // Volatility penalty
  if (features.riskMetrics_volatility > 0.5) {
    score -= 1; // New penalty for high volatility
  }

  // Regime penalties
  if (
    longTermRegime.type === "VOLATILE" ||
    shortTermRegime.type === "VOLATILE"
  ) {
    score -= 1.5; // New penalty
  }

  // Ensure confidence stays within bounds
  confidence = Math.max(0, Math.min(1, confidence));

  return { mlScore: score, confidence: confidence };
}

/* ════════════════════ INSIGHT GENERATION ════════════════════ */

function generateSwingInsights(features, stageAnalysis, relativeStrength) {
  const insights = [];

  // Stage insights
  if (
    stageAnalysis.current === "ACCUMULATION" &&
    stageAnalysis.readiness > 0.6
  ) {
    insights.push("Stock showing accumulation with high breakout readiness");
  } else if (
    stageAnalysis.current === "ADVANCING" &&
    stageAnalysis.characteristics.includes("PULLBACK_TO_SUPPORT")
  ) {
    insights.push(
      "Pullback to support in established uptrend - prime swing entry"
    );
  } else if (stageAnalysis.current === "DISTRIBUTION") {
    insights.push("Distribution phase detected - avoid new longs");
  }

  // Relative strength insights
  if (relativeStrength.isLeader) {
    insights.push(`Market leader with RS Rating ${relativeStrength.rsRating}`);
  } else if (relativeStrength.makingNewHigh) {
    insights.push("Making new 52-week highs");
  }

  // Institutional insights
  if (features.institutional_smartMoney_ACCUMULATING) {
    insights.push("Smart money quietly accumulating");
  } else if (
    features.institutional_unusualVolume &&
    features.institutional_accumulation
  ) {
    insights.push("Aggressive institutional buying detected");
  }

  // Pattern insights
  if (features.priceStructure_breakout && features.volumeDynamics_expanding) {
    insights.push("Volume-confirmed breakout in progress");
  }
  if (features.priceStructure_tightRange && features.volumeDynamics_dryingUp) {
    insights.push("Volatility contraction - potential breakout setup");
  }

  return insights;
}

/* ════════════════════ UTILITY FUNCTIONS ════════════════════ */

function linearRegression(x, y) {
  const n = x.length;
  if (n === 0) return { slope: 0, r2: 0 };

  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);

  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return { slope: 0, r2: 0 };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const yMean = sumY / n;
  const ssTotal = y.reduce((sum, yi) => sum + Math.pow(yi - yMean, 2), 0);
  const ssResidual = y.reduce(
    (sum, yi, i) => sum + Math.pow(yi - (slope * x[i] + intercept), 2),
    0
  );

  const r2 = ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;

  return { slope, intercept, r2 };
}

function calculatePeriodReturn(data, period) {
  if (!data || data.length < period) return 0;
  const recent = data.slice(-period);
  const startPrice = recent[0].close;
  const endPrice = recent[recent.length - 1].close;
  return startPrice > 0 ? (endPrice - startPrice) / startPrice : 0;
}

function calculateMASlope(data, maPeriod, lookback) {
  if (!data || data.length < maPeriod + lookback) return 0;

  const mas = [];
  for (let i = data.length - lookback; i < data.length; i++) {
    const start = Math.max(0, i - maPeriod + 1);
    const slice = data.slice(start, i + 1);
    const ma = slice.reduce((sum, d) => sum + d.close, 0) / slice.length;
    mas.push(ma);
  }

  if (mas.length < 2) return 0;
  return (mas[mas.length - 1] - mas[0]) / mas[0];
}

function findSwingPoints(data) {
  const swings = { highs: [], lows: [] };

  for (let i = 2; i < data.length - 2; i++) {
    // Swing high
    if (
      data[i].high > data[i - 1].high &&
      data[i].high > data[i - 2].high &&
      data[i].high > data[i + 1].high &&
      data[i].high > data[i + 2].high
    ) {
      swings.highs.push({ index: i, price: data[i].high });
    }

    // Swing low
    if (
      data[i].low < data[i - 1].low &&
      data[i].low < data[i - 2].low &&
      data[i].low < data[i + 1].low &&
      data[i].low < data[i + 2].low
    ) {
      swings.lows.push({ index: i, price: data[i].low });
    }
  }

  return swings;
}

function calculateATR(data, period = 14) {
  if (!data || data.length < period + 1) return 0;

  const trs = [];
  for (let i = 1; i < data.length; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i - 1].close;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trs.push(tr);
  }

  const atrValues = trs.slice(-period);
  return atrValues.reduce((sum, tr) => sum + tr, 0) / period;
}
