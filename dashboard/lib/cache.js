import { query } from "./db.js";
import { fetchHistoricalData as fetchFromYahoo } from "./yahoo.js";

/**
 * Get cached price history from Postgres, fetching from Yahoo if stale.
 * Returns array of { date, open, high, low, close, volume }.
 */
export async function getCachedHistory(tickerCode, years = 3) {
  // Check what we have cached
  const cached = await query(
    `SELECT date, open, high, low, close, volume
     FROM price_history
     WHERE ticker_code = $1
     ORDER BY date ASC`,
    [tickerCode]
  );

  const today = new Date().toISOString().split("T")[0];
  const rows = cached.rows;

  // If we have data and the last row is today or yesterday, use cache
  if (rows.length > 50) {
    const lastDate = rows[rows.length - 1].date;
    const lastDateStr =
      lastDate instanceof Date
        ? lastDate.toISOString().split("T")[0]
        : String(lastDate);
    const daysDiff = Math.floor(
      (new Date(today) - new Date(lastDateStr)) / (1000 * 60 * 60 * 24)
    );

    // Markets closed on weekends, so 3 days stale is OK
    if (daysDiff <= 3) {
      return rows.map((r) => ({
        date: r.date,
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume),
      }));
    }
  }

  // Fetch fresh from Yahoo
  const fresh = await fetchFromYahoo(tickerCode, years);
  if (!fresh || fresh.length === 0) {
    // Return whatever cache we had
    return rows.map((r) => ({
      date: r.date,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    }));
  }

  // Upsert into database
  await upsertPriceHistory(tickerCode, fresh);

  return fresh.map((r) => ({
    date: r.date,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  }));
}

/**
 * Upsert price history rows into Postgres.
 */
async function upsertPriceHistory(tickerCode, bars) {
  if (!bars || bars.length === 0) return;

  // Batch insert with ON CONFLICT
  const batchSize = 100;
  for (let i = 0; i < bars.length; i += batchSize) {
    const batch = bars.slice(i, i + batchSize);
    const values = [];
    const params = [];
    let idx = 1;

    for (const bar of batch) {
      const dateStr =
        bar.date instanceof Date
          ? bar.date.toISOString().split("T")[0]
          : String(bar.date).split("T")[0];

      values.push(
        `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6})`
      );
      params.push(
        tickerCode,
        dateStr,
        bar.open ?? null,
        bar.high ?? null,
        bar.low ?? null,
        bar.close,
        bar.volume ?? 0
      );
      idx += 7;
    }

    await query(
      `INSERT INTO price_history (ticker_code, date, open, high, low, close, volume)
       VALUES ${values.join(", ")}
       ON CONFLICT (ticker_code, date) DO UPDATE SET
         open = EXCLUDED.open,
         high = EXCLUDED.high,
         low = EXCLUDED.low,
         close = EXCLUDED.close,
         volume = EXCLUDED.volume`,
      params
    );
  }
}

/**
 * Cache a stock snapshot (fundamentals + indicators) in Postgres.
 */
