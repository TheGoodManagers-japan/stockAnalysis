/**
 * backfill-signals.js — One-time script to populate signal_trades from historical scan_results.
 *
 * Usage: DATABASE_URL=... node scripts/backfill-signals.js
 */

import pg from "pg";
const { Pool } = pg;

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/stockanalysis";

async function backfill() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    console.log("Connecting to database...");

    // 1. Backfill scanner signals (is_buy_now = true)
    const scannerResults = await pool.query(`
      SELECT sr.scan_id, sr.ticker_code, sr.scan_date,
             sr.current_price, sr.stop_loss, sr.price_target,
             sr.trigger_type, sr.market_regime, sr.tier,
             sr.fundamental_score, sr.valuation_score,
             sr.short_term_score, sr.long_term_score,
             sr.buy_now_reason, sr.limit_buy_order,
             sr.other_data_json
      FROM scan_results sr
      WHERE sr.is_buy_now = true
        AND sr.current_price > 0
      ORDER BY sr.scan_date ASC
    `);

    console.log(`Found ${scannerResults.rows.length} scanner buy signals to backfill`);

    let scannerCount = 0;
    for (const row of scannerResults.rows) {
      const otherData = row.other_data_json || {};
      const result = await pool.query(
        `INSERT INTO signal_trades
         (source, ticker_code, entry_date, entry_price, stop_loss, price_target,
          trigger_type, scan_run_id, metadata)
         VALUES ('scanner', $1, $2::date, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (source, ticker_code) WHERE status = 'OPEN'
         DO NOTHING`,
        [
          row.ticker_code,
          row.scan_date,
          row.current_price,
          row.stop_loss,
          row.price_target,
          row.trigger_type,
          row.scan_id,
          JSON.stringify({
            sector: otherData.sector || null,
            regime: row.market_regime,
            tier: row.tier,
            fundamentalScore: row.fundamental_score,
            valuationScore: row.valuation_score,
            shortTermScore: row.short_term_score,
            longTermScore: row.long_term_score,
            reason: row.buy_now_reason,
            limitBuyOrder: row.limit_buy_order,
            backfilled: true,
          }),
        ]
      );
      if (result.rowCount > 0) scannerCount++;
    }
    console.log(`Backfilled ${scannerCount} scanner signals`);

    // 2. Backfill value play signals (is_value_candidate = true)
    const vpResults = await pool.query(`
      SELECT sr.scan_id, sr.ticker_code, sr.scan_date,
             sr.current_price, sr.value_play_class,
             sr.value_play_score, sr.value_play_grade,
             sr.value_play_json
      FROM scan_results sr
      WHERE sr.is_value_candidate = true
        AND sr.current_price > 0
      ORDER BY sr.scan_date ASC
    `);

    console.log(`Found ${vpResults.rows.length} value play signals to backfill`);

    let vpCount = 0;
    for (const row of vpResults.rows) {
      const vp = row.value_play_json || {};
      const entry = vp.entry || {};
      const result = await pool.query(
        `INSERT INTO signal_trades
         (source, ticker_code, entry_date, entry_price, stop_loss, price_target,
          time_horizon_days, trigger_type, scan_run_id, metadata)
         VALUES ('value_play', $1, $2::date, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (source, ticker_code) WHERE status = 'OPEN'
         DO NOTHING`,
        [
          row.ticker_code,
          row.scan_date,
          row.current_price,
          entry.stopPrice || null,
          entry.targetPrice || null,
          entry.timeHorizonDays || null,
          row.value_play_class || null,
          row.scan_id,
          JSON.stringify({
            grade: row.value_play_grade,
            score: row.value_play_score,
            classification: row.value_play_class,
            backfilled: true,
          }),
        ]
      );
      if (result.rowCount > 0) vpCount++;
    }
    console.log(`Backfilled ${vpCount} value play signals`);

    // 3. Summary
    const total = await pool.query(
      `SELECT source, status, COUNT(*) as cnt
       FROM signal_trades GROUP BY source, status ORDER BY source, status`
    );
    console.log("\nSignal trades summary:");
    for (const row of total.rows) {
      console.log(`  ${row.source} / ${row.status}: ${row.cnt}`);
    }
  } catch (err) {
    console.error("Backfill failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

backfill();
