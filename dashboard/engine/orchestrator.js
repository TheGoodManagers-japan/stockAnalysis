// dashboard/engine/orchestrator.js
// Refactored from public/scripts/core/main.js fetchStockAnalysis() (lines ~1142-1818)
// Main scan orchestrator for the Next.js dashboard.
// ESM — no browser globals (IS_BROWSER, window, document)

/* ======================== Imports: helpers ======================== */

import {
  log,
  warn,
  errorLog,
  inc,
  normalizeReason,
  toFinite,
  normalizeTicker,
  resolveTickers,
  toTick,
  extractEntryKindFromReason,
} from "./helpers.js";

import { allTickers } from "../data/tickers.js";

/* ======================== Imports: data layer ======================== */

import { fetchYahooFinanceData } from "../lib/yahoo.js";
import { getCachedHistory } from "../lib/cache.js";
import { query } from "../lib/db.js";

/* ======================== Imports: engine modules ======================== */

import {
  buildRegimeMap,
  regimeForDate,
  sma,
  calcATR,
} from "./regime/regimeLabels.js";

import { enrichForTechnicalScore, computeTechnicalScore } from "./scoring/enrichForTechnicalScore.js";

import {
  scanAnalytics,
  createScanCollectors,
  mergeTelemetry,
} from "./scoring/scanAnalytics.js";

import { getTradeManagementSignal_V3 } from "./trade/tradeManagement.js";

/* ======================== Imports: analysis modules ======================== */
// These will be copied into the dashboard separately; import paths assume
// they live at dashboard/engine/analysis/ (or wherever they are placed).
// For now we reference them from their canonical public/scripts/core/ location
// relative to this file. Adjust paths once the analysis modules are migrated.

import { getComprehensiveMarketSentiment } from "./analysis/marketSentimentOrchestrator.js";

import { summarizeBlocks, analyzeDipEntry } from "./analysis/swingTradeEntryTiming.js";

import {
  getAdvancedFundamentalScore,
  getValuationScore,
  getNumericTier,
} from "./analysis/techFundValAnalysis.js";

import { analyzeValuePlay } from "./analysis/valuePlay.js";

import { computeDisagreement } from "./scoring/disagreement.js";
import { classifyFreshness, applyDecay } from "./scoring/dataFreshness.js";
import { computeTrajectory } from "./scoring/trajectoryModifier.js";
import { computeMasterScore } from "./scoring/masterScore.js";
import { computePercentiles } from "./scoring/percentileRanking.js";
import { computeCatalystScore } from "./scoring/catalystScore.js";

import { DEFAULT_REGIME_TICKER } from "../lib/constants.js";

/* ======================== Main scan ======================== */

/**
 * @param {Object} opts
 * @param {string[]} [opts.tickers=[]]   e.g. ["7203","6758"] (no .T needed)
 * @param {Array}    [opts.myPortfolio=[]] e.g. [{ ticker:"7203.T", trade:{ entryPrice, stopLoss, priceTarget } }]
 * @param {string}   [opts.regimeTicker]  benchmark ticker for regime detection
 * @returns {Promise<{count:number, errors:string[], summary:Object, results:Object[]}>}
 */