export async function cacheStockSnapshot(tickerCode, data) {
  if (!data) return;

  await query(
    `INSERT INTO stock_snapshots (
       ticker_code, snapshot_date,
       current_price, open_price, high_price, low_price, prev_close_price,
       today_volume, market_cap, pe_ratio, pb_ratio,
       dividend_yield, dividend_growth_5yr,
       eps_trailing, eps_forward, eps_growth_rate,
       debt_equity_ratio, fifty_two_week_high, fifty_two_week_low,
       next_earnings_date,
       rsi_14, macd, macd_signal,
       bollinger_mid, bollinger_upper, bollinger_lower,
       stochastic_k, stochastic_d, obv, atr_14,
       ma_5d, ma_20d, ma_25d, ma_50d, ma_75d, ma_200d,
       extra_json
     ) VALUES (
       $1, CURRENT_DATE,
       $2, $3, $4, $5, $6,
       $7, $8, $9, $10,
       $11, $12,
       $13, $14, $15,
       $16, $17, $18,
       $19,
       $20, $21, $22,
       $23, $24, $25,
       $26, $27, $28, $29,
       $30, $31, $32, $33, $34, $35,
       $36
     )
     ON CONFLICT (ticker_code, snapshot_date) DO UPDATE SET
       current_price = EXCLUDED.current_price,
       open_price = EXCLUDED.open_price,
       high_price = EXCLUDED.high_price,
       low_price = EXCLUDED.low_price,
       prev_close_price = EXCLUDED.prev_close_price,
       today_volume = EXCLUDED.today_volume,
       market_cap = EXCLUDED.market_cap,
       pe_ratio = EXCLUDED.pe_ratio,
       pb_ratio = EXCLUDED.pb_ratio,
       dividend_yield = EXCLUDED.dividend_yield,
       dividend_growth_5yr = EXCLUDED.dividend_growth_5yr,
       eps_trailing = EXCLUDED.eps_trailing,
       eps_forward = EXCLUDED.eps_forward,
       eps_growth_rate = EXCLUDED.eps_growth_rate,
       debt_equity_ratio = EXCLUDED.debt_equity_ratio,
       fifty_two_week_high = EXCLUDED.fifty_two_week_high,
       fifty_two_week_low = EXCLUDED.fifty_two_week_low,
       next_earnings_date = EXCLUDED.next_earnings_date,
       rsi_14 = EXCLUDED.rsi_14,
       macd = EXCLUDED.macd,
       macd_signal = EXCLUDED.macd_signal,
       bollinger_mid = EXCLUDED.bollinger_mid,
       bollinger_upper = EXCLUDED.bollinger_upper,
       bollinger_lower = EXCLUDED.bollinger_lower,
       stochastic_k = EXCLUDED.stochastic_k,
       stochastic_d = EXCLUDED.stochastic_d,
       obv = EXCLUDED.obv,
       atr_14 = EXCLUDED.atr_14,
       ma_5d = EXCLUDED.ma_5d,
       ma_20d = EXCLUDED.ma_20d,
       ma_25d = EXCLUDED.ma_25d,
       ma_50d = EXCLUDED.ma_50d,
       ma_75d = EXCLUDED.ma_75d,
       ma_200d = EXCLUDED.ma_200d,
       extra_json = EXCLUDED.extra_json`,
    [
      tickerCode,
      data.currentPrice,
      data.openPrice,
      data.highPrice,
      data.lowPrice,
      data.prevClosePrice,
      data.todayVolume,
      data.marketCap,
      data.peRatio,
      data.pbRatio,
      data.dividendYield,
      data.dividendGrowth5yr,
      data.epsTrailingTwelveMonths,
      data.epsForward,
      data.epsGrowthRate,
      data.debtEquityRatio,
      data.fiftyTwoWeekHigh,
      data.fiftyTwoWeekLow,
      data.nextEarningsDateIso || null,
      data.rsi14,
      data.macd,
      data.macdSignal,
      data.bollingerMid,
      data.bollingerUpper,
      data.bollingerLower,
      data.stochasticK,
      data.stochasticD,
      data.obv,
      data.atr14,
      data.movingAverage5d,
      data.movingAverage20d,
      data.movingAverage25d,
      data.movingAverage50d,
      data.movingAverage75d,
      data.movingAverage200d,
      JSON.stringify({
        enterpriseValue: data.enterpriseValue,
        totalDebt: data.totalDebt,
        totalCash: data.totalCash,
        freeCashflow: data.freeCashflow,
        ebit: data.ebit,
        ebitda: data.ebitda,
        sharesOutstanding: data.sharesOutstanding,
        tangibleBookValue: data.tangibleBookValue,
        evToEbit: data.evToEbit,
        evToEbitda: data.evToEbitda,
        fcfYieldPct: data.fcfYieldPct,
        buybackYieldPct: data.buybackYieldPct,
        shareholderYieldPct: data.shareholderYieldPct,
        ptbv: data.ptbv,
        priceToSales: data.priceToSales,
      }),
    ]
  );
}

/**
 * Save scan result for a single stock.
 */
export async function saveScanResult(scanId, stock) {
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
       other_data_json
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
       $29
     )`,
    [
      scanId,
      stock.ticker,
      stock.currentPrice,
      stock.fundamentalScore,
      stock.valuationScore,
      stock.technicalScore,
      stock.tier,
      stock.valueQuadrant,
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
      }),
    ]
  );
}
