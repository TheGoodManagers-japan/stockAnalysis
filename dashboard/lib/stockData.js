// dashboard/lib/stockData.js
// Unified data layer — single entry point for fetching stock data with consistent indicators.
//
// DATA CONTRACT:
// Both yahoo.js and enrichForTechnicalScore.js import from engine/indicators.js,
// guaranteeing identical indicator math regardless of which code path computes them.
//
// USAGE:
//   const { stock, dataForLevels, dataForGates } = await getStockWithIndicators("7203.T", "Automobile");
//
// The returned `stock` object has:
//   - All Yahoo fundamentals (price, PE, PB, EPS, etc.)
//   - All technical indicators (RSI, MACD, Bollinger, ATR, Stochastic, OBV, MAs)
//   - historicalData[] with synthetic "today" candle appended
//
// dataForLevels = historicalData (includes synthetic today)
// dataForGates  = historicalData minus last bar (completed bars only)

import { fetchYahooFinanceData } from "./yahoo.js";
import { getCachedHistory } from "./cache.js";
import { enrichForTechnicalScore } from "../engine/scoring/enrichForTechnicalScore.js";

/**
 * Fetch stock data from Yahoo + cached history, enrich with indicators,
 * and return a consistent stock object ready for analysis.
 *
 * @param {string} ticker  - Yahoo Finance symbol (e.g. "7203.T")
 * @param {string} sector  - Sector label
 * @param {object} [opts]
 * @param {number} [opts.historyYears=10] - Years of history to fetch
 * @returns {Promise<{ stock: object, dataForLevels: array, dataForGates: array }>}
 */
export async function getStockWithIndicators(ticker, sector = "", opts = {}) {
  const historyYears = opts.historyYears ?? 10;

  // 1) Fundamentals + technicals snapshot from Yahoo
  const yahooData = await fetchYahooFinanceData(ticker, sector);

  // Validate critical fields
  const critical = ["currentPrice", "highPrice", "lowPrice"];
  const missing = critical.filter((k) => !yahooData[k]);
  if (missing.length) {
    throw new Error(`Critical fields missing for ${ticker}: ${missing.join(", ")}`);
  }

  // 2) Build stock object
  const stock = {
    ticker,
    sector,
    symbol: yahooData.symbol,
    currency: yahooData.currency,
    shortName: yahooData.shortName,
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
    movingAverage200d: yahooData.movingAverage200d,
    rsi14: yahooData.rsi14,
    macd: yahooData.macd,
    macdSignal: yahooData.macdSignal,
    bollingerMid: yahooData.bollingerMid,
    bollingerUpper: yahooData.bollingerUpper,
    todayVolume: yahooData.todayVolume,
    bollingerLower: yahooData.bollingerLower,
    stochasticK: yahooData.stochasticK,
    stochasticD: yahooData.stochasticD,
    obv: yahooData.obv,
    obvMA20: yahooData.obvMA20,
    atr14: yahooData.atr14,
    enterpriseValue: yahooData.enterpriseValue,
    totalDebt: yahooData.totalDebt,
    totalCash: yahooData.totalCash,
    freeCashflow: yahooData.freeCashflow,
    ebit: yahooData.ebit,
    ebitda: yahooData.ebitda,
    sharesOutstanding: yahooData.sharesOutstanding,
    tangibleBookValue: yahooData.tangibleBookValue,
    evToEbit: yahooData.evToEbit,
    evToEbitda: yahooData.evToEbitda,
    fcfYieldPct: yahooData.fcfYieldPct,
    buybackYieldPct: yahooData.buybackYieldPct,
    shareholderYieldPct: yahooData.shareholderYieldPct,
    ptbv: yahooData.ptbv,
    nextEarningsDateIso: yahooData.nextEarningsDateIso ?? null,
    nextEarningsDateFmt: yahooData.nextEarningsDateFmt ?? null,
  };

  // 3) Cached historical OHLCV
  const historicalData = await getCachedHistory(stock.ticker, historyYears);
  stock.historicalData = historicalData || [];

  // 4) Append synthetic "today" candle if not already present
  appendSyntheticToday(stock);

  // 5) Enrich with any missing technical indicators
  //    Both yahoo.js and enrichForTechnicalScore import from engine/indicators.js,
  //    so indicator values are computed with identical math.
  enrichForTechnicalScore(stock);

  // 6) Prepare data slices
  const dataForLevels = stock.historicalData;                    // includes synthetic today
  const dataForGates = stock.historicalData.slice(0, -1);        // completed bars only

  return { stock, dataForLevels, dataForGates };
}

/**
 * Append a synthetic "today" candle to stock.historicalData if the last bar
 * isn't from today. Uses live quote data (open, high, low, close, volume).
 */
function appendSyntheticToday(stock) {
  const today = new Date();
  const last = stock.historicalData.at(-1);
  const lastDate = last?.date ? new Date(last.date) : null;

  const sameDay =
    lastDate &&
    lastDate.getFullYear() === today.getFullYear() &&
    lastDate.getMonth() === today.getMonth() &&
    lastDate.getDate() === today.getDate();

  if (sameDay) return;

  const o =
    Number(stock.openPrice) ||
    Number(last?.close) ||
    Number(stock.currentPrice);
  const c = Number(stock.currentPrice) || o;
  const h = Math.max(o, c, Number(stock.highPrice) || -Infinity);
  const l = Math.min(o, c, Number(stock.lowPrice) || Infinity);
  const vol =
    Number.isFinite(stock.todayVolume) && stock.todayVolume > 0
      ? Number(stock.todayVolume)
      : Number.isFinite(last?.volume) && last.volume > 0
      ? Number(last.volume)
      : undefined;

  stock.historicalData.push({
    date: today,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: vol,
  });
}