export async function fetchStockAnalysis({
  tickers = [],
  myPortfolio = [],
  regimeTicker = DEFAULT_REGIME_TICKER,
  onProgress = null,
} = {}) {
  // --- Regime reference ---
  let regimeMap = null;
  try {
    const ref = await getCachedHistory(regimeTicker);
    if (Array.isArray(ref) && ref.length) {
      regimeMap = buildRegimeMap(ref);
      log(`Regime ready from ${regimeTicker} (${ref.length} bars)`);
    } else {
      warn(`Regime disabled: no candles for ${regimeTicker}`);
    }
  } catch (e) {
    warn(
      `Regime disabled: failed to load ${regimeTicker} — ${String(
        e?.message || e
      )}`
    );
  }

  log("Starting scan");
  const errors = [];
  const results = [];

  // Session-level collectors
  const collectors = createScanCollectors();
  const { histo, distro, summary } = collectors;

  // --- Merge requested tickers + portfolio tickers ---
  const baseTickers =
    Array.isArray(tickers) && tickers.length > 0
      ? tickers
      : allTickers.map((t) => t.code);

  const mergedRawTickers = [
    ...baseTickers,
    ...myPortfolio.map((p) => p?.ticker).filter(Boolean),
  ];

  const filteredTickers = resolveTickers(mergedRawTickers);
  log(
    "Resolved merged tickers:",
    filteredTickers.map((t) => t.code)
  );
  let count = 0;

  // --- Market context series (same ticker as regime by default) ---
  let marketLevels = null;
  let marketGates = null;

  try {
    const marketHist = await getCachedHistory(regimeTicker);

    // Try to get today's snapshot so we can build a synthetic "today" candle
    let marketSnap = null;
    try {
      marketSnap = await fetchYahooFinanceData(regimeTicker, "Market");
    } catch (e) {
      warn(
        `Market snapshot failed for ${regimeTicker} (ok to ignore): ${
          e?.message || e
        }`
      );
    }

    const marketSeries = [...marketHist];

    // Append synthetic today candle if snapshot exists and history doesn't already contain today
    if (marketSnap) {
      const today = new Date();
      const last = marketSeries.at(-1);

      const sameDay =
        last?.date &&
        new Date(last.date).getFullYear() === today.getFullYear() &&
        new Date(last.date).getMonth() === today.getMonth() &&
        new Date(last.date).getDate() === today.getDate();

      if (!sameDay) {
        const o =
          Number(marketSnap.openPrice) ||
          Number(last?.close) ||
          Number(marketSnap.currentPrice) ||
          0;
        const c = Number(marketSnap.currentPrice) || o;
        const h = Math.max(o, c, Number(marketSnap.highPrice) || -Infinity);
        const l = Math.min(o, c, Number(marketSnap.lowPrice) || Infinity);
        const vol = Number.isFinite(marketSnap.todayVolume)
          ? Number(marketSnap.todayVolume)
          : undefined;

        marketSeries.push({
          date: today,
          open: o,
          high: h,
          low: l,
          close: c,
          volume: vol,
        });
      }
    }

    marketLevels = marketSeries;
    marketGates =
      marketSeries.length > 1 ? marketSeries.slice(0, -1) : marketSeries;

    log(`Market context ready from ${regimeTicker}`, {
      barsLevels: marketLevels.length,
      barsGates: marketGates.length,
      lastDate: marketLevels.at(-1)?.date,
    });
  } catch (e) {
    warn(
      `Market context disabled: failed to load ${regimeTicker} — ${
        e?.message || e
      }`
    );
  }

  // --- Pre-load batch data for freshness + trajectory ---
  let freshnessMap = new Map();
  let prevSnapshotMap = new Map();
  try {
    const [freshResult, prevResult] = await Promise.all([
      query(`SELECT ticker_code, MAX(snapshot_date) AS latest_date FROM stock_snapshots GROUP BY ticker_code`),
      query(`SELECT DISTINCT ON (ticker_code) ticker_code, pe_ratio, eps_trailing, eps_forward, dividend_yield
             FROM stock_snapshots
             WHERE snapshot_date < CURRENT_DATE - INTERVAL '30 days'
             ORDER BY ticker_code, snapshot_date DESC`),
    ]);
    for (const row of freshResult.rows) {
      const ageDays = Math.floor((Date.now() - new Date(row.latest_date).getTime()) / 86400000);
      freshnessMap.set(row.ticker_code, { freshness: classifyFreshness(ageDays), ageDays });
    }
    for (const row of prevResult.rows) {
      prevSnapshotMap.set(row.ticker_code, row);
    }
    log(`Batch loaded freshness for ${freshnessMap.size} tickers, trajectory for ${prevSnapshotMap.size}`);
  } catch (e) {
    warn(`Batch pre-load failed (freshness/trajectory disabled): ${e?.message || e}`);
  }

  // --- Pre-load batch data for catalyst scoring (news + disclosures) ---
  let newsStatsMap = new Map();
  let disclosureMap = new Map();
  try {
    const [newsResult, discResult] = await Promise.all([
      query(`SELECT nat.ticker_code,
                    COUNT(*) as article_count,
                    ROUND(AVG(na.sentiment_score)::numeric, 2) as avg_sentiment,
                    MAX(CASE na.impact_level WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END) as max_impact,
                    COUNT(DISTINCT na.source) as sources_count
             FROM news_article_tickers nat
             JOIN news_articles na ON na.id = nat.article_id
             WHERE na.is_analyzed = TRUE
               AND na.published_at >= NOW() - INTERVAL '7 days'
               AND na.relevance_score >= 0.3
             GROUP BY nat.ticker_code`),
      query(`SELECT nat.ticker_code,
                    na.news_category,
                    na.sentiment_score
             FROM news_article_tickers nat
             JOIN news_articles na ON na.id = nat.article_id
             WHERE na.source = 'jquants'
               AND na.published_at >= NOW() - INTERVAL '14 days'
               AND na.is_analyzed = TRUE`),
    ]);
    for (const row of newsResult.rows) {
      newsStatsMap.set(row.ticker_code, row);
    }
    for (const row of discResult.rows) {
      if (!disclosureMap.has(row.ticker_code)) disclosureMap.set(row.ticker_code, []);
      disclosureMap.get(row.ticker_code).push(row);
    }
    log(`Batch loaded news stats for ${newsStatsMap.size} tickers, disclosures for ${disclosureMap.size}`);
  } catch (e) {
    warn(`Batch pre-load failed (catalyst scoring disabled): ${e?.message || e}`);
  }

  // --- Main loop ---
  for (const tickerObj of filteredTickers) {
    log(`\n--- Fetching data for ${tickerObj.code} ---`);

    try {
      // 1) Fundamentals/technicals snapshot via Yahoo directly
      const yahooData = await fetchYahooFinanceData(tickerObj.code, tickerObj.sector);

      // quick validation
      const critical = ["currentPrice", "highPrice", "lowPrice"];
      const missingCritical = critical.filter((k) => !yahooData[k]);
      if (missingCritical.length) {
        throw new Error(
          `Critical fields missing: ${missingCritical.join(", ")}`
        );
      }
      log(`Yahoo OK for ${tickerObj.code}`);

      // 2) Build stock object
      const stock = {
        ticker: tickerObj.code,
        sector: tickerObj.sector,
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

      // 3) History + enrichment
      const historicalData = await getCachedHistory(stock.ticker);
      stock.historicalData = historicalData || [];

      // Append synthetic "today" candle if needed
      {
        const today = new Date();
        const last = stock.historicalData.at(-1);
        const lastDate = last?.date ? new Date(last.date) : null;
        const sameDay =
          lastDate &&
          lastDate.getFullYear() === today.getFullYear() &&
          lastDate.getMonth() === today.getMonth() &&
          lastDate.getDate() === today.getDate();

        if (!sameDay) {
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
      }

      const dataForLevels = stock.historicalData;        // includes today (synthetic)
      const dataForGates = stock.historicalData.slice(0, -1); // completed bars only

      enrichForTechnicalScore(stock);

      // 4) Scores (value-first JP) with confidence tracking
      const techResult = computeTechnicalScore(stock, { withConfidence: true });
      stock.technicalScore = techResult.score;
      stock.techConfidence = techResult.confidence;

      const fundResult = getAdvancedFundamentalScore(stock, { withConfidence: true });
      stock.fundamentalScore = fundResult.score;
      stock.fundConfidence = fundResult.confidence;

      const valResult = getValuationScore(stock, {}, { withConfidence: true });
      stock.valuationScore = valResult.score;
      stock.valConfidence = valResult.confidence;

      stock.scoringConfidence = Math.round(
        ((stock.techConfidence + stock.fundConfidence + stock.valConfidence) / 3) * 100
      ) / 100;

      // 4a) Disagreement signal
      const { disagreement, isConflicted } = computeDisagreement(
        stock.technicalScore, stock.fundamentalScore, stock.valuationScore
      );
      stock.scoreDisagreement = disagreement;
      stock.isConflicted = isConflicted;

      // 4b) Data freshness decay
      const freshInfo = freshnessMap.get(stock.ticker) || { freshness: "fresh", ageDays: 0 };
      stock.dataFreshness = freshInfo.freshness;
      if (freshInfo.freshness !== "fresh") {
        stock.fundamentalScore = applyDecay(stock.fundamentalScore, freshInfo.freshness);
        stock.valuationScore = applyDecay(stock.valuationScore, freshInfo.freshness);
      }

      // 4c) Tier calculation
      stock.tier = getNumericTier(
        {
          technicalScore: stock.technicalScore,
          fundamentalScore: stock.fundamentalScore,
          valuationScore: stock.valuationScore,
          debtEquityRatio: stock.debtEquityRatio,
          epsTrailingTwelveMonths: stock.epsTrailingTwelveMonths,
        },
        { mode: "value_only" }
      );

      // 4d) Trajectory modifier
      const prevSnapshot = prevSnapshotMap.get(stock.ticker);
      const trajResult = computeTrajectory(prevSnapshot, {
        peRatio: stock.peRatio,
        epsTrailingTwelveMonths: stock.epsTrailingTwelveMonths,
        epsForward: stock.epsForward,
        dividendYield: stock.dividendYield,
      });
      stock.tierTrajectory = trajResult.trajectory;
      if (trajResult.tierAdj !== 0) {
        stock.tier = Math.max(1, Math.min(6, Math.round(stock.tier + trajResult.tierAdj)));
      }

      // 4b) Value play analysis
      const vp = analyzeValuePlay(stock, historicalData);
      stock.valuePlay = vp;
      stock.isValueCandidate = vp.isValueCandidate;
      stock.valuePlayScore = vp.valuePlayScore;
      stock.valuePlayGrade = vp.grade;
      stock.valuePlayClassification = vp.classification;

      // 5) Sentiment horizons
      const horizons = getComprehensiveMarketSentiment(stock, historicalData);
      stock.shortTermScore = horizons.shortTerm.score;
      stock.longTermScore = horizons.longTerm.score;
      stock.shortTermBias = horizons.shortTerm.label;
      stock.longTermBias = horizons.longTerm.label;
      stock.shortTermConf = horizons.shortTerm.confidence;
      stock.longTermConf = horizons.longTerm.confidence;

      const ST = stock.shortTermScore;
      const LT = stock.longTermScore;

      // 6) Entry timing
      log("Running swing entry timing...");
      const finalSignal = analyzeDipEntry({ ...stock }, dataForLevels, {
        debug: true,
        dataForGates,
        sentiment: { ST, LT },
        market:
          marketLevels && marketGates
            ? {
                ticker: regimeTicker,
                dataForLevels: marketLevels,
                dataForGates: marketGates,
              }
            : null,
      });

      // Liquidity
      const liq = finalSignal?.liquidity || null;
      stock._liquidity = liq;

      // MA stacking flip "bars ago"
      const flipBarsAgo = Number.isFinite(finalSignal?.flipBarsAgo)
        ? finalSignal.flipBarsAgo
        : null;
      stock.flipBarsAgo = flipBarsAgo;

      // Golden cross "bars ago"
      const goldenCrossBarsAgo = Number.isFinite(
        finalSignal?.goldenCrossBarsAgo
      )
        ? finalSignal.goldenCrossBarsAgo
        : null;
      stock.goldenCrossBarsAgo = goldenCrossBarsAgo;

      const analytics = scanAnalytics(stock, dataForLevels);

      // Regime for last completed bar
      const regimeDate =
        (dataForGates?.length ? dataForGates.at(-1)?.date : null) ||
        stock.historicalData.at(-1)?.date;

      const dayRegime = regimeMap
        ? regimeForDate(regimeMap, regimeDate)
        : "RANGE";

      stock.marketRegime = dayRegime;
      stock._scoreAnalytics = analytics;

      // Merge telemetry
      mergeTelemetry(collectors, finalSignal?.telemetry);

      log("Swing entry timing done");

      stock.isBuyNow = finalSignal.buyNow;
      stock.buyNowReason = finalSignal.reason;
      stock.limitBuyOrder = Number.isFinite(finalSignal?.limitBuyOrder)
        ? finalSignal.limitBuyOrder
        : null;

      // Liquidity fields flat on stock (for DB / downstream)
      stock.liqPass = liq ? !!liq.pass : null;
      stock.liqAdv = (() => {
        const v = toFinite(liq?.metrics?.adv);
        return Number.isFinite(v) ? v : null;
      })();
      stock.liqVol = (() => {
        const v = toFinite(liq?.metrics?.avVol);
        return Number.isFinite(v) ? v : null;
      })();

      // Tier aggregation
      const tierKey = String(Number.isFinite(stock.tier) ? stock.tier : "na");
      inc(summary.tiers.byTier, tierKey);
      if (stock.isBuyNow) inc(summary.tiers.buyByTier, tierKey);

      // Summary update
      summary.totals.count += 1;
      if (stock.isBuyNow) {
        summary.totals.buyNow += 1;
        inc(summary.reasons.buy, normalizeReason(stock.buyNowReason));
      } else {
        summary.totals.noBuy += 1;
        inc(summary.reasons.noBuy, normalizeReason(finalSignal.reason));
      }

      // Normalize + mirror stop/target logic
      const suggestedSL = Number(finalSignal.stopLoss);
      const suggestedTP = Number(finalSignal.priceTarget);

      stock.trigger = finalSignal.trigger ?? null;

      const portfolioEntry = myPortfolio.find(
        (p) => normalizeTicker(p?.ticker) === normalizeTicker(stock.ticker)
      );

      if (portfolioEntry) {
        const curStop = Number(portfolioEntry?.trade?.stopLoss);
        const curTarget = Number(portfolioEntry?.trade?.priceTarget);

        // STOP: only tighten (raise)
        const newStop = Number.isFinite(suggestedSL)
          ? Math.max(curStop, toTick(suggestedSL, stock))
          : curStop;

        // TARGET: only keep or raise
        const newTarget = Number.isFinite(suggestedTP)
          ? Number.isFinite(curTarget)
            ? Math.max(curTarget, toTick(suggestedTP, stock))
            : toTick(suggestedTP, stock)
          : curTarget;

        stock.stopLoss = Number.isFinite(newStop) ? newStop : undefined;
        stock.priceTarget = Number.isFinite(newTarget) ? newTarget : undefined;
      } else {
        if (Number.isFinite(suggestedSL)) {
          stock.stopLoss = toTick(suggestedSL, stock);
        }
        if (Number.isFinite(suggestedTP)) {
          stock.priceTarget = toTick(suggestedTP, stock);
        }
      }

      // 7) Trade management if held
      if (portfolioEntry) {
        const entryKind = extractEntryKindFromReason(finalSignal?.reason);

        let entryDate = null;
        const rawED = portfolioEntry?.trade?.entryDate;
        if (rawED) {
          const d = new Date(rawED);
          if (!Number.isNaN(d.getTime())) entryDate = d;
        }

        let barsSinceEntry = null;
        if (entryDate && Array.isArray(dataForGates) && dataForGates.length) {
          const lastCompleted = dataForGates;
          barsSinceEntry = lastCompleted.reduce((acc, b) => {
            const bd = b?.date instanceof Date ? b.date : new Date(b?.date);
            return acc + (bd > entryDate ? 1 : 0);
          }, 0);
        }

        const mgmt = getTradeManagementSignal_V3(
          stock,
          {
            ...portfolioEntry.trade,
            initialStop:
              portfolioEntry.trade.initialStop ?? portfolioEntry.trade.stopLoss,
          },
          historicalData,
          {
            entryKind,
            sentimentScore: stock.shortTermScore,
            entryDate,
            barsSinceEntry,
            deep: horizons?.deep || {},
            isExtended:
              Number.isFinite(stock.bollingerMid) && stock.bollingerMid > 0
                ? (stock.currentPrice - stock.bollingerMid) /
                    stock.bollingerMid >
                  0.15
                : false,
          }
        );

        stock.managementSignalStatus = mgmt.status;
        stock.managementSignalReason = mgmt.reason;

        // If V3 suggests a tighter stop, surface it
        if (Number.isFinite(mgmt.updatedStopLoss)) {
          const proposed = Math.round(mgmt.updatedStopLoss);
          const current = Number(stock.stopLoss) || 0;
          if (proposed > current) {
            stock.stopLoss = proposed;
          }
        }
      } else {
        stock.managementSignalStatus = null;
        stock.managementSignalReason = null;
      }

      // 8) Catalyst score (news sentiment + disclosure events)
      const catalyst = computeCatalystScore(
        newsStatsMap.get(stock.ticker),
        disclosureMap.get(stock.ticker)
      );
      stock.catalystScore = catalyst.score;
      stock._catalystReason = catalyst.reason;

      // 9) Master score (after all dimensions are computed)
      stock.masterScore = computeMasterScore(stock);

      // Push the raw stock object to results
      results.push(stock);
      log(`Processed ${stock.ticker}`);
      count += 1;

      // Notify caller of incremental progress
      if (typeof onProgress === "function") {
        try {
          await onProgress({
            stock,
            processed: count,
            total: filteredTickers.length,
            currentTicker: tickerObj.code,
            buyCount: summary.totals.buyNow,
          });
        } catch (cbErr) {
          warn(`onProgress callback error: ${cbErr?.message || cbErr}`);
        }
      }
    } catch (err) {
      errorLog(`Error processing ${tickerObj.code}:`, err?.message || err);
      errors.push(`Ticker ${tickerObj.code}: ${err?.message || err}`);
    }
  }

  // --- Post-processing: percentile ranking across universe ---
  computePercentiles(results);

  log("Scan complete", { count, errorsCount: errors.length });

  // --- Build summary output ---

  // Derive buy-rate by tier
  const tierRows = Object.keys(summary.tiers.byTier)
    .map((tier) => {
      const tot = summary.tiers.byTier[tier] || 0;
      const buys = summary.tiers.buyByTier[tier] || 0;
      const buyRate = tot ? Math.round((buys / tot) * 10000) / 100 : 0;
      return {
        tier,
        total: tot,
        buys,
        buyRatePct: buyRate,
      };
    })
    .sort((a, b) => b.buyRatePct - a.buyRatePct || b.total - a.total);

  // Top reasons (take top 10 each)
  function topK(obj, k = 10) {
    return Object.entries(obj)
      .map(([reason, cnt]) => ({
        reason,
        count: cnt,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, k);
  }

  // Session-level block breakdowns & histograms
  const blocksTop = summarizeBlocks(collectors.teleList);
  const rrShortBins = histo.rrShortfall.reduce((m, r) => {
    const s = Number(r.short) || 0;
    const key =
      s <= 0.05
        ? "<=0.05"
        : s <= 0.1
        ? "0.05..0.10"
        : s <= 0.25
        ? "0.10..0.25"
        : ">0.25";
    m[key] = (m[key] || 0) + 1;
    return m;
  }, {});

  const summaryOut = {
    ...summary,
    tierTable: tierRows,
    topReasons: {
      buy: topK(summary.reasons.buy, 10),
      noBuy: topK(summary.reasons.noBuy, 10),
    },
    debug: {
      blocksTop,
      slopeBuckets: histo.slopeBuckets,
      rrShortfallBins: rrShortBins,
      headroomSample: histo.headroom.slice(0, 50),
      distMA25Sample: histo.distMA25.slice(0, 50),
      distroSample: Object.fromEntries(
        Object.entries(distro).map(([k, arr]) => [k, arr.slice(0, 100)])
      ),
    },
  };

  summaryOut.totals.buyRatePct = summaryOut.totals.count
    ? Math.round(
        (summaryOut.totals.buyNow / summaryOut.totals.count) * 10000
      ) / 100
    : 0;

  log("SESSION SUMMARY", summaryOut);

  return { count, errors, summary: summaryOut, results };
}
