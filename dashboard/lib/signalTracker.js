// signalTracker.js — Paper trading module for tracking signal performance
// Records scanner buy signals, value play candidates, and space fund DCA buys
// as paper trades, then resolves them when price hits stop/target.

import { query } from "./db.js";
import { logErrorFromCatch } from "./errorLog.js";

// Lazy table creation guard — runs DDL once per process lifetime
let tableEnsured = false;
async function ensureSignalTable() {
  if (tableEnsured) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS signal_trades (
        id                  BIGSERIAL PRIMARY KEY,
        source              TEXT NOT NULL,
        ticker_code         TEXT NOT NULL,
        entry_date          DATE NOT NULL DEFAULT CURRENT_DATE,
        entry_price         NUMERIC(14,4) NOT NULL,
        stop_loss           NUMERIC(14,4),
        price_target        NUMERIC(14,4),
        time_horizon_days   INTEGER,
        trigger_type        TEXT,
        status              TEXT NOT NULL DEFAULT 'OPEN',
        exit_date           DATE,
        exit_price          NUMERIC(14,4),
        exit_reason         TEXT,
        pnl_pct             NUMERIC(8,4),
        r_multiple          NUMERIC(8,4),
        scan_run_id         UUID REFERENCES scan_runs(scan_id) ON DELETE SET NULL,
        source_tx_id        BIGINT,
        metadata            JSONB,
        created_at          TIMESTAMPTZ DEFAULT NOW(),
        updated_at          TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_trades_open_dedup
        ON signal_trades(source, ticker_code) WHERE status = 'OPEN';
      CREATE INDEX IF NOT EXISTS idx_signal_trades_status ON signal_trades(status, source);
      CREATE INDEX IF NOT EXISTS idx_signal_trades_ticker ON signal_trades(ticker_code, entry_date DESC);
    `);
    tableEnsured = true;
  } catch (err) {
    console.error("Failed to ensure signal_trades table:", err.message);
    logErrorFromCatch("lib/signalTracker", err, { step: "ensureTable" });
  }
}

/**
 * Record a scanner buy signal as a paper trade.
 * Dedup: partial unique index on (source, ticker_code) WHERE status='OPEN'.
 */
export async function recordScannerSignal(scanId, stock) {
  await ensureSignalTable();
  if (!stock.isBuyNow) return;

  const entryPrice = Number(stock.currentPrice);
  const stopLoss = Number(stock.stopLoss);
  const priceTarget = Number(stock.priceTarget);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return;

  await query(
    `INSERT INTO signal_trades
     (source, ticker_code, entry_price, stop_loss, price_target,
      trigger_type, scan_run_id, metadata)
     VALUES ('scanner', $1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (source, ticker_code) WHERE status = 'OPEN'
     DO NOTHING`,
    [
      stock.ticker,
      entryPrice,
      Number.isFinite(stopLoss) ? stopLoss : null,
      Number.isFinite(priceTarget) ? priceTarget : null,
      stock.triggerType || stock.trigger || null,
      scanId,
      JSON.stringify({
        sector: stock.sector,
        regime: stock.marketRegime,
        tier: stock.tier,
        fundamentalScore: stock.fundamentalScore,
        valuationScore: stock.valuationScore,
        shortTermScore: stock.shortTermScore,
        longTermScore: stock.longTermScore,
        reason: stock.buyNowReason,
        limitBuyOrder: stock.limitBuyOrder,
      }),
    ]
  ).catch((err) => {
    console.error(`Signal tracker: failed to record scanner signal for ${stock.ticker}:`, err.message);
    logErrorFromCatch("lib/signalTracker", err, { step: "recordScanner", ticker: stock.ticker });
  });
}

/**
 * Record a value play signal as a paper trade.
 */
export async function recordValuePlaySignal(scanId, stock) {
  await ensureSignalTable();
  if (!stock.isValueCandidate) return;

  const entryPrice = Number(stock.currentPrice);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return;

  const vp = stock.valuePlay || {};
  const entry = vp.entry || {};
  const targetPrice = entry.targetPrice ? Number(entry.targetPrice) : null;
  const stopPrice = entry.stopPrice ? Number(entry.stopPrice) : null;
  const timeHorizonDays = entry.timeHorizonDays || null;

  await query(
    `INSERT INTO signal_trades
     (source, ticker_code, entry_price, stop_loss, price_target,
      time_horizon_days, trigger_type, scan_run_id, metadata)
     VALUES ('value_play', $1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (source, ticker_code) WHERE status = 'OPEN'
     DO NOTHING`,
    [
      stock.ticker,
      entryPrice,
      Number.isFinite(stopPrice) ? stopPrice : null,
      Number.isFinite(targetPrice) ? targetPrice : null,
      timeHorizonDays,
      stock.valuePlayClassification || null,
      scanId,
      JSON.stringify({
        grade: stock.valuePlayGrade,
        score: stock.valuePlayScore,
        classification: stock.valuePlayClassification,
        sector: stock.sector,
        regime: stock.marketRegime,
        thesis: vp.thesis,
        conviction: entry.conviction,
        accumulationZone: entry.accumulationZone,
      }),
    ]
  ).catch((err) => {
    console.error(`Signal tracker: failed to record value play signal for ${stock.ticker}:`, err.message);
    logErrorFromCatch("lib/signalTracker", err, { step: "recordValuePlay", ticker: stock.ticker });
  });
}

/**
 * Record a space fund buy transaction as a paper trade.
 */
export async function recordSpaceFundSignal(transaction) {
  await ensureSignalTable();
  const type = (transaction.transaction_type || "").toUpperCase();
  if (type !== "BUY" && type !== "DCA_BUY") return;

  const entryPrice = Number(transaction.price_per_share);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return;

  const targetPrice = Math.round(entryPrice * 1.25 * 100) / 100; // +25%
  const stopPrice = Math.round(entryPrice * 0.88 * 100) / 100;   // -12%

  await query(
    `INSERT INTO signal_trades
     (source, ticker_code, entry_date, entry_price, stop_loss, price_target,
      trigger_type, source_tx_id, metadata)
     VALUES ('space_fund', $1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (source, ticker_code) WHERE status = 'OPEN'
     DO NOTHING`,
    [
      transaction.ticker_code,
      transaction.transaction_date || new Date().toISOString().split("T")[0],
      entryPrice,
      stopPrice,
      targetPrice,
      type,
      transaction.id,
      JSON.stringify({
        shares: transaction.shares,
        totalAmount: transaction.total_amount,
        dcaMonth: transaction.dca_month,
        currency: transaction.currency,
      }),
    ]
  ).catch((err) => {
    console.error(`Signal tracker: failed to record space fund signal for ${transaction.ticker_code}:`, err.message);
    logErrorFromCatch("lib/signalTracker", err, { step: "recordSpaceFund", ticker: transaction.ticker_code });
  });
}

/**
 * Resolve all OPEN trades by checking current prices.
 * @param {Function} getQuoteFn - async (ticker) => { high, low, close } | null
 * @returns {{ resolved: number, errors: string[] }}
 */
export async function resolveOpenSignals(getQuoteFn) {
  await ensureSignalTable();
  const openTrades = await query(
    `SELECT id, source, ticker_code, entry_price, stop_loss, price_target,
            time_horizon_days, entry_date
     FROM signal_trades WHERE status = 'OPEN'
     ORDER BY entry_date ASC`
  );

  let resolved = 0;
  const errors = [];
  const today = new Date();

  for (const trade of openTrades.rows) {
    try {
      const quote = await getQuoteFn(trade.ticker_code);
      if (!quote) continue;

      const high = Number(quote.high);
      const low = Number(quote.low);
      const close = Number(quote.close);
      const entryPrice = Number(trade.entry_price);
      const stopLoss = Number(trade.stop_loss);
      const priceTarget = Number(trade.price_target);

      let exitPrice = null;
      let exitReason = null;
      let status = null;

      const targetHit = Number.isFinite(priceTarget) && Number.isFinite(high) && high >= priceTarget;
      const stopHit = Number.isFinite(stopLoss) && Number.isFinite(low) && low <= stopLoss;

      if (targetHit && stopHit) {
        // Both hit same day — use close relative to entry
        if (close >= entryPrice) {
          exitPrice = priceTarget;
          exitReason = "TARGET_HIT";
          status = "WIN";
        } else {
          exitPrice = stopLoss;
          exitReason = "STOP_HIT";
          status = "LOSS";
        }
      } else if (targetHit) {
        exitPrice = priceTarget;
        exitReason = "TARGET_HIT";
        status = "WIN";
      } else if (stopHit) {
        exitPrice = stopLoss;
        exitReason = "STOP_HIT";
        status = "LOSS";
      }

      // Check time horizon expiry for value plays
      if (!status && trade.time_horizon_days && trade.entry_date) {
        const entryDate = new Date(trade.entry_date);
        const expiryDate = new Date(entryDate);
        expiryDate.setDate(expiryDate.getDate() + trade.time_horizon_days);
        if (today >= expiryDate && Number.isFinite(close)) {
          exitPrice = close;
          exitReason = "TIME_EXPIRED";
          status = "EXPIRED";
        }
      }

      if (status && exitPrice != null) {
        const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
        const risk = Math.abs(entryPrice - stopLoss);
        const rMultiple = risk > 0 ? (exitPrice - entryPrice) / risk : null;

        await query(
          `UPDATE signal_trades
           SET status = $2, exit_date = CURRENT_DATE, exit_price = $3,
               exit_reason = $4, pnl_pct = $5, r_multiple = $6, updated_at = NOW()
           WHERE id = $1`,
          [trade.id, status, exitPrice, exitReason, pnlPct, rMultiple]
        );
        resolved++;
      }
    } catch (err) {
      errors.push(`${trade.ticker_code}: ${err.message}`);
    }
  }

  return { resolved, errors };
}
