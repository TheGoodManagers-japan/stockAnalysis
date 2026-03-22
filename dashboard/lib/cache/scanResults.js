import { query } from "../db.js";

/**
 * Save scan result for a single stock.
 */
export async function saveScanResult(scanId, stock) {
  // Update tickers.short_name if we have one from Yahoo
  if (stock.shortName) {
    await query(
      `UPDATE tickers SET short_name = $2, updated_at = NOW()
       WHERE code = $1 AND (short_name IS NULL OR short_name = '')`,
      [stock.ticker, stock.shortName]
    ).catch(() => {});
  }

  await query(
    `INSERT INTO scan_results (
       scan_id, ticker_code, current_price,
       fundamental_score, valuation_score, technical_score,
       tier, value_quadrant,
       short_term_score, long_term_score,
       short_term_bias, long_term_bias,
       short_term_conf, long_term_conf,
       is_buy_now, buy_now_reason, trigger_type,
       stop_loss, price_target, limit_buy_order,
       mgmt_signal_status, mgmt_signal_reason,
       market_regime, flip_bars_ago, golden_cross_bars_ago,
       liq_pass, liq_adv, liq_vol,
       other_data_json,
       is_value_candidate, value_play_score, value_play_grade,
       value_play_class, value_play_json,
       master_score
     ) VALUES (
       $1, $2, $3,
       $4, $5, $6,
       $7, $8,
       $9, $10,
       $11, $12,
       $13, $14,
       $15, $16, $17,
       $18, $19, $20,
       $21, $22,
       $23, $24, $25,
       $26, $27, $28,
       $29,
       $30, $31, $32,
       $33, $34,
       $35
     )`,
    [
      scanId,
      stock.ticker,
      stock.currentPrice,
      stock.fundamentalScore,
      stock.valuationScore,
      stock.technicalScore,
      stock.tier,
      null, // value_quadrant deprecated — derived from tier in UI
      stock.shortTermScore,
      stock.longTermScore,
      stock.shortTermBias,
      stock.longTermBias,
      stock.shortTermConf,
      stock.longTermConf,
      stock.isBuyNow || false,
      stock.buyNowReason,
      stock.triggerType,
      stock.stopLoss,
      stock.priceTarget,
      stock.limitBuyOrder,
      stock.managementSignalStatus,
      stock.managementSignalReason,
      stock.marketRegime,
      stock.flipBarsAgo,
      stock.goldenCrossBarsAgo,
      stock.liqPass,
      stock.liqAdv,
      stock.liqVol,
      JSON.stringify({
        highPrice: stock.highPrice,
        lowPrice: stock.lowPrice,
        openPrice: stock.openPrice,
        prevClosePrice: stock.prevClosePrice,
        marketCap: stock.marketCap,
        peRatio: stock.peRatio,
        pbRatio: stock.pbRatio,
        dividendYield: stock.dividendYield,
        rsi14: stock.rsi14,
        macd: stock.macd,
        atr14: stock.atr14,
        technicalScore: stock.technicalScore,
        fundamentalScore: stock.fundamentalScore,
        valuationScore: stock.valuationScore,
        evToEbitda: stock.evToEbitda,
        evToEbit: stock.evToEbit,
        fcfYieldPct: stock.fcfYieldPct,
        shareholderYieldPct: stock.shareholderYieldPct,
        dividendGrowth5yr: stock.dividendGrowth5yr,
        epsGrowthRate: stock.epsGrowthRate,
        priceToSales: stock.priceToSales,
        ptbv: stock.ptbv,
        fiftyTwoWeekHigh: stock.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: stock.fiftyTwoWeekLow,
        totalCash: stock.totalCash,
        totalDebt: stock.totalDebt,
        // Scoring overhaul fields
        scoring_confidence: stock.scoringConfidence,
        tech_confidence: stock.techConfidence,
        fund_confidence: stock.fundConfidence,
        val_confidence: stock.valConfidence,
        score_disagreement: stock.scoreDisagreement,
        is_conflicted: stock.isConflicted,
        data_freshness: stock.dataFreshness,
        tier_trajectory: stock.tierTrajectory,
        ml_signal_confidence: stock.mlSignalConfidence,
        catalyst_score: stock.catalystScore,
        catalyst_reason: stock._catalystReason,
      }),
      stock.isValueCandidate || false,
      stock.valuePlayScore,
      stock.valuePlayGrade,
      stock.valuePlayClassification,
      stock.valuePlay ? JSON.stringify(stock.valuePlay) : null,
      stock.masterScore,
    ]
  );
}

/**
 * Batch-update percentile data in other_data_json after scan completes.
 */
export async function updatePercentiles(scanId, results) {
  for (const stock of results) {
    if (stock.fundamentalScorePctile == null && stock.valuationScorePctile == null) continue;
    await query(
      `UPDATE scan_results
       SET other_data_json = COALESCE(other_data_json, '{}'::jsonb) || $2::jsonb
       WHERE scan_id = $1 AND ticker_code = $3`,
      [
        scanId,
        JSON.stringify({
          fundPctile: stock.fundamentalScorePctile,
          valPctile: stock.valuationScorePctile,
          techPctile: stock.technicalScorePctile,
        }),
        stock.ticker,
      ]
    );
  }
}
