import { query } from "../db.js";
import { fetchHistoricalData as fetchFromYahoo } from "../yahoo.js";

/**
 * Get cached price history from Postgres, fetching from Yahoo if stale.
 * Returns array of { date, open, high, low, close, volume }.
 */
export async function getCachedHistory(tickerCode, years = 10) {
  const cached = await query(
    `SELECT date, open, high, low, close, volume
     FROM price_history
     WHERE ticker_code = $1
     ORDER BY date ASC`,
    [tickerCode]
  );

  const today = new Date().toISOString().split("T")[0];
  const rows = cached.rows;

  if (rows.length > 50) {
    const lastDate = rows[rows.length - 1].date;
    const lastDateStr =
      lastDate instanceof Date
        ? lastDate.toISOString().split("T")[0]
        : String(lastDate);
    const daysDiff = Math.floor(
      (new Date(today) - new Date(lastDateStr)) / (1000 * 60 * 60 * 24)
    );

    // Check if data goes back far enough
    const firstDate = rows[0].date;
    const firstDateStr =
      firstDate instanceof Date
        ? firstDate.toISOString().split("T")[0]
        : String(firstDate);
    const targetStart = new Date();
    targetStart.setFullYear(targetStart.getFullYear() - years);
    const startGapDays = Math.floor(
      (new Date(firstDateStr) - targetStart) / (1000 * 60 * 60 * 24)
    );

    if (daysDiff <= 3 && startGapDays < 30) {
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

  const fresh = await fetchFromYahoo(tickerCode, years);
  if (!fresh || fresh.length === 0) {
    return rows.map((r) => ({
      date: r.date,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    }));
  }

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

async function upsertPriceHistory(tickerCode, bars) {
  if (!bars || bars.length === 0) return;

  // Deduplicate by date (keep last occurrence) to avoid
  // "ON CONFLICT DO UPDATE cannot affect row a second time"
  const seen = new Map();
  for (const bar of bars) {
    const dateStr =
      bar.date instanceof Date
        ? bar.date.toISOString().split("T")[0]
        : String(bar.date).split("T")[0];
    seen.set(dateStr, bar);
  }
  const dedupedBars = [...seen.values()];

  const batchSize = 100;
  for (let i = 0; i < dedupedBars.length; i += batchSize) {
    const batch = dedupedBars.slice(i, i + batchSize);
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
